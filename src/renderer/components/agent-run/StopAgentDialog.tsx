import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { InlineError } from '../InlineError';
import type { StopAgentResult } from '../../../shared/types';

interface StopAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stopResult: StopAgentResult;
  onTransition: (toStatus: string) => Promise<void>;
}

export function StopAgentDialog({ open, onOpenChange, stopResult, onTransition }: StopAgentDialogProps) {
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { currentStatus, previousStatus, manualTransitions } = stopResult;

  // Filter out transitions that go to the current status (self-loops) or that would start a new agent
  // (transitions to agent_running statuses with start_agent hooks)
  const availableTransitions = manualTransitions.filter(t => t.to !== currentStatus);

  const handleTransition = async (toStatus: string) => {
    setTransitioning(toStatus);
    setError(null);
    try {
      await onTransition(toStatus);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTransitioning(null);
    }
  };

  const handleKeepCurrent = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agent Stopped</DialogTitle>
          <DialogDescription>
            The agent has been stopped. Choose what to do with the task status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-sm text-muted-foreground">
            Current status: <Badge variant="outline" className="ml-1">{currentStatus}</Badge>
          </div>

          {/* Option 1: Revert to previous status */}
          {previousStatus && previousStatus !== currentStatus && (
            <Button
              variant="default"
              className="w-full justify-start"
              disabled={transitioning !== null}
              onClick={() => handleTransition(previousStatus)}
            >
              {transitioning === previousStatus ? 'Reverting...' : `Revert to ${previousStatus}`}
            </Button>
          )}

          {/* Option 2: Keep current status */}
          <Button
            variant="outline"
            className="w-full justify-start"
            disabled={transitioning !== null}
            onClick={handleKeepCurrent}
          >
            Keep current status ({currentStatus})
          </Button>

          {/* Option 3: Move to another status */}
          {availableTransitions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Move to another status:</p>
              {availableTransitions
                .filter(t => t.to !== previousStatus) // already shown above
                .map(t => (
                  <Button
                    key={t.to}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={transitioning !== null}
                    onClick={() => handleTransition(t.to)}
                  >
                    {transitioning === t.to ? 'Moving...' : t.label}
                  </Button>
                ))}
            </div>
          )}
        </div>

        {error && <InlineError message={error} context="Stop agent" />}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleKeepCurrent} disabled={transitioning !== null}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
