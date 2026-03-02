import type { AutomatedAgentSchedule } from '../../shared/types';

/**
 * Compute the next run time for an automated agent schedule.
 * Returns null for manual schedules.
 */
export function computeNextRunAt(schedule: AutomatedAgentSchedule, afterMs: number): number | null {
  switch (schedule.type) {
    case 'manual':
      return null;

    case 'interval': {
      const intervalMs = parseInt(schedule.value, 10);
      if (isNaN(intervalMs) || intervalMs <= 0) return null;
      return afterMs + intervalMs;
    }

    case 'daily-at': {
      const match = schedule.value.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const targetHour = parseInt(match[1], 10);
      const targetMinute = parseInt(match[2], 10);
      if (targetHour < 0 || targetHour > 23 || targetMinute < 0 || targetMinute > 59) return null;

      const d = new Date(afterMs);
      d.setHours(targetHour, targetMinute, 0, 0);
      // If the target time has already passed today, schedule for tomorrow
      if (d.getTime() <= afterMs) {
        d.setDate(d.getDate() + 1);
      }
      return d.getTime();
    }

    case 'cron': {
      return computeNextCron(schedule.value, afterMs);
    }

    default:
      return null;
  }
}

/**
 * Lightweight 5-field cron parser: minute hour day-of-month month day-of-week.
 * Supports: numbers, *, and step (n/step).
 * Advances minute-by-minute from afterMs until all fields match.
 * Cap at 366 days to prevent infinite loop.
 */
function computeNextCron(expr: string, afterMs: number): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const matchers = parts.map(parseCronField);
  if (matchers.some(m => m === null)) return null;
  const [matchMinute, matchHour, matchDom, matchMonth, matchDow] = matchers as ((v: number) => boolean)[];

  const maxIterations = 366 * 24 * 60; // 1 year in minutes
  const d = new Date(afterMs);
  // Start from next minute
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  for (let i = 0; i < maxIterations; i++) {
    const minute = d.getMinutes();
    const hour = d.getHours();
    const dom = d.getDate();
    const month = d.getMonth() + 1; // cron uses 1-12
    const dow = d.getDay(); // 0=Sunday

    if (matchMinute(minute) && matchHour(hour) && matchDom(dom) && matchMonth(month) && matchDow(dow)) {
      return d.getTime();
    }

    d.setMinutes(d.getMinutes() + 1);
  }

  return null;
}

function parseCronField(field: string): ((v: number) => boolean) | null {
  if (field === '*') return () => true;

  // Step: */n or n/step
  const stepMatch = field.match(/^(\*|\d+)\/(\d+)$/);
  if (stepMatch) {
    const start = stepMatch[1] === '*' ? 0 : parseInt(stepMatch[1], 10);
    const step = parseInt(stepMatch[2], 10);
    if (isNaN(start) || isNaN(step) || step <= 0) return null;
    return (v: number) => (v - start) % step === 0 && v >= start;
  }

  // Comma-separated values
  if (field.includes(',')) {
    const values = field.split(',').map(v => parseInt(v, 10));
    if (values.some(isNaN)) return null;
    const set = new Set(values);
    return (v: number) => set.has(v);
  }

  // Range: n-m
  const rangeMatch = field.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    if (isNaN(lo) || isNaN(hi)) return null;
    return (v: number) => v >= lo && v <= hi;
  }

  // Single value
  const num = parseInt(field, 10);
  if (isNaN(num)) return null;
  return (v: number) => v === num;
}
