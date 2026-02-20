import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { requireProject } from '../context';
import { getResolvedConfig } from '../../main/services/config-service';
import { TelegramBotService } from '../../main/services/telegram-bot-service';
import { TelegramNotificationRouter } from '../../main/services/telegram-notification-router';

export function registerTelegramCommands(program: Command, getServices: () => AppServices): void {
  const telegram = program.command('telegram').description('Telegram bot integration');

  telegram
    .command('start')
    .description('Start the Telegram bot (long-running)')
    .action(async () => {
      const opts = program.opts() as { project?: string };
      const services = getServices();
      const project = await requireProject(services, opts.project);

      const config = getResolvedConfig(project.path ?? undefined);
      const botToken = config.telegram?.botToken;
      const chatId = config.telegram?.chatId;
      if (!botToken || !chatId) {
        console.error(
          'Telegram is not configured. Set telegram.botToken and telegram.chatId in your project config:\n' +
          `  <projectPath>/.agents-manager/config.json`,
        );
        process.exitCode = 1;
        return;
      }

      const botService = new TelegramBotService({
        taskStore: services.taskStore,
        projectStore: services.projectStore,
        pipelineStore: services.pipelineStore,
        pipelineEngine: services.pipelineEngine,
        workflowService: services.workflowService,
      });

      await botService.start(project.id, botToken, chatId);

      // Reuse the single bot instance for notifications to avoid Telegram 409 conflicts
      const bot = botService.getBot()!;
      const telegramRouter = new TelegramNotificationRouter(bot, chatId);
      services.notificationRouter.addRouter(telegramRouter);

      console.log(`Telegram bot started for project "${project.name}". Press Ctrl+C to stop.`);

      await new Promise<void>((resolve) => {
        let resolved = false;
        const shutdown = () => {
          if (resolved) return;
          resolved = true;
          console.log('\nShutting down Telegram bot...');
          services.notificationRouter.removeRouter(telegramRouter);
          botService.stop().then(resolve, resolve);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
      });
    });

  telegram
    .command('status')
    .description('Show Telegram configuration status')
    .action(async () => {
      const opts = program.opts() as { project?: string };
      const services = getServices();
      const project = await requireProject(services, opts.project);

      const config = getResolvedConfig(project.path ?? undefined);
      const hasBotToken = !!config.telegram?.botToken;
      const hasChatId = !!config.telegram?.chatId;

      console.log(`Project: ${project.name}`);
      console.log(`Bot Token: ${hasBotToken ? 'configured' : 'not set'}`);
      console.log(`Chat ID: ${hasChatId ? config.telegram!.chatId : 'not set'}`);
      console.log(`Status: ${hasBotToken && hasChatId ? 'ready' : 'not configured'}`);
    });
}
