/**
 * Unit tests for getToolRenderer() in tool-renderers/index.ts.
 *
 * Verifies that every MCP task-manager tool name resolves to its custom
 * renderer component instead of falling through to GenericToolRenderer.
 *
 * Background: the server key used when registering the in-process MCP server
 * must match the key prefix expected by TOOL_RENDERERS.  When commit f847111
 * changed the key from 'taskManager' to 'task-manager', all task MCP tools
 * started returning GenericToolRenderer, breaking the custom UI cards.
 */

import { describe, it, expect } from 'vitest';
import { getToolRenderer } from '../../src/renderer/components/tool-renderers/index';
import { GenericToolRenderer } from '../../src/renderer/components/tool-renderers/GenericToolRenderer';
import { TaskEventCard } from '../../src/renderer/components/tool-renderers/TaskEventCard';
import { TaskDetailCard } from '../../src/renderer/components/tool-renderers/TaskDetailCard';
import { TaskListCard } from '../../src/renderer/components/tool-renderers/TaskListCard';
import { AgentRunningCard } from '../../src/renderer/components/tool-renderers/AgentRunningCard';

describe('getToolRenderer — MCP task-manager tools (claude-code format)', () => {
  it('mcp__taskManager__create_task → TaskEventCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('mcp__taskManager__create_task');
    expect(renderer).toBe(TaskEventCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('mcp__taskManager__transition_task → TaskEventCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('mcp__taskManager__transition_task');
    expect(renderer).toBe(TaskEventCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('mcp__taskManager__get_task → TaskDetailCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('mcp__taskManager__get_task');
    expect(renderer).toBe(TaskDetailCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('mcp__taskManager__list_tasks → TaskListCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('mcp__taskManager__list_tasks');
    expect(renderer).toBe(TaskListCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('mcp__taskManager__list_agent_runs → AgentRunningCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('mcp__taskManager__list_agent_runs');
    expect(renderer).toBe(AgentRunningCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });
});

describe('getToolRenderer — MCP task-manager tools (codex-cli format)', () => {
  it('taskManager.create_task → TaskEventCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('taskManager.create_task');
    expect(renderer).toBe(TaskEventCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('taskManager.transition_task → TaskEventCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('taskManager.transition_task');
    expect(renderer).toBe(TaskEventCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('taskManager.get_task → TaskDetailCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('taskManager.get_task');
    expect(renderer).toBe(TaskDetailCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('taskManager.list_tasks → TaskListCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('taskManager.list_tasks');
    expect(renderer).toBe(TaskListCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('taskManager.list_agent_runs → AgentRunningCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('taskManager.list_agent_runs');
    expect(renderer).toBe(AgentRunningCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });
});

describe('getToolRenderer — request_changes tool', () => {
  it('mcp__taskManager__request_changes → TaskEventCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('mcp__taskManager__request_changes');
    expect(renderer).toBe(TaskEventCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });

  it('taskManager.request_changes → TaskEventCard (not GenericToolRenderer)', () => {
    const renderer = getToolRenderer('taskManager.request_changes');
    expect(renderer).toBe(TaskEventCard);
    expect(renderer).not.toBe(GenericToolRenderer);
  });
});

describe('getToolRenderer — broken hyphenated key variants (regression guard)', () => {
  it('mcp__task-manager__create_task → GenericToolRenderer (no custom renderer registered)', () => {
    // These are the tool names that were accidentally generated after commit f847111
    // changed the server key from 'taskManager' to 'task-manager'.  There should be
    // no custom renderer for them — the fix is in chat-agent-service.ts restoring
    // the original 'taskManager' key, not in adding hyphenated aliases here.
    const renderer = getToolRenderer('mcp__task-manager__create_task');
    expect(renderer).toBe(GenericToolRenderer);
  });

  it('mcp__task-manager__get_task → GenericToolRenderer (no custom renderer registered)', () => {
    const renderer = getToolRenderer('mcp__task-manager__get_task');
    expect(renderer).toBe(GenericToolRenderer);
  });
});

describe('getToolRenderer — unknown tool falls back to GenericToolRenderer', () => {
  it('returns GenericToolRenderer for an unrecognised tool name', () => {
    const renderer = getToolRenderer('some_unknown_tool');
    expect(renderer).toBe(GenericToolRenderer);
  });
});
