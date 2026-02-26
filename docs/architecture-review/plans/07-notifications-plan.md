# Implementation Plan: Notifications Architecture Fixes

**Review:** `docs/architecture-review/07-notifications.md`
**Current Score:** 5.9 / 10
**Target Score:** ~9 / 10
**Priority Order:** logic > docs > bugs > tests > code quality

---

## Dependency Graph

```
Item 1 (polling_error) ── standalone
Item 2 (callback separator) ── standalone
Item 3+5 (await send + log) ── combined, standalone
Item 4 (pendingActions TTL) ── standalone
Item 6 (validate config) ── standalone
Item 7 (input length validation) ── standalone
Item 8 (remove dead code) ── standalone
Item 10 (write docs) ── depends on Items 1-8
Item 11 (update architecture-overview) ── depends on Item 8
```

---

## Item 1 (P1): Add `polling_error` handler to TelegramBot

**File:** `src/main/services/telegram-bot-service.ts`
**Complexity:** Small

After line 48 (`new TelegramBot(botToken, { polling: true })`), register:
```typescript
this.bot.on('polling_error', (err: Error) => {
  this.logError(err);
  this.log('in', `[polling_error] ${err.message}`);
});
```

---

## Item 2 (P1): Fix callback data parsing separator

**File:** `src/main/services/telegram-bot-service.ts`
**Complexity:** Small

Replace `:` with `|` as separator in all callback_data strings and all parsing sites in `handleCallback()`. ULIDs cannot contain `|`.

---

## Item 3+5 (P1+P2): Await `notificationRouter.send()` and log failures

**File:** `src/main/services/agent-service.ts` (lines 962-970)
**Complexity:** Small

Add `await` to the `send()` call, catch errors and log to `taskEventLog` with severity `warning`.

---

## Item 4 (P2): Add TTL expiry for `pendingActions`

**File:** `src/main/services/telegram-bot-service.ts`
**Complexity:** Medium

1. Add `createdAt: number` to `PendingAction` interface
2. Add 5-minute TTL constant and cleanup interval (60s)
3. Set `createdAt` when adding entries
4. Start cleanup interval in `start()`, clear in `stop()`
5. Check TTL when consuming pending actions

---

## Item 6 (P2): Validate Telegram config before starting bot

**Files:** `src/main/ipc-handlers.ts`, `src/main/services/telegram-bot-service.ts`
**Complexity:** Small

Validate `botToken` matches `/^\d+:[A-Za-z0-9_-]+$/` and `chatId` matches `/^-?\d+$/` in the IPC handler before starting the bot.

---

## Item 7 (P2): Add input length validation in bot handlers

**File:** `src/main/services/telegram-bot-service.ts`
**Complexity:** Small

Add `MAX_INPUT_LENGTH = 2000` constant. Validate in message handler before processing free-text input.

---

## Item 8 (P3 -- Quick Win): Remove `ElectronNotificationRouter` dead code

**Delete:** `src/main/services/electron-notification-router.ts`
**Complexity:** Small

Never imported or instantiated. Near-duplicate of `DesktopNotificationRouter`.

---

## Item 11 (P3 -- Quick Win): Update `docs/architecture-overview.md`

**File:** `docs/architecture-overview.md`
**Complexity:** Small

Replace the NotificationRouter subsection with accurate content describing `MultiChannelNotificationRouter`, `DesktopNotificationRouter`, `TelegramNotificationRouter`, and `StubNotificationRouter`.

---

## Item 10 (P3 -- Quick Win): Write `docs/notifications.md`

**File:** New `docs/notifications.md`
**Complexity:** Medium

Document: architecture (composite router pattern), notification sources (pipeline hooks + agent completion), Telegram bot commands and lifecycle, configuration, and testing with `StubNotificationRouter`.

---

## Implementation Order

| Step | Item | Priority | Complexity |
|------|------|----------|------------|
| 1 | Item 1: polling_error handler | P1 | Small |
| 2 | Item 2: Callback separator | P1 | Small |
| 3 | Items 3+5: Await send + event logging | P1+P2 | Small |
| 4 | Item 4: pendingActions TTL | P2 | Medium |
| 5 | Item 6: Validate Telegram config | P2 | Small |
| 6 | Item 7: Input length validation | P2 | Small |
| 7 | Item 8: Remove dead code | P3 | Small |
| 8 | Item 11: Update architecture docs | P3 | Small |
| 9 | Item 10: Write notifications doc | P3 | Medium |

**Estimated total effort:** ~3-4 hours

**Items excluded:** Item 9 (extract command handlers -- larger refactor), Item 12 (tests -- follow-up).
