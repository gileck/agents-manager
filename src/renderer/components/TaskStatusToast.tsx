/**
 * Custom toast component for task status change notifications.
 *
 * Rendered via `toast.custom()` so the entire toast body is clickable
 * (navigates to task detail page). Action buttons stop propagation to
 * prevent the body click from also firing.
 */
import React from 'react';
import { toast } from 'sonner';

export interface TaskStatusToastAction {
  label: string;
  onClick: () => void;
}

interface TaskStatusToastProps {
  toastId: string | number;
  title: string;
  statusLabel: string;
  onBodyClick: () => void;
  primaryAction?: TaskStatusToastAction;
  secondaryAction?: TaskStatusToastAction;
}

export function TaskStatusToast({
  toastId,
  title,
  statusLabel,
  onBodyClick,
  primaryAction,
  secondaryAction,
}: TaskStatusToastProps) {
  return (
    <div
      onClick={onBodyClick}
      style={{
        cursor: 'pointer',
        padding: '16px',
        borderRadius: '14px',
        backdropFilter: 'blur(12px)',
        backgroundColor: 'var(--popover, #fff)',
        color: 'var(--popover-foreground, #111)',
        border: '1px solid var(--border, #e5e7eb)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        fontFamily: '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        width: '356px',
        maxWidth: '100%',
      }}
    >
      <div style={{ fontWeight: 500, fontSize: '14px', lineHeight: '20px' }}>
        {title}
      </div>
      <div style={{
        fontSize: '13px',
        lineHeight: '18px',
        color: 'var(--muted-foreground, #6b7280)',
        marginTop: '4px',
      }}>
        Status: {statusLabel}
      </div>
      {(primaryAction || secondaryAction) && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {primaryAction && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                primaryAction.onClick();
                toast.dismiss(toastId);
              }}
              style={{
                fontSize: '13px',
                fontWeight: 500,
                padding: '4px 12px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--primary, #111)',
                color: 'var(--primary-foreground, #fff)',
              }}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                secondaryAction.onClick();
                toast.dismiss(toastId);
              }}
              style={{
                fontSize: '13px',
                fontWeight: 500,
                padding: '4px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border, #e5e7eb)',
                cursor: 'pointer',
                backgroundColor: 'transparent',
                color: 'var(--foreground, #111)',
              }}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
