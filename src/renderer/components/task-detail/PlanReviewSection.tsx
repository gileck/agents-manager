import React from 'react';
import { GenericReviewSection } from './GenericReviewSection';
import type { Transition, TaskContextEntry } from '../../../shared/types';

interface PlanReviewSectionProps {
  taskId: string;
  entries: TaskContextEntry[];
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onRefetch: () => Promise<void> | void;
}

export function PlanReviewSection(props: PlanReviewSectionProps) {
  return (
    <GenericReviewSection
      {...props}
      title="Plan Review"
      entryType="plan_feedback"
      approveToStatus="implementing"
      reviseToStatus="planning"
      approveLabel="Approve & Implement"
      reviseLabel="Request Plan Changes"
      placeholder="Add feedback for the planning agent..."
    />
  );
}
