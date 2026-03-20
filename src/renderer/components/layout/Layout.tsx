import React, { useState } from 'react';
import { AppLayout } from '@template/renderer/components/layout/AppLayout';
import { Sidebar } from './Sidebar';
import { TopMenu } from './TopMenu';
import { TabBar } from './TabBar';
import { QuickSwitcher } from './QuickSwitcher';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import { BugReportDialog } from '../bugs/BugReportDialog';

export function Layout() {
  const [bugDialogOpen, setBugDialogOpen] = useState(false);

  return (
    <>
      <AppLayout
        sidebar={<Sidebar onReportBug={() => setBugDialogOpen(true)} />}
        topMenu={<><TopMenu /><TabBar /></>}
      />
      <BugReportDialog open={bugDialogOpen} onOpenChange={setBugDialogOpen} />
      <QuickSwitcher />
      <GlobalSearchDialog />
    </>
  );
}
