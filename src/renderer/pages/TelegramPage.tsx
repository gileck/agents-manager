import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Maximize2, Minimize2 } from 'lucide-react';
import { reportError } from '../lib/error-handler';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { useChat } from '../hooks/useChat';
import { ChatMessageList } from '../components/chat/ChatMessageList';
import { ContextSidebar } from '../components/chat/ContextSidebar';
import type { Project, TelegramBotLogEntry } from '../../shared/types';

const SESSION_POLL_MS = 3000;

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
  const [fullscreen, setFullscreen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, isStreaming, tokenUsage } = useChat(sessionId);

  // Check initial bot status
  useEffect(() => {
    if (!id) return;
    window.api.telegram.botStatus(id).then((status) => {
      setRunning(status.running);
    }).catch((err: unknown) => {
      console.error('[TelegramPage] Failed to check bot status:', err);
    });
  }, [id]);

  // Poll for session ID when bot is running but session is unknown
  useEffect(() => {
    if (!id || !running) return;

    // Initial fetch
    window.api.telegram.botSession(id).then(setSessionId).catch((err: unknown) => {
      console.error('[TelegramPage] Failed to fetch session:', err);
    });

    const interval = setInterval(() => {
      window.api.telegram.botSession(id).then((sid) => {
        if (sid) {
          setSessionId(sid);
          clearInterval(interval);
        }
      }).catch((err: unknown) => {
        console.error('[TelegramPage] Failed to poll session:', err);
      });
    }, SESSION_POLL_MS);

    return () => clearInterval(interval);
  }, [id, running]);

  // Clear session when bot stops
  useEffect(() => {
    if (!running) {
      setSessionId(null);
    }
  }, [running]);

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

  // Auto-scroll on new log entries
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
      reportError(err, 'Start bot');
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
      reportError(err, 'Stop bot');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString();
  };

  const content = (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        {!fullscreen && (
          <Button variant="ghost" size="sm" onClick={() => navigate('/settings/project')}>
            &larr; Back
          </Button>
        )}
        <h1 className="text-2xl font-bold">Telegram Bot</h1>
        {project && <span className="text-muted-foreground">{project.name}</span>}
        <Badge variant={running ? 'success' : 'secondary'}>
          {running ? 'Running' : 'Stopped'}
        </Badge>
        <div className="ml-auto flex gap-2">
          {running ? (
            <Button variant="destructive" size="sm" disabled={loading} onClick={handleStop}>
              {loading ? 'Stopping...' : 'Stop Bot'}
            </Button>
          ) : (
            <Button size="sm" disabled={loading} onClick={handleStart}>
              {loading ? 'Starting...' : 'Start Bot'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setFullscreen((f) => !f)}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <TabsList>
          <TabsTrigger value="chat">Agent Chat</TabsTrigger>
          <TabsTrigger value="log">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1" style={{ display: 'flex', minHeight: 0 }}>
          {sessionId ? (
            <div className="flex flex-1 gap-4" style={{ minHeight: 0 }}>
              <div className="flex-1" style={{ minHeight: 0 }}>
                <ChatMessageList messages={messages} isRunning={isStreaming} />
              </div>
              <div style={{ width: '240px', flexShrink: 0 }}>
                <ContextSidebar messages={messages} tokenUsage={tokenUsage} />
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              {running
                ? 'Waiting for first Telegram message...'
                : 'Start the bot and send a message from Telegram to begin.'}
            </div>
          )}
        </TabsContent>

        <TabsContent value="log" className="flex-1" style={{ minHeight: 0 }}>
          <ScrollArea className="h-full rounded border bg-muted/30 p-3" ref={scrollRef}>
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
                    ) : entry.direction === 'status' ? (
                      <span className="text-amber-500 shrink-0">&#9881;</span>
                    ) : (
                      <span className="text-green-500 shrink-0">&larr;</span>
                    )}
                    <span className={entry.direction === 'status' ? 'break-all text-amber-500' : 'break-all'}>{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </>
  );

  if (fullscreen) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-background p-6">
        {content}
      </div>
    );
  }

  return (
    <div className="flex flex-col p-8" style={{ height: '100%' }}>
      {content}
    </div>
  );
}
