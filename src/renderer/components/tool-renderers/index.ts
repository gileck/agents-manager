import React from 'react';
import type { ToolRendererProps } from './types';
import { ReadRenderer } from './ReadRenderer';
import { BashRenderer } from './BashRenderer';
import { GrepRenderer } from './GrepRenderer';
import { EditRenderer } from './EditRenderer';
import { WriteRenderer } from './WriteRenderer';
import { TodoWriteRenderer } from './TodoWriteRenderer';
import { GlobRenderer } from './GlobRenderer';
import { WebFetchRenderer } from './WebFetchRenderer';
import { WebSearchRenderer } from './WebSearchRenderer';
import { TaskRenderer } from './TaskRenderer';
import { AskUserQuestionRenderer } from './AskUserQuestionRenderer';
import { GenericToolRenderer } from './GenericToolRenderer';
import { TaskEventCard } from './TaskEventCard';
import { TaskDetailCard } from './TaskDetailCard';
import { TaskListCard } from './TaskListCard';
import { AgentRunningCard } from './AgentRunningCard';

const TOOL_RENDERERS: Record<string, React.ComponentType<ToolRendererProps>> = {
  Read: ReadRenderer,
  Bash: BashRenderer,
  Grep: GrepRenderer,
  Edit: EditRenderer,
  Write: WriteRenderer,
  TodoWrite: TodoWriteRenderer,
  Glob: GlobRenderer,
  WebFetch: WebFetchRenderer,
  WebSearch: WebSearchRenderer,
  Task: TaskRenderer,
  AskUserQuestion: AskUserQuestionRenderer,
  // cursor-agent uses lowercase tool names (from shellToolCall, readToolCall, etc.)
  shell: BashRenderer,
  read: ReadRenderer,
  grep: GrepRenderer,
  edit: EditRenderer,
  write: WriteRenderer,
  // Defensive lowercase variants for new tools
  glob: GlobRenderer,
  webfetch: WebFetchRenderer,
  websearch: WebSearchRenderer,
  task: TaskRenderer,
  askuserquestion: AskUserQuestionRenderer,

  // MCP task-manager tools — claude-code lib format (mcp__<serverKey>__<toolName>)
  // Note: serverKey comes from the mcpServers record key in chat-agent-service.ts ('taskManager')
  'mcp__taskManager__create_task': TaskEventCard,
  'mcp__taskManager__transition_task': TaskEventCard,
  'mcp__taskManager__get_task': TaskDetailCard,
  'mcp__taskManager__list_tasks': TaskListCard,
  'mcp__taskManager__list_agent_runs': AgentRunningCard,

  // MCP task-manager tools — codex-cli lib format (<serverKey>.<toolName>)
  'taskManager.create_task': TaskEventCard,
  'taskManager.transition_task': TaskEventCard,
  'taskManager.get_task': TaskDetailCard,
  'taskManager.list_tasks': TaskListCard,
  'taskManager.list_agent_runs': AgentRunningCard,
};

export function getToolRenderer(toolName: string): React.ComponentType<ToolRendererProps> {
  return TOOL_RENDERERS[toolName] || GenericToolRenderer;
}

export type { ToolRendererProps } from './types';
