# Outcome Schemas & Payloads

Agents return named outcomes with optional structured payloads. This document defines the outcome schema registry, payload types, validation, and human-in-the-loop workflow patterns.

See also: [engine.md](engine.md) | [json-contract.md](json-contract.md) | [event-log.md](event-log.md) | [errors.md](errors.md) | [ui.md](ui.md)

---

## Transition Payloads

Transitions don't just move a task from A to B - they carry **structured data**. When an agent needs more information, it doesn't just set status to "needs_info" - it attaches the specific questions it has. When an agent proposes options, the options are attached to the transition. The UI reads this data to render the right experience.

### Payload on Transitions

```typescript
interface TransitionContext {
  triggeredBy: 'user' | 'agent' | 'system';
  agentRunId?: string;
  reason?: string;

  // Structured payload - the key addition
  payload?: TransitionPayload;
}

// The payload type depends on what the transition needs
type TransitionPayload =
  | NeedsInfoPayload
  | OptionsProposedPayload
  | ChangesRequestedPayload
  | InfoProvidedPayload
  | OptionSelectedPayload
  | ReviewApprovedPayload
  | GenericPayload;

interface NeedsInfoPayload {
  type: 'needs_info';
  questions: {
    id: string;
    question: string;
    context?: string;       // why the agent needs this
    suggestedAnswer?: string; // agent's best guess
  }[];
}

interface OptionsProposedPayload {
  type: 'options_proposed';
  description: string;         // what decision needs to be made
  options: {
    id: string;
    title: string;
    description: string;      // markdown explanation of approach
    pros?: string[];
    cons?: string[];
    estimatedEffort?: string; // 'small', 'medium', 'large'
  }[];
  agentRecommendation?: string; // id of the recommended option
}

interface ChangesRequestedPayload {
  type: 'changes_requested';
  comments: {
    id: string;
    file?: string;           // file path if applicable
    line?: number;           // line number if applicable
    comment: string;         // the change request
    severity: 'must_fix' | 'should_fix' | 'suggestion';
  }[];
  summary: string;           // overall review summary
}

interface InfoProvidedPayload {
  type: 'info_provided';
  answers: {
    questionId: string;      // references NeedsInfoPayload.questions[].id
    answer: string;
  }[];
}

interface OptionSelectedPayload {
  type: 'option_selected';
  selectedOptionId: string;    // references OptionsProposedPayload.options[].id
  customInstructions?: string; // additional notes from admin
}

interface ReviewApprovedPayload {
  type: 'review_approved';
  comments?: string;           // optional approval notes
}

interface GenericPayload {
  type: 'generic';
  data: Record<string, any>;
}
```

### Payloads Are Stored on Transition History

Every transition that carries a payload stores it. This means you can always look back and see:
- What questions the agent asked
- What options were proposed
- What the admin chose and why
- What changes were requested

```typescript
interface TransitionHistoryEntry {
  id: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  triggeredBy: 'user' | 'agent' | 'system';
  agentRunId?: string;
  reason?: string;
  payload?: TransitionPayload;    // <-- stored here
  guardsChecked: GuardResult[];
  hooksExecuted: HookResult[];
  timestamp: string;
}
```

### Current Payload on Task

The task itself holds the **latest pending payload** so the UI knows what to render:

```typescript
interface Task {
  // ... existing fields ...

  // The current pending payload (set when entering a 'waiting' status)
  pendingPayload?: TransitionPayload;
}
```

When a task enters `needs_info`, `pendingPayload` is set to the `NeedsInfoPayload`. The UI sees this and renders the questions form. When the admin answers and the task transitions out, `pendingPayload` is cleared.

### UI Rendering by Payload Type

The task detail page checks `task.pendingPayload` and renders the appropriate UI:

```typescript
function TaskWaitingPanel({ task }: Props) {
  if (!task.pendingPayload) return null;

  switch (task.pendingPayload.type) {
    case 'needs_info':
      return <NeedsInfoForm payload={task.pendingPayload} taskId={task.id} />;
    case 'options_proposed':
      return <OptionsPicker payload={task.pendingPayload} taskId={task.id} />;
    case 'changes_requested':
      return <ChangesReviewPanel payload={task.pendingPayload} taskId={task.id} />;
    default:
      return null;
  }
}
```

**NeedsInfoForm:**
```
┌─────────────────────────────────────────────────────┐
│ ⚠ Agent needs more information                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Q1: What authentication provider should be used?     │
│     Context: "The task says 'add auth' but doesn't   │
│     specify OAuth, JWT, or session-based"            │
│     Suggested: "JWT with refresh tokens"             │
│     Your answer: [________________________]          │
│                                                      │
│ Q2: Should the login page support social login?      │
│     Your answer: [________________________]          │
│                                                      │
│ [Submit Answers & Resume]                            │
└─────────────────────────────────────────────────────┘
```

**OptionsPicker:**
```
┌─────────────────────────────────────────────────────┐
│ 🔀 Agent proposes implementation approaches          │
│                                                      │
│ "How should we structure the data layer?"            │
├─────────────────────────────────────────────────────┤
│                                                      │
│ ● Option A: Repository Pattern ⭐ Recommended        │
│   Use a repository layer to abstract DB access.      │
│   Pros: testable, swappable                          │
│   Cons: more boilerplate                             │
│   Effort: Medium                                     │
│                                                      │
│ ○ Option B: Direct ORM Calls                         │
│   Use the ORM directly in services.                  │
│   Pros: simple, less code                            │
│   Cons: harder to test, coupled                      │
│   Effort: Small                                      │
│                                                      │
│ ○ Option C: Custom Approach                          │
│   [Describe your approach: _______________]          │
│                                                      │
│ Additional instructions: [________________________]  │
│                                                      │
│ [Select & Continue]                                  │
└─────────────────────────────────────────────────────┘
```

**ChangesReviewPanel:**
```
┌─────────────────────────────────────────────────────┐
│ 📝 Changes Requested on Implementation               │
│                                                      │
│ Summary: "Good progress, but auth middleware needs    │
│ error handling and tests are missing"                │
├─────────────────────────────────────────────────────┤
│                                                      │
│ 🔴 Must Fix:                                         │
│   src/middleware/auth.ts:42                           │
│   "Missing try-catch around token verification.      │
│    If jwt.verify throws, the server crashes."         │
│                                                      │
│ 🟡 Should Fix:                                       │
│   src/routes/login.ts:15                             │
│   "Rate limiting should be added to prevent           │
│    brute force attacks."                             │
│                                                      │
│ 💡 Suggestion:                                       │
│   src/types/user.ts:8                                │
│   "Consider making email a branded type for safety." │
│                                                      │
│ Additional comments: [________________________]      │
│                                                      │
│ [Send Back for Rework]  [Approve Anyway]             │
└─────────────────────────────────────────────────────┘
```

---

### Outcome Schema Registry

Every outcome name maps to a payload schema. This is the **single source of truth** for what data each outcome carries — imported by the engine (validation), agent adapters (structured output), and UI (rendering).

Lives in `src/main/handlers/outcome-schemas.ts`.

```typescript
import Ajv from 'ajv';

const ajv = new Ajv();

// === Schema Definitions ===

export const OUTCOME_SCHEMAS: Record<string, OutcomeDefinition> = {

  // --- Outcomes WITH required payloads ---

  'needs_info': {
    description: 'Agent needs more information to proceed',
    schema: {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'question'],
            properties: {
              id:        { type: 'string' },
              question:  { type: 'string' },
              context:   { type: 'string' },
              inputType: { type: 'string', enum: ['text', 'choice', 'boolean'], default: 'text' },
              options:   { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },

  'options_proposed': {
    description: 'Agent proposes options for admin to choose from',
    schema: {
      type: 'object',
      required: ['summary', 'options'],
      properties: {
        summary: { type: 'string' },
        options: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            required: ['id', 'label', 'description'],
            properties: {
              id:          { type: 'string' },
              label:       { type: 'string' },
              description: { type: 'string' },
              tradeoffs:   { type: 'string' },
              recommended: { type: 'boolean' },
            },
          },
        },
      },
    },
  },

  'changes_requested': {
    description: 'Review agent found issues that need fixing',
    schema: {
      type: 'object',
      required: ['summary', 'comments'],
      properties: {
        summary: { type: 'string' },
        comments: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['comment', 'severity'],
            properties: {
              file:     { type: 'string' },
              line:     { type: 'number' },
              severity: { type: 'string', enum: ['critical', 'suggestion', 'nit'] },
              comment:  { type: 'string' },
            },
          },
        },
      },
    },
  },

  // --- Outcomes WITHOUT payloads (signal-only) ---

  'plan_complete':    { description: 'Planning finished successfully',  schema: null },
  'pr_ready':         { description: 'Implementation done, PR created', schema: null },
  'approved':         { description: 'Review passed, no issues found',  schema: null },
  'design_ready':     { description: 'UX design completed',            schema: null },
  'reproduced':       { description: 'Bug successfully reproduced',    schema: null },
  'cannot_reproduce': { description: 'Bug could not be reproduced',    schema: null },
};

// === Agent Error (always the same shape, not an outcome) ===

export const AGENT_ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error:      { type: 'string' },
    stackTrace: { type: 'string' },
    lastAction: { type: 'string' },
  },
};

// === Types ===

interface OutcomeDefinition {
  description: string;
  schema: object | null;  // null = no payload expected
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// === Validation ===

export function validateOutcomePayload(outcome: string, payload: unknown): ValidationResult {
  const definition = OUTCOME_SCHEMAS[outcome];

  if (!definition) {
    return { valid: false, error: `Unknown outcome: "${outcome}"` };
  }

  if (!definition.schema) {
    // Signal-only outcome — no payload expected
    return { valid: true };
  }

  if (!payload) {
    return { valid: false, error: `Outcome "${outcome}" requires a payload` };
  }

  const validate = ajv.compile(definition.schema);
  if (validate(payload)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Invalid payload for "${outcome}": ${ajv.errorsText(validate.errors)}`,
  };
}
```

#### Who Imports This

| Consumer | What It Uses | Why |
|----------|-------------|-----|
| **Pipeline Engine** | `validateOutcomePayload()` | Validates payload before executing transition |
| **Agent Adapters** | `OUTCOME_SCHEMAS[outcome].schema` | Passes schema to agent as structured output format |
| **AgentContextBuilder** | `OUTCOME_SCHEMAS` | Lists possible outcomes + schemas in agent prompt |
| **UI Components** | `OUTCOME_SCHEMAS[outcome]` | Knows what form to render for each outcome |

#### Validation Flow

```
Agent finishes with outcome + payload
  → AgentAdapter parses structured output → { outcome: "needs_info", payload: {...} }
  → Engine matches trigger: { type: "agent_outcome", outcome: "needs_info" }
  → Engine calls validateOutcomePayload("needs_info", payload)
      → Looks up OUTCOME_SCHEMAS["needs_info"]
      → Schema exists → validates payload against JSON Schema
      → Invalid? → treat as agent_error (bad output, not a valid outcome)
      → Valid? → execute transition, store payload on task
  → UI reads payload → renders NeedsInfoForm
```

#### Agent Prompt Assembly

The `AgentContextBuilder` reads `OUTCOME_SCHEMAS` to tell agents what outcomes are available and what data shape each expects:

```typescript
// In AgentContextBuilder:
const possibleOutcomes = this.getOutcomesForCurrentStatus(task.status, pipeline);
// → ["pr_ready", "needs_info", "changes_requested"]

// Build prompt section:
// "When you finish, return one of these outcomes:
//  - outcome: "pr_ready" (no payload needed)
//  - outcome: "needs_info" with payload: { questions: [{ id, question, context?, inputType?, options? }] }
//  - outcome: "changes_requested" with payload: { summary, comments: [{ file?, line?, severity, comment }] }"
```

### How Agents Produce Payloads

Agents use **structured output** (a standard feature in agent frameworks) to return their outcome and payload. The agent adapter parses the output:

```typescript
// Agent output includes structured markers that the adapter parses:
// "I need more information before I can proceed.
//  <<<OUTCOME:needs_info>>>
//  { "questions": [{ "id": "q1", "question": "What auth provider?", ... }] }
//  <<<END_PAYLOAD>>>"
//
// The adapter extracts this, validates against OUTCOME_SCHEMAS["needs_info"],
// and returns it as part of AgentRunResult.

interface AgentRunResult {
  transcript: AgentMessage[];
  tokenUsage?: TokenUsage;
  exitCode: number;
  outcome?: string;              // <-- named outcome from OUTCOME_SCHEMAS (only when exitCode === 0)
  payload?: TransitionPayload;   // <-- validated against OUTCOME_SCHEMAS[outcome].schema
  error?: string;                // <-- error message when exitCode !== 0
}
```

The `AgentService.onAgentCompleted()` passes the validated payload to the pipeline engine when triggering the transition.

---

## Human-in-the-Loop Workflows

These are the complex workflow patterns where the pipeline pauses for human input.

### Pattern 1: Agent Needs More Information

```
Planning → [agent discovers missing info] → Needs Info → [admin answers] → Planning
```

**Pipeline definition:**
```json
{
  "statuses": [
    { "id": "needs_info", "label": "Needs Info", "color": "#f59e0b", "category": "waiting", "position": 2 }
  ],
  "transitions": [
    {
      "id": "t_needs_info",
      "from": "planning",
      "to": "needs_info",
      "label": "Needs Info",
      "trigger": { "type": "agent_outcome", "outcome": "needs_info" }
      // NOT an error — the agent ran successfully and determined it needs more information
    },
    {
      "id": "t_info_provided",
      "from": "needs_info",
      "to": "planning",
      "label": "Resume Planning",
      "trigger": { "type": "manual" },
      "guards": [{ "type": "has_payload_response", "params": { "payloadType": "needs_info" } }],
      "hooks": [{ "type": "start_agent", "params": { "mode": "plan", "includePayloadContext": true } }]
    }
  ]
}
```

**Flow:**
1. Planning agent encounters missing information
2. Agent returns `NeedsInfoPayload` with questions
3. Pipeline transitions to `needs_info`, stores payload on task
4. UI renders the questions form
5. Admin answers questions → triggers `info_provided` transition
6. `start_agent` hook restarts planning agent with the answers injected into context
7. Agent continues with the new information

**Agent prompt injection for resumed planning:**
```
Previous context: You were planning task "{task.title}" and asked for more information.

Your questions and the admin's answers:
Q: What authentication provider should be used?
A: Use JWT with refresh tokens. No social login needed.

Q: Should the login page support social login?
A: No, email/password only for now.

Continue planning with this information.
```

### Pattern 2: Agent Proposes Options

```
Planning → [agent generates options] → Options Proposed → [admin picks] → Implementation
```

**Pipeline definition:**
```json
{
  "statuses": [
    { "id": "options_proposed", "label": "Options Proposed", "color": "#8b5cf6", "category": "waiting", "position": 3 }
  ],
  "transitions": [
    {
      "id": "t_options",
      "from": "planning",
      "to": "options_proposed",
      "label": "Options Ready",
      "trigger": { "type": "agent_outcome", "outcome": "options_proposed" }
    },
    {
      "id": "t_option_selected",
      "from": "options_proposed",
      "to": "in_progress",
      "label": "Start Implementation",
      "trigger": { "type": "manual" },
      "guards": [{ "type": "has_payload_response", "params": { "payloadType": "options_proposed" } }],
      "hooks": [{ "type": "start_agent", "params": { "mode": "implement", "includePayloadContext": true } }]
    }
  ]
}
```

**Agent prompt injection for implementation:**
```
Task: "{task.title}"

The admin reviewed your proposed approaches and selected:
  Option A: Repository Pattern
  "Use a repository layer to abstract DB access."

Additional instructions from admin: "Make sure to include interfaces for easy testing."

Implement the task using this approach.
```

### Pattern 3: Admin Reviews and Requests Changes

```
PR Review → [reviewer finds issues] → Changes Requested → [admin adds comments] → Implementation
```

This already exists in the standard pipeline, but with payloads it becomes richer:

**Flow:**
1. PR review agent finds issues
2. Returns `ChangesRequestedPayload` with specific file/line comments
3. Task moves to `changes_requested`, admin sees the review
4. Admin can:
   a. Add their own comments on top
   b. Agree and send back for rework
   c. Override and approve anyway
5. If sent back, implementation agent gets the review comments as context

### Pattern 4: Multi-Round Review (Back and Forth)

Changes requested → implementation → review can happen **multiple times**. The pipeline supports this natively because transitions are edges in a graph - loops are just cycles.

```
Implementation → PR Review → Changes Requested → Implementation → PR Review → Changes Requested → Implementation → PR Review → Approved → Done
```

Each round is tracked in the event log. You can see:
- How many review rounds happened (count `transition` events with `to: 'pr_review'`)
- What was requested in each round (each `ChangesRequestedPayload` stored on its transition)
- What the agent changed in each iteration (agent `tool_use` events per round)
- How the review comments evolved over iterations

**Iteration-aware agent prompts:**

When the implementation agent is restarted after changes requested, the prompt includes ALL previous review rounds so it doesn't repeat the same mistakes:

```
Task: "{task.title}"

This is review iteration #3. Previous review feedback:

Round 1 (Changes Requested):
- [Must Fix] src/middleware/auth.ts:42 - Missing try-catch around token verification
- [Must Fix] src/routes/login.ts:15 - Add rate limiting

Round 2 (Changes Requested):
- [Must Fix] src/middleware/auth.ts:55 - Rate limiting is per-route, should be global
- [Suggestion] Consider adding request ID to error logs

Address the remaining issues from the latest review.
```

**Loop protection:**

To prevent infinite loops (agent keeps failing review), add a guard:

```typescript
'max_iterations': async (task, ctx, params) => {
  const maxLoops = params.max || 5;
  const history = await ctx.eventLog.list(task.id, {
    category: ['transition'],
    type: ['status.changed'],
  });
  // Count how many times we've entered this status
  const entryCount = history.filter(e => e.data?.to === params.statusId).length;
  return entryCount < maxLoops;
},
```

Pipeline definition:
```json
{
  "from": "changes_requested",
  "to": "in_progress",
  "label": "Rework",
  "guards": [{ "type": "max_iterations", "params": { "statusId": "in_progress", "max": 5 } }]
}
```

If the loop hits the max, the guard blocks and the task shows: "Maximum review iterations (5) reached. Manual intervention required." This prevents runaway costs.

### "Waiting" Status Behavior

All statuses with `category: 'waiting'` share common behavior:

1. **Must have a pending payload** - can't enter a waiting status without one
2. **Show special UI** - the task detail page renders the appropriate form based on payload type
3. **Guard on exit** - the transition out requires the human to have responded (guard: `has_payload_response`)
4. **Resume context** - when the pipeline continues, the payload response is injected into the agent's prompt via `includePayloadContext: true` on the hook
5. **Kanban visual** - waiting statuses show a distinct visual treatment (amber/yellow, pulsing dot, notification badge)

### New Guards for Human-in-the-Loop

```typescript
// Guard: check that the human has provided a response to the pending payload
'has_payload_response': async (task, ctx) => {
  if (!task.pendingPayload) return false;

  switch (task.pendingPayload.type) {
    case 'needs_info':
      // All questions must be answered
      const answers = ctx.transitionPayload as InfoProvidedPayload;
      return answers?.answers?.length === task.pendingPayload.questions.length;

    case 'options_proposed':
      // An option must be selected
      const selection = ctx.transitionPayload as OptionSelectedPayload;
      return !!selection?.selectedOptionId;

    case 'changes_requested':
      // Just needs acknowledgment (send back or approve)
      return true;

    default:
      return true;
  }
},
```

### New Hooks for Human-in-the-Loop

```typescript
// Hook: inject payload context into agent prompt
'inject_payload_context': async (task, transition, ctx, params) => {
  // This hook doesn't start an agent directly - it prepares context
  // that the 'start_agent' hook will use

  const history = await ctx.eventLog.list(task.id, {
    category: ['payload'],
    limit: 10,
  });

  // Build context string from payload history
  const context = buildPayloadContext(history);

  // Store on task for the agent to pick up
  await ctx.taskStore.updateTask(task.id, {
    agentContext: context,  // new field: extra context for next agent run
  });
},
```
