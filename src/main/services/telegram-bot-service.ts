import TelegramBot from 'node-telegram-bot-api';
import type { ITelegramBotService } from '../interfaces/telegram-bot-service';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { TaskUpdateInput } from '../../shared/types';
import { getResolvedConfig } from './config-service';

interface PendingAction {
  type: 'create_title' | 'edit_field';
  taskId?: string;
  field?: string;
}

interface BotDeps {
  taskStore: ITaskStore;
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  pipelineEngine: IPipelineEngine;
  workflowService: IWorkflowService;
}

export class TelegramBotService implements ITelegramBotService {
  private bot: TelegramBot | null = null;
  private running = false;
  private pendingActions = new Map<number, PendingAction>();
  private deps: BotDeps;
  private projectId = '';
  private chatId = '';

  constructor(deps: BotDeps) {
    this.deps = deps;
  }

  getBot(): TelegramBot | null {
    return this.bot;
  }

  async start(projectId: string): Promise<void> {
    const project = await this.deps.projectStore.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const config = getResolvedConfig(project.path ?? undefined);
    const botToken = config.telegram?.botToken;
    const chatId = config.telegram?.chatId;
    if (!botToken || !chatId) {
      throw new Error('Telegram botToken and chatId must be configured');
    }

    this.projectId = projectId;
    this.chatId = chatId;
    this.bot = new TelegramBot(botToken, { polling: true });
    this.running = true;

    this.registerHandlers();

    await this.bot.sendMessage(chatId, `Bot started for project *${esc(project.name)}*`, {
      parse_mode: 'MarkdownV2',
    });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private registerHandlers(): void {
    const bot = this.bot!;

    bot.onText(/\/tasks/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.handleTasks(msg.chat.id).catch(this.logError);
    });

    bot.onText(/\/task (.+)/, (msg, match) => {
      if (!this.isAllowed(msg)) return;
      this.handleTaskDetail(msg.chat.id, match![1].trim()).catch(this.logError);
    });

    bot.onText(/\/create/, (msg) => {
      if (!this.isAllowed(msg)) return;
      this.pendingActions.set(msg.chat.id, { type: 'create_title' });
      bot.sendMessage(msg.chat.id, 'Enter the task title:').catch(this.logError);
    });

    bot.onText(/\/help/, (msg) => {
      if (!this.isAllowed(msg)) return;
      bot.sendMessage(msg.chat.id, [
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

      const pending = this.pendingActions.get(msg.chat.id);
      if (!pending) return;
      this.pendingActions.delete(msg.chat.id);

      if (pending.type === 'create_title') {
        this.handleCreateTask(msg.chat.id, msg.text ?? '').catch(this.logError);
      } else if (pending.type === 'edit_field' && pending.taskId && pending.field) {
        this.handleEditFieldValue(msg.chat.id, pending.taskId, pending.field, msg.text ?? '').catch(this.logError);
      }
    });

    bot.on('callback_query', (query) => {
      if (!query.data || !query.message) return;
      const chatId = query.message.chat.id;
      if (String(chatId) !== this.chatId) return;

      bot.answerCallbackQuery(query.id).catch(this.logError);
      this.handleCallback(chatId, query.data).catch(this.logError);
    });
  }

  private async handleCallback(chatId: number, data: string): Promise<void> {
    const bot = this.bot!;
    // Short prefixes to stay within Telegram's 64-byte callback_data limit
    if (data.startsWith('v:')) {
      await this.handleTaskDetail(chatId, data.slice(2));
    } else if (data.startsWith('ts:')) {
      await this.handleShowTransitions(chatId, data.slice(3));
    } else if (data.startsWith('t:')) {
      const sep = data.indexOf(':', 2);
      await this.handleTransition(chatId, data.slice(2, sep), data.slice(sep + 1));
    } else if (data.startsWith('e:')) {
      await this.handleShowEditFields(chatId, data.slice(2));
    } else if (data.startsWith('ef:')) {
      const sep = data.indexOf(':', 3);
      const taskId = data.slice(3, sep);
      const field = data.slice(sep + 1);
      this.pendingActions.set(chatId, { type: 'edit_field', taskId, field });
      await bot.sendMessage(chatId, `Enter new value for *${esc(field)}*:`, {
        parse_mode: 'MarkdownV2',
      });
    } else if (data.startsWith('d:')) {
      const taskId = data.slice(2);
      await bot.sendMessage(chatId, `Delete task \`${taskId}\`?`, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: 'Confirm Delete', callback_data: `cd:${taskId}` },
            { text: 'Cancel', callback_data: `v:${taskId}` },
          ]],
        },
      });
    } else if (data.startsWith('cd:')) {
      await this.handleDelete(chatId, data.slice(3));
    }
  }

  private isAllowed(msg: TelegramBot.Message): boolean {
    return String(msg.chat.id) === this.chatId;
  }

  private async handleTasks(chatId: number): Promise<void> {
    const tasks = await this.deps.taskStore.listTasks({ projectId: this.projectId });
    if (tasks.length === 0) {
      await this.bot!.sendMessage(chatId, 'No tasks found\\.');
      return;
    }

    const buttons = tasks.map((t) => ([{
      text: `[${t.status}] ${t.title}`,
      callback_data: `v:${t.id}`,
    }]));

    await this.bot!.sendMessage(chatId, `*Tasks* \\(${tasks.length}\\):`, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async handleTaskDetail(chatId: number, taskId: string): Promise<void> {
    const task = await this.deps.taskStore.getTask(taskId);
    if (!task) {
      await this.bot!.sendMessage(chatId, `Task not found: ${taskId}`);
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

    await this.bot!.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: 'Transition', callback_data: `ts:${task.id}` },
          { text: 'Edit', callback_data: `e:${task.id}` },
          { text: 'Delete', callback_data: `d:${task.id}` },
        ]],
      },
    });
  }

  private async handleShowTransitions(chatId: number, taskId: string): Promise<void> {
    const task = await this.deps.taskStore.getTask(taskId);
    if (!task) return;

    const transitions = await this.deps.pipelineEngine.getValidTransitions(task, 'manual');
    if (transitions.length === 0) {
      await this.bot!.sendMessage(chatId, 'No valid transitions available\\.');
      return;
    }

    const buttons = transitions.map((tr) => ([{
      text: tr.label ?? `${tr.from} → ${tr.to}`,
      callback_data: `t:${taskId}:${tr.to}`,
    }]));

    await this.bot!.sendMessage(chatId, 'Select transition:', {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async handleTransition(chatId: number, taskId: string, status: string): Promise<void> {
    const result = await this.deps.workflowService.transitionTask(taskId, status, 'telegram');
    if (result.success) {
      await this.bot!.sendMessage(chatId, `Transitioned to \`${status}\``, { parse_mode: 'MarkdownV2' });
      await this.handleTaskDetail(chatId, taskId);
    } else {
      await this.bot!.sendMessage(chatId, `Transition failed: ${result.error}`);
    }
  }

  private async handleShowEditFields(chatId: number, taskId: string): Promise<void> {
    const fields = ['title', 'description', 'priority', 'assignee'];
    const buttons = fields.map((f) => ([{
      text: f,
      callback_data: `ef:${taskId}:${f}`,
    }]));

    await this.bot!.sendMessage(chatId, 'Select field to edit:', {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async handleEditFieldValue(chatId: number, taskId: string, field: string, value: string): Promise<void> {
    const update: TaskUpdateInput = {};
    if (field === 'priority') {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) {
        await this.bot!.sendMessage(chatId, 'Priority must be a non\\-negative number\\.');
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
      await this.bot!.sendMessage(chatId, `Updated *${esc(field)}*`, { parse_mode: 'MarkdownV2' });
      await this.handleTaskDetail(chatId, taskId);
    } else {
      await this.bot!.sendMessage(chatId, 'Update failed\\.');
    }
  }

  private async handleCreateTask(chatId: number, title: string): Promise<void> {
    if (!title.trim()) {
      await this.bot!.sendMessage(chatId, 'Title cannot be empty\\.');
      return;
    }

    const pipelines = await this.deps.pipelineStore.listPipelines();
    if (pipelines.length === 0) {
      await this.bot!.sendMessage(chatId, 'No pipelines available\\.');
      return;
    }

    const task = await this.deps.workflowService.createTask({
      projectId: this.projectId,
      pipelineId: pipelines[0].id,
      title: title.trim(),
    });

    await this.bot!.sendMessage(chatId, `Created task \`${task.id}\`: *${esc(task.title)}*`, {
      parse_mode: 'MarkdownV2',
    });
  }

  private async handleDelete(chatId: number, taskId: string): Promise<void> {
    const deleted = await this.deps.workflowService.deleteTask(taskId);
    if (deleted) {
      await this.bot!.sendMessage(chatId, `Deleted task \`${taskId}\``, { parse_mode: 'MarkdownV2' });
    } else {
      await this.bot!.sendMessage(chatId, 'Delete failed\\.');
    }
  }

  private logError = (err: unknown): void => {
    console.error('[telegram-bot]', err);
  };
}

function esc(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
