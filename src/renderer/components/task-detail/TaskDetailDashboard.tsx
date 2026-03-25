import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { MetricsCard } from './MetricsCard';
import { AgentRunsCard } from './AgentRunsCard';
import { ArtifactsCard } from './ArtifactsCard';
import { GitStatusCard } from './GitStatusCard';
import { DevServerCard } from './DevServerCard';
import { PRChecksCard } from './PRChecksCard';
import { ContextCard } from './ContextCard';
import { PhasedSubtasksSection } from './PhasedSubtasksSection';
import { SubtasksSection } from './SubtasksSection';
import { DependenciesSection } from './DependenciesSection';
import { LinkedBugsSection } from './LinkedBugsSection';
import { PlanMarkdown } from './PlanMarkdown';
import { TriageSummaryCard } from './TriageSummaryCard';
import { TaskCommentsCard } from './TaskCommentsCard';
import { ImagePasteArea } from '../ui/ImagePasteArea';
import type {
  Task, AgentRun, TaskArtifact, PendingPrompt,
  TaskContextEntry, Transition, ChatImage,
} from '../../../shared/types';
import type { QuestionResponse } from '../prompts/QuestionForm';
import { useNavigate } from 'react-router-dom';
import { useFeatures } from '../../hooks/useFeatures';
import { reportError } from '../../lib/error-handler';

interface TaskDetailDashboardProps {
  task: Task;
  taskId: string;
  agentRuns: AgentRun[] | null;
  artifacts: TaskArtifact[] | null;
  pendingPrompts: PendingPrompt[] | null;
  contextEntries: TaskContextEntry[] | null;
  secondaryTransitions: Transition[];
  transitioning: string | null;
  responding: boolean;
  promptError: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onPromptRespond: (promptId: string, responses: QuestionResponse[]) => Promise<void>;
  onRefetch: () => Promise<void> | void;
  onContextRefetch: () => void;
}

export function TaskDetailDashboard({
  task,
  taskId,
  agentRuns,
  artifacts,
  contextEntries,
  secondaryTransitions,
  transitioning,
  onTransition,
  onRefetch,
  onContextRefetch,
}: TaskDetailDashboardProps) {
  const navigate = useNavigate();
  const { features } = useFeatures(task ? { projectId: task.projectId } : undefined);

  // Inline description editing
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionImages, setDescriptionImages] = useState<ChatImage[]>([]);

  const handleStartEditDescription = useCallback(() => {
    setDescriptionDraft(task.description ?? '');
    setDescriptionImages([]);
    setEditingDescription(true);
  }, [task.description]);

  const handleCancelEditDescription = useCallback(() => {
    setEditingDescription(false);
    setDescriptionDraft('');
    setDescriptionImages([]);
  }, []);

  const handleSaveDescription = useCallback(async () => {
    setSavingDescription(true);
    try {
      let description = descriptionDraft;

      // Save screenshots if any
      if (descriptionImages.length > 0) {
        try {
          const { paths } = await window.api.screenshots.save(descriptionImages);
          if (paths.length > 0) {
            const screenshotSection = '\n\n## Screenshots\n' +
              paths.map((p, i) => `![screenshot-${i + 1}](${p})`).join('\n');
            description = description + screenshotSection;
          }
        } catch (err) {
          reportError(err, 'Save screenshots');
        }
      }

      await window.api.tasks.update(taskId, { description });
      setEditingDescription(false);
      setDescriptionImages([]);
      await onRefetch();
    } catch (err) {
      reportError(err, 'Save description');
    } finally {
      setSavingDescription(false);
    }
  }, [taskId, descriptionDraft, descriptionImages, onRefetch]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
      {/* LEFT COLUMN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {/* Description */}
        <Card>
          <CardHeader className="py-3">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <CardTitle className="text-sm">Description</CardTitle>
              {!editingDescription && (
                <button
                  onClick={handleStartEditDescription}
                  title="Edit description"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                    color: 'var(--muted-foreground)', fontSize: 14, lineHeight: 1,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                  </svg>
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {editingDescription ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSaveDescription();
                    } else if (e.key === 'Escape') {
                      handleCancelEditDescription();
                    }
                  }}
                  autoFocus
                  rows={6}
                  style={{
                    width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 13,
                    padding: 8, borderRadius: 6, border: '1px solid var(--border)',
                    backgroundColor: 'var(--background)', color: 'var(--foreground)',
                  }}
                />
                <ImagePasteArea images={descriptionImages} onImagesChange={setDescriptionImages} />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button variant="outline" size="sm" onClick={handleCancelEditDescription} disabled={savingDescription}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveDescription} disabled={savingDescription}>
                    {savingDescription ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : task.description ? (
              <PlanMarkdown content={task.description} />
            ) : (
              <button
                onClick={handleStartEditDescription}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted-foreground)', fontSize: 13, padding: 0,
                }}
              >
                + Add description
              </button>
            )}
          </CardContent>
        </Card>

        {/* Triage Summary */}
        <TriageSummaryCard entries={contextEntries ?? []} />

        {/* Extra metadata */}
        {(task.featureId || task.prLink || task.branchName || task.tags.length > 0 || task.assignee || task.createdBy) && (
          <Card>
            <CardContent className="py-4">
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '0.625rem', alignItems: 'start' }}>
                {task.createdBy && (
                  <>
                    <span className="text-sm text-muted-foreground">Created by</span>
                    <span className="text-sm">{task.createdBy}</span>
                  </>
                )}
                {task.assignee && (
                  <>
                    <span className="text-sm text-muted-foreground">Assignee</span>
                    <span className="text-sm">{task.assignee}</span>
                  </>
                )}
                {task.featureId && (
                  <>
                    <span className="text-sm text-muted-foreground">Feature</span>
                    <span
                      className="text-sm text-blue-500 hover:underline cursor-pointer"
                      onClick={() => navigate(`/features/${task.featureId}`)}
                    >
                      {features.find((f) => f.id === task.featureId)?.title ?? task.featureId}
                    </span>
                  </>
                )}
                {task.prLink && (
                  <>
                    <span className="text-sm text-muted-foreground">PR</span>
                    <button
                      onClick={() => window.api.shell.openInChrome(task.prLink!)}
                      className="text-sm text-blue-500 hover:underline break-all text-left cursor-pointer"
                    >
                      {task.prLink}
                    </button>
                  </>
                )}
                {task.branchName && (
                  <>
                    <span className="text-sm text-muted-foreground">Branch</span>
                    <span className="text-sm font-mono">{task.branchName}</span>
                  </>
                )}
                {task.tags.length > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground">Tags</span>
                    <div className="flex gap-1">
                      {task.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Subtasks */}
        {task.phases && task.phases.length > 1 ? (
          <PhasedSubtasksSection taskId={taskId} phases={task.phases} onUpdate={onRefetch as () => void} />
        ) : (
          <SubtasksSection taskId={taskId} subtasks={task.subtasks} onUpdate={onRefetch as () => void} />
        )}

        {/* Dependencies */}
        <DependenciesSection taskId={taskId} projectId={task.projectId} />

        {/* Linked Bugs */}
        <LinkedBugsSection taskId={taskId} />

        {/* Comments */}
        <TaskCommentsCard taskId={taskId} contextEntries={contextEntries ?? []} onCommentAdded={onContextRefetch} />

        {/* Context (collapsible) */}
        <ContextCard entries={contextEntries ?? []} />

        {/* Secondary transitions */}
        {secondaryTransitions.length > 0 && (
          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-2">Other actions:</p>
            <div className="flex gap-2 flex-wrap">
              {secondaryTransitions.map((t) => (
                <Button
                  key={t.to}
                  variant="ghost"
                  size="sm"
                  onClick={() => onTransition(t.to)}
                  disabled={transitioning !== null}
                >
                  {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <MetricsCard agentRuns={agentRuns} />
        <AgentRunsCard agentRuns={agentRuns} onNavigateToRun={(runId) => navigate(`/agents/${runId}`)} />
        <ArtifactsCard artifacts={artifacts} />
        {task.prLink && <PRChecksCard taskId={taskId} />}
        <GitStatusCard taskId={taskId} />
        <DevServerCard taskId={taskId} />
      </div>
    </div>
  );
}
