import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjects } from '../../hooks/useProjects';
import { useTheme } from '../../hooks/useTheme';
import type { TelegramBotLogEntry } from '../../../shared/types';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@template/renderer/components/ui/select';
import { Button } from '@template/renderer/components/ui/button';
import { FolderOpen, Sun, Moon, Send } from 'lucide-react';

type TelegramBotStatus = 'running' | 'stopped' | 'failed' | 'unknown';

export function TopMenu() {
  const { currentProject, currentProjectId, setCurrentProjectId } =
    useCurrentProject();
  const { projects } = useProjects();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [telegramStatus, setTelegramStatus] = useState<TelegramBotStatus>('unknown');
  const [recentLogs, setRecentLogs] = useState<TelegramBotLogEntry[]>([]);

  useEffect(() => {
    if (!currentProjectId) {
      setTelegramStatus('unknown');
      return;
    }
    window.api.telegram.botStatus(currentProjectId).then(({ running }) => {
      // Only update from poll if we don't already have a more specific status
      // (e.g. 'failed' from an auto-start event that arrived before the poll)
      setTelegramStatus(prev => prev === 'failed' ? prev : running ? 'running' : 'stopped');
    }).catch(() => {
      setTelegramStatus('unknown');
    });

    const unsub = window.api.on.telegramBotStatusChanged((projectId, status) => {
      if (projectId === currentProjectId) {
        setTelegramStatus(status as TelegramBotStatus);
      }
    });
    return () => { unsub(); };
  }, [currentProjectId]);

  // Subscribe to bot log events for tooltip
  useEffect(() => {
    if (!currentProjectId) {
      setRecentLogs([]);
      return;
    }
    const unsub = window.api.on.telegramBotLog((projectId, entry) => {
      if (projectId !== currentProjectId) return;
      setRecentLogs(prev => [...prev, entry].slice(-5));
    });
    return () => { unsub(); setRecentLogs([]); };
  }, [currentProjectId]);

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  const dotColor = telegramStatus === 'running'
    ? 'bg-green-500'
    : telegramStatus === 'failed'
      ? 'bg-red-500'
      : 'bg-gray-400';

  const telegramTooltip = (() => {
    const lines = [`Telegram bot: ${telegramStatus}`];
    if (recentLogs.length > 0) {
      lines.push('─────');
      for (const log of recentLogs) {
        const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lines.push(`${time} ${log.message}`);
      }
    }
    return lines.join('\n');
  })();

  return (
    <div className="h-12 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
      {/* Left: Project Selector */}
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <Select
          value={currentProjectId || ''}
          onValueChange={(id) => setCurrentProjectId(id)}
        >
          <SelectTrigger className="w-48 h-8 border-none bg-transparent shadow-none text-sm font-medium hover:bg-muted">
            <SelectValue placeholder="Select a project">
              {currentProject ? currentProject.name : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Right: Telegram Status + Theme Toggle */}
      <div className="flex items-center gap-1">
        {currentProjectId && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/projects/${currentProjectId}/telegram`)}
            title={telegramTooltip}
          >
            <div className="relative">
              <Send className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${dotColor}`} />
            </div>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </div>
    </div>
  );
}
