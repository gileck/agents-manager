import React, { useState } from 'react';
import { AppLayout } from '@template/renderer/components/layout/AppLayout';
import { Sidebar } from './Sidebar';
import { TopMenu } from './TopMenu';
import { TabBar } from './TabBar';
import { QuickSwitcher } from './QuickSwitcher';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import { ProjectPickerDialog } from './ProjectPickerDialog';
import { BugReportDialog } from '../bugs/BugReportDialog';
import { PersistentTerminals } from '../terminal/PersistentTerminals';

export function Layout() {
  const [bugDialogOpen, setBugDialogOpen] = useState(false);

  return (
    <>
      <AppLayout
        sidebar={<Sidebar onReportBug={() => setBugDialogOpen(true)} />}
        topMenu={<><TopMenu /><TabBar /></>}
      />
      {/* PersistentTerminals renders xterm instances that survive route changes.
          It uses a portal-like approach: rendered here but positioned absolutely
          to overlay the main content area when on a /terminal route. */}
      <PersistentTerminals />
      <BugReportDialog open={bugDialogOpen} onOpenChange={setBugDialogOpen} />
      <QuickSwitcher />
      <GlobalSearchDialog />
      <ProjectPickerDialog />
    </>
  );
}
