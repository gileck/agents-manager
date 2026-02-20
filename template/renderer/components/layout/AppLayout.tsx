import React, { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

export interface AppLayoutProps {
  sidebar?: ReactNode;
  topMenu?: ReactNode;
  children?: ReactNode;
}

export function AppLayout({ sidebar, topMenu, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {sidebar}
      <div className="flex-1 flex flex-col overflow-hidden">
        {topMenu}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/30">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
