import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ChatMessage, AgentChatMessage, ChatImage, ChatImageRef, ChatSendOptions, ChatSendResult, ChatAgentEvent, AgentChatMode } from '../../shared/types';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { AgentLibCallbacks } from '../interfaces/agent-lib';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { SessionScope } from './chat-prompt-parts';
import { buildAgentChatSystemPrompt, buildDesktopSystemPrompt } from './chat-prompt-parts';
import { deriveSessionId } from './session-history-formatter';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppLogger } from './app-logger';

const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

/** Callbacks from runSdkQuery (used for summarization). */
interface SdkQueryCallbacks {
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolUse?: (block: { type: 'tool_use'; name: string; id?: string; input?: unknown }) => void;
  onResult?: (msg: SDKResultMessage) => void;
  onUserToolResult?: (toolUseId: string, content: string) => void;
}

/** Parse a user message content field that may be a JSON envelope with images. */
function parseUserContent(content: string): { text: string; images?: ChatImageRef[] } {
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        const images = Array.isArray(parsed.images) && parsed.images.length > 0
          ? (parsed.images as ChatImageRef[])
          : undefined;
        return { text: parsed.text, images };
      }
    } catch (err) {
      getAppLogger().warn('ChatAgentService', 'parseUserContent: Content starts with { but failed JSON parse', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { text: content };
}

/** Extract plain text from a DB content field (handles both JSON array, JSON envelope, and legacy plain text). */
function extractTextFromContent(content: string): string {
  if (content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((m: { type: string }) => m.type === 'assistant_text')
          .map((m: { text: string }) => m.text)
          .join('');
      }
    } catch (err) {
      getAppLogger().warn('ChatAgentService', 'extractTextFromContent: Content looks like JSON but failed to parse', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return parseUserContent(content).text;
}

const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Save images to disk and return refs with file paths. */
async function saveImagesToDisk(sessionId: string, images: ChatImage[], imageStorageDir: string): Promise<ChatImageRef[]> {
  const safeSessionId = path.basename(sessionId);
  const baseDir = path.join(imageStorageDir, safeSessionId);
  await fs.promises.mkdir(baseDir, { recursive: true });

  return Promise.all(images.map(async (img) => {
    const ext = MEDIA_TYPE_TO_EXT[img.mediaType] || 'png';
    const filename = `${randomUUID()}.${ext}`;
    const filePath = path.join(baseDir, filename);
    const buffer = Buffer.from(img.base64, 'base64');
    if (buffer.length === 0) {
      throw new Error(`Image "${img.name || 'unnamed'}" decoded to empty data`);
    }
    await fs.promises.writeFile(filePath, buffer);
    return {
      path: filePath,
      mediaType: img.mediaType,
      name: img.name || filename,
    };
  }));
}

const WRITE_TOOL_NAMES = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);

export interface RunningAgent {
  sessionId: string;
  sessionName: string;
  scopeType: 'project' | 'task';
  scopeId: string;
  projectId: string;
  projectName: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  lastActivity: number;
  messagePreview?: string;
}

const DEFAULT_AGENT_LIB = 'claude-code';
const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

export class ChatAgentService {
  private runningControllers = new Map<string, AbortController>();
  private runningAgents = new Map<string, RunningAgent>();
  private imageStorageDir: string;

  constructor(
    private chatMessageStore: IChatMessageStore,
    private chatSessionStore: IChatSessionStore,
    private projectStore: IProjectStore,
    private taskStore: ITaskStore,
    private pipelineStore: IPipelineStore,
    private agentLibRegistry: AgentLibRegistry,
    private getDefaultAgentLib: () => string = () => DEFAULT_AGENT_LIB,
    imageStorageDir?: string,
  ) {
    this.imageStorageDir = imageStorageDir
      ?? path.join(process.env.HOME || os.homedir(), '.agents-manager', 'chat-images');
  }

  /**
   * Validates inputs and creates a new chat session.
   * Centralises scope verification, projectId derivation, and agentLib validation
   * that previously lived in the route handler.
   */
  async createSession(input: {
    scopeType: string;
    scopeId: string;
    name: string;
    agentLib?: string;
  }): Promise<import('../../shared/types').ChatSession> {
    const { scopeType, scopeId, name, agentLib } = input;

    if (!scopeType || (scopeType !== 'project' && scopeType !== 'task')) {
      throw Object.assign(new Error('scopeType must be "project" or "task"'), { status: 400 });
    }
    if (!scopeId) {
      throw Object.assign(new Error('scopeId is required'), { status: 400 });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw Object.assign(new Error('name is required and must be a non-empty string'), { status: 400 });
    }
    if (name.length > 100) {
      throw Object.assign(new Error('Session name must be 100 characters or less'), { status: 400 });
    }

    // Verify scope target exists and derive projectId
    let projectId: string;
    if (scopeType === 'project') {
      const project = await this.projectStore.getProject(scopeId);
      if (!project) {
        throw Object.assign(new Error('Project not found'), { status: 404 });
      }
      projectId = project.id;
    } else {
      const task = await this.taskStore.getTask(scopeId);
      if (!task) {
        throw Object.assign(new Error('Task not found'), { status: 404 });
      }
      projectId = task.projectId;
    }

    // Validate agentLib if provided
    if (agentLib) {
      const validLibs = this.agentLibRegistry.listNames();
      if (!validLibs.includes(agentLib)) {
        throw Object.assign(
          new Error(`Unknown agent lib: ${agentLib}. Available: ${validLibs.join(', ')}`),
          { status: 400 },
        );
      }
    }

    return this.chatSessionStore.createSession({
      scopeType: scopeType as 'project' | 'task',
      scopeId,
      name: name.trim(),
      agentLib,
      projectId,
    });
  }

  /**
   * Returns the session ID for a task's default chat session,
   * creating one if none exists.
   */
  async getOrCreateTaskSession(taskId: string): Promise<string> {
    const sessions = await this.chatSessionStore.listSessionsForScope('task', taskId);
    if (sessions.length > 0) {
      return sessions[0].id;
    }
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
    const session = await this.chatSessionStore.createSession({
      scopeType: 'task',
      scopeId: taskId,
      name: 'Task Chat',
      projectId: task.projectId,
    });
    return session.id;
  }

  /**
   * Returns (or creates) the agent-chat session for a given task + agentRole.
   * There is at most one agent-chat session per task/role pair.
   */
  async getOrCreateAgentChatSession(taskId: string, agentRole: string): Promise<import('../../shared/types').ChatSession> {
    const sessions = await this.chatSessionStore.listSessionsForScope('task', taskId);
    const existing = sessions.find(s => s.source === 'agent-chat' && s.agentRole === agentRole);
    if (existing) return existing;

    const task = await this.taskStore.getTask(taskId);
    if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });

    const roleName = agentRole.charAt(0).toUpperCase() + agentRole.slice(1);
    return this.chatSessionStore.createSession({
      scopeType: 'task',
      scopeId: taskId,
      name: `Chat with ${roleName}`,
      source: 'agent-chat',
      agentRole,
      projectId: task.projectId,
    });
  }

  /**
   * Returns scope information for a session so consumers can build
   * their own system prompt via chat-prompt-parts builders.
   */
  async getSessionScope(sessionId: string): Promise<SessionScope> {
    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.scopeType === 'task') {
      const task = await this.taskStore.getTask(session.scopeId);
      if (!task) throw new Error(`Task not found: ${session.scopeId}`);
      const project = await this.projectStore.getProject(task.projectId);
      if (!project) throw new Error(`Project not found for task: ${session.scopeId}`);
      const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
      return {
        scopeType: 'task',
        projectId: task.projectId,
        projectName: project.name,
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          description: task.description,
          priority: task.priority,
          assignee: task.assignee,
          plan: task.plan,
          technicalDesign: task.technicalDesign,
          pipelineName: pipeline?.name ?? task.pipelineId,
        },
      };
    }

    if (session.scopeType !== 'project') {
      throw new Error(`Unknown scope type: ${session.scopeType}`);
    }

    const project = await this.projectStore.getProject(session.scopeId);
    if (!project) throw new Error(`Project not found: ${session.scopeId}`);
    return {
      scopeType: 'project',
      projectId: session.scopeId,
      projectName: project.name,
    };
  }

  /**
   * Builds a system prompt and resume options for a session.
   * Agent-chat sessions get mode-aware prompts and pipeline session resume;
   * regular sessions get the standard desktop prompt.
   */
  async buildSendContext(sessionId: string, mode?: AgentChatMode): Promise<{
    systemPrompt: string;
    pipelineSessionId?: string;
    resumeSession?: boolean;
    mode?: AgentChatMode;
  }> {
    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const scope = await this.getSessionScope(sessionId);

    if (session.source === 'agent-chat' && session.agentRole) {
      const effectiveMode = mode ?? 'question';
      return {
        systemPrompt: buildAgentChatSystemPrompt(scope, session.agentRole, effectiveMode),
        pipelineSessionId: deriveSessionId(session.scopeId, session.agentRole),
        resumeSession: true,
        mode: effectiveMode,
      };
    }

    return { systemPrompt: buildDesktopSystemPrompt(scope) };
  }

  async send(
    sessionId: string,
    message: string,
    options: ChatSendOptions,
  ): Promise<ChatSendResult> {
    const { systemPrompt, onEvent, images, pipelineSessionId, resumeSession, mode } = options;

    getAppLogger().info('ChatAgentService', `send() called for session ${sessionId}`, { messageLength: message.length, hasImages: !!(images?.length) });

    // Get session to find scope
    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Don't abort previous running chat - allow parallel execution
    // but do check if there's already one running for this session
    if (this.runningControllers.has(sessionId)) {
      getAppLogger().warn('ChatAgentService', `Rejecting send: agent already running for session ${sessionId}`);
      throw new Error('An agent is already running for this session');
    }

    // Save images to disk and build refs
    let imageRefs: ChatImageRef[] | undefined;
    if (images && images.length > 0) {
      imageRefs = await saveImagesToDisk(sessionId, images, this.imageStorageDir);
    }

    // Persist user message — store as JSON envelope if images are present
    const userContent = imageRefs
      ? JSON.stringify({ text: message, images: imageRefs })
      : message;
    const userMessage = await this.chatMessageStore.addMessage({
      sessionId,
      role: 'user',
      content: userContent,
    });

    // Resolve project path
    const { projectPath, projectId, projectName, projectDefaultAgentLib } = await this.resolveScope(session);

    // Safe event emitter
    const emitEvent = (event: ChatAgentEvent) => {
      try { onEvent?.(event); } catch (err) {
        getAppLogger().warn('ChatAgentService', 'Event delivery failed', { error: err instanceof Error ? err.message : String(err) });
      }
    };

    // Resolve which agent lib to use: session > project config > global setting > hardcoded fallback
    let agentLibName = session.agentLib || projectDefaultAgentLib || this.getDefaultAgentLib() || DEFAULT_AGENT_LIB;

    // Validate the resolved agent lib exists; fall back with a warning if not
    const availableLibs = this.agentLibRegistry.listNames();
    if (!availableLibs.includes(agentLibName)) {
      getAppLogger().warn('ChatAgentService', `Agent lib "${agentLibName}" not found in registry, falling back to "${DEFAULT_AGENT_LIB}"`);
      emitEvent({ type: 'text', text: `\n[Warning: Agent engine "${agentLibName}" is not available. Falling back to "${DEFAULT_AGENT_LIB}".]\n` });
      agentLibName = DEFAULT_AGENT_LIB;
    }

    // Resolve model: session > engine default
    const sessionModel = session.model || undefined;

    // Track running agent
    this.runningAgents.set(sessionId, {
      sessionId,
      sessionName: session.name,
      scopeType: session.scopeType,
      scopeId: session.scopeId,
      projectId,
      projectName,
      status: 'running',
      startedAt: Date.now(),
      lastActivity: Date.now(),
      messagePreview: message.slice(0, 100),
    });

    // Load conversation history
    const history = await this.chatMessageStore.getMessagesForSession(sessionId);

    // Build prompt with conversation history
    const conversationLines: string[] = [];
    // All messages except the latest user message (which becomes the prompt)
    for (const msg of history.slice(0, -1)) {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      let line: string;
      if (msg.role === 'user') {
        const parsed = parseUserContent(msg.content);
        line = `[${roleLabel}]: ${parsed.text}`;
        if (parsed.images) {
          for (const img of parsed.images) {
            line += `\n  (Image: ${img.path})`;
          }
        }
      } else {
        const text = msg.role === 'assistant' ? extractTextFromContent(msg.content) : msg.content;
        line = `[${roleLabel}]: ${text}`;
      }
      conversationLines.push(line);
    }

    let prompt = '';
    if (conversationLines.length > 0) {
      prompt += '## Conversation History\n\n' + conversationLines.join('\n\n') + '\n\n---\n\n';
    }
    let userPart = message.trim()
      ? `[User]: ${message}`
      : '[User]: (see attached images)';
    // Include image paths so the agent can Read them
    if (imageRefs && imageRefs.length > 0) {
      for (const img of imageRefs) {
        userPart += `\n  (Image attached: ${img.path})`;
      }
      userPart += '\n\nIMPORTANT: The user attached image(s). Use the Read tool to view them at the paths above.';
    }
    prompt += `${userPart}\n\nRespond to the latest user message.`;

    // Run agent in background, return completion promise
    const abortController = new AbortController();
    this.runningControllers.set(sessionId, abortController);

    const completion = this.runAgent(sessionId, projectPath, systemPrompt, prompt, abortController, agentLibName, emitEvent, images, sessionModel, { pipelineSessionId, resumeSession, mode }).catch((err) => {
      // Safety net: errors should be handled inside runAgent, but recover if one escapes
      getAppLogger().logError('ChatAgentService', `Unhandled error escaped runAgent for session ${sessionId}`, err);
      try { emitEvent({ type: 'text', text: `\nError: ${err instanceof Error ? err.message : String(err)}\n` }); } catch { /* best effort */ }
      try { emitEvent({ type: 'text', text: CHAT_COMPLETE_SENTINEL }); } catch { /* best effort */ }
      const agent = this.runningAgents.get(sessionId);
      if (agent && agent.status === 'running') {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
      this.runningControllers.delete(sessionId);
    });

    return { userMessage, sessionId, completion };
  }

  stopAll(): void {
    const sessionIds = [...this.runningControllers.keys()];
    if (sessionIds.length === 0) return;

    getAppLogger().info('ChatAgentService', `Stopping ${sessionIds.length} running chat agent(s)`);
    for (const sessionId of sessionIds) {
      try {
        this.stop(sessionId);
      } catch (err) {
        getAppLogger().warn('ChatAgentService', `Failed to stop chat agent session ${sessionId}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  stop(sessionId: string): void {
    const controller = this.runningControllers.get(sessionId);
    if (controller) {
      getAppLogger().info('ChatAgentService', `Stopping chat agent for session ${sessionId}`);
      // Immediately reflect stop in agent status so UI doesn't show stale "running"
      const agent = this.runningAgents.get(sessionId);
      if (agent && agent.status === 'running') {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
      controller.abort();
      // runAgent's finally block handles runningControllers cleanup and sentinel emission
    } else {
      getAppLogger().warn('ChatAgentService', `No running controller found for session ${sessionId}`);
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.chatMessageStore.getMessagesForSession(sessionId);
  }

  async clearMessages(sessionId: string): Promise<void> {
    this.stop(sessionId);
    return this.chatMessageStore.clearMessages(sessionId);
  }

  async summarizeMessages(sessionId: string): Promise<ChatMessage[]> {
    this.stop(sessionId);

    const messages = await this.chatMessageStore.getMessagesForSession(sessionId);
    if (messages.length === 0) return [];

    // Sum historical costs from existing messages
    let historicalInputTokens = 0;
    let historicalOutputTokens = 0;
    for (const m of messages) {
      historicalInputTokens += m.costInputTokens ?? 0;
      historicalOutputTokens += m.costOutputTokens ?? 0;
    }

    // Build a summarization prompt
    const conversationText = messages.map((m) => {
      const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
      const text = m.role === 'user' ? parseUserContent(m.content).text
        : m.role === 'assistant' ? extractTextFromContent(m.content) : m.content;
      return `[${roleLabel}]: ${text}`;
    }).join('\n\n');

    const summaryPrompt = `Summarize the following conversation concisely. Capture key topics discussed, decisions made, and important context. Output only the summary text, nothing else.\n\n${conversationText}`;

    let summaryText = '';
    let summaryCostInput: number | undefined;
    let summaryCostOutput: number | undefined;
    try {
      await this.runSdkQuery(summaryPrompt, { maxTurns: 1 }, {
        onText: (text) => { summaryText += text; },
        onResult: (msg) => {
          summaryCostInput = msg.usage?.input_tokens;
          summaryCostOutput = msg.usage?.output_tokens;
        },
      });
    } catch (err) {
      summaryText = `[Summary generation failed: ${err instanceof Error ? err.message : String(err)}]\n\nOriginal conversation had ${messages.length} messages.`;
    }

    if (!summaryText.trim()) {
      summaryText = `Conversation summary: ${messages.length} messages exchanged.`;
    }

    // Combine historical costs + summarization costs onto the summary message
    const totalInputTokens = historicalInputTokens + (summaryCostInput ?? 0);
    const totalOutputTokens = historicalOutputTokens + (summaryCostOutput ?? 0);

    const result = await this.chatMessageStore.replaceAllMessages(sessionId, [
      {
        sessionId,
        role: 'system',
        content: `[Conversation Summary]\n\n${summaryText}`,
        costInputTokens: totalInputTokens || undefined,
        costOutputTokens: totalOutputTokens || undefined,
      },
    ]);

    return result;
  }

  async getRunningAgents(): Promise<RunningAgent[]> {
    // Clean up stale agents (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [sessionId, agent] of this.runningAgents) {
      if (agent.status !== 'running' && agent.lastActivity < oneHourAgo) {
        this.runningAgents.delete(sessionId);
      }
    }
    return Array.from(this.runningAgents.values());
  }

  private async resolveScope(session: { scopeType: string; scopeId: string }): Promise<{
    projectPath: string;
    projectId: string;
    projectName: string;
    projectDefaultAgentLib?: string;
  }> {
    if (session.scopeType === 'task') {
      const task = await this.taskStore.getTask(session.scopeId);
      if (!task) throw new Error(`Task not found: ${session.scopeId}`);
      const project = await this.projectStore.getProject(task.projectId);
      if (!project?.path) throw new Error(`Project not found or has no path for task: ${session.scopeId}`);
      return {
        projectPath: project.path,
        projectId: task.projectId,
        projectName: project.name,
        projectDefaultAgentLib: project.config?.defaultAgentLib as string | undefined,
      };
    }

    if (session.scopeType !== 'project') {
      throw new Error(`Unknown scope type: ${session.scopeType}`);
    }

    // Project scope
    const project = await this.projectStore.getProject(session.scopeId);
    if (!project?.path) throw new Error(`Project not found or has no path: ${session.scopeId}`);
    return {
      projectPath: project.path,
      projectId: session.scopeId,
      projectName: project.name,
      projectDefaultAgentLib: project.config?.defaultAgentLib as string | undefined,
    };
  }

  private async runAgent(
    sessionId: string,
    projectPath: string,
    systemPrompt: string,
    prompt: string,
    abortController: AbortController,
    agentLibName: string,
    emitEvent: (event: ChatAgentEvent) => void,
    images?: ChatImage[],
    model?: string,
    extra?: { pipelineSessionId?: string; resumeSession?: boolean; mode?: AgentChatMode },
  ): Promise<void> {
    getAppLogger().info('ChatAgentService', `runAgent() starting for session ${sessionId}`, { agentLibName, projectPath });

    const imageDir = this.imageStorageDir;

    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    const turnMessages: AgentChatMessage[] = [];

    // Safe wrapper: emit both event types from a single AgentChatMessage
    const emitMessage = (msg: AgentChatMessage) => {
      emitEvent({ type: 'message', message: msg });
      // Update last activity
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.lastActivity = Date.now();
      }
      // Collect all messages except usage (stored in row-level cost fields)
      if (msg.type !== 'usage') {
        turnMessages.push(msg);
      }
    };

    // Wrapper that emits both a text event and a message event for text
    const emitText = (text: string) => {
      emitEvent({ type: 'text', text });
      emitMessage({ type: 'assistant_text', text, timestamp: Date.now() });
    };

    try {
      const lib = this.agentLibRegistry.getLib(agentLibName);
      const features = lib.supportedFeatures();

      // Warn if engine doesn't support native images (file paths are still in the prompt)
      if (images && images.length > 0 && !features.images) {
        const warning = `\n[Note: Images are sent as file paths with the ${agentLibName} engine. The agent will use the Read tool to view them.]\n`;
        emitText(warning);
      }

      // Wire abort signal to AgentLib.stop() so the Stop button works
      abortController.signal.addEventListener('abort', () => {
        lib.stop(sessionId).catch(err => getAppLogger().warn('ChatAgentService', 'Failed to stop agent lib', { error: err instanceof Error ? err.message : String(err) }));
      });

      // Build preToolUse hook that hard-blocks write tools
      const preToolUse = features.hooks
        ? (toolName: string, _toolInput: Record<string, unknown>) => {
            if (WRITE_TOOL_NAMES.has(toolName)) {
              return { decision: 'block' as const, reason: 'Chat agent has read-only access. File modifications are not allowed.' };
            }
            return undefined;
          }
        : undefined;

      // Build callbacks
      const callbacks: AgentLibCallbacks = {
        onOutput: (chunk: string) => {
          emitEvent({ type: 'text', text: chunk });
        },
        onMessage: (msg: AgentChatMessage) => {
          emitMessage(msg);
        },
        onUserToolResult: (toolUseId: string, content: string) => {
          emitMessage({
            type: 'tool_result',
            toolId: toolUseId,
            result: content,
            timestamp: Date.now(),
          });
        },
      };

      // Build images array for libs that support native images
      const libImages = (features.images && images && images.length > 0)
        ? images.map((img) => ({ base64: img.base64, mediaType: img.mediaType }))
        : undefined;

      // When resuming a pipeline agent session, use its sessionId for the execute call
      const executeSessionId = extra?.pipelineSessionId ?? sessionId;

      const result = await lib.execute(executeSessionId, {
        prompt: `${systemPrompt}\n\n${prompt}`,
        cwd: projectPath,
        model,
        maxTurns: 50,
        timeoutMs: 300000,
        allowedPaths: [],
        readOnlyPaths: [projectPath, imageDir],
        readOnly: true,
        ...(extra?.resumeSession ? { resumeSession: true } : {}),
        ...(preToolUse ? { hooks: { preToolUse } } : {}),
        ...(libImages ? { images: libImages } : {}),
      }, callbacks);

      if (result.costInputTokens != null || result.costOutputTokens != null) {
        emitMessage({
          type: 'usage',
          inputTokens: result.costInputTokens ?? 0,
          outputTokens: result.costOutputTokens ?? 0,
          timestamp: Date.now(),
        });
      }

      costInputTokens = result.costInputTokens;
      costOutputTokens = result.costOutputTokens;

      if (result.error) {
        emitEvent({ type: 'text', text: `\n[Agent error: ${result.error}]\n` });
        emitMessage({ type: 'assistant_text', text: `\n[Agent error: ${result.error}]\n`, timestamp: Date.now() });
      }

      // Mark as completed successfully
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.status = 'completed';
        agent.lastActivity = Date.now();
      }
    } catch (err) {
      // Handle errors inside runAgent so the sentinel in finally is always the last event
      const errMsg = err instanceof Error ? err.message : String(err);
      // Use the abort controller signal as source of truth (works regardless of error type)
      if (abortController.signal.aborted) {
        getAppLogger().info('ChatAgentService', `Chat agent aborted for session ${sessionId}`);
      } else {
        getAppLogger().logError('ChatAgentService', `Chat agent error for session ${sessionId}`, err);
        emitEvent({ type: 'text', text: `\nError: ${errMsg}\n` });
      }
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
    } finally {
      this.runningControllers.delete(sessionId);

      // Clean up completed agent after a delay to allow UI to show completion status
      setTimeout(() => {
        const agent = this.runningAgents.get(sessionId);
        if (agent && agent.status !== 'running') {
          this.runningAgents.delete(sessionId);
        }
      }, 5000); // 5 second delay

      // Persist assistant response with cost data (full structured messages as JSON)
      if (turnMessages.length > 0) {
        try {
          await this.chatMessageStore.addMessage({
            sessionId,
            role: 'assistant',
            content: JSON.stringify(turnMessages),
            costInputTokens,
            costOutputTokens,
          });
        } catch (persistErr) {
          getAppLogger().logError('ChatAgentService', 'Failed to persist assistant response', persistErr);
          try { emitEvent({ type: 'text', text: '\n[Warning: Failed to save this response. It may not appear after refresh.]\n' }); } catch (deliveryErr) { getAppLogger().warn('ChatAgentService', 'persist-warning delivery failed', { error: deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr) }); }
        }

        // Post-process "changes" mode: extract revised plan/design from JSON response
        if (extra?.mode === 'changes') {
          const fullText = turnMessages
            .filter(m => m.type === 'assistant_text')
            .map(m => m.text)
            .join('');

          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(fullText);
          } catch (parseErr) {
            getAppLogger().warn('ChatAgentService', 'Failed to parse changes-mode JSON response; plan not updated', { error: parseErr instanceof Error ? parseErr.message : String(parseErr) });
          }

          if (parsed) {
            try {
              const session = await this.chatSessionStore.getSession(sessionId);
              if (!session?.agentRole) {
                getAppLogger().warn('ChatAgentService', `changes-mode: session ${sessionId} has no agentRole; cannot update task`);
              } else {
                const field = session.agentRole === 'designer' ? 'technicalDesign' : 'plan';
                const revisedContent = parsed.revisedDesign ?? parsed.revisedPlan;
                if (!revisedContent || typeof revisedContent !== 'string') {
                  getAppLogger().warn('ChatAgentService', `changes-mode: agent response missing or non-string revisedDesign/revisedPlan for session ${sessionId}`);
                  try { emitEvent({ type: 'text', text: '\n[Warning: Agent response did not contain a valid revised plan/design. No update was made.]\n' }); } catch (deliveryErr) { getAppLogger().warn('ChatAgentService', 'delivery failed', { error: deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr) }); }
                } else if (session.scopeType !== 'task') {
                  getAppLogger().warn('ChatAgentService', `changes-mode: session ${sessionId} scopeType is '${session.scopeType}', not 'task'; skipping update`);
                } else {
                  await this.taskStore.updateTask(session.scopeId, { [field]: revisedContent } as import('../../shared/types').TaskUpdateInput);
                  getAppLogger().info('ChatAgentService', `Updated task ${session.scopeId} ${field} via agent-chat changes mode`);
                }
              }
            } catch (dbErr) {
              getAppLogger().logError('ChatAgentService', `Failed to persist revised content for session ${sessionId}`, dbErr);
              try { emitEvent({ type: 'text', text: '\n[Warning: The revised content was generated but could not be saved to the task.]\n' }); } catch (deliveryErr) { getAppLogger().warn('ChatAgentService', 'delivery failed', { error: deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr) }); }
            }
          }
        }
      }

      // Signal completion to renderer so it can reset streaming state
      getAppLogger().info('ChatAgentService', `Chat agent finished for session ${sessionId}, sending completion sentinel`);
      emitEvent({ type: 'text', text: CHAT_COMPLETE_SENTINEL });
    }
  }

  /**
   * Loads the SDK `query()` function, iterates over the resulting async
   * stream, and dispatches events to the provided callbacks.
   * Used by `summarizeMessages` for one-shot summarization queries.
   */
  private async runSdkQuery(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: Record<string, unknown>,
    callbacks: SdkQueryCallbacks,
  ): Promise<void> {
    const query = await this.loadQuery();

    for await (const message of query({ prompt, options })) {
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage;
        if (assistantMsg.error) {
          callbacks.onText?.(`\n[Agent error: ${assistantMsg.error}]\n`);
        }
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            callbacks.onText?.((block as { text: string }).text);
          } else if (block.type === 'thinking') {
            callbacks.onThinking?.((block as { thinking: string }).thinking);
          } else if (block.type === 'tool_use') {
            callbacks.onToolUse?.(block as { type: 'tool_use'; name: string; id?: string; input?: unknown });
          }
        }
      } else if (message.type === 'result') {
        callbacks.onResult?.(message as SDKResultMessage);
      } else if (message.type === 'user') {
        // SDK emits tool results as SDKUserMessage with tool_result content blocks
        const userMsg = message as SDKUserMessage;
        const content = userMsg.message?.content;
        if (!content || typeof content === 'string') {
          getAppLogger().warn('ChatAgentService', 'user message with unexpected structure', { preview: JSON.stringify(message).slice(0, 200) });
        } else {
          for (const block of content) {
            const b = block as { type: string; tool_use_id?: string; content?: unknown };
            if (b.type === 'tool_result' && b.tool_use_id) {
              const resultContent = typeof b.content === 'string' ? b.content
                : (Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text || '').join('') : '(no output)');
              callbacks.onUserToolResult?.(b.tool_use_id, resultContent);
            }
          }
        }
      }
      // Other message types (status, system, etc.) are intentionally skipped
    }
  }

  private async loadQuery(): Promise<(opts: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SDKMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    if (typeof mod.query !== 'function') {
      throw new Error('Claude Agent SDK loaded but "query" export is missing. Ensure @anthropic-ai/claude-agent-sdk is installed and up to date.');
    }
    return mod.query as (opts: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SDKMessage>;
  }
}
