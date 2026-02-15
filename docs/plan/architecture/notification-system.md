# Notification System: Bidirectional Communication Channels

## Problem

The admin needs to interact with the workflow from anywhere - not just the Electron app. When an agent needs info, the admin might be on their phone. When a PR review is ready, they might want to approve from Slack. The notification system is not just "send alerts" - it's a **full interaction channel** equivalent to the app UI and CLI.

## Core Idea

A notification channel is a **bidirectional UI adapter**. It can:
1. **Send** - display information, task updates, agent results
2. **Prompt** - ask the admin for input with structured options
3. **Receive** - get the admin's response and route it to the workflow service

All three UIs (Electron app, notification channels, CLI) are equal. None contain workflow logic. They all talk to the same Workflow Service (see `workflow-service.md`).

```
┌─────────────┐     ┌─────────────────┐     ┌──────────┐
│ Electron UI  │     │ Notification     │     │ CLI      │
│ (React)      │     │ Channels         │     │ (am)     │
│              │     │ ┌─────────────┐  │     │          │
│ Display      │     │ │ Desktop     │  │     │ Display  │
│ state +      │     │ │ Telegram    │  │     │ state +  │
│ send actions │     │ │ Slack       │  │     │ send     │
│              │     │ │ Email       │  │     │ actions  │
│              │     │ │ Webhook     │  │     │          │
└──────┬───────┘     └───────┬───────┘  │     └────┬─────┘
       │                     │          │          │
       │ IPC                 │ Adapter   │ HTTP     │
       │                     │          │          │
┌──────▼─────────────────────▼──────────▼──────────▼──────┐
│                   Workflow Service                        │
│                                                          │
│  ALL logic lives here. UIs are display + input only.     │
│  Pipeline engine, agent orchestration, guards, hooks,    │
│  event log, payload handling                             │
└─────────────────────────────────────────────────────────┘
```

---

## Notification Channel Interface

```typescript
// src/main/interfaces/notification-channel.ts

interface INotificationChannel {
  readonly type: string;          // 'desktop', 'telegram', 'slack', 'email', 'webhook'
  readonly displayName: string;

  // Is this channel configured and available?
  isAvailable(): Promise<boolean>;

  // === Send (one-way, informational) ===

  // Send a simple notification (no response expected)
  send(notification: WorkflowNotification): Promise<void>;

  // === Prompt (two-way, expects response) ===

  // Send a notification with actions, wait for response
  // Returns the user's chosen action (or null if timeout/dismissed)
  prompt(notification: WorkflowPrompt): Promise<PromptResponse | null>;
}

// Manages multiple channels, routes to all active ones
interface INotificationRouter {
  // Register a channel
  register(channel: INotificationChannel): void;

  // Get all registered channels
  getChannels(): INotificationChannel[];

  // Get active (configured + available) channels
  getActiveChannels(): Promise<INotificationChannel[]>;

  // Send to all active channels
  broadcast(notification: WorkflowNotification): Promise<void>;

  // Prompt on the best available channel (or specific one)
  // If multiple channels, sends to all but accepts first response
  prompt(notification: WorkflowPrompt, channelType?: string): Promise<PromptResponse | null>;
}
```

---

## Notification Types

### WorkflowNotification (one-way)

Simple informational notification - "something happened."

```typescript
interface WorkflowNotification {
  // What happened
  type: NotificationType;
  title: string;
  body: string;

  // Severity affects how it's displayed (sound, badge, urgency)
  severity: 'info' | 'success' | 'warning' | 'error';

  // Context for deep-linking (click to open task, run, etc.)
  context: NotificationContext;

  // Optional rich content (markdown, for channels that support it)
  richBody?: string;

  // Timestamp
  timestamp: string;
}

type NotificationType =
  // Agent lifecycle
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.timeout'
  // Task updates
  | 'task.status_changed'
  | 'task.created'
  | 'task.assigned'
  // Pipeline events
  | 'pipeline.waiting'         // task entered a waiting status
  | 'pipeline.loop_warning'    // review loop iteration getting high
  | 'pipeline.blocked'         // transition blocked by guard
  // Queue
  | 'queue.item_completed'
  | 'queue.completed'
  | 'queue.failed';

interface NotificationContext {
  projectId: string;
  projectName: string;
  taskId?: string;
  taskTitle?: string;
  agentRunId?: string;
  // URL to open in the Electron app (deep link)
  appRoute?: string;
}
```

### WorkflowPrompt (two-way)

Notification that expects a response - "the pipeline needs your input."

```typescript
interface WorkflowPrompt {
  // Unique ID for correlating response back to the waiting task
  promptId: string;

  // Same fields as notification
  type: PromptType;
  title: string;
  body: string;
  severity: 'info' | 'warning';
  context: NotificationContext;
  richBody?: string;
  timestamp: string;

  // What the user can do
  actions: PromptAction[];

  // Optional: timeout before auto-dismissing
  timeoutMs?: number;

  // For channels that support it: render inline forms
  form?: PromptForm;
}

type PromptType =
  | 'needs_info'               // agent needs more information
  | 'options_proposed'         // agent proposes implementation options
  | 'changes_requested'        // PR review has change requests
  | 'approval_required'        // something needs admin approval
  | 'confirm_action';          // confirm a destructive or important action

// Simple button actions
interface PromptAction {
  id: string;                  // 'approve', 'reject', 'option_a', etc.
  label: string;               // "Approve", "Reject", "Option A"
  style: 'primary' | 'secondary' | 'danger';
}

// For channels that support inline forms (Slack modals, Telegram inline keyboards, web)
interface PromptForm {
  fields: PromptFormField[];
}

type PromptFormField =
  | { type: 'text'; id: string; label: string; placeholder?: string; required?: boolean }
  | { type: 'textarea'; id: string; label: string; placeholder?: string; required?: boolean }
  | { type: 'select'; id: string; label: string; options: { value: string; label: string }[]; required?: boolean }
  | { type: 'radio'; id: string; label: string; options: { value: string; label: string }[]; required?: boolean };

// What the user sends back
interface PromptResponse {
  promptId: string;
  actionId: string;            // which PromptAction was chosen
  formData?: Record<string, string>;  // if form fields were filled
  channelType: string;         // which channel the response came from
  respondedAt: string;
}
```

---

## How the Workflow Service Uses Notifications

The Workflow Service (see `workflow-service.md`) is the only thing that sends notifications. UIs never send notifications directly.

### Example: Agent Needs Info

```typescript
// Inside WorkflowService, called by pipeline engine when task enters 'needs_info'

async onTaskEnterWaiting(task: Task, payload: NeedsInfoPayload) {
  const prompt: WorkflowPrompt = {
    promptId: `needs-info-${task.id}-${Date.now()}`,
    type: 'needs_info',
    title: `Agent needs info: ${task.title}`,
    body: `The agent has ${payload.questions.length} question(s) before it can continue.`,
    severity: 'warning',
    context: {
      projectId: task.projectId,
      projectName: await this.getProjectName(task.projectId),
      taskId: task.id,
      taskTitle: task.title,
      appRoute: `/projects/${task.projectId}/tasks/${task.id}`,
    },
    richBody: payload.questions.map((q, i) =>
      `**Q${i+1}:** ${q.question}\n${q.context ? `_Context: ${q.context}_` : ''}\n${q.suggestedAnswer ? `_Suggested: ${q.suggestedAnswer}_` : ''}`
    ).join('\n\n'),
    actions: [
      { id: 'answer_inline', label: 'Answer Now', style: 'primary' },
      { id: 'open_app', label: 'Open in App', style: 'secondary' },
    ],
    form: {
      fields: payload.questions.map(q => ({
        type: 'textarea' as const,
        id: q.id,
        label: q.question,
        placeholder: q.suggestedAnswer || 'Your answer...',
        required: true,
      })),
    },
  };

  const response = await this.notificationRouter.prompt(prompt);

  if (response && response.actionId === 'answer_inline' && response.formData) {
    // User answered directly from Telegram/Slack
    const infoPayload: InfoProvidedPayload = {
      type: 'info_provided',
      answers: payload.questions.map(q => ({
        questionId: q.id,
        answer: response.formData![q.id],
      })),
    };

    // Route back into the workflow
    await this.executeTransition(task.id, 'planning', {
      triggeredBy: 'user',
      payload: infoPayload,
    });
  }
  // If 'open_app' or null (timeout), user will respond via the Electron UI
}
```

### Example: Agent Proposes Options

```typescript
async onOptionsProposed(task: Task, payload: OptionsProposedPayload) {
  const prompt: WorkflowPrompt = {
    promptId: `options-${task.id}-${Date.now()}`,
    type: 'options_proposed',
    title: `Choose approach: ${task.title}`,
    body: payload.description,
    severity: 'info',
    context: { /* ... */ },
    richBody: payload.options.map(o =>
      `**${o.title}**${o.id === payload.agentRecommendation ? ' ⭐ Recommended' : ''}\n${o.description}\n${o.pros ? `Pros: ${o.pros.join(', ')}` : ''}\n${o.cons ? `Cons: ${o.cons.join(', ')}` : ''}`
    ).join('\n\n'),
    actions: [
      ...payload.options.map(o => ({
        id: o.id,
        label: o.title + (o.id === payload.agentRecommendation ? ' ⭐' : ''),
        style: (o.id === payload.agentRecommendation ? 'primary' : 'secondary') as 'primary' | 'secondary',
      })),
      { id: 'custom', label: 'Custom Approach', style: 'secondary' as const },
    ],
    form: {
      fields: [
        { type: 'textarea', id: 'custom_instructions', label: 'Additional instructions (optional)', required: false },
      ],
    },
  };

  const response = await this.notificationRouter.prompt(prompt);

  if (response) {
    const selectionPayload: OptionSelectedPayload = {
      type: 'option_selected',
      selectedOptionId: response.actionId,
      customInstructions: response.formData?.custom_instructions,
    };

    await this.executeTransition(task.id, 'in_progress', {
      triggeredBy: 'user',
      payload: selectionPayload,
    });
  }
}
```

### Example: Simple Notifications (one-way)

```typescript
// Agent completed successfully - just inform, no response needed
async onAgentCompleted(task: Task, run: AgentRun) {
  await this.notificationRouter.broadcast({
    type: 'agent.completed',
    title: `Agent completed: ${task.title}`,
    body: `${run.agentType} finished in ${formatDuration(run.durationMs)}. Cost: $${run.tokenUsage?.totalCost?.toFixed(2) || '?'}`,
    severity: 'success',
    context: {
      projectId: task.projectId,
      projectName: await this.getProjectName(task.projectId),
      taskId: task.id,
      taskTitle: task.title,
      agentRunId: run.id,
      appRoute: `/projects/${task.projectId}/agents/${run.id}`,
    },
    timestamp: new Date().toISOString(),
  });
}
```

---

## Channel Implementations

### Phase 1: Desktop Notifications (Electron)

Simple, one-way only. Uses Electron's `Notification` API.

```typescript
class DesktopNotificationChannel implements INotificationChannel {
  type = 'desktop';
  displayName = 'Desktop Notifications';

  async isAvailable(): Promise<boolean> {
    return Notification.isSupported();
  }

  async send(notification: WorkflowNotification): Promise<void> {
    const n = new Notification({
      title: notification.title,
      body: notification.body,
      silent: notification.severity === 'info',
    });
    n.on('click', () => {
      // Focus app window and navigate to appRoute
    });
    n.show();
  }

  async prompt(prompt: WorkflowPrompt): Promise<PromptResponse | null> {
    // Desktop notifications can't collect responses
    // Send as regular notification with "Open in App" behavior
    await this.send({
      type: prompt.type as any,
      title: prompt.title,
      body: prompt.body + ' (Open app to respond)',
      severity: prompt.severity,
      context: prompt.context,
      timestamp: prompt.timestamp,
    });
    return null; // Response will come through the Electron UI instead
  }
}
```

### Future: Telegram Bot

Full bidirectional. Can send messages, inline keyboards, and receive responses.

```typescript
class TelegramChannel implements INotificationChannel {
  type = 'telegram';
  displayName = 'Telegram Bot';

  constructor(private botToken: string, private chatId: string) {}

  async isAvailable(): Promise<boolean> {
    // Check bot token is valid, chat ID is set
  }

  async send(notification: WorkflowNotification): Promise<void> {
    // Send formatted message to Telegram chat
    const text = formatTelegramMessage(notification);
    await this.telegramApi.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
  }

  async prompt(prompt: WorkflowPrompt): Promise<PromptResponse | null> {
    // Send message with inline keyboard buttons
    const keyboard = prompt.actions.map(action => [{
      text: action.label,
      callback_data: `${prompt.promptId}:${action.id}`,
    }]);

    const message = await this.telegramApi.sendMessage(this.chatId, formatTelegramPrompt(prompt), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });

    // Wait for callback query (user taps a button)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), prompt.timeoutMs || 3600000);

      this.onCallbackQuery((query) => {
        if (query.data.startsWith(prompt.promptId)) {
          clearTimeout(timeout);
          const actionId = query.data.split(':')[1];

          // If the action needs form data (like answering questions),
          // follow up with a conversation to collect it
          if (prompt.form && actionId === 'answer_inline') {
            this.collectFormData(prompt.form).then(formData => {
              resolve({
                promptId: prompt.promptId,
                actionId,
                formData,
                channelType: 'telegram',
                respondedAt: new Date().toISOString(),
              });
            });
          } else {
            resolve({
              promptId: prompt.promptId,
              actionId,
              channelType: 'telegram',
              respondedAt: new Date().toISOString(),
            });
          }
        }
      });
    });
  }
}
```

### Future: Slack Bot

Similar to Telegram but uses Slack's Block Kit for rich formatting and modals.

```typescript
class SlackChannel implements INotificationChannel {
  type = 'slack';
  displayName = 'Slack Bot';

  async prompt(prompt: WorkflowPrompt): Promise<PromptResponse | null> {
    // Use Slack interactive messages with Block Kit
    // Buttons for actions, modals for forms
    const blocks = buildSlackBlocks(prompt);
    await this.slackApi.chat.postMessage({
      channel: this.channelId,
      blocks,
    });

    // Listen for interaction payload via Slack Events API
    return this.waitForInteraction(prompt.promptId, prompt.timeoutMs);
  }
}
```

### Future: Webhook

One-way send + incoming webhook for responses.

```typescript
class WebhookChannel implements INotificationChannel {
  type = 'webhook';
  displayName = 'Webhook';

  async send(notification: WorkflowNotification): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    });
  }

  async prompt(prompt: WorkflowPrompt): Promise<PromptResponse | null> {
    // Send prompt to webhook
    await fetch(this.webhookUrl, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', ...prompt }),
    });

    // Wait for response on the HTTP API: POST /api/prompts/:promptId/respond
    return this.waitForHttpResponse(prompt.promptId, prompt.timeoutMs);
  }
}
```

---

## Notification Preferences

Stored in settings. Controls which notifications go to which channels.

```typescript
interface NotificationPreferences {
  // Global enable/disable
  enabled: boolean;

  // Per-channel settings
  channels: {
    [channelType: string]: {
      enabled: boolean;
      config: Record<string, any>;  // channel-specific (bot token, chat ID, webhook URL, etc.)
    };
  };

  // What events to notify on (per severity)
  filters: {
    agent_completed: boolean;    // default: true
    agent_failed: boolean;       // default: true
    agent_timeout: boolean;      // default: true
    pipeline_waiting: boolean;   // default: true (this is critical - admin input needed)
    task_status_changed: boolean;// default: false (too noisy usually)
    queue_completed: boolean;    // default: true
  };

  // Quiet hours (don't send non-critical notifications during these times)
  quietHours?: {
    enabled: boolean;
    start: string;  // "22:00"
    end: string;    // "08:00"
    timezone: string;
    // Critical notifications (agent.failed, pipeline.waiting) still go through
  };
}
```

---

## Prompt Lifecycle

Prompts have a lifecycle that must be managed:

```typescript
interface PendingPrompt {
  promptId: string;
  taskId: string;
  type: PromptType;
  sentAt: string;
  sentToChannels: string[];     // which channels received it
  timeoutAt: string | null;
  status: 'pending' | 'responded' | 'expired' | 'cancelled';
  response?: PromptResponse;
}
```

```typescript
interface IPromptStore {
  save(prompt: PendingPrompt): Promise<void>;
  getById(promptId: string): Promise<PendingPrompt | null>;
  getByTask(taskId: string): Promise<PendingPrompt[]>;
  getPending(): Promise<PendingPrompt[]>;
  markResponded(promptId: string, response: PromptResponse): Promise<void>;
  markExpired(promptId: string): Promise<void>;
  markCancelled(promptId: string): Promise<void>;
}
```

### Why This Matters

1. **Deduplication** - if the user responds from Telegram, the Electron app should stop showing the prompt
2. **Timeout handling** - if nobody responds, the system should take a default action or log a warning
3. **Audit trail** - who responded, from where, when
4. **Cancel on status change** - if the task moves (e.g., manually cancelled), pending prompts should be cancelled

### Prompt Deduplication Flow

```
1. Workflow creates prompt → stores in IPromptStore as 'pending'
2. NotificationRouter sends to all active channels
3. User responds from Telegram
4. TelegramChannel returns PromptResponse
5. Workflow marks prompt as 'responded' in IPromptStore
6. Electron UI polls/subscribes and sees prompt is responded → removes the form
7. Other channels receive cancellation (if still showing)
```

---

## Notification Router Implementation

```typescript
class NotificationRouterImpl implements INotificationRouter {
  private channels: INotificationChannel[] = [];

  register(channel: INotificationChannel): void {
    this.channels.push(channel);
  }

  async getActiveChannels(): Promise<INotificationChannel[]> {
    const results = await Promise.all(
      this.channels.map(async ch => ({
        channel: ch,
        available: await ch.isAvailable(),
      }))
    );
    return results.filter(r => r.available).map(r => r.channel);
  }

  // Decision 3c: Use Promise.allSettled() so individual channel failures
  // are logged but never block the operation. A failed Telegram send must
  // not prevent the desktop notification from being delivered.
  async broadcast(notification: WorkflowNotification): Promise<void> {
    const active = await this.getActiveChannels();
    const results = await Promise.allSettled(
      active.map(ch => ch.send(notification))
    );

    // Log any channel failures — but never throw
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(
          `Notification channel "${active[i].type}" failed:`,
          result.reason,
        );
        // Also log to event log if context.taskId is available
      }
    });
  }

  async prompt(prompt: WorkflowPrompt, channelType?: string): Promise<PromptResponse | null> {
    const active = await this.getActiveChannels();

    if (channelType) {
      // Send to specific channel
      const ch = active.find(c => c.type === channelType);
      return ch ? ch.prompt(prompt) : null;
    }

    // Send to ALL active channels, race for first response
    const promises = active.map(ch => ch.prompt(prompt));
    const result = await Promise.race([
      ...promises,
      // Timeout fallback
      new Promise<null>(resolve =>
        setTimeout(() => resolve(null), prompt.timeoutMs || 3600000)
      ),
    ]);

    return result;
  }
}
```

---

## What Each UI Provides

All UIs provide the same capabilities through different interfaces:

| Capability | Electron App | Telegram/Slack | CLI |
|-----------|-------------|---------------|-----|
| View task list | Page with table/kanban | `/tasks` command | `am tasks list` |
| View task detail | Detail page | `/task <id>` command | `am tasks get <id>` |
| Change task status | Click transition button | Inline button on prompt | `am tasks update <id> --status done` |
| Answer agent questions | Form in task detail | Reply to bot message with form | `am tasks respond <id> --answers ...` |
| Pick implementation option | Radio buttons in task detail | Inline keyboard buttons | `am tasks select <id> --option a` |
| Review PR comments | Review panel in task detail | Formatted message + approve/reject buttons | `am tasks review <id> --approve` |
| Start agent on task | "Plan"/"Implement" button | `/run <taskId> implement` command | `am agent start <taskId> --mode implement` |
| Stop running agent | "Stop" button | `/stop <runId>` command | `am agent stop <runId>` |
| View agent output | Transcript viewer page | Summarized in message | `am agent log <runId>` |
| View event log | Event log panel | `/log <taskId>` command | `am tasks log <taskId>` |

### The Key Rule

**No UI makes decisions.** Every UI does exactly two things:
1. **Display state** from the Workflow Service
2. **Send commands** to the Workflow Service

The Workflow Service decides what happens next. If a Telegram user taps "Approve", the Telegram channel sends a command to the Workflow Service. The Workflow Service validates it (checks guards), executes the transition, fires hooks, logs events, and broadcasts the result to all UIs.

---

## Phase Rollout

### Phase 1
- `INotificationChannel` interface defined
- `INotificationRouter` interface defined
- `DesktopNotificationChannel` implementation (one-way only)
- Basic notification preferences in settings
- Workflow Service sends notifications on agent complete/fail

### Phase 2
- Prompts for human-in-the-loop (needs info, options, changes requested)
- `IPromptStore` for prompt lifecycle management
- Electron UI renders prompt forms (the primary response channel)
- Desktop notifications link to the prompt form in the app

### Phase 4
- Telegram bot channel (full bidirectional)
- Slack bot channel (full bidirectional)
- Webhook channel
- Quiet hours support
- Per-channel notification filtering

### Phase 5
- Email channel (one-way send, webhook for responses)
- Notification history/log page
- Channel health monitoring
