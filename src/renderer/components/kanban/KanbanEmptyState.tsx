import React from 'react';
import { Button } from '../ui/button';
import { Plus, Inbox, Filter } from 'lucide-react';
import type { ColumnColorTheme } from '../../utils/kanban-colors';

interface KanbanEmptyStateProps {
  variant: 'board' | 'column' | 'filtered';
  onAction?: () => void;
  isOver?: boolean;
  colorTheme?: ColumnColorTheme;
}

export function KanbanEmptyState({ variant, onAction, isOver, colorTheme }: KanbanEmptyStateProps) {
  if (variant === 'column') {
    return (
      <div
        className="text-center text-muted-foreground text-sm py-8 rounded-lg transition-all duration-200"
        style={isOver ? { backgroundColor: 'rgba(59, 130, 246, 0.05)', border: '2px dashed rgba(59, 130, 246, 0.3)' } : {}}
      >
        {isOver ? (
          <div className="space-y-2">
            <div className="text-primary font-medium">Drop here</div>
          </div>
        ) : (
          <div className="space-y-2">
            <Inbox
              className="w-8 h-8 mx-auto"
              style={colorTheme ? colorTheme.emptyIconStyle : { opacity: 0.5 }}
            />
            <div style={{ opacity: 0.6 }}>No tasks</div>
          </div>
        )}
      </div>
    );
  }

  if (variant === 'filtered') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4" style={{ maxWidth: '28rem' }}>
          <div
            className="flex items-center justify-center mx-auto rounded-2xl"
            style={{ width: '64px', height: '64px', background: 'linear-gradient(to bottom right, rgba(245, 158, 11, 0.2), rgba(249, 115, 22, 0.2))' }}
          >
            <Filter className="w-8 h-8" style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">No tasks match your filters</h3>
            <p className="text-sm text-muted-foreground">
              Try adjusting your filter settings to see more tasks
            </p>
          </div>
          {onAction && (
            <Button variant="outline" onClick={onAction}>
              Clear Filters
            </Button>
          )}
        </div>
      </div>
    );
  }

  // variant === 'board'
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-4" style={{ maxWidth: '28rem' }}>
        <div
          className="flex items-center justify-center mx-auto rounded-2xl"
          style={{ width: '80px', height: '80px', background: 'linear-gradient(to bottom right, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))' }}
        >
          <Inbox className="w-10 h-10" style={{ color: '#3b82f6' }} />
        </div>
        <div>
          <h3 className="font-semibold text-lg mb-2">No tasks yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Get started by creating your first task
          </p>
        </div>
        {onAction && (
          <Button
            onClick={onAction}
            style={{ background: 'linear-gradient(to right, #2563eb, #7c3aed)', color: '#fff', border: 'none', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Task
          </Button>
        )}
      </div>
    </div>
  );
}
