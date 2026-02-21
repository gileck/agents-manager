import React from 'react';
import { Button } from '../ui/button';
import { Plus, Inbox, Filter } from 'lucide-react';

interface KanbanEmptyStateProps {
  variant: 'board' | 'column' | 'filtered';
  onAction?: () => void;
  isOver?: boolean;
}

export function KanbanEmptyState({ variant, onAction, isOver }: KanbanEmptyStateProps) {
  if (variant === 'column') {
    return (
      <div className="text-center text-muted-foreground text-sm py-8">
        {isOver ? (
          <div className="space-y-2">
            <div className="text-primary font-medium">Drop here</div>
          </div>
        ) : (
          <div className="space-y-2">
            <Inbox className="w-8 h-8 mx-auto opacity-50" />
            <div>No tasks</div>
          </div>
        )}
      </div>
    );
  }

  if (variant === 'filtered') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md space-y-4">
          <Filter className="w-12 h-12 mx-auto text-muted-foreground opacity-50" />
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
      <div className="text-center max-w-md space-y-4">
        <Inbox className="w-16 h-16 mx-auto text-muted-foreground opacity-50" />
        <div>
          <h3 className="font-semibold text-lg mb-2">No tasks yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Get started by creating your first task
          </p>
        </div>
        {onAction && (
          <Button onClick={onAction}>
            <Plus className="w-4 h-4 mr-2" />
            Create Task
          </Button>
        )}
      </div>
    </div>
  );
}
