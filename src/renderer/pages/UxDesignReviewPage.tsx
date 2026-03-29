import React, { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InlineError } from '../components/InlineError';
import { TaskSubPageLayout } from '../components/task-detail/TaskSubPageLayout';
import { UxDesignReviewSection } from '../components/task-detail/UxDesignReviewSection';
import type { UxDesignOption } from '../components/task-detail/UxDesignReviewSection';
import { useTask } from '../hooks/useTasks';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { reportError } from '../lib/error-handler';
import type { Transition, TaskContextEntry, TaskDoc, DocArtifactType } from '../../shared/types';

// ─── Component ────────────────────────────────────────────────────────────────

export function UxDesignReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const { task, refetch } = useTask(id!);

  const { data: taskDoc, error: docError } = useIpc<TaskDoc | null>(
    () => id ? window.api.taskDocs.get(id, 'ux_design' as DocArtifactType) : Promise.resolve(null),
    [id, task?.status],
  );

  const { data: contextEntries, refetch: refetchContext, error: entriesError } = useIpc<TaskContextEntry[]>(
    () => id ? window.api.tasks.contextEntries(id) : Promise.resolve([]),
    [id],
  );

  const { data: transitions, refetch: refetchTransitions, error: transitionsError } = useIpc<Transition[]>(
    () => id ? window.api.tasks.transitions(id).then(r => r.transitions) : Promise.resolve([]),
    [id, task?.status],
  );

  // ─── Parse TaskDoc JSON ──────────────────────────────────────────────────

  const parsed = useMemo(() => {
    if (!taskDoc?.content) return null;
    try {
      const data = JSON.parse(taskDoc.content) as {
        designOverview?: string;
        options?: UxDesignOption[];
      };
      return data;
    } catch {
      return { _parseError: true } as { _parseError: true };
    }
  }, [taskDoc?.content]);

  const parseError = parsed && '_parseError' in parsed;
  const designOverview = (!parseError && parsed?.designOverview) || '';
  const options: UxDesignOption[] = (!parseError && parsed && 'options' in parsed && Array.isArray(parsed.options)) ? parsed.options : [];

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleTransition = useCallback(async (toStatus: string) => {
    if (!id) return;
    setTransitioning(toStatus);
    try {
      const result = await window.api.tasks.transition(id, toStatus, 'admin');
      if (result.success) {
        await refetch();
        await refetchTransitions();
        navigate(`/tasks/${id}`);
      } else {
        const msg = result.guardFailures?.map((g: { reason: string }) => g.reason).join('; ')
          ?? result.error ?? 'Transition failed';
        reportError(new Error(msg), 'UX Design review transition');
      }
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'UX Design review transition');
    } finally {
      setTransitioning(null);
    }
  }, [id, refetch, refetchTransitions, navigate]);

  // ─── Render ──────────────────────────────────────────────────────────────

  const hasErrors = docError || entriesError || transitionsError;

  return (
    <TaskSubPageLayout taskId={id!} tabLabel="UX Design Review" tabKey="ux-design">
      {hasErrors && (
        <div className="p-4 space-y-2">
          {docError && <InlineError message={docError} context="Loading UX design document" />}
          {entriesError && <InlineError message={entriesError} context="Loading context entries" />}
          {transitionsError && <InlineError message={transitionsError} context="Loading transitions" />}
        </div>
      )}

      {parseError && (
        <div className="p-6">
          <InlineError message="Failed to parse UX design document — the content is not valid JSON." context="UX Design document" />
        </div>
      )}

      {!taskDoc && !docError && (
        <div className="p-6">
          <p className="text-sm text-muted-foreground">No UX design document available yet.</p>
        </div>
      )}

      {taskDoc && !parseError && (
        <UxDesignReviewSection
          taskId={id!}
          designOverview={designOverview}
          options={options}
          feedbackEntries={contextEntries ?? []}
          transitions={transitions ?? []}
          transitioning={transitioning}
          onTransition={handleTransition}
          onRefetch={async () => { await refetchContext(); }}
        />
      )}
    </TaskSubPageLayout>
  );
}
