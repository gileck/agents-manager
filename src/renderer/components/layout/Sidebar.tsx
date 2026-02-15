import React from 'react';
import { Sidebar as TemplateSidebar } from '@template/renderer/components/layout/Sidebar';
import { Home, Package, Settings } from 'lucide-react';

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/items', icon: Package, label: 'Items' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  return (
    <TemplateSidebar
      appName="MacOS App"
      appIcon={Package}
      navItems={navItems}
      version="1.0.0"
    />
  );
}
