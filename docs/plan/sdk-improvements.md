# Claude Agent SDK — Improvements Plan

This document tracks planned improvements to the Claude Agent SDK integration,
based on a review of the official SDK documentation against our current implementation.

**Reference docs:** https://platform.claude.com/docs/en/agent-sdk/

---

## Progress Overview

| # | Feature | Phase | Status | Depends On |
|---|---------|-------|--------|------------|
| 7 | System Prompt Customization | 1 | DONE | — |
| 1 | Partial Message Streaming | 1 | DONE | — |
| 2 | Streaming Input (AsyncGenerator) | 2 | NOT STARTED | — |
| 3 | Interactive Tool Approval (canUseTool) | 3 | NOT STARTED | #2 |
| 8 | Full Hooks System | 3 | NOT STARTED | #3 |
| 5 | Subagent Definitions | 4 | NOT STARTED | #8 |
| 11 | Slash Commands | 5 | NOT STARTED | #2 |
| 13 | Plugins | 5 | NOT STARTED | #7 |

Status values: `NOT STARTED` · `IN PROGRESS` · `DONE`

---

## Dependency Graph

```
                    ┌──────────────────┐
                    │  #2 Streaming    │
                    │  Input (AsyncGen)│
                    └───────┬──────────┘
                            │ foundational
               ┌────────────┼────────────────┐
               ▼            ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ #1 Partial   │  │ #3 canUseTool│  │ #11 Slash    │
    │ Msg Streaming│  │ + Approvals  │  │ Commands     │
    └──────────────┘  └──────┬───────┘  └──────────────┘
                             │
                    ┌────────┤
                    ▼        ▼
             ┌───────────┐ ┌──────────────┐
             │ #5 Sub-   │ │ #8 Full Hooks│
             │ agents    │ │ System       │
             └───────────┘ └──────────────┘

    Independent (slot in anywhere after foundations):
    ┌──────────────┐  ┌──────────────┐
    │ #7 System    │  │ #13 Plugins  │
    │ Prompt Cust. │  │              │
    └──────────────┘  └──────────────┘
```

---

## Files Touched (Conflict Matrix)

Almost every feature modifies the same core files. Parallel implementation
will cause merge conflicts — features must be sequenced.

| File | #1 | #2 | #3 | #5 | #7 | #8 | #11 | #13 |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:---:|:---:|
| `core/libs/claude-code-lib.ts` | W | W | W | W | W | W | - | W |
| `core/interfaces/agent-lib.ts` | W | W | W | W | W | W | - | W |
| `core/services/chat-agent-service.ts` | W | W | W | W | W | W | W | W |
| `shared/types.ts` | W | - | W | W | W | W | W | W |
| `daemon/routes/chat.ts` | - | - | W | W | W | - | W | W |
| `renderer/` (UI) | W | - | W | - | W | - | W | - |

---

## Implementation Phases

Each phase is implemented by a subagent in a worktree branch. Between phases:
review changes, update status in this doc, and merge to main.

---

### Phase 1 — Quick wins (independent, no prereqs)

#### #7 System Prompt Customization

**What:** Let users customize the system prompt per session. Use the SDK's
`preset: "claude_code"` with `append` instead of hardcoded prompts. Load
CLAUDE.md via `settingSources: ["project"]`.

**Key changes:**
- `agent-lib.ts` — change `systemPrompt` type to support preset object
- `claude-code-lib.ts` — pass structured systemPrompt + `settingSources`
- `chat-agent-service.ts` — `buildSendContext()` uses preset + append
- `shared/types.ts` — add `systemPromptAppend` to `ChatSession`
- `daemon/routes/chat.ts` — accept `systemPromptAppend` in PATCH
- Renderer — system prompt text area in session settings

**Effort:** Low (0.5–1 day)

#### #1 Partial Message Streaming

**What:** Enable `includePartialMessages: true` to get token-by-token text
streaming and progressive tool input display via `StreamEvent` messages.

**Key changes:**
- `agent-lib.ts` — add `onStreamDelta` callback
- `claude-code-lib.ts` — enable `includePartialMessages`, handle `stream_event` type
- `shared/types.ts` — add `AgentChatMessageStreamDelta` variant
- `chat-agent-service.ts` — wire `onStreamDelta` to emit events
- Renderer — accumulate deltas for real-time text display

**Effort:** Medium (1–2 days)

**Note:** Streaming is incompatible with explicit `maxThinkingTokens`. Our
`thinking: { type: 'adaptive' }` should be fine — verify.

#### Phase 1 — Todo List

- [x] Rebase worktree branch from main
- [x] **#7** Update `AgentLibRunOptions.systemPrompt` type in `agent-lib.ts` to support preset object
- [x] **#7** Update `claude-code-lib.ts` to pass structured systemPrompt + `settingSources: ['project']`
- [x] **#7** Update `buildSendContext()` in `chat-agent-service.ts` to use preset + append
- [x] **#7** Add `systemPromptAppend` field to `ChatSession` in `shared/types.ts`
- [x] **#7** Accept `systemPromptAppend` in PATCH `/sessions/:id` in `daemon/routes/chat.ts`
- [x] **#7** Add system prompt text area in session settings UI (renderer)
- [x] **#1** Add `onStreamDelta` callback to `AgentLibCallbacks` in `agent-lib.ts`
- [x] **#1** Enable `includePartialMessages` in `claude-code-lib.ts`, handle `stream_event` messages
- [x] **#1** Add `AgentChatMessageStreamDelta` variant to `shared/types.ts`
- [x] **#1** Wire `onStreamDelta` in `chat-agent-service.ts` to emit events via WebSocket
- [x] **#1** Renderer: accumulate deltas for real-time text display
- [x] **#1** Verify streaming works with `thinking: { type: 'adaptive' }`
- [x] Run `yarn checks` — fix any TypeScript / ESLint errors
- [ ] Manual smoke test in thread chat UI
- [ ] **Review** — review changes, update status to DONE, merge to main

---

### Phase 2 — Foundation

#### #2 Streaming Input (AsyncGenerator)

**What:** Refactor from single-shot `query({ prompt: string })` to a persistent
async generator that yields messages over the session lifetime. This enables
mid-stream message injection, queued follow-ups, and natural interruption.

**Key changes:**
- `agent-lib.ts` — add `createPromptGenerator` option returning generator + push/close handles
- `claude-code-lib.ts` — create AsyncGenerator, store push handle in RunState, pass to `query()`
- `chat-agent-service.ts` — use generator, store push handle alongside abort controller

**Effort:** Medium-High (2–3 days). Biggest architectural change.

**Why foundational:** canUseTool (#3), slash commands (#11), and mid-stream
permission changes all need a way to inject messages into the running query.

#### Phase 2 — Todo List

- [ ] Rebase worktree branch from main
- [ ] Add `createPromptGenerator` option to `AgentLibRunOptions` in `agent-lib.ts` (generator + push/close handles)
- [ ] Implement AsyncGenerator creation in `claude-code-lib.ts`, store push handle in `RunState`
- [ ] Update `execute()` in `claude-code-lib.ts` to pass generator to `query()` instead of string prompt
- [ ] Update `chat-agent-service.ts` to use generator, store push handle alongside abort controller
- [ ] Ensure backward compatibility — string prompt still works when generator is not used
- [ ] Update `stop()` to close the generator handle on abort
- [ ] Run `yarn checks` — fix any TypeScript / ESLint errors
- [ ] Manual smoke test: send message, verify response, verify stop works
- [ ] **Review** — review changes, update status to DONE, merge to main

---

### Phase 3 — Interactive features (depend on #2)

#### #3 Interactive Tool Approval (canUseTool)

**What:** Implement the SDK's `canUseTool` callback to surface tool approval
requests to the UI. Users can allow, deny, or modify tool inputs before execution.
Also enables `AskUserQuestion` structured questions.

**Key changes:**
- `agent-lib.ts` — add `onPermissionRequest` async callback
- `claude-code-lib.ts` — pass `canUseTool` to SDK, route through sandbox guard then callback
- `shared/types.ts` — add `permission_request` / `permission_response` message types
- `chat-agent-service.ts` — pending-request map with promise resolvers
- `daemon/routes/chat.ts` — new `POST /sessions/:id/permission-response` endpoint
- Renderer — permission request UI (tool name, input preview, allow/deny buttons)

**Effort:** Medium-High (2–3 days)

#### #8 Full Hooks System

**What:** Expand beyond `preToolUse` to support the full SDK hook lifecycle:
`PostToolUse`, `Stop`, `Notification`, `SubagentStart/Stop`, `PreCompact`.

**Key changes:**
- `agent-lib.ts` — expand `hooks` with all hook types
- `claude-code-lib.ts` — transform hooks into SDK format with matchers
- `chat-agent-service.ts` — add default hooks (PostToolUse audit logging,
  Notification forwarding, SubagentStop tracking)
- `shared/types.ts` — add `notification` message type

**Effort:** Medium (1–2 days)

#### Phase 3 — Todo List

- [ ] Rebase worktree branch from main
- [ ] **#3** Add `onPermissionRequest` async callback to `AgentLibCallbacks` in `agent-lib.ts`
- [ ] **#3** Implement `canUseTool` in `claude-code-lib.ts` — route through sandbox guard, then callback
- [ ] **#3** Add `permission_request` and `permission_response` message types to `shared/types.ts`
- [ ] **#3** Add pending-request map with promise resolvers in `chat-agent-service.ts`
- [ ] **#3** Add `POST /sessions/:id/permission-response` endpoint in `daemon/routes/chat.ts`
- [ ] **#3** Renderer: permission request UI (tool name, input preview, allow/deny buttons)
- [ ] **#3** Handle `AskUserQuestion` tool as a structured question in the permission flow
- [ ] **#8** Expand `hooks` type in `agent-lib.ts` with PostToolUse, Stop, Notification, SubagentStart/Stop, PreCompact
- [ ] **#8** Transform hooks into SDK format with matchers in `claude-code-lib.ts`
- [ ] **#8** Add default hooks in `chat-agent-service.ts` (PostToolUse audit, Notification forwarding, SubagentStop tracking)
- [ ] **#8** Add `notification` message type to `shared/types.ts`
- [ ] **#8** Renderer: display notification messages in chat thread
- [ ] Run `yarn checks` — fix any TypeScript / ESLint errors
- [ ] Manual smoke test: trigger tool approval flow, verify allow/deny, verify hooks fire
- [ ] **Review** — review changes, update status to DONE, merge to main

---

### Phase 4 — Advanced features (depend on #3/#8)

#### #5 Subagent Definitions

**What:** Define specialized subagents (code-reviewer, researcher, test-runner)
that the main agent can delegate to. Each gets its own prompt, tool restrictions,
and model selection.

**Key changes:**
- `agent-lib.ts` — add `agents` record to options
- `claude-code-lib.ts` — pass `agents` to SDK, add `Agent` to allowed tools
- `chat-agent-service.ts` — define default subagents per scope, handle
  `parent_tool_use_id` messages
- `shared/types.ts` — add `subagent_activity` message type

**Effort:** Medium (1–2 days)

#### Phase 4 — Todo List

- [ ] Rebase worktree branch from main
- [ ] Add `agents` record type to `AgentLibRunOptions` in `agent-lib.ts`
- [ ] Pass `agents` to SDK in `claude-code-lib.ts`, add `Agent` to allowed tools list
- [ ] Handle `parent_tool_use_id` in message processing in `claude-code-lib.ts`
- [ ] Define default subagents per scope in `chat-agent-service.ts`
- [ ] Add `subagent_activity` message type to `shared/types.ts`
- [ ] Renderer: display subagent activity in chat thread (collapsible card)
- [ ] Run `yarn checks` — fix any TypeScript / ESLint errors
- [ ] Manual smoke test: trigger subagent delegation, verify messages appear
- [ ] **Review** — review changes, update status to DONE, merge to main

---

### Phase 5 — Polish (low effort, depend on earlier phases)

#### #11 Slash Commands

**What:** Support `/compact`, `/clear`, and custom project commands in the
chat input. Route them to the SDK and display structured results.

**Key changes:**
- `chat-agent-service.ts` — detect `/` prefix, route as slash command prompt
- `shared/types.ts` — add `slash_command` message type
- Renderer — slash command autocomplete, special result bubbles

**Effort:** Low (0.5–1 day)

#### #13 Plugins

**What:** Load plugins from local directories to add commands, agents, skills,
hooks, and MCP servers to chat sessions.

**Key changes:**
- `agent-lib.ts` — add `plugins` array to options
- `claude-code-lib.ts` — pass `plugins` to SDK
- `chat-agent-service.ts` — load plugin paths from project config
- Project config — `plugins` field

**Effort:** Low (0.5 day). Pure pass-through to SDK.

#### Phase 5 — Todo List

- [ ] Rebase worktree branch from main
- [ ] **#11** Detect `/` prefix in `chat-agent-service.ts`, route as slash command prompt to SDK
- [ ] **#11** Add `slash_command` message type to `shared/types.ts`
- [ ] **#11** Renderer: slash command autocomplete in chat input
- [ ] **#11** Renderer: special result bubbles for slash command output
- [ ] **#13** Add `plugins` array to `AgentLibRunOptions` in `agent-lib.ts`
- [ ] **#13** Pass `plugins` to SDK in `claude-code-lib.ts`
- [ ] **#13** Load plugin paths from project config in `chat-agent-service.ts`
- [ ] Run `yarn checks` — fix any TypeScript / ESLint errors
- [ ] Manual smoke test: `/compact`, `/clear`, plugin loading
- [ ] **Review** — review changes, update status to DONE, merge to main

---

## Features Reviewed But Not Planned

These were evaluated from the official docs but deferred:

| Feature | Reason |
|---------|--------|
| File Checkpointing & Rewind | Medium effort, niche use case — revisit after core improvements |
| Structured Outputs in Chat | Already partially supported via `outputFormat` pass-through |
| Skills Integration | Requires filesystem SKILL.md artifacts; low priority |
| Todo Tracking Display | Nice-to-have UI improvement; can add anytime |
| Dynamic Permission Mode Switching | Small UX improvement; can fold into #3 |

---

## Parallelization Notes

- **#7 and #1** can run in parallel (different parts of same files)
- **#11 and #13** can run in parallel (both small, different areas)
- **Everything else must be sequential** — they all modify `execute()` in
  `claude-code-lib.ts` and `runAgent()` in `chat-agent-service.ts`
