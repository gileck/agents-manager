import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@template/renderer/components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type { Project, TelegramBotLogEntry } from '../../shared/types';

export function TelegramPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project } = useIpc<Project | null>(
    () => window.api.projects.get(id!),
    [id]
  );

  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<TelegramBotLogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check initial bot status
  useEffect(() => {
    if (!id) return;
    window.api.telegram.botStatus(id).then((status) => {
      setRunning(status.running);
    }).catch(() => {});
  }, [id]);

  // Subscribe to log events
  useEffect(() => {
    const unsubscribe = window.api.on.telegramBotLog((projectId, entry) => {
      if (projectId !== id) return;
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 1000 ? next.slice(-1000) : next;
      });
    });
    return () => { unsubscribe(); };
  }, [id]);

  // Auto-scroll on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleStart = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      await window.api.telegram.startBot(id);
      setRunning(true);
      toast.success('Telegram bot started');
    } catch (err) {
      toast.error(`Failed to start bot: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleStop = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      await window.api.telegram.stopBot(id);
      setRunning(false);
      setLogs([]);
      toast.success('Telegram bot stopped');
    } catch (err) {
      toast.error(`Failed to stop bot: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString();
  };

  return (
    <div className="p-8">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(`/projects/${id}/config`)}>
        &larr; Back to config
      </Button>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-3xl font-bold">Telegram Bot</h1>
        {project && <span className="text-muted-foreground">{project.name}</span>}
        <Badge variant={running ? 'success' : 'secondary'}>
          {running ? 'Running' : 'Stopped'}
        </Badge>
      </div>

      <div className="max-w-3xl space-y-6">
        <div className="flex gap-2">
          {running ? (
            <Button variant="destructive" disabled={loading} onClick={handleStop}>
              {loading ? 'Stopping...' : 'Stop Bot'}
            </Button>
          ) : (
            <Button disabled={loading} onClick={handleStart}>
              {loading ? 'Starting...' : 'Start Bot'}
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96 rounded border bg-muted/30 p-3" ref={scrollRef}>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {running ? 'Waiting for activity...' : 'Start the bot to see activity logs.'}
                </p>
              ) : (
                <div className="space-y-1 font-mono text-sm">
                  {logs.map((entry, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">{formatTime(entry.timestamp)}</span>
                      {entry.direction === 'in' ? (
                        <span className="text-blue-500 shrink-0">&rarr;</span>
                      ) : (
                        <span className="text-green-500 shrink-0">&larr;</span>
                      )}
                      <span className="break-all">{entry.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
