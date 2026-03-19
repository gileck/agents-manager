import React from 'react';
import { GenericReviewSection } from './GenericReviewSection';
import type { Transition, TaskContextEntry } from '../../../shared/types';

interface DesignReviewSectionProps {
  taskId: string;
  entries: TaskContextEntry[];
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onRefetch: () => Promise<void> | void;
}

export function DesignReviewSection(props: DesignReviewSectionProps) {
  return (
    <GenericReviewSection
      {...props}
      title="Design Review"
      entryType="design_feedback"
      approveToStatus="implementing"
      reviseToStatus="designing"
      approveLabel="Approve & Implement"
      reviseLabel="Request Design Changes"
      placeholder="Add feedback for the design agent..."
    />
  );
}
