# Architecture Review: Notifications & External Integrations

**Date:** 2026-02-26 (re-review)
**Component:** Notifications & External Integrations
**Previous Score: 5.9 / 10**
**Updated Score: 7.4 / 10**

## What Was Fixed

1. **Unhandled Telegram polling errors** (P1) — `polling_error` handler registered, failures surfaced to operator log.
2. **Callback separator `:` to `|`** (P1) — ULIDs cannot contain `|`, preventing ambiguous parsing.
3. **`pendingActions` TTL** (P2) — 5-minute TTL with 60-second background sweep and per-action check. `stop()` clears map and interval.
4. **Awaited `send()` with error logging** (P2) — `agent-service.ts:963-979` awaits send, logs failures to task event log with `severity: 'warning'`.
5. **Telegram config validation** (P2) — Token and chat ID format validated with regex before creating bot.
6. **Input length validation** (P2) — 2000-character max for free-text messages.
7. **Dead code removed** (P3) — `electron-notification-router.ts` deleted.
8. **Documentation gap closed** — `docs/notifications.md` created covering architecture, lifecycle, commands, validation, and error handling.

## Remaining Issues

1. **`notificationRouter` still optional in `AgentService` constructor** (P2) — Should be required; `StubNotificationRouter` exists for tests.
2. **CLI telegram path does not validate token/chatId format** (P2) — IPC handler was fixed but CLI was not.
3. **`TelegramBotService` has no internal double-start guard** (P2) — Guard lives in caller, not in service.
4. **`handleCallback` does not guard against malformed second separators** (P3) — If `sep === -1`, produces subtly wrong slices.
5. **Zero test coverage** (P2) — `StubNotificationRouter` is production-ready but never exercised.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 8 | 8 | Clean interface separation |
| Low Coupling | 6 | 7 | `BotDeps` struct justified |
| High Cohesion | 6 | 7 | Pending state machine well-contained |
| Clear and Constrained State | 5 | 8 | TTL, cleanup interval, `stop()` clear |
| Deterministic Behavior | 5 | 8 | Polling errors handled, sends awaited |
| Explicit Dependency Structure | 7 | 7 | `notificationRouter?` optional smell |
| Observability | 4 | 7 | Failures logged to taskEventLog |
| Robust Error Handling | 4 | 8 | All P1/P2 error gaps closed in Electron path |
| Simplicity of Structure | 7 | 9 | Dead code removed |
| Docs | 2 | 9 | Complete `docs/notifications.md` created |

| Category | Score |
|----------|:-----:|
| **Logic** | 8/10 — Core dispatch logic correct and well-structured |
| **Bugs** | 7/10 — Critical bugs fixed; P2/P3 edge cases remain |
| **Docs** | 9/10 — Complete dedicated doc covering all components |
| **Code Quality** | 7/10 — Clean within each file; optional-field smell and missing CLI validation |

**Overall: 7.4 / 10** (up from 5.9)
