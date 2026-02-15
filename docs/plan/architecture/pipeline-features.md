# Pipeline Features

Advanced pipeline features that enable rich human-agent collaboration. These flows go beyond the simple open → implement → done path and handle the real-world complexity of agent-driven development.

These features do not need to be implemented in Phase 1, but the architecture must account for all of them from the start to avoid costly refactors later.

See also: [pipeline/engine.md](pipeline/engine.md) | [pipeline/outcome-schemas.md](pipeline/outcome-schemas.md) | [pipeline/event-log.md](pipeline/event-log.md) | [agent-platform.md](agent-platform.md) | [tasks.md](tasks.md)

---

## Overview

All advanced flows share one underlying mechanism: **agent pauses → emits a payload → task transitions to a waiting state → admin responds → agent resumes with response as context.**

The three core flows:

| Flow | Agent Does | Admin Does | Result |
|------|-----------|------------|--------|
| **Request information** | Asks a question, suggests options | Picks an option or writes custom answer | Agent resumes with the answer |
| **Submit for review** | Submits work (PR or document) | Approves or requests changes with comment | Agent resumes to fix, or task advances |
| **Propose task split** | Suggests phases/subtasks | Approves, modifies, or rejects the split | System creates phases, work continues |

---

## Flow 1: Request Information / Suggest Options

The most common human-in-the-loop interaction. The agent needs input from the admin before it can continue. This covers:

- **Clarifying questions** — "Should this API be REST or GraphQL?"
- **Option selection** — "I found 3 approaches, which one should I use?"
- **Confirmation gates** — "This will delete 5 files and change the public API. Proceed?"
- **Escalation** — "I'm stuck. Here's what I tried. What should I do?"
- **Cost/scope approval** — "This is bigger than expected (15 files, 3 packages). Continue?"

These are all the **same mechanism** in the pipeline — the difference is just the payload content and how the UI renders it.

### Agent Outcome

When an agent needs information, it emits an outcome with type `needs_info`:

```typescript
interface NeedsInfoPayload {
  /** The question or request for the admin. Markdown supported. */
  question: string;

  /**
   * Suggested options. The first option is the recommended one.
   * Each option has a label (short) and description (detailed).
   * The admin can pick one of these or write a custom answer.
   */
  options?: {
    label: string;
    description: string;
    recommended?: boolean;     // at most one option should be recommended (typically the first)
  }[];

  /**
   * Category hint for UI rendering. All use the same pipeline mechanism,
   * but the UI can show different presentations.
   */
  category?: 'question' | 'options' | 'confirmation' | 'escalation' | 'scope_approval';

  /**
   * Context the agent provides to help the admin decide.
   * e.g., for escalation: what the agent tried, error logs, relevant code snippets.
   */
  context?: string;
}
```

### Admin Response

```typescript
interface InfoResponse {
  /** Which option the admin chose (by index). Null if custom answer. */
  selectedOption?: number;

  /** Free-text answer. Used when admin picks "custom" or adds detail to an option. */
  answer?: string;
}
```

### Pipeline Flow

```
┌─────────────────┐     outcome: needs_info      ┌─────────────────┐
│  Agent running   │ ──────────────────────────→  │  Waiting state   │
│  (in_progress)   │                              │  (needs_info)    │
└─────────────────┘                               └────────┬────────┘
                                                           │
                                              Admin sees question + options
                                              Admin picks option or writes answer
                                                           │
                                                           ▼
                                                  ┌─────────────────┐
                                                  │  Agent resumes   │
                                                  │  (in_progress)   │
                                                  └─────────────────┘
```

**Pipeline definition (relevant transition):**

```json
{
  "from": "in_progress",
  "to": "needs_info",
  "trigger": "agent_outcome",
  "outcomeValue": "needs_info"
}
```

```json
{
  "from": "needs_info",
  "to": "in_progress",
  "trigger": "prompt_response",
  "guards": [{ "type": "has_payload_response", "params": { "payloadType": "info_request" } }],
  "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }]
}
```

### How the Response Reaches the Agent

When the agent resumes after a `needs_info` pause:

1. The admin's response is stored in the **task event log** as a `prompt_response` event
2. The `AgentContextBuilder` assembles the full context including:
   - Original task metadata and plan
   - All previous agent output (transcript) up to the pause point
   - The question that was asked
   - The admin's response
   - Any additional document/mock artifacts
3. The agent receives this as a continuation prompt — it sees the full conversation history plus the answer

```typescript
// In AgentContextBuilder
const events = await eventLog.list(taskId);
const promptEvents = events.filter(e =>
  e.type === 'prompt_created' || e.type === 'prompt_response'
);

// Inject as conversation-style context:
// Agent: "Should this API be REST or GraphQL?"
//   Option 1: REST (recommended) - Simple, well-understood
//   Option 2: GraphQL - Flexible queries, single endpoint
// Admin: "Use GraphQL. We need flexible queries for the dashboard."
```

### Quick Accept (Recommended Option)

When an agent recommends an option (first option or explicitly marked `recommended: true`), the UI shows a prominent "Accept Recommended" button. This enables fast flow:

```
┌──────────────────────────────────────────────┐
│ Agent needs input                            │
│                                              │
│ "Which auth strategy should I use?"          │
│                                              │
│ ◉ JWT tokens (recommended)                   │
│   Stateless, works with mobile clients       │
│                                              │
│ ○ Session-based                              │
│   Server-side sessions, simpler but stateful │
│                                              │
│ ○ Custom answer...                           │
│                                              │
│ [ Accept Recommended ]  [ Choose & Continue ]│
└──────────────────────────────────────────────┘
```

"Accept Recommended" is a single click — no typing, no extra decisions. This keeps the flow fast for cases where the agent's suggestion is good.

### Notification Integration

When an agent pauses for input:
1. Desktop notification: "Agent needs input on: Add authentication"
2. Telegram/Slack: full question + options rendered as inline buttons
3. Admin can respond from **any channel** — the response flows back through the WorkflowService regardless of which UI was used

The Telegram/Slack channel renders options as buttons, with the recommended option highlighted. Admin taps a button or types a custom answer. Same mechanism, different UI.

---

## Flow 2: Submit for Review

The agent submits work for admin review. The admin can approve (work continues/completes) or request changes (agent runs again with feedback).

This flow handles two types of review:
- **Code review** — agent created a PR, admin reviews the code
- **Document review** — agent produced a design doc, spec, or plan, admin reviews the content

### Code Review (PR)

The agent creates a PR as part of its implementation work. The PR is the review artifact.

```
┌─────────────────┐     outcome: pr_ready        ┌─────────────────┐
│  Agent running   │ ──────────────────────────→  │  PR Review       │
│  (in_progress)   │                              │  (pr_review)     │
└─────────────────┘                               └────────┬────────┘
                                                           │
                                              Admin reviews PR
                                              (in GitHub UI or in-app DiffViewer)
                                                           │
                                              ┌────────────┴────────────┐
                                              │                         │
                                              ▼                         ▼
                                    ┌─────────────────┐     ┌──────────────────────┐
                                    │  Approved        │     │  Changes requested    │
                                    │  → merge → done  │     │  (changes_requested)  │
                                    └─────────────────┘     └──────────┬───────────┘
                                                                       │
                                                          Agent resumes with
                                                          review comments as context
                                                                       │
                                                                       ▼
                                                            ┌─────────────────┐
                                                            │  Agent running   │
                                                            │  (in_progress)   │
                                                            └─────────────────┘
                                                                       │
                                                              submits updated PR
                                                                       │
                                                                       ▼
                                                            ┌─────────────────┐
                                                            │  PR Review       │
                                                            │  (back to top)   │
                                                            └─────────────────┘
```

**Where do review comments live?**

Two sources, both funneled into the agent's context:

1. **GitHub PR comments** — admin reviews in GitHub UI, leaves inline comments and a summary. When the agent resumes, `IScmPlatform.getPRComments(prNumber)` fetches them.
2. **In-app review comment** — admin writes a review comment in the Agents Manager UI. Stored as a `review` event in the task event log.

Both are assembled by `AgentContextBuilder` when the agent resumes:

```typescript
// AgentContextBuilder — for review feedback context
async function buildReviewFeedbackContext(taskId: string): Promise<string> {
  const sections: string[] = [];

  // 1. PR comments from GitHub
  const prArtifact = await findOpenPR(taskId);
  if (prArtifact) {
    const comments = await scmPlatform.getPRComments(repoUrl, prArtifact.metadata.prNumber);
    if (comments.length) {
      sections.push('## PR Review Comments\n' + formatPRComments(comments));
    }
  }

  // 2. In-app review comments from event log
  const reviewEvents = (await eventLog.list(taskId))
    .filter(e => e.type === 'review_submitted');
  for (const event of reviewEvents) {
    sections.push(`## Review Feedback\n${event.payload.comment}`);
  }

  return sections.join('\n\n---\n\n');
}
```

**Review action payload:**

```typescript
interface ReviewPayload {
  /** Approve or request changes. */
  decision: 'approved' | 'changes_requested';

  /**
   * Review comment. Required for changes_requested, optional for approved.
   * This is the admin's feedback that the agent will receive.
   */
  comment?: string;
}
```

**Pipeline transitions:**

```json
{
  "from": "pr_review",
  "to": "done",
  "trigger": "review_submitted",
  "guards": [{ "type": "review_approved" }],
  "hooks": [
    { "type": "merge_pr" },
    { "type": "notify", "params": { "title": "Task completed" } }
  ]
}
```

```json
{
  "from": "pr_review",
  "to": "changes_requested",
  "trigger": "review_submitted",
  "guards": [{ "type": "review_changes_requested" }]
}
```

```json
{
  "from": "changes_requested",
  "to": "in_progress",
  "trigger": "auto",
  "hooks": [
    { "type": "start_agent", "params": { "mode": "implement" } }
  ]
}
```

### Document Review

For non-code artifacts (design docs, specs, plans), the review happens in-app. The document artifact is the review target.

The flow is identical to code review, but:
- The admin reviews the document content in the task detail page (not GitHub)
- Review comments are stored in the task event log (not GitHub PR comments)
- "Approve" means the document is finalized — the agent can proceed to the next step (e.g., implementation)
- "Request changes" means the agent re-runs in the same mode (e.g., `plan` or `design`) with the feedback

```typescript
interface DocumentReviewPayload {
  decision: 'approved' | 'changes_requested';
  comment?: string;
  /** Which document artifact is being reviewed. */
  artifactId: string;
}
```

**Pipeline transitions for document review:**

```json
{
  "from": "planning",
  "to": "planned",
  "trigger": "agent_outcome",
  "outcomeValue": "plan_ready"
}
```

At this point the admin sees the plan/design doc. They review it:

```json
{
  "from": "planned",
  "to": "in_progress",
  "trigger": "review_submitted",
  "guards": [{ "type": "review_approved" }],
  "hooks": [
    { "type": "start_agent", "params": { "mode": "implement" } }
  ]
}
```

```json
{
  "from": "planned",
  "to": "planning",
  "trigger": "review_submitted",
  "guards": [{ "type": "review_changes_requested" }],
  "hooks": [
    { "type": "start_agent", "params": { "mode": "plan" } }
  ]
}
```

### Review Loop Limit

The `max_iterations` guard prevents infinite review loops:

```json
{
  "from": "changes_requested",
  "to": "in_progress",
  "guards": [{ "type": "max_iterations", "params": { "statusId": "changes_requested", "max": 5 } }]
}
```

After 5 cycles, the transition is blocked and the admin must handle it manually (rewrite, reassign, or close the task).

---

## Flow 3: Propose Task Split

The agent realizes the task is too large or too complex for a single run and proposes splitting it into phases or subtasks. This is structurally different from the other flows because the response creates new entities (phases) rather than just providing text.

### When This Happens

- **Plan agent** analyzes a task and determines it needs multiple phases
- **Implement agent** discovers mid-work that the scope is larger than expected
- **Any agent** can propose a split at any point by emitting the `propose_split` outcome

### Agent Outcome

```typescript
interface ProposeSplitPayload {
  /**
   * Why the agent is proposing a split.
   */
  reason: string;

  /**
   * The proposed phases, in order.
   * Each has a name, description, and estimated complexity.
   */
  proposedPhases: {
    name: string;
    description: string;
    complexity?: 'low' | 'medium' | 'high';
  }[];
}
```

### Admin Response

The admin sees the proposed phases in the UI and can:
- **Approve as-is** — phases are created exactly as proposed
- **Modify** — edit names, descriptions, reorder, add, or remove phases, then approve
- **Reject** — agent continues without splitting (rare — admin would provide a reason)

```typescript
interface SplitResponse {
  decision: 'approved' | 'rejected';

  /**
   * The final phases to create (after admin edits).
   * Only present when decision is 'approved'.
   * May differ from the agent's proposal if the admin modified them.
   */
  phases?: {
    name: string;
    description: string;
  }[];

  /** Reason for rejection (agent receives this as context). */
  reason?: string;
}
```

### Pipeline Flow

```
┌─────────────────┐     outcome: propose_split    ┌─────────────────┐
│  Agent running   │ ──────────────────────────→   │  Pending split   │
│  (planning)      │                               │  (pending_split) │
└─────────────────┘                                └────────┬────────┘
                                                            │
                                               Admin reviews proposed phases
                                               Admin modifies / approves / rejects
                                                            │
                                               ┌────────────┴────────────┐
                                               │                         │
                                               ▼                         ▼
                                     ┌─────────────────┐     ┌─────────────────┐
                                     │  Approved        │     │  Rejected        │
                                     │                  │     │  Agent resumes   │
                                     └────────┬────────┘     │  without split   │
                                              │               └─────────────────┘
                                              │
                                   System creates phases
                                   from admin-approved list
                                              │
                                              ▼
                                   ┌─────────────────┐
                                   │  Task now has    │
                                   │  phases, continues│
                                   │  with phase 1    │
                                   └─────────────────┘
```

### Pipeline Hook: `execute_split`

When the admin approves a split, the `execute_split` hook runs:

```typescript
// In SplitHandler (a pipeline handler)
async executeSplit(task: Task, transition: PipelineTransition, ctx: PipelineContext): Promise<void> {
  const response = ctx.payload as SplitResponse;
  if (response.decision !== 'approved' || !response.phases) return;

  // Create phases from the approved list
  for (let i = 0; i < response.phases.length; i++) {
    await this.taskStore.createPhase({
      taskId: task.id,
      name: response.phases[i].name,
      description: response.phases[i].description,
      sortOrder: i,
    });
  }

  // Create the task integration branch (multi-phase branching strategy)
  await this.gitOps.createBranch(projectPath, taskBranchName, 'main');
  await this.taskStore.addArtifact(task.id, {
    type: 'branch',
    label: taskBranchName,
    metadata: { branchName: taskBranchName, baseBranch: 'main' },
    createdBy: 'system',
  });
}
```

**Pipeline transitions:**

```json
{
  "from": "planning",
  "to": "pending_split",
  "trigger": "agent_outcome",
  "outcomeValue": "propose_split"
}
```

```json
{
  "from": "pending_split",
  "to": "planned",
  "trigger": "prompt_response",
  "guards": [{ "type": "split_approved" }],
  "hooks": [{ "type": "execute_split" }]
}
```

```json
{
  "from": "pending_split",
  "to": "planning",
  "trigger": "prompt_response",
  "guards": [{ "type": "split_rejected" }],
  "hooks": [{ "type": "start_agent", "params": { "mode": "plan" } }]
}
```

### UI for Split Proposal

The task detail page shows the proposed split in an editable form:

```
┌──────────────────────────────────────────────────────┐
│ Agent proposes splitting this task into phases        │
│                                                      │
│ Reason: "This feature requires backend API changes,  │
│ frontend UI work, and integration tests. Each should │
│ be a separate PR for reviewability."                 │
│                                                      │
│ Proposed phases:                                     │
│                                                      │
│ 1. [Backend API         ] [medium ▾]                │
│    [Add auth endpoints and middleware    ]            │
│                                                      │
│ 2. [Frontend UI         ] [medium ▾]                │
│    [Add login page and auth context      ]           │
│                                                      │
│ 3. [Integration Tests   ] [low    ▾]                │
│    [E2E tests for auth flow              ]           │
│                                                      │
│ [+ Add Phase]                                        │
│                                                      │
│ [ Approve Phases ]  [ Reject & Continue Without ]    │
└──────────────────────────────────────────────────────┘
```

---

## Unified Pause/Resume Mechanism

All three flows use the same underlying mechanism. This is what the pipeline engine actually implements:

### Pending Prompt

When an agent pauses for any reason, a **pending prompt** is created:

```typescript
interface PendingPrompt {
  id: string;
  taskId: string;
  agentRunId: string;

  /**
   * Prompt type — determines UI rendering and response schema.
   */
  type: 'info_request' | 'review' | 'document_review' | 'split_proposal';

  /**
   * The payload from the agent. Shape varies by type.
   */
  payload: NeedsInfoPayload | ReviewPayload | DocumentReviewPayload | ProposeSplitPayload;

  /** Current state. */
  status: 'pending' | 'responded' | 'expired';

  /** Admin's response. Null until responded. */
  response?: InfoResponse | ReviewPayload | DocumentReviewPayload | SplitResponse;

  createdAt: string;
  respondedAt?: string;
}
```

### Database Table

```sql
CREATE TABLE IF NOT EXISTS pending_prompts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL,
  type TEXT NOT NULL,             -- 'info_request', 'review', 'document_review', 'split_proposal'
  payload TEXT NOT NULL,          -- JSON
  status TEXT NOT NULL DEFAULT 'pending',
  response TEXT,                  -- JSON, null until responded
  created_at TEXT NOT NULL,
  responded_at TEXT
);

CREATE INDEX idx_pending_prompts_task ON pending_prompts(task_id);
CREATE INDEX idx_pending_prompts_status ON pending_prompts(status);
```

### Lifecycle

```
1. Agent emits outcome (needs_info / pr_ready / propose_split)
2. Pipeline engine creates PendingPrompt with payload
3. Task transitions to waiting state (needs_info / pr_review / pending_split)
4. Notification sent to all channels
5. Admin responds via any UI (app, CLI, Telegram, Slack)
6. WorkflowService.respondToPrompt(promptId, response) called
7. PendingPrompt updated: status → 'responded', response stored
8. Response stored in task event log
9. Pipeline transition triggered (waiting → active)
10. Agent resumes with full context including the response
```

### WorkflowService Methods

```typescript
interface IWorkflowService {
  // ... existing methods ...

  /** Get all pending prompts for a task. */
  getPendingPrompts(taskId: string): Promise<PendingPrompt[]>;

  /** Get a specific pending prompt. */
  getPendingPrompt(promptId: string): Promise<PendingPrompt | null>;

  /** Respond to a pending prompt. Triggers pipeline transition. */
  respondToPrompt(promptId: string, response: PromptResponse): Promise<void>;

  /** Submit a review (code or document). Creates the prompt response. */
  submitReview(taskId: string, review: ReviewPayload): Promise<void>;

  /** Respond to a split proposal. */
  respondToSplit(promptId: string, response: SplitResponse): Promise<void>;
}
```

### Event Log Entries

Every pause/resume interaction is recorded in the task event log:

| Event Type | When | Payload |
|-----------|------|---------|
| `prompt_created` | Agent emits outcome that creates a prompt | `{ promptId, type, question/options/phases }` |
| `prompt_response` | Admin responds to a prompt | `{ promptId, response, respondedVia: 'app'/'cli'/'telegram' }` |
| `review_submitted` | Admin submits a code or document review | `{ decision, comment, artifactId? }` |
| `split_approved` | Admin approves a task split | `{ phases: [...] }` |
| `split_rejected` | Admin rejects a task split | `{ reason }` |

---

## Notification Channel Rendering

Each notification channel renders prompts differently based on the prompt type:

### Desktop Notification

```
"Agent needs input: Add authentication"
Click to open task in the app.
```

Simple alert — directs admin to the app for the full UI.

### Telegram / Slack

Rich inline rendering with action buttons:

**Info request:**
```
🤖 Agent needs input on "Add authentication"

Which auth strategy should I use?

→ JWT tokens (recommended)
  Stateless, works with mobile clients

→ Session-based
  Server-side sessions, simpler but stateful

[JWT tokens] [Session-based] [Custom answer...]
```

**Review:**
```
🤖 PR ready for review: "Add authentication" (#41)
  +142 -23 across 5 files

[Approve] [Request Changes]
```

**Split proposal:**
```
🤖 Agent proposes splitting "Add authentication"

1. Backend API (medium)
2. Frontend UI (medium)
3. Integration Tests (low)

[Approve Split] [Reject]
```

Admin taps a button → response flows through the WorkflowService → agent resumes. Full bidirectional interaction without opening the app.

---

## Architecture Implications

These features require the following to be in place in the architecture:

### Already Accounted For

| Component | What It Provides |
|-----------|-----------------|
| **Pipeline outcome schemas** | Agent outcomes carry typed payloads (`needs_info`, `pr_ready`, `propose_split`) |
| **Pipeline guards** | `has_payload_response`, `review_approved`, `review_changes_requested`, `split_approved` |
| **Pipeline hooks** | `start_agent` (resume), `merge_pr`, `execute_split`, `notify` |
| **Task event log** | Records all prompt/response interactions, fed into agent context |
| **AgentContextBuilder** | Assembles full context including prompt history, review comments, PR comments |
| **Pending prompts table** | Stores the prompt and response as structured data |
| **Notification system** | Bidirectional — admin can respond from any channel |
| **Artifact system** | PRs and documents are artifacts that reviews target |
| **Task phases** | Created by `execute_split` hook when admin approves a split |
| **IScmPlatform** | `getPRComments()` for fetching GitHub review comments |

### Guards and Hooks Registry

New guards and hooks needed (registered by pipeline handlers):

**Guards:**

| Guard | Type | Checks |
|-------|------|--------|
| Review approved | `review_approved` | Latest review event has `decision: 'approved'` |
| Changes requested | `review_changes_requested` | Latest review event has `decision: 'changes_requested'` |
| Split approved | `split_approved` | Split prompt response has `decision: 'approved'` |
| Split rejected | `split_rejected` | Split prompt response has `decision: 'rejected'` |

**Hooks:**

| Hook | Type | Action |
|------|------|--------|
| Execute split | `execute_split` | Creates phases from approved split response, creates task branch |

### Pipeline Statuses

These features introduce new statuses that pipelines can use:

| Status | Category | When |
|--------|----------|------|
| `needs_info` | `waiting` | Agent asked a question, waiting for admin response |
| `pr_review` | `review` | Agent submitted a PR, waiting for review |
| `changes_requested` | `active` | Admin requested changes, agent will re-run |
| `pending_split` | `waiting` | Agent proposed splitting, waiting for admin decision |

These are not hardcoded — they're defined in the pipeline JSON. Simple pipelines don't include them. The full "Feature" pipeline includes all of them.

### Built-In Pipeline: Feature (with all flows)

```
open → planning → planned → in_progress → pr_review → done
                     ↑            │              │
                     │            ▼              ▼
                     │      needs_info    changes_requested
                     │            │              │
                     │            ▼              │
                     │      (admin responds)     │
                     │            │              │
                     │            ▼              ▼
                     │      in_progress ←────────┘
                     │
                     └──── pending_split
                              │
                              ▼
                        (admin approves)
                              │
                              ▼
                           planned (now with phases)
```

### Summary of Open Questions Resolved

| Question | Answer |
|----------|--------|
| Where do review comments live? | **Two sources:** GitHub PR comments (fetched via `IScmPlatform`) and in-app review comments (stored in task event log). Both are assembled into agent context by `AgentContextBuilder`. |
| Is a document review a PR? | **No.** Code review = GitHub PR. Document review = in-app review on the artifact. Same approve/request-changes flow, different target. Documents only become PRs if the team commits them to the repo. |
| How does the agent receive feedback? | **Via `AgentContextBuilder`**. When the agent resumes, it receives the full context: original task, plan, previous transcript, the question it asked, the admin's response, review comments (from GitHub and in-app), and all artifacts. |
| How does "request info" differ from "suggest options"? | **It doesn't in the pipeline.** Same `needs_info` outcome, same `PendingPrompt`, same response mechanism. The payload content differs (questions have text, options have a list), and the UI renders them differently, but the pipeline is identical. |
| Can the admin respond from Telegram? | **Yes.** All three UIs (app, CLI, Telegram/Slack) call the same `WorkflowService.respondToPrompt()` method. Notification channels render prompts with inline buttons for quick responses. |
| What prevents infinite review loops? | **`max_iterations` guard.** Configured per pipeline. After N cycles of changes_requested → in_progress → pr_review, the transition is blocked. Admin must handle manually. |
| How does task splitting create phases? | **`execute_split` pipeline hook.** Reads the admin-approved phase list from the prompt response, calls `taskStore.createPhase()` for each one, creates the task integration branch. |
