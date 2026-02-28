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

function cliReferenceSection(taskId: string): string {
  return [
    '## Useful commands',
    `- npx agents-manager tasks get ${taskId}`,
    `- npx agents-manager tasks update ${taskId} --title/--description/--priority/--assignee`,
    `- npx agents-manager tasks transition ${taskId} <status>`,
    `- npx agents-manager tasks transitions ${taskId}`,
    `- npx agents-manager tasks subtask list/add/update/remove ${taskId}`,
    `- npx agents-manager deps list/add/remove ${taskId}`,
    `- npx agents-manager events list --task ${taskId}`,
    `- npx agents-manager prompts list --task ${taskId}`,
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
    '- Use basic Markdown only (bold, italic, code, code blocks). Avoid complex formatting.',
    '- Prefer bullet points over long paragraphs.',
    '- If the answer is long, summarize first and offer to elaborate.',
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
  ].join('\n');
}
