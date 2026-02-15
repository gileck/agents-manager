# Pipeline UI Integration

How the pipeline system integrates with the Electron app UI — kanban board, workflow visualizer, pipeline editor, React hooks, and IPC channels.

See also: [engine.md](engine.md) | [json-contract.md](json-contract.md) | [outcome-schemas.md](outcome-schemas.md) | [event-log.md](event-log.md) | [errors.md](errors.md)

---

## UI Integration

### Kanban Board

The board reads statuses from the pipeline definition, not from a hardcoded list.

```typescript
// Board dynamically builds columns from the pipeline
function KanbanBoard({ projectId }: Props) {
  const pipeline = usePipeline(projectId);
  const tasks = useTasks(projectId);

  // Columns come from pipeline statuses, ordered by position
  const columns = pipeline.statuses
    .sort((a, b) => a.position - b.position)
    .map(status => ({
      ...status,
      tasks: tasks.filter(t => t.status === status.id),
    }));

  return <Board columns={columns} />;
}
```

Adding a new status to the pipeline → kanban automatically shows a new column. Zero UI code changes.

### Status Dropdown / Transition Buttons

Instead of showing all statuses, show only **valid transitions**:

```typescript
function TaskStatusActions({ taskId }: Props) {
  const validTransitions = useValidTransitions(taskId);

  return (
    <div>
      {validTransitions.map(vt => (
        <button
          key={vt.transition.id}
          disabled={!vt.allowed}
          title={vt.blockedBy?.join(', ')}
          onClick={() => executeTransition(taskId, vt.transition.to)}
        >
          {vt.transition.label}
        </button>
      ))}
    </div>
  );
}
```

User only sees actions they can actually take. If a guard blocks a transition, the button is disabled with a tooltip explaining why.

### Workflow Visualizer (Read-Only Graph)

An interactive visual graph of the pipeline — similar to n8n's workflow view, but read-only. This is the primary tool for admins to understand "what is this pipeline doing?" and "where is my task?"

**Two modes:**

#### 1. Pipeline View (no task selected)

Shows the full pipeline definition as a directed graph. Useful for understanding the pipeline structure itself.

```
┌─────────────────────────────────────────────────────────────────┐
│ Workflow Visualizer            Pipeline: Standard [▼]            │
│                                                                  │
│                                                                  │
│   ┌──────┐     ┌──────────┐     ┌────────┐                      │
│   │ Open │────→│ Planning │────→│Planned │                      │
│   │      │     │  ⚙ agent │     │        │                      │
│   └──┬───┘     └──────────┘     └───┬────┘                      │
│      │                              │                            │
│      │   "skip plan"                │  "implement"               │
│      │                              ▼                            │
│      │                    ┌─────────────┐                        │
│      └───────────────────→│ In Progress │←──────────┐            │
│                           │  ⚙ agent    │           │            │
│                           └──────┬──────┘           │            │
│                                  │                  │            │
│                        agent:success          "rework"           │
│                                  │                  │            │
│                           ┌──────▼──────┐    ┌──────┴─────────┐ │
│                           │  PR Review  │───→│ Changes        │ │
│                           │  ⚙ review   │    │ Requested      │ │
│                           └──────┬──────┘    └────────────────┘ │
│                                  │                               │
│                         "merge & complete"                       │
│                           ┌──────▼──────┐                        │
│                           │    Done     │                        │
│                           │  ● terminal │                        │
│                           └─────────────┘                        │
│                                                                  │
│ Legend:  ⚙ = has hooks  ⛨ = has guards  ── manual  ═══ agent    │
│ Colors: 🔵 active  🟡 waiting  🟢 done  🔴 blocked  ⬜ backlog  │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Nodes = statuses, colored by category (backlog, active, review, waiting, done, blocked)
- Edges = transitions, labeled with trigger type (solid = manual, dashed = agent)
- Hook indicators (gear icon) on nodes/edges that have hooks
- Guard indicators (shield icon) on transitions that have guards
- Hover on a node → tooltip shows description, category, hooks
- Hover on an edge → tooltip shows trigger, guards, hooks
- Auto-layout using a simple DAG layout algorithm (left-to-right or top-to-bottom)
- Zoom and pan for complex pipelines

#### 2. Task View (task selected)

Overlays a specific task's journey onto the pipeline graph. Shows where the task is, where it's been, and where it can go.

```
┌─────────────────────────────────────────────────────────────────┐
│ Workflow Visualizer            Task: "Add authentication"        │
│ Pipeline: Standard             Status: Changes Requested         │
│                                                                  │
│                                                                  │
│   ┌──────┐     ┌──────────┐     ┌────────┐                      │
│   │ Open │═══→│ Planning │═══→│Planned │                      │
│   │ ✓ 2m │     │ ✓ 45s    │     │ ✓ 1m   │                      │
│   └──────┘     └──────────┘     └───┬────┘                      │
│                                     │                            │
│                                     ▼                            │
│                           ┌─────────────┐                        │
│                           │ In Progress │←──────────┐            │
│                           │ ✓ 3m 12s    │           │            │
│                           └──────┬──────┘           │            │
│                                  │                  │            │
│                           ┌──────▼──────┐    ┌──────┴─────────┐ │
│                           │  PR Review  │═══→│ ★ Changes      │ │
│                           │ ✓ 1m 5s     │    │   Requested    │ │
│                           └─────────────┘    │   waiting 3m   │ │
│                                              └────────────────┘ │
│                                                                  │
│ ═══ = path taken   ★ = current position   ✓ = completed         │
│ Time in each status shown                                        │
│                                                                  │
│ ┌─ Task Journey ──────────────────────────────────────────────┐ │
│ │ Open (2m) → Planning (45s) → Planned (1m) → In Progress    │ │
│ │ (3m 12s) → PR Review (1m 5s) → ★ Changes Requested (3m)   │ │
│ │                                                              │ │
│ │ Total: 11m 4s │ Loops: 0 │ Agent runs: 3 │ Cost: $0.34    │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Next: [Rework] [Cancel]                                          │
└─────────────────────────────────────────────────────────────────┘
```

**Task overlay features:**
- Visited nodes highlighted with checkmark and time spent
- Current node pulsing with star indicator
- Taken path drawn as bold/colored edges
- Untaken paths shown as faded
- Loop iterations visible (if task went back and forth)
- Bottom panel: linear timeline of the journey
- Stats: total time, loop count, agent runs, cost
- Next available transitions as action buttons

#### Implementation

Use a lightweight graph rendering library:
- **@xyflow/react** (formerly React Flow) — recommended, built for node-based graphs
- Dagre for auto-layout (DAG positioning algorithm)
- Custom node components for status styling
- Custom edge components for transition labels

```typescript
// Convert pipeline definition to React Flow graph
function pipelineToGraph(
  pipeline: PipelineDefinition,
  task?: Task,           // optional: overlay task position
  history?: TransitionHistoryEntry[]  // optional: show path taken
): { nodes: Node[]; edges: Edge[] } {
  const nodes = pipeline.statuses.map(status => ({
    id: status.id,
    type: 'pipelineStatus',
    data: {
      status,
      isCurrent: task?.status === status.id,
      isVisited: history?.some(h => h.toStatus === status.id),
      timeSpent: calculateTimeInStatus(history, status.id),
    },
    position: layoutPosition(status),  // calculated by dagre
  }));

  const edges = pipeline.transitions.map(transition => ({
    id: transition.id,
    source: transition.from === '*' ? '__any__' : transition.from,
    target: transition.to,
    type: 'pipelineTransition',
    data: {
      transition,
      isTaken: history?.some(h => h.transitionId === transition.id),
    },
  }));

  return { nodes, edges };
}
```

#### Where It Appears

| Location | Mode | Purpose |
|----------|------|---------|
| Task Detail page | Task view | See this task's journey and current position |
| Pipeline settings | Pipeline view | Understand pipeline structure |
| Dashboard | Pipeline view + counts | Overview of how many tasks in each status |
| Standalone page (`/projects/:id/workflow`) | Either | Full-screen workflow exploration |

### Pipeline Debugger / History

Per-task timeline showing every transition (complements the visual graph):

```
┌─────────────────────────────────────────────────────┐
│ Task: "Add authentication"                           │
│ Pipeline: Standard                                   │
│ Current Status: Changes Requested                    │
│                                                      │
│ History:                                             │
│                                                      │
│ ● Open                          Feb 10, 10:00am      │
│ │ User clicked "Plan"                                │
│ ● Planning                      Feb 10, 10:01am      │
│ │ Agent completed (claude-code, plan mode, 45s)      │
│ ● Planned                       Feb 10, 10:02am      │
│ │ User clicked "Implement"                           │
│ ● In Progress                   Feb 10, 10:02am      │
│ │ Agent completed (claude-code, implement, 3m 12s)   │
│ ● PR Review                    Feb 10, 10:05am      │
│ │ Agent result: changes requested                    │
│ │ "Missing error handling in auth middleware"         │
│ ★ Changes Requested            Feb 10, 10:06am      │
│                                                      │
│ Valid next: [Rework] [Cancel]                        │
└─────────────────────────────────────────────────────┘
```

### Pipeline Editor (Settings)

Users can edit pipeline definitions through a visual editor:

```
┌─────────────────────────────────────────────────────┐
│ Pipeline Editor: Standard                            │
│                                                      │
│ Statuses:                                   [+ Add]  │
│ ┌────────────────────────────────────────────────┐  │
│ │ Open          │ backlog │ #6b7280 │ [↑] [↓] [✕]│  │
│ │ Planning      │ active  │ #8b5cf6 │ [↑] [↓] [✕]│  │
│ │ Planned       │ backlog │ #a78bfa │ [↑] [↓] [✕]│  │
│ │ In Progress   │ active  │ #3b82f6 │ [↑] [↓] [✕]│  │
│ │ ...                                             │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ Transitions:                                [+ Add]  │
│ ┌────────────────────────────────────────────────┐  │
│ │ Open → Planning │ "Plan" │ any │ hooks: 1 │ [✎]│  │
│ │ Planning → Planned │ "Done" │ agent:success │  │  │
│ │ ...                                             │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ [Save] [Reset to Default] [Export JSON]              │
└─────────────────────────────────────────────────────┘
```

---

## React Hooks for Pipeline

```typescript
// Get the pipeline for a project/task
function usePipeline(projectId: string): PipelineDefinition

// Get valid transitions for a task (what buttons to show)
function useValidTransitions(taskId: string): ValidTransition[]

// Get transition history for a task
function useTransitionHistory(taskId: string): TransitionHistoryEntry[]

// Execute a transition
function useTransition(): (taskId: string, toStatus: string, reason?: string) => Promise<TransitionResult>

// Get all statuses for the active pipeline (for kanban, filters, etc.)
function usePipelineStatuses(projectId: string): PipelineStatus[]

// Check if a status is terminal
function useIsTerminal(pipelineId: string, statusId: string): boolean
```

These hooks are the **only way** the UI interacts with pipeline state. The UI never checks status strings directly.

```typescript
// WRONG - hardcoded status checks
if (task.status === 'done' || task.status === 'cancelled') { /* terminal */ }

// RIGHT - ask the pipeline engine
const isTerminal = useIsTerminal(task.pipelineId, task.status);
```

---

## IPC Channels

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `pipeline:get` | renderer → main | { taskId } or { projectId } | PipelineDefinition |
| `pipeline:list` | renderer → main | - | PipelineDefinition[] |
| `pipeline:save` | renderer → main | PipelineDefinition | PipelineDefinition |
| `pipeline:delete` | renderer → main | { pipelineId } | void |
| `pipeline:valid-transitions` | renderer → main | { taskId } | ValidTransition[] |
| `pipeline:can-transition` | renderer → main | { taskId, toStatus } | TransitionCheck |
| `pipeline:transition` | renderer → main | { taskId, toStatus, reason? } | TransitionResult |
| `pipeline:history` | renderer → main | { taskId } | TransitionHistoryEntry[] |
