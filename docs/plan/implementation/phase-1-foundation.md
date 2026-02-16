# Phase 1: Foundation — Task Manager + Kanban Board

> A working task tracker with projects, tasks, pipelines, and a kanban board. No agent integration.

## Prerequisites
- Electron app shell (template)
- SQLite + migration system (template)
- IPC registry (template)
- React + Tailwind + Shadcn components (template)

---

## 1.1 — Scaffold: Routing, Layout, Sidebar, Empty Pages
**Vertical slice:** App runs, user can navigate between pages.

- [ ] React Router with all Phase 1 routes
- [ ] Layout component with sidebar navigation
- [ ] Sidebar with project selector and nav links (Dashboard, Board, Tasks, Settings)
- [ ] Empty placeholder pages for each route
- [ ] App entry point wiring (`src/renderer/App.tsx`)

**Arch docs:** `architecture/app-ui.md` (Pages & Routes, Layout)

---

## 1.2 — Database Schema + Migrations (Core Tables)
**Vertical slice:** App starts with all Phase 1 tables created.

- [ ] `pipelines` table (id, name, statuses JSON, transitions JSON, task_type)
- [ ] `projects` table (id, name, description, path, config JSON, timestamps)
- [ ] `tasks` table (id, projectId, pipelineId, title, description, status, priority, size, complexity, tags JSON, parentTaskId, assignee, prLink, branchName, metadata JSON, sortOrder, timestamps)
- [ ] `task_dependencies` table (task_id, depends_on_task_id)
- [ ] `transition_history` table (id, task_id, from_status, to_status, trigger, actor, guard_results JSON, timestamp)
- [ ] `task_events` table (id, task_id, category, severity, message, data JSON, timestamp)
- [ ] `activity_log` table (id, action, entity_type, entity_id, summary, data JSON, timestamp)
- [ ] `settings` table (key, value)
- [ ] Indexes for all foreign keys and common queries
- [ ] Seeded pipelines (Simple, Feature, Bug)

**Arch docs:** `architecture/database.md` (Schema, Migrations)

---

## 1.3 — Interfaces + SQLite Stores (Core)
**Vertical slice:** All Phase 1 data access works via interfaces.

- [ ] `ITaskStore` interface (CRUD, list with filters, dependencies)
- [ ] `IProjectStore` interface (CRUD, getByPath)
- [ ] `IPipelineStore` interface (CRUD, getPipelineForTaskType)
- [ ] `ITaskEventLog` interface (log, list by task)
- [ ] `IActivityLog` interface (log, list with filters)
- [ ] `SqliteTaskStore` implementation
- [ ] `SqliteProjectStore` implementation
- [ ] `SqlitePipelineStore` implementation
- [ ] `SqliteTaskEventLog` implementation
- [ ] `SqliteActivityLog` implementation

**Arch docs:** `architecture/overview.md` (Interfaces), `architecture/tasks.md`, `architecture/projects.md`

---

## 1.4 — Pipeline Engine (Basic)
**Vertical slice:** Tasks can transition between statuses with validation.

- [ ] `IPipelineEngine` interface (getValidTransitions, executeTransition)
- [ ] `PipelineEngine` implementation — validates transition is allowed, updates task status
- [ ] Guard evaluation framework (stub guards, just returns true)
- [ ] Hook execution framework (stub hooks, just logs)
- [ ] Transition history recording
- [ ] Event logging on transition

**Arch docs:** `architecture/pipeline/engine.md`, `architecture/pipeline/index.md`

---

## 1.5 — WorkflowService (Phase 1 Scope)
**Vertical slice:** Single orchestration layer for all business logic.

- [ ] `IWorkflowService` interface (task CRUD, project CRUD, transitions)
- [ ] `WorkflowService` implementation wrapping stores + pipeline engine
- [ ] Activity logging on all mutations
- [ ] Event logging on task changes
- [ ] Dependency injection via `providers/setup.ts`

**Arch docs:** `architecture/workflow-service.md`

---

## 1.6 — IPC Handlers + Preload API (Phase 1)
**Vertical slice:** Renderer can call all Phase 1 operations via IPC.

- [ ] Project IPC handlers (list, get, create, update, delete)
- [ ] Task IPC handlers (list, get, create, update, delete)
- [ ] Task transition IPC (get valid transitions, execute transition)
- [ ] Task dependency IPC (add, remove, list)
- [ ] Pipeline IPC (list, get)
- [ ] Settings IPC (get, update)
- [ ] Event/Activity IPC (list)
- [ ] Preload API exposing all channels to renderer
- [ ] Shared IPC channel definitions (`src/shared/ipc-channels.ts`)
- [ ] Shared types (`src/shared/types.ts`)

**Arch docs:** `architecture/app-ui.md` (IPC Handlers)

---

## 1.7 — Projects Page (CRUD)
**Vertical slice:** User can create, view, edit, delete projects.

- [ ] Projects list page with cards
- [ ] Create project dialog (name, description, path)
- [ ] Edit project (inline or dialog)
- [ ] Delete project (with confirmation)
- [ ] Click project → navigate to task board
- [ ] `useProjects()` hook

**Arch docs:** `architecture/app-ui.md` (Projects Page), `architecture/projects.md`

---

## 1.8 — Task List Page (CRUD + Filters)
**Vertical slice:** User can create, view, filter, and manage tasks within a project.

- [ ] Task list page with table view
- [ ] Create task dialog (title, description, priority, tags, pipeline)
- [ ] Edit task (inline or dialog)
- [ ] Delete task (with confirmation)
- [ ] Filter bar (status, priority, assignee, search)
- [ ] Status badge colored by pipeline definition
- [ ] `useTasks(projectId, filters)` hook
- [ ] `usePipeline(pipelineId)` hook

**Arch docs:** `architecture/app-ui.md` (Task List), `architecture/tasks.md`

---

## 1.9 — Task Detail Page
**Vertical slice:** User can view full task details, transition status, see history.

- [ ] Task detail page with tabs (Overview, Transitions, Events, Dependencies)
- [ ] Overview tab: title, description, priority, status, assignee, tags, metadata
- [ ] Transitions tab: buttons/dropdown for valid transitions
- [ ] Events tab: task event log timeline
- [ ] Dependencies tab: list blocked-by and blocking tasks
- [ ] Edit task fields inline
- [ ] `useTask(taskId)` hook
- [ ] `useTaskEvents(taskId)` hook

**Arch docs:** `architecture/app-ui.md` (Task Detail)

---

## 1.10 — Kanban Board
**Vertical slice:** User sees tasks as cards in columns by status, can drag to transition.

- [ ] Kanban board component with columns per pipeline status
- [ ] Task cards with title, priority badge, assignee
- [ ] Drag-and-drop between columns (triggers transition)
- [ ] Column headers with task count
- [ ] Quick-add task within a column
- [ ] Click card → navigate to task detail
- [ ] Respect pipeline transitions (only allow valid drops)

**Arch docs:** `architecture/app-ui.md` (Kanban Board), `architecture/pipeline/ui.md`

---

## 1.11 — Settings Page
**Vertical slice:** User can configure app preferences.

- [ ] Settings page with sections
- [ ] Theme selection (light/dark/system)
- [ ] Default task properties (priority, pipeline)
- [ ] `useSettings()` hook

**Arch docs:** `architecture/app-ui.md` (Settings)

---

## 1.12 — Task Dependencies
**Vertical slice:** User can add/remove dependencies, see blocking relationships.

- [ ] Add dependency UI (search/select blocking task)
- [ ] Remove dependency
- [ ] Show dependency status on task card (blocked indicator)
- [ ] `dependencies_resolved` guard in pipeline engine
- [ ] Prevent transition if dependencies not met

**Arch docs:** `architecture/tasks.md` (Dependencies)

---

## 1.13 — Subtasks (Parent-Child)
**Vertical slice:** Tasks can have subtasks displayed in detail view.

- [ ] Create subtask from task detail page
- [ ] Show subtask list in parent task detail
- [ ] Navigate between parent ↔ child
- [ ] Subtask count on parent card in kanban

**Arch docs:** `architecture/tasks.md` (Subtasks)

---

## Phase 1 Acceptance Criteria
- App launches, shows sidebar with navigation
- Can create projects with name/path
- Can create tasks with all fields
- Kanban board shows tasks by status
- Drag-and-drop transitions work with pipeline validation
- Task detail shows full info with tabs
- Filters work on task list
- Dependencies block transitions when unresolved
- Subtasks display under parent
- Settings page works
