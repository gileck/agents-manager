import type TelegramBot from 'node-telegram-bot-api';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { Notification, NotificationAction } from '../../shared/types';

export class TelegramNotificationRouter implements INotificationRouter {
  private bot: TelegramBot;
  private chatId: string;

  constructor(bot: TelegramBot, chatId: string) {
    this.bot = bot;
    this.chatId = chatId;
  }

  async send(notification: Notification): Promise<void> {
    const text = `*${this.escapeMarkdown(notification.title)}*\n${this.escapeMarkdown(notification.body)}`;
    const options: TelegramBot.SendMessageOptions = { parse_mode: 'MarkdownV2' };

    if (notification.actions && notification.actions.length > 0) {
      options.reply_markup = {
        inline_keyboard: this.buildInlineKeyboard(notification.actions),
      };
    }

    try {
      await this.bot.sendMessage(this.chatId, text, options);
    } catch (err) {
      console.error('[telegram-notification] MarkdownV2 send failed, retrying as plain text:', err);
      // Retry as plain text with keyboard preserved
      const plainText = `${notification.title}\n${notification.body}`;
      const fallbackOptions: TelegramBot.SendMessageOptions = {};
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
