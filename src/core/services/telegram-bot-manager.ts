import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ISettingsStore } from '../interfaces/settings-store';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { TelegramBotLogEntry, AgentChatMessage } from '../../shared/types';
import type { ChatAgentService } from './chat-agent-service';
import type { MultiChannelNotificationRouter } from './multi-channel-notification-router';
import { TelegramAgentBotService } from './telegram-agent-bot-service';
import { TelegramNotificationRouter } from './telegram-notification-router';
import { validateTelegramConfig } from './telegram-config-validator';
import { getAppLogger } from './app-logger';

export interface TelegramBotManagerCallbacks {
  onBotLog?: (projectId: string, entry: TelegramBotLogEntry) => void;
  onChatOutput?: (sessionId: string, chunk: string) => void;
  onChatMessage?: (sessionId: string, msg: AgentChatMessage) => void;
  onStatusChanged?: (projectId: string, status: string) => void;
}

export interface TelegramBotManagerDeps {
  projectStore: IProjectStore;
  taskStore: ITaskStore;
  pipelineStore: IPipelineStore;
  pipelineEngine: IPipelineEngine;
  workflowService: IWorkflowService;
  chatSessionStore: IChatSessionStore;
  chatAgentService: ChatAgentService;
  agentRunStore: IAgentRunStore;
  settingsStore: ISettingsStore;
  notificationRouter: MultiChannelNotificationRouter;
}

interface ActiveBot {
  botService: TelegramAgentBotService;
  notificationRouter: INotificationRouter;
}

export class TelegramBotManager {
  private activeBots = new Map<string, ActiveBot>();

  constructor(
    private deps: TelegramBotManagerDeps,
    private callbacks?: TelegramBotManagerCallbacks,
  ) {}

  /**
   * Start the Telegram bot for a project. Validates config, creates bot service,
   * wires callbacks, starts polling, and registers the notification router.
   * Skips silently if the bot is already running for this project.
   */
  async startBot(projectId: string): Promise<void> {
    if (this.activeBots.has(projectId)) return;

    const project = await this.deps.projectStore.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const tg = (project.config?.telegram as Record<string, unknown>) ?? {};
    const { botToken, chatId, notificationChatId } = validateTelegramConfig(
      tg.botToken as string | undefined,
      tg.chatId as string | undefined,
      tg.notificationChatId as string | undefined,
    );

    const botService = new TelegramAgentBotService({
      taskStore: this.deps.taskStore,
      projectStore: this.deps.projectStore,
      pipelineStore: this.deps.pipelineStore,
      pipelineEngine: this.deps.pipelineEngine,
      workflowService: this.deps.workflowService,
      chatSessionStore: this.deps.chatSessionStore,
      chatAgentService: this.deps.chatAgentService,
      agentRunStore: this.deps.agentRunStore,
      defaultPipelineId: this.deps.settingsStore.get('default_pipeline_id', ''),
    });

    botService.onLog = (entry) => this.callbacks?.onBotLog?.(projectId, entry);
    botService.onOutput = (sessionId, chunk) => this.callbacks?.onChatOutput?.(sessionId, chunk);
    botService.onMessage = (sessionId, msg) => this.callbacks?.onChatMessage?.(sessionId, msg);

    await botService.start(projectId, botToken, chatId);

    const bot = botService.getBot()!;
    const telegramRouter = new TelegramNotificationRouter(bot, notificationChatId ?? chatId);
    this.deps.notificationRouter.addRouter(telegramRouter);

    this.activeBots.set(projectId, { botService, notificationRouter: telegramRouter });
    this.callbacks?.onStatusChanged?.(projectId, 'running');
  }

  /** Stop the bot for a project and deregister its notification router. */
  async stopBot(projectId: string): Promise<void> {
    const entry = this.activeBots.get(projectId);
    if (!entry) return;

    this.deps.notificationRouter.removeRouter(entry.notificationRouter);
    await entry.botService.stop();
    this.activeBots.delete(projectId);
    this.callbacks?.onStatusChanged?.(projectId, 'stopped');
  }

  /** Stop all active bots — called during daemon shutdown. */
  async stopAll(): Promise<void> {
    for (const [, entry] of this.activeBots) {
      try {
        this.deps.notificationRouter.removeRouter(entry.notificationRouter);
        await entry.botService.stop();
      } catch (err) {
        getAppLogger().warn('telegram', 'Failed to stop bot', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.activeBots.clear();
  }

  /**
   * Auto-start bots for all projects that have valid telegram config
   * and autoStart !== false. Called once during daemon startup.
   */
  async autoStart(): Promise<void> {
    const projects = await this.deps.projectStore.listProjects();
    let started = 0;

    for (const project of projects) {
      const tg = (project.config?.telegram as Record<string, unknown>) ?? {};
      if (!tg.botToken || !tg.chatId) continue;
      if (tg.autoStart === false) continue;

      try {
        await this.startBot(project.id);
        getAppLogger().info('telegram', `Auto-started bot for project "${project.name}"`);
        started++;
      } catch (err) {
        getAppLogger().logError('telegram', `Failed to auto-start bot for project "${project.name}"`, err);
        this.callbacks?.onStatusChanged?.(project.id, 'failed');
      }
    }

    if (started > 0) {
      getAppLogger().info('telegram', `Auto-started ${started} bot(s)`);
    }
  }

  isRunning(projectId: string): boolean {
    return this.activeBots.has(projectId);
  }

  getSessionId(projectId: string): string | null {
    return this.activeBots.get(projectId)?.botService.getSessionId() ?? null;
  }
}
