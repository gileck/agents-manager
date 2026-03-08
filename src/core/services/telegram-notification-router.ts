import type TelegramBot from 'node-telegram-bot-api';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { Notification, NotificationAction } from '../../shared/types';
import { getAppLogger } from './app-logger';

export class TelegramNotificationRouter implements INotificationRouter {
  private bot: TelegramBot;
  private chatId: string;
  private messageThreadId: number | undefined;

  constructor(bot: TelegramBot, chatId: string) {
    this.bot = bot;
    // Support "chatId:threadId" format for sending to a specific forum topic
    const colonIdx = chatId.lastIndexOf(':');
    if (colonIdx > 0) {
      const threadPart = parseInt(chatId.slice(colonIdx + 1), 10);
      if (!isNaN(threadPart)) {
        this.chatId = chatId.slice(0, colonIdx);
        this.messageThreadId = threadPart;
        return;
      }
    }
    this.chatId = chatId;
  }

  async send(notification: Notification): Promise<void> {
    const text = `*${this.escapeMarkdown(notification.title)}*\n${this.escapeMarkdown(notification.body)}`;
    const options: TelegramBot.SendMessageOptions = {
      parse_mode: 'MarkdownV2',
      ...(this.messageThreadId ? { message_thread_id: this.messageThreadId } : {}),
    };

    if (notification.actions && notification.actions.length > 0) {
      options.reply_markup = {
        inline_keyboard: this.buildInlineKeyboard(notification.actions),
      };
    }

    try {
      await this.bot.sendMessage(this.chatId, text, options);
    } catch (err) {
      getAppLogger().logError('TelegramNotificationRouter', 'MarkdownV2 send failed, retrying as plain text', err);
      // Retry as plain text with keyboard preserved
      const plainText = `${notification.title}\n${notification.body}`;
      const fallbackOptions: TelegramBot.SendMessageOptions = {
        ...(this.messageThreadId ? { message_thread_id: this.messageThreadId } : {}),
      };
      if (options.reply_markup) {
        fallbackOptions.reply_markup = options.reply_markup;
      }
      await this.bot.sendMessage(this.chatId, plainText, fallbackOptions);
    }
  }

  private buildInlineKeyboard(actions: NotificationAction[]): TelegramBot.InlineKeyboardButton[][] {
    const buttons: TelegramBot.InlineKeyboardButton[] = actions.map(action => {
      if ('url' in action && action.url) {
        return { text: action.label, url: action.url };
      }
      return { text: action.label, callback_data: action.callbackData };
    });

    // Group into rows of max 3 buttons
    const rows: TelegramBot.InlineKeyboardButton[][] = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(buttons.slice(i, i + 3));
    }
    return rows;
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }
}
