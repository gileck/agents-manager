import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { reportError } from '../../lib/error-handler';
import type { DevServerInfo } from '../../../shared/types';

interface DevServerCardProps {
  taskId: string;
}

export function DevServerCard({ taskId }: DevServerCardProps) {
  const [info, setInfo] = useState<DevServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial status
  useEffect(() => {
    window.api.devServers.status(taskId).then(setInfo).catch((err) => reportError(err, 'Dev server status'));
  }, [taskId]);

  // Subscribe to status changes
  useEffect(() => {
    const unsub = window.api.on.devServerStatus((id, newInfo) => {
      if (id === taskId) setInfo(newInfo);
    });
    return unsub;
  }, [taskId]);

  // Subscribe to log output
  useEffect(() => {
    const unsub = window.api.on.devServerLog((id, data) => {
      if (id === taskId) {
        setLogs(prev => {
          const next = [...prev, data.line];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
    });
    return unsub;
  }, [taskId]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStart = useCallback(async () => {
    setLoading(true);
    setLogs([]);
    try {
      const result = await window.api.devServers.start(taskId);
      setInfo(result);
    } catch (err) {
      reportError(err, 'Dev server start');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      await window.api.devServers.stop(taskId);
      setInfo(null);
      setLogs([]);
    } catch (err) {
      reportError(err, 'Dev server stop');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const handleOpenUrl = useCallback(() => {
    if (info?.url) {
      window.api.shell.openInChrome(info.url).catch((err) => reportError(err, 'Open dev server URL'));
    }
  }, [info?.url]);

  const isRunning = info?.status === 'starting' || info?.status === 'ready';

  const statusBadge = () => {
    if (!info) return null;
    switch (info.status) {
      case 'starting':
        return <Badge variant="outline">Starting...</Badge>;
      case 'ready':
        return <Badge variant="default" className="bg-green-600">Ready</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'stopped':
        return <Badge variant="secondary">Stopped</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CardTitle className="text-sm font-medium">Dev Server</CardTitle>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {statusBadge()}
            {isRunning ? (
              <Button size="sm" variant="destructive" onClick={handleStop} disabled={loading}>
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={handleStart} disabled={loading}>
                {loading ? 'Starting...' : 'Start'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {info?.status === 'ready' && info.url && (
          <div style={{ marginBottom: 8 }}>
            <Button size="sm" variant="link" onClick={handleOpenUrl} style={{ padding: 0, height: 'auto' }}>
              {info.url}
            </Button>
            <span className="text-muted-foreground text-xs" style={{ marginLeft: 8 }}>
              (port {info.port})
            </span>
          </div>
        )}
        {info?.error && (
          <p className="text-destructive text-xs" style={{ marginBottom: 8 }}>{info.error}</p>
        )}
        {logs.length > 0 && (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowLogs(!showLogs)}
              style={{ padding: '2px 8px', height: 'auto', fontSize: 12 }}
            >
              {showLogs ? 'Hide Logs' : `Show Logs (${logs.length})`}
            </Button>
            {showLogs && (
              <div
                style={{
                  marginTop: 4,
                  maxHeight: 200,
                  overflowY: 'auto',
                  background: 'var(--muted)',
                  borderRadius: 4,
                  padding: 8,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
