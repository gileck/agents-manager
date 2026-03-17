/**
 * Terminal tool renderer barrel.
 *
 * Maps tool names (including lowercase variants and MCP tools)
 * to terminal-specific renderers. Falls back to TerminalGenericRenderer.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import { TerminalBashRenderer } from './TerminalBashRenderer';
import { TerminalReadRenderer } from './TerminalReadRenderer';
import { TerminalWriteRenderer } from './TerminalWriteRenderer';
import { TerminalEditRenderer } from './TerminalEditRenderer';
import { TerminalGrepRenderer } from './TerminalGrepRenderer';
import { TerminalGlobRenderer } from './TerminalGlobRenderer';
import { TerminalTodoWriteRenderer } from './TerminalTodoWriteRenderer';
import { TerminalGenericRenderer } from './TerminalGenericRenderer';
import {
  TerminalCreateTaskRenderer,
  TerminalUpdateTaskRenderer,
  TerminalListTasksRenderer,
  TerminalGetTaskRenderer,
  TerminalTransitionTaskRenderer,
  TerminalListAgentRunsRenderer,
} from './TerminalTaskManagerRenderers';

const TERMINAL_TOOL_RENDERERS: Record<string, React.ComponentType<ToolRendererProps>> = {
  // Standard tool names (PascalCase)
  Bash: TerminalBashRenderer,
  Read: TerminalReadRenderer,
  Write: TerminalWriteRenderer,
  Edit: TerminalEditRenderer,
  Grep: TerminalGrepRenderer,
  Glob: TerminalGlobRenderer,
  TodoWrite: TerminalTodoWriteRenderer,

  // Lowercase variants (cursor-agent, codex-cli)
  shell: TerminalBashRenderer,
  read: TerminalReadRenderer,
  write: TerminalWriteRenderer,
  edit: TerminalEditRenderer,
  grep: TerminalGrepRenderer,
  glob: TerminalGlobRenderer,
  todowrite: TerminalTodoWriteRenderer,

  // Common tools that use the generic renderer
  WebFetch: TerminalGenericRenderer,
  WebSearch: TerminalGenericRenderer,
  Task: TerminalGenericRenderer,
  AskUserQuestion: TerminalGenericRenderer,
  webfetch: TerminalGenericRenderer,
  websearch: TerminalGenericRenderer,
  task: TerminalGenericRenderer,
  askuserquestion: TerminalGenericRenderer,

  // MCP task-manager tools (both formats) — dedicated renderers
  'mcp__taskManager__create_task': TerminalCreateTaskRenderer,
  'mcp__taskManager__update_task': TerminalUpdateTaskRenderer,
  'mcp__taskManager__list_tasks': TerminalListTasksRenderer,
  'mcp__taskManager__get_task': TerminalGetTaskRenderer,
  'mcp__taskManager__transition_task': TerminalTransitionTaskRenderer,
  'mcp__taskManager__list_agent_runs': TerminalListAgentRunsRenderer,
  'taskManager.create_task': TerminalCreateTaskRenderer,
  'taskManager.update_task': TerminalUpdateTaskRenderer,
  'taskManager.list_tasks': TerminalListTasksRenderer,
  'taskManager.get_task': TerminalGetTaskRenderer,
  'taskManager.transition_task': TerminalTransitionTaskRenderer,
  'taskManager.list_agent_runs': TerminalListAgentRunsRenderer,
};

/** Get a terminal-specific tool renderer by tool name. Falls back to TerminalGenericRenderer. */
export function getTerminalToolRenderer(toolName: string): React.ComponentType<ToolRendererProps> {
  return TERMINAL_TOOL_RENDERERS[toolName] || TerminalGenericRenderer;
}
