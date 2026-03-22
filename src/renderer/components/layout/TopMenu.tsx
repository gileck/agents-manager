import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjects } from '../../hooks/useProjects';
import { useTheme } from '../../hooks/useTheme';
import { usePipelines } from '../../hooks/usePipelines';
import type { TelegramBotLogEntry, TaskCreateInput, ChatImage } from '../../../shared/types';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select';
import { Button } from '../ui/button';
import {
  FolderOpen,
  FolderPlus,
  Sun,
  Moon,
  Send,
  DollarSign,
  GitBranch,
  ScrollText,
  Play,
  Plus,
  Search,
} from 'lucide-react';
import { reportError } from '../../lib/error-handler';
import { getPageTitle } from '../../lib/pages';
import { TaskCreateDialog } from '../tasks/TaskCreateDialog';
import { NotificationBell } from './NotificationBell';
import { useKeyboardShortcutsConfig } from '../../hooks/useKeyboardShortcutsConfig';
import { formatCombo } from '../../lib/keyboardShortcuts';

type TelegramBotStatus = 'running' | 'stopped' | 'failed' | 'unknown';

const utilityButtonClass =
  'h-9 rounded-full border border-border/70 bg-card/65 hover:bg-accent/70 text-muted-foreground hover:text-foreground';

export function TopMenu() {
  const { currentProject, currentProjectId, setCurrentProjectId } = useCurrentProject();
  const { projects, refetch: refetchProjects } = useProjects();
  const { resolvedTheme, setTheme } = useTheme();
  const { pipelines } = usePipelines();
  const navigate = useNavigate();
  const location = useLocation();
  const { getCombo } = useKeyboardShortcutsConfig();
  const [telegramStatus, setTelegramStatus] = useState<TelegramBotStatus>('unknown');
  const [recentLogs, setRecentLogs] = useState<TelegramBotLogEntry[]>([]);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [form, setForm] = useState<Omit<TaskCreateInput, 'projectId'>>({ pipelineId: '', title: '', description: '', type: 'feature' });
  const [creating, setCreating] = useState(false);
  const [dialogImages, setDialogImages] = useState<ChatImage[]>([]);

  const openCreateDialog = () => {
    setForm({ pipelineId: '', title: '', description: '', type: 'feature' });
    setDialogImages([]);
    setCreateDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !currentProjectId || !form.pipelineId) return;
    setCreating(true);
    try {
      let description = form.description ?? '';

      // Save screenshots if any
      if (dialogImages.length > 0) {
        try {
          const { paths } = await window.api.screenshots.save(dialogImages);
          if (paths.length > 0) {
            const screenshotSection = '\n\n## Screenshots\n' +
              paths.map((p, i) => `![screenshot-${i + 1}](${p})`).join('\n');
            description = description + screenshotSection;
          }
        } catch (err) {
          reportError(err, 'Save screenshots');
        }
      }

      const task = await window.api.tasks.create({ ...form, description, projectId: currentProjectId });
      setCreateDialogOpen(false);
      setForm({ pipelineId: '', title: '', description: '', type: 'feature' });
      setDialogImages([]);
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      reportError(err, 'Create task');
    } finally {
      setCreating(false);
    }
  };

  const handleAddProject = async () => {
    try {
      const folderPath = await window.api.dialog.pickFolder();
      if (!folderPath) return;
      const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
      const project = await window.api.projects.create({ name: folderName, path: folderPath });
      await refetchProjects();
      setCurrentProjectId(project.id);
    } catch (err) {
      reportError(err, 'Add project');
    }
  };

  useEffect(() => {
    if (!currentProjectId) {
      setTelegramStatus('unknown');
      return;
    }
    window.api.telegram.botStatus(currentProjectId).then(({ running }) => {
      setTelegramStatus((prev) => (prev === 'failed' ? prev : running ? 'running' : 'stopped'));
    }).catch((err) => {
      reportError(err, 'Telegram bot status');
      setTelegramStatus('unknown');
    });

    const unsub = window.api.on.telegramBotStatusChanged((projectId, status) => {
      if (projectId === currentProjectId) {
        setTelegramStatus(status as TelegramBotStatus);
      }
    });
    return () => { unsub(); };
  }, [currentProjectId]);

  useEffect(() => {
    if (!currentProjectId) {
      setRecentLogs([]);
      return;
    }
    const unsub = window.api.on.telegramBotLog((projectId, entry) => {
      if (projectId !== currentProjectId) return;
      setRecentLogs((prev) => [...prev, entry].slice(-5));
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
      lines.push('-----');
      for (const log of recentLogs) {
        const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lines.push(`${time} ${log.message}`);
      }
    }
    return lines.join('\n');
  })();

  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="relative z-50 h-14 border-b border-border/70 bg-card/55 backdrop-blur-md flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-lg font-bold tracking-tight text-foreground">Hello World</span>
        <span className="text-border/70">|</span>
        <h1 className="text-lg font-semibold tracking-tight text-foreground truncate">{pageTitle}</h1>
        {currentProject && (
          <span className="hidden md:inline-flex items-center rounded-full border border-border/65 bg-muted/45 px-2.5 py-1 text-xs text-muted-foreground">
            {currentProject.name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden xl:flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <Select
            value={currentProjectId || ''}
            onValueChange={(id) => {
              if (id === '__add_project__') {
                handleAddProject();
              } else {
                setCurrentProjectId(id);
              }
            }}
          >
            <SelectTrigger className="w-56 h-9 rounded-full border-border/75 bg-card/65 text-sm font-medium shadow-none hover:bg-accent/55">
              <SelectValue placeholder="Select project">
                {currentProject ? currentProject.name : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
              <div className="h-px bg-border/60 my-1 -mx-1" />
              <SelectItem value="__add_project__">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <FolderPlus className="h-4 w-4 shrink-0" />
                  Add Project
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {currentProjectId && (
          <Button
            variant="default"
            size="sm"
            onClick={openCreateDialog}
            className="rounded-full px-3"
            title="Create new task"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New task
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.dispatchEvent(new CustomEvent('open-global-search'))}
          title={`Search tasks & threads (${formatCombo(getCombo('global.search'))})`}
          className={utilityButtonClass}
        >
          <Search className="h-4 w-4" />
        </Button>

        <Button
          variant={location.pathname === '/source-control' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => navigate('/source-control')}
          title="Source Control"
          className={utilityButtonClass}
        >
          <GitBranch className="h-4 w-4" />
        </Button>

        <Button
          variant={location.pathname === '/agent-runs' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => navigate('/agent-runs')}
          title="Agent Runs"
          className={utilityButtonClass}
        >
          <Play className="h-4 w-4" />
        </Button>

        <Button
          variant={location.pathname === '/cost' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => navigate('/cost')}
          title="Cost"
          className={utilityButtonClass}
        >
          <DollarSign className="h-4 w-4" />
        </Button>

        <Button
          variant={location.pathname === '/debug-logs' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => navigate('/debug-logs')}
          title="Debug Logs"
          className={utilityButtonClass}
        >
          <ScrollText className="h-4 w-4" />
        </Button>

        {currentProjectId && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/projects/${currentProjectId}/telegram`)}
            title={telegramTooltip}
            className={utilityButtonClass}
          >
            <div className="relative">
              <Send className="h-3.5 w-3.5" />
              <span className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${dotColor}`} />
            </div>
          </Button>
        )}

        <NotificationBell />

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
          className={utilityButtonClass}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </div>

      <TaskCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        pipelines={pipelines}
        form={form}
        onFormChange={setForm}
        onCreate={handleCreate}
        creating={creating}
        images={dialogImages}
        onImagesChange={setDialogImages}
      />
    </div>
  );
}
