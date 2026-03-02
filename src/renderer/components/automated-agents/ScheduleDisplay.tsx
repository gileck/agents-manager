import React from 'react';
import type { AutomatedAgentSchedule } from '../../../shared/types';

export function formatSchedule(schedule: AutomatedAgentSchedule): string {
  switch (schedule.type) {
    case 'manual':
      return 'Manual only';
    case 'interval': {
      const ms = parseInt(schedule.value, 10);
      if (isNaN(ms)) return 'Invalid interval';
      if (ms < 60000) return `Every ${Math.round(ms / 1000)}s`;
      if (ms < 3600000) return `Every ${Math.round(ms / 60000)} min`;
      if (ms < 86400000) return `Every ${Math.round(ms / 3600000)} hour${Math.round(ms / 3600000) !== 1 ? 's' : ''}`;
      return `Every ${Math.round(ms / 86400000)} day${Math.round(ms / 86400000) !== 1 ? 's' : ''}`;
    }
    case 'daily-at':
      return `Daily at ${schedule.value}`;
    case 'cron':
      return `Cron: ${schedule.value}`;
    default:
      return 'Unknown';
  }
}

interface ScheduleDisplayProps {
  schedule: AutomatedAgentSchedule;
}

export function ScheduleDisplay({ schedule }: ScheduleDisplayProps) {
  return <span className="text-xs text-muted-foreground">{formatSchedule(schedule)}</span>;
}
