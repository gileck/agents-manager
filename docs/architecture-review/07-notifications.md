# Architecture Review: Notifications & External Integrations

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** Notifications & External Integrations
**Previous Score: 7.4 / 10**
**Updated Score: 8.7 / 10**

## Round 2 Changes Implemented

1. **`notificationRouter` made required in `AgentService` constructor** (P2) -- The parameter at position 14 is now `notificationRouter: INotificationRouter` without the `?` optional marker. All call sites (including `test-context.ts`) pass a concrete instance (`StubNotificationRouter` for tests). The `?.send()` calls are now `.send()`, eliminating silent notification drops.

2. **Shared `telegram-config-validator.ts` extracted** (P2) -- New file `src/main/services/telegram-config-validator.ts` exports `validateTelegramConfig(botToken, chatId)` with regex-based format checks. Both the IPC handler (`telegram-handlers.ts` line 41) and the CLI command (`telegram.ts` line 24) now delegate to the same validator, removing duplicated and inconsistent validation logic.

3. **`TelegramBotService` double-start guard** (P2) -- `start()` now throws `'TelegramBotService is already running'` if `this.running` is already `true` (line 54). This prevents creating duplicate polling connections and leaking the prior bot instance.

4. **`handleCallback` separator guard** (P3) -- Both `t|` and `ef|` prefix handlers now check `if (sep === -1) return;` before slicing. Malformed callback data with a missing second `|` is silently ignored rather than producing corrupt `taskId`/`status` values.

5. **`activeBots` Map lifted to module scope** (P2) -- In `telegram-handlers.ts`, `activeBots` is now a module-level `Map` (line 13) with a `quitListenerRegistered` boolean guard (line 16) that ensures `before-quit` cleanup is registered exactly once. This prevents re-creation on each call to `registerTelegramHandlers()` and ensures all bots are cleaned up on quit.

6. **Structured error context in `MultiChannelNotificationRouter`** (P2) -- The `send()` method now includes the router's class name (`constructor.name`) and the notification's `taskId` in error log messages (line 25-29). This gives operators enough context to identify which channel failed and for which task.

7. **Unit tests for `MultiChannelNotificationRouter`** (P2) -- New test file `tests/unit/multi-channel-notification-router.test.ts` with 5 test cases covering: fan-out dispatch to all channels, failure isolation (one failure does not block others), add/remove lifecycle, empty router list (no-throw), and removing a non-existent router (no-op). All 5 tests pass.

## Round 2 Remaining Issues

1. **`TELEGRAM_TEST` handler does not use shared validator** (P3) -- The `TELEGRAM_TEST` IPC handler (line 82-96 in `telegram-handlers.ts`) still performs its own basic presence check (`if (!botToken || !chatId)`) rather than calling `validateTelegramConfig()`. The test endpoint could accept a token with an invalid format and send it to the Telegram API, which would simply fail with a less descriptive error. Low severity since the Telegram API itself rejects invalid tokens.

2. **`TelegramNotificationRouter` has no retry or timeout** (P3) -- `send()` directly calls `bot.sendMessage()` with no timeout or retry. A Telegram API outage would cause the `Promise.allSettled` result to hang until the underlying HTTP library times out (typically 30+ seconds). This is acceptable given the fire-and-forget nature of notifications, but a configurable timeout would improve resilience.

3. **`MultiChannelNotificationRouter` error logging uses `console.error` only** (P3) -- Router-level failures are logged to `console.error` but not to the structured `taskEventLog`. The caller in `AgentService` (lines 747-763) already catches and logs notification failures to the task event log, so there is a structured record -- but channels that fail inside the composite router only get `console.error` output. This is a minor observability gap.

4. **No integration test for Telegram bot service** (P3) -- `TelegramBotService` has no test coverage. The service depends on `node-telegram-bot-api` which makes integration testing difficult without mocking the library. Unit-level testing of `handleCallback` parsing and `pendingActions` TTL logic would improve confidence but is low priority given the defensive guards now in place.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 8 | 9 | Extracted shared validator, clean channel separation |
| Low Coupling | 7 | 8 | Required dependency injection, no optional holes |
| High Cohesion | 7 | 8 | Validator, bot service, router each have single responsibility |
| Clear and Constrained State | 8 | 9 | Double-start guard, module-scoped activeBots, TTL cleanup |
| Deterministic Behavior | 8 | 9 | Malformed callback guard, validated config before use |
| Explicit Dependency Structure | 7 | 9 | notificationRouter required; StubNotificationRouter for tests |
| Observability | 7 | 8 | Structured error context with router name + taskId |
| Robust Error Handling | 8 | 9 | All P1/P2 gaps closed; only P3 edge cases remain |
| Simplicity of Structure | 9 | 9 | No unnecessary complexity added |
| Docs | 9 | 9 | Documentation remains complete |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 -- All dispatch, validation, and lifecycle logic is sound |
| **Bugs** | 8/10 -- All P1/P2 bugs fixed; only cosmetic P3 items remain |
| **Docs** | 9/10 -- Complete dedicated doc, inline JSDoc on validator |
| **Code Quality** | 9/10 -- Clean separation, shared utilities, required dependencies, tests |

**Overall: 8.7 / 10** (up from 7.4)
