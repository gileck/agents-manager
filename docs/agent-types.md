---
title: Agent Types & Session Resume
description: All agent types, their identifiers, session keys, and how conversation resume works
summary: "Two agent categories: Pipeline agents (investigator, designer, planner, implementor, reviewer) run through the task pipeline with session resume keyed by taskId+agentType. Thread chat agents run interactive conversations with session resume keyed by chat sessionId (thread) or pipelineSessionId (agent-chat review)."
priority: 2
key_points:
  - "Pipeline agents are keyed by taskId + agentType; session ID = first completed run's ID"
  - "Thread chat agents are keyed by chat session UUID (thread ID); resume on follow-up messages"
  - "Agent-chat (review) sessions resume the pipeline agent's SDK session via pipelineSessionId"
  - "All session resume uses the SDK's native resume mechanism (not manual history replay)"
  - "sessionId MUST be passed in AgentLibRunOptions for SDK resume to work"
---
# Agent Types & Session Resume

All agent types in the system, their unique identifiers, and how conversation session resume works.

## Agent Categories

The system has two categories of agents, each with different execution models and session management:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Pipeline Agents (task-driven, automated)                            │
│ Managed by: AgentService + ScheduledAgentService                    │
│                                                                     │
│  investigator → designer → planner → implementor → reviewer         │
│                                                                     │
│ Key: taskId + agentType                                             │
│ Session ID: first completed run's ID (shared across revisions)      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Thread Chat Agents (interactive, user-driven)                       │
│ Managed by: ChatAgentService                                        │
│                                                                     │
│  Thread chat (sidebar Threads section)                              │
│  Agent-chat (review Q&A with pipeline agent)                        │
│  Telegram / CLI chat                                                │
│                                                                     │
│ Key: chat session UUID (thread) or pipeline run ID (agent-chat)     │
│ Session ID: varies by source (see table below)                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Pipeline Agents

### Agent Types

| Agent | Type String | Read-Only | Purpose | Default Outcome |
|-------|-------------|-----------|---------|-----------------|
| Investigator | `investigator` | Yes | Explore codebase, understand requirements | `investigation_complete` |
| Designer | `designer` | No | Create technical design | `design_ready` |
| Planner | `planner` | Yes | Create implementation plan | `plan_complete` |
| Implementor | `implementor` | No | Write code, fix bugs | `pr_ready` |
| Reviewer | `reviewer` | Yes | Code review with verdict | `approved` / `changes_requested` |
| Task-Workflow-Reviewer | `task-workflow-reviewer` | Yes | Review task execution quality | — |

### Session Key: taskId + agentType

Pipeline agents are identified by the combination of their **task ID** and **agent type**. The SDK session ID is materialized as the `run.id` of the first completed `mode='new'` run for that agent type on that task.

### Session ID Resolution

| Agent Type | Mode | Session ID Source | Resume? |
|-----------|------|-------------------|---------|
| Any (except reviewer) | `new` (first run) | `run.id` (creates new session) | No |
| Any | `revision` | `findOriginalSessionRun(agentType).sessionId` | Yes |
| `reviewer` | `new` | `findOriginalSessionRun('implementor').sessionId` | Yes (implementor's session) |
| Any | crash recovery | `pendingResumeRun.sessionId` | Yes |

**Key method:** `findOriginalSessionRun(runs, agentType)` finds the oldest completed `mode='new'` run for the given agent type and returns its stored `sessionId`.

### Session Chaining Example

```
implementor (new, run A)   → creates session A, stores sessionId=A
reviewer    (new, run B)   → resumes session A, stores sessionId=A
implementor (revision, C)  → resumes session A, stores sessionId=A
reviewer    (new, run D)   → resumes session A, stores sessionId=A
```

The reviewer shares the implementor's session for context continuity. Other agent types (planner, designer, investigator) maintain independent session chains.

### Files

- Session resolution: `src/core/services/agent-service.ts` (execute method, lines ~425-497)
- Agent execution: `src/core/agents/agent.ts` (passes `sessionId` + `resumeSession` to lib)
- Prompt builders: `src/core/agents/*-prompt-builder.ts` (adapt prompts for session vs fresh)

## Thread Chat Agents

Thread chat agents are accessible from the **Threads** section in the sidebar. They support multi-turn conversations where the user sends messages and the agent responds.

### Chat Sources

| Source | Description | Session Key | Resume Mechanism |
|--------|-------------|-------------|------------------|
| `desktop` | Thread chat (sidebar Threads) | Chat session UUID | SDK resume on follow-up messages |
| `agent-chat` | Review Q&A (Chat with Planner/Designer) | Pipeline agent's run ID | SDK resumes pipeline agent's session |
| `telegram` | Telegram bot conversation | Chat session UUID | SDK resume on follow-up messages |
| `cli` | CLI conversation | Chat session UUID | SDK resume on follow-up messages |

### How Session Resume Works

Each `send()` call in `ChatAgentService` determines the session key and whether to resume:

```
send(sessionId, message)
  │
  ├── Load history: getMessagesForSession(sessionId)
  ├── hasHistory = history.length > 1  (more than just current message)
  ├── shouldResume = resumeSession || hasHistory
  │
  └── runAgent(sessionId, ...)
        │
        ├── executeSessionId = pipelineSessionId ?? sessionId
        │   ├── Agent-chat: pipelineSessionId (pipeline run ID)
        │   └── Thread/Telegram/CLI: sessionId (chat session UUID)
        │
        └── lib.execute(executeSessionId, {
              sessionId: executeSessionId,   ← CRITICAL: SDK needs this for resume
              resumeSession: shouldResume,
              ...
            })
```

### Thread Chat (source: 'desktop')

- **First message:** `hasHistory=false`, `resumeSession=false` → SDK creates fresh session with `sessionId=chatUUID`
- **Follow-up messages:** `hasHistory=true` → `shouldResume=true` → SDK resumes session by `chatUUID`
- Session key is the **chat session UUID** (thread ID), stable across all messages in the thread

### Agent-Chat (source: 'agent-chat')

Used for review Q&A conversations (e.g., "Chat with Planner" on the Plan Review page).

- `buildSendContext()` finds the last completed pipeline run for the agent role
- `pipelineSessionId = lastCompleted.id` → SDK resumes the **pipeline agent's session**
- The user can ask questions about the plan/design with full context from the original agent run

```
Planner (mode='new')        → creates SDK session S1
Chat agent (planner role)   → resumes S1 (sees planner's full context)
User chats Q&A              → messages added to S1
User clicks Request Changes → task transitions to 'planning'
Planner (mode='revision')   → resumes S1 (sees original plan + chat + feedback)
```

### Files

- Chat agent service: `src/core/services/chat-agent-service.ts` (send, buildSendContext, runAgent)
- System prompts: `src/core/services/chat-prompt-parts.ts`
- SDK integration: `src/core/libs/claude-code-lib.ts` (session options in execute method)

## SDK Session Resume Mechanism

Both pipeline and chat agents converge on the same SDK-level mechanism in `ClaudeCodeLib`:

```typescript
// src/core/libs/claude-code-lib.ts
const sessionOptions: Record<string, unknown> = {};
if (options.resumeSession && options.sessionId) {
  sessionOptions.resume = options.sessionId;     // Resume existing session
} else if (options.sessionId) {
  sessionOptions.sessionId = options.sessionId;  // Create new named session
}
// Passed to SDK query() options
```

**Critical requirement:** `options.sessionId` MUST be set for resume to work. Without it, the SDK generates random session IDs and resume has nothing to load.

### Resume Fallback

If a session resume fails (missing/corrupt session file), `Agent.execute()` detects the failure and retries with the full prompt and no session resume. Detection: exit code !== 0, no tokens consumed, no output produced.

### Replay Filtering

When the SDK resumes a session, it replays prior messages marked with `isReplay: true`. `ClaudeCodeLib` skips these to avoid duplicate callbacks and token double-counting.

## Summary Table

| Agent Category | Agent Types | Session Key | ID Source | Resume Trigger |
|----------------|-------------|-------------|-----------|----------------|
| Pipeline | investigator, designer, planner | taskId + agentType | First `mode='new'` run ID | `mode='revision'` |
| Pipeline | implementor | taskId + implementor | First `mode='new'` run ID | Revision or reviewer |
| Pipeline | reviewer | taskId + implementor | Implementor's run ID | Always (shares session) |
| Thread chat | desktop, telegram, cli | Chat session UUID | Chat session UUID | Follow-up messages |
| Thread chat | agent-chat (review) | Pipeline run ID | Last completed run of role | Always (resumes pipeline) |
