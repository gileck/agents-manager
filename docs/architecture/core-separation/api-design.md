# Daemon API Design

## Overview

The daemon is a Node.js process that hosts all business logic and exposes it over two protocols on a single port:

- **HTTP REST** — request/response operations (CRUD, transitions, queries)
- **WebSocket** — real-time streaming (agent output, chat messages, status updates)

All three UIs (Electron, Web, CLI) use the same API through a shared client SDK.

**Framework:** Express (simple, familiar, performance irrelevant for local daemon).

**Settings storage:** SQLite table (consistent with all other data, accessible by daemon without Electron).

```
┌─────────────────────────────────────────────────┐
│                   Daemon                         │
│                                                  │
│   src/core/ (business logic)                     │
│       ↑                                          │
│   src/daemon/ (Express + WS server)              │
│       ↑                                          │
│   localhost:3847                                  │
└──────────┬──────────────┬──────────────┬─────────┘
           │              │              │
     ┌─────┴──┐    ┌──────┴──┐    ┌─────┴──┐
     │Electron│    │  Web UI │    │  CLI   │
     │  app   │    │(browser)│    │(term)  │
     └────────┘    └─────────┘    └────────┘

     All use: src/client/ (shared API client SDK)
```

---

## Connection Details

| Setting | Default | Override |
|---------|---------|---------|
| Host | `127.0.0.1` (localhost only) | `AM_DAEMON_HOST` env var |
| Port | `3847` | `--port` flag or `AM_DAEMON_PORT` env var |
| Auth | Optional file-based token | `~/.agents-manager/daemon.token` |

### Authentication

Local-only by default — binding to `127.0.0.1` means only local processes can connect.

Optional token auth: on startup the daemon writes a random token to `~/.agents-manager/daemon.token`. Clients read this file and pass it via:
- REST: `Authorization: Bearer <token>` header
- WebSocket: `ws://localhost:3847/ws?token=<token>` query param

---

## Conventions

### CORS

The daemon enables CORS for all origins (`cors({ origin: true })`). Since the daemon binds to `127.0.0.1`, only local clients can connect. This allows the Web UI (served from a different port or origin) to make fetch requests to the daemon.

### Request/Response Format

- All request bodies are JSON (`Content-Type: application/json`)
- All responses are JSON
- Successful responses: `200` (query), `201` (create), `204` (delete with no body)
- IDs are UUIDs passed as URL path parameters

### Error Format

All errors return a consistent shape:

```json
{
  "error": "Human-readable error message",
  "code": "TASK_NOT_FOUND"
}
```

| HTTP Status | When |
|-------------|------|
| `400` | Invalid input (missing fields, bad format, validation failure) |
| `401` | Missing or invalid auth token |
| `404` | Resource not found |
| `409` | Conflict (e.g., transition guard failed, agent already running) |
| `500` | Internal server error |

### Type Sharing

Request/response types are shared between daemon and clients via `src/shared/types.ts` (already exists). The client SDK imports the same types the daemon uses:

```
src/shared/types.ts          # Task, Project, AgentRun, etc.
    ↓ imported by                ↓ imported by
src/daemon/routes/            src/client/api-client.ts
```

No code generation needed — same TypeScript source, same types.

---

## REST API Endpoints

### Health & Management

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/health` | `{ status: "ok", uptime: 12345, version: "1.0.0" }` |
| `POST` | `/api/shutdown` | Graceful shutdown (requires auth) |

### Settings

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/settings` | — | `AppSettings` |
| `PATCH` | `/api/settings` | `Partial<AppSettings>` | `AppSettings` |

```typescript
// AppSettings shape (from src/shared/types.ts)
{
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  currentProjectId: string | null;
  defaultPipelineId: string | null;
  bugPipelineId: string | null;
  themeConfig: string | null;
}
```

### Projects

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/projects` | — | `Project[]` |
| `GET` | `/api/projects/:id` | — | `Project` |
| `POST` | `/api/projects` | `ProjectCreateInput` | `Project` (201) |
| `PATCH` | `/api/projects/:id` | `ProjectUpdateInput` | `Project` |
| `DELETE` | `/api/projects/:id` | — | 204 |

```typescript
// ProjectCreateInput
{ name: string; path?: string; config?: Record<string, unknown> }

// Project (response)
{ id: string; name: string; path: string | null; config: Record<string, unknown> | null; createdAt: string; updatedAt: string }
```

### Tasks

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/tasks?projectId=&status=&featureId=` | — | `Task[]` |
| `GET` | `/api/tasks/:id` | — | `Task` |
| `POST` | `/api/tasks` | `TaskCreateInput` | `Task` (201) |
| `PATCH` | `/api/tasks/:id` | `TaskUpdateInput` | `Task` |
| `DELETE` | `/api/tasks/:id` | — | `{ deleted: true }` |
| `POST` | `/api/tasks/:id/reset` | — | `Task` |
| `POST` | `/api/tasks/:id/transition` | `{ toStatus, actor? }` | `{ success, error? }` |
| `POST` | `/api/tasks/:id/force-transition` | `{ toStatus, actor? }` | `{ success, error? }` |
| `GET` | `/api/tasks/:id/transitions` | — | `Transition[]` |
| `GET` | `/api/tasks/:id/all-transitions` | — | `{ manual, agent, system }` |
| `POST` | `/api/tasks/:id/guard-check` | `{ toStatus, trigger }` | `GuardResult \| null` |
| `POST` | `/api/tasks/:id/hook-retry` | `{ hookName, from?, to? }` | `HookResult` |
| `GET` | `/api/tasks/:id/diagnostics` | — | `PipelineDiagnostics` |
| `POST` | `/api/tasks/:id/advance-phase` | — | `{ success }` |
| `POST` | `/api/tasks/:id/workflow-review` | — | starts review agent |

```typescript
// TaskCreateInput
{ projectId: string; pipelineId: string; title: string; description?: string; priority?: number; parentId?: string; featureId?: string }

// Task (response)
{ id: string; projectId: string; pipelineId: string; title: string; description: string | null; status: string; priority: number; assignee: string | null; featureId: string | null; parentId: string | null; createdAt: string; updatedAt: string }
```

### Task Dependencies

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/tasks/:id/dependencies` | — | `Task[]` |
| `GET` | `/api/tasks/:id/dependents` | — | `Task[]` |
| `POST` | `/api/tasks/:id/dependencies` | `{ dependsOnTaskId }` | 201 |
| `DELETE` | `/api/tasks/:id/dependencies/:depId` | — | 204 |

### Agents

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `POST` | `/api/tasks/:id/agent/start` | `{ mode, agentType? }` | `AgentRun` |
| `POST` | `/api/agent/runs/:runId/stop` | — | `{ stopped: true }` |
| `POST` | `/api/tasks/:id/agent/message` | `{ message }` | `{ queued: true }` |
| `GET` | `/api/tasks/:id/agent/runs` | — | `AgentRun[]` |
| `GET` | `/api/agent/runs/:runId` | — | `AgentRun` |
| `GET` | `/api/agent/active` | — | `AgentRun[]` |
| `GET` | `/api/agent/active-task-ids` | — | `string[]` |
| `GET` | `/api/agent/all` | — | `AgentRun[]` |

```typescript
// Start agent request
{ mode: 'plan' | 'implement' | 'review'; agentType?: string }

// AgentRun (response)
{ id: string; taskId: string; mode: string; agentType: string; status: 'running' | 'completed' | 'failed' | 'stopped'; startedAt: string; finishedAt: string | null; output: string | null; tokenUsage: {...} | null }
```

### Pipelines

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/pipelines` | `Pipeline[]` |
| `GET` | `/api/pipelines/:id` | `Pipeline` |

### Events & Activity

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/events?taskId=&category=&severity=` | `TaskEvent[]` |
| `GET` | `/api/activities?taskId=` | `ActivityEntry[]` |
| `GET` | `/api/tasks/:id/timeline` | `DebugTimelineEntry[]` |

### Prompts

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/tasks/:id/prompts` | — | `PendingPrompt[]` |
| `POST` | `/api/prompts/:id/respond` | `{ response: Record<string, unknown> }` | `{ success }` |

### Artifacts & Context

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/tasks/:id/artifacts` | `TaskArtifact[]` |
| `GET` | `/api/tasks/:id/context` | `TaskContextEntry[]` |
| `GET` | `/api/tasks/:id/worktree` | `WorktreeInfo \| null` |

### Features

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/features?projectId=` | — | `Feature[]` |
| `GET` | `/api/features/:id` | — | `Feature` |
| `POST` | `/api/features` | `FeatureCreateInput` | `Feature` (201) |
| `PATCH` | `/api/features/:id` | `FeatureUpdateInput` | `Feature` |
| `DELETE` | `/api/features/:id` | — | 204 |

### Kanban Boards

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/kanban/boards?projectId=` | — | `KanbanBoard[]` |
| `GET` | `/api/kanban/boards/:id` | — | `KanbanBoard` |
| `GET` | `/api/kanban/boards/project/:projectId` | — | `KanbanBoard \| null` |
| `POST` | `/api/kanban/boards` | `KanbanBoardCreateInput` | `KanbanBoard` (201) |
| `PATCH` | `/api/kanban/boards/:id` | `KanbanBoardUpdateInput` | `KanbanBoard` |
| `DELETE` | `/api/kanban/boards/:id` | — | 204 |

### Agent Definitions

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/agent-definitions` | — | `AgentDefinition[]` |
| `GET` | `/api/agent-definitions/:id` | — | `AgentDefinition` |
| `POST` | `/api/agent-definitions` | `AgentDefinitionCreateInput` | `AgentDefinition` (201) |
| `PATCH` | `/api/agent-definitions/:id` | `AgentDefinitionUpdateInput` | `AgentDefinition` |
| `DELETE` | `/api/agent-definitions/:id` | — | 204 |

### Git Operations (task-scoped)

Operations on the task's worktree branch:

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/tasks/:id/git/diff` | — | `string \| null` |
| `GET` | `/api/tasks/:id/git/stat` | — | `string \| null` |
| `GET` | `/api/tasks/:id/git/working-diff` | — | `string \| null` |
| `GET` | `/api/tasks/:id/git/status` | — | `string \| null` |
| `GET` | `/api/tasks/:id/git/log` | — | `GitLogEntry[] \| null` |
| `GET` | `/api/tasks/:id/git/show/:hash` | — | `GitCommitDetail \| null` |
| `POST` | `/api/tasks/:id/git/reset-file` | `{ filepath }` | 204 |
| `POST` | `/api/tasks/:id/git/clean` | — | 204 |
| `POST` | `/api/tasks/:id/git/pull` | — | 204 |

### Git Operations (project-scoped)

Operations on the project's main repo:

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/projects/:id/git/log?count=50` | `GitLogEntry[]` |
| `GET` | `/api/projects/:id/git/branch` | `string` |
| `GET` | `/api/projects/:id/git/commits/:hash` | `GitCommitDetail` |

### Telegram

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `POST` | `/api/telegram/:projectId/start` | — | 204 |
| `POST` | `/api/telegram/:projectId/stop` | — | 204 |
| `GET` | `/api/telegram/:projectId/status` | — | `{ running: boolean }` |
| `POST` | `/api/telegram/test` | `{ botToken, chatId }` | `{ success: true }` |

### Chat Sessions

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/chat/sessions?projectId=` | — | `ChatSession[]` |
| `POST` | `/api/chat/sessions` | `{ projectId, name }` | `ChatSession` (201) |
| `PATCH` | `/api/chat/sessions/:id` | `{ name }` | `ChatSession` |
| `DELETE` | `/api/chat/sessions/:id` | — | 204 |

### Chat Messages

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `POST` | `/api/chat/sessions/:id/send` | `{ message }` | `{ started: true }` (output streams via WS) |
| `POST` | `/api/chat/sessions/:id/stop` | — | 204 |
| `GET` | `/api/chat/sessions/:id/messages` | — | `ChatMessage[]` |
| `DELETE` | `/api/chat/sessions/:id/messages` | — | 204 |
| `POST` | `/api/chat/sessions/:id/summarize` | — | `{ summary }` |
| `GET` | `/api/chat/costs` | — | `CostSummary` |
| `GET` | `/api/chat/agents` | — | `RunningAgent[]` |

### Task Chat

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `POST` | `/api/tasks/:id/chat/send` | `{ message }` | `{ started: true }` (output streams via WS) |
| `POST` | `/api/tasks/:id/chat/stop` | — | 204 |
| `GET` | `/api/tasks/:id/chat/messages` | — | `ChatMessage[]` |
| `DELETE` | `/api/tasks/:id/chat/messages` | — | 204 |

### Dashboard

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/dashboard/stats` | `DashboardStats` |

### Items (template/legacy)

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/items` | — | `Item[]` |
| `GET` | `/api/items/:id` | — | `Item` |
| `POST` | `/api/items` | `ItemCreateInput` | `Item` (201) |
| `PATCH` | `/api/items/:id` | `ItemUpdateInput` | `Item` |
| `DELETE` | `/api/items/:id` | — | 204 |

---

## Endpoints NOT in the Daemon

These stay in the Electron app (they launch local desktop applications):

| Operation | Why Electron-only |
|-----------|-------------------|
| Open URL in Chrome | Spawns local browser process |
| Open directory in iTerm | Spawns local terminal process |
| Open directory in VS Code | Spawns local editor process |
| Get Electron app version | Electron-specific API |

The web UI would implement these differently (e.g., link opens in current browser tab). The CLI doesn't need them.

---

## WebSocket API

### Connecting

```
ws://localhost:3847/ws
ws://localhost:3847/ws?token=<auth-token>
```

### Message Format

All messages (client → server and server → client) are JSON:

```typescript
// Client → Server
{ type: 'subscribe' | 'unsubscribe'; channel: string; id?: string }

// Server → Client
{ channel: string; id?: string; data: unknown }
```

### Subscribing to Channels

After connecting, the client subscribes to the events it cares about:

```javascript
// Subscribe to agent output for a specific task
ws.send(JSON.stringify({ type: 'subscribe', channel: 'agent:output', id: 'task-123' }));

// Subscribe to ALL agent events for a task
ws.send(JSON.stringify({ type: 'subscribe', channel: 'agent:*', id: 'task-123' }));

// Subscribe to everything (admin/debug)
ws.send(JSON.stringify({ type: 'subscribe', channel: '*' }));

// Unsubscribe
ws.send(JSON.stringify({ type: 'unsubscribe', channel: 'agent:output', id: 'task-123' }));
```

### Available Channels

| Channel | Scoped By | Pushed When | Data Type |
|---------|-----------|-------------|-----------|
| `agent:output` | taskId | Agent produces output text | `string` (chunk) |
| `agent:message` | taskId | Agent produces structured message | `AgentMessage` object |
| `agent:status` | taskId | Agent status changes | `string` ('running', 'completed', etc.) |
| `chat:output` | sessionId | Chat agent produces output | `string` (chunk) |
| `chat:message` | sessionId | Chat agent produces message | `ChatMessage` object |
| `task-chat:output` | taskId | Task chat agent produces output | `string` (chunk) |
| `task-chat:message` | taskId | Task chat agent produces message | `ChatMessage` object |
| `telegram:log` | projectId | Telegram bot sends/receives | `{ timestamp, direction, message }` |
| `agent:interrupted-runs` | — (global) | Orphaned runs recovered on startup | `AgentRun[]` |

### Streaming Lifecycle

End-to-end flow for starting an agent and receiving streaming output:

```
Client                          Daemon                         Core
  │                               │                              │
  │ 1. Subscribe to WS channel    │                              │
  │──────────────────────────────→│                              │
  │ { subscribe, agent:*, task-1 }│                              │
  │                               │                              │
  │ 2. POST /api/tasks/1/agent/start                             │
  │──────────────────────────────→│                              │
  │                               │ 3. workflowService           │
  │                               │    .startAgent(task-1, ...)  │
  │                               │─────────────────────────────→│
  │                               │                              │
  │  HTTP 200 AgentRun object     │                              │
  │  { id, taskId, mode, status } │                              │
  │←──────────────────────────────│                              │
  │                               │                              │
  │                               │ 4. Agent runs, produces output
  │                               │←─────────────── chunk 1 ─────│
  │ { agent:output, task-1, "..." }                              │
  │←──────────────────────────────│                              │
  │                               │←─────────────── chunk 2 ─────│
  │ { agent:output, task-1, "..." }                              │
  │←──────────────────────────────│                              │
  │                               │                              │
  │                               │←──── message (tool call) ────│
  │ { agent:message, task-1, {...}}                              │
  │←──────────────────────────────│                              │
  │                               │                              │
  │                               │←──── status: completed ──────│
  │ { agent:status, task-1, "completed" }                        │
  │←──────────────────────────────│                              │
  │                               │                              │
  │ 5. GET /api/agent/runs/run-abc (optional: get final result)  │
  │──────────────────────────────→│                              │
  │ { id, status: "completed", output, tokenUsage }              │
  │←──────────────────────────────│                              │
```

**Key points:**
- Subscribe to WS **before** starting the agent to avoid missing early output
- The REST `POST` returns the full `AgentRun` object (including the run ID)
- Output streams via WS as the agent works
- `agent:status` with `"completed"` or `"failed"` signals the agent is done
- Client can poll `GET /api/agent/runs/:runId` for the final result

### Reconnection

If the WebSocket disconnects (network issue, client restart):

1. Client reconnects to `ws://localhost:3847/ws`
2. Client re-sends all `subscribe` messages
3. Any output emitted while disconnected is **lost** (it's streaming, not queued)
4. Client can call `GET /api/agent/runs/:runId` to get the current state and accumulated output
5. If the agent is still running, new output will stream from the reconnection point

**Future optimization:** A per-task ring buffer in the daemon could allow clients to catch up on recent output after reconnection. Not needed for v1 since agent output is also persisted in the database via the debug timeline.

The client SDK handles reconnection automatically:

```typescript
const ws = createWsClient('ws://localhost:3847/ws', {
  reconnect: true,          // auto-reconnect on disconnect
  reconnectInterval: 1000,  // retry every 1s
  maxReconnectAttempts: 30, // give up after 30s
});

// Subscriptions are re-sent automatically after reconnect
ws.subscribe('agent:output', 'task-123', (chunk) => { ... });
```

---

## Client SDK

### Directory Structure

```
src/client/
  api-client.ts           # Typed REST client
  ws-client.ts            # WebSocket subscription client
  index.ts                # Re-exports
```

### API Client

```typescript
// src/client/api-client.ts
import type { Task, TaskCreateInput, TaskFilter, Project, ... } from '../shared/types';

export interface ApiClient {
  health(): Promise<{ status: string; uptime: number }>;

  settings: {
    get(): Promise<AppSettings>;
    update(updates: Partial<AppSettings>): Promise<AppSettings>;
  };

  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<Project>;
    create(input: ProjectCreateInput): Promise<Project>;
    update(id: string, input: ProjectUpdateInput): Promise<Project>;
    delete(id: string): Promise<void>;
  };

  tasks: {
    list(filter?: TaskFilter): Promise<Task[]>;
    get(id: string): Promise<Task>;
    create(input: TaskCreateInput): Promise<Task>;
    update(id: string, input: TaskUpdateInput): Promise<Task>;
    delete(id: string): Promise<{ deleted: boolean }>;
    reset(id: string): Promise<Task>;
    transition(id: string, toStatus: string, actor?: string): Promise<{ success: boolean; error?: string }>;
    forceTransition(id: string, toStatus: string, actor?: string): Promise<{ success: boolean; error?: string }>;
    getTransitions(id: string): Promise<Transition[]>;
    getDependencies(id: string): Promise<Task[]>;
    addDependency(id: string, dependsOnTaskId: string): Promise<void>;
    removeDependency(id: string, depId: string): Promise<void>;
  };

  agents: {
    start(taskId: string, mode: AgentMode, agentType?: string): Promise<AgentRun>;
    stop(runId: string): Promise<void>;
    sendMessage(taskId: string, message: string): Promise<void>;
    getRuns(taskId: string): Promise<AgentRun[]>;
    getRun(runId: string): Promise<AgentRun>;
    getActive(): Promise<AgentRun[]>;
    getAll(): Promise<AgentRun[]>;
  };

  chat: {
    sessions: {
      list(projectId: string): Promise<ChatSession[]>;
      create(projectId: string, name: string): Promise<ChatSession>;
      update(id: string, name: string): Promise<ChatSession>;
      delete(id: string): Promise<void>;
    };
    send(sessionId: string, message: string): Promise<void>;
    stop(sessionId: string): Promise<void>;
    getMessages(sessionId: string): Promise<ChatMessage[]>;
    clearMessages(sessionId: string): Promise<void>;
  };

  // ... same pattern for features, kanban, git, telegram, etc.
}

export function createApiClient(baseUrl: string, token?: string): ApiClient {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) throw new ApiError(res.status, await res.json());
    return res.json();
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new ApiError(res.status, await res.json());
    return res.json();
  }

  // ... patch, del helpers

  return {
    health: () => get('/api/health'),
    projects: {
      list: () => get('/api/projects'),
      get: (id) => get(`/api/projects/${id}`),
      create: (input) => post('/api/projects', input),
      // ...
    },
    tasks: {
      list: (filter) => get(`/api/tasks?${qs(filter)}`),
      get: (id) => get(`/api/tasks/${id}`),
      create: (input) => post('/api/tasks', input),
      transition: (id, toStatus, actor) => post(`/api/tasks/${id}/transition`, { toStatus, actor }),
      // ...
    },
    agents: {
      start: (taskId, mode, agentType) => post(`/api/tasks/${taskId}/agent/start`, { mode, agentType }),
      stop: (runId) => post(`/api/agent/runs/${runId}/stop`),
      // ...
    },
    // ...
  };
}
```

### WebSocket Client

```typescript
// src/client/ws-client.ts
type WsChannel = 'agent:output' | 'agent:message' | 'agent:status'
  | 'chat:output' | 'chat:message'
  | 'task-chat:output' | 'task-chat:message'
  | 'telegram:log' | 'agent:interrupted-runs';

export interface WsClient {
  subscribe(channel: WsChannel, id: string, callback: (data: unknown) => void): () => void;
  subscribeGlobal(channel: WsChannel, callback: (id: string, data: unknown) => void): () => void;
  close(): void;
}

export function createWsClient(url: string, opts?: { reconnect?: boolean }): WsClient {
  let ws: WebSocket;
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      // Re-subscribe after reconnect
      for (const key of listeners.keys()) {
        const [channel, id] = parseKey(key);
        ws.send(JSON.stringify({ type: 'subscribe', channel, id }));
      }
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const key = msg.id ? `${msg.channel}:${msg.id}` : msg.channel;
      listeners.get(key)?.forEach(cb => cb(msg.data));
    };
    ws.onclose = () => {
      if (opts?.reconnect) setTimeout(connect, 1000);
    };
  }

  connect();

  return {
    subscribe(channel, id, callback) {
      const key = `${channel}:${id}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(callback);
      ws.send(JSON.stringify({ type: 'subscribe', channel, id }));
      // Return unsubscribe function
      return () => {
        listeners.get(key)?.delete(callback);
        if (listeners.get(key)?.size === 0) {
          listeners.delete(key);
          ws.send(JSON.stringify({ type: 'unsubscribe', channel, id }));
        }
      };
    },
    subscribeGlobal(channel, callback) { /* ... */ },
    close() { ws.close(); },
  };
}
```

---

## How Each UI Uses the API

### Electron App

The Electron main process acts as a bridge: IPC handlers call the API client, WebSocket events forward to the renderer.

```typescript
// src/main/index.ts (after conversion to thin client)
import { createApiClient } from '../client/api-client';
import { createWsClient } from '../client/ws-client';
import { sendToRenderer } from '@template/main/core/window';
import { IPC_CHANNELS } from '../shared/ipc-channels';

// Connect to daemon
const token = readTokenFile();
const api = createApiClient('http://localhost:3847', token);
const ws = createWsClient('ws://localhost:3847/ws?token=' + token, { reconnect: true });

// Forward ALL streaming events from daemon → renderer
ws.subscribeGlobal('agent:output', (taskId, chunk) => sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk));
ws.subscribeGlobal('agent:message', (taskId, msg) => sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, msg));
ws.subscribeGlobal('agent:status', (taskId, status) => sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, status));
ws.subscribeGlobal('chat:output', (sessionId, chunk) => sendToRenderer(IPC_CHANNELS.CHAT_OUTPUT, sessionId, chunk));
// ... etc for all streaming channels

// src/main/ipc-handlers.ts (after conversion)
registerIpcHandler(IPC_CHANNELS.TASK_LIST, async (_, filter) => api.tasks.list(filter));
registerIpcHandler(IPC_CHANNELS.TASK_GET, async (_, id) => api.tasks.get(id));
registerIpcHandler(IPC_CHANNELS.TASK_CREATE, async (_, input) => api.tasks.create(input));
registerIpcHandler(IPC_CHANNELS.TASK_TRANSITION, async (_, id, toStatus, actor) => api.tasks.transition(id, toStatus, actor));
registerIpcHandler(IPC_CHANNELS.AGENT_START, async (_, taskId, mode, agentType) => api.agents.start(taskId, mode, agentType));
// ... etc for all IPC channels
```

**What the renderer sees:** No change. It still calls `window.api.listTasks()`, `window.api.startAgent()`, etc. The preload bridge and IPC channel names stay identical. Only the IPC handler implementation changes (API client instead of direct service calls).

### Web UI

The web UI calls the API client directly from the browser — no IPC layer, no preload bridge.

```typescript
// src/web/hooks/useTasks.ts
import { createApiClient } from '../../client/api-client';

const api = createApiClient('http://localhost:3847');

export function useTasks(projectId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    api.tasks.list({ projectId }).then(setTasks);
  }, [projectId]);

  const createTask = async (input: TaskCreateInput) => {
    const task = await api.tasks.create(input);
    setTasks(prev => [...prev, task]);
  };

  return { tasks, createTask };
}

// src/web/hooks/useAgentStream.ts
import { createWsClient } from '../../client/ws-client';

const ws = createWsClient('ws://localhost:3847/ws', { reconnect: true });

export function useAgentStream(taskId: string) {
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<string>('idle');

  useEffect(() => {
    const unsub1 = ws.subscribe('agent:output', taskId, (chunk) => {
      setOutput(prev => prev + chunk);
    });
    const unsub2 = ws.subscribe('agent:status', taskId, (s) => {
      setStatus(s as string);
    });
    return () => { unsub1(); unsub2(); };
  }, [taskId]);

  const start = (mode: AgentMode) => api.agents.start(taskId, mode);
  const stop = (runId: string) => api.agents.stop(runId);

  return { output, status, start, stop };
}
```

**Note:** The web UI React components could potentially reuse many of the existing `src/renderer/pages/` components. The main difference is replacing `window.api.*` calls with direct `api.*` calls.

### CLI

The CLI uses the same API client. For streaming operations it subscribes via WebSocket.

```typescript
// src/cli/commands/tasks.ts
export function registerTaskCommands(program: Command, api: ApiClient) {
  program
    .command('tasks list')
    .option('--project <id>', 'Project ID')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      const tasks = await api.tasks.list({ projectId: opts.project, status: opts.status });
      console.table(tasks.map(t => ({ id: t.id, title: t.title, status: t.status })));
    });

  program
    .command('tasks create')
    .requiredOption('--project <id>', 'Project ID')
    .requiredOption('--pipeline <id>', 'Pipeline ID')
    .requiredOption('--title <title>', 'Task title')
    .action(async (opts) => {
      const task = await api.tasks.create({ projectId: opts.project, pipelineId: opts.pipeline, title: opts.title });
      console.log(`Created task ${task.id}: ${task.title}`);
    });
}

// src/cli/commands/agent.ts
export function registerAgentCommands(program: Command, api: ApiClient, ws: WsClient) {
  program
    .command('agent start <taskId>')
    .option('--mode <mode>', 'Agent mode', 'implement')
    .action(async (taskId, opts) => {
      // Subscribe to output BEFORE starting
      const unsub = ws.subscribe('agent:output', taskId, (chunk) => {
        process.stdout.write(chunk as string);
      });

      ws.subscribe('agent:status', taskId, (status) => {
        if (status === 'completed' || status === 'failed') {
          console.log(`\nAgent ${status}`);
          unsub();
          process.exit(status === 'completed' ? 0 : 1);
        }
      });

      await api.agents.start(taskId, opts.mode);
      console.log(`Agent started for task ${taskId}...`);
    });
}
```

---

## Daemon Lifecycle

### Starting the Daemon

```bash
# Foreground (development)
agents-manager daemon start

# Background (production)
agents-manager daemon start --detach  # or -d

# With custom port
agents-manager daemon start --port 4000
```

When started with `--detach`:
1. Daemon forks as a detached child process
2. PID written to `~/.agents-manager/daemon.pid`
3. Logs written to `~/.agents-manager/daemon.log`
4. Auth token written to `~/.agents-manager/daemon.token`
5. Parent process exits after health check confirms daemon is ready

### Stopping the Daemon

```bash
agents-manager daemon stop
```

1. Reads PID from `~/.agents-manager/daemon.pid`
2. Sends `SIGTERM` to the process
3. Daemon handles gracefully: stops supervisors, stops agents, closes DB, exits

### Status Check

```bash
agents-manager daemon status
```

Output: `Daemon running on port 3847 (PID 12345, uptime 2h 15m)` or `Daemon not running`.

### Auto-Start from Electron

When the Electron app starts:
1. Try `GET http://localhost:3847/api/health`
2. If daemon is running → connect and use it
3. If not → spawn daemon as detached child process, wait for health check, then connect

```typescript
// src/main/daemon-launcher.ts
async function ensureDaemon(): Promise<{ url: string; token: string }> {
  const url = `http://localhost:${port}`;
  const tokenPath = path.join(os.homedir(), '.agents-manager', 'daemon.token');

  try {
    await fetch(`${url}/api/health`);
    // Already running
    const token = fs.readFileSync(tokenPath, 'utf-8').trim();
    return { url, token };
  } catch {
    // Start daemon
    const daemonBin = path.join(__dirname, '../../dist-daemon/index.js');
    const child = spawn(process.execPath, [daemonBin, '--detach'], { detached: true, stdio: 'ignore' });
    child.unref();

    // Wait for ready (poll health endpoint)
    await waitForHealth(url, { timeout: 10000, interval: 200 });
    const token = fs.readFileSync(tokenPath, 'utf-8').trim();
    return { url, token };
  }
}
```
