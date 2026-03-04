import React from 'react';
import type { ToolRendererProps } from './types';
import { ReadRenderer } from './ReadRenderer';
import { BashRenderer } from './BashRenderer';
import { GrepRenderer } from './GrepRenderer';
import { EditRenderer } from './EditRenderer';
import { WriteRenderer } from './WriteRenderer';
import { TodoWriteRenderer } from './TodoWriteRenderer';
import { GenericToolRenderer } from './GenericToolRenderer';

const TOOL_RENDERERS: Record<string, React.ComponentType<ToolRendererProps>> = {
  Read: ReadRenderer,
  Bash: BashRenderer,
  Grep: GrepRenderer,
  Edit: EditRenderer,
  Write: WriteRenderer,
  TodoWrite: TodoWriteRenderer,
  // cursor-agent uses lowercase tool names (from shellToolCall, readToolCall, etc.)
  shell: BashRenderer,
  read: ReadRenderer,
  grep: GrepRenderer,
  edit: EditRenderer,
  write: WriteRenderer,
};

export function getToolRenderer(toolName: string): React.ComponentType<ToolRendererProps> {
  return TOOL_RENDERERS[toolName] || GenericToolRenderer;
}

export type { ToolRendererProps } from './types';
