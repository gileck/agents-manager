import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Settings, Palette, Workflow, Bot, SlidersHorizontal, Keyboard } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCurrentProject } from '../contexts/CurrentProjectContext';

const tabs = [
  { to: '/settings/general', icon: Settings, label: 'General' },
  { to: '/settings/theme', icon: Palette, label: 'Theme' },
  { to: '/settings/keyboard', icon: Keyboard, label: 'Shortcuts' },
  { to: '/settings/pipelines', icon: Workflow, label: 'Pipelines' },
  { to: '/settings/agents', icon: Bot, label: 'Agents' },
];

export function SettingsLayout() {
  const { currentProjectId } = useCurrentProject();

  return (
    <div className="flex h-full">
      {/* Tab sidebar */}
      <div className="w-44 border-r border-border bg-muted/50 p-3 shrink-0">
        <h2 className="text-lg font-semibold px-3 mb-3">Settings</h2>
        <nav className="space-y-0.5">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )
              }
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </NavLink>
          ))}
          {currentProjectId && (
            <NavLink
              to="/settings/project"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )
              }
            >
              <SlidersHorizontal className="h-4 w-4" />
              Project
            </NavLink>
          )}
        </nav>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
