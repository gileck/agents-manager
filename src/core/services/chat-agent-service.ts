import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ChatMessage, AgentChatMessage, ChatImage, ChatImageRef, ChatSendOptions, ChatSendResult, ChatAgentEvent } from '../../shared/types';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { AgentLibCallbacks } from '../interfaces/agent-lib';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources';
import type { SessionScope } from './chat-prompt-parts';
import { SandboxGuard } from './sandbox-guard';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppLogger } from './app-logger';

const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

/** Callbacks from runSdkQuery for each message type. */
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

  async send(
    sessionId: string,
    message: string,
    options: ChatSendOptions,
  ): Promise<ChatSendResult> {
    const { systemPrompt, onEvent, images } = options;

    // Get session to find scope
    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Don't abort previous running chat - allow parallel execution
    // but do check if there's already one running for this session
    if (this.runningControllers.has(sessionId)) {
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
      emitEvent({ type: 'text', text: `\n[Warning: Agent engine "${agentLibName}" is not available. Falling back to "${DEFAULT_AGENT_LIB}".]\n` });
      agentLibName = DEFAULT_AGENT_LIB;
    }

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

    const completion = this.runAgent(sessionId, projectPath, systemPrompt, prompt, abortController, agentLibName, emitEvent, images).catch((err) => {
      // runningControllers already cleaned up by runAgent's finally block
      emitEvent({ type: 'text', text: `\nError: ${err instanceof Error ? err.message : String(err)}\n` });
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
      // Clean up failed agent after a delay
      setTimeout(() => {
        const agent = this.runningAgents.get(sessionId);
        if (agent && agent.status === 'failed') {
          this.runningAgents.delete(sessionId);
        }
      }, 5000);
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
      controller.abort();
      this.runningControllers.delete(sessionId);
      const agent = this.runningAgents.get(sessionId);
      if (agent && agent.status === 'running') {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
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
  ): Promise<void> {
    // Determine whether to use the AgentLib abstraction or the direct SDK
    const useAgentLib = agentLibName !== DEFAULT_AGENT_LIB;

    // Set up sandbox: read-only access to project path + image storage dir, block write tools
    const imageDir = this.imageStorageDir;
    const sandboxGuard = new SandboxGuard([], [projectPath, imageDir]);

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
      if (useAgentLib) {
        // Use AgentLib abstraction for non-claude-code engines
        if (images && images.length > 0) {
          const warning = `\n[Note: Images are sent as file paths with the ${agentLibName} engine. The agent will use the Read tool to view them.]\n`;
          emitText(warning);
        }
        // Wire abort signal to AgentLib.stop() so the Stop button works
        const lib = this.agentLibRegistry.getLib(agentLibName);
        abortController.signal.addEventListener('abort', () => {
          lib.stop(sessionId).catch(err => getAppLogger().warn('ChatAgentService', 'Failed to stop agent lib', { error: err instanceof Error ? err.message : String(err) }));
        });
        await this.runViaAgentLib(lib, sessionId, projectPath, systemPrompt, prompt, emitEvent, emitMessage);
      } else {
        // Use direct SDK for claude-code (preserves existing rich streaming behavior)
        await this.runViaDirectSdk(sessionId, projectPath, systemPrompt, prompt, abortController, sandboxGuard, emitEvent, emitMessage, (input, output) => {
          costInputTokens = input;
          costOutputTokens = output;
        }, images);
      }

      // Mark as completed successfully
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.status = 'completed';
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
      }
    }
  }

  private async runViaAgentLib(
    lib: import('../interfaces/agent-lib').IAgentLib,
    sessionId: string,
    projectPath: string,
    systemPrompt: string,
    prompt: string,
    emitEvent: (event: ChatAgentEvent) => void,
    emitMessage: (msg: AgentChatMessage) => void,
  ): Promise<void> {

    const callbacks: AgentLibCallbacks = {
      onOutput: (chunk: string) => {
        emitEvent({ type: 'text', text: chunk });
        emitMessage({ type: 'assistant_text', text: chunk, timestamp: Date.now() });
      },
      onMessage: (msg: AgentChatMessage) => {
        emitMessage(msg);
      },
    };

    const result = await lib.execute(sessionId, {
      prompt: `${systemPrompt}\n\n${prompt}`,
      cwd: projectPath,
      maxTurns: 50,
      timeoutMs: 300000,
      allowedPaths: [],
      readOnlyPaths: [projectPath],
      readOnly: true,
    }, callbacks);

    if (result.costInputTokens != null && result.costOutputTokens != null) {
      emitMessage({
        type: 'usage',
        inputTokens: result.costInputTokens,
        outputTokens: result.costOutputTokens,
        timestamp: Date.now(),
      });
    }

    if (result.error) {
      emitEvent({ type: 'text', text: `\n[Agent error: ${result.error}]\n` });
      emitMessage({ type: 'assistant_text', text: `\n[Agent error: ${result.error}]\n`, timestamp: Date.now() });
    }
  }

  private async runViaDirectSdk(
    sessionId: string,
    projectPath: string,
    systemPrompt: string,
    prompt: string,
    abortController: AbortController,
    sandboxGuard: SandboxGuard,
    emitEvent: (event: ChatAgentEvent) => void,
    emitMessage: (msg: AgentChatMessage) => void,
    onCost: (input: number | undefined, output: number | undefined) => void,
    images?: ChatImage[],
  ): Promise<void> {
    const fullPromptText = `${systemPrompt}\n\n${prompt}`;

    // Build multimodal prompt when images are present, otherwise use string
    let sdkPrompt: string | AsyncIterable<SDKUserMessage>;
    if (images && images.length > 0) {
      const contentBlocks = [
        { type: 'text' as const, text: fullPromptText },
        ...images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
        })),
      ];
      const userMessage: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: contentBlocks } as MessageParam,
        parent_tool_use_id: null,
        session_id: sessionId,
      };
      sdkPrompt = (async function* () { yield userMessage; })();
    } else {
      sdkPrompt = fullPromptText;
    }

    await this.runSdkQuery(
      sdkPrompt,
      {
        cwd: projectPath,
        abortController,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 50,
        hooks: {
          preToolUse: (toolName: string, toolInput: Record<string, unknown>) => {
            // Hard-block write tools
            if (WRITE_TOOL_NAMES.has(toolName)) {
              return { decision: 'block', reason: 'Chat agent has read-only access. File modifications are not allowed.' };
            }
            const result = sandboxGuard.evaluateToolCall(toolName, toolInput);
            if (!result.allow) {
              return { decision: 'block', reason: result.reason };
            }
            return undefined;
          },
        },
      },
      {
        onText: (text) => {
          emitEvent({ type: 'text', text });
          emitMessage({ type: 'assistant_text', text, timestamp: Date.now() });
        },
        onThinking: (text) => {
          emitMessage({ type: 'thinking', text, timestamp: Date.now() });
        },
        onToolUse: (block) => {
          const toolSummary = `\n> Tool: ${block.name}\n`;
          emitEvent({ type: 'text', text: toolSummary });
          emitMessage({
            type: 'tool_use',
            toolName: block.name,
            toolId: block.id,
            input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}, null, 2),
            timestamp: Date.now(),
          });
        },
        onResult: (resultMsg) => {
          if (resultMsg.subtype !== 'success') {
            const errorText = `\n[Agent errors: ${resultMsg.errors.join('; ')}]\n`;
            emitEvent({ type: 'text', text: errorText });
            emitMessage({ type: 'assistant_text', text: errorText, timestamp: Date.now() });
          }
          const costIn = resultMsg.usage?.input_tokens;
          const costOut = resultMsg.usage?.output_tokens;
          onCost(costIn, costOut);
          if (costIn != null && costOut != null) {
            emitMessage({
              type: 'usage',
              inputTokens: costIn,
              outputTokens: costOut,
              timestamp: Date.now(),
            });
          }
        },
        onUserToolResult: (toolUseId, content) => {
          emitMessage({
            type: 'tool_result',
            toolId: toolUseId,
            result: content,
            timestamp: Date.now(),
          });
        },
      },
    );
  }

  /**
   * Shared helper that loads the SDK `query()` function, iterates over
   * the resulting async stream, and dispatches events to the provided
   * callbacks. Used by both `runViaDirectSdk` (chat) and
   * `summarizeMessages` (one-shot summarization) to avoid duplicating
   * the SDK message loop.
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
