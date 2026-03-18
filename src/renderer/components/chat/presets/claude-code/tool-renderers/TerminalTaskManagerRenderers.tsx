/**
 * Terminal-style renderers for task-manager MCP tool calls.
 * Each renderer shows relevant structured info instead of raw JSON.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, truncateInline, safeParseInput,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, preStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

// --- Shared helpers ---

function safeParseResult(result: string | undefined): Record<string, unknown> {
  if (!result) return {};
  try { return JSON.parse(result); }
  catch { return {}; }
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '1px 0' }}>
      <span style={{ color: '#6b7280', minWidth: 60, flexShrink: 0 }}>{label}:</span>
      <span style={{ color: '#d1d5db', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

// --- 1. create_task ---

export function TerminalCreateTaskRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const input = safeParseInput(toolUse.input);
  const title = (input.title as string) || '';
  const hasResult = !!toolResult;
  const result = safeParseResult(toolResult?.result);

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>create_task</span>
        {title && (
          <>
            <span style={argStyle}>(</span>
            <span style={{ color: '#d1d5db', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {truncateInline(title, 60)}
            </span>
            <span style={argStyle}>)</span>
          </>
        )}
      </div>

      <div style={resultRowStyle}>
        <span style={connectorStyle}>└ </span>
        {!hasResult
          ? <span style={runningStyle}>running...</span>
          : <span style={{ color: '#22c55e', fontSize: 12 }}>created</span>
        }
      </div>

      {hasResult && expanded && (
        <div style={expandedContentStyle}>
          <div style={{ ...preStyle }}>
            {result.id != null && <FieldRow label="id" value={String(result.id).slice(0, 12)} />}
            {result.title != null && <FieldRow label="title" value={String(result.title)} />}
            {result.status != null && <FieldRow label="status" value={String(result.status)} />}
            {result.type != null && <FieldRow label="type" value={String(result.type)} />}
            {result.priority != null && <FieldRow label="priority" value={String(result.priority)} />}
            {result.description != null && (
              <FieldRow label="desc" value={truncateInline(String(result.description), 200)} />
            )}
            {result.tags != null && Array.isArray(result.tags) && (result.tags as string[]).length > 0 && (
              <FieldRow label="tags" value={(result.tags as string[]).join(', ')} />
            )}
            {result.pipelineId != null && <FieldRow label="pipeline" value={String(result.pipelineId)} />}
          </div>
        </div>
      )}
    </div>
  );
}

// --- 2. update_task ---

export function TerminalUpdateTaskRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const input = safeParseInput(toolUse.input);
  const taskId = (input.taskId as string) || '';
  const updatedFields = Object.keys(input).filter((k) => k !== 'taskId');
  const hasResult = !!toolResult;
  const result = safeParseResult(toolResult?.result);

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>update_task</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#d1d5db' }}>{taskId.slice(0, 8)}</span>
        <span style={argStyle}>)</span>
      </div>

      <div style={resultRowStyle}>
        <span style={connectorStyle}>└ </span>
        {!hasResult
          ? <span style={runningStyle}>running...</span>
          : <span style={{ color: '#9ca3af', fontSize: 12 }}>
              updated {updatedFields.length} field{updatedFields.length !== 1 ? 's' : ''}
            </span>
        }
      </div>

      {hasResult && expanded && (
        <div style={expandedContentStyle}>
          <div style={{ ...preStyle }}>
            {result.id != null && <FieldRow label="id" value={String(result.id).slice(0, 12)} />}
            {updatedFields.map((field) => (
              <FieldRow key={field} label={field} value={truncateInline(String(input[field]), 100)} />
            ))}
            {result.title != null && !updatedFields.includes('title') && (
              <FieldRow label="title" value={truncateInline(String(result.title), 80)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- 3. list_tasks ---

interface TaskSummary {
  title?: string;
  status?: string;
  id?: string;
  priority?: string;
  type?: string;
  assignee?: string;
}

export function TerminalListTasksRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const input = safeParseInput(toolUse.input);
  const statusFilter = (input.status as string) || '';
  const hasResult = !!toolResult;

  let tasks: TaskSummary[];
  try {
    const parsed = JSON.parse(toolResult?.result ?? '[]');
    tasks = Array.isArray(parsed) ? parsed : [];
  } catch {
    tasks = [];
  }

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>list_tasks</span>
        {statusFilter && (
          <>
            <span style={argStyle}>(</span>
            <span style={{ color: '#d1d5db' }}>{statusFilter}</span>
            <span style={argStyle}>)</span>
          </>
        )}
      </div>

      <div style={resultRowStyle}>
        <span style={connectorStyle}>└ </span>
        {!hasResult
          ? <span style={runningStyle}>running...</span>
          : <span style={{ color: '#9ca3af', fontSize: 12 }}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''}
            </span>
        }
      </div>

      {hasResult && expanded && (
        <div style={expandedContentStyle}>
          <div style={preStyle}>
            {tasks.map((task, i) => (
              <div key={i} style={{ padding: '1px 0', color: '#d1d5db' }}>
                <span style={{ color: '#6b7280' }}>[{task.status || '?'}]</span>{' '}
                {truncateInline(task.title || '(untitled)', 55)}
                {(task.priority || task.type || task.assignee || task.id) && (
                  <span style={{ color: '#6b7280' }}>
                    {' ('}
                    {[
                      task.priority,
                      task.type,
                      task.assignee,
                      task.id ? task.id.slice(0, 8) : undefined,
                    ].filter(Boolean).join(', ')}
                    {')'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- 4. get_task ---

export function TerminalGetTaskRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const input = safeParseInput(toolUse.input);
  const taskId = (input.taskId as string) || '';
  const hasResult = !!toolResult;
  const result = safeParseResult(toolResult?.result);
  const taskTitle = (result.title as string) || '';

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>get_task</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#d1d5db' }}>{truncateInline(taskId, 40)}</span>
        <span style={argStyle}>)</span>
      </div>

      <div style={resultRowStyle}>
        <span style={connectorStyle}>└ </span>
        {!hasResult
          ? <span style={runningStyle}>running...</span>
          : <span style={{ color: '#9ca3af', fontSize: 12 }}>
              {truncateInline(taskTitle, 60) || '(no title)'}
            </span>
        }
      </div>

      {hasResult && expanded && (
        <div style={expandedContentStyle}>
          <div style={{ ...preStyle }}>
            {result.title != null && <FieldRow label="title" value={String(result.title)} />}
            {result.status != null && <FieldRow label="status" value={String(result.status)} />}
            {result.type != null && <FieldRow label="type" value={String(result.type)} />}
            {result.priority != null && <FieldRow label="priority" value={String(result.priority)} />}
            {result.size != null && <FieldRow label="size" value={String(result.size)} />}
            {result.complexity != null && <FieldRow label="complexity" value={String(result.complexity)} />}
            {result.assignee != null && <FieldRow label="assignee" value={String(result.assignee)} />}
            {result.tags != null && Array.isArray(result.tags) && (result.tags as string[]).length > 0 && (
              <FieldRow label="tags" value={(result.tags as string[]).join(', ')} />
            )}
            {result.branchName != null && <FieldRow label="branch" value={String(result.branchName)} />}
            {result.prLink != null && <FieldRow label="prLink" value={String(result.prLink)} />}
            {result.description != null && (
              <FieldRow label="desc" value={truncateInline(String(result.description), 200)} />
            )}
            {result.plan != null && (
              <FieldRow label="plan" value={truncateInline(String(result.plan), 200)} />
            )}
            {result.subtasks != null && Array.isArray(result.subtasks) && (
              <FieldRow label="subtasks" value={`${(result.subtasks as unknown[]).length} subtask${(result.subtasks as unknown[]).length !== 1 ? 's' : ''}`} />
            )}
            {result.createdAt != null && <FieldRow label="created" value={String(result.createdAt)} />}
            {result.updatedAt != null && <FieldRow label="updated" value={String(result.updatedAt)} />}
          </div>
        </div>
      )}
    </div>
  );
}

// --- 5. transition_task ---

export function TerminalTransitionTaskRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const input = safeParseInput(toolUse.input);
  const taskId = (input.taskId as string) || '';
  const targetStatus = (input.targetStatus as string) || '';
  const hasResult = !!toolResult;
  const result = safeParseResult(toolResult?.result);
  const succeeded = hasResult && !result.error;

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>transition_task</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#d1d5db' }}>{truncateInline(taskId, 20)}</span>
        {targetStatus && (
          <span style={{ color: '#9ca3af' }}>{' '}→{' '}{targetStatus}</span>
        )}
        <span style={argStyle}>)</span>
      </div>

      <div style={resultRowStyle}>
        <span style={connectorStyle}>└ </span>
        {!hasResult
          ? <span style={runningStyle}>running...</span>
          : succeeded
            ? <span style={{ color: '#22c55e', fontSize: 12 }}>done</span>
            : <span style={{ color: '#ef4444', fontSize: 12 }}>failed</span>
        }
      </div>

      {hasResult && expanded && (
        <div style={expandedContentStyle}>
          <div style={{ ...preStyle }}>
            {taskId && <FieldRow label="taskId" value={taskId.slice(0, 12)} />}
            {targetStatus && <FieldRow label="target" value={targetStatus} />}
            {result.error
              ? <span style={{ color: '#ef4444' }}>{String(result.error)}</span>
              : <span style={{ color: '#22c55e' }}>
                  {result.message ? String(result.message) : 'Transition successful'}
                </span>
            }
          </div>
        </div>
      )}
    </div>
  );
}

// --- 6. list_agent_runs ---

interface AgentRunSummary {
  status?: string;
  taskId?: string;
  agentType?: string;
  id?: string;
  model?: string;
  engine?: string;
  duration?: number;
  messageCount?: number;
  cost?: number;
  outcome?: string;
}

export function TerminalListAgentRunsRenderer({ toolResult, expanded, onToggle }: ToolRendererProps) {
  const hasResult = !!toolResult;

  let runs: AgentRunSummary[];
  try {
    const parsed = JSON.parse(toolResult?.result ?? '[]');
    runs = Array.isArray(parsed) ? parsed : [];
  } catch {
    runs = [];
  }

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>list_agent_runs</span>
      </div>

      <div style={resultRowStyle}>
        <span style={connectorStyle}>└ </span>
        {!hasResult
          ? <span style={runningStyle}>running...</span>
          : <span style={{ color: '#9ca3af', fontSize: 12 }}>
              {runs.length} run{runs.length !== 1 ? 's' : ''}
            </span>
        }
      </div>

      {hasResult && expanded && (
        <div style={expandedContentStyle}>
          <div style={preStyle}>
            {runs.map((run, i) => (
              <div key={i} style={{ padding: '2px 0', color: '#d1d5db' }}>
                <span style={{ color: '#6b7280' }}>[{run.status || '?'}]</span>{' '}
                {truncateInline(run.taskId || '?', 20)}{' '}
                <span style={{ color: '#9ca3af' }}>{run.agentType || ''}</span>
                {(run.model || run.engine || run.duration != null || run.messageCount != null || run.cost != null || run.outcome) && (
                  <span style={{ color: '#6b7280' }}>
                    {' ('}
                    {[
                      run.model,
                      run.engine,
                      run.duration != null ? `${Math.round(run.duration / 1000)}s` : undefined,
                      run.messageCount != null ? `${run.messageCount} msgs` : undefined,
                      run.cost != null ? `$${run.cost.toFixed(2)}` : undefined,
                      run.outcome,
                    ].filter(Boolean).join(', ')}
                    {')'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
