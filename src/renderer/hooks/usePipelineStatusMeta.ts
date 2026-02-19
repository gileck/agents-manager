import { useMemo } from 'react';
import type { Pipeline, PipelineStatus, StatusCategory, Task } from '../../shared/types';

export interface StatusMeta {
  isAgentRunning: boolean;
  isHumanReview: boolean;
  isWaitingForInput: boolean;
  isTerminal: boolean;
  isReady: boolean;
  category: StatusCategory | undefined;
  color: string;
  showSpinner: boolean;
}

const DEFAULT_COLOR = '#6b7280';

export function resolvePipelineStatusMeta(status: PipelineStatus | undefined): StatusMeta {
  const category = status?.category;
  return {
    isAgentRunning: category === 'agent_running',
    isHumanReview: category === 'human_review',
    isWaitingForInput: category === 'waiting_for_input',
    isTerminal: category === 'terminal',
    isReady: category === 'ready',
    category,
    color: status?.color ?? DEFAULT_COLOR,
    showSpinner: category === 'agent_running',
  };
}

export function usePipelineStatusMeta(task: Task | null | undefined, pipeline: Pipeline | null | undefined): StatusMeta {
  return useMemo(() => {
    if (!task || !pipeline) {
      return resolvePipelineStatusMeta(undefined);
    }
    const status = pipeline.statuses.find((s) => s.name === task.status);
    return resolvePipelineStatusMeta(status);
  }, [task?.status, pipeline?.statuses]);
}
