/**
 * Shared prompt building blocks and consumer-specific system prompt builders.
 *
 * ChatAgentService no longer owns system prompts — each consumer (desktop UI,
 * Telegram bot, CLI) builds its own prompt from shared pieces and passes it
 * into ChatAgentService.send().
 */

export interface SessionScope {
  scopeType: 'project' | 'task';
  projectId: string;
  projectName: string;
  task?: {
    id: string;
    title: string;
    status: string;
    description?: string | null;
    priority?: number;
    assignee?: string | null;
    plan?: string | null;
    technicalDesign?: string | null;
    pipelineName: string;
  };
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function capabilitiesSection(): string {
  return [
    '## Capabilities',
    '- Read and explore project files (Read, Glob, Grep, LS tools)',
    '- Run the `npx agents-manager` CLI to manage tasks, features, pipelines, and more (via Bash tool)',
    '- Answer questions about code, architecture, and project state',
  ].join('\n');
}

function rulesSection(): string {
  return [
    '## Rules',
    '- You MUST NOT modify any files. Do not use Write, Edit, MultiEdit, or NotebookEdit tools.',
    '- You CAN use Bash to run `npx agents-manager` CLI commands (e.g. `npx agents-manager tasks list`, `npx agents-manager tasks create`, `npx agents-manager tasks update`).',
    '- You CAN use Bash for read-only commands like `ls`, `cat`, `git log`, `git diff`, etc.',
    '- When the user asks you to do something that requires modifying files, explain that you can only read files but can help plan changes or create tasks.',
  ].join('\n');
}

// NOTE: Keep in sync with the actual CLI commands defined in src/main/cli/.
function cliReferenceSection(taskId?: string): string {
  const t = taskId ?? '<taskId>';
  return [
    '## CLI Reference (npx agents-manager)',
    '',
    '### Task Management',
    `- tasks list                          — List all tasks (--status, --assignee, --priority)`,
    `- tasks get ${t}                  — Get full task details`,
    `- tasks create --title "..." [opts]   — Create a task (--description, --priority, --assignee, --tags, --pipeline)`,
    `- tasks update ${t} [opts]        — Update task fields (--title, --description, --priority, --assignee, --tags)`,
    `- tasks delete ${t}               — Delete a task`,
    `- tasks reset ${t}                — Reset task to initial state`,
    '',
    '### Task Transitions',
    `- tasks transitions ${t}          — Show valid status transitions`,
    `- tasks transition ${t} <status>  — Move task to a new status`,
    `- tasks start ${t}                — Start a task (move to first active status)`,
    '',
    '### Subtasks',
    `- tasks subtask list ${t}         — List subtasks`,
    `- tasks subtask add ${t} --name "..." [--status open|in_progress|done]`,
    `- tasks subtask update ${t} --name "..." --status <status>`,
    `- tasks subtask remove ${t} --name "..."`,
    '',
    '### Dependencies',
    `- deps list ${t}                  — List task dependencies (blockers)`,
    `- deps add ${t} <depId>           — Add dependency (blocked by depId)`,
    `- deps remove ${t} <depId>        — Remove a dependency`,
    '',
    '### Events & History',
    `- events list --task ${t}         — View task event log`,
    '',
    '### Agent Runs',
    `- agent runs [--task ${t}] [--active] — List agent runs`,
    `- agent start ${t} --type <type>  — Start an agent on a task`,
    `- agent get <runId>                   — Get agent run details`,
    '',
    '### Prompts (Interactive Feedback)',
    `- prompts list --task ${t}        — List pending prompts`,
    `- prompts respond <id> --response "..." — Respond to a prompt`,
    '',
    '### Pipelines & Projects',
    '- pipelines list                      — List all pipelines',
    '- pipelines get <id>                  — Get pipeline details',
    '- projects list                       — List all projects',
    '- status                              — Show system dashboard',
  ].join('\n');
}

function taskContextSection(
  task: NonNullable<SessionScope['task']>,
): string {
  const lines: string[] = [
    `Current status: ${task.status} | Pipeline: ${task.pipelineName}`,
    '',
    '## Task Details',
  ];

  if (task.description) lines.push(`- Description: ${task.description}`);
  if (task.priority !== undefined) lines.push(`- Priority: P${task.priority}`);
  if (task.assignee) lines.push(`- Assignee: ${task.assignee}`);
  if (task.plan) lines.push(`\n### Plan\n${task.plan}`);
  if (task.technicalDesign) lines.push(`\n### Technical Design\n${task.technicalDesign}`);

  return lines.join('\n');
}

function telegramFormattingRules(): string {
  return [
    '## Formatting',
    '- Keep responses concise — Telegram messages are limited to 4096 characters.',
    '- Use Telegram-compatible Markdown only:',
    '  - *bold* using single asterisks (NOT **double**)',
    '  - _italic_ using single underscores',
    '  - `inline code` using backticks',
    '  - ```code blocks``` using triple backticks (no language specifier)',
    '  - [link text](url) for hyperlinks',
    '- DO NOT use: headers (#), tables, HTML tags, nested formatting, or strikethrough.',
    '- Prefer bullet points over long paragraphs.',
    '- If the answer is long, summarize first and offer to elaborate.',
  ].join('\n');
}

function telegramResponseStyle(): string {
  return [
    '## Response Style',
    '- ALWAYS start your response with a brief one-line acknowledgment before making any tool calls.',
    '- Examples: "Got it, I\'ll check the task status." / "Sure, let me look at that file." / "On it — exploring the codebase now."',
    '- Keep the acknowledgment on its own line, then proceed with tool calls and analysis.',
    '- After completing your analysis, provide the final detailed response.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Consumer-specific composite builders
// ---------------------------------------------------------------------------

export function buildDesktopSystemPrompt(scope: SessionScope): string {
  if (scope.task) {
    return [
      `You are a task assistant for task #${scope.task.id}: "${scope.task.title}".`,
      taskContextSection(scope.task),
      '',
      capabilitiesSection(),
      '',
      rulesSection(),
      `- Focus on task #${scope.task.id}. Use \`npx agents-manager tasks get ${scope.task.id}\` to refresh task state.`,
      '- Be concise and helpful. Format responses with markdown when useful.',
      '',
      cliReferenceSection(scope.task.id),
    ].join('\n');
  }

  return [
    'You are a project assistant with read-only access to the codebase and full access to the `npx agents-manager` CLI for task management.',
    '',
    capabilitiesSection(),
    '',
    rulesSection(),
    '- Be concise and helpful. Format responses with markdown when useful.',
    '',
    cliReferenceSection(),
  ].join('\n');
}

export function buildTelegramSystemPrompt(scope: SessionScope): string {
  if (scope.task) {
    return [
      `You are a Telegram bot assistant for task #${scope.task.id}: "${scope.task.title}".`,
      taskContextSection(scope.task),
      '',
      capabilitiesSection(),
      '',
      rulesSection(),
      `- Focus on task #${scope.task.id}. Use \`npx agents-manager tasks get ${scope.task.id}\` to refresh task state.`,
      '',
      telegramFormattingRules(),
      '',
      telegramResponseStyle(),
      '',
      cliReferenceSection(scope.task.id),
    ].join('\n');
  }

  return [
    `You are a Telegram bot assistant for project "${scope.projectName}" with read-only access to the codebase and full access to the \`npx agents-manager\` CLI.`,
    '',
    capabilitiesSection(),
    '',
    rulesSection(),
    '',
    telegramFormattingRules(),
    '',
    telegramResponseStyle(),
    '',
    cliReferenceSection(),
  ].join('\n');
}
