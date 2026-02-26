# Architecture Review: Notifications & External Integrations

**Date:** 2026-02-26
**Component:** Notifications & External Integrations
**Overall Score: 5.9 / 10**

## Files Reviewed

- `src/main/interfaces/notification-router.ts`, `telegram-bot-service.ts`
- `src/main/services/multi-channel-notification-router.ts`
- `src/main/services/desktop-notification-router.ts`
- `src/main/services/electron-notification-router.ts`
- `src/main/services/telegram-notification-router.ts`
- `src/main/services/stub-notification-router.ts`
- `src/main/services/telegram-bot-service.ts`
- `src/main/handlers/notification-handler.ts`
- `src/main/ipc-handlers.ts` (Telegram IPC section)

---

## 1. Summary of Findings

The notification subsystem uses a clean composite router pattern (`MultiChannelNotificationRouter` wrapping `INotificationRouter` implementations, dispatching with `Promise.allSettled`). Two active channels exist (Desktop and Telegram) plus a stub for testing. However, the subsystem is **entirely absent from production docs**, contains dead code (`ElectronNotificationRouter`), has a significant unhandled-error gap in Telegram polling, and has **zero test coverage**.

---

## 2. Doc Sufficiency Assessment

**Dedicated doc:** None. No `docs/notifications.md` exists.

**Plan-level doc:** `docs/plan/architecture/notification-system.md` describes a significantly more ambitious `INotificationChannel`/bidirectional prompt system that was never implemented.

**Coverage in `docs/architecture-overview.md`:** Partial. Mentions `DesktopNotificationRouter` vs `StubNotificationRouter` try/catch pattern. Does **not** mention `MultiChannelNotificationRouter`, `ElectronNotificationRouter`, `TelegramNotificationRouter`, or `TelegramBotService`.

**Coverage in `docs/event-system.md`:** None.

**Verdict:** The production notification system is effectively undocumented.

---

## 3. Implementation vs Docs Gaps

| Component | File | Documented? |
|---|---|---|
| `INotificationRouter` | `src/main/interfaces/notification-router.ts` | Partially (architecture-overview) |
| `MultiChannelNotificationRouter` | `src/main/services/multi-channel-notification-router.ts` | **No** |
| `DesktopNotificationRouter` | `src/main/services/desktop-notification-router.ts` | Partially |
| `ElectronNotificationRouter` | `src/main/services/electron-notification-router.ts` | **No (dead code)** |
| `TelegramNotificationRouter` | `src/main/services/telegram-notification-router.ts` | **No** |
| `StubNotificationRouter` | `src/main/services/stub-notification-router.ts` | Partially |
| `TelegramBotService` | `src/main/services/telegram-bot-service.ts` | **No** |
| Telegram IPC handlers | `src/main/ipc-handlers.ts:639–716` | **No** |

**Key divergence from plan doc:** The plan describes `INotificationChannel` with `isAvailable()`, `prompt()`, `broadcast()`. The actual interface is a minimal `INotificationRouter` with a single `send(notification)` method.

---

## 4. Bugs and Issues Found

### Bug 1 — Unhandled Telegram Polling Errors (P1)

**File:** `src/main/services/telegram-bot-service.ts:48`

`new TelegramBot(botToken, { polling: true })` emits `polling_error` events when connectivity fails or token is revoked. No handler is registered. The bot silently stops receiving messages with no indication to the operator.

**Fix:** Add `bot.on('polling_error', (err) => this.logError(err))`.

### Bug 2 — Dead Code: `ElectronNotificationRouter` (P3)

**File:** `src/main/services/electron-notification-router.ts`

Near-duplicate of `DesktopNotificationRouter`. Never imported or registered anywhere. The two differ only in click navigation destination.

**Fix:** Delete or merge into `DesktopNotificationRouter`.

### Bug 3 — `pendingActions` Map Never Expires (P2)

**File:** `src/main/services/telegram-bot-service.ts:28`

When a user starts `/create` but never sends a follow-up, the entry is held in memory indefinitely. No TTL, no cleanup on `stop()`.

**Fix:** Add timestamp and 5-minute TTL. Call `pendingActions.clear()` in `stop()`.

### Issue 4 — Callback Data Parsing Fragile (P1)

**File:** `src/main/services/telegram-bot-service.ts:138`

`t:<taskId>:<status>` parsing uses `indexOf(':', 2)`. If `taskId` ever contains `:`, parsing breaks silently. Currently safe (ULIDs don't contain colons) but fragile.

**Fix:** Use a separator that cannot appear in IDs (e.g., `|`).

### Issue 5 — No Input Length Validation in Bot Handlers (P2)

**File:** `src/main/services/telegram-bot-service.ts:284–308`

Free-text from Telegram users accepted with no length cap. Arbitrarily long strings passed to `workflowService.createTask()`.

### Issue 6 — `notificationRouter.send()` Swallowed Silently in AgentService (P2)

**File:** `src/main/services/agent-service.ts:963–970`

`send()` is async but not awaited. The surrounding `try/catch` catches nothing from the async path. Unhandled promise rejections can leak.

### Issue 7 — Telegram Config Accessed with Unchecked Casts (P2)

**File:** `src/main/ipc-handlers.ts:659–664`

No validation that `chatId` is numeric or `botToken` matches expected format. Incorrectly configured projects fail with opaque Telegram API errors.

---

## 5. Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Modularity** | 8 | Clean interface, separate routers per channel, composite pattern |
| **Low Coupling** | 6 | `TelegramBotService` takes 5 service deps; global settings accessed directly in `handleCreateTask` |
| **High Cohesion** | 6 | `TelegramBotService` conflates bot commands, task CRUD, pipeline transitions, and notifications in one 340-line class |
| **Clear and Constrained State** | 5 | `pendingActions` Map never expires; bot state has no invariant enforcement |
| **Deterministic Behavior** | 5 | Telegram polling errors non-deterministic (unhandled); pending action state open-ended |
| **Explicit Dependency Structure** | 7 | `BotDeps` struct explicit; `notificationRouter` in `AgentService` is optional when it should be required |
| **Observability** | 4 | Only `console.error` on failures; no event log entries; Telegram messages logged via callback only when configured |
| **Robust Error Handling** | 4 | Missing `polling_error` handler; unawaited `send()` in AgentService; no input validation |
| **Simplicity of Structure** | 7 | Individual routers are simple; dead code adds confusion |
| **Performance Predictability** | 7 | `Promise.allSettled` gives bounded parallel dispatch; Telegram polling model appropriate |

**Overall: 5.9 / 10**

---

## 6. Action Items (Prioritized)

### P1 — Bugs / Stability Risks

1. **Add `polling_error` handler** to `TelegramBot` in `TelegramBotService.start()`
2. **Fix callback data parsing** — use separator that can't appear in IDs
3. **Await and handle `notificationRouter.send()`** in `AgentService`

### P2 — Reliability

4. **Add TTL expiry for `pendingActions`** (5-minute timeout)
5. **Log notification failures to event system** (not just `console.error`)
6. **Validate Telegram config** (`botToken`, `chatId`) before starting bot
7. **Add input length validation** in bot handlers

### P3 — Code Quality

8. **Remove `ElectronNotificationRouter`** (dead code)
9. **Extract TelegramBotService command handlers** into separate module
10. **Write `docs/notifications.md`** documenting the actual implementation
11. **Update `docs/architecture-overview.md`** — `StubNotificationRouter` fallback description is wrong
12. **Add tests** for notification subsystem using `StubNotificationRouter`
