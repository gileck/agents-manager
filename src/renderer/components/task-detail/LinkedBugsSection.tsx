import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bug } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { BugReportDialog } from '../bugs/BugReportDialog';
import { LinkExistingTaskDialog } from '../bugs/LinkExistingTaskDialog';
import { reportError } from '../../lib/error-handler';
import { fetchAllBugs } from '../../lib/bug-queries';
import type { Task } from '../../../shared/types';

interface LinkedBugsSectionProps {
  taskId: string;
}

export function LinkedBugsSection({ taskId }: LinkedBugsSectionProps) {
  const navigate = useNavigate();
  const [linkedBugs, setLinkedBugs] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const fetchLinkedBugs = useCallback(async () => {
    try {
      // Fetch all bug tasks (by type + tag) and filter client-side for sourceTaskId === taskId
      const allBugs = await fetchAllBugs();
      const linked = allBugs.filter(
        (t) => (t.metadata as Record<string, unknown> | undefined)?.sourceTaskId === taskId,
      );
      setLinkedBugs(linked);
    } catch (err) {
      reportError(err, 'Load linked bugs');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void fetchLinkedBugs();
  }, [fetchLinkedBugs]);

  const handleReportDialogClose = useCallback(
    (open: boolean) => {
      setReportDialogOpen(open);
      if (!open) {
        // Refetch after dialog closes to show newly created bug
        void fetchLinkedBugs();
      }
    },
    [fetchLinkedBugs],
  );

  const handleLinkDialogClose = useCallback(
    (open: boolean) => {
      setLinkDialogOpen(open);
      if (!open) {
        // Refetch after dialog closes to show newly linked bug
        void fetchLinkedBugs();
      }
    },
    [fetchLinkedBugs],
  );

  const statusColor = (status: string) => {
    if (status === 'closed' || status === 'done' || status === 'merged') return 'default';
    if (status === 'in_progress' || status === 'implementing') return 'secondary';
    return 'outline';
  };

  return (
    <>
      <Card>
        <CardHeader className="py-3">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Bug className="h-3.5 w-3.5" />
              Linked Bugs
              {linkedBugs.length > 0 && (
                <span className="ml-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0 text-xs font-medium">
                  {linkedBugs.length}
                </span>
              )}
            </CardTitle>
            <div style={{ display: 'flex', gap: '4px' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLinkDialogOpen(true)}
                className="h-6 text-xs"
              >
                Link Existing
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReportDialogOpen(true)}
                className="h-6 text-xs"
              >
                Report Bug
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-3">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : linkedBugs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No linked bugs.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {linkedBugs.map((bug) => (
                <div
                  key={bug.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent text-sm"
                  onClick={() => navigate(`/tasks/${bug.id}`)}
                >
                  <span className="truncate flex-1">{bug.title}</span>
                  <Badge variant={statusColor(bug.status)} className="text-xs shrink-0">
                    {bug.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <BugReportDialog
        open={reportDialogOpen}
        onOpenChange={handleReportDialogClose}
        initialSourceTaskId={taskId}
      />

      <LinkExistingTaskDialog
        open={linkDialogOpen}
        onOpenChange={handleLinkDialogClose}
        taskId={taskId}
        excludeTaskIds={linkedBugs.map((b) => b.id)}
      />
    </>
  );
}
