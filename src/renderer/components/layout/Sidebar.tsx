import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@template/renderer/lib/utils';
import { LayoutDashboard, FolderOpen, CheckSquare, Layers, Workflow, Bot, Settings } from 'lucide-react';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/features', icon: Layers, label: 'Features' },
  { to: '/pipelines', icon: Workflow, label: 'Pipelines' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { currentProject } = useCurrentProject();

  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-border">
        <div className="flex items-center">
          <LayoutDashboard className="h-5 w-5 text-blue-500 mr-2" />
          <span className="font-semibold text-sm">Agents Manager</span>
        </div>
        <div className="mt-2 text-xs text-muted-foreground truncate">
          {currentProject ? currentProject.name : 'No project selected'}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium mb-1 transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border text-xs text-muted-foreground">
        <p>Agents Manager v1.0.0</p>
      </div>
    </aside>
  );
}
