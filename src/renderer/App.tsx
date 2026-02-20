import React, { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectConfigPage } from './pages/ProjectConfigPage';
import { TaskListPage } from './pages/TaskListPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { AgentRunPage } from './pages/AgentRunPage';
import { SettingsPage } from './pages/SettingsPage';
import { AgentDefinitionsPage } from './pages/AgentDefinitionsPage';
import { PipelinesPage } from './pages/PipelinesPage';
import { FeatureListPage } from './pages/FeatureListPage';
import { FeatureDetailPage } from './pages/FeatureDetailPage';
import { useTheme } from '@template/renderer/hooks/useTheme';
import { CurrentProjectProvider } from './contexts/CurrentProjectContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/toaster';

function AppRoutes() {
  const navigate = useNavigate();

  // Initialize theme on app load
  useTheme();

  useEffect(() => {
    // Listen for navigation events from main process
    const unsubscribe = window.api?.on?.navigate?.((path: string) => {
      navigate(path);
    });

    return () => {
      unsubscribe?.();
    };
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
              } catch {
                toast.error('Failed to restart agent');
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
        <Route path="projects/:id/config" element={<ProjectConfigPage />} />
        <Route path="tasks" element={<TaskListPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="agents" element={<AgentDefinitionsPage />} />
        <Route path="agents/:runId" element={<AgentRunPage />} />
        <Route path="features" element={<FeatureListPage />} />
        <Route path="features/:id" element={<FeatureDetailPage />} />
        <Route path="pipelines" element={<PipelinesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <CurrentProjectProvider>
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
      <Toaster />
    </CurrentProjectProvider>
  );
}
