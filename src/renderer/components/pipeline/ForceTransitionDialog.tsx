import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import type { PipelineStatus, GuardCheckResult } from '../../../shared/types';

interface ForceTransitionDialogProps {
  open: boolean;
  onClose: () => void;
  onForce: (toStatus: string) => void;
  forcing: boolean;
  forceError?: string | null;
  statuses: PipelineStatus[];
  currentStatus: string;
  taskId: string;
}

export function ForceTransitionDialog({
  open,
  onClose,
  onForce,
  forcing,
  forceError,
  statuses,
  currentStatus,
  taskId,
}: ForceTransitionDialogProps) {
  const [targetStatus, setTargetStatus] = useState('');
  const [guardCheck, setGuardCheck] = useState<GuardCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [guardCheckError, setGuardCheckError] = useState(false);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setTargetStatus('');
      setGuardCheck(null);
    }
  }, [open]);

  // Pre-check guards when target changes
  useEffect(() => {
    if (!targetStatus || !taskId) {
      setGuardCheck(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    setGuardCheckError(false);
    window.api.tasks.guardCheck(taskId, targetStatus, 'manual')
      .then((result) => {
        if (!cancelled) setGuardCheck(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setGuardCheck(null);
          setGuardCheckError(true);
          console.error('Guard check failed:', err);
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [targetStatus, taskId]);

  if (!open) return null;

  const availableStatuses = statuses.filter((s) => s.name !== currentStatus);

  const appRoot = document.getElementById('app-root');
  if (!appRoot) return null;

  return createPortal(
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-10 rounded-lg shadow-xl p-6"
        style={{ backgroundColor: 'var(--background, #fff)', width: '420px', maxWidth: '90%' }}
      >
        <h3 className="text-lg font-semibold mb-1">Force Transition</h3>
        <p className="text-sm text-muted-foreground mb-4">
          This bypasses all guard checks. Use only for recovery from stuck states.
        </p>

        {/* Target status */}
        <div className="mb-4">
          <label className="text-sm font-medium mb-1 block">Target Status</label>
          <Select value={targetStatus} onValueChange={setTargetStatus}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select target status..." />
            </SelectTrigger>
            <SelectContent>
              {availableStatuses.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.label || s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Guard pre-check results */}
        {targetStatus && (
          <div className="mb-4 rounded-md border p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Guard Pre-Check {checking && '(checking...)'}
            </div>
            {guardCheck === null && !checking && !guardCheckError && (
              <p className="text-xs text-muted-foreground">No transition defined for this path</p>
            )}
            {guardCheckError && !checking && (
              <p className="text-xs" style={{ color: '#dc2626' }}>Failed to check guards</p>
            )}
            {guardCheck && guardCheck.results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs mb-1">
                <span style={{ color: r.allowed ? '#22c55e' : '#ef4444' }}>
                  {r.allowed ? '\u2713' : '\u2717'}
                </span>
                <span className="font-mono">{r.guard}</span>
                {r.reason && !r.allowed && (
                  <span className="text-muted-foreground">— {r.reason}</span>
                )}
              </div>
            ))}
            {guardCheck && guardCheck.canTransition && (
              <p className="text-xs mt-2" style={{ color: '#22c55e' }}>
                All guards pass — consider using normal transition instead
              </p>
            )}
          </div>
        )}

        {/* Force error */}
        {forceError && (
          <div
            className="mb-4 rounded-md px-3 py-2 text-xs"
            style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}
          >
            {forceError}
          </div>
        )}

        {/* Warning */}
        <div
          className="mb-4 rounded-md px-3 py-2 text-xs"
          style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a533' }}
        >
          Warning: Force transitions skip guard checks and may leave the task in an inconsistent state.
          Hooks will still run.
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={forcing}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!targetStatus || forcing}
            onClick={() => onForce(targetStatus)}
          >
            {forcing ? 'Forcing...' : 'Force Transition'}
          </Button>
        </div>
      </div>
    </div>,
    appRoot,
  );
}
