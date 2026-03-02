import TelegramBot from 'node-telegram-bot-api';
import type { ITelegramBotService } from '../interfaces/telegram-bot-service';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { TaskUpdateInput, TelegramBotLogEntry } from '../../shared/types';
import { statusEmoji } from './telegram-emoji';
import { getAppLogger } from './app-logger';


/** Maximum allowed length for free-text input from Telegram users */
const MAX_INPUT_LENGTH = 2000;

/** Time-to-live for pending actions (5 minutes) */
const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

/** Interval for cleaning up expired pending actions (60 seconds) */
const PENDING_ACTION_CLEANUP_INTERVAL_MS = 60 * 1000;

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
  defaultPipelineId?: string;
}

export class TelegramBotService implements ITelegramBotService {
  private bot: TelegramBot | null = null;
  private running = false;
  private pendingActions = new Map<number, PendingAction>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private deps: BotDeps;
  private projectId = '';
  private chatId = '';
  public onLog?: (entry: TelegramBotLogEntry) => void;

  constructor(deps: BotDeps) {
    this.deps = deps;
  }

  getBot(): TelegramBot | null {
    return this.bot;
  }

  async start(projectId: string, botToken: string, chatId: string): Promise<void> {
    if (this.running) throw new Error('TelegramBotService is already running');

    const project = await this.deps.projectStore.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

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

  private registerHandlers(): void {
    const bot = this.bot!;

    bot.onText(/\/tasks$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/tasks');
      this.handleTasks(msg.chat.id).catch(this.logError);
    });

    bot.onText(/\/task (\S+)/, (msg, match) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? `/task ${match![1]}`);
      this.handleTaskDetail(msg.chat.id, match![1].trim()).catch(this.logError);
    });

    bot.onText(/\/create$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/create');
      this.pendingActions.set(msg.chat.id, { type: 'create_title', createdAt: Date.now() });
      this.send(msg.chat.id, 'Enter the task title:').catch(this.logError);
    });

    bot.onText(/\/help$/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.log('in', msg.text ?? '/help');
      this.send(msg.chat.id, [
        '*Available commands:*',
        '/tasks \\- List project tasks',
        '/task <id> \\- Show task details',
        '/create \\- Create a new task',
        '/help \\- Show this help',
      ].join('\n'), { parse_mode: 'MarkdownV2' }).catch(this.logError);
    });

    bot.on('message', (msg) => {
      if (!this.isAllowed(msg)) return;
      if (msg.text?.startsWith('/')) return;

      const text = msg.text ?? '';
      this.log('in', text);

      // Validate input length
      if (text.length > MAX_INPUT_LENGTH) {
        this.send(msg.chat.id, `Input too long \\(max ${MAX_INPUT_LENGTH} characters\\)\\.`).catch(this.logError);
        return;
      }

      const pending = this.pendingActions.get(msg.chat.id);
      if (!pending) return;

      // Check TTL before consuming
      if (Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS) {
        this.pendingActions.delete(msg.chat.id);
        this.send(msg.chat.id, 'Action expired\\. Please start again\\.').catch(this.logError);
        return;
      }

      this.pendingActions.delete(msg.chat.id);

      if (pending.type === 'create_title') {
        this.handleCreateTask(msg.chat.id, text).catch(this.logError);
      } else if (pending.type === 'edit_field' && pending.taskId && pending.field) {
        this.handleEditFieldValue(msg.chat.id, pending.taskId, pending.field, text).catch(this.logError);
      }
    });

    bot.on('callback_query', (query) => {
      if (!query.data || !query.message) return;
      const chatId = query.message.chat.id;
      if (String(chatId) !== this.chatId) return;

      this.log('in', `[callback] ${query.data}`);
      bot.answerCallbackQuery(query.id).catch(this.logError);
      this.handleCallback(chatId, query.data).catch(this.logError);
    });
  }

  private async handleCallback(chatId: number, data: string): Promise<void> {
    // Short prefixes with | separator to stay within Telegram's 64-byte callback_data limit.
    // Using | because ULIDs cannot contain it, preventing ambiguous parsing.
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
    }
  }

  private isAllowed(msg: TelegramBot.Message): boolean {
    return String(msg.chat.id) === this.chatId;
  }

  private async handleTasks(chatId: number): Promise<void> {
    const tasks = await this.deps.taskStore.listTasks({ projectId: this.projectId });
    if (tasks.length === 0) {
      await this.send(chatId, 'No tasks found\\.');
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
      await this.send(chatId, 'No valid transitions available\\.');
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
        await this.send(chatId, 'Priority must be a non\\-negative number\\.');
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
      await this.send(chatId, 'Update failed\\.');
    }
  }

  private async handleCreateTask(chatId: number, title: string): Promise<void> {
    if (!title.trim()) {
      await this.send(chatId, 'Title cannot be empty\\.');
      return;
    }

    const pipelines = await this.deps.pipelineStore.listPipelines();
    if (pipelines.length === 0) {
      await this.send(chatId, 'No pipelines available\\.');
      return;
    }

    // Get default pipeline from settings or fall back to first pipeline
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
      await this.send(chatId, 'Delete failed\\.');
    }
  }

  private log(direction: 'in' | 'out', message: string): void {
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
    getAppLogger().logError('TelegramBotService', 'Unhandled error', err);
  };
}

function esc(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
