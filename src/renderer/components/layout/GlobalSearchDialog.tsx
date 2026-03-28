import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, MessageSquare, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { useKeyboardShortcutsConfig } from '../../hooks/useKeyboardShortcutsConfig';
import { formatCombo } from '../../lib/keyboardShortcuts';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import { reportError } from '../../lib/error-handler';
import { APP_PAGES } from '../../lib/pages';
import type { PageDefinition } from '../../lib/pages';
import type { Task, ChatSessionWithDetails } from '../../../shared/types';
import { usePipelines } from '../../hooks/usePipelines';
import { StatusIcon, useStatusColorMap } from '../pipeline/StatusIcon';

const MAX_TASKS = 8;
const MAX_THREADS = 5;
const DEFAULT_TASKS = 5;
const DEFAULT_THREADS = 3;
const DEBOUNCE_MS = 250;

interface SearchResult {
  id: string;
  type: 'task' | 'thread' | 'page';
  title: string;
  status?: string;
  messageCount?: number;
  updatedAt: number;
  path?: string;
  page?: PageDefinition;
}

export function GlobalSearchDialog() {
  const { currentProjectId } = useCurrentProject();
  const { switchSession } = useProjectChatSessions();
  const { getCombo } = useKeyboardShortcutsConfig();
  const navigate = useNavigate();
  const { pipelines } = usePipelines();
  const statusColorMap = useStatusColorMap(pipelines);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [threads, setThreads] = useState<ChatSessionWithDetails[]>([]);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Listen for open event ── */
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-global-search', handler);
    return () => window.removeEventListener('open-global-search', handler);
  }, []);

  /* ── Reset state when opening ── */
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /* ── Fetch data (debounced) ── */
  const fetchResults = useCallback(async (searchQuery: string) => {
    if (!currentProjectId) {
      // Without a project, clear tasks/threads (pages are filtered client-side)
      setTasks([]);
      setThreads([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [taskResults, threadResults] = await Promise.all([
        window.api.tasks.list({ search: searchQuery || undefined, projectId: currentProjectId }),
        window.api.chatSession.listAll(currentProjectId),
      ]);

      // Sort by updatedAt desc
      const sortedTasks = [...taskResults].sort((a, b) => b.updatedAt - a.updatedAt);
      const sortedThreads = [...threadResults].sort((a, b) => b.updatedAt - a.updatedAt);

      if (searchQuery) {
        // Filter threads client-side by name
        const lowerQuery = searchQuery.toLowerCase();
        const filteredThreads = sortedThreads.filter(t =>
          t.name.toLowerCase().includes(lowerQuery)
        );
        setTasks(sortedTasks.slice(0, MAX_TASKS));
        setThreads(filteredThreads.slice(0, MAX_THREADS));
      } else {
        // Default view: recent items
        setTasks(sortedTasks.slice(0, DEFAULT_TASKS));
        setThreads(sortedThreads.slice(0, DEFAULT_THREADS));
      }
    } catch (err) {
      reportError(err, 'Global search');
      setError('Failed to load search results');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchResults(query);
    }, query ? DEBOUNCE_MS : 0); // Instant for default view

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query, fetchResults]);

  /* ── Filter pages by query ── */
  const filteredPages = useMemo((): PageDefinition[] => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    return APP_PAGES.filter(page => {
      if (page.label.toLowerCase().includes(lowerQuery)) return true;
      return page.keywords.some(kw => kw.toLowerCase().includes(lowerQuery));
    });
  }, [query]);

  /* ── Build flat result list ── */
  const results = useMemo((): SearchResult[] => {
    const items: SearchResult[] = [];
    for (const page of filteredPages) {
      items.push({
        id: page.id,
        type: 'page',
        title: page.label,
        updatedAt: 0,
        path: page.path,
        page,
      });
    }
    for (const task of tasks) {
      items.push({
        id: task.id,
        type: 'task',
        title: task.title,
        status: task.status,
        updatedAt: task.updatedAt,
      });
    }
    for (const thread of threads) {
      items.push({
        id: thread.id,
        type: 'thread',
        title: thread.name,
        messageCount: thread.messageCount,
        updatedAt: thread.updatedAt,
      });
    }
    return items;
  }, [filteredPages, tasks, threads]);

  /* ── Scroll selected into view ── */
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  /* ── Select action ── */
  const selectResult = useCallback((result: SearchResult) => {
    setOpen(false);
    if (result.type === 'page') {
      navigate(result.path!);
    } else if (result.type === 'task') {
      navigate(`/tasks/${result.id}`);
    } else {
      switchSession(result.id);
      navigate('/chat');
    }
  }, [navigate, switchSession]);

  /* ── Keyboard handler ── */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[selectedIndex];
      if (item) selectResult(item);
      return;
    }
  };

  if (!open) return null;

  const shortcutLabel = formatCombo(getCombo('global.search'));
  const portalTarget = document.getElementById('app-root') || document.body;

  /* ── Compute category indices for headers ── */
  const pageCount = filteredPages.length;
  const taskCount = tasks.length;
  const threadCount = threads.length;

  return createPortal(
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[18vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-lg bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl ring-1 ring-white/10 overflow-hidden animate-in fade-in-0 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
          {loading ? (
            <Loader2 className="h-5 w-5 text-muted-foreground/50 shrink-0 animate-spin" />
          ) : (
            <Search className="h-5 w-5 text-muted-foreground/70 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, tasks, and threads..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground/60 outline-none"
          />
          <span className="text-[10px] text-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 rounded shrink-0">
            {shortcutLabel}
          </span>
        </div>

        {/* Results area */}
        {error ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">
            {error}
          </div>
        ) : !currentProjectId && pageCount === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">
            Select a project to search tasks and threads
          </div>
        ) : results.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <span className="text-sm text-muted-foreground/60">No results found</span>
          </div>
        ) : (
          <div ref={listRef} className="max-h-80 overflow-y-auto">
            {/* Pages section */}
            {pageCount > 0 && (
              <>
                <div className="sticky top-0 z-10 bg-popover/95 backdrop-blur-xl px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                    Pages
                  </span>
                </div>
                {filteredPages.map((page, idx) => {
                  const Icon = page.icon;
                  return (
                    <button
                      key={page.id}
                      data-index={idx}
                      onClick={() => selectResult({ id: page.id, type: 'page', title: page.label, updatedAt: 0, path: page.path, page })}
                      className={cn(
                        'flex items-center gap-3 w-full px-4 py-2 text-left transition-colors duration-75',
                        idx === selectedIndex
                          ? 'bg-accent/80 text-accent-foreground rounded-lg'
                          : 'text-foreground hover:bg-muted/40'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                      <span className="text-sm font-medium truncate flex-1">{page.label}</span>
                    </button>
                  );
                })}
              </>
            )}

            {/* Divider between pages and tasks */}
            {pageCount > 0 && taskCount > 0 && (
              <div className="border-t border-border/30 my-0.5" />
            )}

            {/* Tasks section */}
            {taskCount > 0 && (
              <>
                <div className="sticky top-0 z-10 bg-popover/95 backdrop-blur-xl px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                    Tasks
                  </span>
                </div>
                {tasks.map((task, idx) => {
                  const globalIdx = pageCount + idx;
                  return (
                    <button
                      key={task.id}
                      data-index={globalIdx}
                      onClick={() => selectResult({ id: task.id, type: 'task', title: task.title, status: task.status, updatedAt: task.updatedAt })}
                      className={cn(
                        'flex items-center gap-3 w-full px-4 py-2 text-left transition-colors duration-75',
                        globalIdx === selectedIndex
                          ? 'bg-accent/80 text-accent-foreground rounded-lg'
                          : 'text-foreground hover:bg-muted/40'
                      )}
                    >
                      <StatusIcon status={task.status} colorMap={statusColorMap} />
                      <span className="text-sm font-medium truncate flex-1">{task.title}</span>
                      <span className="text-[10px] text-muted-foreground/60 capitalize bg-muted/30 px-1.5 py-0.5 rounded-full shrink-0">
                        {task.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground/50 shrink-0">
                        {formatRelativeTimestamp(task.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {/* Divider between tasks and threads */}
            {(pageCount > 0 || taskCount > 0) && threadCount > 0 && (
              <div className="border-t border-border/30 my-0.5" />
            )}

            {/* Threads section */}
            {threadCount > 0 && (
              <>
                <div className="sticky top-0 z-10 bg-popover/95 backdrop-blur-xl px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                    Threads
                  </span>
                </div>
                {threads.map((thread, idx) => {
                  const globalIdx = pageCount + taskCount + idx;
                  return (
                    <button
                      key={thread.id}
                      data-index={globalIdx}
                      onClick={() => selectResult({ id: thread.id, type: 'thread', title: thread.name, messageCount: thread.messageCount, updatedAt: thread.updatedAt })}
                      className={cn(
                        'flex items-center gap-3 w-full px-4 py-2 text-left transition-colors duration-75',
                        globalIdx === selectedIndex
                          ? 'bg-accent/80 text-accent-foreground rounded-lg'
                          : 'text-foreground hover:bg-muted/40'
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                      <span className="text-sm font-medium truncate flex-1">{thread.name}</span>
                      {thread.messageCount > 0 && (
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">
                          {thread.messageCount} msgs
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground/50 shrink-0">
                        {formatRelativeTimestamp(thread.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground/50 flex items-center gap-4">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
