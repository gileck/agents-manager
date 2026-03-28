import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { ITaskDocStore } from '../interfaces/task-doc-store';
import type { ChatMessage, AgentChatMessage, ChatImage, ChatImageRef, ChatSendOptions, ChatSendResult, ChatAgentEvent, ChatSession, PermissionMode } from '../../shared/types';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { IAgentLib } from '../interfaces/agent-lib';
import type { AgentSubscriptionRegistry } from './agent-subscription-registry';
import type { SessionScope } from './chat-prompt-parts';
import { buildAgentChatSystemPrompt, buildDesktopSystemPrompt } from './chat-prompt-parts';
import { resizeImages } from '../libs/image-utils';

import { getAppLogger } from './app-logger';
import { getChatImagesStorageDir } from '../utils/user-paths';

import {
  type RunningAgent,
  type InjectedMessage,
  saveImagesToDisk,
  parsePluginsConfig,
  DEFAULT_AGENT_LIB,
  CHAT_COMPLETE_SENTINEL,
} from './chat-agent/chat-agent-helpers';
import { runAgent, type RunAgentContext } from './chat-agent/agent-runner';
import { summarizeMessages as doSummarize, autoNameSession as doAutoName, type ConversationUtilsContext } from './chat-agent/chat-conversation-utils';

export type { RunningAgent } from './chat-agent/chat-agent-helpers';

export class ChatAgentService {
  private runningControllers = new Map<string, AbortController>();
  private runningAgents = new Map<string, RunningAgent>();
  private liveTurnMessages = new Map<string, AgentChatMessage[]>();
  /** Accumulates ALL turn messages for the run including pre-injection ones.
   *  Unlike liveTurnMessages (cleared during injection), this is never cleared
   *  so that AgentRun.messages captures the full conversation. */
  private allRunTurnMessages = new Map<string, AgentChatMessage[]>();
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
    private taskContextStore?: ITaskContextStore,
    private taskDocStore?: ITaskDocStore,
  ) {
    this.imageStorageDir = imageStorageDir ?? getChatImagesStorageDir();
  }

  async initialize(): Promise<void> {
    await this.chatSessionStore.resetStaleStatuses();
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
      if (!project.path) throw new Error(`Project has no path for task: ${session.scopeId}`);
      const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);

      // Hydrate docs from task_docs table (optional — non-fatal if store unavailable)
      let docs;
      if (this.taskDocStore) {
        try {
          docs = await this.taskDocStore.getByTaskId(task.id);
        } catch (err) {
          getAppLogger().warn('ChatAgentService', `Failed to hydrate task docs for scope: ${err instanceof Error ? err.message : String(err)}`, { taskId: task.id });
        }
      }

      return {
        scopeType: 'task',
        projectId: task.projectId,
        projectName: project.name,
        permissionMode: session.permissionMode ?? undefined,
        projectPath: project.path,
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          description: task.description,
          priority: task.priority,
          assignee: task.assignee,
          docs,
          pipelineName: pipeline?.name ?? task.pipelineId,
        },
      };
    }

    if (session.scopeType !== 'project') {
      throw new Error(`Unknown scope type: ${session.scopeType}`);
    }

    const project = await this.projectStore.getProject(session.scopeId);
    if (!project) throw new Error(`Project not found: ${session.scopeId}`);
    if (!project.path) throw new Error(`Project has no path: ${session.scopeId}`);
    return {
      scopeType: 'project',
      projectId: session.scopeId,
      projectName: project.name,
      permissionMode: session.permissionMode ?? undefined,
      projectPath: project.path,
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
        if (injected) {
          // Restore running status — the agent was waiting_for_input after the
          // previous turn's onTurnComplete, now it's actively processing again.
          const agent = this.runningAgents.get(sessionId);
          if (agent) {
            agent.status = 'running';
            agent.lastActivity = Date.now();
          }
          this.chatSessionStore.updateSessionStatus(sessionId, 'running').catch((err) =>
            getAppLogger().warn('ChatAgentService', 'Failed to persist running status on injection', { error: err instanceof Error ? err.message : String(err) }),
          );
        }
        if (!injected) {
          // The channel was closed (SDK finished processing its result) but the
          // runAgent() finally block hasn't executed yet, so runningControllers
          // still contains the session. Wait for cleanup to complete, then retry
          // as a fresh message turn instead of showing a confusing error.
          getAppLogger().info('ChatAgentService', `Injection channel closed for session ${sessionId}, waiting for agent cleanup then retrying as new message`);
          const maxWaitMs = 5000;
          const waitStart = Date.now();
          while (this.runningControllers.has(sessionId) && Date.now() - waitStart < maxWaitMs) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          if (this.runningControllers.has(sessionId)) {
            // Agent is genuinely still running but channel was somehow closed — unexpected
            getAppLogger().warn('ChatAgentService', `Agent still running after channel close wait for session ${sessionId}`);
            throw new Error('Message injection failed — the agent may have just finished. Please try again.');
          }

          // Agent finished — retry as a fresh message (normal send path)
          getAppLogger().info('ChatAgentService', `Agent finished, retrying send as new message for session ${sessionId}`);
          return this.send(sessionId, message, options);
        }

        // Persist any assistant messages accumulated before this injection so they
        // aren't lost if the page reloads before the agent finishes (Bug 4 fix).
        // Snapshot and clear are synchronous — no interleaving with emitMessage.
        const currentTurnMessages = this.liveTurnMessages.get(sessionId);
        if (currentTurnMessages && currentTurnMessages.length > 0) {
          const snapshot = [...currentTurnMessages];
          currentTurnMessages.length = 0;
          try {
            // Cost data is intentionally omitted — it represents the full run total
            // and is persisted only once in the finally block.
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
    // Persist status to DB (fire-and-forget)
    this.chatSessionStore.updateSessionStatus(sessionId, 'running').catch((err) => getAppLogger().warn('ChatAgentService', 'Failed to persist session status', { error: err instanceof Error ? err.message : String(err) }));

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
    // Set runningRunIds synchronously (before the async runAgent call) so that
    // mid-execution injection can look up the runId immediately. Without this,
    // there is a race window where runningControllers exists but runningRunIds
    // does not, causing injection to fail with "no runId mapped for session".
    this.runningRunIds.set(sessionId, pipelineSessionId ?? sessionId);

    const completion = this.runAgentDelegate(sessionId, projectPath, systemPrompt, prompt, abortController, agentLibName, emitEvent, images, sessionModel, { pipelineSessionId, resumeSession: shouldResume, isAgentChat, agentRunId, permissionMode: permissionMode ?? null, agentType: session.agentRole ?? undefined, taskId: session.scopeType === 'task' ? session.scopeId : undefined, plugins: projectPlugins, enableStreaming: session.enableStreaming, enableStreamingInput: session.enableStreamingInput }).catch((err) => {
      // Safety net: errors should be handled inside runAgent, but recover if one escapes
      getAppLogger().logError('ChatAgentService', `Unhandled error escaped runAgent for session ${sessionId}`, err);
      this.chatSessionStore.updateSessionStatus(sessionId, 'error').catch((err) => getAppLogger().warn('ChatAgentService', 'Failed to persist session status', { error: err instanceof Error ? err.message : String(err) }));
      try { emitEvent({ type: 'text', text: `\nError: ${err instanceof Error ? err.message : String(err)}\n` }); } catch { /* best effort */ }
      try { emitEvent({ type: 'text', text: CHAT_COMPLETE_SENTINEL }); } catch { /* best effort */ }
      const agent = this.runningAgents.get(sessionId);
      if (agent && (agent.status === 'running' || agent.status === 'waiting_for_input')) {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
      this.runningControllers.delete(sessionId);
      this.runningRunIds.delete(sessionId);
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
      if (agent && (agent.status === 'running' || agent.status === 'waiting_for_input')) {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
      this.chatSessionStore.updateSessionStatus(sessionId, 'idle').catch((err) => getAppLogger().warn('ChatAgentService', 'Failed to persist session status', { error: err instanceof Error ? err.message : String(err) }));
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

    // Restore agent status from 'waiting_for_input' back to 'running'
    const agent = this.runningAgents.get(pending.sessionId);
    if (agent && agent.status === 'waiting_for_input') {
      agent.status = 'running';
      this.chatSessionStore.updateSessionStatus(pending.sessionId, 'running').catch(() => {});
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.chatMessageStore.getMessagesForSession(sessionId);
  }

  async clearMessages(sessionId: string): Promise<void> {
    this.stop(sessionId); // also clears injectedQueue
    return this.chatMessageStore.clearMessages(sessionId);
  }

  async summarizeMessages(sessionId: string): Promise<ChatMessage[]> {
    return doSummarize(this.buildConversationUtilsContext(), sessionId);
  }

  async getRunningAgents(): Promise<RunningAgent[]> {
    // Clean up stale agents (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [sessionId, agent] of this.runningAgents) {
      if (agent.status !== 'running' && agent.status !== 'waiting_for_input' && agent.lastActivity < oneHourAgo) {
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
  async autoNameSession(sessionId: string, firstMessage: string, onRenamed: (session: ChatSession) => void, sessionName?: string): Promise<void> {
    return doAutoName(this.buildConversationUtilsContext(), sessionId, firstMessage, onRenamed, sessionName);
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

  private buildConversationUtilsContext(): ConversationUtilsContext {
    return {
      chatMessageStore: this.chatMessageStore,
      chatSessionStore: this.chatSessionStore,
      compactedSessions: this.compactedSessions,
      resolveLibForSession: (sid) => this.resolveLibForSession(sid),
      stop: (sid) => this.stop(sid),
    };
  }

  /** Build the context object that the extracted runAgent function needs. */
  private buildRunAgentContext(): RunAgentContext {
    return {
      runningAgents: this.runningAgents,
      liveTurnMessages: this.liveTurnMessages,
      allRunTurnMessages: this.allRunTurnMessages,
      runningControllers: this.runningControllers,
      runningRunIds: this.runningRunIds,
      pendingQuestions: this.pendingQuestions,
      injectedQueue: this.injectedQueue,
      chatMessageStore: this.chatMessageStore,
      chatSessionStore: this.chatSessionStore,
      agentRunStore: this.agentRunStore,
      taskContextStore: this.taskContextStore,
      agentLibRegistry: this.agentLibRegistry,
      subscriptionRegistry: this.subscriptionRegistry,
      imageStorageDir: this.imageStorageDir,
      deliverInjectedMessage: (msg) => this.deliverInjectedMessage(msg),
    };
  }

  private async runAgentDelegate(
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
    return runAgent(this.buildRunAgentContext(), sessionId, projectPath, systemPrompt, prompt, abortController, agentLibName, emitEvent, images, model, extra);
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
