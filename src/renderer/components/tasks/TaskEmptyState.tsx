import React from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { ListTodo, SearchX } from 'lucide-react';

interface TaskEmptyStateProps {
  hasFilters: boolean;
  onClearFilters: () => void;
  onCreateTask: () => void;
}

export function TaskEmptyState({ hasFilters, onClearFilters, onCreateTask }: TaskEmptyStateProps) {
  if (hasFilters) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <SearchX className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-1">No tasks match your filters</p>
          <Button variant="outline" size="sm" onClick={onClearFilters} className="mt-3">
            Clear Filters
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-12 text-center">
        <ListTodo className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground mb-1">No tasks yet</p>
        <p className="text-sm text-muted-foreground mb-4">Create your first task to get started</p>
        <Button onClick={onCreateTask}>New Task</Button>
      </CardContent>
    </Card>
  );
}
