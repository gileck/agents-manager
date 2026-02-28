import type TelegramBot from 'node-telegram-bot-api';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { Notification } from '../../shared/types';

export class TelegramNotificationRouter implements INotificationRouter {
  private bot: TelegramBot;
  private chatId: string;

  constructor(bot: TelegramBot, chatId: string) {
    this.bot = bot;
    this.chatId = chatId;
  }

  async send(notification: Notification): Promise<void> {
    const text = `*${this.escapeMarkdown(notification.title)}*\n${this.escapeMarkdown(notification.body)}`;
    await this.bot.sendMessage(this.chatId, text, { parse_mode: 'MarkdownV2' });
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }
}
