import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/button';
import { ReviewConversation } from './ReviewConversation';
import { useReviewConversation } from '../../hooks/useReviewConversation';
import { reportError } from '../../lib/error-handler';
import type { TaskContextEntry, Transition } from '../../../shared/types';

interface FullscreenReviewOverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string | null;
  renderContent: (content: string) => React.ReactNode;
  entries: TaskContextEntry[];
  isReviewStatus: boolean;
  transitions: Transition[];
  transitioning: string | null;
  approveToStatus?: string;
  reviseToStatus?: string;
  onAction: (toStatus: string, comment: string) => Promise<void>;
  taskId?: string;
  agentRole?: string;
  entryType: string;
  onEntriesChanged: () => void;
}

export function FullscreenReviewOverlay({
  open,
  onClose,
  title,
  content,
  renderContent,
  entries,
  isReviewStatus,
  transitions,
  transitioning,
  approveToStatus = 'implementing',
  reviseToStatus,
  onAction,
  taskId,
  agentRole,
  entryType,
  onEntriesChanged,
}: FullscreenReviewOverlayProps) {
  const approveTransition = transitions.find((t) => t.to === approveToStatus);
  const reviseTransition = reviseToStatus ? transitions.find((t) => t.to === reviseToStatus) : undefined;

  const { streamingMessages, isStreaming, sendMessage, stopChat } = useReviewConversation(
    taskId,
    agentRole,
    entryType,
    onEntriesChanged,
  );

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const handleApprove = useCallback(() => {
    if (approveTransition) {
      onAction(approveTransition.to, '').catch((err) => {
        reportError(err instanceof Error ? err : new Error(String(err)), 'Approve transition');
      });
    }
  }, [approveTransition, onAction]);

  const handleRequestChanges = useCallback(() => {
    if (reviseTransition) {
      onAction(reviseTransition.to, '').catch((err) => {
        reportError(err instanceof Error ? err : new Error(String(err)), 'Request changes transition');
      });
    }
  }, [reviseTransition, onAction]);

  if (!open) return null;

  const appRoot = document.getElementById('root');
  if (!appRoot) return null;

  return createPortal(
    <div className="absolute inset-0 z-50" style={{ backgroundColor: 'var(--background, #fff)' }}>
      {/* Top bar */}
      <div
        style={{
          height: '52px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          flexShrink: 0,
        }}
      >
        <h2 className="text-lg font-semibold flex-1">{title} Review</h2>
        <div className="flex items-center gap-2">
          {isReviewStatus && approveTransition && (
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={transitioning !== null}
            >
              {transitioning === approveTransition.to ? 'Approving...' : approveTransition.label || 'Approve & Implement'}
            </Button>
          )}
          {isReviewStatus && reviseTransition && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRequestChanges}
              disabled={transitioning !== null}
            >
              {transitioning === reviseTransition.to ? 'Requesting...' : reviseTransition.label || 'Request Changes'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="ml-2"
          >
            ✕
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', height: 'calc(100% - 52px)' }}>
        {/* Left panel — content */}
        <div
          style={{
            width: '60%',
            borderRight: '1px solid var(--border)',
            overflowY: 'auto',
            padding: '24px',
          }}
        >
          {content ? (
            renderContent(content)
          ) : (
            <p className="text-sm text-muted-foreground">No content available yet.</p>
          )}
        </div>

        {/* Right panel — conversation */}
        <div style={{ width: '40%', display: 'flex', flexDirection: 'column' }}>
          <ReviewConversation
            entries={entries}
            isReviewStatus={isReviewStatus}
            streamingMessages={streamingMessages}
            isStreaming={isStreaming}
            onSend={sendMessage}
            onStop={stopChat}
            placeholder={`Ask about the ${title.toLowerCase()} or request changes...`}
          />
        </div>
      </div>
    </div>,
    appRoot,
  );
}
