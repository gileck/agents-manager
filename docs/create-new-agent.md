---
title: Creating a New Agent
description: Step-by-step guide for adding a new agent type to the system
summary: "Adding a new agent type requires 3 files: a prompt builder, a DOC_PHASES entry, and a colocated post-run handler. Registries (AGENT_BUILDERS, POST_RUN_HANDLERS) auto-wire everything — no editing agent-service.ts."
priority: 3
key_points:
  - "3-file workflow: (1) create prompt builder, (2) add DOC_PHASES entry, (3) create colocated post-run handler"
  - "AGENT_BUILDERS map in src/core/agents/agent-builders.ts replaces scattered imports and registration lines in setup.ts"
  - "FEEDBACK_ENTRY_TYPES in types.ts auto-derives from DOC_PHASES — no manual array editing needed"
  - "POST_RUN_HANDLERS in src/core/agents/post-run-handlers.ts maps agent types to handler functions — no editing agent-service.ts"
  - "Each handler is colocated with its prompt builder and maps LLM output → TaskAPI persistence calls"
---
# Creating a New Agent

Step-by-step guide for adding a new agent type to the system.

## Overview

Adding a new agent type requires only **3 files** (plus optional steps for non-standard agents):

| File | Purpose |
|---|---|
| Prompt builder (`src/core/agents/<name>-prompt-builder.ts`) | Defines the LLM prompt and structured output schema |
| DOC_PHASES entry (`src/shared/doc-phases.ts`) | Registers doc type, feedback type, pipeline statuses |
| Post-run handler (`src/core/agents/<name>-post-run-handler.ts`) | Maps LLM output → TaskAPI persistence calls |

The reduction comes from registries that auto-derive behavior:
1. **AGENT_BUILDERS** (`src/core/agents/agent-builders.ts`) — maps agent type strings to builder classes; `setup.ts` loops over it
2. **POST_RUN_HANDLERS** (`src/core/agents/post-run-handlers.ts`) — maps agent types to post-run handler functions; `agent-service.ts` calls the handler automatically after each run
3. **FEEDBACK_ENTRY_TYPES** (`src/shared/types.ts`) — derived from `DOC_PHASES.map(p => p.feedbackType)` plus non-doc feedback types

## Step 1: Create the Prompt Builder

Create a new file in `src/core/agents/`:

```
src/core/agents/<agent-name>-prompt-builder.ts
```

Extend `BaseAgentPromptBuilder` and implement the key methods:

```ts
import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';

export class MyAgentPromptBuilder extends BaseAgentPromptBuilder {
  buildPrompt(context: AgentContext, config: AgentConfig): string {
    // Return the full system prompt for mode='new'
  }

  buildContinuationPrompt(context: AgentContext, config: AgentConfig): string {
    // Return the prompt for mode='revision' (session resume)
  }
}
```

**Key methods:**
- `buildPrompt()` — full system prompt for the first run
- `buildContinuationPrompt()` — shorter prompt for revision/feedback cycles
- `getStructuredOutputSchema()` — optional JSON schema for structured output

Then add the builder to the **AGENT_BUILDERS** map:

```ts
// src/core/agents/agent-builders.ts
import { MyAgentPromptBuilder } from './my-agent-prompt-builder';

export const AGENT_BUILDERS: Record<string, new () => BaseAgentPromptBuilder> = {
  // ... existing entries
  'my-agent': MyAgentPromptBuilder,
};
```

This single entry replaces what previously required both an import and a registration line in `setup.ts`.

## Step 2: Add a DOC_PHASES Entry

If your agent produces a document artifact (plan, design, report, etc.), add an entry to `DOC_PHASES`:

```ts
// src/shared/doc-phases.ts
export const DOC_PHASES: readonly DocPhaseEntry[] = [
  // ... existing entries
  {
    agentType: 'my-agent',
    docType: 'my_artifact',        // Add to DocArtifactType union in types.ts
    docTitle: 'My Artifact',
    activeStatus: 'my_agenting',   // Pipeline status while agent runs
    reviewStatus: 'my_review',     // Pipeline status for human review
    feedbackType: 'my_feedback',   // Auto-registered in FEEDBACK_ENTRY_TYPES
    routeKey: 'my-artifact',       // URL path segment: /tasks/:id/my-artifact
  },
];
```

**What cascades automatically from this single entry:**
- `FEEDBACK_ENTRY_TYPES` — your `feedbackType` is auto-included (no manual editing of `types.ts`)
- `REPORT_CONFIGS` — the Docs panel in the UI picks up your `routeKey` and `docTitle`
- Route generation — the UI creates a route at `/tasks/:id/:routeKey`
- Lookup helpers — `getPhaseByAgentType()`, `getDocTypeForAgent()`, etc. all work automatically

**Important:** You must also add the new `docType` value to the `DocArtifactType` union in `src/shared/types.ts`:
```ts
export type DocArtifactType = '...' | 'my_artifact';
```

## Step 3: Create a Post-Run Handler

Create a handler file colocated with the prompt builder:

```
src/core/agents/<agent-name>-post-run-handler.ts
```

Each handler is a function that receives a `TaskAPI` (scoped to the task) and maps the agent's structured output to persistence calls:

```ts
// src/core/agents/my-agent-post-run-handler.ts
import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { extractTaskEstimates, saveContextEntry } from './post-run-utils';

export async function myAgentPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // 1. Extract and persist documents
  if (result.exitCode === 0) {
    const so = result.structuredOutput as { myContent?: string; mySummary?: string } | undefined;
    if (so?.myContent) {
      await taskApi.upsertDoc('my_artifact', so.myContent, so.mySummary ?? null);
    }
    // Mark feedback as addressed
    if (agentRunId) {
      await taskApi.markFeedbackAsAddressed(['my_feedback'], agentRunId);
    }
  }

  // 2. Extract task estimates (size/complexity) if applicable
  await extractTaskEstimates(taskApi, result, 'my-agent', onLog, onPostLog);

  // 3. Save context entry (summary for subsequent agents)
  await saveContextEntry(taskApi, agentRunId ?? '', 'my-agent', revisionReason, result, {}, onLog, onPostLog);
}
```

Then register the handler in **POST_RUN_HANDLERS**:

```ts
// src/core/agents/post-run-handlers.ts
import { myAgentPostRunHandler } from './my-agent-post-run-handler';

export const POST_RUN_HANDLERS: Record<string, PostRunHandler> = {
  // ... existing entries
  'my-agent': myAgentPostRunHandler,
};
```

Also add a case in `getContextEntryType()` in `src/core/agents/post-run-utils.ts`:

```ts
case 'my-agent':
  return revisionReason === 'changes_requested' ? 'my_artifact_revision_summary' : 'my_artifact_summary';
```

**No changes needed in `agent-service.ts`** — the handler registry is consulted automatically after each run.

### TaskAPI Methods

The `ITaskAPI` interface (scoped to the current task) provides:

| Method | Purpose |
|---|---|
| `upsertDoc(type, content, summary)` | Persist a document artifact |
| `updateTask(updates)` | Update task fields (subtasks, phases, tags, etc.) |
| `getTask()` | Read the current task |
| `addContextEntry(input)` | Add a context entry for subsequent agents |
| `markFeedbackAsAddressed(types, runId)` | Mark feedback entries as addressed |
| `logEvent(input)` | Log a task event |
| `sendNotification(notification)` | Send a notification (scoped to this task) |
| `createTask(input)` | Create a new task (e.g., suggested follow-up tasks) |

### Shared Utilities

`src/core/agents/post-run-utils.ts` provides reusable helpers:

- `saveContextEntry()` — saves a context entry with structured summary extraction
- `extractTaskEstimates()` — extracts size/complexity from structured output
- `parseRawContent()` — fallback parser for raw agent output
- `getContextEntryType()` — maps agent type → context entry type string

## Optional Steps

### Pipeline Statuses & Transitions

For agents that participate in the standard pipeline (not just ad-hoc execution), add statuses and transitions in `src/core/data/seeded-pipelines.ts`:

```ts
// Add statuses for your agent's active and review phases
{ name: 'my_agenting', label: 'My Agent Running', type: 'active' },
{ name: 'my_review', label: 'My Review', type: 'review' },

// Add transitions to/from your statuses
{ from: 'some_prior_status', to: 'my_agenting', trigger: 'auto' },
{ from: 'my_agenting', to: 'my_review', trigger: 'agent_outcome', outcome: 'completed' },
```

### Outcome Schema

If your agent produces structured outcomes that need validation, add an entry in `src/core/handlers/outcome-schemas.ts`.

### Agent Definition

For UI-configurable agents, add an agent definition record via the `IAgentDefinitionStore`. This controls mode configs, skills, and engine overrides.

## Quick Checklist

- [ ] **Prompt builder** created in `src/core/agents/<name>-prompt-builder.ts`
- [ ] **AGENT_BUILDERS** entry added in `src/core/agents/agent-builders.ts`
- [ ] **DOC_PHASES** entry added in `src/shared/doc-phases.ts` (if agent produces docs)
- [ ] **DocArtifactType** union updated in `src/shared/types.ts` (if new doc type)
- [ ] **Post-run handler** created in `src/core/agents/<name>-post-run-handler.ts`
- [ ] **POST_RUN_HANDLERS** entry added in `src/core/agents/post-run-handlers.ts`
- [ ] **getContextEntryType()** case added in `src/core/agents/post-run-utils.ts`
- [ ] *(Optional)* Pipeline statuses/transitions in `seeded-pipelines.ts`
- [ ] *(Optional)* Outcome schema in `outcome-schemas.ts`
