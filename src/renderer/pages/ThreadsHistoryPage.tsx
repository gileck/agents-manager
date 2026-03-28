import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Search, MessageSquare } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../contexts/ProjectChatSessionsContext';
import { reportError } from '../lib/error-handler';
import { formatRelativeTimestamp } from '../components/tasks/task-helpers';
import { ThreadIntentIcon } from '../components/chat/ThreadIntentIcon';
import { THREAD_INTENTS, type ThreadIntent } from '../lib/thread-intent-prompts';
import type { ChatSessionWithDetails } from '../../shared/types';

type SortField = 'updatedAt' | 'createdAt' | 'name' | 'messageCount';
type SortDir = 'desc' | 'asc';

/** Filter values: 'all' shows everything, intent keys filter by that intent, 'blank' shows null-intent sessions. */
type IntentFilter = 'all' | ThreadIntent | 'blank';

const INTENT_FILTER_OPTIONS: { value: IntentFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...Object.entries(THREAD_INTENTS).map(([key, cfg]) => ({
    value: key as ThreadIntent,
    label: cfg.label,
  })),
  { value: 'blank', label: 'Blank' },
];

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ThreadsHistoryPage() {
  const { currentProjectId } = useCurrentProject();
  const { switchSession, unhideSession } = useProjectChatSessions();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<ChatSessionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [intentFilter, setIntentFilter] = useState<IntentFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<ChatSessionWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!currentProjectId) return;
    setLoading(true);
    window.api.chatSession
      .listAll(currentProjectId)
      .then((data) => setSessions(data.filter((s) => s.scopeType === 'project')))
      .catch((err) => reportError(err, 'Load threads history'))
      .finally(() => setLoading(false));
  }, [currentProjectId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let result = q
      ? sessions.filter((s) => s.name.toLowerCase().includes(q))
      : sessions;

    // Apply intent filter
    if (intentFilter !== 'all') {
      if (intentFilter === 'blank') {
        result = result.filter((s) => !s.threadIntent);
      } else {
        result = result.filter((s) => s.threadIntent === intentFilter);
      }
    }

    return [...result].sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'name') return dir * a.name.localeCompare(b.name);
      if (sortBy === 'messageCount') return dir * (a.messageCount - b.messageCount);
      return dir * (a[sortBy] - b[sortBy]);
    });
  }, [sessions, search, sortBy, sortDir, intentFilter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await window.api.chatSession.delete(deleteTarget.id);
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      reportError(err, 'Delete thread');
    } finally {
      setDeleting(false);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortBy !== field) return null;
    return sortDir === 'desc' ? ' ↓' : ' ↑';
  };

  if (!currentProjectId) {
    return (
      <div className="p-6 text-muted-foreground text-sm">No project selected.</div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/60 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Thread History</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              All threads for this project, including ones removed from the sidebar.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {loading ? '...' : `${filtered.length} of ${sessions.length} threads`}
          </div>
        </div>

        {/* Search + Filter + Sort controls */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search threads..."
              className="pl-8 h-8 text-sm"
            />
          </div>

          {/* Intent filter chips */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Type:</span>
            {INTENT_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setIntentFilter(opt.value)}
                className={`px-2 py-1 rounded transition-colors ${
                  intentFilter === opt.value
                    ? 'bg-accent text-foreground font-medium'
                    : 'hover:bg-accent/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Sort:</span>
            {(['updatedAt', 'createdAt', 'name', 'messageCount'] as SortField[]).map((f) => (
              <button
                key={f}
                onClick={() => toggleSort(f)}
                className={`px-2 py-1 rounded transition-colors ${
                  sortBy === f
                    ? 'bg-accent text-foreground font-medium'
                    : 'hover:bg-accent/50'
                }`}
              >
                {f === 'updatedAt' ? 'Updated' : f === 'createdAt' ? 'Created' : f === 'name' ? 'Name' : 'Messages'}
                {sortIndicator(f)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {search || intentFilter !== 'all' ? 'No threads match your filters.' : 'No threads found.'}
          </p>
        ) : (
          <div className="space-y-1">
            {filtered.map((session) => (
              <div
                key={session.id}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:bg-accent/40 hover:border-border/40 transition-colors"
              >
                {/* Intent icon or default message icon */}
                <div className="shrink-0 text-muted-foreground">
                  {session.threadIntent ? (
                    <ThreadIntentIcon intent={session.threadIntent} className="h-3.5 w-3.5" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5" />
                  )}
                </div>

                {/* Name + badges */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => {
                        switchSession(session.id);
                        if (session.sidebarHidden) {
                          unhideSession(session.id).catch((err) => reportError(err, 'Unhide thread'));
                        }
                        navigate(`/chat/${session.id}`);
                      }}
                      className="text-sm font-medium truncate hover:underline text-left"
                    >
                      {session.name}
                    </button>
                    {session.threadIntent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                        {THREAD_INTENTS[session.threadIntent as ThreadIntent]?.label ?? session.threadIntent}
                      </span>
                    )}
                    {session.sidebarHidden && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                        hidden
                      </span>
                    )}
                  </div>
                </div>

                {/* Message count */}
                <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
                  {session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}
                </span>

                {/* Updated */}
                <span
                  className="text-xs text-muted-foreground shrink-0 w-20 text-right"
                  title={formatDate(session.updatedAt)}
                >
                  {formatRelativeTimestamp(session.updatedAt)}
                </span>

                {/* Created */}
                <span className="text-xs text-muted-foreground shrink-0 w-24 text-right hidden md:block">
                  {formatDate(session.createdAt)}
                </span>

                {/* Delete button */}
                <button
                  onClick={() => setDeleteTarget(session)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all shrink-0"
                  title="Delete permanently"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Thread</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to permanently delete &quot;{deleteTarget?.name}&quot;?
            This will remove all messages in this thread and cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete Thread'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
