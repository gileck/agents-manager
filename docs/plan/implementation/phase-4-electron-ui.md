# Phase 4: Electron UI

**Goal:** Full Electron app with all pages — thin layer over the already-working WorkflowService.

**Dependencies:** Phase 2 (all backend logic already works)

---

## What Gets Built

### IPC Channels
One-line mappings to WorkflowService methods. No business logic in IPC handlers.

### Pages

#### Projects Page
- Project list with stats (task counts, active agents)
- Create project dialog
- Project settings (config editor)

#### Task Board (Kanban)
- Drag-and-drop transitions between columns
- Columns derived from pipeline statuses (never hardcoded)
- Drop validation: asks pipeline engine for valid transitions
- Task cards with priority badge, assignee, agent status indicator

#### Task List
- Filterable by status, priority, assignee, tags
- Sortable columns
- Full-text search
- Bulk selection

#### Task Detail
- Metadata panel (title, description, priority, size, complexity)
- Plan viewer/editor
- Dependencies graph (blocking/blocked-by)
- Subtasks list
- Artifacts list (branches, PRs, commits, diffs)
- Notes editor (add/view notes)
- Event timeline (chronological task_events)
- Active agent status + output stream

#### Agent Run Panel
- Live output streaming via IPC events
- Transcript viewer (full agent conversation)
- Run history (all runs for a task)
- Start/stop controls
- Prompt response UI (for human-in-the-loop)

#### Settings Page
- Global config editor
- Theme selector (light/dark/system)
- Agent defaults
- Notification preferences

### Components

#### Agent Controls
- "Start Agent" button with run-with-options dialog (mode, agent type, model)
- "Stop Agent" button with confirmation
- Agent picker (choose between available agent types)

#### Artifact Viewer
- Branch links
- PR links with status badge
- Commit list with messages
- Diff viewer (inline)

#### Task Note Editor
- Rich text input
- Author attribution (user/agent/system)
- Timestamp display

#### Pipeline State Badge
- Dynamic — reads status display config from pipeline definition
- Color-coded by category (backlog, active, waiting, completed, blocked)
- Never hardcodes status strings

### Dashboard
- Stat cards: total tasks, active agents, completion rate, cost summary
- Active agents list with live status
- Recent activity feed (from activity_log)
- Tasks by status chart

### Workflow Visualizer
- Pipeline graph (statuses as nodes, transitions as edges)
- Highlights current task status
- Shows valid transitions from current state

### Bulk Operations
- Multi-select tasks (checkboxes)
- Bulk status change (transition multiple tasks)
- Bulk delete
- Bulk assign

### Real-Time Streaming
- Agent output streamed via IPC events
- Live task status updates
- Active agent count in sidebar

---

## Database Tables
None (all tables created in previous phases).

---

## File Structure

```
src/renderer/
  pages/
    DashboardPage.tsx
    ProjectsPage.tsx
    ProjectDetailPage.tsx
    TaskBoardPage.tsx
    TaskListPage.tsx
    TaskDetailPage.tsx
    AgentRunPage.tsx
    SettingsPage.tsx
  components/
    task/
      TaskCard.tsx
      TaskForm.tsx
      TaskFilters.tsx
      TaskDependencies.tsx
    agent/
      AgentControls.tsx
      AgentOutput.tsx
      AgentTranscript.tsx
      AgentPicker.tsx
      PromptResponseDialog.tsx
    pipeline/
      PipelineBadge.tsx
      PipelineVisualizer.tsx
      KanbanBoard.tsx
      KanbanColumn.tsx
    artifact/
      ArtifactList.tsx
      ArtifactViewer.tsx
      DiffViewer.tsx
    note/
      NoteEditor.tsx
      NoteList.tsx
    dashboard/
      StatCards.tsx
      ActiveAgents.tsx
      RecentActivity.tsx
    common/
      BulkActions.tsx
      EventTimeline.tsx
  hooks/
    useWorkflow.ts
    useAgentStream.ts
    useTasks.ts
    useProjects.ts
    usePipeline.ts

src/main/
  ipc-handlers.ts              -- expanded with all WorkflowService mappings

src/preload/
  index.ts                     -- expanded with all IPC channel bindings
```

---

## User Can
Full graphical interface for everything. Kanban board, real-time agent streaming, dashboards, project management.
