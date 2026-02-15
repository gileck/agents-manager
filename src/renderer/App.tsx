import React, { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { ItemsPage } from './pages/ItemsPage';
import { ItemFormPage } from './pages/ItemFormPage';
import { SettingsPage } from './pages/SettingsPage';
import { useTheme } from '@template/renderer/hooks/useTheme';

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
        <Route index element={<HomePage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="items/new" element={<ItemFormPage />} />
        <Route path="items/:id/edit" element={<ItemFormPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
