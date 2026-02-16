# Phase 5: Advanced Features

> Task templates, GitHub issues import, agent queue, inline diff review.

## Depends on: Phase 4 complete

---

## 5.1 — Task Templates
**Vertical slice:** User can create tasks from reusable templates.

- [ ] `task_templates` table (id, name, description, fields JSON, is_builtin, timestamps)
- [ ] `ITaskTemplateStore` interface + `SqliteTaskTemplateStore`
- [ ] Built-in templates: Bug Fix, Feature, Refactor, Chore
- [ ] Create task from template (pre-fills form)
- [ ] Template management UI (create, edit, delete custom templates)
- [ ] Template browser in create-task dialog
- [ ] CLI: `am templates list|get|create|delete`

**Arch docs:** `architecture/tasks.md` (Templates)

---

## 5.2 — GitHub Issues Import
**Vertical slice:** User can browse and import GitHub issues as tasks.

- [ ] `IScmPlatform.listIssues()` and `getIssue()` methods
- [ ] GitHub issues browser page
- [ ] Filter by label, assignee, milestone
- [ ] Issue preview with description
- [ ] Import selected issues as tasks (map fields)
- [ ] Link to original issue stored as artifact
- [ ] CLI: `am import github --repo <owner/repo>`

**Arch docs:** `architecture/git-scm.md` (GitHub Issues)

---

## 5.3 — Agent Queue
**Vertical slice:** Agent runs queue up and execute sequentially per project.

- [ ] `agent_queue` table (id, projectId, taskId, agentType, mode, status, position, timestamps)
- [ ] `IAgentQueueStore` interface + `SqliteAgentQueueStore`
- [ ] Queue lifecycle: queued → running → completed/failed/cancelled
- [ ] Sequential execution within project (one agent at a time)
- [ ] Queue management UI (view, reorder, cancel, pause/resume)
- [ ] Queue status in dashboard
- [ ] CLI: `am agent queue|queue-add|queue-remove`

**Arch docs:** `architecture/agent-platform.md` (Queue)

---

## 5.4 — Inline Diff Review
**Vertical slice:** User can review PR diffs inside the app with comments.

- [ ] Diff viewer component (unified or side-by-side)
- [ ] Syntax highlighting per file type
- [ ] Expandable/collapsible hunks
- [ ] File-level diff statistics (additions, deletions)
- [ ] Review panel in task detail (for tasks with PR artifacts)
- [ ] Approve / Request Changes actions
- [ ] Diff data from `IGitOps.getDiff()` or SCM platform
- [ ] Review outcome triggers pipeline transition

**Arch docs:** `architecture/pipeline-features.md` (Review Flow)

---

## 5.5 — Task Notes (Append-Only Commentary)
**Vertical slice:** Users and agents can add notes to tasks, like a GitHub issue thread.

- [ ] `task_notes` table (id, taskId, author, content, timestamps)
- [ ] Notes section in task detail page
- [ ] Add note form (markdown supported)
- [ ] Agent notes (auto-added from agent output summaries)
- [ ] Notes included in agent context assembly
- [ ] CLI: `am notes list|add --task <id>`

**Arch docs:** `architecture/tasks.md` (Notes)

---

## 5.6 — Advanced Pipeline Features
**Vertical slice:** Pipeline supports complex flows like request-info, review loops, task splitting.

- [ ] `needs_info` flow: agent pauses → prompt created → user responds → agent resumes with context
- [ ] Review loop: PR review → changes requested → back to implementing (with max iterations guard)
- [ ] Task splitting: agent proposes split → user approves → subtasks created with phases
- [ ] `has_payload_response` guard
- [ ] `review_approved` / `review_changes_requested` guards
- [ ] `max_iterations` guard (prevent infinite loops)
- [ ] `execute_split` hook

**Arch docs:** `architecture/pipeline-features.md` (Request Info, Review, Split)

---

## Phase 5 Acceptance Criteria
- Can create tasks from templates (built-in and custom)
- Can browse and import GitHub issues as tasks
- Agent queue executes runs sequentially, UI shows queue status
- Diff viewer shows PR changes with syntax highlighting
- Task notes work as append-only thread
- Complex pipeline flows (needs_info, review loops, task splits) function end-to-end
