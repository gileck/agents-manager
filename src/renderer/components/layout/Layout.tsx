import React from 'react';
import { AppLayout } from '@template/renderer/components/layout/AppLayout';
import { Sidebar } from './Sidebar';

export function Layout() {
  return <AppLayout sidebar={<Sidebar />} />;
}
