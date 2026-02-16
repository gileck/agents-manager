# Workflow Service: The Single Source of Logic

## Problem

With three UIs (Electron app, notification channels, CLI), logic must not leak into any of them. If "start agent" requires checking guards, updating task status, logging events, and sending notifications - that logic must live in exactly one place. Otherwise we'd duplicate it across three UIs, and they'd drift apart.

## Core Idea

The **Workflow Service** is the single entry point for all operations. It orchestrates across all the abstraction interfaces (task store, pipeline engine, agent framework, notification router, event log, git ops). Every UI calls the same Workflow Service methods.

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│ Electron UI  │     │ Notification  │     │   CLI    │
│ (IPC)        │     │ Channels      │     │ (direct) │
└──────┬───────┘     └──────┬────────┘     └────┬─────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│                    Workflow Service                       │
│                                                          │
│  The ONLY place that:                                    │
│  - Changes task status (via pipeline engine)             │
│  - Starts/stops agents                                   │
│  - Validates operations (guards)                         │
│  - Fires side effects (hooks, notifications)             │
│  - Logs events                                           │
│  - Handles prompt responses                              │
│                                                          │
│  All dependencies injected via constructor:               │
│  ITaskStore, IPipelineEngine, IAgentFramework,           │
│  INotificationRouter, ITaskEventLog, IGitOps, etc.       │
└─────────────────────────────────────────────────────────┘
```

---

## Interface

```typescript
// src/main/interfaces/workflow-service.ts

interface IWorkflowService {
  // === Task Operations ===

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<Task>;
  deleteTask(taskId: string): Promise<void>;

  getTask(taskId: string): Promise<Task>;
  listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]>;

  // === Pipeline Operations ===

  // Move task to a new status (validates, fires hooks, logs, notifies)
  transitionTask(taskId: string, toStatus: string, context: TransitionContext): Promise<TransitionResult>;

  // Get what the user/agent can do next
  getValidTransitions(taskId: string, trigger?: TransitionTrigger): Promise<ValidTransition[]>;

  // Get task's transition history
  getTransitionHistory(taskId: string): Promise<TransitionHistoryEntry[]>;

  // === Agent Operations ===

  // Start an agent on a task (validates state, creates run, starts agent, updates status)
  startAgent(taskId: string, mode: AgentRunMode, config?: Partial<AgentConfig>): Promise<AgentRun>;

  // Stop a running agent
  stopAgent(runId: string): Promise<void>;

  // Get agent run details
  getAgentRun(runId: string): Promise<AgentRun>;
  listAgentRuns(filters: { projectId?: string; taskId?: string }): Promise<AgentRun[]>;

  // === Prompt/Response Operations ===

  // Respond to a pending prompt (from any UI)
  respondToPrompt(promptId: string, response: PromptResponse): Promise<TransitionResult>;

  // Get pending prompts for a task
  getPendingPrompts(taskId: string): Promise<PendingPrompt[]>;

  // Get all pending prompts (for notification channels to know what's waiting)
  getAllPendingPrompts(): Promise<PendingPrompt[]>;

  // === Event Log ===

  getTaskEvents(taskId: string, filters?: TaskEventFilters): Promise<TaskEvent[]>;
  getProjectEvents(projectId: string, filters?: TaskEventFilters): Promise<TaskEvent[]>;

  // === Project Operations ===

  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(projectId: string, input: UpdateProjectInput): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  getProject(projectId: string): Promise<Project>;
  listProjects(): Promise<Project[]>;

  // === Pipeline Management ===

  listPipelines(): Promise<PipelineDefinition[]>;
  savePipeline(definition: PipelineDefinition): Promise<PipelineDefinition>;
  deletePipeline(pipelineId: string): Promise<void>;

  // === Task Notes ===

  addNote(taskId: string, content: string, author: string): Promise<TaskNote>;
  listNotes(taskId: string): Promise<TaskNote[]>;

  // === Subscriptions (for real-time UI updates) ===

  // Subscribe to events for a task (used by Electron UI for live updates)
  onTaskEvent(taskId: string, callback: (event: TaskEvent) => void): () => void;  // returns unsubscribe fn

  // Subscribe to all events for a project
  onProjectEvent(projectId: string, callback: (event: TaskEvent) => void): () => void;

  // Subscribe to agent output stream
  onAgentOutput(runId: string, callback: (message: AgentMessage) => void): () => void;
}
```

---

## Implementation

The Workflow Service doesn't contain raw business logic itself - it **orchestrates** across providers. Each method follows the same pattern:

1. Validate the operation
2. Execute it
3. Log the event
4. Send notifications
5. Return the result

```typescript
class WorkflowServiceImpl implements IWorkflowService {
  constructor(
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private pipelineEngine: IPipelineEngine,
    private agentFramework: IAgentFramework,
    private notificationRouter: INotificationRouter,
    private eventLog: ITaskEventLog,
    private gitOps: IGitOps,
    private promptStore: IPromptStore,
  ) {}

  // === Example: transitionTask ===

  async transitionTask(
    taskId: string,
    toStatus: string,
    context: TransitionContext
  ): Promise<TransitionResult> {
    // 1. Pipeline engine validates and executes (checks guards, updates status)
    const result = await this.pipelineEngine.transition(taskId, toStatus, context);

    if (!result.success) {
      // Log the failed attempt
      await this.eventLog.log({
        taskId,
        category: 'transition',
        type: 'status.blocked',
        summary: `Transition to '${toStatus}' blocked: ${result.error}`,
        data: { toStatus, blockedBy: result.error },
        actor: { type: context.triggeredBy },
        level: 'warning',
      });
      return result;
    }

    // NOTE: The pipeline engine handles granular event logging (guards, hooks, status changes)
    // via the ITaskEventLog. WorkflowService handles notifications and UI subscriptions only.

    // 2. Check if new status is a 'waiting' status with a payload
    const pipeline = await this.pipelineEngine.getPipeline(taskId);
    const newStatus = pipeline.statuses.find(s => s.id === toStatus);

    if (newStatus?.category === 'waiting' && context.payload) {
      await this.handleWaitingStatus(result.task, context.payload);
    }

    // 3. Notify on status change
    await this.notificationRouter.broadcast({
      type: 'task.status_changed',
      title: `${result.task.title}: ${result.previousStatus} → ${result.newStatus}`,
      body: context.reason || `Task moved to ${result.newStatus}`,
      severity: 'info',
      context: await this.buildNotificationContext(result.task),
      timestamp: new Date().toISOString(),
    });

    // Pipeline engine already logged the transition event.
    // Emit for live UI subscribers (Electron webContents, SSE clients).
    this.emitToSubscribers(taskId, 'task:updated', result);

    return result;
  }

  // === Example: startAgent ===

  async startAgent(
    taskId: string,
    mode: AgentRunMode,
    config?: Partial<AgentConfig>
  ): Promise<AgentRun> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const project = await this.projectStore.getById(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    // Resolve agent type and config
    const agentType = config?.agentType || project.config?.defaultAgentType || 'claude-code';
    const agent = this.agentFramework.getAgent(agentType);
    const fullConfig = { ...agent.getDefaultConfig(), ...config };

    // Build prompt from task data + any payload context
    const prompt = await this.buildAgentPrompt(task, mode, fullConfig);

    // Create run record
    const run = await this.createAgentRun(task, agentType, mode, fullConfig);

    // Log event
    await this.eventLog.log({
      taskId,
      category: 'agent',
      type: 'agent.started',
      summary: `${agent.displayName} started (${mode} mode)`,
      data: { runId: run.id, agentType, mode, model: fullConfig.model },
      actor: { type: 'agent', name: agentType, agentRunId: run.id },
      level: 'info',
    });

    // Notify
    await this.notificationRouter.broadcast({
      type: 'agent.started',
      title: `Agent started: ${task.title}`,
      body: `${agent.displayName} is working on "${task.title}" (${mode} mode)`,
      severity: 'info',
      context: await this.buildNotificationContext(task, run.id),
      timestamp: new Date().toISOString(),
    });

    // Start the agent (async - runs in background)
    this.runAgent(agent, run, task, project, prompt, fullConfig);

    return run;
  }

  // NOTE: Concurrent startAgent calls on the same task are safe.
  // The pipeline engine's transition() wraps the guard check + status update +
  // run record creation in a single SQLite transaction. SQLite's single-writer
  // lock ensures only one call succeeds; the second sees the updated status
  // and fails the no_running_agent guard. See pipeline/engine.md for details.

  // === Example: respondToPrompt ===

  async respondToPrompt(
    promptId: string,
    response: PromptResponse
  ): Promise<TransitionResult> {
    const prompt = await this.promptStore.getById(promptId);
    if (!prompt) throw new Error(`Prompt not found: ${promptId}`);
    if (prompt.status !== 'pending') throw new Error(`Prompt already ${prompt.status}`);

    // Mark prompt as responded
    await this.promptStore.markResponded(promptId, response);

    // Cancel any other pending prompts for this task
    const otherPrompts = await this.promptStore.getByTask(prompt.taskId);
    for (const other of otherPrompts) {
      if (other.promptId !== promptId && other.status === 'pending') {
        await this.promptStore.markCancelled(other.promptId);
      }
    }

    // Map the response to a transition payload
    const task = await this.taskStore.getTask(prompt.taskId);
    const transitionPayload = this.mapResponseToPayload(prompt, response);

    // Determine the target status based on prompt type and response
    const validTransitions = await this.pipelineEngine.getValidTransitions(prompt.taskId, { type: 'manual' });
    const targetTransition = this.resolveTargetTransition(validTransitions, prompt, response);

    if (!targetTransition) {
      throw new Error('No valid transition found for this response');
    }

    // Log the response
    await this.eventLog.log({
      taskId: prompt.taskId,
      category: 'payload',
      type: `${prompt.type}.responded`,
      summary: `Response received via ${response.channelType}: ${response.actionId}`,
      data: { promptId, response, channelType: response.channelType },
      actor: { type: 'user' },
      level: 'info',
    });

    // Execute the transition with the payload
    return this.transitionTask(prompt.taskId, targetTransition.transition.to, {
      triggeredBy: 'user',
      payload: transitionPayload,
      reason: `Response to ${prompt.type} prompt via ${response.channelType}`,
    });
  }

  // === Agent completion handler (called when agent process finishes) ===

  private async onAgentCompleted(run: AgentRun, result: AgentRunResult): Promise<void> {
    // Update run record
    await this.updateAgentRun(run.id, {
      status: result.exitCode === 0 ? 'completed' : 'failed',
      transcript: result.transcript,
      tokenUsage: result.tokenUsage,
      finishedAt: new Date().toISOString(),
    });

    // Log event
    const task = await this.taskStore.getTask(run.taskId);
    await this.eventLog.log({
      taskId: run.taskId,
      category: 'agent',
      type: result.exitCode === 0 ? 'agent.completed' : 'agent.failed',
      summary: result.exitCode === 0
        ? `${run.agentType} completed in ${formatDuration(run.durationMs)} ($${result.tokenUsage?.totalCost?.toFixed(2)})`
        : `${run.agentType} failed: ${result.error || 'unknown error'}`,
      data: { runId: run.id, exitCode: result.exitCode, tokenUsage: result.tokenUsage },
      actor: { type: 'agent', name: run.agentType, agentRunId: run.id },
      level: result.exitCode === 0 ? 'info' : 'error',
    });

    // Determine what transition to trigger based on outcome vs error
    const trigger = result.exitCode === 0 && result.outcome
      ? { type: 'agent_outcome' as const, outcome: result.outcome }
      : { type: 'agent_error' as const };
    const validTransitions = await this.pipelineEngine.getValidTransitions(
      run.taskId,
      trigger
    );

    if (validTransitions.length === 1 && validTransitions[0].allowed) {
      // Single valid transition - auto-execute
      await this.transitionTask(run.taskId, validTransitions[0].transition.to, {
        triggeredBy: 'agent',
        agentRunId: run.id,
        payload: result.payload,
        reason: result.exitCode === 0 ? 'Agent completed successfully' : result.error,
      });
    } else if (validTransitions.length > 1) {
      // Multiple valid transitions - notify admin to decide
      await this.notificationRouter.broadcast({
        type: 'agent.completed',
        title: `Agent needs direction: ${task.title}`,
        body: `Agent completed but multiple next steps are possible. Please choose.`,
        severity: 'warning',
        context: await this.buildNotificationContext(task, run.id),
        timestamp: new Date().toISOString(),
      });
    } else {
      // Notify completion/failure
      await this.notificationRouter.broadcast({
        type: result.exitCode === 0 ? 'agent.completed' : 'agent.failed',
        title: result.exitCode === 0
          ? `Agent completed: ${task.title}`
          : `Agent failed: ${task.title}`,
        body: result.exitCode === 0
          ? `${run.agentType} finished in ${formatDuration(run.durationMs)}`
          : `${run.agentType} failed: ${result.error}`,
        severity: result.exitCode === 0 ? 'success' : 'error',
        context: await this.buildNotificationContext(task, run.id),
        timestamp: new Date().toISOString(),
      });
    }
  }
}
```

---

## How Each UI Connects

### Electron App (IPC)

IPC handlers are a thin mapping from IPC channels to Workflow Service methods.

```typescript
// src/main/ipc-handlers.ts

export function registerIpcHandlers(workflowService: IWorkflowService) {
  // Tasks
  ipcMain.handle('tasks:list', (_, projectId, filters) =>
    workflowService.listTasks(projectId, filters));

  ipcMain.handle('tasks:get', (_, taskId) =>
    workflowService.getTask(taskId));

  ipcMain.handle('tasks:create', (_, input) =>
    workflowService.createTask(input));

  ipcMain.handle('tasks:update', (_, taskId, input) =>
    workflowService.updateTask(taskId, input));

  ipcMain.handle('tasks:delete', (_, taskId) =>
    workflowService.deleteTask(taskId));

  // Pipeline
  ipcMain.handle('pipeline:transition', (_, taskId, toStatus, context) =>
    workflowService.transitionTask(taskId, toStatus, context));

  ipcMain.handle('pipeline:valid-transitions', (_, taskId) =>
    workflowService.getValidTransitions(taskId));

  // Agent
  ipcMain.handle('agent:start', (_, taskId, mode, config) =>
    workflowService.startAgent(taskId, mode, config));

  ipcMain.handle('agent:stop', (_, runId) =>
    workflowService.stopAgent(runId));

  // Prompts
  ipcMain.handle('prompt:respond', (_, promptId, response) =>
    workflowService.respondToPrompt(promptId, response));

  // Events (subscribe via IPC events, not handles)
  ipcMain.on('events:subscribe-task', (event, taskId) => {
    const unsubscribe = workflowService.onTaskEvent(taskId, (taskEvent) => {
      event.sender.send('events:task-event', taskEvent);
    });
    // Store unsubscribe for cleanup
  });
}
```

Zero logic in the IPC layer. Just maps channels to service methods.

### CLI (Direct DB Access)

The CLI uses the same `createAppServices(db)` composition root as the Electron app, calling WorkflowService methods directly. No HTTP server needed.

```typescript
// src/cli/db.ts
import { createAppServices } from '../main/providers/setup';
import Database from 'better-sqlite3';

export function getServices(): AppServices {
  const db = new Database(DB_PATH);
  return createAppServices(db);
}

// src/cli/commands/tasks.ts — same pattern as IPC handlers
const { workflowService } = getServices();
const tasks = await workflowService.listTasks(projectId, filters);
const result = await workflowService.transitionTask(taskId, toStatus, context);
```

Zero logic in the CLI layer. Just maps commands to service methods — identical to IPC handlers.

### Notification Channels

Channels call back into the Workflow Service when they receive responses.

```typescript
// Inside TelegramChannel, when user taps a button:
async onCallbackQuery(query) {
  const [promptId, actionId] = query.data.split(':');
  const response: PromptResponse = {
    promptId,
    actionId,
    channelType: 'telegram',
    respondedAt: new Date().toISOString(),
  };

  // Call the Workflow Service - same as if user clicked in the app
  await this.workflowService.respondToPrompt(promptId, response);
}
```

---

## Subscription Model (Real-time Updates)

All UIs need to react to changes happening elsewhere. If an agent completes and the Electron app is open, it should update immediately.

```typescript
// Internal event emitter used by WorkflowService
interface IWorkflowEventEmitter {
  emit(event: string, data: any): void;
  on(event: string, callback: (data: any) => void): () => void;  // returns unsubscribe
}

// Events emitted:
// 'task:event' - any task event (from event log)
// 'task:updated' - task data changed
// 'agent:output' - agent streaming message
// 'agent:status' - agent status changed
// 'prompt:created' - new prompt waiting for response
// 'prompt:responded' - prompt was responded to
```

- **Electron UI** subscribes via IPC events
- **CLI** can poll the database for changes
- **Notification channels** don't need to subscribe - the Workflow Service pushes to them

---

## Key Rules

1. **Workflow Service is the ONLY entry point for mutations.** No store, engine, or agent is called directly by any UI.

2. **Every operation goes through the same code path** regardless of which UI triggered it. A transition from Telegram goes through exactly the same validation, logging, and notification as a transition from the Electron app.

3. **UIs are interchangeable.** If you remove the Electron app, the Telegram bot still works. If you remove Telegram, the CLI still works. Each UI is independent.

4. **Side effects are centralized.** If you want every status change to log an event and send a notification, you add it once in the Workflow Service. Not in three UIs.

5. **The Workflow Service does not know about UIs.** It talks to `INotificationRouter` (abstraction), not to `TelegramChannel` (implementation). It uses `IWorkflowEventEmitter` for subscriptions, not `ipcMain.send`.

---

## Phase Rollout

### Phase 1
- `IWorkflowService` interface defined
- Implementation with task CRUD + pipeline transitions
- IPC handlers call Workflow Service (not stores directly)
- Event logging on all operations
- Basic desktop notifications (one-way)

### Phase 2
- Agent operations added to Workflow Service
- Agent completion → automatic pipeline transition
- Prompt system for human-in-the-loop
- Real-time agent output subscription

### Phase 3
- CLI added, uses `createAppServices(db)` directly (no HTTP server)
- All three UIs verified to produce identical behavior

### Phase 4
- Telegram/Slack channels (bidirectional)
- Prompt deduplication across channels
- SSE endpoint for HTTP clients
- Notification preferences

### Phase 5
- Queue management through Workflow Service
- Webhook channel
- Advanced prompt flows (multi-step conversations)
