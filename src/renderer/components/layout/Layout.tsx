import React, { useState } from 'react';
import { AppLayout } from '@template/renderer/components/layout/AppLayout';
import { Sidebar } from './Sidebar';
import { BugReportDialog } from '../bugs/BugReportDialog';

export function Layout() {
  const [bugDialogOpen, setBugDialogOpen] = useState(false);

  return (
    <>
      <AppLayout sidebar={<Sidebar onReportBug={() => setBugDialogOpen(true)} />} />
      <BugReportDialog open={bugDialogOpen} onOpenChange={setBugDialogOpen} />
    </>
  );
}
