import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { reportError } from './lib/error-handler';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectConfigPage } from './pages/ProjectConfigPage';
import { TaskListPage } from './pages/TaskListPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { AgentRunPage } from './pages/AgentRunPage';
import { SettingsPage } from './pages/SettingsPage';
import { ThemePage } from './pages/ThemePage';
import { AgentDefinitionsPage } from './pages/AgentDefinitionsPage';
import { PipelinesPage } from './pages/PipelinesPage';
import { SettingsLayout } from './pages/SettingsLayout';
import { FeatureListPage } from './pages/FeatureListPage';
import { FeatureDetailPage } from './pages/FeatureDetailPage';
import { ChatPage } from './pages/ChatPage';
import { TelegramPage } from './pages/TelegramPage';
import { CostPage } from './pages/CostPage';
import { SourceControlPage } from './pages/SourceControlPage';
import { KanbanBoardPage } from './pages/KanbanBoardPage';
import { DebugLogsPage } from './pages/DebugLogsPage';
import { AutomatedAgentsPage } from './pages/AutomatedAgentsPage';
import { useTheme } from './hooks/useTheme';
import { useThemeConfig } from './hooks/useThemeConfig';
import { useRouteRestore } from './hooks/useRouteRestore';
import { CurrentProjectProvider } from './contexts/CurrentProjectContext';
import { ProjectChatSessionsProvider } from './contexts/ProjectChatSessionsContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/toaster';

function AppRoutes() {
  const navigate = useNavigate();

  // Initialize theme on app load
  useTheme();
  // Initialize custom theme overrides (CSS variable customizations)
  useThemeConfig();
  // Restore last visited route on app start and save on navigation
  useRouteRestore();

  useEffect(() => {
    // Listen for navigation events from main process
    const unsubscribe = window.api?.on?.navigate?.((path: string) => {
      navigate(path);
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  // Listen for agent failures and show toast notifications
  useEffect(() => {
    const unsubscribe = window.api?.on?.agentStatus?.(async (taskId: string, status: string) => {
      if (status === 'failed' || status === 'timed_out') {
        try {
          // Fetch the latest runs for this task to get the error
          const runs = await window.api.agents.runs(taskId);
          const failedRun = runs?.find((r: { status: string }) => r.status === status);
          const errorMsg = failedRun?.error || `Agent ${status.replace('_', ' ')}`;
          if (failedRun) {
            toast.error(errorMsg, {
              duration: 15000,
              action: {
                label: 'View Run',
                onClick: () => navigate(`/agents/${failedRun.id}`),
              },
              cancel: {
                label: 'Copy Error',
                onClick: () => navigator.clipboard.writeText(errorMsg),
              },
            });
          } else {
            reportError(errorMsg, 'Agent');
          }
        } catch (err) {
          console.error('Failed to fetch agent run details for failure toast:', err);
          reportError(`Agent ${status.replace('_', ' ')}`, 'Agent');
        }
      }
    });
    return () => { unsubscribe?.(); };
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = window.api?.on?.agentInterruptedRuns?.((runs) => {
      for (const run of runs) {
        toast.warning(`Agent interrupted: ${run.mode} on task`, {
          description: `The "${run.mode}" agent was interrupted by app shutdown.`,
          duration: 15000,
          action: {
            label: 'Restart',
            onClick: async () => {
              try {
                await window.api.agents.start(run.taskId, run.mode, run.agentType);
                toast.success('Agent restarted');
              } catch (err) {
                reportError(err, 'Agent restart');
              }
            },
          },
        });
      }
    });
    return () => { unsubscribe?.(); };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="projects/:id/config" element={<Navigate to="/settings/project" replace />} />
        <Route path="projects/:id/telegram" element={<TelegramPage />} />
        <Route path="tasks" element={<TaskListPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="kanban" element={<KanbanBoardPage />} />
        <Route path="agents/:runId" element={<AgentRunPage />} />
        <Route path="features" element={<FeatureListPage />} />
        <Route path="features/:id" element={<FeatureDetailPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="automated-agents" element={<AutomatedAgentsPage />} />
        <Route path="cost" element={<CostPage />} />
        <Route path="source-control" element={<SourceControlPage />} />
        <Route path="debug-logs" element={<DebugLogsPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<SettingsPage />} />
          <Route path="theme" element={<ThemePage />} />
          <Route path="pipelines" element={<PipelinesPage />} />
          <Route path="agents" element={<AgentDefinitionsPage />} />
          <Route path="project" element={<ProjectConfigPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <CurrentProjectProvider>
      <ProjectChatSessionsProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
        <Toaster />
      </ProjectChatSessionsProvider>
    </CurrentProjectProvider>
  );
}
