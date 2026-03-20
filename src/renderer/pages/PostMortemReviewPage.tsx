import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageSquare, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { InlineError } from '../components/InlineError';
import { TaskSubPageLayout } from '../components/task-detail/TaskSubPageLayout';
import { PlanMarkdown } from '../components/task-detail/PlanMarkdown';
import { ReviewConversation } from '../components/plan/ReviewConversation';
import { useReviewConversation } from '../hooks/useReviewConversation';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { reportError } from '../lib/error-handler';
import type { TaskContextEntry } from '../../shared/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuggestedTask {
  title: string;
  description?: string;
  type?: string;
  priority?: number;
  size?: string;
  complexity?: string;
  startPhase?: string;
}

interface PostMortemData {
  rootCause?: string;
  severity?: string;
  responsibleAgents?: string[];
  analysis?: string;
  promptImprovements?: string[];
  processImprovements?: string[];
  suggestedTasks?: SuggestedTask[];
}

// ─── Colour maps ─────────────────────────────────────────────────────────────

const ROOT_CAUSE_COLORS: Record<string, { bg: string; text: string }> = {
  missed_edge_case: { bg: '#f59e0b', text: 'white' },
  design_flaw: { bg: '#dc2626', text: 'white' },
  incomplete_requirements: { bg: '#7c3aed', text: 'white' },
  inadequate_review: { bg: '#f97316', text: 'white' },
  missing_tests: { bg: '#0ea5e9', text: 'white' },
  other: { bg: '#6b7280', text: 'white' },
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  minor: { bg: '#22c55e', text: 'white' },
  moderate: { bg: '#f59e0b', text: 'white' },
  major: { bg: '#dc2626', text: 'white' },
};

// ─── Report panel (left side) ─────────────────────────────────────────────────

function PostMortemReport({
  data,
  taskId,
  onTaskCreated,
}: {
  data: PostMortemData;
  taskId: string;
  onTaskCreated: () => void;
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);

  const handleCreateTask = async (suggested: SuggestedTask) => {
    setCreating(suggested.title);
    try {
      const settings = await window.api.settings.get();
      const projectId = settings.currentProjectId;
      if (!projectId) { toast.error('No project selected'); return; }

      let pipelineId = settings.defaultPipelineId;
      if (!pipelineId) {
        const pipelines = await window.api.pipelines.list();
        pipelineId = pipelines[0]?.id;
      }
      if (!pipelineId) { toast.error('No pipeline configured'); return; }

      const created = await window.api.tasks.create({
        projectId,
        pipelineId,
        title: suggested.title,
        description: suggested.description,
        type: (suggested.type ?? 'improvement') as 'bug' | 'feature' | 'improvement',
        priority: typeof suggested.priority === 'number' ? suggested.priority : 2,
        tags: ['post-mortem'],
        metadata: { sourceTaskId: taskId },
        createdBy: 'user',
      });

      toast.success('Task created', {
        action: { label: 'View', onClick: () => navigate(`/tasks/${created.id}`) },
      });
      onTaskCreated();
    } catch (err) {
      reportError(err, 'Create task');
    } finally {
      setCreating(null);
    }
  };

  const rootCauseStyle = data.rootCause ? ROOT_CAUSE_COLORS[data.rootCause] : undefined;
  const severityStyle = data.severity ? SEVERITY_COLORS[data.severity] : undefined;

  // Build analysis as markdown for rendering
  const markdownParts: string[] = [];

  if (data.analysis) {
    markdownParts.push('## Analysis\n');
    markdownParts.push(data.analysis);
    markdownParts.push('');
  }

  if (Array.isArray(data.promptImprovements) && data.promptImprovements.length > 0) {
    markdownParts.push('## Prompt Improvements\n');
    data.promptImprovements.forEach((item) => markdownParts.push(`- ${item}`));
    markdownParts.push('');
  }

  if (Array.isArray(data.processImprovements) && data.processImprovements.length > 0) {
    markdownParts.push('## Process Improvements\n');
    data.processImprovements.forEach((item) => markdownParts.push(`- ${item}`));
    markdownParts.push('');
  }

  return (
    <div className="space-y-6">
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.rootCause && (
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={rootCauseStyle ? { backgroundColor: rootCauseStyle.bg, color: rootCauseStyle.text } : {}}
          >
            {data.rootCause.replace(/_/g, ' ')}
          </span>
        )}
        {data.severity && (
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={severityStyle ? { backgroundColor: severityStyle.bg, color: severityStyle.text } : {}}
          >
            {data.severity} severity
          </span>
        )}
        {Array.isArray(data.responsibleAgents) && data.responsibleAgents.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Should have been caught by:{' '}
            <span className="font-medium text-foreground">
              {data.responsibleAgents.join(', ')}
            </span>
          </span>
        )}
      </div>

      {/* Analysis + improvements rendered as markdown */}
      {markdownParts.length > 0 && (
        <PlanMarkdown content={markdownParts.join('\n')} />
      )}

      {/* Suggested tasks as interactive cards */}
      {Array.isArray(data.suggestedTasks) && data.suggestedTasks.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Suggested Tasks
          </p>
          <div className="space-y-2">
            {data.suggestedTasks.map((suggested, i) => (
              <div key={i} className="rounded-md border p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{suggested.title}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs shrink-0"
                    disabled={creating === suggested.title}
                    onClick={() => handleCreateTask(suggested)}
                  >
                    {creating === suggested.title ? 'Creating...' : 'Create Task'}
                  </Button>
                </div>
                {suggested.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{suggested.description}</p>
                )}
                <div className="flex gap-1 flex-wrap">
                  {suggested.type && (
                    <Badge variant="outline" className="text-xs">{suggested.type}</Badge>
                  )}
                  {suggested.size && (
                    <Badge variant="outline" className="text-xs">{suggested.size}</Badge>
                  )}
                  {typeof suggested.priority === 'number' && (
                    <Badge variant="outline" className="text-xs">P{suggested.priority}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PostMortemReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [chatOpen, setChatOpen] = useLocalStorage('postMortemReview.chatOpen', true);

  const { data: contextEntries, refetch: refetchContext, error: entriesError } = useIpc<TaskContextEntry[]>(
    () => id ? window.api.tasks.contextEntries(id) : Promise.resolve([]),
    [id],
  );

  // Find the most recent post_mortem entry
  const postMortemEntry = (contextEntries ?? [])
    .filter(e => e.entryType === 'post_mortem')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const postMortemData = postMortemEntry?.data as PostMortemData | undefined;

  // Chat entries (post_mortem_feedback)
  const chatEntries = (contextEntries ?? []).filter(e => e.entryType === 'post_mortem_feedback');

  const { streamingMessages, isStreaming, sendMessage, stopChat } = useReviewConversation(
    id, 'post-mortem-reviewer', 'post_mortem_feedback', refetchContext,
  );

  const handleTaskCreated = useCallback(() => {
    refetchContext();
  }, [refetchContext]);

  const chatToggleButton = (
    <Button
      variant={chatOpen ? 'secondary' : 'outline'}
      size="sm"
      onClick={() => setChatOpen(!chatOpen)}
      title="Toggle chat panel"
    >
      <MessageSquare size={16} />
      {chatOpen ? 'Chat' : 'Chat'}
    </Button>
  );

  return (
    <TaskSubPageLayout taskId={id!} tabLabel="Post-Mortem Report" tabKey="post-mortem" actions={chatToggleButton}>
      {entriesError && <InlineError message={entriesError} context="Loading post-mortem data" />}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left panel — report */}
        <div style={{
          width: chatOpen ? '60%' : '100%',
          borderRight: chatOpen ? '1px solid var(--border)' : 'none',
          overflowY: 'auto',
          padding: '24px',
          transition: 'width var(--motion-slow) var(--ease-standard)',
        }}>
          {postMortemData ? (
            <PostMortemReport
              data={postMortemData}
              taskId={id!}
              onTaskCreated={handleTaskCreated}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No post-mortem analysis available yet. Run a post-mortem analysis from the{' '}
              <a href="/post-mortem" className="underline">Post-Mortem page</a> first.
            </p>
          )}
        </div>

        {/* Right panel — chat conversation */}
        <div style={{
          width: chatOpen ? '40%' : '0',
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width var(--motion-slow) var(--ease-standard)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 8px 0' }}>
            <Button variant="ghost" size="sm" onClick={() => setChatOpen(false)} title="Close chat panel">
              <X size={16} />
            </Button>
          </div>
          <ReviewConversation
            entries={chatEntries}
            isReviewStatus={!!postMortemData}
            streamingMessages={streamingMessages}
            isStreaming={isStreaming}
            onSend={sendMessage}
            onStop={stopChat}
            hasConversation={chatEntries.length > 0}
            placeholder="Ask about the post-mortem findings..."
          />
        </div>
      </div>
    </TaskSubPageLayout>
  );
}
