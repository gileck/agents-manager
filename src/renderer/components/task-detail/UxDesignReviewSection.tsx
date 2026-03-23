import React, { useState, useCallback } from 'react';
import { Monitor, Tablet, Smartphone, Maximize2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { PlanMarkdown } from './PlanMarkdown';
import { reportError } from '../../lib/error-handler';
import type { Transition, TaskContextEntry } from '../../../shared/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UxDesignMock {
  label: string;
  path: string;
}

export interface UxDesignOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  mocks?: UxDesignMock[];
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTHS: Record<ViewportSize, number> = {
  desktop: 1200,
  tablet: 768,
  mobile: 375,
};

interface UxDesignReviewSectionProps {
  taskId: string;
  designOverview: string;
  options: UxDesignOption[];
  feedbackEntries: TaskContextEntry[];
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onRefetch: () => Promise<void> | void;
}

// ─── Mock Iframe Card ─────────────────────────────────────────────────────────

interface MockCardProps {
  taskId: string;
  mock: UxDesignMock;
  onExpand: () => void;
}

function MockCard({ taskId, mock, onExpand }: MockCardProps) {
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [loadError, setLoadError] = useState(false);

  const iframeSrc = `/api/worktree/${taskId}/file?path=${encodeURIComponent(mock.path)}`;

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      {/* Header with label and controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground">{mock.label}</span>
        <div className="flex items-center gap-1">
          <Button
            variant={viewport === 'desktop' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setViewport('desktop')}
            title="Desktop (1200px)"
          >
            <Monitor size={12} />
          </Button>
          <Button
            variant={viewport === 'tablet' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setViewport('tablet')}
            title="Tablet (768px)"
          >
            <Tablet size={12} />
          </Button>
          <Button
            variant={viewport === 'mobile' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setViewport('mobile')}
            title="Mobile (375px)"
          >
            <Smartphone size={12} />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onExpand}
            title="Fullscreen preview"
          >
            <Maximize2 size={12} />
          </Button>
        </div>
      </div>

      {/* Iframe container */}
      <div style={{ height: 400, overflow: 'hidden', display: 'flex', justifyContent: 'center', background: 'var(--background)' }}>
        {loadError ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Mock not available
          </div>
        ) : (
          <iframe
            src={iframeSrc}
            sandbox="allow-scripts"
            title={mock.label}
            onError={() => setLoadError(true)}
            onLoad={(e) => {
              // If the iframe loaded but the content is a 404/error page,
              // we can't easily detect it due to sandbox restrictions.
              // The onError only fires for network-level failures.
              try {
                const frame = e.currentTarget;
                if (frame.contentDocument === null) {
                  // Cross-origin or sandbox restriction — expected
                }
              } catch {
                // Sandbox blocks access — expected behavior
              }
            }}
            style={{
              width: VIEWPORT_WIDTHS[viewport],
              height: '100%',
              border: 'none',
              flexShrink: 0,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Fullscreen Modal ─────────────────────────────────────────────────────────

interface FullscreenMockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  mock: UxDesignMock | null;
}

function FullscreenMockModal({ open, onOpenChange, taskId, mock }: FullscreenMockModalProps) {
  const [viewport, setViewport] = useState<ViewportSize>('desktop');

  if (!mock) return null;

  const iframeSrc = `/api/worktree/${taskId}/file?path=${encodeURIComponent(mock.path)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[90vh]" style={{ width: '95vw', height: '90vh', display: 'flex', flexDirection: 'column' }}>
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle>{mock.label}</DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant={viewport === 'desktop' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewport('desktop')}
              >
                <Monitor size={14} className="mr-1" /> Desktop
              </Button>
              <Button
                variant={viewport === 'tablet' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewport('tablet')}
              >
                <Tablet size={14} className="mr-1" /> Tablet
              </Button>
              <Button
                variant={viewport === 'mobile' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewport('mobile')}
              >
                <Smartphone size={14} className="mr-1" /> Mobile
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', background: 'var(--background)', borderRadius: 8 }}>
          <iframe
            src={iframeSrc}
            sandbox="allow-scripts"
            title={mock.label}
            style={{
              width: VIEWPORT_WIDTHS[viewport],
              height: '100%',
              border: 'none',
              flexShrink: 0,
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UxDesignReviewSection({
  taskId,
  designOverview,
  options,
  feedbackEntries,
  transitions,
  transitioning,
  onTransition,
  onRefetch,
}: UxDesignReviewSectionProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [fullscreenMock, setFullscreenMock] = useState<UxDesignMock | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const feedbackHistory = feedbackEntries.filter(e => e.entryType === 'ux_design_feedback');

  // Identify specific transitions
  const reviseTransition = transitions.find(t => t.to === 'ux_designing');
  const approveTransitions = transitions.filter(t => t.to !== 'ux_designing');

  const handleOpenFullscreen = useCallback((mock: UxDesignMock) => {
    setFullscreenMock(mock);
    setFullscreenOpen(true);
  }, []);

  const handleAction = useCallback(async (toStatus: string, requireFeedback: boolean) => {
    if (requireFeedback && !newComment.trim()) return;
    setSaving(true);
    try {
      if (newComment.trim()) {
        await window.api.tasks.addFeedback(taskId, {
          entryType: 'ux_design_feedback',
          content: newComment.trim(),
        });
        setNewComment('');
        await onRefetch();
      }
      await onTransition(toStatus);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'UX Design review action');
    } finally {
      setSaving(false);
    }
  }, [taskId, newComment, onRefetch, onTransition]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tabs section */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4" style={{ overflowX: 'auto' }}>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {options.map(opt => (
              <TabsTrigger key={opt.id} value={opt.id}>
                {opt.name}{opt.recommended ? ' \u2605' : ''}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Overview tab */}
          <TabsContent value="overview">
            {designOverview ? (
              <PlanMarkdown content={designOverview} />
            ) : (
              <p className="text-sm text-muted-foreground">No design overview available.</p>
            )}
          </TabsContent>

          {/* Option tabs */}
          {options.map(opt => (
            <TabsContent key={opt.id} value={opt.id}>
              {/* Mock iframe gallery */}
              {opt.mocks && opt.mocks.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {opt.mocks.map((mock, i) => (
                    <MockCard
                      key={`${opt.id}-${i}`}
                      taskId={taskId}
                      mock={mock}
                      onExpand={() => handleOpenFullscreen(mock)}
                    />
                  ))}
                </div>
              )}

              {/* Option metadata */}
              <div className="space-y-3">
                <h3 className="text-base font-semibold">{opt.name}</h3>
                {opt.recommended && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    &#9733; Recommended by agent
                  </span>
                )}
                {opt.description && (
                  <PlanMarkdown content={opt.description} />
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Feedback section — fixed at bottom */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px', flexShrink: 0, background: 'var(--card)' }}>
        {/* Feedback history */}
        {feedbackHistory.length > 0 && (
          <div className="space-y-2 mb-3" style={{ maxHeight: 200, overflowY: 'auto' }}>
            {feedbackHistory.map(entry => (
              <div key={entry.id} className={`rounded-md bg-muted px-3 py-2${entry.addressed ? ' opacity-50' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">{entry.source}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  {entry.addressed && (
                    <span className="text-xs bg-muted-foreground/20 text-muted-foreground px-1.5 py-0.5 rounded">
                      Addressed
                    </span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{entry.summary}</p>
              </div>
            ))}
          </div>
        )}

        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Provide feedback on the design options..."
          rows={3}
          className="mb-3"
        />

        <div className="flex gap-2 flex-wrap">
          {reviseTransition && (
            <Button
              variant="outline"
              onClick={() => handleAction(reviseTransition.to, true)}
              disabled={saving || transitioning !== null || !newComment.trim()}
            >
              {transitioning === reviseTransition.to ? 'Requesting...' : reviseTransition.label || 'Request Changes'}
            </Button>
          )}
          {approveTransitions.map(t => (
            <Button
              key={t.to}
              onClick={() => handleAction(t.to, false)}
              disabled={saving || transitioning !== null}
            >
              {transitioning === t.to ? 'Submitting...' : t.label || `Approve & ${t.to}`}
            </Button>
          ))}
        </div>
      </div>

      {/* Fullscreen mock modal */}
      <FullscreenMockModal
        open={fullscreenOpen}
        onOpenChange={setFullscreenOpen}
        taskId={taskId}
        mock={fullscreenMock}
      />
    </div>
  );
}
