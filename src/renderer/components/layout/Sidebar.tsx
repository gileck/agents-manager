import React from 'react';
import { Sidebar as TemplateSidebar } from '@template/renderer/components/layout/Sidebar';
import { LayoutDashboard, FolderOpen, CheckSquare, Settings } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  return (
    <TemplateSidebar
      appName="Agents Manager"
      appIcon={LayoutDashboard}
      navItems={navItems}
      version="1.0.0"
    />
  );
}
