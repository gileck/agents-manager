import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { GuardStatusIndicator } from './GuardStatusIndicator';
import type { AllTransitionsResult, TransitionWithGuards } from '../../../shared/types';

interface TransitionMapProps {
  allTransitions: AllTransitionsResult;
  transitioning: string | null;
  onTransition: (toStatus: string) => void;
  onOpenForceDialog: () => void;
}

function TransitionRow({
  transition,
  isManual,
  transitioning,
  onTransition,
}: {
  transition: TransitionWithGuards;
  isManual: boolean;
  transitioning: string | null;
  onTransition: (toStatus: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50">
      {isManual ? (
        <Button
          variant="outline"
          size="sm"
          disabled={transitioning !== null}
          onClick={() => onTransition(transition.to)}
          className="text-xs"
        >
          {transitioning === transition.to ? '...' : (transition.label || `\u2192 ${transition.to}`)}
        </Button>
      ) : (
        <span className="text-xs font-mono text-muted-foreground px-2">
          {transition.label || `\u2192 ${transition.to}`}
        </span>
      )}

      {isManual && transition.guardStatus && (
        <GuardStatusIndicator guardStatus={transition.guardStatus} />
      )}

      {transition.guards && transition.guards.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {transition.guards.map((g) => g.name).join(', ')}
        </span>
      )}

      {transition.hooks && transition.hooks.length > 0 && (
        <span className="text-xs text-muted-foreground italic ml-auto">
          hooks: {transition.hooks.map((h) => h.name).join(', ')}
        </span>
      )}

      {transition.agentOutcome && (
        <Badge variant="outline" className="text-xs ml-auto">
          outcome: {transition.agentOutcome}
        </Badge>
      )}
    </div>
  );
}

export function TransitionMap({
  allTransitions,
  transitioning,
  onTransition,
  onOpenForceDialog,
}: TransitionMapProps) {
  const [expanded, setExpanded] = useState(false);

  const totalCount =
    allTransitions.manual.length +
    allTransitions.agent.length +
    allTransitions.system.length;

  if (totalCount === 0) return null;

  return (
    <div className="mb-4 rounded-md border">
      <button
        className="w-full px-4 py-2 flex items-center justify-between text-sm text-muted-foreground hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          Pipeline Details ({totalCount} transition{totalCount !== 1 ? 's' : ''})
        </span>
        <span>{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t">
          {/* Manual transitions */}
          {allTransitions.manual.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                Manual
              </div>
              {allTransitions.manual.map((t, i) => (
                <TransitionRow
                  key={`manual-${i}`}
                  transition={t}
                  isManual={true}
                  transitioning={transitioning}
                  onTransition={onTransition}
                />
              ))}
            </div>
          )}

          {/* Agent transitions */}
          {allTransitions.agent.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                Agent
              </div>
              {allTransitions.agent.map((t, i) => (
                <TransitionRow
                  key={`agent-${i}`}
                  transition={t}
                  isManual={false}
                  transitioning={transitioning}
                  onTransition={onTransition}
                />
              ))}
            </div>
          )}

          {/* System transitions */}
          {allTransitions.system.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                System
              </div>
              {allTransitions.system.map((t, i) => (
                <TransitionRow
                  key={`system-${i}`}
                  transition={t}
                  isManual={false}
                  transitioning={transitioning}
                  onTransition={onTransition}
                />
              ))}
            </div>
          )}

          {/* Force transition button */}
          <div className="mt-3 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenForceDialog}
              className="text-xs"
              style={{ borderColor: '#dc2626', color: '#dc2626' }}
            >
              Force Transition...
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
