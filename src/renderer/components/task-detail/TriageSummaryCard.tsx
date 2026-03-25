import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { PlanMarkdown } from './PlanMarkdown';
import type { TaskContextEntry } from '../../../shared/types';

interface TriageSummaryCardProps {
  entries: TaskContextEntry[];
}

export function TriageSummaryCard({ entries }: TriageSummaryCardProps) {
  // Find the latest triage_summary entry (highest createdAt)
  const triageEntry = entries
    .filter((e) => e.entryType === 'triage_summary')
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  if (!triageEntry) return null;

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm">Triage Summary</CardTitle>
          <Badge variant="secondary" className="text-xs">triage</Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <PlanMarkdown content={triageEntry.summary} />
      </CardContent>
    </Card>
  );
}
