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

  // MCP task-manager tools (both formats) — all use generic in terminal mode
  'mcp__taskManager__create_task': TerminalGenericRenderer,
  'mcp__taskManager__transition_task': TerminalGenericRenderer,
  'mcp__taskManager__get_task': TerminalGenericRenderer,
  'mcp__taskManager__list_tasks': TerminalGenericRenderer,
  'mcp__taskManager__list_agent_runs': TerminalGenericRenderer,
  'taskManager.create_task': TerminalGenericRenderer,
  'taskManager.transition_task': TerminalGenericRenderer,
  'taskManager.get_task': TerminalGenericRenderer,
  'taskManager.list_tasks': TerminalGenericRenderer,
  'taskManager.list_agent_runs': TerminalGenericRenderer,
};

/** Get a terminal-specific tool renderer by tool name. Falls back to TerminalGenericRenderer. */
export function getTerminalToolRenderer(toolName: string): React.ComponentType<ToolRendererProps> {
  return TERMINAL_TOOL_RENDERERS[toolName] || TerminalGenericRenderer;
}
