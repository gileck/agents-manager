# Phase 4: Dashboard + Polish

## Goal

Add a dashboard with stats and charts, activity feed, desktop notifications, cost tracking, and bulk task operations. This phase makes the app feel complete and polished.

By the end of this phase:
- Dashboard shows project health at a glance
- Activity feed tracks everything that happens
- Desktop notifications alert on agent completion/failure
- Cost tracking shows API spend per task/project
- Users can perform bulk operations on tasks

---

## Part A: Dashboard

### Dashboard Page (`/`)

Shows a project-level or global overview.

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Dashboard                        [Project: My App ▼]    │
├───────────────────┬─────────────────────────────────────┤
│                   │                                      │
│  Task Summary     │  Tasks by Status (bar chart)         │
│  ┌────┐ ┌────┐   │  ████████░░ Open: 8                  │
│  │ 24 │ │ 3  │   │  ██████░░░░ In Progress: 6           │
│  │total│ │run │   │  ████░░░░░░ Done: 4                  │
│  └────┘ └────┘   │  ██░░░░░░░░ Failed: 2                │
│  ┌────┐ ┌────┐   │                                      │
│  │ 12 │ │ 5  │   │                                      │
│  │done│ │open│   │                                      │
│  └────┘ └────┘   │                                      │
│                   │                                      │
├───────────────────┴─────────────────────────────────────┤
│                                                          │
│  Active Agents                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 🟢 Claude Code → "Add auth" - running 2m 15s    │   │
│  │ 🟢 Cursor → "Fix CSS bug" - running 45s         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Recent Activity                                         │
│  • Task "Add pagination" moved to Done (2 min ago)       │
│  • Agent completed on "Fix login" - success (5 min ago)  │
│  • Task "Refactor API" created (10 min ago)              │
│  • Agent failed on "Add tests" - timeout (15 min ago)    │
│                                                          │
├──────────────────────────────┬───────────────────────────┤
│                              │                            │
│  Completion Trend            │  Cost Summary              │
│  (line chart, last 7 days)   │  Today: $1.45              │
│                              │  This week: $12.30         │
│  ▁▂▃▄▅▆▇                    │  This month: $48.70        │
│  M T W T F S S               │  Avg per task: $0.85       │
│                              │                            │
└──────────────────────────────┴───────────────────────────┘
```

### Dashboard Components

- `StatCard` - large number with label (total tasks, active agents, etc.)
- `TaskStatusChart` - horizontal bar chart of tasks by status
- `ActiveAgentsList` - list of currently running agents with progress
- `ActivityFeed` - chronological list of recent events
- `CompletionTrendChart` - line chart of completed tasks over time
- `CostSummary` - cost breakdown by period

### Chart Library

Use a lightweight chart library. Options:
- **recharts** (React-native, composable) - recommended
- chart.js with react-chartjs-2
- Keep it simple - bar charts and line charts only

---

## Part B: Activity Feed

### Database Schema

#### `activity_log` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| project_id | TEXT | FK → projects.id |
| type | TEXT | Event type (see below) |
| entity_type | TEXT | 'task', 'agent_run', 'project' |
| entity_id | TEXT | ID of the related entity |
| title | TEXT | Human-readable summary |
| metadata | TEXT | JSON blob with event-specific data |
| created_at | TEXT (ISO) | Timestamp |

#### Event Types

| Type | Description | Example Title |
|------|-------------|---------------|
| `task.created` | New task created | Task "Add auth" created |
| `task.updated` | Task field changed | Task "Add auth" moved to In Progress |
| `task.deleted` | Task deleted | Task "Old feature" deleted |
| `agent.started` | Agent run started | Claude Code started on "Add auth" (plan) |
| `agent.completed` | Agent run succeeded | Claude Code completed "Add auth" in 2m 34s |
| `agent.failed` | Agent run failed | Claude Code failed on "Add auth": timeout |
| `agent.cancelled` | Agent run cancelled | Agent cancelled on "Add auth" |

### Activity Service

```typescript
class ActivityService {
  log(event: {
    projectId: string;
    type: string;
    entityType: string;
    entityId: string;
    title: string;
    metadata?: Record<string, any>;
  }): void

  list(filters: {
    projectId?: string;
    type?: string[];
    limit?: number;
    offset?: number;
  }): ActivityEvent[]
}
```

Activity events are created automatically by the TaskService and AgentService when things happen (not manually by the user).

---

## Part C: Desktop Notifications

### When to Notify

| Event | Notification |
|-------|-------------|
| Agent completed (success) | "Agent completed: {task.title}" |
| Agent failed | "Agent failed: {task.title} - {error}" |
| Agent timed out | "Agent timed out: {task.title}" |

### Implementation

Use Electron's `Notification` API:

```typescript
import { Notification } from 'electron';

function notifyAgentCompleted(task: Task, run: AgentRun) {
  const notification = new Notification({
    title: 'Agent Completed',
    body: `${run.agentType} finished "${task.title}" in ${formatDuration(run.durationMs)}`,
    silent: false
  });
  notification.on('click', () => {
    // Focus window and navigate to agent run detail
  });
  notification.show();
}
```

### Settings

Add notification preferences to Settings:
- Enable/disable notifications
- Notify on: success, failure, timeout (toggles for each)
- Sound on/off

---

## Part D: Cost Tracking

### Data Source

Token usage is already stored on `agent_runs.token_usage` from Phase 2.

### Cost Calculation

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;  // calculated based on model pricing
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },          // per 1M tokens
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
};

function calculateCost(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const pricing = MODEL_PRICING[model];
  return (usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) / 1_000_000;
}
```

### Cost Queries

```typescript
class CostService {
  getCostByPeriod(projectId: string, period: 'day' | 'week' | 'month'): number
  getCostByTask(taskId: string): number
  getCostByAgent(agentType: string, period: 'day' | 'week' | 'month'): number
  getCostTimeline(projectId: string, days: number): { date: string; cost: number }[]
}
```

### UI

- Cost shown on agent run detail page
- Cost summary on dashboard
- Cost column in agent runs table
- Cost per task on task detail page

---

## Part E: Workflow Visualizer

A read-only interactive graph view of the pipeline state machine, inspired by n8n's workflow visualization. Helps admins understand pipeline structure and track task progress visually.

### Route

`/projects/:id/workflow` (standalone page) + embedded in Task Detail and Pipeline Settings.

### Two Modes

**Pipeline Mode** — shows the full pipeline graph (statuses as nodes, transitions as edges). No task selected. Used to understand "what does this pipeline do?"

**Task Mode** — overlays a specific task's journey onto the graph. Shows the path taken (bold edges), current position (pulsing node), time spent in each status, and available next actions.

### Technology

- **@xyflow/react** (React Flow) — node-based graph rendering
- **dagre** — automatic DAG layout algorithm
- Custom node components for status cards (color-coded by category)
- Custom edge components for transition labels (trigger type, guards, hooks)

### Components

- `WorkflowVisualizer` — main graph component, accepts pipeline + optional task/history
- `StatusNode` — custom node: shows status label, category color, hooks indicator, time spent
- `TransitionEdge` — custom edge: shows label, trigger type (solid=manual, dashed=agent), guards indicator
- `TaskJourneyPanel` — bottom panel: linear timeline, stats (total time, loops, cost)
- `WorkflowLegend` — color/icon legend

### Interactions

- Zoom and pan (mouse wheel + drag)
- Hover node → tooltip with description, guards, hooks
- Hover edge → tooltip with trigger details
- Click node in task mode → jump to that status in the event log
- Keyboard shortcut: fit-to-view

### Where It Appears

| Location | Mode | Notes |
|----------|------|-------|
| Task Detail page | Task mode | Collapsible section showing this task's journey |
| Pipeline Settings | Pipeline mode | Full structure view for editing context |
| Standalone page | Either | Full-screen, select task from dropdown |
| Dashboard | Pipeline mode + counts | Mini version showing task distribution across statuses |

---

## Part F: Bulk Operations

### Supported Operations

- Change status of multiple tasks
- Change priority of multiple tasks
- Delete multiple tasks
- Assign agent to multiple tasks (queue - Phase 5 full version, but basic here)
- Add/remove tags to multiple tasks

### UI - Task List Table

```
┌──┬──────────────────┬──────────┬──────────┬─────┐
│☐ │ Title            │ Status   │ Priority │ ... │
├──┼──────────────────┼──────────┼──────────┼─────┤
│☑ │ Add login page   │ Open     │ High     │     │
│☑ │ Fix header CSS   │ Open     │ Medium   │     │
│☐ │ Update docs      │ Done     │ Low      │     │
│☑ │ Add pagination   │ Planned  │ High     │     │
└──┴──────────────────┴──────────┴──────────┴─────┘

[3 selected]  [Set Status ▼]  [Set Priority ▼]  [Add Tag]  [Delete]
```

**Components:**
- `BulkActionBar` - appears when 1+ tasks selected, shows available actions
- Checkbox column in task table
- "Select all" in column header

---

## Migration (Phase 4)

```sql
-- Migration 008: Create activity_log table
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_activity_project ON activity_log(project_id);
CREATE INDEX idx_activity_type ON activity_log(type);
CREATE INDEX idx_activity_created ON activity_log(created_at);
```

---

## Settings - Updated

Add to Settings:

**Notifications section:**
- Enable desktop notifications (toggle)
- Notify on success (toggle)
- Notify on failure (toggle)
- Notify on timeout (toggle)
- Notification sound (toggle)

---

## Deliverables Checklist

- [ ] Install recharts (or chosen chart lib)
- [ ] Dashboard page with stat cards
- [ ] Task status bar chart
- [ ] Active agents list on dashboard
- [ ] Completion trend line chart
- [ ] Activity log table + service
- [ ] Auto-log events in TaskService and AgentService
- [ ] Activity feed component on dashboard
- [ ] ActivityFeed page (full history with filters)
- [ ] Desktop notifications (Electron Notification API)
- [ ] Notification settings
- [ ] CostService with aggregation queries
- [ ] Cost summary on dashboard
- [ ] Cost display on agent run detail + task detail
- [ ] Bulk selection in task list table
- [ ] BulkActionBar with status/priority/tag/delete actions
- [ ] Bulk update IPC handlers
- [ ] Install @xyflow/react + dagre
- [ ] WorkflowVisualizer component (pipeline graph rendering)
- [ ] StatusNode + TransitionEdge custom components
- [ ] Pipeline mode (full graph, no task overlay)
- [ ] Task mode (task journey overlay, path highlighting, time stats)
- [ ] TaskJourneyPanel (linear timeline + stats)
- [ ] Standalone workflow page (`/projects/:id/workflow`)
- [ ] Embed in Task Detail (collapsible section)
- [ ] Embed mini version in Dashboard
