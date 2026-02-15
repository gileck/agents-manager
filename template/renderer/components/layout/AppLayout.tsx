import React, { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

export interface AppLayoutProps {
  sidebar?: ReactNode;
  children?: ReactNode;
}

export function AppLayout({ sidebar, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {sidebar}
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/30">
        {children || <Outlet />}
      </main>
    </div>
  );
}
