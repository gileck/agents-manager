---
title: Agent System
description: Agent types, execution lifecycle, prompts, validation, and context accumulation
summary: "Agent architecture: Agent class combines a PromptBuilder (domain logic) with an AgentLib (engine logic) resolved from AgentLibRegistry. Role-based prompt builders: PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder. ScriptedAgent is the test mock."
priority: 2
key_points:
  - "File: src/core/agents/ — Agent, PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder, ScriptedAgent"
  - "File: src/core/libs/ — ClaudeCodeLib, CursorAgentLib, CodexCliLib"
  - "Agent resolves AgentLib from registry via config.engine at execute() time"
  - "Prompt templates: file-based (.agents/) via PromptRenderer, or hardcoded in prompt builder classes"
---
# Agent System

Agent types, execution lifecycle, prompts, validation, and context accumulation.

## Architecture

```
AgentLibRegistry                           Prompt Builders (domain logic)
┌─────────────────────────────────┐        ┌───────────────────────────────────────────┐
│ IAgentLib interface             │        │ BaseAgentPromptBuilder                    │
│  ├── ClaudeCodeLib  (SDK)       │        │  ├── PlannerPromptBuilder                 │
│  ├── CursorAgentLib (CLI)       │        │  ├── DesignerPromptBuilder                │
│  └── CodexCliLib    (CLI)       │        │  ├── ImplementorPromptBuilder             │
└─────────────────────────────────┘        │  ├── InvestigatorPromptBuilder            │
                │                          │  ├── ReviewerPromptBuilder                │
                │                          │  └── TaskWorkflowReviewerPromptBuilder    │
                │                          └───────────────────────────────────────────┘
                │                                          │
                └──────────► Agent(type, promptBuilder, registry) ◄─┘
                             implements IAgent
                             resolves lib from registry per execute()
```

**Agent** is the single generic production `IAgent` implementation. It takes a `type`, a `BaseAgentPromptBuilder`, and an `AgentLibRegistry`. At execute() time, it reads `config.engine` to resolve the right `IAgentLib`, delegates prompt building to the prompt builder, and delegates execution to the lib.

### Engine Selection

Each agent definition in the database has an `engine` field (`claude-code`, `cursor-agent`, or `codex-cli`). `AgentService` passes `engine` via `AgentConfig`, and `Agent` resolves the matching `IAgentLib` from the `AgentLibRegistry` at execution time.

## Agent Hierarchy

```
IAgent (interface)
  └── Agent (PromptBuilder + AgentLibRegistry → IAgent)
        ├── PlannerPromptBuilder        — plan creation and revision
        ├── DesignerPromptBuilder       — technical design creation and revision
        ├── ImplementorPromptBuilder    — implementation, request_changes, resolve_conflicts
        ├── InvestigatorPromptBuilder   — bug investigation
        ├── ReviewerPromptBuilder       — code review with verdict extraction
        └── TaskWorkflowReviewerPromptBuilder — task workflow review
  └── ScriptedAgent                     — test mock with pre-written scripts
```

**File locations:**

Libs (engine logic):
- `src/core/interfaces/agent-lib.ts` — `IAgentLib` interface and types
- `src/core/libs/claude-code-lib.ts` — Claude SDK engine
- `src/core/libs/cursor-agent-lib.ts` — Cursor CLI engine
- `src/core/libs/codex-cli-lib.ts` — Codex CLI engine
- `src/core/services/agent-lib-registry.ts` — Engine registry

Prompt builders (domain logic):
- `src/core/agents/base-agent-prompt-builder.ts` — `BaseAgentPromptBuilder` abstract base
- `src/core/agents/planner-prompt-builder.ts` — `PlannerPromptBuilder`
- `src/core/agents/designer-prompt-builder.ts` — `DesignerPromptBuilder`
- `src/core/agents/implementor-prompt-builder.ts` — `ImplementorPromptBuilder`
- `src/core/agents/investigator-prompt-builder.ts` — `InvestigatorPromptBuilder`
- `src/core/agents/reviewer-prompt-builder.ts` — `ReviewerPromptBuilder`
- `src/core/agents/task-workflow-reviewer-prompt-builder.ts` — `TaskWorkflowReviewerPromptBuilder`
- `src/core/agents/prompt-utils.ts` — Shared interactive field/instruction helpers

Agent:
- `src/core/agents/agent.ts` — `Agent` class (generic, resolves lib from registry)
- `src/core/interfaces/agent.ts` — `IAgent` interface
- `src/core/agents/scripted-agent.ts` — `ScriptedAgent` (test mock, implements IAgent directly)

### IAgent Interface

```typescript
export interface IAgent {
  readonly type: string;
  execute(
    context: AgentContext,
    config: AgentConfig,
    onOutput?: (chunk: string) => void,
    onLog?: (message: string, data?: Record<string, unknown>) => void,
    onPromptBuilt?: (prompt: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
  ): Promise<AgentRunResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

### IAgentLib Interface

```typescript
export interface AgentLibFeatures {
  images: boolean;       // supports base64 image content blocks
  hooks: boolean;        // supports full hook system (pre/post tool use, notifications, subagents, etc.)
  thinking: boolean;     // supports thinking/reasoning blocks
  nativeResume: boolean; // supports native SDK session resume
}

export interface IAgentLib {
  readonly name: string;
  supportedFeatures(): AgentLibFeatures;
  getDefaultModel(): string;
  getSupportedModels(): AgentLibModelOption[];
  execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  getTelemetry(runId: string): AgentLibTelemetry | null;
}
```

Feature support by lib:
- `ClaudeCodeLib`: `{ images: true, hooks: true, thinking: true, nativeResume: true }`
- `CursorAgentLib`: `{ images: false, hooks: false, thinking: true, nativeResume: false }`
- `CodexCliLib`: `{ images: true, hooks: false, thinking: false, nativeResume: false }`

#### Implementing a New Agent Lib — Feature Contract

All new features added to `AgentLibRunOptions` and `AgentLibCallbacks` are **optional**. A lib only needs to handle the features it declares in `supportedFeatures()`. The service layer (`chat-agent-service.ts`) checks feature flags before wiring callbacks and options.

To add support for a feature in a new or existing lib, implement the corresponding contract:

| Feature | Options/Callbacks to Handle | What the Lib Must Do | Reference Implementation |
|---------|---------------------------|---------------------|------------------------|
| **Hooks** | `options.hooks` (all 8 types in `AgentLibHooks`) | Transform hooks into engine-native format, call them at the right lifecycle points. If the engine has no native hook system, call them manually around tool execution. | `claude-code-lib.ts` → `buildSdkHooks()` |
| **Streaming** | `callbacks.onStreamEvent` | Emit `{ type: 'text_delta' \| 'thinking_delta' \| 'input_json_delta', delta: string }` events as tokens arrive. If the engine supports partial/streaming output, enable it and forward deltas. | `claude-code-lib.ts` → `includePartialMessages: true` handling |
| **Interactive Permissions** | `callbacks.onPermissionRequest` | Before executing a tool, call `onPermissionRequest({ toolName, toolInput, toolUseId })` and await the response. If `allowed: false`, block the tool. This layers on top of the sandbox guard. | `claude-code-lib.ts` → `sdkCanUseTool` callback |
| **System Prompt Preset** | `options.systemPrompt` (string or `SystemPromptPreset`) | If the engine supports preset prompts, pass the preset object. Otherwise, fall back to using `systemPrompt` as a plain string (ignore the preset structure). | `claude-code-lib.ts` → systemPrompt pass-through |
| **Subagents** | `options.agents` (`Record<string, SubagentDefinition>`) | Pass agent definitions to the engine. If the engine has no native subagent support, ignore this option. | `claude-code-lib.ts` → `agents` pass-through |
| **Plugins** | `options.plugins` | Pass plugin configs to the engine. If the engine has no plugin system, ignore. | `claude-code-lib.ts` → `plugins` pass-through |
| **Setting Sources** | `options.settingSources` | Tell the engine which filesystem settings to load (e.g., `['project']` auto-loads CLAUDE.md). Ignore if unsupported. | `claude-code-lib.ts` → `settingSources` pass-through |
| **Images** | `options.images` | Pass base64 image content blocks to the engine. The service checks `supportedFeatures().images` — if `false`, it embeds file paths in the prompt text instead. | `claude-code-lib.ts` → multimodal content blocks |

**Minimal implementation:** A lib that returns `{ hooks: false, images: false, thinking: false, nativeResume: false }` only needs to handle `prompt`, `cwd`, `model`, `maxTurns`, `timeoutMs`, `readOnly`, and the basic `onOutput`/`onMessage` callbacks. All advanced features are opt-in.

**How the service adapts:** `chat-agent-service.ts` checks `supportedFeatures()` before wiring:
- `hooks === true` → passes `preToolUse` sandbox guard and all default hooks
- `hooks === false` → no hooks passed (permission enforcement falls back to prompt-level instructions)
- `images === true` → passes base64 image data via `options.images`
- `images === false` → injects image file paths into the prompt text
- `nativeResume === true` → passes `sessionId` + `resumeSession` for conversation continuity
- `nativeResume === false` → replays message history via `SessionHistoryFormatter`

#### Key Supporting Types

**File:** `src/core/interfaces/agent-lib.ts`

The interface defines several supporting types used across the agent system:

- **`PermissionRequest` / `PermissionResponse`** — Tool approval types. `PermissionRequest` contains `toolName`, `toolInput`, and `toolUseId`. `PermissionResponse` contains `allowed: boolean`. Used by the `onPermissionRequest` callback to surface tool calls to the UI for interactive approval.

- **`SystemPromptPreset`** — Preset-based system prompt configuration: `{ type: 'preset', preset: 'claude_code', append?: string }`. Uses the SDK's built-in Claude Code system prompt with optional appended instructions, instead of replacing it entirely with a custom string.

- **`SubagentDefinition`** — Defines a custom subagent available via the Task tool: `description`, `prompt`, optional `tools`/`disallowedTools` arrays, `model` (`'sonnet'`/`'opus'`/`'haiku'`/`'inherit'`), and `maxTurns`.

- **`AgentLibHooks`** — Full hooks interface with callbacks for agent lifecycle events:
  - `preToolUse` — Called before each tool execution. Returns `{ decision: 'block'|'allow'; reason? }`.
  - `postToolUse` — Called after a tool completes successfully.
  - `postToolUseFailure` — Called after a tool fails.
  - `notification` — Called when the agent emits a notification.
  - `stop` — Called when the agent stops.
  - `subagentStart` / `subagentStop` — Called when subagents start/stop.
  - `preCompact` — Called before context compaction.

- **`AgentLibCallbacks`** — Execution callbacks including:
  - `onStreamEvent` — Receives raw stream delta events for partial message streaming (text, thinking, input JSON deltas).
  - `onPermissionRequest` — Called when a tool needs user permission. Blocks tool execution until the returned promise resolves.

- **`AgentLibRunOptions`** — Extended with: `agents` (subagent definitions), `plugins` (local plugin paths), `settingSources` (e.g., `['project']` for CLAUDE.md auto-loading), `canUseTool` (async tool interceptor for allow/deny/modify), `systemPrompt` (accepts string or `SystemPromptPreset`), `betas`, `maxBudgetUsd`, `sdkPermissionMode` (SDK-level permission mode, defaults to `'acceptEdits'`), `disallowedTools` (tool names to completely remove from the model's context).

### BaseAgentPromptBuilder

Abstract base class that handles prompt assembly (template resolution, task context prepending, skills appending) and result construction.

Key abstract methods:
- `buildPrompt(context: AgentContext): string` — mode-specific prompt
- `inferOutcome(mode: string, exitCode: number, output: string): string` — outcome from exit code

Overridable methods:
- `isReadOnly(_context: AgentContext): boolean` — default `false`; builders override to return `true` for read-only agents (planner, investigator, reviewer)
- `getMaxTurns(context): number` — default 100
- `getOutputFormat(context): object | undefined` — JSON schema for structured output
- `getTimeout(context, config): number` — default 10 minutes

### Agent

The generic `Agent` class bridges prompt builder + lib registry → `IAgent`:
1. Calls `promptBuilder.buildExecutionConfig()` to get prompt, schema, timeouts
2. Resolves `IAgentLib` from `AgentLibRegistry` using `config.engine` (default: `'claude-code'`)
3. Calls `lib.execute()` with the config
4. Calls `promptBuilder.inferOutcome()` and `promptBuilder.buildResult()` on the result
5. Polls `lib.getTelemetry()` every 500ms for live cost/progress reporting
6. Tracks active libs per runId in a `Map` so `stop()` can delegate to the correct lib

### Pipeline Agent Permissions & Worktree Safety

Pipeline agents run in isolated git worktrees. Multiple layers prevent agents from escaping their worktree or writing when they shouldn't:

**Read-only enforcement (`isReadOnly() = true`):**
Read-only agents (investigator, reviewer) receive `disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']`, which completely removes these tools from the SDK — the model cannot call them.

**Read-only guard (PreToolUse hook — defense-in-depth):**
When `execConfig.readOnly` is true, `Agent.execute()` builds a `readOnlyGuard` via `buildReadOnlyGuard()` and registers it as a `preToolUse` hook. This guard hard-blocks:
- Write/Edit/MultiEdit/NotebookEdit tool calls (backstop for `disallowedTools`)
- Destructive Bash commands: `rm`, `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git clean`, `git add`, `git cherry-pick`, `git revert`, `git tag`, `git branch -d/-D`, `mkdir`, `touch`, `chmod`, `chown`, `mv`, `cp`, `tee`, `>`, `>>`

This fires via SDK hooks (separate from `canUseTool`/permissions) so it cannot be bypassed by `permissionMode`.

**Worktree path guard (PreToolUse hook):**
When an agent runs in a worktree (`workdir !== project.path`), `Agent.execute()` builds a `preToolUse` hook that hard-blocks:
- Write/Edit/Bash operations targeting the main repository path
- `cd` commands that would change to the main repo directory

This fires via SDK hooks (separate from `canUseTool`/permissions) so it cannot be bypassed.

**Prompt-level worktree instructions:**
`BaseAgentPromptBuilder.buildExecutionConfig()` prepends a `CRITICAL: WORKTREE SAFETY` section to the prompt when the agent is in a worktree. This tells the agent its working directory, the forbidden main repo path, and mandatory rules (use relative paths, never cd to main repo).

**SandboxGuard (dual enforcement — canUseTool + preToolUse hook):**
The `SandboxGuard` in `base-agent-lib.ts` validates tool call paths against `allowedPaths` and `readOnlyPaths`. It checks Write, Edit, Read, Glob, Grep, and Bash tools. Bash commands are parsed for path arguments (`cd`, `find`, `git`, `yarn`, etc.). The sandbox guard enforces via **two independent paths**:
1. **`canUseTool` callback** — runs the sandbox guard as the first stage of the permission chain. With `permissionMode: 'acceptEdits'`, this only fires for write operations.
2. **`preToolUse` hook** — `BaseAgentLib` always composes a sandbox guard `preToolUse` hook that fires for **all** tool calls regardless of `permissionMode`. This ensures sensitive path protection (`.ssh`, `.aws`, `.gnupg`, `.config`, `/etc`, `.env`) and path boundary enforcement for read-only operations (Read, Glob, Grep, read-only Bash) that bypass `canUseTool`.

**SDK permission mode:**
All pipeline agents use `sdkPermissionMode: 'acceptEdits'` — never `bypassPermissions`. With this mode, `canUseTool` fires only for write operations (not read-only tool calls like git status, Read, Glob). The sandbox guard `preToolUse` hook in `BaseAgentLib` compensates for this by enforcing path boundaries for all tool calls. Additionally, the `readOnlyGuard` preToolUse hook (from `agent.ts`) blocks destructive operations for read-only agents.

| Agent | isReadOnly | disallowedTools | readOnlyGuard | Can Write in Worktree |
|-------|:----------:|:---------------:|:-------------:|:---------------------:|
| Investigator | true | Write, Edit, MultiEdit, NotebookEdit | yes (blocks write tools + destructive Bash) | no |
| Planner | false | Edit, MultiEdit, NotebookEdit | no | yes (restricted to `tmp/` for verification scripts) |
| Reviewer | true | Write, Edit, MultiEdit, NotebookEdit | yes (blocks write tools + destructive Bash) | no |
| Designer | false | — | no | yes |
| Implementor | false | — | no | yes |

### PlannerPromptBuilder

`type: 'planner'`

- `isReadOnly() = false` (allows `Write` to `tmp/` for verification scripts; `Edit`/`MultiEdit`/`NotebookEdit` are disallowed)
- Max turns: 150, Timeout: 10 min
- Handles plan creation (`mode: 'new'`) and plan revision/resume (`mode: 'revision'`)
- `inferOutcome()` → `'plan_complete'`
- Structured output: `{ plan, planSummary, subtasks, phases }` + interactive fields
- When `revisionReason === 'changes_requested'`: includes plan feedback in prompt
- When `revisionReason === 'info_provided'`: includes user answers in prompt

### DesignerPromptBuilder

`type: 'designer'`

- `isReadOnly() = false` (may create scaffolding)
- Max turns: 150, Timeout: 10 min
- Handles technical design creation (`mode: 'new'`) and design revision/resume (`mode: 'revision'`)
- `inferOutcome()` → `'design_ready'`
- Structured output: `{ technicalDesign, designSummary }` + interactive fields

### ImplementorPromptBuilder

`type: 'implementor'`

- `isReadOnly() = false`
- `inferOutcome()` → `'pr_ready'`
- Only handles implementation, request changes, and conflict resolution

| Mode | RevisionReason | Max Turns | Timeout | Output Schema |
|------|----------------|-----------|---------|---------------|
| `new` | — | 200 | 30 min | `{ summary }` + interactive fields |
| `revision` | `changes_requested` | 200 | 30 min | `{ summary }` |
| `revision` | `conflicts_detected` | 50 | 10 min | `{ summary }` |
| `revision` | `uncommitted_changes` | 50 | 5 min | `{ summary }` |
| `revision` | `info_provided` | 200 | 30 min | `{ summary }` + interactive fields |

### InvestigatorPromptBuilder

`type: 'investigator'`

- `isReadOnly() = true`
- Max turns: 150, Timeout: 10 min
- Handles bug investigation (`mode: 'new'`) and investigation resume (`mode: 'revision'`)
- Includes `task.debugInfo` (raw debug logs) in the prompt when present — this field is only consumed by the investigator, keeping downstream agent prompts clean
- `inferOutcome()` → `'investigation_complete'`
- Structured output: `{ plan, investigationSummary, subtasks }` + interactive fields

### ReviewerPromptBuilder

`type: 'reviewer'`

- `isReadOnly() = true`
- Max turns: 50
- Uses structured output with JSON schema for verdict extraction
- Returns `{ verdict, summary, comments }` via structured output
- Returns payload `{ summary, comments }` for the `changes_requested` outcome

### TaskWorkflowReviewerPromptBuilder

`type: 'task-workflow-reviewer'`

- Max turns: 50
- Default timeout: 5 minutes
- Reviews task execution workflow quality and efficiency
- Structured output includes `overallVerdict`, `executionSummary`, `findings`, `promptImprovements`, `processImprovements`, `tokenCostAnalysis`

### ScriptedAgent

Test-only agent with a configurable script function. Built-in test scripts:
- `happyPlan` — returns `plan_complete`
- `happyImplement` — returns `pr_ready`
- `happyReview` — returns `approved`
- `failAfterSteps(n)` — fails after n calls
- `humanInTheLoop` — returns `needs_info`

## Agent Modes

```typescript
type AgentMode = 'new' | 'revision';
type RevisionReason = 'changes_requested' | 'info_provided' | 'merge_failed' | 'uncommitted_changes';
```

Agent runs are identified by the combination of `agentType`, `mode`, and optionally `revisionReason`:

| Agent Type | Mode | RevisionReason | Purpose | Default Outcome |
|-----------|------|----------------|---------|----------------|
| `planner` | `new` | — | Create implementation plan | `plan_complete` |
| `planner` | `revision` | `changes_requested` | Revise plan based on admin feedback | `plan_complete` |
| `planner` | `revision` | `info_provided` | Resume plan with user answers | `plan_complete` |
| `designer` | `new` | — | Create technical design | `design_ready` |
| `designer` | `revision` | `changes_requested` | Revise design based on feedback | `design_ready` |
| `designer` | `revision` | `info_provided` | Resume design with user answers | `design_ready` |
| `implementor` | `new` | — | Code implementation | `pr_ready` |
| `implementor` | `revision` | `changes_requested` | Address reviewer feedback | `pr_ready` |
| `implementor` | `revision` | `info_provided` | Resume implementation with user answers | `pr_ready` |
| `implementor` | `revision` | `conflicts_detected` | Resolve merge conflicts | `pr_ready` |
| `implementor` | `revision` | `uncommitted_changes` | Commit uncommitted work from prior run | `pr_ready` |
| `investigator` | `new` | — | Debug a bug report | `investigation_complete` |
| `investigator` | `revision` | `info_provided` | Resume investigation with user answers | `investigation_complete` |
| `reviewer` | `new` | — | PR code review | `approved` or `changes_requested` |

## Execution Lifecycle

**File:** `src/core/services/agent-service.ts`

`AgentService.execute(taskId, mode, agentType, revisionReason?, onOutput?)` performs 8 steps:

### Step 1: Fetch Task + Project

Loads the task and its project. Throws if the task, project, or project path is missing.

### Step 2: Create Agent Run Record

```typescript
const run = await this.agentRunStore.createRun({ taskId, agentType, mode });
```

Creates a database record with initial status `'running'`.

### Step 3: Manage Phase

Links or creates a task phase for the current mode, marks it as active.

### Step 4: Prepare Worktree

Reuses an existing worktree or creates a new one:

```
Branch naming: task/{taskId}
Multi-phase:   task/{taskId}/phase-{n}
Worktree path: {projectPath}/.agent-worktrees/{taskId}
```

Locks the worktree to prevent concurrent access.

### Step 5: Clean and Rebase

```typescript
await gitOps.clean();              // discard uncommitted changes
await gitOps.fetch('origin');
await gitOps.rebase('origin/main'); // isolate agent changes
```

Rebase failure is handled gracefully — aborted and logged as a warning.

### Step 6: Log Event

Records an `agent` event in the task event log.

### Step 7: Resolve and Execute Agent

AgentService gets the `Agent` from the framework and passes the engine via `AgentConfig`:

```typescript
const agent = this.agentFramework.getAgent(agentType);
const config: AgentConfig = { model, engine: agentDefEngine };
```

The `Agent` internally resolves the matching `IAgentLib` from its `AgentLibRegistry` using `config.engine`. The agent is tracked in the `runningAgents` map for stop support.

### Step 8: Return Run

Returns the `AgentRun` with `status: 'running'`. The caller can poll or listen for completion.

## Background Execution

`runAgentInBackground()` handles the actual agent work:

### Output Buffering

```typescript
const MAX_OUTPUT_BUFFER = 5 * 1024 * 1024; // 5 MB
```

Output is streamed to the caller via `onOutput` callback and accumulated in a buffer. The buffer is flushed to the database every 3 seconds. If the buffer exceeds 5 MB, it is truncated with `[output truncated]`.

### Agent Invocation

```typescript
const result = await agent.execute(context, config, wrappedOnOutput, onLog, onPromptBuilt);
```

### Validation Loop

For the `implementor` agent type (not planner/designer/investigator/reviewer), if the project has `config.validationCommands`:

1. Run each validation command in the worktree
2. If validation fails, re-run the agent with validation errors appended to the prompt
3. Repeat up to `maxValidationRetries` times (default 3)

### Outcome Transition

After agent completion, `tryOutcomeTransition()` finds a matching transition by `agentOutcome` and executes it (see [pipeline-engine.md](./pipeline-engine.md)).

For `pr_ready`, the service verifies the branch has actual changes via `git diff`. If no changes, overrides outcome to `no_changes`.

### Run Finalization

Updates the agent run record with: status, outcome, payload, exit code, output, cost tokens, completed timestamp. Unlocks the worktree. Updates the task phase status.

## Prompt Building

### Prompt Resolution (2-Tier)

Prompt resolution follows a two-tier priority chain inside `BaseAgentPromptBuilder.buildExecutionConfig()`:

1. **File-based prompt** — If `.agents/{agentType}/prompt.md` exists (loaded by `loadAgentFileConfig()`), render it through `PromptRenderer.render()` for variable substitution.
2. **Hardcoded fallback** — Call `this.buildPrompt(context)` on the prompt builder subclass.

```typescript
// In base-agent-prompt-builder.ts — buildExecutionConfig()
if (fileConfig?.prompt) {
  prompt = new PromptRenderer().render(fileConfig.prompt, context);
} else {
  prompt = this.buildPrompt(context);
}
```

The file-based prompt replaces **layer 1 only** (the instruction prompt). The system still auto-injects task context, feedback, worktree guards, skills, and validation errors around it. See [File-Based Agent Configuration](file-based-agent-config.md) for the full `.agents/` directory structure, config.json fields, mode-specific prompt files, and CLI commands.

After resolution, the builder appends skills (if any) and prepends task context entries (if any).

### PromptRenderer

**File:** `src/core/services/prompt-renderer.ts`

`PromptRenderer` handles template rendering for both file-based prompts (`.agents/{agentType}/prompt.md`) and any programmatic templates. It performs simple string replacement of placeholder variables, then auto-appends a summary suffix and any validation errors.

**Template variables** (13 total):

| Variable | Description |
|----------|-------------|
| `{taskTitle}` | Task title |
| `{taskDescription}` | Task description (space-prefixed if present) |
| `{taskId}` | Task UUID |
| `{subtasksSection}` | Auto-generated subtask guidance (plan mode: asks for subtask output; implement mode: shows checklist) |
| `{planSection}` | Existing task plan as markdown |
| `{planCommentsSection}` | Admin feedback on the plan |
| `{priorReviewSection}` | Re-review notice when prior review context exists |
| `{relatedTaskSection}` | Related task info for bug reports (with CLI commands) |
| `{technicalDesignSection}` | Existing technical design as markdown |
| `{technicalDesignCommentsSection}` | Admin feedback on the design |
| `{defaultBranch}` | Project default branch (defaults to `main`) |
| `{skillsSection}` | Available skills list for Skill tool invocation |
| `{skipSummary}` | Replaced with empty string; when present in the template, suppresses the auto-appended summary suffix |

**Auto-appended behaviors:**
- Unless the template contains `{skipSummary}`, PromptRenderer appends: "When you are done, end your response with a '## Summary' section..."
- If `context.validationErrors` is set, validation error output is appended to the rendered prompt

### Task Context Prepending

If the task has prior context entries, they are prepended to the prompt:

```markdown
## Task Context

### [agent] plan_summary (2024-01-15T10:00:00Z)
Summary of previous plan...

### [reviewer] review_feedback (2024-01-15T11:00:00Z)
Review feedback...

---

{actual prompt}
```

### Validation Errors

If the agent is being retried after validation failure, errors are appended:

```
The previous attempt produced validation errors. Fix these issues, then stage and commit:

{validationErrors}
```

## Structured Output

JSON schemas returned per agent type via `getOutputFormat()`:

**planner:**
```json
{
  "plan": "Full implementation plan as markdown",
  "planSummary": "Short 2-3 sentence summary",
  "subtasks": ["Step 1", "Step 2"]
}
```

**designer:**
```json
{
  "technicalDesign": "Full technical design as markdown",
  "designSummary": "Short 2-3 sentence summary"
}
```

**investigator:**
```json
{
  "plan": "Detailed investigation report",
  "investigationSummary": "Short 2-3 sentence summary",
  "subtasks": ["Fix step 1", "Fix step 2"]
}
```

**implementor:**
```json
{
  "summary": "Short summary of changes"
}
```

## Context Accumulation

**Type:** `TaskContextEntry` in `src/shared/types.ts`

```typescript
interface TaskContextEntry {
  id: string;
  taskId: string;
  agentRunId: string | null;
  source: string;       // 'agent' | 'reviewer'
  entryType: string;    // see mapping below
  summary: string;      // up to 2000 chars
  data: Record<string, unknown>;
  createdAt: number;
}
```

After each successful agent run (exitCode === 0), a context entry is saved:

| Agent Type | Mode/Reason | Entry Type |
|-----------|-------------|------------|
| `planner` | `new` | `plan_summary` |
| `planner` | `revision` + `changes_requested` | `plan_revision_summary` |
| `designer` | any | `design_summary` |
| `investigator` | any | `investigation_summary` |
| `implementor` | `new` | `implementation_summary` |
| `implementor` | `revision` + `changes_requested` | `fix_summary` |
| `reviewer` | (approved) | `review_approved` |
| `reviewer` | (changes_requested) | `review_feedback` |

The summary is extracted from the agent's structured output (`planSummary`, `investigationSummary`, `designSummary`, or `summary` field). Context entries are loaded and prepended to subsequent agent prompts, giving each run knowledge of prior work.

### Post-Run Handler Pattern

After each agent run, `agent-service.ts` creates a task-scoped `TaskAPI` instance and invokes the agent's registered post-run handler from `POST_RUN_HANDLERS` (`src/core/agents/post-run-handlers.ts`). Each handler is a plain function colocated with its prompt builder (e.g., `planner-post-run-handler.ts` beside `planner-prompt-builder.ts`). The handler maps the agent's structured output to `TaskAPI` persistence calls (upsert docs, update task, save context entries, mark feedback as addressed). Shared utilities live in `src/core/agents/post-run-utils.ts`.

## Orphan Recovery

On startup, `recoverOrphanedRuns()`:

1. Finds all agent runs with `status = 'running'`
2. Marks them as `failed` with outcome `interrupted`
3. Fails their active task phases
4. Unlocks their worktrees
5. Expires their pending prompts

This handles the case where the app was killed while agents were running.

## Session Management

Agent runs use Claude Code's native session resume feature to maintain conversational context across related runs. Each run stores its effective `sessionId` on the `agent_runs` record.

### Session Chaining

Sessions are identified by the run ID of the original creator (first `mode='new'` run):

```
implementor (new, run A)   → creates session A, stores sessionId=A
reviewer    (new, run B)   → resumes session A, stores sessionId=A
implementor (revision, C)  → resumes session A, stores sessionId=A
reviewer    (new, run D)   → resumes session A, stores sessionId=A
```

The reviewer shares the implementor's session for context continuity. Other agent types (planner, designer) maintain independent session chains.

### Session ID Resolution

`AgentService.execute()` determines `context.sessionId` based on agent type and mode:

| Agent Type | Mode | Session ID Source |
|-----------|------|-------------------|
| Any | `new` (first run) | `run.id` (creates new session) |
| `reviewer` | `new` | `findOriginalSessionRun('implementor').sessionId` (resumes implementor's session) |
| Any | `revision` | `findOriginalSessionRun(agentType).sessionId` (resumes own session chain) |
| Any | crash recovery | `pendingResumeRun.id` (resumes interrupted session) |

`findOriginalSessionRun()` returns the oldest completed `mode='new'` run for the given agent type. The stored `sessionId` field (not `run.id`) is used for chaining, because after crash recovery the completing run may have resumed an earlier session.

### Crash Recovery and Session IDs

When the app restarts after a crash:

1. `recoverOrphanedRuns()` marks interrupted runs as `failed` with outcome `interrupted`
2. `setPendingResume(taskId, interruptedRun)` stores the interrupted run for session resume
3. On next `execute()`, the new run resumes the interrupted session using `pendingResumeRun.id` as the session ID
4. The new run stores `sessionId = pendingResumeRun.id` (not its own `run.id`)

This ensures that downstream agents (e.g., reviewer) can find the correct session ID by reading the stored `sessionId` from the completing run, even when that run resumed an earlier session.

### Session Resume Fallback

**File:** `src/core/agents/agent.ts` — `isSessionResumeFailure()`

If a session resume fails — for any reason (missing session file, corrupt data, SDK bug) — `Agent.execute()` detects the failure and automatically retries with the full prompt and no session resume, rather than failing the run.

**Detection (`isSessionResumeFailure`):** After `lib.execute()` returns, the result is checked for all of:
- `exitCode !== 0` — process failed
- `killReason` is unset — not a timeout or user-initiated stop
- `costInputTokens` is 0 or undefined — no API calls were made
- `costOutputTokens` is 0 or undefined — no tokens consumed
- `output` is empty — no work was done

This pattern matches the specific case where Claude Code exits immediately because it cannot find or load the session to resume.

**Retry behavior:**
1. Logs a warning with the original error and session ID
2. Emits `[Session resume failed — retrying with full prompt]` to the output stream
3. Calls `lib.execute()` again with:
   - `prompt`: the full system prompt (`execConfig.prompt`), not the short continuation prompt
   - `resumeSession: false` — starts a fresh session instead of resuming
4. The retry result is used for outcome inference and result building as normal

The fallback fires at most once per `execute()` call. If the retry also fails, it fails normally through the standard error path.

## Agent Stop

`Agent` tracks active libs per runId and delegates stop to the correct lib:

```typescript
async stop(runId: string): Promise<void> {
  const iv = this.telemetryIntervals.get(runId);
  if (iv) clearInterval(iv);
  this.telemetryIntervals.delete(runId);
  this.lastTelemetries.delete(runId);
  const lib = this.activeLibs.get(runId);
  if (lib) {
    this.activeLibs.delete(runId);
    await lib.stop(runId);
  }
}
```

`ClaudeCodeLib` uses an `AbortController` per running agent:

```typescript
private runningStates = new Map<string, RunState>();

async stop(runId: string): Promise<void> {
  const state = this.runningStates.get(runId);
  if (!state) return;
  state.abortController.abort();
  this.runningStates.delete(runId);
}
```

`AgentService` tracks running `Agent` instances in a `runningAgents` map keyed by task ID, so it can route stop requests to the correct instance.

The abort controller is also triggered by the timeout timer. On abort, the SDK loop terminates with an `AbortError`, the agent returns with `exitCode = 1`.

## Edge Cases

- **`pr_ready` verification:** Before triggering the `pr_ready` outcome transition, agent service diffs the branch against `origin/main`. If empty, outcome is overridden to `no_changes`.
- **5 MB output cap:** Output buffer is hard-limited. Truncated output ends with `[output truncated]`.
- **ESM import:** The Claude SDK uses ESM. `ClaudeCodeLib` uses a dynamic `import()` to load the SDK at runtime.
- **Agent definition lookup failure:** If `getDefinitionByMode()` throws (definition missing or corrupt), the error is caught silently and the agent falls back to its hardcoded `buildPrompt()`.
- **AbortController keying:** The `runId` passed to `IAgentLib` is set to `context.task.id` (task ID) in `Agent.execute()`, not the `run.id` from the database. Concurrent runs on the same task are prevented by the `no_running_agent` guard.
- **Engine fallback:** If the agent definition has no engine set, `AgentService` defaults to `claude-code` engine.
- **CLI backend token counts:** The CLI backend (`cursor-agent`, `codex-cli`) always returns 0 for token counts because these engines do not expose usage telemetry.

## AgentSupervisor

**File:** `src/core/services/agent-supervisor.ts`

The `AgentSupervisor` is a background watchdog that periodically polls for agent runs that are stale or orphaned.

### Behavior

- **Poll interval:** 30 seconds (configurable via constructor)
- **Default timeout:** 35 minutes (fallback when a run has no stored `timeoutMs`)
- **Per-run timeout:** Uses `run.timeoutMs` from the database (populated by the telemetry flush every 3 seconds) plus a 5-minute grace period. This ensures the supervisor does not kill agents before their SDK-level timeout fires.

### Detection logic

On each poll, the supervisor iterates all active runs from the database:

1. **Timeout detection:** If a run has been active longer than its effective timeout (`run.timeoutMs + 5min grace`, or the default 35 minutes), the supervisor calls `agentService.stop()` to abort the agent, then marks the run `timed_out`.
2. **Stall detection:** Scans tasks in `agent_running` statuses with no running agent and no recently completed agent, then retries the `start_agent` hook (capped at 2 attempts per task).

Ghost runs (DB says running but no in-memory tracking) are prevented at the source: `AgentService.execute()` marks the DB run as `failed` if setup throws before the agent starts, and `recoverOrphanedRuns()` cleans up runs orphaned by daemon crashes at startup.

### Lifecycle

- `start()` — begins the poll interval (idempotent; no-op if already running)
- `stop()` — clears the poll interval

## SandboxGuard

**File:** `src/core/services/sandbox-guard.ts`

`SandboxGuard` enforces file-system boundaries for agent tool calls. It is used by `BaseAgentLib` for both task agents and chat agents, enforced via two independent paths:

**1. `canUseTool` callback (write operations):**
`BaseAgentLib` builds a unified `canUseTool` callback that chains three checks:
1. **SandboxGuard** — synchronous file-system boundary check (always runs first)
2. **Caller's `canUseTool`** — async interceptor for special tools (e.g. AskUserQuestion handler)
3. **`onPermissionRequest`** — interactive UI approval (only when provided, i.e. non-full_access modes)

With `permissionMode: 'acceptEdits'`, the SDK only calls `canUseTool` for write operations — read-only tool calls are auto-approved.

**2. `preToolUse` hook (all operations — defense-in-depth):**
`BaseAgentLib` always composes a sandbox guard `preToolUse` hook that fires for **all** tool calls regardless of `permissionMode`. This ensures sensitive path protection and path boundary enforcement for read-only operations (Read, Glob, Grep, read-only Bash) that bypass `canUseTool`. The sandbox guard hook runs FIRST, before any caller-provided `preToolUse` hooks (worktreeGuard, readOnlyGuard, etc.).

### Configuration

Constructor takes two path lists:
- `allowedPaths` — directories where the agent can read and write
- `readOnlyPaths` — directories where the agent can read but not write

### Tool evaluation

`evaluateToolCall(toolName, toolInput)` returns `{ allow: boolean; reason?: string }`:

- **Write/Edit/MultiEdit/NotebookEdit** — path must be within `allowedPaths` and not match sensitive patterns
- **Read/Glob/Grep** — path must be within `allowedPaths` or `readOnlyPaths`
- **Bash** — extracts file paths from common commands (`cat`, `rm`, `cp`, `cd`, etc.) via regex and validates each against the path boundaries
- **Other tools** — allowed by default

### Sensitive path protection

Blocks access to paths matching: `/.ssh`, `/.aws`, `/.gnupg`, `/.config`, `/etc`, `.env`

### Fail-closed design

Any error during guard evaluation results in the tool call being blocked (not allowed). This prevents path-resolution edge cases from bypassing the sandbox.

## ChatAgentService

**File:** `src/core/services/chat-agent-service.ts`

`ChatAgentService` handles interactive chat sessions with AI agents, supporting both project-scoped and task-scoped conversations.

### Unified AgentLib Execution

All chat agent execution goes through the `IAgentLib` abstraction via `AgentLibRegistry`. The service resolves the lib by name, then calls `lib.execute()` with `AgentLibRunOptions` and `AgentLibCallbacks`. Feature detection via `lib.supportedFeatures()` adapts behavior per engine:

- **Hooks** — When the lib supports hooks, the service passes a `preToolUse` hook that hard-blocks write tools (Edit, Write, Bash write commands). The lib merges this with its own `SandboxGuard` hook.
- **Images** — When the lib supports images, base64 image data is passed via `options.images`. For non-image-supporting engines, image file paths are embedded in the prompt text instead.
- **Tool results** — The `onUserToolResult` callback streams tool result content back for real-time display.

### Agent Lib Resolution Order

The agent lib for a chat session is resolved in priority order:
1. `session.agentLib` — per-session override
2. `project.config.defaultAgentLib` — project-level default
3. Global setting `chat_default_agent_lib` — app-wide default
4. Hardcoded fallback: `claude-code`

If the resolved lib is not registered in the registry, falls back to `claude-code` with a warning.

### Session Resume for Chat

Conversation continuity is handled via native SDK session resume — not manual history replay. On follow-up messages, `ChatAgentService` sets `resumeSession: true` and passes the session key as `sessionId` in the execute options. See [agent-types.md](./agent-types.md) for full session key resolution per agent type.

### Scope Resolution

`resolveScope()` determines the working directory and system prompt based on session scope:
- **Project scope** — uses the project path and a generic read-only assistant system prompt
- **Task scope** — resolves the task's project, builds a task-specific system prompt with task details, status, plan, and useful CLI commands

### Summarize Flow

`summarizeMessages()` compresses conversation context while preserving full history:
1. Stops any running agent for the session
2. Builds a summarization prompt from all messages
3. Runs a single-turn Claude query to generate the summary
4. **Appends** the summary as a new system message — all original messages are preserved in the DB for UI history
5. Accumulates historical token costs onto the summary message
6. Marks the session as compacted (`compactedSessions` set) so the next `sendMessage()` starts a fresh SDK session

**Session resume after compaction:** After compaction, the `compactedSessions` flag forces `shouldResume = false` on the next message, preventing the SDK from replaying the old session state (which may contain oversized images or stale context). The flag is consumed (one-shot) on the first post-compaction message; subsequent messages resume normally. This applies to all agent libs that support session resume (claude-code, codex-cli, codex-app-server, base-agent).

### Running Agent Tracking

Active chat agents are tracked in a `runningAgents` map keyed by session ID. Each entry stores: session info, scope, project, status, start time, last activity, and a message preview. Completed/failed agents are cleaned up after a 5-second delay. Stale entries (older than 1 hour) are cleaned up on `getRunningAgents()` calls.

### Agent-Chat AgentRun Tracking

Agent-chat sessions (source `'agent-chat'`) create persistent `AgentRun` records so that costs, messages, and execution history are visible in the Agent Runs tab alongside pipeline runs.

**Lifecycle:**
1. On the **first message** in an agent-chat session, `send()` creates a new `AgentRun` with `mode: 'revision'` and `agentType` matching the session's `agentRole` (e.g., `'planner'`). The run ID is stored on the session via `ChatSession.agentRunId`.
2. On **subsequent messages**, the existing `agentRunId` is reused — no new run is created.
3. In `runAgent()`'s `finally` block, the run is updated with accumulated `costInputTokens`, `costOutputTokens`, `messages`, and `status`.

**Relationship to pipeline runs:** Agent-chat revision runs are **separate** from the original pipeline run that produced the plan/design. This keeps cost attribution clean and avoids mutating a completed pipeline run.

```
Task
├── AgentRun (planner, mode='new')       ← original pipeline run that wrote the plan
├── AgentRun (planner, mode='revision')  ← all chat messages with the planner
├── AgentRun (designer, mode='new')      ← original pipeline run that wrote the design
└── AgentRun (designer, mode='revision') ← all chat messages with the designer
```

Both run types appear in `getRunsForTask(taskId)` and are visible in the Agent Runs tab.

**UI integration:** An `agent_run_info` message is emitted at the start of each `runAgent()` call when an `agentRunId` is available. The `ChatMessageList` component renders this as a small "Agent Run · View details →" link that navigates to `/agents/:runId`.

### Plan/Design Review Chat

The review chat is a conversational interface on the Plan Review and Design Review pages. It supports two user flows through a single chat panel:

**Q&A Flow (Send button):** User asks questions about the plan/design. The agent responds conversationally — explaining rationale, discussing tradeoffs, suggesting alternatives. No modifications are made to the plan/design.

**Request Changes Flow (Request Changes button):** User describes desired changes in the chat conversation. The agent acknowledges the request, summarizes what will change, and asks clarifying questions if needed. Conversation messages are saved incrementally as context entries during the chat. When the user clicks "Request Changes", any text in the input is saved as a final feedback entry and the task transitions back to `planning`/`designing`. The planner/designer pipeline re-runs with the full conversation as context.

```
User lands on Plan Review
├── Reads plan on left panel, chat on right (open by default)
├── Q&A: types question → Send → agent responds → no state change
├── Change request: describes changes → agent acknowledges/clarifies
│   └── Clicks "Request Changes" → optional final comment saved → task → planning
│       └── Planner re-runs (mode='revision') with feedback context
│           └── New plan produced → task → plan_review → user reviews again
└── Satisfied: clicks "Approve & Implement" → task → implementing
```

**UI layout (PlanReviewPage):**
- Header: `[Approve & Implement]  [Chat toggle]`
- Left panel (60%): Plan/design content as markdown
- Right panel (40%): ReviewConversation with chat history + input area
- Input area: `[Send]` (right) + `[Request Changes]` (left, enabled when conversation exists or input has text; disabled during streaming)

**Session resume chain:** The chat agent resumes the original planner/designer's Claude session, preserving full context. When the planner re-runs after "Request Changes", it also resumes the same session — so it sees the original plan, the user's Q&A conversation, and the feedback.

```
Planner (mode='new')        → creates Claude session S1
Chat agent (planner role)   → resumes S1 (sees planner's full context)
User chats Q&A              → messages added to S1
User clicks Request Changes → task transitions to 'planning'
Planner (mode='revision')   → resumes S1 (sees original plan + chat + feedback)
```

**Key design decisions:**
- The chat agent does NOT modify the plan/design directly — it is purely conversational
- Plan/design changes are only made by the full pipeline agent (planner/designer) which has structured output, proper prompt builders, and full context
- This avoids reliability issues with LLM-driven inline edits (rewording, reordering, missing details)
- The same flow applies to both plan review and design review via the `CONFIG` object in PlanReviewPage

**Files:**
- `src/renderer/pages/PlanReviewPage.tsx` — review page (handles both plan and design)
- `src/renderer/components/plan/ReviewConversation.tsx` — chat UI with Send + Request Changes
- `src/renderer/hooks/useReviewConversation.ts` — bridges context entries with agent-chat streaming
- `src/core/services/chat-prompt-parts.ts` — `buildAgentChatSystemPrompt()` (review chat prompt)

### Interactive Tool Approval

When not in `full_access` permission mode, `ChatAgentService` builds an `onPermissionRequest` callback that surfaces tool calls to the UI for interactive user approval before execution.

**Flow:**
1. `ClaudeCodeLib` receives a tool call, runs the SandboxGuard first (deny if out-of-bounds), then calls `onPermissionRequest`
2. `ChatAgentService` generates a `requestId` (`{sessionId}:{uuid}`), broadcasts a `permission_request` message to the UI via the `CHAT_PERMISSION_REQUEST` WebSocket channel
3. A promise is created and stored in `pendingPermissionRequests` map (keyed by `requestId`)
4. Tool execution blocks until the promise resolves
5. The UI calls `resolvePermissionRequest(requestId, allowed)` which resolves the promise
6. If the user does not respond within 5 minutes (`PERMISSION_TIMEOUT_MS`), the request is auto-denied
7. On agent stop, `clearPendingPermissionRequests()` auto-denies all pending requests for the session

### Streaming

Real-time token streaming uses the SDK's `onStreamEvent` callback:

- `ClaudeCodeLib` forwards raw `content_block_delta` events via `callbacks.onStreamEvent`
- `ChatAgentService` transforms deltas into typed messages: `text_delta`, `thinking_delta`, `input_json_delta`
- Deltas are broadcast to the renderer via the `CHAT_STREAM_DELTA` WebSocket push channel
- The renderer accumulates deltas to reconstruct partial messages during generation

### SDK Prompt Input

`ClaudeCodeLib` uses Single Message Input (string prompt) by default. Only messages with images use a single-yield async generator to pass multimodal content blocks. Multi-turn conversation is handled via native SDK session resume — not by keeping a generator alive. See [agent-lib-features.md](./agent-lib-features.md) for details.

### System Prompt Customization

Sessions support custom system prompt instructions via `systemPromptAppend`:

- When a session has `systemPromptAppend`, the system prompt is returned as a preset object: `{ type: 'preset', preset: 'claude_code', append: '...' }`. This tells the SDK to use its built-in Claude Code system prompt and append the combined instructions (built prompt + user's custom instructions).
- Without `systemPromptAppend`, the base prompt string is passed directly for backward compatibility
- `settingSources: ['project']` is always set, enabling automatic CLAUDE.md loading from the project directory

### Full Hooks System

`ChatAgentService` constructs a hooks object passed via `AgentLibRunOptions.hooks`. `ClaudeCodeLib.buildSdkHooks()` transforms these into the SDK hook format (`Partial<Record<HookEvent, HookCallbackMatcher[]>>`).

Default hooks wired by `ChatAgentService`:
- **PostToolUse** — Debug-level audit logging of tool name and response preview
- **Notification** — Forwards agent notifications to the UI as `notification` messages
- **Stop** — Logs the stop event
- **SubagentStart / SubagentStop** — Emit `subagent_activity` messages to the UI for real-time subagent lifecycle tracking

The SandboxGuard always runs as a `preToolUse` hook via `BaseAgentLib` for defense-in-depth — this fires for **all** tool calls regardless of `permissionMode`, ensuring sensitive path protection and path boundary enforcement even when `canUseTool` is skipped for read-only operations. For write operations, the sandbox guard runs in both paths (preToolUse hook AND canUseTool callback) as intentional defense-in-depth.

### Subagent Definitions

Thread chat sessions (source `desktop`/`telegram`/`cli`, not `agent-chat`) receive three default subagents via the `agents` option in `AgentLibRunOptions`:

| Subagent | Model | Max Turns | Purpose |
|----------|-------|-----------|---------|
| `code-reviewer` | sonnet | 15 | Review diffs, PRs, and code quality |
| `researcher` | sonnet | 20 | Codebase exploration and architecture analysis |
| `test-runner` | haiku | 10 | Run tests, analyze results, investigate failures |

These are defined in `DEFAULT_CHAT_SUBAGENTS` and made available via the SDK's Task tool. Agent-chat (review) sessions and pipeline agents do not receive subagents.

### Slash Commands

`ChatAgentService` detects messages starting with `/` and handles them:
- `/clear` — Clears local message history via `chatMessageStore.clearMessages()`. The SDK also handles the session-level clear natively.
- All other slash commands (e.g., `/compact`) — Forwarded to the SDK as the raw prompt. The SDK handles them natively.

A `slash_command` event is emitted to the UI with the command name and arguments.

### Plugins

Project-level plugins are parsed from `project.config.plugins` via `parsePluginsConfig()` and passed through to the SDK via `AgentLibRunOptions.plugins`. Only `{ type: 'local', path: string }` plugins are supported. The SDK loads and activates them during agent execution.
