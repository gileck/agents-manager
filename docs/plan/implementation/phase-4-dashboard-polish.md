# Phase 4: Dashboard + Polish

> Dashboard with stats/charts, activity feed, cost tracking, notification channels, bulk operations, pipeline editor.

## Depends on: Phase 3 complete

---

## 4.1 — Dashboard Page (Stats + Overview)
**Vertical slice:** User sees project summary with stats on the home page.

- [ ] Dashboard page with stat cards (total tasks, by status, active agents, pending prompts)
- [ ] Task breakdown by status (bar chart or visual)
- [ ] Running agents summary with live status
- [ ] Recent activity feed (last 20 events)
- [ ] Quick actions (create task, start agent)
- [ ] `useDashboard()` hook
- [ ] `dashboard:stats` IPC handler with aggregated queries

**Arch docs:** `architecture/app-ui.md` (Dashboard)

---

## 4.2 — Cost Tracking Dashboard
**Vertical slice:** User can see agent costs broken down by project/task/agent/time.

- [ ] Cost summary cards (total spend, this week, this month)
- [ ] Cost by project (table/chart)
- [ ] Cost by agent type (pie chart)
- [ ] Cost by task (sorted by most expensive)
- [ ] Cost trend over time (line chart)
- [ ] Cost per successful vs failed run

**Arch docs:** `architecture/app-ui.md` (Dashboard Widgets)

---

## 4.3 — Activity Feed (Full Page)
**Vertical slice:** Dedicated activity page with filtering and search.

- [ ] Activity log page with timeline view
- [ ] Filter by: action type, entity type, date range
- [ ] Search activity entries
- [ ] Click entry → navigate to related entity (task, project, agent run)
- [ ] `useActivityLog()` hook

**Arch docs:** `architecture/app-ui.md` (Activity Feed)

---

## 4.4 — Notification Channels: Telegram
**Vertical slice:** User receives notifications and can respond to prompts via Telegram.

- [ ] `TelegramChannel` implementation using Telegram Bot API
- [ ] Bot setup instructions in settings
- [ ] Send notifications (agent completed, failed, prompt waiting)
- [ ] Receive prompt responses via inline buttons/keyboard
- [ ] Channel config (bot token, chat ID)
- [ ] Register in NotificationRouter

**Arch docs:** `architecture/notification-system.md` (Telegram)

---

## 4.5 — Notification Channels: Slack
**Vertical slice:** User receives notifications and can respond via Slack.

- [ ] `SlackChannel` implementation using Slack API
- [ ] Slack app setup instructions
- [ ] Send notifications with Block Kit formatting
- [ ] Receive prompt responses via Slack modals
- [ ] Channel config (bot token, channel ID)
- [ ] Register in NotificationRouter

**Arch docs:** `architecture/notification-system.md` (Slack)

---

## 4.6 — Notification Channels: Webhook
**Vertical slice:** Notifications POST to arbitrary webhook URLs.

- [ ] `WebhookChannel` implementation
- [ ] POST JSON payload on events
- [ ] Configurable URL and headers
- [ ] Optional response endpoint for prompts

**Arch docs:** `architecture/notification-system.md` (Webhook)

---

## 4.7 — Notification Preferences UI
**Vertical slice:** User configures which channels are active and for which events.

- [ ] Notification settings page
- [ ] Per-channel enable/disable
- [ ] Per-event type toggle (agent_completed, agent_failed, prompt_waiting, status_changed)
- [ ] Channel-specific configuration forms (tokens, URLs, chat IDs)
- [ ] Test notification button
- [ ] Quiet hours setting

**Arch docs:** `architecture/notification-system.md` (Preferences)

---

## 4.8 — Bulk Operations
**Vertical slice:** User can select multiple tasks and operate on them at once.

- [ ] Multi-select mode on task list (checkboxes)
- [ ] Bulk action bar (appears when tasks selected)
- [ ] Bulk status transition
- [ ] Bulk tag assignment
- [ ] Bulk priority update
- [ ] Bulk delete (with confirmation)
- [ ] Select all / select by filter

**Arch docs:** `architecture/tasks.md` (Bulk Operations)

---

## 4.9 — Workflow Visualizer
**Vertical slice:** User sees interactive pipeline diagram showing statuses and transitions.

- [ ] Pipeline visualizer page (`/projects/:id/workflow`)
- [ ] Visual diagram of pipeline statuses as nodes
- [ ] Arrows for transitions between statuses
- [ ] Current task counts per status shown on nodes
- [ ] Click status → filter tasks to that status
- [ ] Highlight valid transitions from current selection
- [ ] Guard and hook info on hover

**Arch docs:** `architecture/pipeline/ui.md` (Workflow Visualizer)

---

## 4.10 — Pipeline Editor
**Vertical slice:** User can create/edit custom pipelines.

- [ ] Pipeline editor page in settings
- [ ] Add/remove/reorder statuses
- [ ] Add/remove transitions with guard and hook selection
- [ ] Pipeline validation (all statuses reachable, at least one final status)
- [ ] Export pipeline as JSON
- [ ] Import pipeline from JSON
- [ ] Duplicate existing pipeline

**Arch docs:** `architecture/pipeline/json-contract.md` (Pipeline Editor)

---

## Phase 4 Acceptance Criteria
- Dashboard shows live stats, cost breakdown, recent activity
- Telegram/Slack notifications work bidirectionally
- Webhook notifications fire on events
- Bulk operations work on task list
- Pipeline visualizer shows interactive diagram
- Pipeline editor can create/modify custom pipelines
- Cost tracking shows per-project/task/agent breakdowns
