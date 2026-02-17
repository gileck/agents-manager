import React, { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { TaskListPage } from './pages/TaskListPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { AgentRunPage } from './pages/AgentRunPage';
import { SettingsPage } from './pages/SettingsPage';
import { PipelinesPage } from './pages/PipelinesPage';
import { useTheme } from '@template/renderer/hooks/useTheme';
import { CurrentProjectProvider } from './contexts/CurrentProjectContext';

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

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="tasks" element={<TaskListPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="agents/:runId" element={<AgentRunPage />} />
        <Route path="pipelines" element={<PipelinesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <CurrentProjectProvider>
      <AppRoutes />
    </CurrentProjectProvider>
  );
}
