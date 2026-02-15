import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

export interface SidebarProps {
  appName: string;
  appIcon?: LucideIcon;
  navItems: NavItem[];
  version?: string;
}

export function Sidebar({ appName, appIcon: AppIcon, navItems, version }: SidebarProps) {
  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col">
      {/* Logo */}
      <div className="flex items-center px-4 pt-5 pb-4 border-b border-border">
        {AppIcon && <AppIcon className="h-5 w-5 text-blue-500 mr-2" />}
        <span className="font-semibold text-sm">{appName}</span>
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
      {version && (
        <div className="p-4 border-t border-border text-xs text-muted-foreground">
          <p>{appName} v{version}</p>
        </div>
      )}
    </aside>
  );
}
