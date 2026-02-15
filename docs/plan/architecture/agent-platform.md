# Agent Platform

The full lifecycle of running an AI coding agent on a task — from environment setup through execution to artifact collection. This is the core "engine room" that the pipeline hooks call into.

See also: [overview.md](overview.md) | [pipeline/engine.md](pipeline/engine.md) | [pipeline/outcome-schemas.md](pipeline/outcome-schemas.md) | [workflow-service.md](workflow-service.md)

---

## Overview

When the pipeline fires a `start_agent` hook, here's everything that happens:

```
Pipeline hook: start_agent({ mode: "implement", agentType: "claude-code" })
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. PREPARE ENVIRONMENT                                           │
│    Create/reuse worktree → pull latest from base branch →        │
│    ensure clean state → lock worktree                            │
├──────────────────────────────────────────────────────────────────┤
│ 2. ASSEMBLE CONTEXT                                              │
│    Task metadata + plan + event history + payload responses →    │
│    structured prompt with outcome instructions                   │
├──────────────────────────────────────────────────────────────────┤
│ 3. CONFIGURE AGENT                                               │
│    Resolve agent type → load config → set model, max turns,     │
│    timeout → prepare structured output schema                    │
├──────────────────────────────────────────────────────────────────┤
│ 4. EXECUTE AGENT                                                 │
│    Spawn process → stream output to UI → track tokens →          │
│    log tool_use events                                           │
├──────────────────────────────────────────────────────────────────┤
│ 5. MONITOR EXECUTION                                             │
│    Timeout watchdog → cancellation listener → health checks →    │
│    supervisor integration                                        │
├──────────────────────────────────────────────────────────────────┤
│ 6. PARSE OUTPUT                                                  │
│    Extract outcome name + payload from agent's structured        │
│    output markers                                                │
├──────────────────────────────────────────────────────────────────┤
│ 7. VALIDATE OUTPUT                                               │
│    Outcome against OUTCOME_SCHEMAS → project-level checks →     │
│    decide: valid outcome or agent_error                          │
├──────────────────────────────────────────────────────────────────┤
│ 8. COLLECT ARTIFACTS                                             │
│    Detect new commits → detect PR creation → store branch,      │
│    PR, commit artifacts on task → store plan if plan mode        │
├──────────────────────────────────────────────────────────────────┤
│ 9. TRIGGER PIPELINE                                              │
│    Pass outcome + payload to pipeline engine →                   │
│    auto-transition if single valid target                        │
├──────────────────────────────────────────────────────────────────┤
│ 10. CLEANUP                                                      │
│     Unlock worktree → record cost → log completion event →       │
│     send notification                                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Prepare Environment

Every agent runs in an **isolated git worktree** — never in the main repo working directory. This allows multiple agents on different tasks in the same project to run simultaneously without conflicts.

### Worktree Lifecycle

```typescript
// Called by AgentHandler when start_agent hook fires
async function prepareEnvironment(
  project: Project,
  task: Task,
  config: AgentConfig,
): Promise<AgentEnvironment> {
  const branchName = resolveBranchName(task, config);
  // e.g., "agent/task-abc-123" or custom prefix

  // 1. Create or reuse worktree
  let worktree = await worktreeManager.get(project.path, task.id);

  if (!worktree) {
    worktree = await worktreeManager.create(project.path, {
      branchName,
      baseBranch: config.baseBranch || 'main',
      createBranch: true,
      taskId: task.id,
    });
  }

  // 2. Ensure clean state — pull latest from base, reset if dirty
  await syncWorktree(worktree, config);

  // 3. Lock worktree (prevents cleanup while agent runs)
  await worktreeManager.lock(worktree.path, `agent run for task ${task.id}`);

  // 4. Install dependencies if needed
  if (config.installDeps !== false) {
    await runProjectSetup(worktree.path, project);
  }

  return {
    worktreePath: worktree.path,
    branchName,
    worktree,
  };
}
```

### Sync Strategy

When reusing an existing worktree (e.g., after a failed run or review loop), the worktree needs to be in a clean, up-to-date state:

```typescript
async function syncWorktree(worktree: Worktree, config: AgentConfig): Promise<void> {
  const repoPath = worktree.path;

  // Pull latest changes from remote (if the branch has a remote)
  try {
    await gitOps.pull(repoPath, worktree.branch);
  } catch {
    // Branch may not have a remote yet — that's fine
  }

  // If the worktree is dirty from a previous failed run, stash or reset
  const status = await gitOps.getStatus(repoPath);
  if (!status.clean) {
    if (config.preserveUncommitted) {
      // Stash uncommitted changes (recoverable)
      await gitOps.exec(repoPath, ['stash', 'push', '-m', 'agent-platform: pre-run stash']);
    } else {
      // Hard reset to branch head (previous agent's uncommitted work is lost)
      await gitOps.exec(repoPath, ['reset', '--hard', 'HEAD']);
      await gitOps.exec(repoPath, ['clean', '-fd']);
    }
  }

  // Optionally rebase on latest base branch
  if (config.rebaseOnStart) {
    await gitOps.exec(repoPath, ['rebase', config.baseBranch || 'main']);
  }
}
```

### Branch Naming

```typescript
function resolveBranchName(task: Task, config: AgentConfig, artifacts: TaskArtifact[]): string {
  // If task already has a branch artifact, reuse it
  const branchArtifact = artifacts.find(a => a.type === 'branch');
  if (branchArtifact) return branchArtifact.metadata.branchName;

  // Otherwise, generate from config
  const prefix = config.branchPrefix || 'agent/';
  const slug = slugify(task.title, { lower: true, strict: true }).slice(0, 40);
  return `${prefix}${slug}-${task.id.slice(0, 8)}`;
  // e.g., "agent/add-authentication-middleware-abc12345"
}
```

### What Gets Added to `.gitignore`

On first worktree creation, add to the project's `.gitignore`:

```
# Agent worktrees (managed by agents-manager)
.agent-worktrees/
```

---

## Step 2: Assemble Context

The `AgentContextBuilder` constructs the full prompt from multiple sources. This is the agent's "memory" — it includes everything the agent needs to understand what to do, what happened before, and what structured output to return.

### Context Sources (in order)

```typescript
class AgentContextBuilder {
  async build(
    task: Task,
    mode: AgentRunMode,
    pipeline: PipelineDefinition,
    config: AgentConfig,
  ): Promise<AgentPrompt> {
    const sections: PromptSection[] = [];

    // 1. System instructions (mode-specific)
    sections.push(this.buildSystemInstructions(mode, config));

    // 2. Task metadata
    sections.push(this.buildTaskContext(task));

    // 3. Implementation plan (if exists)
    if (task.plan) {
      sections.push({ heading: 'Implementation Plan', content: task.plan });
    }

    // 4. Task artifacts (branches, PRs, links)
    const artifacts = await this.taskStore.listArtifacts(task.id);
    if (artifacts.length > 0) {
      sections.push(this.buildArtifactsContext(artifacts));
    }

    // 5. Conversation history (payload exchanges — Q&A, selected options, review comments)
    const payloadEvents = await this.eventLog.list(task.id, { category: ['payload'] });
    if (payloadEvents.length > 0) {
      sections.push(this.buildConversationHistory(payloadEvents));
    }

    // 6. Previous agent run summary (what succeeded, what failed, what was tried)
    const agentEvents = await this.eventLog.list(task.id, { category: ['agent'] });
    if (agentEvents.length > 0) {
      sections.push(this.buildPreviousRunSummary(agentEvents));
    }

    // 7. Latest payload response (the input that triggered this resumption)
    if (task.pendingPayload) {
      sections.push(this.buildPayloadResponse(task.pendingPayload));
    }

    // 8. Available outcomes + structured output instructions
    sections.push(this.buildOutcomeInstructions(task.status, pipeline));

    // 9. Project-specific instructions (from project config, e.g., coding standards)
    const projectInstructions = await this.loadProjectInstructions(task.projectId);
    if (projectInstructions) {
      sections.push({ heading: 'Project Instructions', content: projectInstructions });
    }

    return this.assemblePrompt(sections);
  }
}
```

### Mode-Specific System Instructions

Each mode gets a different system prompt that sets the agent's goal and constraints:

```typescript
private buildSystemInstructions(mode: AgentRunMode, config: AgentConfig): PromptSection {
  const modePrompts: Record<AgentRunMode, string> = {
    plan: `You are a technical planner. Analyze this task and create a detailed implementation plan.
DO NOT write any code. Only produce a plan.

The plan should include:
- Files to create/modify
- Key changes in each file
- Order of implementation
- Potential risks or edge cases
- Estimated complexity per step

Output the plan in markdown format.`,

    implement: `You are a software engineer. Implement this task by writing code.
- Create and modify files as needed
- Follow the project's existing patterns and conventions
- Write tests if the project has a test framework
- Commit your changes with clear commit messages
- If a plan exists, follow it closely`,

    review: `You are a code reviewer. Review the changes in this PR.
- Check for bugs, security issues, and code quality
- Verify the implementation matches the task requirements
- Check test coverage
- Provide specific, actionable feedback
- Rate each issue as: critical, suggestion, or nit`,

    investigate: `You are a bug investigator. Find the root cause of this bug.
- Read the task description and reproduction steps
- Search the codebase for the relevant code paths
- Identify the root cause
- Suggest a fix approach (but do NOT implement it)`,

    design: `You are a technical designer. Create a design document for this feature.
- Analyze the requirements
- Propose architecture and data models
- Identify trade-offs between approaches
- Include diagrams or pseudo-code where helpful`,
  };

  let prompt = modePrompts[mode] || modePrompts.implement;

  // Prepend any custom system prompt from config
  if (config.systemPrompt) {
    prompt = `${config.systemPrompt}\n\n${prompt}`;
  }

  return { heading: 'Instructions', content: prompt };
}
```

### Task Context

```typescript
private buildTaskContext(task: Task): PromptSection {
  return {
    heading: 'Task',
    content: `Title: ${task.title}
Description:
${task.description}

Priority: ${task.priority}
Size: ${task.size}
Complexity: ${task.complexity}
Tags: ${task.tags.join(', ') || 'none'}`,
  };
}
```

### Conversation History (Payload Exchanges)

When an agent resumes after a human-in-the-loop pause, it gets the full Q&A history:

```typescript
private buildConversationHistory(payloadEvents: TaskEvent[]): PromptSection {
  const entries: string[] = [];

  for (const event of payloadEvents) {
    switch (event.type) {
      case 'needs_info.sent':
        entries.push(`Agent asked for information:\n${this.formatQuestions(event.data.questions)}`);
        break;
      case 'info.provided':
        entries.push(`Admin answered:\n${this.formatAnswers(event.data.answers)}`);
        break;
      case 'options.proposed':
        entries.push(`Agent proposed options:\n${this.formatOptions(event.data.options)}`);
        break;
      case 'option.selected':
        entries.push(`Admin selected: ${event.data.selectedOption}\n${event.data.customInstructions || ''}`);
        break;
      case 'changes.requested':
        entries.push(`Review feedback:\n${this.formatReviewComments(event.data.comments)}`);
        break;
    }
  }

  return { heading: 'Previous Conversation', content: entries.join('\n\n') };
}
```

### Outcome Instructions

The agent needs to know what structured outcomes to return. This is built dynamically from the pipeline definition + `OUTCOME_SCHEMAS`:

```typescript
private buildOutcomeInstructions(
  currentStatus: string,
  pipeline: PipelineDefinition,
): PromptSection {
  // Find all transitions FROM the current status triggered by agent_outcome
  const agentTransitions = pipeline.transitions.filter(t =>
    (t.from === currentStatus || t.from === '*') &&
    t.trigger.type === 'agent_outcome'
  );

  // Build outcome list with schemas
  const outcomeList = agentTransitions.map(t => {
    const outcome = t.trigger.outcome;
    const schema = OUTCOME_SCHEMAS[outcome];
    if (!schema) return `- outcome: "${outcome}" (unknown schema)`;

    if (!schema.schema) {
      return `- outcome: "${outcome}" — ${schema.description} (no payload needed)`;
    }

    return `- outcome: "${outcome}" — ${schema.description}
  payload: ${JSON.stringify(schema.schema, null, 2)}`;
  });

  return {
    heading: 'Structured Output',
    content: `When you finish, you MUST return your result using these markers:

<<<OUTCOME:outcome_name>>>
{optional JSON payload matching the schema below}
<<<END_PAYLOAD>>>

Available outcomes from the current status "${currentStatus}":
${outcomeList.join('\n\n')}

If you cannot complete the task, still return an outcome — use "needs_info" if you need more information.
Do NOT exit without returning an outcome.`,
  };
}
```

### Project-Specific Instructions

Projects can have a `.agents-manager/instructions.md` file (or configured via project settings) that gets injected into every agent prompt:

```typescript
private async loadProjectInstructions(projectId: string): Promise<string | null> {
  const project = await this.projectStore.getById(projectId);
  if (!project) return null;

  // Check for project-level instructions file
  const instructionsPath = path.join(project.path, '.agents-manager', 'instructions.md');
  try {
    return await fs.readFile(instructionsPath, 'utf-8');
  } catch {
    return null; // no instructions file — that's fine
  }
}
```

This is where teams can define:
- Coding standards ("always use functional components", "use camelCase")
- Architecture rules ("put API routes in src/routes/", "use the repository pattern")
- Testing requirements ("every new function needs a unit test")
- Forbidden patterns ("never use `any` type", "no inline styles")

---

## Step 3: Configure Agent

### Agent Resolution

The agent type is resolved from the hook params → project default → global default:

```typescript
function resolveAgent(
  hookParams: Record<string, any>,
  project: Project,
  agentFramework: IAgentFramework,
): IAgent {
  const agentType = hookParams.agentType
    || project.config?.defaultAgentType
    || 'claude-code';

  return agentFramework.getAgent(agentType);
}
```

### Config Merge

Agent config is assembled from multiple layers (later overrides earlier). All configuration lives on disk -- there is no `agent_configs` database table.

```
1. Agent hardcoded defaults    (IAgent.getDefaultConfig())
2. Global config file          (~/.agents-manager/config.json → agents section)
3. Project config file         (<project>/.agents-manager/config.json → agents section)
4. Hook params overrides       (e.g., { "model": "claude-opus-4-6" } from pipeline JSON)
5. Per-run overrides           (from UI when user clicks "Run with options...")
```

**Config file format** (`config.json`):

```json
{
  "agents": {
    "claude-code": {
      "model": "claude-sonnet-4-5-20250929",
      "maxTurns": 50,
      "timeout": 600000
    }
  }
}
```

- **Global defaults:** `~/.agents-manager/config.json` -- applies to all projects unless overridden.
- **Per-project overrides:** `<project>/.agents-manager/config.json` -- checked into the repo, shared across the team.

```typescript
function mergeConfig(
  agent: IAgent,
  globalFileConfig: Partial<AgentConfig>,
  projectFileConfig: Partial<AgentConfig>,
  hookParams: Record<string, any>,
  runOverrides?: Partial<AgentConfig>,
): AgentConfig {
  return {
    ...agent.getDefaultConfig(),
    ...globalFileConfig,
    ...projectFileConfig,
    ...pickAgentConfig(hookParams),
    ...runOverrides,
  };
}
```

### Structured Output Schema

For agents that support structured output (like Claude), we pass the outcome schema so the agent knows the exact format:

```typescript
function buildStructuredOutputSchema(
  currentStatus: string,
  pipeline: PipelineDefinition,
): object {
  // Collect all possible outcomes from current status
  const possibleOutcomes = pipeline.transitions
    .filter(t =>
      (t.from === currentStatus || t.from === '*') &&
      t.trigger.type === 'agent_outcome'
    )
    .map(t => t.trigger.outcome);

  // Build a union schema of all possible outcome payloads
  return {
    type: 'object',
    required: ['outcome'],
    properties: {
      outcome: { type: 'string', enum: possibleOutcomes },
      payload: { type: 'object' },  // validated per-outcome after parsing
    },
  };
}
```

---

## Step 4: Execute Agent

### The Run Loop

```typescript
async function executeAgent(
  agent: IAgent,
  env: AgentEnvironment,
  prompt: AgentPrompt,
  config: AgentConfig,
  runId: string,
  callbacks: AgentCallbacks,
): Promise<AgentRunResult> {
  const controller = new AbortController();

  // Register the running agent (for cancellation + supervisor)
  runningAgents.set(runId, { controller, pid: null });

  try {
    const result = await agent.run({
      runId,
      projectPath: env.worktreePath,  // agent works in the worktree, NOT the main repo
      prompt: prompt.fullText,
      config,
      env: getShellEnv(),  // PATH with nvm/fnm/homebrew resolved
      abortSignal: controller.signal,
      onMessage: (message: AgentMessage) => {
        // Stream to UI
        callbacks.onMessage(runId, message);

        // Log tool use events to task event log
        if (message.toolUse) {
          eventLog.log({
            taskId: callbacks.taskId,
            category: 'agent',
            type: 'agent.tool_use',
            summary: `Agent: ${message.toolUse.map(t => `${t.name} ${t.input?.file_path || ''}`).join(', ')}`,
            data: { tools: message.toolUse },
            actor: { type: 'agent', agentRunId: runId },
            level: 'debug',
          });
        }
      },
    });

    return result;

  } finally {
    runningAgents.delete(runId);
  }
}
```

### Streaming to UI

Agent output is streamed to the Electron renderer in real-time via IPC events:

```typescript
// In AgentService
private streamToRenderer(runId: string, message: AgentMessage): void {
  // Broadcast to all windows subscribed to this run
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('agent:output', { runId, message });
  }

  // Also store in running transcript (for late joiners)
  this.transcriptBuffer.get(runId)?.push(message);
}
```

### Process ID Tracking

For the supervisor to check if an agent is still alive:

```typescript
// In ClaudeCodeAgent.run():
const childProcess = spawn('claude', args, { cwd: options.projectPath });

// Report PID back to AgentService
options.onPidAssigned?.(childProcess.pid);
```

The supervisor periodically checks if the PID is still running. If not, the agent is marked as failed.

---

## Step 5: Monitor Execution

### Timeout Watchdog

Each agent run has a configurable timeout. A timer is started when the agent launches:

```typescript
function startTimeoutWatchdog(
  runId: string,
  timeoutMs: number,
  controller: AbortController,
): NodeJS.Timeout {
  return setTimeout(() => {
    console.warn(`Agent run ${runId} timed out after ${timeoutMs}ms`);
    controller.abort('timeout');

    // Force kill if abort doesn't work within 5s
    setTimeout(() => {
      const agent = runningAgents.get(runId);
      if (agent?.pid) {
        killProcessTree(agent.pid);
      }
    }, 5000);
  }, timeoutMs);
}
```

### Cancellation

When the user clicks "Stop":

```typescript
async function cancelAgent(runId: string): Promise<void> {
  const agent = runningAgents.get(runId);
  if (!agent) throw new Error(`No running agent with id ${runId}`);

  // 1. Signal abort (graceful)
  agent.controller.abort('user_cancelled');

  // 2. Wait 5s for graceful shutdown
  await sleep(5000);

  // 3. Force kill if still running
  if (agent.pid && isProcessRunning(agent.pid)) {
    killProcessTree(agent.pid);
  }

  // 4. Update run record
  await agentRunStore.update(runId, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  });

  // 5. Log event
  await eventLog.log({
    taskId: agent.taskId,
    category: 'agent',
    type: 'agent.cancelled',
    summary: 'Agent cancelled by user',
    actor: { type: 'user' },
    level: 'warning',
  });
}
```

### Supervisor Integration

The `TaskSupervisor` (background health loop) handles cases the timeout watchdog can't:

- **App restarted while agent was running** → supervisor detects orphaned `running` records with no live PID
- **Process zombie** → PID exists but not responding → force kill after grace period
- **Retry scheduling** → if agent failed and retries are configured, supervisor handles the delay timer



---

## Step 6: Parse Output

After the agent process exits, we need to extract the structured outcome from its output.

### Output Markers

Agents return their outcome using text markers in their output:

```
I've completed the implementation. All tests pass.

<<<OUTCOME:pr_ready>>>
<<<END_PAYLOAD>>>
```

Or with a payload:

```
I need more information before I can proceed.

<<<OUTCOME:needs_info>>>
{
  "questions": [
    {
      "id": "q1",
      "question": "What authentication provider should we use?",
      "context": "The task says 'add auth' but doesn't specify OAuth, JWT, or session-based",
      "inputType": "choice",
      "options": ["JWT", "OAuth 2.0", "Session-based"]
    }
  ]
}
<<<END_PAYLOAD>>>
```

### Parsing Logic

```typescript
function parseAgentOutput(result: RawAgentResult): ParsedOutput {
  const transcript = result.messages;
  const lastAssistantMessage = [...transcript].reverse().find(m => m.role === 'assistant');

  if (!lastAssistantMessage) {
    return { exitCode: result.exitCode, outcome: undefined, payload: undefined };
  }

  const content = lastAssistantMessage.content;

  // Extract outcome marker
  const outcomeMatch = content.match(/<<<OUTCOME:(\w+)>>>/);
  if (!outcomeMatch) {
    return { exitCode: result.exitCode, outcome: undefined, payload: undefined };
  }

  const outcome = outcomeMatch[1];

  // Extract payload (between markers)
  const payloadMatch = content.match(/<<<OUTCOME:\w+>>>\s*([\s\S]*?)<<<END_PAYLOAD>>>/);
  let payload: unknown = undefined;

  if (payloadMatch && payloadMatch[1].trim()) {
    try {
      payload = JSON.parse(payloadMatch[1].trim());
    } catch {
      // Invalid JSON — will be caught in validation step
      return {
        exitCode: result.exitCode,
        outcome: undefined,
        payload: undefined,
        parseError: `Failed to parse payload JSON for outcome "${outcome}"`,
      };
    }
  }

  return { exitCode: result.exitCode, outcome, payload };
}
```

### Fallback: No Markers Found

If the agent didn't return outcome markers (maybe it crashed, or it's a simpler agent that doesn't support structured output):

- **exitCode === 0 + no markers** → treat as the "default success" outcome for the current mode
  - `plan` mode → `plan_complete`
  - `implement` mode → check if PR was created → `pr_ready`, else generic completion
  - `review` mode → `approved` (optimistic default)
- **exitCode !== 0** → `agent_error`

```typescript
function inferOutcome(
  mode: AgentRunMode,
  exitCode: number,
  env: AgentEnvironment,
): string | undefined {
  if (exitCode !== 0) return undefined; // agent_error path

  // Check git state for evidence of what happened
  switch (mode) {
    case 'plan':
      return 'plan_complete';
    case 'implement': {
      // Did the agent create commits?
      const hasNewCommits = await gitOps.getLog(env.worktreePath, {
        since: env.startTime,
        limit: 1,
      });
      return hasNewCommits.length > 0 ? 'pr_ready' : undefined;
    }
    case 'review':
      return 'approved';
    default:
      return undefined;
  }
}
```

---

## Step 7: Validate Output

### Outcome Schema Validation

The parsed outcome + payload are validated against `OUTCOME_SCHEMAS`:

```typescript
async function validateAgentOutput(
  parsed: ParsedOutput,
  taskId: string,
): Promise<ValidatedOutput> {
  // 1. Agent process failed
  if (parsed.exitCode !== 0) {
    return {
      type: 'agent_error',
      error: parsed.error || `Agent exited with code ${parsed.exitCode}`,
    };
  }

  // 2. Parse error
  if (parsed.parseError) {
    return {
      type: 'agent_error',
      error: parsed.parseError,
    };
  }

  // 3. No outcome returned
  if (!parsed.outcome) {
    return {
      type: 'agent_error',
      error: 'Agent completed but did not return a structured outcome',
    };
  }

  // 4. Validate outcome name exists
  const schema = OUTCOME_SCHEMAS[parsed.outcome];
  if (!schema) {
    return {
      type: 'agent_error',
      error: `Unknown outcome: "${parsed.outcome}"`,
    };
  }

  // 5. Validate payload against schema
  if (schema.schema) {
    const validation = validateOutcomePayload(parsed.outcome, parsed.payload);
    if (!validation.valid) {
      return {
        type: 'agent_error',
        error: `Invalid payload for outcome "${parsed.outcome}": ${validation.error}`,
      };
    }
  }

  return {
    type: 'agent_outcome',
    outcome: parsed.outcome,
    payload: parsed.payload as TransitionPayload | undefined,
  };
}
```

### Project-Level Checks

After schema validation passes, run project-specific checks. These are defined per-project and catch things the outcome schema can't:

```typescript
interface IProjectValidator {
  // Run all configured checks on the agent's work
  validate(env: AgentEnvironment, outcome: string): Promise<ValidationReport>;
}

interface ValidationReport {
  passed: boolean;
  checks: CheckResult[];
}

interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
  severity: 'error' | 'warning';
}
```

**Built-in project checks:**

| Check | What It Does | When |
|-------|-------------|------|
| `build` | Runs the project's build command (`npm run build`, `cargo build`, etc.) | After `implement` mode |
| `lint` | Runs the project's lint command | After `implement` mode |
| `test` | Runs the project's test suite | After `implement` mode |
| `type-check` | Runs type checking (`tsc --noEmit`, etc.) | After `implement` mode |
| `no-secrets` | Scans for accidentally committed secrets/keys | After any mode |

**Project check configuration** (`.agents-manager/config.json` → `checks` section):

```json
{
  "checks": {
    "build": {
      "enabled": true,
      "command": "npm run build",
      "severity": "error",
      "modes": ["implement"]
    },
    "lint": {
      "enabled": true,
      "command": "npm run lint",
      "severity": "warning",
      "modes": ["implement"]
    },
    "test": {
      "enabled": true,
      "command": "npm test",
      "severity": "error",
      "modes": ["implement"]
    },
    "type-check": {
      "enabled": true,
      "command": "npx tsc --noEmit",
      "severity": "error",
      "modes": ["implement"]
    }
  },
  "failOnError": true,
  "failOnWarning": false
}
```

**Behavior when checks fail:**

- If `failOnError: true` and any `severity: "error"` check fails:
  - The outcome is **overridden** to `agent_error` with a message explaining which checks failed
  - The agent's actual outcome (e.g., `pr_ready`) is stored in the event log for debugging
  - The pipeline transitions to `failed` instead of the intended next status
- If only warnings fail, the outcome proceeds but warnings are logged to the event log and shown in the UI

```typescript
async function runProjectChecks(
  env: AgentEnvironment,
  outcome: string,
  mode: AgentRunMode,
): Promise<ValidationReport> {
  const config = await loadProjectChecks(env.projectPath);
  const results: CheckResult[] = [];

  for (const [name, check] of Object.entries(config.checks)) {
    if (!check.enabled) continue;
    if (!check.modes.includes(mode)) continue;

    try {
      await execInWorktree(env.worktreePath, check.command, { timeout: 120000 });
      results.push({ name, passed: true, severity: check.severity });
    } catch (err) {
      results.push({
        name,
        passed: false,
        message: err.stderr || err.message,
        severity: check.severity,
      });
    }
  }

  const hasErrors = results.some(r => !r.passed && r.severity === 'error');
  return {
    passed: !hasErrors || !config.failOnError,
    checks: results,
  };
}
```

---

## Step 8: Collect Artifacts

After validation passes, collect the artifacts the agent created.

> **Best-effort (Decision 3b):** Artifact collection failures are logged but do **not** fail the agent run. If any step below throws (e.g., git log parsing fails, PR creation fails, diff stat collection errors), the error is caught, logged to the task event log, and the pipeline proceeds to Step 9. The agent's work remains safely on the branch in the worktree and artifacts can be collected manually or re-tried later.

### What Gets Collected

```typescript
async function collectArtifacts(
  env: AgentEnvironment,
  task: Task,
  mode: AgentRunMode,
  result: AgentRunResult,
): Promise<void> {
  // 1. Store plan (if plan mode)
  if (mode === 'plan' && result.exitCode === 0) {
    const planContent = extractPlanFromTranscript(result.transcript);
    if (planContent) {
      await taskStore.updateTask(task.id, { plan: planContent });
    }
  }

  // 2. Store branch artifact (if new branch was created)
  const existingBranch = (await taskStore.listArtifacts(task.id, 'branch'))[0];
  if (env.branchName && (!existingBranch || existingBranch.metadata.branchName !== env.branchName)) {
    await taskStore.addArtifact(task.id, {
      type: 'branch',
      label: env.branchName,
      metadata: { baseBranch: env.baseBranch },
    });
  }

  // 3. Collect new commits
  const commits = await gitOps.getLog(env.worktreePath, {
    since: env.startTime,
  });
  for (const commit of commits) {
    await taskStore.addArtifact(task.id, {
      type: 'commit',
      label: commit.shortHash,
      url: commit.hash,
      metadata: { message: commit.message, author: commit.author },
    });
  }

  // 4. Push branch to remote (if configured)
  if (commits.length > 0 && env.config.autoPush !== false) {
    await gitOps.push(env.worktreePath, env.branchName);
  }

  // 5. Create PR (if implement mode completed successfully)
  if (mode === 'implement' && result.outcome === 'pr_ready') {
    await createPullRequest(env, task, commits);
  }

  // 6. Store diff stats
  if (commits.length > 0) {
    const diffStats = await gitOps.getDiffStats(env.worktreePath, {
      baseBranch: env.baseBranch || 'main',
      headBranch: env.branchName,
    });
    await taskStore.addArtifact(task.id, {
      type: 'diff',
      label: `+${diffStats.additions} -${diffStats.deletions} across ${diffStats.filesChanged} files`,
      metadata: diffStats,
    });
  }
}
```

### PR Creation

```typescript
async function createPullRequest(
  env: AgentEnvironment,
  task: Task,
  commits: GitLogEntry[],
): Promise<void> {
  const scmAvailable = await scmPlatform.isAvailable();
  if (!scmAvailable) return; // no SCM platform configured

  const pr = await scmPlatform.createPR({
    repoPath: env.projectPath,
    headBranch: env.branchName,
    baseBranch: env.baseBranch || 'main',
    title: task.title,
    body: buildPRDescription(task, commits),
    draft: false,
  });

  await taskStore.addArtifact(task.id, {
    type: 'pull_request',
    label: `PR #${pr.number}: ${pr.title}`,
    url: pr.url,
    metadata: {
      prNumber: pr.number,
      state: 'open',
      headBranch: env.branchName,
      baseBranch: env.baseBranch || 'main',
    },
  });

}
```

---

## Step 9: Trigger Pipeline

After artifacts are collected, pass the outcome to the pipeline engine:

```typescript
async function triggerPipeline(
  taskId: string,
  runId: string,
  validated: ValidatedOutput,
): Promise<void> {
  if (validated.type === 'agent_outcome') {
    // Agent completed successfully with a named outcome
    const transitions = await pipelineEngine.getValidTransitions(
      taskId,
      { type: 'agent_outcome', outcome: validated.outcome }
    );

    if (transitions.length === 1 && transitions[0].allowed) {
      // Single valid transition — auto-execute
      await pipelineEngine.transition(taskId, transitions[0].transition.to, {
        triggeredBy: 'agent',
        agentRunId: runId,
        payload: validated.payload,
      });
    }
    // If 0 or multiple transitions, don't auto-execute (needs user decision)
    // The task stays in current status, user sees the outcome in the UI

  } else {
    // Agent process failed
    const transitions = await pipelineEngine.getValidTransitions(
      taskId,
      { type: 'agent_error' }
    );

    if (transitions.length === 1 && transitions[0].allowed) {
      await pipelineEngine.transition(taskId, transitions[0].transition.to, {
        triggeredBy: 'agent',
        agentRunId: runId,
        reason: validated.error,
      });
    }
  }
}
```

---

## Step 10: Cleanup

### Post-Run Cleanup

```typescript
async function cleanup(
  runId: string,
  env: AgentEnvironment,
  result: AgentRunResult,
  taskId: string,
): Promise<void> {
  // 1. Unlock worktree
  await worktreeManager.unlock(env.worktreePath);

  // 2. Update agent_run record
  await agentRunStore.update(runId, {
    status: result.exitCode === 0 ? 'completed' : 'failed',
    transcript: JSON.stringify(result.transcript),
    tokenUsage: JSON.stringify(result.tokenUsage),
    durationMs: Date.now() - env.startTime,
    finishedAt: new Date().toISOString(),
    error: result.error || null,
  });

  // 3. Log completion event
  await eventLog.log({
    taskId,
    category: 'agent',
    type: result.exitCode === 0 ? 'agent.completed' : 'agent.failed',
    summary: result.exitCode === 0
      ? `Agent completed in ${formatDuration(Date.now() - env.startTime)} ($${result.tokenUsage?.totalCost?.toFixed(2) || '?'})`
      : `Agent failed: ${result.error}`,
    data: {
      runId,
      exitCode: result.exitCode,
      outcome: result.outcome,
      tokenUsage: result.tokenUsage,
      durationMs: Date.now() - env.startTime,
    },
    actor: { type: 'agent', agentRunId: runId },
    level: result.exitCode === 0 ? 'info' : 'error',
  });

  // 4. Send notification
  await notifier.send({
    title: result.exitCode === 0
      ? `Agent completed: ${env.task.title}`
      : `Agent failed: ${env.task.title}`,
    body: result.exitCode === 0
      ? `Outcome: ${result.outcome}`
      : `Error: ${result.error}`,
    taskId,
    runId,
  });
}
```

### Worktree Lifecycle After Run

| Agent Result | Worktree Fate |
|-------------|--------------|
| Agent completed, outcome accepted | Kept — needed for review, future rework |
| Agent failed, will retry | Kept — retry agent uses same worktree |
| Agent failed, no retries, task → failed | Kept — admin may want to inspect |
| Task reaches terminal status (done/cancelled) | Deleted by supervisor cleanup |
| User explicitly deletes | Deleted immediately |

The `TaskSupervisor` periodically runs `worktreeManager.cleanup()` which removes worktrees for tasks in terminal status.

---

## The Full Orchestrator

All 10 steps are orchestrated by the `AgentService.start()` method:

```typescript
class AgentService {
  async start(taskId: string, mode: AgentRunMode, overrides?: Partial<AgentConfig>): Promise<string> {
    const task = await this.taskStore.getTask(taskId);
    const project = await this.projectStore.getById(task.projectId);
    const pipeline = await this.pipelineEngine.getPipeline(taskId);

    // Resolve agent + config
    const agent = resolveAgent(overrides || {}, project, this.agentFramework);
    const config = await this.mergeConfig(agent, project, overrides);

    // Create run record
    const runId = randomUUID();
    await this.agentRunStore.create({
      id: runId,
      taskId,
      projectId: project.id,
      agentType: agent.type,
      mode,
      status: 'running',
      model: config.model,
      startedAt: new Date().toISOString(),
    });

    // Log start event
    await this.eventLog.log({
      taskId,
      category: 'agent',
      type: 'agent.started',
      summary: `${agent.displayName} started (${mode} mode)`,
      data: { runId, agentType: agent.type, mode, model: config.model },
      actor: { type: 'agent', name: agent.type, agentRunId: runId },
      level: 'info',
    });

    // Run the full pipeline (async — returns immediately, runs in background)
    this.executeFullPipeline(runId, task, project, agent, mode, config, pipeline)
      .catch(err => {
        console.error(`Agent run ${runId} failed:`, err);
        this.handleUnexpectedError(runId, taskId, err);
      });

    return runId;
  }

  private async executeFullPipeline(
    runId: string,
    task: Task,
    project: Project,
    agent: IAgent,
    mode: AgentRunMode,
    config: AgentConfig,
    pipeline: PipelineDefinition,
  ): Promise<void> {
    // Step 1: Prepare environment
    const env = await prepareEnvironment(project, task, config);

    // Step 2: Assemble context
    const prompt = await this.contextBuilder.build(task, mode, pipeline, config);

    // Step 3: (config already resolved above)

    // Step 4: Execute agent
    const timeoutTimer = startTimeoutWatchdog(runId, config.timeout, /* ... */);
    let rawResult: AgentRunResult;
    try {
      rawResult = await executeAgent(agent, env, prompt, config, runId, {
        taskId: task.id,
        onMessage: (id, msg) => this.streamToRenderer(id, msg),
      });
    } finally {
      clearTimeout(timeoutTimer);
    }

    // Step 5: (monitoring happens during step 4 via watchdog + supervisor)

    // Step 6: Parse output
    const parsed = parseAgentOutput(rawResult);

    // Step 7: Validate output
    let validated = await validateAgentOutput(parsed, task.id);

    // Run project checks (only if outcome is valid)
    if (validated.type === 'agent_outcome') {
      const checkReport = await runProjectChecks(env, validated.outcome, mode);
      if (!checkReport.passed) {
        validated = {
          type: 'agent_error',
          error: `Project checks failed: ${checkReport.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`,
        };
        // Log the override
        await this.eventLog.log({
          taskId: task.id,
          category: 'agent',
          type: 'agent.checks_failed',
          summary: `Agent outcome overridden: project checks failed`,
          data: { originalOutcome: parsed.outcome, checks: checkReport.checks },
          actor: { type: 'system' },
          level: 'error',
        });
      }
    }

    // Step 8: Collect artifacts (best-effort — failures logged, never block)
    if (validated.type === 'agent_outcome') {
      try {
        await collectArtifacts(env, task, mode, rawResult);
      } catch (err) {
        await this.eventLog.log({
          taskId: task.id,
          category: 'agent',
          type: 'agent.artifact_collection_failed',
          summary: `Artifact collection failed: ${err.message}`,
          data: { error: String(err) },
          actor: { type: 'system' },
          level: 'error',
        });
      }
    }

    // Step 9: Trigger pipeline
    await triggerPipeline(task.id, runId, validated);

    // Step 10: Cleanup
    await cleanup(runId, env, rawResult, task.id);
  }
}
```

---

## Agent Adapter Pattern

The `IAgent` interface allows different agent implementations to plug into the same lifecycle. Each adapter handles the specifics of launching, streaming, and parsing for its agent.

### Phase 2: Claude Code SDK

```typescript
class ClaudeCodeAgent implements IAgent {
  readonly type = 'claude-code';
  readonly displayName = 'Claude Code';

  async isAvailable(): Promise<boolean> {
    // Check if claude CLI is installed
    try {
      await exec('claude --version');
      return true;
    } catch {
      return false;
    }
  }

  getDefaultConfig(): AgentConfig {
    return {
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 50,
      timeout: 600000,
      autoCommit: true,
      branchStrategy: 'new-per-task',
      branchPrefix: 'agent/',
    };
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const result = await claude({
      prompt: options.prompt,
      cwd: options.projectPath,
      model: options.config.model,
      maxTurns: options.config.maxTurns,
      abortSignal: options.abortSignal,
      onMessage: (msg) => options.onMessage(this.convertMessage(msg)),
    });

    return {
      transcript: result.messages.map(m => this.convertMessage(m)),
      tokenUsage: this.extractTokenUsage(result),
      exitCode: result.exitCode ?? 0,
      ...this.parseOutcome(result),
    };
  }

  stop(runId: string): void {
    // Abort signal handles this
  }
}
```

### File-System Sandbox (Tool Hook)

Agents run in an isolated worktree, but nothing prevents a misbehaving agent from writing or deleting files _outside_ that directory. The Claude Code SDK supports **tool hooks** — callbacks that fire before/after every tool invocation. We use a `beforeToolCall` hook to reject any file write, edit, or delete that targets a path outside the worktree root.

```typescript
import path from 'path';

/**
 * Returns a beforeToolCall hook that blocks file operations outside `allowedRoot`.
 * Works with Claude Code SDK's hook system; adaptable for other agent runtimes
 * that support pre-tool-call interception.
 */
function createFileSystemGuard(allowedRoot: string) {
  const resolved = path.resolve(allowedRoot);

  // Tools that accept a file path and can mutate the file system
  const GUARDED_TOOLS = new Set([
    'write',          // Write/create file
    'edit',           // Edit file
    'notebook_edit',  // Edit notebook cell
  ]);

  return (toolCall: { name: string; input: Record<string, unknown> }) => {
    if (!GUARDED_TOOLS.has(toolCall.name)) return; // allow

    const target = (toolCall.input.file_path ?? toolCall.input.path) as string | undefined;
    if (!target) return; // no path — let the tool handle validation

    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(resolved + path.sep) && resolvedTarget !== resolved) {
      throw new Error(
        `Blocked: ${toolCall.name} attempted to access "${resolvedTarget}" which is outside the allowed directory "${resolved}".`
      );
    }
  };
}
```

Usage inside `ClaudeCodeAgent.run()`:

```typescript
const result = await claude({
  prompt: options.prompt,
  cwd: options.projectPath,
  model: options.config.model,
  maxTurns: options.config.maxTurns,
  abortSignal: options.abortSignal,
  hooks: {
    beforeToolCall: createFileSystemGuard(options.projectPath),
  },
  onMessage: (msg) => options.onMessage(this.convertMessage(msg)),
});
```

> **Note:** This guard only covers tools that go through the SDK's hook system. Agents can still run arbitrary shell commands via `bash` tool calls — those are constrained by the worktree `cwd` and OS-level permissions, not by this hook. A future enhancement could also inspect `bash` tool inputs for path arguments, but that's fragile and deferred to Phase 5.

### Phase 3: Cursor CLI (example adapter)

```typescript
class CursorAgent implements IAgent {
  readonly type = 'cursor';
  readonly displayName = 'Cursor';

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // Cursor uses a different invocation pattern
    const child = spawn('cursor', ['--task', options.prompt], {
      cwd: options.projectPath,
    });

    // Parse Cursor's output format into AgentMessage[]
    // ...
  }
}
```

### Phase 3: Custom Agent (CLI-based)

```typescript
class CustomAgent implements IAgent {
  constructor(
    readonly type: string,
    readonly displayName: string,
    private command: string,
    private args: string[],
  ) {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // Run any CLI command, capture output
    const child = spawn(this.command, [...this.args, options.prompt], {
      cwd: options.projectPath,
    });
    // ...
  }
}
```

---

## Cost Tracking

Every agent run records token usage and cost:

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCost: number;  // USD
}
```

Cost is calculated based on the model's pricing:

```typescript
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':            { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1_000_000,  output: 15.0 / 1_000_000 },
  'claude-haiku-4-5-20251001':  { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
};

function calculateCost(model: string, usage: Partial<TokenUsage>): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (usage.inputTokens || 0) * pricing.input
       + (usage.outputTokens || 0) * pricing.output;
}
```

---

## File Structure

```
src/main/
├── services/
│   ├── agent-service.ts           # Full orchestrator (10-step pipeline)
│   ├── agent-context-builder.ts   # Prompt assembly from task + history
│   └── project-validator.ts       # Project-level check runner
├── implementations/
│   ├── claude-code-agent.ts       # IAgent impl for Claude Code SDK
│   ├── local-worktree-manager.ts  # IWorktreeManager impl using git CLI
│   └── github-platform.ts        # IScmPlatform impl for GitHub
├── handlers/
│   ├── agent-handler.ts           # Pipeline handler: start_agent hook
│   └── outcome-schemas.ts         # OUTCOME_SCHEMAS registry
└── interfaces/
    ├── agent-framework.ts         # IAgentFramework, IAgent
    ├── worktree-manager.ts        # IWorktreeManager
    └── scm-platform.ts            # IScmPlatform
```

---

## Key Types

### AgentRun

```typescript
interface AgentRun {
  id: string;
  taskId: string;
  projectId: string;
  agentType: string;
  mode: AgentRunMode;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  model: string;
  outcome?: string;              // named outcome: 'pr_ready', 'plan_complete', etc.
  transcript: AgentMessage[];
  tokenUsage?: TokenUsage;
  durationMs: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

type AgentRunMode = 'plan' | 'implement' | 'review' | 'investigate' | 'design';
```

### IAgentRunStore

```typescript
interface IAgentRunStore {
  create(run: Omit<AgentRun, 'transcript' | 'tokenUsage' | 'durationMs' | 'finishedAt'>): Promise<AgentRun>;
  getById(id: string): Promise<AgentRun | null>;
  update(id: string, data: Partial<AgentRun>): Promise<AgentRun>;
  listByTask(taskId: string): Promise<AgentRun[]>;
  listByProject(projectId: string, filters?: { status?: string }): Promise<AgentRun[]>;
  listRunning(projectId?: string): Promise<AgentRun[]>;
  deleteByProject(projectId: string): Promise<void>;
}
```

Agent runs are a separate concern from tasks, so `IAgentRunStore` is a standalone interface (not part of `ITaskStore`). Phase 2 implementation: `SqliteAgentRunStore`.

---

## Phase Rollout

### Phase 1
- None (no agent integration)

### Phase 2
- Full 10-step pipeline with Claude Code SDK
- Worktree management
- Context assembly (basic: task + plan + mode instructions)
- Structured output parsing + outcome validation
- Artifact collection (branch, commits, PR)
- Project checks (build, lint, test)
- Cost tracking
- Streaming output to UI
- Cancellation + timeout
- Supervisor integration

### Phase 3
- Additional agent adapters (Cursor, Aider, custom CLI)
- Agent registry with discovery
- Agent-specific config per adapter
- CLI/HTTP trigger for agent runs

### Phase 4
- Cost dashboard (per project, per task, per agent type)
- Agent performance analytics (success rates, average duration)
- Comparison between agent types
