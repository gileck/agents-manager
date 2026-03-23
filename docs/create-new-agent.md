---
title: Creating a New Agent
description: Step-by-step guide for adding a new agent type to the system
summary: "After the registration boilerplate refactor, adding a new agent type requires only 3 files: a prompt builder, a DOC_PHASES entry, and extraction logic. Registries in setup.ts (AGENT_BUILDERS), types.ts (FEEDBACK_ENTRY_TYPES), and agent-service.ts (extractDoc) auto-derive from these sources."
priority: 3
key_points:
  - "3-file workflow: (1) create prompt builder, (2) add DOC_PHASES entry, (3) add extraction method + registry entry"
  - "AGENT_BUILDERS map in src/core/agents/agent-builders.ts replaces scattered imports and registration lines in setup.ts"
  - "FEEDBACK_ENTRY_TYPES in types.ts auto-derives from DOC_PHASES — no manual array editing needed"
  - "extractDoc() in post-run-extractor.ts dispatches to the right extractor via a registry map — no editing agent-service.ts"
---
# Creating a New Agent

Step-by-step guide for adding a new agent type to the system.

## Overview

Before the registration refactor, adding a new agent type required editing 7+ files with mostly boilerplate changes. Now the process requires only **3 files** (plus optional steps for non-standard agents):

| Before (7+ files) | After (3 files) |
|---|---|
| Prompt builder | Prompt builder |
| `setup.ts` — import + registration | *(auto-wired via AGENT_BUILDERS)* |
| `types.ts` — FEEDBACK_ENTRY_TYPES | *(auto-derived from DOC_PHASES)* |
| `doc-phases.ts` — DOC_PHASES entry | DOC_PHASES entry |
| `post-run-extractor.ts` — extraction + registry | Extraction method + registry entry |
| `agent-service.ts` — extractor call | *(auto-dispatched via extractDoc)* |
| `outcome-schemas.ts` — outcome signal | *(optional, only if custom outcomes)* |

The reduction comes from three registries that auto-derive behavior:
1. **AGENT_BUILDERS** (`src/core/agents/agent-builders.ts`) — maps agent type strings to builder classes; `setup.ts` loops over it
2. **FEEDBACK_ENTRY_TYPES** (`src/shared/types.ts`) — derived from `DOC_PHASES.map(p => p.feedbackType)` plus non-doc feedback types
3. **docExtractors** (`src/core/services/post-run-extractor.ts`) — maps agent types to extraction methods; `agent-service.ts` calls a single `extractDoc()` dispatcher

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

## Step 3: Add Extraction Logic

Add a new extraction method to `PostRunExtractor` and register it in the `docExtractors` map:

```ts
// src/core/services/post-run-extractor.ts

// 1. Register in the constructor's docExtractors map:
this.docExtractors = new Map([
  // ... existing entries
  ['my-agent', this.extractMyArtifact.bind(this)],
]);

// 2. Add the extraction method (same signature as extractPlan/extractTechnicalDesign):
async extractMyArtifact(
  taskId: string,
  result: AgentRunResult,
  agentType: string,
  onLog: OnLog,
  revisionReason?: RevisionReason,
  agentRunId?: string,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0 || agentType !== 'my-agent') {
    onPostLog?.('extractMyArtifact skipped', { agentType, exitCode: result.exitCode });
    return;
  }
  const so = result.structuredOutput as { myContent?: string; mySummary?: string } | undefined;
  if (so?.myContent) {
    await this.upsertTaskDoc(taskId, 'my_artifact', so.myContent, so.mySummary ?? null, onLog);
  }
  // Mark feedback as addressed after successful run
  if (agentRunId) {
    try {
      await this.markFeedbackAsAddressed(taskId, ['my_feedback'], agentRunId, onLog);
    } catch (err) {
      onLog(`Warning: failed to mark my_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

Also add a case in `getContextEntryType()` for the new agent:

```ts
// In the switch statement:
case 'my-agent':
  return revisionReason === 'changes_requested' ? 'my_artifact_revision_summary' : 'my_artifact_summary';
```

**No changes needed in `agent-service.ts`** — the `extractDoc()` dispatcher will automatically find and call your extractor.

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
- [ ] **Extraction method** added in `src/core/services/post-run-extractor.ts`
- [ ] **docExtractors** registry entry added (same file, constructor)
- [ ] **getContextEntryType()** case added (same file, bottom)
- [ ] *(Optional)* Pipeline statuses/transitions in `seeded-pipelines.ts`
- [ ] *(Optional)* Outcome schema in `outcome-schemas.ts`
