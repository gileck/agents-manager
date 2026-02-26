# Plan 07: Notifications (7.4 → 9+)

## Gap Analysis

- **`notificationRouter` is optional in AgentService** — Can silently skip notifications; should be required
- **Telegram config validation duplicated** — Both IPC handler and CLI command validate independently
- **`TelegramBotService` allows double-start** — No guard against calling `start()` twice
- **`handleCallback` crashes on malformed data** — Missing guard for `sep === -1` with `t|` and `ef|` prefixes
- **`activeBots` Map is function-scoped** — Re-created per handler registration in `telegram-handlers.ts`
- **`MultiChannelNotificationRouter` error context is sparse** — No task ID or router identity in error logs
- **No unit tests for notification routing**

## Changes

### 1. Make `notificationRouter` required in AgentService

**File:** `src/main/services/agent-service.ts`

- Remove `?` from `notificationRouter` constructor parameter
- Change `?.send()` calls to `.send()`
- Update test constructors to pass `new StubNotificationRouter()`

### 2. Extract telegram config validation

**File:** `src/main/services/telegram-config-validator.ts` (new)

Create `validateTelegramConfig(token: string, chatId: string)` that throws descriptive errors.

Update both `src/main/ipc-handlers/telegram-handlers.ts` and `src/cli/commands/telegram.ts` to use it.

### 3. Add double-start guard in `TelegramBotService.start()`

**File:** `src/main/services/telegram-bot-service.ts`

Add at top of `start()`:
```ts
if (this.running) throw new Error('TelegramBotService is already running');
```

### 4. Guard `handleCallback` against `sep === -1`

**File:** `src/main/services/telegram-bot-service.ts`

Add early return for malformed callback data:
```ts
if (sep === -1) return;
```
For both `t|` and `ef|` prefix handlers.

### 5. Lift `activeBots` to module scope

**File:** `src/main/ipc-handlers/telegram-handlers.ts`

Move the `activeBots` Map and `before-quit` listener to module-level scope with a double-registration guard.

### 6. Add structured error context to `MultiChannelNotificationRouter`

**File:** `src/main/services/multi-channel-notification-router.ts`

Include notification `taskId` and router identity/name in error log messages.

### 7. Write notification tests

**File:** `tests/unit/multi-channel-notification-router.test.ts` (new)

Test cases:
- Fan-out: notification dispatched to all registered channels
- Failure isolation: one channel failure doesn't affect others
- Add/remove lifecycle: channels can be added and removed

## Files to Modify

| File | Action |
|------|--------|
| `src/main/services/agent-service.ts` | Edit (make notificationRouter required) |
| `src/main/services/telegram-config-validator.ts` | Create |
| `src/main/services/telegram-bot-service.ts` | Edit (double-start guard, callback guard) |
| `src/main/ipc-handlers/telegram-handlers.ts` | Edit (lift activeBots, use validator) |
| `src/cli/commands/telegram.ts` | Edit (use validator) |
| `src/main/services/multi-channel-notification-router.ts` | Edit (structured errors) |
| `tests/unit/multi-channel-notification-router.test.ts` | Create |

## Complexity

Medium (~4 hours)
