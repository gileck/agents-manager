# Pipeline Builder: Full Plan

## Context

Users can create agents from the UI but cannot create or edit pipelines. All 5 pipelines are hardcoded in `seeded-pipelines.ts` and re-seeded by migrations, making SQL a secondary store rather than the source of truth. We want to:
1. Make SQL the sole source of truth for pipelines (stop re-seeding)
2. Build a pipeline editor page where users can create/edit pipelines — statuses, transitions, agent assignments, hooks, and guards

## Scope

- **Phase 1**: Pipeline structure editing (statuses, transitions)
- **Phase 2**: Agent assignment & hook/guard configuration on transitions
- Both delivered as a single full-page editor at `/pipelines/:id/edit` and `/pipelines/new`
- All pipelines (including built-in) are editable
- No visual graph editor (table/card-based UI)

---

## Step 1: Add Pipeline CRUD IPC Channels

Add create/update/delete channels to wire the existing store to the renderer.

**File: `src/shared/ipc-channels.ts`**
- Add `PIPELINE_CREATE: 'pipeline:create'`, `PIPELINE_UPDATE: 'pipeline:update'`, `PIPELINE_DELETE: 'pipeline:delete'`

**File: `src/main/ipc-handlers.ts`** (after line ~235)
- Register 3 handlers following the agent-def pattern (lines 411-424):
  - `PIPELINE_CREATE` → `validateInput(input, ['name', 'taskType', 'statuses', 'transitions'])` → `pipelineStore.createPipeline(input)`
  - `PIPELINE_UPDATE` → `validateId(id)` → `pipelineStore.updatePipeline(id, input)`
  - `PIPELINE_DELETE` → `validateId(id)` → `pipelineStore.deletePipeline(id)`

**File: `src/preload/index.ts`** (line ~225, pipelines section)
- Add `create`, `update`, `delete` methods mirroring the `agentDefinitions` pattern (lines 283-290)
- Also duplicate the channel constants in the preload's inline `IPC_CHANNELS` block

---

## Step 2: Stop Re-seeding Pipelines

**No files deleted, no migrations removed.** Existing migrations stay intact for upgrade paths.

**What changes:** We simply stop adding new re-seed migrations going forward. The file `src/main/data/seeded-pipelines.ts` remains as-is (referenced by existing migrations) but is no longer the living source of truth. SQL owns the data now.

This is a process change, not a code change. No refactoring needed.

---

## Step 3: Update PipelinesPage with CRUD Actions

**File: `src/renderer/pages/PipelinesPage.tsx`**

Follow the `AgentDefinitionsPage` pattern (lines 10-107):
- Add "New Pipeline" button in the header → navigates to `/pipelines/new`
- Add Edit button to each `PipelineCard` → navigates to `/pipelines/:id/edit`
- Add Delete button to each `PipelineCard` → opens confirmation dialog
- Delete confirmation dialog with `window.api.pipelines.delete(id)` + refetch
- Keep the existing flow visualization and "Set as Default" button

---

## Step 4: Register Pipeline Editor Routes

**File: `src/renderer/App.tsx`** (line ~110)
- Add route: `<Route path="pipelines/new" element={<PipelineEditorPage />} />`
- Add route: `<Route path="pipelines/:id/edit" element={<PipelineEditorPage />} />`

---

## Step 5: Build Pipeline Editor Page

**New file: `src/renderer/pages/PipelineEditorPage.tsx`**

A full-page form with these sections:

### Section A: Basic Info
- **Name** (text input, required)
- **Description** (textarea, optional)
- **Task Type** (text input, required, unique identifier like `my-workflow`)

### Section B: Statuses
A reorderable list of status cards. Each status has:
- **Name** (text input, internal key like `in_progress`)
- **Label** (text input, display name like "In Progress")
- **Color** (color picker, hex)
- **Category** (dropdown: `ready`, `agent_running`, `human_review`, `waiting_for_input`, `terminal`)
- **Is Final** (checkbox)
- Remove button (with validation — can't remove if referenced by transitions)
- "Add Status" button at the bottom
- Drag handle for reordering (sets `position`)

### Section C: Transitions
A list of transition cards. Each transition has:

**Basic fields:**
- **From** (dropdown of status names, includes `*` for wildcard)
- **To** (dropdown of status names)
- **Trigger** (dropdown: `manual`, `agent`, `system`)
- **Label** (text input, shown on manual trigger buttons)
- **Agent Outcome** (dropdown, shown only when trigger = `agent`): `failed`, `interrupted`, `no_changes`, `conflicts_detected`, `plan_complete`, `investigation_complete`, `pr_ready`, `approved`, `design_ready`, `reproduced`, `cannot_reproduce`, `needs_info`, `info_provided`, `options_proposed`, `changes_requested`

**Guards section** (collapsible):
- List of guards, each with:
  - **Name** (dropdown: `has_pr`, `dependencies_resolved`, `max_retries`, `no_running_agent`)
  - **Params** (dynamic — show `max` number input when name = `max_retries`)
- "Add Guard" button

**Hooks section** (collapsible):
- List of hooks, each with:
  - **Name** (dropdown: `start_agent`, `notify`, `create_prompt`, `merge_pr`, `push_and_create_pr`)
  - **Policy** (dropdown: `required`, `best_effort`, `fire_and_forget`)
  - **Params** (dynamic based on hook name):
    - `start_agent` → **Mode** dropdown (all 13 AgentMode values) + **Agent Type** dropdown (from agent definitions in DB)
    - `notify` → **Title Template** + **Body Template** text inputs
    - `create_prompt` → **Resume Outcome** text input
    - `merge_pr`, `push_and_create_pr` → no params
- "Add Hook" button

**"Add Transition" button** at the bottom.

### Section D: Flow Preview
- Reuse the existing `buildStatusOrder()` + visualization from `PipelinesPage.tsx` to show a live preview of the pipeline flow as the user edits

### Section E: Actions
- **Save** button → calls `window.api.pipelines.create(input)` or `window.api.pipelines.update(id, input)`
- **Cancel** button → navigates back to `/pipelines`
- Validation errors shown inline

### Data Flow
- On mount (edit mode): `usePipeline(id)` → populate form state
- On mount (create mode): empty form state with one default status (`open`)
- On save: collect all form state into `PipelineCreateInput` / `PipelineUpdateInput` → API call → navigate to `/pipelines`

### Agent Type Dropdown
For the `start_agent` hook's `agentType` param, fetch agent definitions via `useAgentDefinitions()` and derive agent type IDs by stripping the `agent-def-` prefix from definition IDs. This makes user-created agents available in the pipeline editor.

---

## Step 6: Add usePipelineMutations Hook

**New file: `src/renderer/hooks/usePipelineMutations.ts`**

Simple wrapper around the API calls (following the pattern of other hooks):
```ts
export function usePipelineMutations() {
  return {
    create: (input: PipelineCreateInput) => window.api.pipelines.create(input),
    update: (id: string, input: PipelineUpdateInput) => window.api.pipelines.update(id, input),
    delete: (id: string) => window.api.pipelines.delete(id),
  };
}
```

---

## Files to Modify

| File | Change |
|---|---|
| `src/shared/ipc-channels.ts` | Add 3 pipeline CRUD channels |
| `src/main/ipc-handlers.ts` | Register 3 pipeline CRUD handlers |
| `src/preload/index.ts` | Add create/update/delete to pipelines API + inline channels |
| `src/renderer/pages/PipelinesPage.tsx` | Add New/Edit/Delete buttons, delete dialog, navigation |
| `src/renderer/App.tsx` | Register `/pipelines/new` and `/pipelines/:id/edit` routes |

## New Files

| File | Purpose |
|---|---|
| `src/renderer/pages/PipelineEditorPage.tsx` | Full-page pipeline editor with all sections |
| `src/renderer/hooks/usePipelineMutations.ts` | Create/update/delete API wrappers |

---

## Building Block Values for Dropdowns (Reference)

| Dropdown | Values |
|---|---|
| Status category | `ready`, `agent_running`, `human_review`, `waiting_for_input`, `terminal` |
| Transition trigger | `manual`, `agent`, `system` |
| Agent outcome | `failed`, `interrupted`, `no_changes`, `conflicts_detected`, `plan_complete`, `investigation_complete`, `pr_ready`, `approved`, `design_ready`, `reproduced`, `cannot_reproduce`, `needs_info`, `info_provided`, `options_proposed`, `changes_requested` |
| Guard name | `has_pr`, `dependencies_resolved`, `max_retries`, `no_running_agent` |
| Hook name | `start_agent`, `notify`, `create_prompt`, `merge_pr`, `push_and_create_pr` |
| Hook policy | `required`, `best_effort`, `fire_and_forget` |
| Agent mode | `plan`, `implement`, `review`, `request_changes`, `plan_revision`, `investigate`, `resolve_conflicts`, `technical_design`, `technical_design_revision`, `plan_resume`, `implement_resume`, `investigate_resume`, `technical_design_resume` |
| Agent type | Dynamic from DB — derived from agent definition IDs |

---

## Verification

1. **Create a pipeline**: Go to `/pipelines`, click "New Pipeline", add statuses + transitions + hooks, save. Verify it appears in the list.
2. **Edit a pipeline**: Click Edit on a built-in pipeline, modify a status label, save. Verify the change persists after page refresh.
3. **Delete a pipeline**: Click Delete on a user-created pipeline, confirm. Verify it's gone.
4. **Assign agents**: Create a transition with a `start_agent` hook, pick mode + agent type. Save. Create a task with this pipeline's task type and trigger the transition. Verify the agent starts with the correct mode.
5. **Validation**: Try saving a pipeline with duplicate status names or transitions referencing non-existent statuses. Verify error messages appear.
6. **Flow preview**: As you add/remove statuses and transitions, verify the flow visualization updates in real-time.
