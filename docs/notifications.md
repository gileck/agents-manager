---
title: Notifications
description: Notification architecture, channels, Telegram bot, and configuration
summary: The notification subsystem uses a composite router pattern (MultiChannelNotificationRouter) dispatching to Desktop and Telegram channels. TelegramBotService provides bidirectional task management via Telegram commands.
priority: 7
key_points:
  - "MultiChannelNotificationRouter dispatches to all registered INotificationRouter channels via Promise.allSettled"
  - "Two active channels: DesktopNotificationRouter (native OS) and TelegramNotificationRouter (Telegram chat)"
  - "TelegramBotService provides bidirectional task management via /tasks, /task, /create, /help commands"
  - "StubNotificationRouter collects notifications in-memory for testing"
---
# Notifications

Architecture, channels, Telegram bot lifecycle, and configuration.

## Architecture

The notification subsystem uses the **composite router pattern**. `MultiChannelNotificationRouter` implements `INotificationRouter` and wraps an array of channel-specific routers. When `send()` is called, it dispatches to all registered routers in parallel via `Promise.allSettled`, logging any individual channel failures without blocking other channels.

```
INotificationRouter (interface)
├── MultiChannelNotificationRouter (composite — dispatches to all children)
│   ├── DesktopNotificationRouter (macOS native notifications)
│   ├── TelegramNotificationRouter (Telegram chat messages)
│   └── ... (additional channels can be added)
└── StubNotificationRouter (in-memory collector for testing)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/main/interfaces/notification-router.ts` | `INotificationRouter` interface with `send(notification)` method |
| `src/main/services/multi-channel-notification-router.ts` | Composite router with `addRouter()` / `removeRouter()` |
| `src/main/services/desktop-notification-router.ts` | macOS native notifications via Electron; navigates to task on click |
| `src/main/services/telegram-notification-router.ts` | Sends MarkdownV2-formatted messages to a configured Telegram chat |
| `src/main/services/stub-notification-router.ts` | In-memory notification collector for testing |
| `src/main/services/telegram-bot-service.ts` | Bidirectional Telegram bot with task management commands |
| `src/main/ipc-handlers/telegram-handlers.ts` | IPC handlers for starting/stopping the Telegram bot |
| `src/main/handlers/notification-handler.ts` | Pipeline hook that sends notifications on status transitions |

## Notification Sources

Notifications are triggered from two places:

1. **Pipeline hooks** (`src/main/handlers/notification-handler.ts`): Registered as a `notify` hook on the pipeline engine. Fires after successful status transitions, sending templated messages through the composite router.

2. **Agent completion** (`src/main/services/agent-service.ts`): After an agent run completes or fails, a notification is sent via the composite router. The `send()` call is awaited and failures are logged to `taskEventLog` with severity `warning`.

## Channels

### DesktopNotificationRouter

Uses Electron's native notification API (`@template/main/services/notification`). Clicking the notification brings the app window to the foreground and navigates to the task detail page.

Loaded via dynamic `require()` with try/catch fallback to `StubNotificationRouter` when Electron APIs are unavailable (e.g., in the CLI).

### TelegramNotificationRouter

Wraps a `TelegramBot` instance and sends MarkdownV2-formatted messages to a configured chat ID. Dynamically added to / removed from the composite router when the Telegram bot is started / stopped.

### StubNotificationRouter

Collects all notifications in a `sent` array with timestamps. Use `clear()` to reset. Intended for testing — avoids side effects while allowing assertions on notification content.

## Telegram Bot

### Lifecycle

1. User configures `botToken` and `chatId` in project settings
2. User clicks "Start Bot" in the UI, triggering the `TELEGRAM_BOT_START` IPC handler
3. Handler validates token format (`/^\d+:[A-Za-z0-9_-]+$/`) and chat ID format (`/^-?\d+$/`)
4. `TelegramBotService.start()` creates a `TelegramBot` with long-polling, registers command handlers, and starts a pending-actions cleanup interval
5. A `TelegramNotificationRouter` is created and added to the composite router
6. On stop, the bot is removed from the composite router, polling stops, and pending actions are cleared

### Commands

| Command | Description |
|---------|-------------|
| `/tasks` | List all tasks in the project with inline keyboard buttons |
| `/task <id>` | Show task details with Transition / Edit / Delete actions |
| `/create` | Start task creation flow (prompts for title) |
| `/help` | Show available commands |

### Callback Data Format

Inline keyboard buttons use `|` as the separator between prefix and data fields (e.g., `t|<taskId>|<status>`). The `|` character cannot appear in ULIDs, preventing ambiguous parsing.

| Prefix | Format | Action |
|--------|--------|--------|
| `v\|` | `v\|<taskId>` | View task detail |
| `ts\|` | `ts\|<taskId>` | Show available transitions |
| `t\|` | `t\|<taskId>\|<status>` | Execute transition |
| `e\|` | `e\|<taskId>` | Show editable fields |
| `ef\|` | `ef\|<taskId>\|<field>` | Prompt for new field value |
| `d\|` | `d\|<taskId>` | Confirm delete |
| `cd\|` | `cd\|<taskId>` | Execute delete |

### Pending Actions

When a command requires follow-up input (e.g., `/create` prompts for a title), the bot stores a `PendingAction` keyed by chat ID. Pending actions have:

- A **5-minute TTL** — expired actions are rejected when consumed and cleaned up by a 60-second interval timer
- Cleanup on `stop()` — all pending actions and the cleanup interval are cleared

### Input Validation

Free-text input from Telegram users is limited to 2000 characters. Messages exceeding this limit are rejected with an error message.

### Error Handling

- **Polling errors**: A `polling_error` handler logs connectivity and token issues
- **Command errors**: Each handler catches and logs errors via `logError`
- **Notification failures**: Caught and logged to `taskEventLog` (not silently swallowed)

## Configuration

Telegram bot configuration is stored per-project in `project.config.telegram`:

```typescript
{
  telegram: {
    botToken: string;  // Format: <number>:<alphanumeric-string>
    chatId: string;    // Format: numeric, optionally prefixed with -
  }
}
```

Both values are validated in the IPC handler before the bot is started.

## Testing

Use `StubNotificationRouter` in tests to verify notification behavior without side effects:

```typescript
const stub = new StubNotificationRouter();
// ... run code that triggers notifications ...
expect(stub.sent).toHaveLength(1);
expect(stub.sent[0].notification.title).toBe('Agent completed');
stub.clear();
```
