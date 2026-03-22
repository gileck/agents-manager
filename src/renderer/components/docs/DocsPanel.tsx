import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { PlanMarkdown } from '../task-detail/PlanMarkdown';
import { MarkdownContent } from '../chat/MarkdownContent';
import { DOC_PHASES, getPhaseByDocType, getPhaseByReviewStatus } from '../../../shared/doc-phases';
import type { Task, TaskDoc, TaskContextEntry, Transition, DocArtifactType, PipelineStatus } from '../../../shared/types';

interface DocsPanelProps {
  task: Task;
  docs: TaskDoc[];
  contextEntries: TaskContextEntry[];
  transitions: Transition[];
  transitioning: string | null;
  onAction: (toStatus: string, comment: string, feedbackType: string) => Promise<void>;
  /** Pipeline statuses for computing the "Approved" badge. */
  pipelineStatuses?: PipelineStatus[];
}

export function DocsPanel({
  task,
  docs,
  contextEntries,
  transitions,
  transitioning,
  onAction,
  pipelineStatuses,
}: DocsPanelProps) {
  const navigate = useNavigate();

  // Determine default selection
  const defaultDocType = useMemo(() => {
    // 1. If task is in a review status matching a DOC_PHASES entry, select that doc type
    const reviewPhase = getPhaseByReviewStatus(task.status);
    if (reviewPhase) return reviewPhase.docType;

    // 2. Otherwise select the first doc that has content
    for (const phase of DOC_PHASES) {
      const doc = docs.find(d => d.type === phase.docType);
      if (doc && doc.content) return doc.type;
    }

    // 3. If no docs exist, return null
    return null;
  }, [task.status, docs]);

  const [selectedType, setSelectedType] = useState<DocArtifactType | null>(defaultDocType);

  // Find selected doc
  const selectedDoc = selectedType ? docs.find(d => d.type === selectedType) ?? null : null;

  // Get phase info for selected doc
  const selectedPhase = selectedType ? getPhaseByDocType(selectedType) : null;

  // Check if the selected doc is in review
  const isSelectedInReview = selectedPhase ? task.status === selectedPhase.reviewStatus : false;

  // Get feedback entries for the selected doc
  const feedbackEntries = selectedPhase
    ? contextEntries.filter(e => e.entryType === selectedPhase.feedbackType)
    : [];

  // Find approve transition
  const approveTransition = transitions.find(t => t.to === 'implementing');

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        minWidth: 200,
        maxWidth: 200,
        borderRight: '1px solid var(--border)',
        overflowY: 'auto',
        flexShrink: 0,
        padding: '8px 0',
      }}>
        {DOC_PHASES.map((phase) => {
          const doc = docs.find(d => d.type === phase.docType);
          const hasContent = !!doc?.content;
          const isInReview = task.status === phase.reviewStatus;
          const isSelected = selectedType === phase.docType;

          // Determine if this doc has been approved: task status is past the review status in pipeline order
          let isApproved = false;
          if (hasContent && !isInReview && pipelineStatuses) {
            const reviewIdx = pipelineStatuses.findIndex(s => s.name === phase.reviewStatus);
            const currentIdx = pipelineStatuses.findIndex(s => s.name === task.status);
            if (reviewIdx >= 0 && currentIdx > reviewIdx) {
              isApproved = true;
            }
          }

          return (
            <button
              key={phase.docType}
              onClick={() => setSelectedType(phase.docType)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 12px',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13,
                background: isSelected ? 'var(--accent)' : 'transparent',
                color: hasContent ? 'var(--foreground)' : 'var(--muted-foreground)',
                opacity: hasContent ? 1 : 0.5,
              }}
            >
              {/* Green dot indicator */}
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: hasContent ? '#3fb950' : 'var(--border)',
                flexShrink: 0,
              }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {phase.docTitle}
              </span>
              {isInReview && (
                <span style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  backgroundColor: 'rgba(59,130,246,0.1)',
                  color: 'rgb(59,130,246)',
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  Review
                </span>
              )}
              {isApproved && (
                <span style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  backgroundColor: 'rgba(63,185,80,0.1)',
                  color: 'rgb(63,185,80)',
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  Approved
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {selectedDoc && selectedPhase ? (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{selectedPhase.docTitle}</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/tasks/${task.id}/${selectedPhase.routeKey}`)}
              >
                Open Review
              </Button>
            </div>
            <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 16 }} />

            {/* Markdown content */}
            <PlanMarkdown content={selectedDoc.content} />

            {/* Quick approve button during review */}
            {isSelectedInReview && approveTransition && (
              <div style={{ display: 'flex', gap: 8, paddingTop: 16, marginTop: 16, borderTop: '1px solid var(--border)' }}>
                <Button
                  onClick={() => onAction(approveTransition.to, '', selectedPhase.feedbackType)}
                  disabled={transitioning !== null}
                >
                  {transitioning === approveTransition.to ? 'Approving...' : approveTransition.label || 'Approve & Implement'}
                </Button>
              </div>
            )}

            {/* Review comments */}
            {feedbackEntries.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <h4 className="text-sm font-semibold text-muted-foreground" style={{ marginBottom: 12 }}>
                  Review Comments ({feedbackEntries.length})
                </h4>
                <div className="space-y-2" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {feedbackEntries.map((entry) => {
                    const isUser = entry.source === 'admin' || entry.source === 'user';
                    return (
                      <div key={entry.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                            isUser ? 'bg-primary/10 text-foreground' : 'bg-muted'
                          }`}
                        >
                          {!isUser && (
                            <span className="text-xs font-semibold text-muted-foreground">{entry.source}</span>
                          )}
                          <div className="prose-sm max-w-none">
                            <MarkdownContent content={entry.summary} />
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(entry.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <p className="text-muted-foreground text-sm">
              {docs.length === 0
                ? 'No documents yet. Documents will appear here as agents complete their work.'
                : 'Select a document from the sidebar to view its content.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
