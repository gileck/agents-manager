---
title: Agent Lib Features
description: Feature reference for the IAgentLib abstraction — interfaces, logic, and UX flows
summary: "Documents each feature supported by the agent lib abstraction: interactive tool approval, streaming, hooks, subagents, system prompt customization, slash commands, plugins, images, session resume, and prompt injection. Each section covers the interface contract, service-layer logic, UX flow, and which libs implement it."
priority: 2
key_points:
  - "All features are opt-in via AgentLibFeatures flags and optional fields on AgentLibRunOptions/AgentLibCallbacks"
  - "chat-agent-service.ts adapts behavior per lib using supportedFeatures() checks"
  - "Interface: src/core/interfaces/agent-lib.ts — Reference impl: src/core/libs/claude-code-lib.ts"
  - "Feature flags: images, hooks, thinking, nativeResume"
---
# Agent Lib Features

Feature reference for the `IAgentLib` abstraction. Each section documents a
feature independent of any specific engine — the interface contract, how the
service layer wires it, and the end-to-end UX flow.

**Interface file:** `src/core/interfaces/agent-lib.ts`
**Service file:** `src/core/services/chat-agent-service.ts`
**Reference implementation:** `src/core/libs/claude-code-lib.ts`

---

## Feature Flags

Each lib declares its capabilities via `supportedFeatures()`:

```typescript
interface AgentLibFeatures {
  images: boolean;       // base64 image content blocks
  hooks: boolean;        // full hook lifecycle system
  thinking: boolean;     // thinking/reasoning blocks
  nativeResume: boolean; // native session resume (vs. history replay)
}
```

The service layer checks these flags before wiring callbacks and options. A lib
that returns `false` for a flag will never receive the corresponding options.

| Lib | images | hooks | thinking | nativeResume |
|-----|:------:|:-----:|:--------:|:------------:|
| ClaudeCodeLib | yes | yes | yes | yes |
| CursorAgentLib | no | no | yes | no |
| CodexCliLib | yes | no | no | no |

---

## Interactive Tool Approval

Surfaces tool calls to the UI for user approval before execution.

### Interface

```typescript
// AgentLibCallbacks
onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResponse>;

interface PermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

interface PermissionResponse {
  allowed: boolean;
}
```

### Logic

1. Before executing a tool, the lib calls `onPermissionRequest()` and awaits the response
2. The sandbox guard (`preToolUse` hook) runs first — if it blocks the tool, the permission callback is never called
3. If `onPermissionRequest` is not provided, tools execute without user approval
4. The service maintains a `pendingPermissionRequests` map keyed by `requestId` with promise resolvers
5. Requests auto-deny after 5 minutes (configurable timeout)
6. Pending requests are cleared when the agent stops or the session is deleted

### UX Flow

```
Agent wants to use a tool
  → Sandbox guard checks permission mode (read_only / read_write / full_access)
  → If blocked → tool denied (no UI prompt)
  → If allowed → onPermissionRequest fires
    → Service broadcasts permission_request via CHAT_PERMISSION_REQUEST WebSocket channel
    → UI renders a card with tool name, input preview, Allow/Deny buttons
    → User clicks Allow or Deny
    → UI calls POST /api/chat/sessions/:id/permission-response
    → Service resolves the pending promise
    → Lib receives the response and allows/denies the tool
```

### Message Types

- `permission_request` — broadcasted to UI: `{ requestId, toolName, toolInput, timestamp }`
- `permission_response` — displayed in chat: `{ requestId, allowed, timestamp }`

### SDK Permission Mode

The SDK `permissionMode` controls how tool calls are approved at the engine level. The app passes `sdkPermissionMode` via `AgentLibRunOptions`:

| Context | SDK Permission Mode | Enforcement |
|---------|-------------------|-------------|
| Pipeline agents | `'acceptEdits'` | Auto-accept file edits; read-only agents get `disallowedTools` for Write/Edit/MultiEdit/NotebookEdit |
| Thread chat agents | `'acceptEdits'` (default) | App-level enforcement via `disallowedTools` + `onPermissionRequest` based on user's chosen PermissionMode |

**Note:** `bypassPermissions` is never used. All agents use `'acceptEdits'` which ensures the SDK's `canUseTool` callback fires, enabling the SandboxGuard to enforce path restrictions.

### canUseTool Return Value

The `canUseTool` callback in `BaseAgentLib` builds a three-stage permission chain (sandbox guard → caller interceptor → UI approval). When returning an allow decision, the callback **must** always include `updatedInput` with the tool input — the SDK's runtime Zod validation requires it even though the TypeScript types mark it optional. Omitting `updatedInput` causes a ZodError that silently blocks tool execution.

```typescript
// Correct — always pass updatedInput when allowing
return { behavior: 'allow', updatedInput: updatedInput ?? input };

// Wrong — triggers SDK ZodError for write operations
return { behavior: 'allow' };
```

**Note:** With `permissionMode: 'acceptEdits'`, read-only operations (git status, git diff, Read, Glob) are auto-approved by the SDK without calling `canUseTool`. Only write operations (git add, git commit, Write, Edit, Bash with write commands) go through the callback.

### Implemented By

ClaudeCodeLib (via `canUseTool` SDK callback)

---

## Partial Message Streaming

Real-time token-by-token streaming for text, thinking, and tool input display.

### Interface

```typescript
// AgentLibCallbacks
onStreamEvent?: (event: { type: string; [key: string]: unknown }) => void;
```

### Logic

1. The lib enables streaming mode and forwards raw delta events through `onStreamEvent`
2. Three delta types are emitted: `text_delta`, `thinking_delta`, `input_json_delta`
3. The service broadcasts each delta via the `CHAT_STREAM_DELTA` WebSocket channel
4. The renderer accumulates consecutive deltas into display blocks

### UX Flow

```
Agent generates tokens
  → Lib emits onStreamEvent({ type: 'text_delta', delta: '...' })
  → Service broadcasts via CHAT_STREAM_DELTA WebSocket channel
  → Renderer receives delta in useChat hook
  → Consecutive text_delta events merge into a live assistant_text block
  → Consecutive thinking_delta events merge into a live thinking block
  → When the full message arrives (via onMessage), the accumulated deltas are replaced
```

### Message Types

- `stream_delta` — transient event: `{ deltaType, delta, timestamp }`

### Implemented By

ClaudeCodeLib (via `includePartialMessages: true`)

---

## SDK Prompt Mode: Single Message Input

Each agent execution uses a **string prompt** (Single Message Input) rather than the SDK's
Streaming Input Mode (async generator). Multi-turn conversation is handled via native
SDK session resume — not by keeping a generator alive.

### Why Not Streaming Input Mode?

The SDK docs recommend Streaming Input Mode for apps that push multiple user messages
into a single `query()` call (interactive REPL-style agents). Our chat model is
**request-response**: each `chat.send()` starts a new `query()` call, and follow-ups
use session resume. A long-lived async generator caused deadlocks — the generator's
`while (!closed)` loop blocked forever because `close()` ran in the `finally` block
that couldn't execute until the generator returned.

### Current Behavior

- **Text messages** → `prompt: string` (Single Message Input)
- **Messages with images** → single-yield async generator (yields one message, returns immediately)
- **Follow-up messages** → new `query()` call with `resume: sessionId`

### Limitation: No Mid-Stream Message Injection

Users cannot push messages into a running agent. When the agent is running:
- **Stop** — abort the agent via `AbortController`
- **Queue** — one message is queued in `useChat.ts` and auto-sent after the agent completes
- **Wait** — send a follow-up after the agent finishes (new `query()` with session resume)

If mid-stream injection is ever needed, the SDK's Streaming Input Mode can be re-adopted
with a properly implemented generator that uses event-driven wakeup (not a blocking loop)
tied to the abort signal.

---

## Hook System

Lifecycle hooks for tool execution, notifications, subagent events, and context compaction.

### Interface

```typescript
// AgentLibRunOptions
hooks?: AgentLibHooks;

interface AgentLibHooks {
  preToolUse?: (toolName, toolInput) => { decision: 'block' | 'allow'; reason? } | undefined;
  postToolUse?: (input: PostToolUseHookInput) => PostToolUseHookOutput | void;
  postToolUseFailure?: (input: PostToolUseFailureHookInput) => PostToolUseFailureHookOutput | void;
  notification?: (input: NotificationHookInput) => NotificationHookOutput | void;
  stop?: (input: StopHookInput) => void;
  subagentStart?: (input: SubagentStartHookInput) => SubagentStartHookOutput | void;
  subagentStop?: (input: SubagentStopHookInput) => void;
  preCompact?: (input: PreCompactHookInput) => void;
}
```

### Logic

The service wires default hooks when `supportedFeatures().hooks === true`:

| Hook | Default Behavior |
|------|-----------------|
| `preToolUse` | Worktree guard (pipeline agents) — hard-blocks Write/Edit/Bash targeting the main repo when agent is in a worktree. Also used as sandbox guard in chat agents. |
| `postToolUse` | Audit logging — logs tool name and result summary to app logger |
| `notification` | Forwards notifications to UI as `notification` messages via WebSocket |
| `stop` | Logs agent stop reason |
| `subagentStart` | Emits `subagent_activity` message with `status: 'started'` |
| `subagentStop` | Emits `subagent_activity` message with `status: 'completed'` |

The lib is responsible for transforming these hooks into whatever format its engine requires and calling them at the appropriate lifecycle points. `ClaudeCodeLib.buildSdkHooks()` transforms all hook types (including `preToolUse`) into the SDK's `HookCallbackMatcher[]` format.

### UX Flow

```
Notification hook fires
  → Service emits notification message via onEvent callback
  → UI renders notification card in chat thread (title + body)

Subagent starts/stops
  → Service emits subagent_activity message
  → UI renders activity card (Bot icon for started, CheckCircle for completed)
```

### Message Types

- `notification` — `{ title?, body, timestamp }`
- `subagent_activity` — `{ agentName, status: 'started' | 'completed', toolUseId?, timestamp }`

### Implemented By

ClaudeCodeLib (via `buildSdkHooks()` which transforms hooks into SDK `HookCallbackMatcher[]` format)

---

## Subagent Definitions

Define specialized sub-agents that the main agent can delegate tasks to.

### Interface

```typescript
// AgentLibRunOptions
agents?: Record<string, SubagentDefinition>;

interface SubagentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  maxTurns?: number;
}
```

### Logic

1. The service defines default subagents for thread chat sessions (desktop, telegram, cli sources)
2. Default subagents are **not** added for agent-chat or pipeline sessions
3. The lib passes agent definitions to the engine, which makes them available as delegatable tools

**Default subagents:**

| Name | Description | Model | Tools | Max Turns |
|------|-------------|-------|-------|-----------|
| `code-reviewer` | Reviews code changes | sonnet | Read, Glob, Grep, Bash | 15 |
| `researcher` | Codebase exploration | sonnet | Read, Glob, Grep | 20 |
| `test-runner` | Runs and analyzes tests | haiku | Read, Glob, Grep, Bash | 10 |

### UX Flow

```
Agent decides to delegate a task
  → Engine spawns the named subagent with its own prompt, tools, and model
  → subagentStart hook fires → UI shows "code-reviewer started" card
  → Subagent executes independently
  → subagentStop hook fires → UI shows "code-reviewer completed" card
  → Result returned to parent agent
```

### Implemented By

ClaudeCodeLib (passes `agents` directly to SDK `query()`)

---

## System Prompt Customization

Per-session customizable system prompts with preset support and settings auto-loading.

### Interface

```typescript
// AgentLibRunOptions
systemPrompt?: string | SystemPromptPreset;
settingSources?: Array<'user' | 'project' | 'local'>;

interface SystemPromptPreset {
  type: 'preset';
  preset: 'claude_code';
  append?: string;
}
```

### Logic

1. `systemPrompt` accepts either a plain string or a preset object
2. When `SystemPromptPreset` is used, the engine loads its built-in prompt and appends custom instructions
3. `settingSources: ['project']` tells the engine to auto-load CLAUDE.md files from the project directory
4. The session stores `systemPromptAppend` (persisted in DB via migration 109)
5. `buildSendContext()` constructs the prompt: if `systemPromptAppend` exists, it builds a preset object; otherwise uses the default string prompt

### UX Flow

```
User opens session settings (ContextSidebar)
  → Textarea shows current systemPromptAppend value
  → User types custom instructions
  → Debounced save calls PATCH /api/chat/sessions/:id with systemPromptAppend
  → Next message uses the updated system prompt (preset + append)
```

### Data Flow

- `ChatSession.systemPromptAppend` — persisted in SQLite
- `PATCH /api/chat/sessions/:id` — accepts `systemPromptAppend` field
- `buildSendContext()` — constructs `SystemPromptPreset` when append is set
- Renderer — `ContextSidebar.tsx` has a `CustomInstructionsSection` with textarea

### Implemented By

ClaudeCodeLib (passes `systemPrompt` and `settingSources` to SDK `query()`)

---

## Slash Commands

Route `/command` messages to the engine for native handling.

### Interface

No interface changes — slash commands work through the existing `prompt` field. The service detects the `/` prefix and adjusts behavior.

### Logic

1. In `send()`, if the message starts with `/`, it is treated as a slash command
2. The raw command text is sent as the prompt to the engine without modification (no image injection, no instruction suffix)
3. Built-in commands (e.g., `/compact`, `/clear`) are handled natively by the engine
4. For `/clear`, the service also clears the local DB message history
5. A `slash_command` message is emitted to the UI with `status: 'invoked'`

### UX Flow

```
User types "/compact" in chat input
  → Service detects "/" prefix
  → Emits slash_command message (status: 'invoked') → UI shows command card
  → Sends "/compact" as prompt to engine
  → Engine handles compaction natively
  → Response flows back through normal message pipeline
```

### Message Types

- `slash_command` — `{ command, args?, status: 'invoked' | 'completed', timestamp }`

### Implemented By

Service-level detection + ClaudeCodeLib (engine handles commands natively)

---

## Plugins

Load local plugins to extend agent sessions with custom commands, skills, hooks, and MCP servers.

### Interface

```typescript
// AgentLibRunOptions
plugins?: Array<{ type: 'local'; path: string }>;
```

### Logic

1. Plugin paths are read from the project's `config.plugins` field via `parsePluginsConfig()`
2. The service passes plugins through to the lib's execute options
3. The lib forwards them to the engine — pure pass-through, no transformation

### UX Flow

```
Project config has plugins: [{ type: 'local', path: '/path/to/plugin' }]
  → Service reads config during scope resolution
  → Passes plugins array to lib.execute()
  → Engine loads plugins and makes their capabilities available
  → Plugin-provided commands, skills, hooks appear in the agent's context
```

### Implemented By

ClaudeCodeLib (passes `plugins` to SDK `query()`)

---

## Image Support

Pass images to the agent as base64 content blocks.

### Interface

```typescript
// AgentLibRunOptions
images?: Array<{ base64: string; mediaType: string }>;
```

### Logic

The service checks `supportedFeatures().images`:
- **`true`** — passes base64 image data via `options.images`
- **`false`** — saves images to disk and injects file paths into the prompt text

### UX Flow

```
User attaches images to a chat message
  → Images validated (type, size, count limits)
  → Images saved to disk for persistence
  → If lib supports images → passed as base64 content blocks
  → If lib does not support images → file paths embedded in prompt text
  → Agent sees/analyzes the images
```

### Implemented By

ClaudeCodeLib, CodexCliLib

---

## Session Resume

Maintain conversational context across multiple messages in a session.

### Interface

```typescript
// AgentLibRunOptions
sessionId?: string;
resumeSession?: boolean;
```

### Logic

The service checks `supportedFeatures().nativeResume`:
- **`true`** — passes `sessionId` + `resumeSession: true` to the lib, which resumes the engine's native session (no message replay needed)
- **`false`** — replays the conversation history via `SessionHistoryFormatter`, injecting prior messages into the prompt

### UX Flow

```
User sends a follow-up message in an existing session
  → Service detects prior messages exist (hasHistory = true)
  → If nativeResume → passes sessionId to lib with resumeSession: true
  → Lib calls query() with string prompt + resume: sessionId
  → SDK loads prior conversation from its session files, appends the new message
  → If no nativeResume → formats message history as text, prepends to prompt
  → Agent sees full conversation context either way
```

This works with Single Message Input — each follow-up is a new `query()` call with
a string prompt, and the SDK's `resume` option restores the full conversation history.
No async generator needed for multi-turn.

### Fallback

If session resume fails (missing/corrupt session files), the service retries without
`resumeSession` so existing threads don't permanently break. The user sees a
"[Session resume failed — starting fresh session]" notice.

### Implemented By

ClaudeCodeLib (native resume via SDK session files)

---

## Thinking / Reasoning Blocks

Display the agent's internal reasoning process.

### Interface

No dedicated options — thinking is a feature flag. When `supportedFeatures().thinking === true`, the lib includes thinking blocks in messages emitted via `onMessage`.

### Logic

1. Thinking blocks appear as `AgentChatMessage` with `type: 'thinking'`
2. The renderer displays them in collapsible sections
3. Streaming thinking content arrives via `thinking_delta` stream events

### Implemented By

ClaudeCodeLib, CursorAgentLib

---

## Feature Support Matrix

| Feature | Interface | ClaudeCode | Cursor | Codex |
|---------|-----------|:----------:|:------:|:-----:|
| Interactive Tool Approval | `onPermissionRequest` | yes | — | — |
| Partial Message Streaming | `onStreamEvent` | yes | — | — |
| Hook System (8 hooks) | `options.hooks` | yes | — | — |
| Subagent Definitions | `options.agents` | yes | — | — |
| System Prompt Preset | `options.systemPrompt` | yes | — | — |
| Setting Sources (CLAUDE.md) | `options.settingSources` | yes | — | — |
| Slash Commands | service-level | yes | — | — |
| Plugins | `options.plugins` | yes | — | — |
| Images | `options.images` | yes | — | yes |
| Session Resume | `options.sessionId` | yes | — | — |
| Thinking Blocks | feature flag | yes | yes | — |
