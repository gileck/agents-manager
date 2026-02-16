# Phase 5: Advanced Features

**Goal:** Power-user features, external integrations, and polish.

**Dependencies:** All previous phases

---

## What Gets Built

### Task Templates
- Pre-built templates: bug fix, feature, refactor, chore
- Custom template creation
- Template picker in task creation UI
- Template manager (CRUD for templates)
- Templates store title pattern, description template, default pipeline, priority, tags

### GitHub Issues Import
- Import via `gh` CLI (`gh issue list`, `gh issue view`)
- Label-to-priority mapping (e.g. `P0` → critical, `bug` → high)
- Label-to-tag mapping (e.g. `enhancement` → feature tag)
- Bulk import with preview
- Sync status (track which issues have been imported)

### Agent Queue
- Sequential agent execution (one at a time)
- Queue management: add, remove, reorder
- Pause/resume queue processing
- Clear queue
- Priority ordering within queue
- Auto-start next task when current completes

### Notification Channels

#### Telegram Bot
- Task status change notifications
- Agent completion/failure alerts
- Prompt forwarding (human-in-the-loop from phone)
- Respond to prompts via Telegram reply
- `/status` command for overview

#### Slack Bot
- Same capabilities as Telegram
- Channel-based notifications
- Thread-based prompt responses
- Slash commands for quick actions

### Diff Viewer Component
- Inline diff display
- Side-by-side diff mode
- Syntax highlighting
- File tree navigation
- Review comments overlay

### Cost Tracking
- Model pricing table (Claude Opus, Sonnet, Haiku rates)
- Per-run cost calculation (input + output tokens)
- Per-task cost aggregation (all runs for a task)
- Per-project cost summary
- Cost dashboard with charts
- Budget alerts (configurable thresholds)

### E2E Test Suite Expansion
- Full workflow tests: create project → create task → run agent → review PR → merge
- Multi-agent tests: different agent types on different tasks
- Queue tests: sequential execution, pause/resume
- Notification tests: mock Telegram/Slack delivery
- Template tests: create from template, import issues

---

## Database Tables (2)

### `task_templates`
```sql
CREATE TABLE task_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title_pattern TEXT NOT NULL,    -- e.g. "Fix: {description}"
  description_template TEXT,
  pipeline_id TEXT,
  default_priority TEXT,
  default_tags TEXT,              -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(pipeline_id) REFERENCES pipelines(id)
);
```

### `agent_queue`
```sql
CREATE TABLE agent_queue (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  mode TEXT CHECK(mode IN ('plan','implement','review')),
  agent_type TEXT NOT NULL DEFAULT 'claude-code',
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT CHECK(status IN ('queued','running','completed','failed','cancelled')),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE INDEX idx_agent_queue_status ON agent_queue(status);
CREATE INDEX idx_agent_queue_position ON agent_queue(position);
```

---

## File Structure

```
src/main/
  stores/
    sqlite-task-template-store.ts
    sqlite-agent-queue-store.ts
  services/
    template-service.ts
    github-import-service.ts
    agent-queue-service.ts
    cost-tracking-service.ts
  notifications/
    telegram-channel.ts
    slack-channel.ts

src/renderer/
  pages/
    TemplatesPage.tsx
    ImportPage.tsx
    QueuePage.tsx
    CostDashboardPage.tsx
  components/
    template/
      TemplatePicker.tsx
      TemplateEditor.tsx
    import/
      GitHubImportWizard.tsx
      LabelMapping.tsx
    queue/
      QueueList.tsx
      QueueControls.tsx
    diff/
      DiffViewer.tsx
      DiffFileTree.tsx
    cost/
      CostSummary.tsx
      CostChart.tsx
      BudgetAlert.tsx

tests/
  e2e/
    full-workflow.test.ts
    multi-agent.test.ts
    queue.test.ts
    notifications.test.ts
    templates.test.ts
```

---

## User Can
Create tasks from templates, import GitHub issues, queue tasks for sequential agent execution, get Telegram/Slack notifications, respond to agent prompts from phone, track costs per task/project.
