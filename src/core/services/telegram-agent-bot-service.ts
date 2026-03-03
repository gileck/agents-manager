import TelegramBot from 'node-telegram-bot-api';
import type { ITelegramBotService } from '../interfaces/telegram-bot-service';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { TaskUpdateInput, TelegramBotLogEntry, ChatSession, AgentChatMessage } from '../../shared/types';
import type { ChatAgentService } from './chat-agent-service';
import { buildTelegramSystemPrompt } from './chat-prompt-parts';
import { statusEmoji } from './telegram-emoji';
import { getAppLogger } from './app-logger';


/** Maximum allowed length for free-text input from Telegram users */
const MAX_INPUT_LENGTH = 2000;

/** Time-to-live for pending actions (5 minutes) */
const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

/** Interval for cleaning up expired pending actions (60 seconds) */
const PENDING_ACTION_CLEANUP_INTERVAL_MS = 60 * 1000;

/** Telegram message length limit */
const TELEGRAM_MAX_LENGTH = 4096;

/** Typing indicator interval (Telegram requires re-sending every 5s) */
const TYPING_INTERVAL_MS = 4000;

/** Minimum interval between streamed tool messages to avoid Telegram flooding */
const TOOL_STREAM_MIN_INTERVAL_MS = 2000;

interface PendingAction {
  type: 'create_title' | 'edit_field';
  taskId?: string;
  field?: string;
  createdAt: number;
}

interface BotDeps {
  taskStore: ITaskStore;
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  pipelineEngine: IPipelineEngine;
  workflowService: IWorkflowService;
  chatSessionStore: IChatSessionStore;
  chatAgentService: ChatAgentService;
  agentRunStore: IAgentRunStore;
  defaultPipelineId?: string;
}

export class TelegramAgentBotService implements ITelegramBotService {
  private bot: TelegramBot | null = null;
  private running = false;
  private pendingActions = new Map<number, PendingAction>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private deps: BotDeps;
  private projectId = '';
  private chatId = '';
  public onLog?: (entry: TelegramBotLogEntry) => void;
  public onOutput?: (sessionId: string, chunk: string) => void;
  public onMessage?: (sessionId: string, msg: AgentChatMessage) => void;
  private currentSessionId: string | null = null;

  // Track which sessions have an active agent query
  private runningSessionIds = new Set<string>();

  constructor(deps: BotDeps) {
    this.deps = deps;
  }

  getBot(): TelegramBot | null {
    return this.bot;
  }

  async start(projectId: string, botToken: string, chatId: string): Promise<void> {
    if (this.running) throw new Error('TelegramAgentBotService is already running');

    const project = await this.deps.projectStore.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    if (!project.path) throw new Error(`Project has no path: ${projectId}`);

    this.projectId = projectId;
    this.chatId = chatId;
    this.bot = new TelegramBot(botToken, { polling: true });
    this.running = true;

    this.bot.on('polling_error', (err: Error) => {
      this.logError(err);
      this.log('in', `[polling_error] ${err.message}`);
    });

    this.registerHandlers();
    this.startPendingActionsCleanup();

    await this.send(chatId, `Bot started for project *${esc(project.name)}*`, {
      parse_mode: 'MarkdownV2',
    });
  }

  async stop(): Promise<void> {
    this.stopPendingActionsCleanup();
    this.pendingActions.clear();
    // Stop any running agents via ChatAgentService
    for (const sessionId of this.runningSessionIds) {
      this.deps.chatAgentService.stop(sessionId);
    }
    this.runningSessionIds.clear();
    this.currentSessionId = null;
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  private startPendingActionsCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [chatId, action] of this.pendingActions) {
        if (now - action.createdAt > PENDING_ACTION_TTL_MS) {
          this.pendingActions.delete(chatId);
        }
      }
    }, PENDING_ACTION_CLEANUP_INTERVAL_MS);
  }

  private stopPendingActionsCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Handler registration
  // ---------------------------------------------------------------------------

  private registerHandlers(): void {
    const bot = this.bot!;

    // --- Slash commands (migrated from TelegramBotService) ---

    bot.onText(/\/tasks$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/tasks');
      this.log('status', 'Handling /tasks command');
      this.handleTasks(msg.chat.id).catch(this.logError);
    });

    bot.onText(/\/task (\S+)/, (msg, match) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? `/task ${match![1]}`);
      this.log('status', `Handling /task ${match![1].trim()} command`);
      this.handleTaskDetail(msg.chat.id, match![1].trim()).catch(this.logError);
    });

    bot.onText(/\/create$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/create');
      this.log('status', 'Handling /create command');
      this.pendingActions.set(msg.chat.id, { type: 'create_title', createdAt: Date.now() });
      this.send(msg.chat.id, 'Enter the task title:').catch(this.logError);
    });

    bot.onText(/\/clear$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/clear');
      this.log('status', 'Handling /clear command');
      this.handleClear(msg.chat.id).catch(this.logError);
    });

    bot.onText(/\/stop$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/stop');
      this.log('status', 'Handling /stop command');
      this.handleStop(msg.chat.id).catch(this.logError);
    });

    bot.onText(/\/help$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/help');
      this.log('status', 'Handling /help command');
      this.send(msg.chat.id, [
        '*Available commands:*',
        '/tasks \\- List project tasks',
        '/task <id> \\- Show task details',
        '/create \\- Create a new task',
        '/clear \\- Clear conversation history',
        '/stop \\- Stop running agent query',
        '/help \\- Show this help',
        '',
        '_Send any message to chat with the AI agent_',
      ].join('\n'), { parse_mode: 'MarkdownV2' }).catch(this.logError);
    });

    // --- Callback queries (inline keyboard buttons) ---

    bot.on('callback_query', (query) => {
      if (!query.data || !query.message) return;
      const chatId = query.message.chat.id;
      if (String(chatId) !== this.chatId) return;

      this.log('in', `[callback] ${query.data}`);
      this.log('status', `Handling callback: ${query.data}`);
      bot.answerCallbackQuery(query.id).catch(this.logError);
      this.handleCallback(chatId, query.data).catch(this.logError);
    });

    // --- Free-text messages → pending actions or agent ---

    bot.on('message', (msg) => {
      if (!this.isAllowed(msg)) return;
      if (msg.text?.startsWith('/')) return;

      const text = msg.text ?? '';
      this.log('in', text);

      if (text.length > MAX_INPUT_LENGTH) {
        this.send(msg.chat.id, `Input too long \\(max ${MAX_INPUT_LENGTH} characters\\)\\.`, { parse_mode: 'MarkdownV2' }).catch(this.logError);
        return;
      }

      // Check for pending action first
      const pending = this.pendingActions.get(msg.chat.id);
      if (pending) {
        if (Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS) {
          this.pendingActions.delete(msg.chat.id);
          this.send(msg.chat.id, 'Action expired\\. Please start again\\.', { parse_mode: 'MarkdownV2' }).catch(this.logError);
          return;
        }

        this.pendingActions.delete(msg.chat.id);

        if (pending.type === 'create_title') {
          this.handleCreateTask(msg.chat.id, text).catch(this.logError);
        } else if (pending.type === 'edit_field' && pending.taskId && pending.field) {
          this.handleEditFieldValue(msg.chat.id, pending.taskId, pending.field, text).catch(this.logError);
        }
        return;
      }

      // No pending action → route to AI agent
      this.handleAgentMessage(msg.chat.id, text).catch(this.logError);
    });
  }

  // ---------------------------------------------------------------------------
  // Callback handler (inline keyboard)
  // ---------------------------------------------------------------------------

  private async handleCallback(chatId: number, data: string): Promise<void> {
    if (data.startsWith('v|')) {
      await this.handleTaskDetail(chatId, data.slice(2));
    } else if (data.startsWith('ts|')) {
      await this.handleShowTransitions(chatId, data.slice(3));
    } else if (data.startsWith('t|')) {
      const sep = data.indexOf('|', 2);
      if (sep === -1) return;
      await this.handleTransition(chatId, data.slice(2, sep), data.slice(sep + 1));
    } else if (data.startsWith('e|')) {
      await this.handleShowEditFields(chatId, data.slice(2));
    } else if (data.startsWith('ef|')) {
      const sep = data.indexOf('|', 3);
      if (sep === -1) return;
      const taskId = data.slice(3, sep);
      const field = data.slice(sep + 1);
      this.pendingActions.set(chatId, { type: 'edit_field', taskId, field, createdAt: Date.now() });
      await this.send(chatId, `Enter new value for *${esc(field)}*:`, {
        parse_mode: 'MarkdownV2',
      });
    } else if (data.startsWith('d|')) {
      const taskId = data.slice(2);
      await this.send(chatId, `Delete task \`${taskId}\`?`, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '\u{2757} Confirm Delete', callback_data: `cd|${taskId}` },
            { text: '\u{274C} Cancel', callback_data: `v|${taskId}` },
          ]],
        },
      });
    } else if (data.startsWith('cd|')) {
      await this.handleDelete(chatId, data.slice(3));
    } else if (data.startsWith('ra|')) {
      await this.handleRestartAgent(chatId, data.slice(3));
    }
  }

  // ---------------------------------------------------------------------------
  // Slash command handlers (migrated from TelegramBotService)
  // ---------------------------------------------------------------------------

  private isAllowed(msg: TelegramBot.Message): boolean {
    return String(msg.chat.id) === this.chatId;
  }

  private async handleTasks(chatId: number): Promise<void> {
    const tasks = await this.deps.taskStore.listTasks({ projectId: this.projectId });
    if (tasks.length === 0) {
      await this.send(chatId, 'No tasks found\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const buttons = tasks.map((t) => ([{
      text: `${statusEmoji(t.status)} [${t.status}] ${t.title}`,
      callback_data: `v|${t.id}`,
    }]));

    await this.send(chatId, `*Tasks* \\(${tasks.length}\\):`, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async handleTaskDetail(chatId: number, taskId: string): Promise<void> {
    const task = await this.deps.taskStore.getTask(taskId);
    if (!task) {
      await this.send(chatId, `Task not found: ${taskId}`);
      return;
    }

    const lines = [
      `${statusEmoji(task.status)} *${esc(task.title)}*`,
      `Status: \`${task.status}\``,
      `Priority: ${task.priority}`,
      `ID: \`${task.id}\``,
    ];
    if (task.description) lines.push(`\n${esc(task.description)}`);
    if (task.assignee) lines.push(`Assignee: ${esc(task.assignee)}`);

    await this.send(chatId, lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '\u{1F504} Transition', callback_data: `ts|${task.id}` },
          { text: '\u{270F}\u{FE0F} Edit', callback_data: `e|${task.id}` },
          { text: '\u{1F5D1}\u{FE0F} Delete', callback_data: `d|${task.id}` },
        ]],
      },
    });
  }

  private async handleShowTransitions(chatId: number, taskId: string): Promise<void> {
    const task = await this.deps.taskStore.getTask(taskId);
    if (!task) return;

    const transitions = await this.deps.pipelineEngine.getValidTransitions(task, 'manual');
    if (transitions.length === 0) {
      await this.send(chatId, 'No valid transitions available\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const buttons = transitions.map((tr) => ([{
      text: tr.label ?? `${tr.from} → ${tr.to}`,
      callback_data: `t|${taskId}|${tr.to}`,
    }]));

    await this.send(chatId, 'Select transition:', {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async handleTransition(chatId: number, taskId: string, status: string): Promise<void> {
    const result = await this.deps.workflowService.transitionTask(taskId, status, 'telegram');
    if (result.success) {
      await this.send(chatId, `Transitioned to \`${status}\``, { parse_mode: 'MarkdownV2' });
      await this.handleTaskDetail(chatId, taskId);
    } else {
      await this.send(chatId, `Transition failed: ${result.error}`);
    }
  }

  private async handleShowEditFields(chatId: number, taskId: string): Promise<void> {
    const fields = ['title', 'description', 'priority', 'assignee'];
    const buttons = fields.map((f) => ([{
      text: f,
      callback_data: `ef|${taskId}|${f}`,
    }]));

    await this.send(chatId, 'Select field to edit:', {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async handleEditFieldValue(chatId: number, taskId: string, field: string, value: string): Promise<void> {
    const update: TaskUpdateInput = {};
    if (field === 'priority') {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) {
        await this.send(chatId, 'Priority must be a non\\-negative number\\.', { parse_mode: 'MarkdownV2' });
        return;
      }
      update.priority = num;
    } else if (field === 'title') {
      update.title = value;
    } else if (field === 'description') {
      update.description = value;
    } else if (field === 'assignee') {
      update.assignee = value;
    }

    const task = await this.deps.workflowService.updateTask(taskId, update);
    if (task) {
      await this.send(chatId, `Updated *${esc(field)}*`, { parse_mode: 'MarkdownV2' });
      await this.handleTaskDetail(chatId, taskId);
    } else {
      await this.send(chatId, 'Update failed\\.', { parse_mode: 'MarkdownV2' });
    }
  }

  private async handleCreateTask(chatId: number, title: string): Promise<void> {
    if (!title.trim()) {
      await this.send(chatId, 'Title cannot be empty\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const pipelines = await this.deps.pipelineStore.listPipelines();
    if (pipelines.length === 0) {
      await this.send(chatId, 'No pipelines available\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const defaultPipelineId = this.deps.defaultPipelineId ?? '';
    const pipelineId = defaultPipelineId || pipelines[0].id;

    const task = await this.deps.workflowService.createTask({
      projectId: this.projectId,
      pipelineId,
      title: title.trim(),
    });

    await this.send(chatId, `Created task \`${task.id}\`: *${esc(task.title)}*`, {
      parse_mode: 'MarkdownV2',
    });
  }

  private async handleDelete(chatId: number, taskId: string): Promise<void> {
    const deleted = await this.deps.workflowService.deleteTask(taskId);
    if (deleted) {
      await this.send(chatId, `Deleted task \`${taskId}\``, { parse_mode: 'MarkdownV2' });
    } else {
      await this.send(chatId, 'Delete failed\\.', { parse_mode: 'MarkdownV2' });
    }
  }

  private async handleRestartAgent(chatId: number, taskId: string): Promise<void> {
    try {
      await this.send(chatId, `Restarting agent for task \`${esc(taskId)}\`\\.\\.\\.`, { parse_mode: 'MarkdownV2' });

      // Look up the latest run to determine correct agent type and mode
      const runs = await this.deps.agentRunStore.getRunsForTask(taskId);
      const latestRun = runs[0]; // ordered by started_at DESC
      if (!latestRun) {
        getAppLogger().warn('TelegramAgentBot', 'Agent restart skipped: no previous runs', { taskId });
        await this.send(chatId, `Agent restart failed: no previous agent runs found for task \`${esc(taskId)}\``, { parse_mode: 'MarkdownV2' });
        return;
      }

      await this.deps.workflowService.startAgent(taskId, latestRun.mode, latestRun.agentType);
      await this.send(chatId, `Agent restart triggered for task \`${esc(taskId)}\` \\(${esc(latestRun.agentType)}\\)`, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      getAppLogger().logError('TelegramAgentBot', `Agent restart failed for task ${taskId}`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.send(chatId, `Agent restart failed: ${esc(errMsg)}`, { parse_mode: 'MarkdownV2' });
    }
  }

  // ---------------------------------------------------------------------------
  // /clear, /stop — delegate to ChatAgentService
  // ---------------------------------------------------------------------------

  private async handleClear(chatId: number): Promise<void> {
    const session = await this.findSession(chatId);
    if (session) {
      await this.deps.chatAgentService.clearMessages(session.id);
      this.runningSessionIds.delete(session.id);
    }
    await this.send(chatId, 'Conversation history cleared\\.', { parse_mode: 'MarkdownV2' });
  }

  private async handleStop(chatId: number): Promise<void> {
    const session = await this.findSession(chatId);
    if (session && this.runningSessionIds.has(session.id)) {
      this.deps.chatAgentService.stop(session.id);
      this.runningSessionIds.delete(session.id);
      await this.send(chatId, 'Agent query stopped\\.', { parse_mode: 'MarkdownV2' });
    } else {
      await this.send(chatId, 'No agent query is currently running\\.', { parse_mode: 'MarkdownV2' });
    }
  }

  // ---------------------------------------------------------------------------
  // AI Agent message handling — delegates to ChatAgentService
  // ---------------------------------------------------------------------------

  private async handleAgentMessage(chatId: number, text: string): Promise<void> {
    const session = await this.getOrCreateSession(chatId);

    // Reject if agent already running for this session
    if (this.runningSessionIds.has(session.id)) {
      this.log('status', 'Rejected: agent already running');
      await this.send(chatId, 'Please wait — an agent query is already running\\. Use /stop to cancel it\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const truncated = text.length > 80 ? text.slice(0, 80) + '...' : text;
    this.log('status', `Processing: ${truncated}`);

    // Start typing indicator
    const typingInterval = this.startTypingIndicator(chatId);
    this.runningSessionIds.add(session.id);

    // Safe helpers to forward events to the renderer
    const safeEmitOutput = (chunk: string) => {
      try { this.onOutput?.(session.id, chunk); } catch (err) {
        getAppLogger().warn('TelegramAgentBot', 'onOutput callback failed', { error: err instanceof Error ? err.message : String(err) });
      }
    };
    const safeEmitMessage = (msg: AgentChatMessage) => {
      try { this.onMessage?.(session.id, msg); } catch (err) {
        getAppLogger().warn('TelegramAgentBot', 'onMessage callback failed', { error: err instanceof Error ? err.message : String(err) });
      }
    };

    try {
      // Build Telegram-specific system prompt
      const scope = await this.deps.chatAgentService.getSessionScope(session.id);
      const systemPrompt = buildTelegramSystemPrompt(scope);

      // Read streamThinking config
      const streamThinking = await this.isStreamThinkingEnabled();

      // Two-phase response model: ack (before first tool call) + response (after)
      let ackText = '';
      let ackSent = false;
      let ackPromise: Promise<void> | null = null;
      let responseText = '';
      let lastToolMessageTime = 0;

      this.log('status', `Session: ${session.id.slice(0, 8)} — delegating to ChatAgentService`);

      const { completion } = await this.deps.chatAgentService.send(session.id, text, {
        systemPrompt,
        onEvent: (event) => {
          if (event.type === 'text') {
            // Forward raw text to renderer only — do NOT accumulate (assistant_text handles that)
            safeEmitOutput(event.text);
          } else if (event.type === 'message') {
            safeEmitMessage(event.message);
            if (event.message.type === 'assistant_text') {
              if (!ackSent) {
                ackText += event.message.text;
              } else {
                responseText += event.message.text;
              }
            } else if (event.message.type === 'tool_use') {
              this.log('status', `Agent tool: ${event.message.toolName}`);

              // Send ack on first tool call
              if (!ackSent && ackText.trim()) {
                ackPromise = this.sendChunkedMessage(chatId, ackText.trim()).catch(this.logError);
                ackSent = true;
              }

              // Stream tool usage messages when enabled
              if (streamThinking) {
                const now = Date.now();
                if (now - lastToolMessageTime >= TOOL_STREAM_MIN_INTERVAL_MS) {
                  lastToolMessageTime = now;
                  const toolMsg = formatToolMessage(event.message.toolName, event.message.input);
                  this.send(chatId, toolMsg, { parse_mode: 'Markdown' }).catch((err) => {
                    this.logError(err);
                    this.log('status', `Failed to send tool status: ${err instanceof Error ? err.message : String(err)}`);
                  });
                }
              }
            }
          }
        },
      });

      this.log('status', 'Agent started — running via ChatAgentService...');

      await completion;

      // Stop typing indicator
      this.stopTypingIndicator(typingInterval);
      this.runningSessionIds.delete(session.id);

      // Wait for ack to be delivered before sending final response
      if (ackPromise) await ackPromise;

      // Determine final text to send
      const finalText = ackSent ? responseText : (ackText + responseText);

      this.log('status', `Agent finished (${finalText.length} chars response, ack=${ackSent})`);

      // Send response
      if (finalText.trim()) {
        const chunks = this.splitIntoChunks(finalText.trim());
        this.log('status', `Response sent to Telegram (${finalText.length} chars, ${chunks.length} chunk${chunks.length > 1 ? 's' : ''})`);
        await this.sendChunkedMessage(chatId, finalText.trim());
      } else if (!ackSent) {
        await this.send(chatId, 'The agent did not produce a response\\.', { parse_mode: 'MarkdownV2' });
      }

      // Completion sentinel is now emitted by ChatAgentService.runAgent() via onEvent callback
    } catch (err) {
      this.stopTypingIndicator(typingInterval);
      this.runningSessionIds.delete(session.id);

      const errMsg = err instanceof Error ? err.message : String(err);
      this.log('status', `Agent error: ${errMsg}`);
      getAppLogger().logError('TelegramAgentBot', 'Agent error', err);
      await this.send(chatId, 'An error occurred while processing your request. Please try again.');
      // If send() threw before runAgent started, no sentinel was emitted via onEvent.
      // Emit it here to reset any renderer streaming state.
      safeEmitOutput('__CHAT_COMPLETE__');
    }
  }

  private async isStreamThinkingEnabled(): Promise<boolean> {
    try {
      const project = await this.deps.projectStore.getProject(this.projectId);
      if (!project?.config) return false;
      const tg = project.config.telegram as Record<string, unknown> | undefined;
      return !!tg?.streamThinking;
    } catch (err) {
      getAppLogger().logError('TelegramAgentBot', 'Failed to read streamThinking config', err);
      this.log('status', 'Warning: Could not read streamThinking config — defaulting to off');
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  private async getOrCreateSession(chatId: number): Promise<ChatSession> {
    const existing = await this.findSession(chatId);
    if (existing) {
      this.currentSessionId = existing.id;
      return existing;
    }

    const session = await this.deps.chatSessionStore.createSession({
      scopeType: 'project',
      scopeId: this.projectId,
      projectId: this.projectId,
      name: `Telegram Chat ${chatId}`,
      source: 'telegram',
      agentLib: 'claude-code',
    });
    this.currentSessionId = session.id;
    return session;
  }

  private async findSession(chatId: number): Promise<ChatSession | null> {
    const sessions = await this.deps.chatSessionStore.listSessionsForScope('project', this.projectId);
    // Match by source + name (new sessions), or by legacy telegram- prefix (backward compat)
    const newName = `Telegram Chat ${chatId}`;
    const legacyName = `telegram-${chatId}`;
    return sessions.find((s) => s.source === 'telegram' && s.name === newName)
      ?? sessions.find((s) => s.name === legacyName)
      ?? null;
  }

  // ---------------------------------------------------------------------------
  // Typing indicator
  // ---------------------------------------------------------------------------

  private startTypingIndicator(chatId: number): ReturnType<typeof setInterval> {
    this.bot?.sendChatAction(chatId, 'typing').catch(this.logError);
    return setInterval(() => {
      this.bot?.sendChatAction(chatId, 'typing').catch(this.logError);
    }, TYPING_INTERVAL_MS);
  }

  private stopTypingIndicator(interval: ReturnType<typeof setInterval>): void {
    clearInterval(interval);
  }

  // ---------------------------------------------------------------------------
  // Message sending helpers
  // ---------------------------------------------------------------------------

  private async sendChunkedMessage(chatId: number | string, text: string): Promise<void> {
    // Split at paragraph/newline boundaries
    const chunks = this.splitIntoChunks(text);

    for (const chunk of chunks) {
      // Try Markdown first, fall back to plain text if Telegram rejects it
      try {
        await this.send(chatId, chunk, { parse_mode: 'Markdown' });
      } catch {
        await this.send(chatId, chunk);
      }
    }
  }

  private splitIntoChunks(text: string): string[] {
    if (text.length <= TELEGRAM_MAX_LENGTH) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= TELEGRAM_MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Find a good split point: paragraph break, then newline, then space
      let splitIdx = remaining.lastIndexOf('\n\n', TELEGRAM_MAX_LENGTH);
      if (splitIdx === -1 || splitIdx < TELEGRAM_MAX_LENGTH / 2) {
        splitIdx = remaining.lastIndexOf('\n', TELEGRAM_MAX_LENGTH);
      }
      if (splitIdx === -1 || splitIdx < TELEGRAM_MAX_LENGTH / 2) {
        splitIdx = remaining.lastIndexOf(' ', TELEGRAM_MAX_LENGTH);
      }
      if (splitIdx === -1 || splitIdx < TELEGRAM_MAX_LENGTH / 2) {
        splitIdx = TELEGRAM_MAX_LENGTH;
      }

      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx).trimStart();
    }

    return chunks;
  }

  private log(direction: 'in' | 'out' | 'status', message: string): void {
    if (this.onLog) {
      this.onLog({ timestamp: Date.now(), direction, message });
    }
  }

  private async send(chatId: number | string, text: string, opts?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message | undefined> {
    if (!this.bot) return undefined;
    this.log('out', text);
    return this.bot.sendMessage(chatId, text, opts);
  }

  private logError = (err: unknown): void => {
    getAppLogger().logError('TelegramAgentBot', 'Unhandled error', err);
  };
}

function formatToolMessage(toolName: string, rawInput: string | undefined): string {
  let inp: Record<string, unknown> = {};
  if (rawInput) {
    try {
      inp = JSON.parse(rawInput);
    } catch {
      return `_Using ${toolName}_`;
    }
  }
  switch (toolName) {
    case 'Read': {
      const file = inp.file_path ?? inp.path ?? '';
      return `_Reading \`${sanitizeInlineCode(shortPath(String(file)))}\`_`;
    }
    case 'Grep': {
      const pattern = inp.pattern ?? '';
      return `_Searching for \`${sanitizeInlineCode(truncate(String(pattern), 40))}\`_`;
    }
    case 'Bash': {
      const cmd = inp.command ?? '';
      return `_Running \`${sanitizeInlineCode(truncate(String(cmd), 50))}\`_`;
    }
    case 'Glob':
      return '_Searching for files_';
    case 'LS':
      return '_Listing directory_';
    case 'Edit':
    case 'MultiEdit':
      return '_Editing file_';
    case 'Write':
      return '_Writing file_';
    default:
      return `_Using ${toolName}_`;
  }
}

function sanitizeInlineCode(text: string): string {
  return text.replace(/`/g, "'");
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : filePath;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function esc(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
