import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTask } from '../../hooks/useTasks';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { InlineError } from '../InlineError';

interface TaskSubPageLayoutProps {
  taskId: string;
  tabLabel: string;
  tabKey: string;           // localStorage tab key value to restore on back
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function TaskSubPageLayout({ taskId, tabLabel, tabKey, actions, children }: TaskSubPageLayoutProps) {
  const navigate = useNavigate();
  const { task, loading, error } = useTask(taskId);
  const [, setTab] = useLocalStorage(`taskDetail.tab.${taskId}`, 'details');

  const handleBack = () => {
    setTab(tabKey);
    navigate(`/tasks/${taskId}`);
  };

  if (loading && !task) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="p-8">
        <InlineError message={error || 'Task not found'} context="Task sub-page" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 48, minHeight: 48,
        borderBottom: '1px solid var(--border)', padding: '0 24px', gap: 12, flexShrink: 0,
        background: 'var(--card)',
      }}>
        <button
          onClick={handleBack}
          style={{ fontSize: 13, color: 'var(--muted-foreground)', cursor: 'pointer', background: 'none', border: 'none', padding: '2px 4px' }}
        >
          &larr; Back to Task
        </button>
        <span style={{ color: 'var(--border)', fontSize: 13 }}>/</span>
        <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
          {task.title}
        </span>
        <span style={{ color: 'var(--border)', fontSize: 13 }}>/</span>
        <span style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 500 }}>{tabLabel}</span>
        {actions && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {actions}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
