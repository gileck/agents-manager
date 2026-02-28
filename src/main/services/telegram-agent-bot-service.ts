import TelegramBot from 'node-telegram-bot-api';
import type { ITelegramBotService } from '../interfaces/telegram-bot-service';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { TaskUpdateInput, TelegramBotLogEntry, ChatSession } from '../../shared/types';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SandboxGuard } from './sandbox-guard';
import { getSetting } from '@template/main/services/settings-service';

const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

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

/** Maximum agent turns per query */
const MAX_AGENT_TURNS = 50;

/** Maximum conversation history messages to include in prompt */
const MAX_HISTORY_MESSAGES = 50;

/** Agent timeout (5 minutes) */
const AGENT_TIMEOUT_MS = 300_000;

const WRITE_TOOL_NAMES = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);

const PROJECT_SYSTEM_PROMPT = `You are a project assistant with read-only access to the codebase and full access to the \`npx agents-manager\` CLI for task management.

## Capabilities
- Read and explore project files (Read, Glob, Grep, LS tools)
- Run the \`npx agents-manager\` CLI to manage tasks, features, pipelines, and more (via Bash tool)
- Answer questions about code, architecture, and project state

## Rules
- You MUST NOT modify any files. Do not use Write, Edit, MultiEdit, or NotebookEdit tools.
- You CAN use Bash to run \`npx agents-manager\` CLI commands (e.g. \`npx agents-manager tasks list\`, \`npx agents-manager tasks create\`, \`npx agents-manager tasks update\`).
- You CAN use Bash for read-only commands like \`ls\`, \`cat\`, \`git log\`, \`git diff\`, etc.
- Be concise and helpful. Format responses with markdown when useful.
- When the user asks you to do something that requires modifying files, explain that you can only read files but can help plan changes or create tasks.

## Telegram Context
- You are responding via Telegram. Keep responses concise.
- Use basic markdown formatting (bold, italic, code blocks). Avoid complex formatting.
- For long code blocks, provide only the most relevant snippets.
- Avoid very long responses; summarize when possible.`;

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
  chatMessageStore: IChatMessageStore;
  chatSessionStore: IChatSessionStore;
}

/** Callbacks from runSdkQuery for each message type. */
interface SdkQueryCallbacks {
  onText?: (text: string) => void;
  onToolUse?: (block: { type: 'tool_use'; name: string; id?: string; input?: unknown }) => void;
  onResult?: (msg: SDKResultMessage) => void;
  onUserToolResult?: (toolUseId: string, content: string) => void;
}

/** Extract plain text from a DB content field (handles both JSON array and plain text). */
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
    } catch {
      // Not valid JSON array — treat as plain text
    }
  }
  // Try JSON envelope (user messages with images)
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed.text;
      }
    } catch {
      // Not valid JSON — treat as plain text
    }
  }
  return content;
}

export class TelegramAgentBotService implements ITelegramBotService {
  private bot: TelegramBot | null = null;
  private running = false;
  private pendingActions = new Map<number, PendingAction>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private deps: BotDeps;
  private projectId = '';
  private chatId = '';
  private projectPath = '';
  public onLog?: (entry: TelegramBotLogEntry) => void;

  // Agent concurrency: one running agent per chat
  private runningControllers = new Map<number, AbortController>();

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
    this.projectPath = project.path;
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
    // Abort any running agents
    for (const [, controller] of this.runningControllers) {
      controller.abort();
    }
    this.runningControllers.clear();
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
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
            { text: 'Confirm Delete', callback_data: `cd|${taskId}` },
            { text: 'Cancel', callback_data: `v|${taskId}` },
          ]],
        },
      });
    } else if (data.startsWith('cd|')) {
      await this.handleDelete(chatId, data.slice(3));
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
      text: `[${t.status}] ${t.title}`,
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
      `*${esc(task.title)}*`,
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
          { text: 'Transition', callback_data: `ts|${task.id}` },
          { text: 'Edit', callback_data: `e|${task.id}` },
          { text: 'Delete', callback_data: `d|${task.id}` },
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

    const defaultPipelineId = getSetting('default_pipeline_id', '');
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

  // ---------------------------------------------------------------------------
  // New commands: /clear, /stop
  // ---------------------------------------------------------------------------

  private async handleClear(chatId: number): Promise<void> {
    const session = await this.findSession(chatId);
    if (session) {
      await this.deps.chatMessageStore.clearMessages(session.id);
      // Abort running agent if any
      const controller = this.runningControllers.get(chatId);
      if (controller) {
        controller.abort();
        this.runningControllers.delete(chatId);
      }
    }
    await this.send(chatId, 'Conversation history cleared\\.', { parse_mode: 'MarkdownV2' });
  }

  private async handleStop(chatId: number): Promise<void> {
    const controller = this.runningControllers.get(chatId);
    if (controller) {
      controller.abort();
      this.runningControllers.delete(chatId);
      await this.send(chatId, 'Agent query stopped\\.', { parse_mode: 'MarkdownV2' });
    } else {
      await this.send(chatId, 'No agent query is currently running\\.', { parse_mode: 'MarkdownV2' });
    }
  }

  // ---------------------------------------------------------------------------
  // AI Agent message handling
  // ---------------------------------------------------------------------------

  private async handleAgentMessage(chatId: number, text: string): Promise<void> {
    // Reject if agent already running for this chat
    if (this.runningControllers.has(chatId)) {
      this.log('status', 'Rejected: agent already running');
      await this.send(chatId, 'Please wait — an agent query is already running\\. Use /stop to cancel it\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const truncated = text.length > 80 ? text.slice(0, 80) + '...' : text;
    this.log('status', `Processing: ${truncated}`);

    const session = await this.getOrCreateSession(chatId);

    // Persist user message
    await this.deps.chatMessageStore.addMessage({
      sessionId: session.id,
      role: 'user',
      content: text,
    });

    // Start typing indicator
    const typingInterval = this.startTypingIndicator(chatId);

    const abortController = new AbortController();
    this.runningControllers.set(chatId, abortController);

    try {
      // Load conversation history (bounded to prevent prompt overflow)
      const history = await this.deps.chatMessageStore.getMessagesForSession(session.id, MAX_HISTORY_MESSAGES);
      this.log('status', `Session: ${session.id.slice(0, 8)} (${history.length} messages in history)`);

      // Build prompt with conversation history
      const conversationLines: string[] = [];
      for (const msg of history.slice(0, -1)) {
        const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
        const msgText = extractTextFromContent(msg.content);
        conversationLines.push(`[${roleLabel}]: ${msgText}`);
      }

      let prompt = '';
      if (conversationLines.length > 0) {
        prompt += '## Conversation History\n\n' + conversationLines.join('\n\n') + '\n\n---\n\n';
      }
      prompt += `[User]: ${text}\n\nRespond to the latest user message.`;

      const fullPrompt = `${PROJECT_SYSTEM_PROMPT}\n\n${prompt}`;

      // Set up sandbox guard: no writes allowed, read-only access to project
      const sandboxGuard = new SandboxGuard([], [this.projectPath]);

      // Accumulate response text
      let responseText = '';

      // Manual timeout — abort if agent takes too long
      const timeout = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);

      this.log('status', 'Agent started — running SDK query...');

      try {
        // Run SDK query
        await this.runSdkQuery(
          fullPrompt,
          {
            cwd: this.projectPath,
            abortController,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            maxTurns: MAX_AGENT_TURNS,
            hooks: {
              preToolUse: (toolName: string, toolInput: Record<string, unknown>) => {
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
            onText: (chunk) => {
              responseText += chunk;
            },
            onToolUse: (block) => {
              this.log('status', `Agent tool: ${block.name}`);
            },
            onResult: (resultMsg) => {
              if (resultMsg.subtype !== 'success') {
                responseText += `\n[Agent errors: ${resultMsg.errors.join('; ')}]\n`;
              }
            },
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      this.log('status', `Agent finished (${responseText.length} chars response)`);

      // Stop typing indicator
      this.stopTypingIndicator(typingInterval);
      this.runningControllers.delete(chatId);

      // Send response
      if (responseText.trim()) {
        const chunks = this.splitIntoChunks(responseText.trim());
        this.log('status', `Response sent to Telegram (${responseText.length} chars, ${chunks.length} chunk${chunks.length > 1 ? 's' : ''})`);
        await this.sendChunkedMessage(chatId, responseText.trim());
      } else {
        await this.send(chatId, 'The agent did not produce a response\\.', { parse_mode: 'MarkdownV2' });
      }

      // Persist assistant response
      await this.deps.chatMessageStore.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: responseText || '(no response)',
      });
    } catch (err) {
      this.stopTypingIndicator(typingInterval);
      this.runningControllers.delete(chatId);

      if ((err as Error).name === 'AbortError') {
        this.log('status', 'Agent query aborted');
        return;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      this.log('status', `Agent error: ${errMsg}`);
      console.error('[telegram-agent-bot] Agent error:', err);
      await this.send(chatId, 'An error occurred while processing your request. Please try again.');
    }
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  private async getOrCreateSession(chatId: number): Promise<ChatSession> {
    const existing = await this.findSession(chatId);
    if (existing) return existing;

    return this.deps.chatSessionStore.createSession({
      scopeType: 'project',
      scopeId: this.projectId,
      projectId: this.projectId,
      name: `telegram-${chatId}`,
      agentLib: 'claude-code',
    });
  }

  private async findSession(chatId: number): Promise<ChatSession | null> {
    const sessions = await this.deps.chatSessionStore.listSessionsForScope('project', this.projectId);
    const sessionName = `telegram-${chatId}`;
    return sessions.find((s) => s.name === sessionName) ?? null;
  }

  // ---------------------------------------------------------------------------
  // SDK query execution (follows ChatAgentService pattern)
  // ---------------------------------------------------------------------------

  private async runSdkQuery(
    prompt: string,
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
          } else if (block.type === 'tool_use') {
            callbacks.onToolUse?.(block as { type: 'tool_use'; name: string; id?: string; input?: unknown });
          }
        }
      } else if (message.type === 'result') {
        callbacks.onResult?.(message as SDKResultMessage);
      } else if (message.type === 'user') {
        const userMsg = message as SDKUserMessage;
        const content = userMsg.message?.content;
        if (content && typeof content !== 'string') {
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
    }
  }

  private async loadQuery(): Promise<(opts: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SDKMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    if (typeof mod.query !== 'function') {
      throw new Error('Claude Agent SDK loaded but "query" export is missing. Ensure @anthropic-ai/claude-agent-sdk is installed and up to date.');
    }
    return mod.query as (opts: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SDKMessage>;
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
    console.error('[telegram-agent-bot]', err);
  };
}

function esc(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
