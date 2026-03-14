import type { DebugTimelineEntry } from '../../shared/types';

export interface ITimelineStore {
  getActivityEntries(taskId: string): DebugTimelineEntry[];
  getAgentRunEntries(taskId: string): DebugTimelineEntry[];
  getArtifactEntries(taskId: string): DebugTimelineEntry[];
  getContextEntries(taskId: string): DebugTimelineEntry[];
  getEventEntries(taskId: string): DebugTimelineEntry[];
  getPhaseEntries(taskId: string): DebugTimelineEntry[];
  getPromptEntries(taskId: string): DebugTimelineEntry[];
  getTransitionEntries(taskId: string): DebugTimelineEntry[];
}
