import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ChatMessage, AgentChatMessage, ChatImage, ChatImageRef, ChatSendOptions, ChatSendResult, ChatAgentEvent, ChatSession, PermissionMode } from '../../shared/types';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { AgentLibCallbacks, SubagentDefinition, IAgentLib } from '../interfaces/agent-lib';
import type { GenericMcpToolDefinition } from '../interfaces/mcp-tool';
import type { AgentSubscriptionRegistry } from './agent-subscription-registry';
import type { SessionScope } from './chat-prompt-parts';
import { buildAgentChatSystemPrompt, buildDesktopSystemPrompt } from './chat-prompt-parts';
import { createTaskMcpServer } from '../mcp/task-mcp-server';
import { resizeImages } from '../libs/image-utils';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppLogger } from './app-logger';

/** Parse a user message content field that may be a JSON envelope with images and/or metadata. */
function parseUserContent(content: string): { text: string; images?: ChatImageRef[]; metadata?: Record<string, unknown> } {
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        const images = Array.isArray(parsed.images) && parsed.images.length > 0
          ? (parsed.images as ChatImageRef[])
          : undefined;
        const metadata = parsed.metadata && typeof parsed.metadata === 'object'
          ? (parsed.metadata as Record<string, unknown>)
          : undefined;
        return { text: parsed.text, images, metadata };
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

const _BASH_TOOL_NAMES = new Set(['Bash']);

function isDefaultSessionName(name: string): boolean {
  return name === 'General' || /^Session \d+$/.test(name);
}

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

interface InjectedMessage {
  sessionId: string;
  content: string;
  metadata: Record<string, unknown>;
  queuedAt: number;
}

/** Parse plugins config from project config into typed array. */
function parsePluginsConfig(raw: unknown): Array<{ type: 'local'; path: string }> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const valid = raw.filter(
    (p): p is { type: 'local'; path: string } =>
      p && typeof p === 'object' && p.type === 'local' && typeof p.path === 'string',
  );
  return valid.length > 0 ? valid : undefined;
}

const DEFAULT_AGENT_LIB = 'claude-code';
const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

/**
 * Default subagent definitions for thread chat sessions.
 * These specialized subagents are available via the Task tool when running in
 * thread chat mode (desktop/telegram/cli sessions, not agent-chat or pipeline).
 */
const DEFAULT_CHAT_SUBAGENTS: Record<string, SubagentDefinition> = {
  'code-reviewer': {
    description: 'Specialized for reviewing code changes. Delegates to this agent when asked to review diffs, PRs, or code quality.',
    prompt: 'You are a code review specialist. Analyze code changes for correctness, best practices, potential bugs, security issues, and readability. Provide specific, actionable feedback with file paths and line references.',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    model: 'sonnet',
    maxTurns: 15,
  },
  'researcher': {
    description: 'Specialized for codebase exploration and research. Delegates to this agent for understanding architecture, finding patterns, or investigating how things work.',
    prompt: 'You are a codebase research specialist. Explore the codebase to answer questions about architecture, patterns, dependencies, and implementation details. Be thorough in your search and provide comprehensive findings with relevant file paths.',
    tools: ['Read', 'Glob', 'Grep'],
    model: 'sonnet',
    maxTurns: 20,
  },
  'test-runner': {
    description: 'Specialized for running and analyzing tests. Delegates to this agent when asked to run tests, analyze test results, or investigate test failures.',
    prompt: 'You are a test execution and analysis specialist. Run tests, analyze results, identify failures, and provide clear summaries. When tests fail, investigate the root cause and suggest fixes.',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    model: 'haiku',
    maxTurns: 10,
  },
};

function tagNestedSubagentMessage(message: AgentChatMessage, parentToolUseId: string): AgentChatMessage | null {
  switch (message.type) {
    case 'assistant_text':
    case 'thinking':
    case 'tool_use':
    case 'tool_result':
      return {
        ...message,
        parentToolUseId,
      };
    case 'status':
    case 'agent_run_info':
      return null;
    default:
      return message;
  }
}

export class ChatAgentService {
  private runningControllers = new Map<string, AbortController>();
  private runningAgents = new Map<string, RunningAgent>();
  private liveTurnMessages = new Map<string, AgentChatMessage[]>();
  private imageStorageDir: string;
  private injectedQueue = new Map<string, InjectedMessage[]>();
  private injectedEventHandler?: (sessionId: string) => ((event: ChatAgentEvent) => void) | undefined;
  /** Sessions that were compacted — next sendMessage() should skip SDK resume. */
  private compactedSessions = new Set<string>();
  /** Maps sessionId → executeSessionId (runId) used by the agent lib for injection routing. */
  private runningRunIds = new Map<string, string>();
  private pendingQuestions = new Map<string, {
    resolve: (answers: Record<string, string>) => void;
    reject: (err: Error) => void;
    sessionId: string;
  }>();
  constructor(
    private chatMessageStore: IChatMessageStore,
    private chatSessionStore: IChatSessionStore,
    private projectStore: IProjectStore,
    private taskStore: ITaskStore,
    private pipelineStore: IPipelineStore,
    private agentLibRegistry: AgentLibRegistry,
    private agentRunStore: IAgentRunStore,
    private getDefaultAgentLib: () => string = () => DEFAULT_AGENT_LIB,
    private getDefaultModel: () => string | null = () => null,
    private getDefaultPermissionMode: () => PermissionMode | null = () => null,
    imageStorageDir?: string,
    private subscriptionRegistry?: AgentSubscriptionRegistry,
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
    let project: Awaited<ReturnType<typeof this.projectStore.getProject>> | undefined;
    if (scopeType === 'project') {
      project = await this.projectStore.getProject(scopeId);
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
      project = await this.projectStore.getProject(projectId);
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

    // Apply project-level default permission mode to new sessions
    const defaultPermissionMode = (project?.config?.defaultPermissionMode as PermissionMode | undefined) ?? this.getDefaultPermissionMode() ?? undefined;

    return this.chatSessionStore.createSession({
      scopeType: scopeType as 'project' | 'task',
      scopeId,
      name: name.trim(),
      agentLib,
      projectId,
      permissionMode: defaultPermissionMode,
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
    const project = await this.projectStore.getProject(task.projectId);
    const defaultPermissionMode = (project?.config?.defaultPermissionMode as PermissionMode | undefined) ?? this.getDefaultPermissionMode() ?? undefined;
    const session = await this.chatSessionStore.createSession({
      scopeType: 'task',
      scopeId: taskId,
      name: 'Task Chat',
      projectId: task.projectId,
      permissionMode: defaultPermissionMode,
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

    const project = await this.projectStore.getProject(task.projectId);
    const defaultPermissionMode = (project?.config?.defaultPermissionMode as PermissionMode | undefined) ?? this.getDefaultPermissionMode() ?? undefined;

    const roleName = agentRole.charAt(0).toUpperCase() + agentRole.slice(1);
    return this.chatSessionStore.createSession({
      scopeType: 'task',
      scopeId: taskId,
      name: `Chat with ${roleName}`,
      source: 'agent-chat',
      agentRole,
      projectId: task.projectId,
      permissionMode: defaultPermissionMode,
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
   * Agent-chat sessions get agent-role-specific prompts and pipeline session resume;
   * regular sessions get the standard desktop prompt.
   *
   * When the session has a `systemPromptAppend`, the system prompt is returned as a
   * preset object so the SDK auto-loads its default prompt and appends the combined
   * instructions (built prompt + user's custom append).
   */
  async buildSendContext(sessionId: string): Promise<{
    systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string };
    pipelineSessionId?: string;
    resumeSession?: boolean;
    isAgentChat?: boolean;
    permissionMode: PermissionMode | null;
  }> {
    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const scope = await this.getSessionScope(sessionId);

    if (session.source === 'agent-chat' && session.agentRole) {
      // Look up the last completed agent run for this task+agent to resume its session
      const runs = await this.agentRunStore.getRunsForTask(session.scopeId);
      const lastCompleted = runs.find(r => r.agentType === session.agentRole && r.status === 'completed');
      if (!lastCompleted) {
        getAppLogger().warn('ChatAgentService', `No prior completed ${session.agentRole} run found for task ${session.scopeId} — agent chat will not resume session`);
      }
      const basePrompt = buildAgentChatSystemPrompt(scope, session.agentRole);
      return {
        systemPrompt: this.buildSystemPromptWithAppend(basePrompt, session.systemPromptAppend),
        pipelineSessionId: lastCompleted?.id,
        resumeSession: !!lastCompleted,
        isAgentChat: true,
        permissionMode: session.permissionMode,
      };
    }

    const basePrompt = buildDesktopSystemPrompt(scope);
    return {
      systemPrompt: this.buildSystemPromptWithAppend(basePrompt, session.systemPromptAppend),
      permissionMode: session.permissionMode,
    };
  }

  /**
   * Always uses the `preset: "claude_code"` SDK system prompt so thread chat
   * retains the full Claude Code CLI behavioral context (git safety, tool usage,
   * security rules, environment context, etc.).
   *
   * The built `basePrompt` (orchestrator/chat instructions) is placed in `append`
   * so it follows the preset base. When the session also has a custom
   * `systemPromptAppend`, that is appended last after a separator.
   */
  private buildSystemPromptWithAppend(
    basePrompt: string,
    systemPromptAppend: string | null,
  ): { type: 'preset'; preset: 'claude_code'; append?: string } {
    const append = systemPromptAppend?.trim()
      ? `${basePrompt}\n\n--- Custom Instructions ---\n${systemPromptAppend.trim()}`
      : basePrompt;

    return { type: 'preset', preset: 'claude_code', append };
  }

  async send(
    sessionId: string,
    message: string,
    options: ChatSendOptions,
  ): Promise<ChatSendResult> {
    const { systemPrompt, onEvent, images: rawImages, pipelineSessionId, resumeSession, isAgentChat, permissionMode } = options;

    getAppLogger().info('ChatAgentService', `send() called for session ${sessionId}`, { messageLength: message.length, hasImages: !!(rawImages?.length) });

    // Get session to find scope
    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // If an agent is already running, try mid-execution injection when supported
    if (this.runningControllers.has(sessionId)) {
      // Check if injection is possible: lib supports streamingInput AND session toggle is on
      const agentLibName = session.agentLib || this.getDefaultAgentLib() || DEFAULT_AGENT_LIB;
      const lib = this.agentLibRegistry.listNames().includes(agentLibName)
        ? this.agentLibRegistry.getLib(agentLibName)
        : null;
      const supportsInjection = lib?.supportedFeatures().streamingInput && session.enableStreamingInput;

      if (supportsInjection && lib) {
        const runId = this.runningRunIds.get(sessionId);
        if (!runId) {
          getAppLogger().warn('ChatAgentService', `Injection failed: no runId mapped for session ${sessionId}`);
          throw new Error('An agent is already running for this session');
        }

        getAppLogger().info('ChatAgentService', `Injecting message into running session ${sessionId} (runId=${runId})`);

        // Resize images up-front (needed for both injection and DB persistence)
        const resizedImages = (rawImages && rawImages.length > 0) ? await resizeImages(rawImages) : undefined;

        // Build injection images (base64 + mediaType for the agent lib)
        const injectionImages = resizedImages?.map(img => ({ base64: img.base64, mediaType: img.mediaType }));

        // Attempt injection BEFORE persisting to DB to avoid orphaned messages
        const injected = lib.injectMessage(runId, message, injectionImages);
        if (!injected) {
          getAppLogger().warn('ChatAgentService', `Injection failed (channel closed race) for session ${sessionId}`);
          throw new Error('Message injection failed — the agent may have just finished. Please try again.');
        }

        // Persist any assistant messages accumulated before this injection so they
        // aren't lost if the page reloads before the agent finishes (Bug 4 fix).
        // Snapshot and clear are synchronous — no interleaving with emitMessage.
        const currentTurnMessages = this.liveTurnMessages.get(sessionId);
        if (currentTurnMessages && currentTurnMessages.length > 0) {
          const snapshot = [...currentTurnMessages];
          currentTurnMessages.length = 0;
          try {
            await this.chatMessageStore.addMessage({
              sessionId,
              role: 'assistant',
              content: JSON.stringify(snapshot),
            });
          } catch (persistErr) {
            // Restore on failure to avoid data loss
            currentTurnMessages.unshift(...snapshot);
            getAppLogger().logError('ChatAgentService', 'Failed to persist pre-injection assistant messages', persistErr);
          }
        }

        // Persist user message to DB only after successful injection
        const imageRefs = resizedImages
          ? await saveImagesToDisk(sessionId, resizedImages, this.imageStorageDir)
          : undefined;
        const userContent = imageRefs
          ? JSON.stringify({ text: message, images: imageRefs })
          : message;
        const userMessage = await this.chatMessageStore.addMessage({
          sessionId,
          role: 'user',
          content: userContent,
        });

        // Bug 1+2 fix: Do NOT emit user message via WebSocket here.
        // The REST response already delivers the user message to the sender,
        // and the normal send path also does not broadcast user messages via WS.
        // Emitting here caused duplicates (streamingMessages + dbMessages) and
        // the emitted message was missing image refs.

        return {
          userMessage,
          sessionId,
          completion: Promise.resolve(),
          injected: true,
        };
      }

      getAppLogger().warn('ChatAgentService', `Rejecting send: agent already running for session ${sessionId}`);
      throw new Error('An agent is already running for this session');
    }

    // Downscale images that exceed the API dimension limit (2000px)
    const images = (rawImages && rawImages.length > 0)
      ? await resizeImages(rawImages)
      : rawImages;

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
    const { projectPath, projectId, projectName, projectDefaultAgentLib, projectPlugins } = await this.resolveScope(session);

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

    // Resolve model: session > global default > engine default
    const sessionModel = session.model || this.getDefaultModel() || undefined;

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

    // Load conversation history to detect whether this is a follow-up message.
    // Instead of manually replaying history (the SDK rejects assistant-role messages
    // in the AsyncIterable prompt), we use native SDK session resume on follow-ups.
    // After compaction, skip resume to start a fresh SDK session (old session may
    // contain oversized images or stale context that would cause errors).
    const wasCompacted = this.compactedSessions.delete(sessionId);
    const history = await this.chatMessageStore.getMessagesForSession(sessionId);
    const hasHistory = history.length > 1; // more than just the current user message
    const shouldResume = wasCompacted ? false : (resumeSession || hasHistory);

    // Detect slash commands — the SDK handles them natively when sent as the prompt
    const isSlashCommand = message.trim().startsWith('/');
    let slashCommandName: string | undefined;
    let slashCommandArgs: string | undefined;
    if (isSlashCommand) {
      const parts = message.trim().split(/\s+/);
      slashCommandName = parts[0]; // e.g. "/compact", "/clear"
      slashCommandArgs = parts.slice(1).join(' ') || undefined;
      getAppLogger().info('ChatAgentService', `Slash command detected: ${slashCommandName}`, { args: slashCommandArgs });
      emitEvent({ type: 'message', message: { type: 'slash_command', command: slashCommandName, args: slashCommandArgs, status: 'invoked', timestamp: Date.now() } });

      // /clear: also clear local message history (the SDK handles the session-level clear)
      if (slashCommandName === '/clear') {
        try {
          await this.chatMessageStore.clearMessages(sessionId);
          getAppLogger().info('ChatAgentService', `Cleared local message history for session ${sessionId} (slash command /clear)`);
        } catch (clearErr) {
          getAppLogger().warn('ChatAgentService', 'Failed to clear messages on /clear', { error: clearErr instanceof Error ? clearErr.message : String(clearErr) });
        }
      }
    }

    let prompt = message.trim() || '(see attached images)';
    // For slash commands, send the raw command as the prompt (SDK handles it natively)
    if (!isSlashCommand) {
      // Include image paths so the agent can Read them
      if (imageRefs && imageRefs.length > 0) {
        for (const img of imageRefs) {
          prompt += `\n  (Image attached: ${img.path})`;
        }
        prompt += '\n\nIMPORTANT: The user attached image(s). Use the Read tool to view them at the paths above.';
      }
      prompt += '\n\nRespond to the latest user message. If your response requires a plan change, respond with the JSON format described in your instructions; otherwise respond in plain text.';
    }

    // Create or reuse AgentRun for agent-chat sessions
    let agentRunId: string | undefined;
    if (session.source === 'agent-chat' && session.scopeType === 'task') {
      try {
        if (session.agentRunId) {
          agentRunId = session.agentRunId;
        } else {
          const run = await this.agentRunStore.createRun({
            taskId: session.scopeId,
            agentType: session.agentRole ?? 'chat',
            mode: 'revision',
          });
          agentRunId = run.id;
          await this.chatSessionStore.updateSession(sessionId, { agentRunId: run.id });
        }
      } catch (err) {
        getAppLogger().logError('ChatAgentService', 'Failed to create/reuse AgentRun for agent-chat', err);
      }
    }

    // Run agent in background, return completion promise
    const abortController = new AbortController();
    this.runningControllers.set(sessionId, abortController);

    const completion = this.runAgent(sessionId, projectPath, systemPrompt, prompt, abortController, agentLibName, emitEvent, images, sessionModel, { pipelineSessionId, resumeSession: shouldResume, isAgentChat, agentRunId, permissionMode: permissionMode ?? null, agentType: session.agentRole ?? undefined, taskId: session.scopeType === 'task' ? session.scopeId : undefined, plugins: projectPlugins, enableStreaming: session.enableStreaming, enableStreamingInput: session.enableStreamingInput }).catch((err) => {
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
    // Discard queued injected messages — session is being stopped
    this.injectedQueue.delete(sessionId);
    this.runningRunIds.delete(sessionId);

    // Reject any pending questions for this session
    // Collect matching entries first to avoid delete-while-iterating
    const toReject = [...this.pendingQuestions.entries()].filter(([, p]) => p.sessionId === sessionId);
    for (const [questionId, pending] of toReject) {
      this.pendingQuestions.delete(questionId);
      pending.reject(new Error('Agent stopped by user'));
    }

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

  answerQuestion(questionId: string, answers: Record<string, string>, sessionId?: string): void {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending) {
      throw Object.assign(new Error(`No pending question found for questionId: ${questionId}`), { status: 404 });
    }

    // Validate sessionId matches if provided (prevents cross-session answers)
    if (sessionId && pending.sessionId !== sessionId) {
      throw Object.assign(new Error(`Question ${questionId} does not belong to session ${sessionId}`), { status: 403 });
    }

    // Update the live turn message to mark as answered
    const turnMessages = this.liveTurnMessages.get(pending.sessionId);
    if (turnMessages) {
      for (const msg of turnMessages) {
        if (msg.type === 'ask_user_question' && msg.questionId === questionId) {
          msg.answered = true;
          msg.answers = answers;
          break;
        }
      }
    }

    this.pendingQuestions.delete(questionId);
    pending.resolve(answers);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.chatMessageStore.getMessagesForSession(sessionId);
  }

  async clearMessages(sessionId: string): Promise<void> {
    this.stop(sessionId); // also clears injectedQueue
    return this.chatMessageStore.clearMessages(sessionId);
  }

  async summarizeMessages(sessionId: string): Promise<ChatMessage[]> {
    this.stop(sessionId);

    const messages = await this.chatMessageStore.getMessagesForSession(sessionId);
    if (messages.length === 0) return [];

    // Sum historical costs from existing messages
    let historicalInputTokens = 0;
    let historicalOutputTokens = 0;
    let historicalCacheReadInputTokens = 0;
    let historicalCacheCreationInputTokens = 0;
    let historicalTotalCostUsd = 0;
    for (const m of messages) {
      historicalInputTokens += m.costInputTokens ?? 0;
      historicalOutputTokens += m.costOutputTokens ?? 0;
      historicalCacheReadInputTokens += m.cacheReadInputTokens ?? 0;
      historicalCacheCreationInputTokens += m.cacheCreationInputTokens ?? 0;
      historicalTotalCostUsd += m.totalCostUsd ?? 0;
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
    let summaryCacheReadInputTokens: number | undefined;
    let summaryCacheCreationInputTokens: number | undefined;
    let summaryTotalCostUsd: number | undefined;
    try {
      const lib = await this.resolveLibForSession(sessionId);
      for await (const event of lib.query!(summaryPrompt, { maxTokens: 1000 })) {
        if (event.type === 'text') {
          summaryText += event.text;
        } else if (event.type === 'result') {
          summaryCostInput = event.usage?.input_tokens;
          summaryCostOutput = event.usage?.output_tokens;
          summaryCacheReadInputTokens = event.usage?.cache_read_input_tokens ?? undefined;
          summaryCacheCreationInputTokens = event.usage?.cache_creation_input_tokens ?? undefined;
          summaryTotalCostUsd = event.total_cost_usd ?? undefined;
        }
      }
    } catch (err) {
      summaryText = `[Summary generation failed: ${err instanceof Error ? err.message : String(err)}]\n\nOriginal conversation had ${messages.length} messages.`;
    }

    if (!summaryText.trim()) {
      summaryText = `Conversation summary: ${messages.length} messages exchanged.`;
    }

    // Combine historical costs + summarization costs onto the summary message
    const totalInputTokens = historicalInputTokens + (summaryCostInput ?? 0);
    const totalOutputTokens = historicalOutputTokens + (summaryCostOutput ?? 0);
    const totalCacheReadInputTokens = historicalCacheReadInputTokens + (summaryCacheReadInputTokens ?? 0);
    const totalCacheCreationInputTokens = historicalCacheCreationInputTokens + (summaryCacheCreationInputTokens ?? 0);
    const totalCostUsdValue = historicalTotalCostUsd + (summaryTotalCostUsd ?? 0);

    // Append the summary as a new message — keep all existing messages for history
    const summaryMsg = await this.chatMessageStore.addMessage({
      sessionId,
      role: 'system',
      content: `[Conversation Summary]\n\n${summaryText}`,
      costInputTokens: totalInputTokens || undefined,
      costOutputTokens: totalOutputTokens || undefined,
      cacheReadInputTokens: totalCacheReadInputTokens || undefined,
      cacheCreationInputTokens: totalCacheCreationInputTokens || undefined,
      totalCostUsd: totalCostUsdValue || undefined,
    });

    // Mark session as compacted so next sendMessage() starts a fresh SDK session
    this.compactedSessions.add(sessionId);

    return [summaryMsg];
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

  getLiveMessages(sessionId: string): AgentChatMessage[] {
    return [...(this.liveTurnMessages.get(sessionId) ?? [])];
  }

  getImageStorageDir(): string {
    return this.imageStorageDir;
  }

  setInjectedEventHandler(
    handler: (sessionId: string) => ((event: ChatAgentEvent) => void) | undefined,
  ): void {
    this.injectedEventHandler = handler;
  }

  /**
   * Enqueue a system-injected message for a chat session.
   * If no agent is currently running for this session, delivers immediately.
   * If an agent is running, queues for delivery after the current turn completes.
   *
   * Delivery stores the notification as a `system` role message (not `user`)
   * and emits a WS notification event. When `metadata.autoNotify` is true,
   * it also triggers a new agent turn (fire-and-forget) so the agent can react.
   */
  enqueueInjectedMessage(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>,
  ): void {
    const message: InjectedMessage = {
      sessionId,
      content,
      metadata: { ...metadata, injected: true },
      queuedAt: Date.now(),
    };

    if (this.runningControllers.has(sessionId)) {
      const queue = this.injectedQueue.get(sessionId) ?? [];
      queue.push(message);
      this.injectedQueue.set(sessionId, queue);
      getAppLogger().info('ChatAgentService',
        `Queued injected message for busy session ${sessionId}`);
      return;
    }

    this.deliverInjectedMessage(message).catch(err => {
      getAppLogger().logError('ChatAgentService',
        'Failed to deliver injected message', err);
    });
  }

  /**
   * Store the notification as a system message and emit via WS.
   * When `metadata.autoNotify` is true, also triggers a new agent turn
   * (fire-and-forget) so the agent can react to the notification.
   */
  private async deliverInjectedMessage(message: InjectedMessage): Promise<void> {
    const { sessionId, content, metadata } = message;

    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) {
      getAppLogger().warn('ChatAgentService',
        `Skipping injected message: session ${sessionId} not found`);
      return;
    }

    // Store as system message — clearly distinct from user input so it
    // won't confuse the agent's context in future turns.
    await this.chatMessageStore.addMessage({
      sessionId,
      role: 'system',
      content: JSON.stringify({ text: content, metadata }),
    });

    const taskTitle = typeof metadata.taskTitle === 'string' ? metadata.taskTitle : undefined;

    // Emit via WS so the UI can display the notification inline
    const onEvent = this.injectedEventHandler?.(sessionId);
    if (onEvent) {
      onEvent({
        type: 'message',
        message: {
          type: 'notification',
          title: taskTitle ? `Task "${taskTitle}" completed` : 'Agent task completed',
          body: content,
          timestamp: Date.now(),
        },
      });
    }

    // When autoNotify is enabled, trigger a new agent turn so the agent
    // can react to the notification content (fire-and-forget).
    if (metadata.autoNotify === true) {
      this.triggerNotificationTurn(sessionId, content).catch(err => {
        getAppLogger().warn('ChatAgentService',
          `Failed to trigger notification turn for session ${sessionId}`,
          { error: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  /**
   * Trigger a full agent turn for a notification message so the agent can
   * react to subscription results. Uses the injectedEventHandler for WS
   * routing. Errors are caught and logged — callers use fire-and-forget.
   */
  private async triggerNotificationTurn(sessionId: string, content: string): Promise<void> {
    const ctx = await this.buildSendContext(sessionId);
    const onEvent = this.injectedEventHandler?.(sessionId);
    if (!onEvent) {
      getAppLogger().warn('ChatAgentService',
        `No injected event handler for session ${sessionId}; skipping notification turn`);
      return;
    }

    getAppLogger().info('ChatAgentService',
      `Triggering notification turn for session ${sessionId}`);

    await this.send(sessionId, content, {
      systemPrompt: ctx.systemPrompt,
      onEvent,
      pipelineSessionId: ctx.pipelineSessionId,
      resumeSession: ctx.resumeSession,
      isAgentChat: ctx.isAgentChat,
      permissionMode: ctx.permissionMode,
    });
  }

  /**
   * Fire-and-forget: generates a short descriptive name for a session using Claude Haiku,
   * then persists it and invokes onRenamed with the updated session.
   * Silently does nothing if the session no longer has a default name or if anything fails.
   */
  async autoNameSession(sessionId: string, firstMessage: string, onRenamed: (session: ChatSession) => void): Promise<void> {
    try {
      const messageText = firstMessage.slice(0, 300);
      getAppLogger().info('ChatAgent', `Running autoNameSession with "${messageText.slice(0, 100)}"`);

      const prompt = `Generate a short, descriptive name (3-6 words) for a chat session based on this first message. Return ONLY the name, with no quotes, punctuation, or explanation.\n\nFirst message: ${messageText}`;

      let generatedName = '';
      const start = Date.now();
      const lib = await this.resolveLibForSession(sessionId);
      for await (const event of lib.query!(prompt)) {
        if (event.type === 'text') generatedName += event.text;
      }
      const elapsed = Date.now() - start;

      // Strip leading/trailing punctuation/whitespace; enforce 50-char max
      const cleanedName = generatedName.trim().replace(/^[^\w]+|[^\w]+$/g, '').slice(0, 50);
      if (!cleanedName) return;

      // Re-fetch to guard against manual rename that happened during the async call
      const session = await this.chatSessionStore.getSession(sessionId);
      if (!session || !isDefaultSessionName(session.name)) return;

      const updatedSession = await this.chatSessionStore.updateSession(sessionId, { name: cleanedName });
      if (!updatedSession) return;

      getAppLogger().info('ChatAgent', `Changed session name to "${cleanedName}" (query took ${elapsed}ms)`);
      onRenamed(updatedSession);
    } catch {
      // Silent failure — session retains its default name
    }
  }

  private async resolveScope(session: { scopeType: string; scopeId: string }): Promise<{
    projectPath: string;
    projectId: string;
    projectName: string;
    projectDefaultAgentLib?: string;
    projectPlugins?: Array<{ type: 'local'; path: string }>;
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
        projectPlugins: parsePluginsConfig(project.config?.plugins),
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
      projectPlugins: parsePluginsConfig(project.config?.plugins),
    };
  }

  private async runAgent(
    sessionId: string,
    projectPath: string,
    systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string },
    prompt: string,
    abortController: AbortController,
    agentLibName: string,
    emitEvent: (event: ChatAgentEvent) => void,
    images?: ChatImage[],
    model?: string,
    extra?: { pipelineSessionId?: string; resumeSession?: boolean; isAgentChat?: boolean; agentRunId?: string; permissionMode?: PermissionMode | null; agentType?: string; taskId?: string; plugins?: Array<{ type: 'local'; path: string }>; enableStreaming?: boolean; enableStreamingInput?: boolean },
  ): Promise<void> {
    getAppLogger().info('ChatAgentService', `runAgent() starting for session ${sessionId}`, { agentLibName, projectPath });

    const agentRunId = extra?.agentRunId;

    const imageDir = this.imageStorageDir;

    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    let cacheReadInputTokens: number | undefined;
    let cacheCreationInputTokens: number | undefined;
    let totalCostUsd: number | undefined;
    let lastContextInputTokens: number | undefined;
    const turnMessages: AgentChatMessage[] = [];
    this.liveTurnMessages.set(sessionId, turnMessages);

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
      // Emit agent run info link so UI can show it during streaming
      if (agentRunId) {
        emitMessage({ type: 'agent_run_info', agentRunId, timestamp: Date.now(), agentType: extra?.agentType, taskId: extra?.taskId });
      }

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

      // Determine readOnly and disallowedTools based on permissionMode (null/undefined = read_only)
      const effectiveMode = extra?.permissionMode ?? 'read_only';
      let readOnly: boolean;
      let disallowedTools: string[] | undefined;

      if (effectiveMode === 'full_access') {
        readOnly = false;
      } else if (effectiveMode === 'read_write') {
        readOnly = false;
      } else {
        // read_only (default)
        readOnly = true;
        disallowedTools = [...WRITE_TOOL_NAMES];
      }

      // Build hooks for the agent lib
      const postToolUseHook = (input: import('../interfaces/agent-lib').PostToolUseHookInput) => {
        getAppLogger().debug('ChatAgentService', `PostToolUse: ${input.toolName}`, {
          toolUseId: input.toolUseId,
          responsePreview: typeof input.toolResponse === 'string'
            ? input.toolResponse.slice(0, 200)
            : JSON.stringify(input.toolResponse).slice(0, 200),
        });
      };

      const notificationHook = (input: import('../interfaces/agent-lib').NotificationHookInput) => {
        getAppLogger().info('ChatAgentService', `Agent notification: ${input.title ?? ''} ${input.message}`);
        // Forward notification to the UI as a message event
        emitMessage({
          type: 'notification',
          title: input.title,
          body: input.message,
          timestamp: Date.now(),
        });
      };

      const stopHook = (input: import('../interfaces/agent-lib').StopHookInput) => {
        getAppLogger().info('ChatAgentService', `Agent stop hook: stopHookActive=${input.stopHookActive}`);
      };

      // Subagent lifecycle hooks — emit subagent_activity messages to the UI
      const subagentStartHook = (input: import('../interfaces/agent-lib').SubagentStartHookInput) => {
        getAppLogger().info('ChatAgentService', `Subagent started: ${input.agentType} (${input.agentId})`);
        emitMessage({
          type: 'subagent_activity',
          agentName: input.agentType,
          status: 'started',
          toolUseId: input.agentId,
          timestamp: Date.now(),
        });
      };

      const subagentStopHook = (input: import('../interfaces/agent-lib').SubagentStopHookInput) => {
        getAppLogger().info('ChatAgentService', `Subagent stopped: ${input.agentType} (${input.agentId})`);
        emitMessage({
          type: 'subagent_activity',
          agentName: input.agentType,
          status: 'completed',
          toolUseId: input.agentId,
          timestamp: Date.now(),
        });
      };

      const requestQuestionAnswers = async (
        questionId: string,
        questions: import('../../shared/types').AskUserQuestionItem[],
      ): Promise<Record<string, string>> => {
        emitMessage({
          type: 'ask_user_question',
          questionId,
          questions,
          answered: false,
          timestamp: Date.now(),
        });

        let onAbort: (() => void) | undefined;
        try {
          const answers = await new Promise<Record<string, string>>((resolve, reject) => {
            this.pendingQuestions.set(questionId, { resolve, reject, sessionId });

            onAbort = () => {
              if (this.pendingQuestions.has(questionId)) {
                this.pendingQuestions.delete(questionId);
                reject(new Error('Agent stopped while waiting for user answer'));
              }
            };
            abortController.signal.addEventListener('abort', onAbort, { once: true });
          });

          if (onAbort) abortController.signal.removeEventListener('abort', onAbort);
          return answers;
        } catch (err) {
          if (onAbort) abortController.signal.removeEventListener('abort', onAbort);
          if (err instanceof Error && !err.message.includes('Agent stopped')) {
            getAppLogger().warn('ChatAgentService', 'Unexpected error while waiting for user answer', { error: err.message });
          }
          throw err;
        }
      };

      // Build images array for libs that support native images
      const libImages = (features.images && images && images.length > 0)
        ? images.map((img) => ({ base64: img.base64, mediaType: img.mediaType }))
        : undefined;

      // When resuming a pipeline agent session, use its sessionId for the execute call
      const executeSessionId = extra?.pipelineSessionId ?? sessionId;

      // Track sessionId → runId mapping for mid-execution injection routing
      this.runningRunIds.set(sessionId, executeSessionId);

      // Build task MCP tool definitions for chat sessions (not pipeline agent runs).
      // Keyed by server name so claude-code-lib can create one SDK server per entry generically.
      let mcpToolsDefs: Record<string, GenericMcpToolDefinition[]> | undefined;
      let chatSession: ChatSession | null = null;
      if (!extra?.pipelineSessionId) {
        try {
          chatSession = await this.chatSessionStore.getSession(sessionId);
          if (chatSession?.projectId) {
            const daemonUrl = `http://127.0.0.1:${process.env.AM_DAEMON_PORT ?? 3847}`;
            const taskTools = await createTaskMcpServer(daemonUrl, { projectId: chatSession.projectId, sessionId, subscriptionRegistry: this.subscriptionRegistry });
            mcpToolsDefs = { 'taskManager': taskTools };
          }
        } catch (mcpErr) {
          getAppLogger().warn('ChatAgentService', 'Failed to create task MCP server, continuing without it', { error: mcpErr instanceof Error ? mcpErr.message : String(mcpErr) });
        }
      }

      // Build canUseTool callback that intercepts AskUserQuestion tool calls
      const canUseTool = async (toolName: string, input: Record<string, unknown>): Promise<
        { behavior: 'allow'; updatedInput?: Record<string, unknown> } |
        { behavior: 'deny'; message: string }
      > => {
        if (toolName !== 'AskUserQuestion') {
          return { behavior: 'allow' };
        }

        const questionId = randomUUID();
        const rawQuestions = Array.isArray(input.questions) ? input.questions : [];

        // Validate and normalize question items from SDK input
        const questions: import('../../shared/types').AskUserQuestionItem[] = rawQuestions
          .filter((q: unknown): q is Record<string, unknown> => q != null && typeof q === 'object')
          .map((q: Record<string, unknown>) => ({
            question: typeof q.question === 'string' ? q.question : '',
            header: typeof q.header === 'string' ? q.header : undefined,
            multiSelect: typeof q.multiSelect === 'boolean' ? q.multiSelect : undefined,
            options: Array.isArray(q.options)
              ? (q.options as unknown[]).filter((o): o is Record<string, unknown> => o != null && typeof o === 'object').map((o: Record<string, unknown>) => ({
                  label: typeof o.label === 'string' ? o.label : String(o.label ?? ''),
                  description: typeof o.description === 'string' ? o.description : undefined,
                }))
              : [],
          }));

        if (questions.length === 0) {
          return { behavior: 'deny', message: 'AskUserQuestion received no valid questions.' };
        }

        try {
          const answers = await requestQuestionAnswers(questionId, questions);
          // Official SDK pattern: allow the tool with answers injected into updatedInput
          return {
            behavior: 'allow',
            updatedInput: {
              questions: input.questions,
              answers,
            },
          };
        } catch {
          return { behavior: 'deny', message: 'User did not answer (agent was stopped).' };
        }
      };

      // Add default subagents for thread chat sessions (desktop/telegram/cli — not agent-chat or pipeline)
      const isThreadChat = chatSession && chatSession.source !== 'agent-chat' && !extra?.pipelineSessionId;
      const agents = isThreadChat ? DEFAULT_CHAT_SUBAGENTS : undefined;

      const onClientToolCall: AgentLibCallbacks['onClientToolCall'] = async ({ toolName, toolUseId, toolInput }) => {
        if (toolName !== 'Task' && toolName !== 'task') {
          return { handled: false, success: false, content: '' };
        }

        const subagentType = typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type : undefined;
        const subagentDef = subagentType ? agents?.[subagentType] : undefined;
        const agentName = subagentType ?? 'subagent';
        const taskPrompt = typeof toolInput.prompt === 'string'
          ? toolInput.prompt
          : typeof toolInput.description === 'string'
            ? toolInput.description
            : JSON.stringify(toolInput);
        const taskInput = JSON.stringify(toolInput);

        emitMessage({
          type: 'tool_use',
          toolName: 'Task',
          toolId: toolUseId,
          input: taskInput.slice(0, 2000),
          timestamp: Date.now(),
        });
        emitMessage({
          type: 'subagent_activity',
          agentName,
          status: 'started',
          toolUseId,
          timestamp: Date.now(),
        });

        try {
          const nestedResult = await lib.execute(`${executeSessionId}:task:${toolUseId}`, {
            prompt: taskPrompt,
            systemPrompt: subagentDef?.prompt ?? systemPrompt,
            cwd: projectPath,
            model,
            maxTurns: subagentDef?.maxTurns ?? 25,
            timeoutMs: 300000,
            allowedPaths: readOnly ? [] : [projectPath, imageDir],
            readOnlyPaths: readOnly ? [projectPath, imageDir] : [],
            readOnly,
            permissionMode: effectiveMode,
            settingSources: ['project'] as Array<'user' | 'project' | 'local'>,
            ...(mcpToolsDefs ? { mcpTools: mcpToolsDefs } : {}),
            ...(extra?.plugins?.length ? { plugins: extra.plugins } : {}),
            canUseTool,
            disallowedTools: [...(disallowedTools ?? []), 'Task'],
          }, {
            onMessage: (msg: AgentChatMessage) => {
              const taggedMessage = tagNestedSubagentMessage(msg, toolUseId);
              if (!taggedMessage) {
                return;
              }
              emitMessage(taggedMessage);
            },
            onQuestionRequest: async ({ questionId, questions }) => {
              const answers = await requestQuestionAnswers(questionId, questions);
              return Object.fromEntries(
                Object.entries(answers).map(([key, value]) => [key, [value]]),
              );
            },
            onClientToolCall: async () => ({ handled: true, success: false, content: 'Nested Task delegation is not supported yet.' }),
          });

          const resultText = (nestedResult.output || nestedResult.error || `Subagent ${agentName} completed.`).slice(0, 4000);
          emitMessage({
            type: 'subagent_activity',
            agentName,
            status: 'completed',
            toolUseId,
            timestamp: Date.now(),
          });
          emitMessage({
            type: 'tool_result',
            toolId: toolUseId,
            result: resultText.slice(0, 2000),
            timestamp: Date.now(),
          });

          return {
            handled: true,
            success: nestedResult.exitCode === 0,
            content: resultText,
          };
        } catch (err) {
          const errorText = err instanceof Error ? err.message : String(err);
          emitMessage({
            type: 'subagent_activity',
            agentName,
            status: 'completed',
            toolUseId,
            timestamp: Date.now(),
          });
          emitMessage({
            type: 'tool_result',
            toolId: toolUseId,
            result: errorText.slice(0, 2000),
            timestamp: Date.now(),
          });
          return {
            handled: true,
            success: false,
            content: errorText,
          };
        }
      };

      // When enableStreaming is false, suppress stream deltas so the full message
      // appears only when complete. Default is true (streaming on).
      const enableStreaming = extra?.enableStreaming !== false;

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
        onQuestionRequest: async ({ questionId, questions }) => {
          const answers = await requestQuestionAnswers(questionId, questions);
          return Object.fromEntries(
            Object.entries(answers).map(([key, value]) => [key, [value]]),
          );
        },
        onClientToolCall,
        ...(enableStreaming ? {
          onStreamEvent: (event: { type: string; [key: string]: unknown }) => {
            // Forward raw stream events for partial message streaming
            const delta = event.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
            if (event.type === 'content_block_delta' && delta) {
              if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                emitEvent({ type: 'stream_delta', delta: { type: 'stream_delta', deltaType: 'text_delta', delta: delta.text, timestamp: Date.now() } });
              } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                emitEvent({ type: 'stream_delta', delta: { type: 'stream_delta', deltaType: 'thinking_delta', delta: delta.thinking, timestamp: Date.now() } });
              } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                emitEvent({ type: 'stream_delta', delta: { type: 'stream_delta', deltaType: 'input_json_delta', delta: delta.partial_json, timestamp: Date.now() } });
              }
            }
          },
        } : {}),
      };

      // Determine whether streaming input (mid-execution message injection) should be enabled.
      // Only enable when both the lib supports it AND the session toggle is on.
      const enableStreamingInput = features.streamingInput && (extra?.enableStreamingInput === true);

      const executeOptions = {
        prompt,
        systemPrompt,
        sessionId: executeSessionId,
        cwd: projectPath,
        model,
        maxTurns: 50,
        allowedPaths: readOnly ? [] : [projectPath, imageDir],
        readOnlyPaths: readOnly ? [projectPath, imageDir] : [],
        readOnly,
        permissionMode: effectiveMode,
        settingSources: ['project'] as Array<'user' | 'project' | 'local'>,
        ...(extra?.resumeSession ? { resumeSession: true } : {}),
        ...(disallowedTools ? { disallowedTools } : {}),
        hooks: {
          postToolUse: postToolUseHook,
          notification: notificationHook,
          stop: stopHook,
          subagentStart: subagentStartHook,
          subagentStop: subagentStopHook,
        },
        ...(libImages ? { images: libImages } : {}),
        ...(mcpToolsDefs ? { mcpTools: mcpToolsDefs } : {}),
        canUseTool,
        ...(agents ? { agents } : {}),
        ...(extra?.plugins?.length ? { plugins: extra.plugins } : {}),
        ...(enableStreamingInput ? { enableStreamingInput: true } : {}),
      };

      let result = await lib.execute(executeSessionId, executeOptions, callbacks);

      // Fallback: if session resume failed (missing/corrupt session from before the fix),
      // retry without resume so existing threads don't permanently break.
      const errorLower = (result.error ?? '').toLowerCase();
      const outputLower = (result.output ?? '').toLowerCase();
      const isSessionError = errorLower.includes('session') || outputLower.includes('session');
      const isEmptyResult = !result.output && !result.error;
      const isZeroCost = !result.costInputTokens && !result.costOutputTokens;
      const isSessionInUse = /session\s+id\s+\S+\s+is\s+already\s+in\s+use/i.test(result.error ?? '') ||
                             /session\s+id\s+\S+\s+is\s+already\s+in\s+use/i.test(result.output ?? '');
      if (result.exitCode !== 0 && !result.killReason && isZeroCost &&
          ((extra?.resumeSession && (isSessionError || isEmptyResult)) || isSessionInUse)) {
        getAppLogger().warn('ChatAgentService', `Session error for ${executeSessionId}, retrying without resume`, { originalError: result.error ?? '(empty)', isSessionInUse, isResume: !!extra?.resumeSession });
        emitEvent({ type: 'text', text: '\n[Session error — starting fresh session]\n' });
        result = await lib.execute(executeSessionId, {
          ...executeOptions,
          resumeSession: false,
          // Drop sessionId when the SDK rejected it as "already in use" to avoid the same conflict
          ...(isSessionInUse ? { sessionId: undefined } : {}),
        }, callbacks);
      }

      if (result.costInputTokens != null || result.costOutputTokens != null) {
        emitMessage({
          type: 'usage',
          inputTokens: result.costInputTokens ?? 0,
          outputTokens: result.costOutputTokens ?? 0,
          ...(result.contextWindow ? { contextWindow: result.contextWindow } : {}),
          timestamp: Date.now(),
        });
      }

      costInputTokens = result.costInputTokens;
      costOutputTokens = result.costOutputTokens;
      cacheReadInputTokens = result.cacheReadInputTokens;
      cacheCreationInputTokens = result.cacheCreationInputTokens;
      totalCostUsd = result.totalCostUsd;
      lastContextInputTokens = result.lastContextInputTokens;

      if (result.durationMs != null || result.numTurns != null) {
        getAppLogger().debug('ChatAgentService', `Session ${sessionId} telemetry: durationMs=${result.durationMs}, durationApiMs=${result.durationApiMs}, numTurns=${result.numTurns}, contextWindow=${result.contextWindow}`);
      }

      if (result.error) {
        emitEvent({ type: 'text', text: `\n[Agent error: ${result.error}]\n` });
        const isStopped = result.error.includes('kill_reason=stopped');
        const isTimeout = result.error.includes('kill_reason=timeout') || result.error.includes('timed out');
        const errorStatus: 'cancelled' | 'timed_out' | 'failed' = isStopped ? 'cancelled' : isTimeout ? 'timed_out' : 'failed';
        emitMessage({ type: 'status', status: errorStatus, message: result.error, timestamp: Date.now() });
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
      const errStack = err instanceof Error ? err.stack : undefined;
      // Use the abort controller signal as source of truth (works regardless of error type)
      if (abortController.signal.aborted) {
        getAppLogger().info('ChatAgentService', `Chat agent aborted for session ${sessionId}`);
        try { emitMessage({ type: 'status', status: 'cancelled', message: 'Agent stopped by user', timestamp: Date.now() }); } catch (emitErr) { getAppLogger().warn('ChatAgentService', 'Failed to emit cancellation status', { error: emitErr instanceof Error ? emitErr.message : String(emitErr) }); }
      } else {
        getAppLogger().logError('ChatAgentService', `Chat agent error for session ${sessionId}`, err);
        emitEvent({ type: 'text', text: `\nError: ${errMsg}\n` });
        try { emitMessage({ type: 'status', status: 'failed', message: errMsg, stack: errStack, timestamp: Date.now() }); } catch (emitErr) { getAppLogger().warn('ChatAgentService', 'Failed to emit error status', { error: emitErr instanceof Error ? emitErr.message : String(emitErr) }); }
      }
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
    } finally {
      this.runningControllers.delete(sessionId);
      this.runningRunIds.delete(sessionId);
      this.liveTurnMessages.delete(sessionId);

      // Clean up any orphaned pending questions for this session (e.g. SDK timeout)
      const orphaned = [...this.pendingQuestions.entries()].filter(([, p]) => p.sessionId === sessionId);
      for (const [qId, pending] of orphaned) {
        this.pendingQuestions.delete(qId);
        pending.reject(new Error('Agent session ended'));
      }

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
            cacheReadInputTokens,
            cacheCreationInputTokens,
            totalCostUsd,
            lastContextInputTokens,
          });
        } catch (persistErr) {
          getAppLogger().logError('ChatAgentService', 'Failed to persist assistant response', persistErr);
          try { emitEvent({ type: 'text', text: '\n[Warning: Failed to save this response. It may not appear after refresh.]\n' }); } catch (deliveryErr) { getAppLogger().warn('ChatAgentService', 'persist-warning delivery failed', { error: deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr) }); }
        }

        // Agent-chat responses are purely conversational — the agent does not
        // modify the plan/design directly. Plan/design changes are handled by
        // the "Request Changes" flow which transitions the task back to
        // planning/designing and re-runs the full pipeline.
      }

      // Update AgentRun with accumulated costs and messages
      if (agentRunId) {
        try {
          const existingRun = await this.agentRunStore.getRun(agentRunId);
          if (existingRun) {
            const agent = this.runningAgents.get(sessionId);
            const agentStatus = agent?.status ?? 'failed';
            await this.agentRunStore.updateRun(agentRunId, {
              status: agentStatus === 'completed' ? 'completed' : 'failed',
              completedAt: Date.now(),
              costInputTokens: (existingRun.costInputTokens ?? 0) + (costInputTokens ?? 0),
              costOutputTokens: (existingRun.costOutputTokens ?? 0) + (costOutputTokens ?? 0),
              cacheReadInputTokens: (existingRun.cacheReadInputTokens ?? 0) + (cacheReadInputTokens ?? 0),
              cacheCreationInputTokens: (existingRun.cacheCreationInputTokens ?? 0) + (cacheCreationInputTokens ?? 0),
              totalCostUsd: (existingRun.totalCostUsd ?? 0) + (totalCostUsd ?? 0),
              messages: [...(existingRun.messages ?? []), ...turnMessages],
              prompt: existingRun.prompt ? existingRun.prompt : `${systemPrompt}\n\n${prompt}`,
            });
          } else {
            getAppLogger().warn('ChatAgentService', `AgentRun ${agentRunId} not found in DB; skipping update`);
          }
        } catch (runErr) {
          getAppLogger().logError('ChatAgentService', 'Failed to update AgentRun', runErr);
        }
      }

      // Signal completion to renderer so it can reset streaming state
      getAppLogger().info('ChatAgentService', `Chat agent finished for session ${sessionId}, sending completion sentinel`);
      emitEvent({ type: 'text', text: CHAT_COMPLETE_SENTINEL });

      // Drain all queued injected messages for this session.
      // Messages are stored as system messages and emitted as notifications.
      // When autoNotify is set, deliverInjectedMessage also triggers a new
      // agent turn (fire-and-forget).
      const queued = this.injectedQueue.get(sessionId);
      if (queued && queued.length > 0) {
        this.injectedQueue.delete(sessionId);
        for (const msg of queued) {
          try {
            await this.deliverInjectedMessage(msg);
          } catch (err) {
            getAppLogger().logError('ChatAgentService',
              'Failed to deliver queued injected message', err);
          }
        }
      }
    }
  }

  /**
   * Resolves the IAgentLib for a session, falling back to the default lib if the session's
   * configured engine is unavailable or the session does not exist.
   */
  private async resolveLibForSession(sessionId: string): Promise<IAgentLib> {
    const session = await this.chatSessionStore.getSession(sessionId);
    let agentLibName = session?.agentLib || this.getDefaultAgentLib() || DEFAULT_AGENT_LIB;
    if (!this.agentLibRegistry.listNames().includes(agentLibName)) {
      agentLibName = DEFAULT_AGENT_LIB;
    }
    return this.agentLibRegistry.getLib(agentLibName);
  }
}
