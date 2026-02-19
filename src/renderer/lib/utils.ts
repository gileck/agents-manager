import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return formatDate(dateString);
}

export function truncatePath(path: string, maxLength = 40): string {
  if (path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 2) return path;

  const fileName = parts[parts.length - 1];
  const firstPart = parts[0] || parts[1];

  if (fileName.length + firstPart.length + 5 > maxLength) {
    return `.../${fileName}`;
  }

  return `${firstPart}/.../${fileName}`;
}

// Strip ANSI escape codes from terminal output
// Matches: \x1B[...m (SGR sequences), \x1B[...H (cursor), etc.
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

// Format hour to 12-hour time string
function _formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}:00 ${period}`;
}

// Format hour and minute to 12-hour time string
function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  return `${h}:${m} ${period}`;
}

// Parse cron expression to human-readable format
export function formatCronSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const _monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];

  // Parse minute
  const min = minute === '*' ? 0 : parseInt(minute, 10);

  // Every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Runs every minute';
  }

  // Every X minutes (*/X format)
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = parseInt(minute.slice(2), 10);
    return `Runs every ${interval} minute${interval > 1 ? 's' : ''}`;
  }

  // Hourly (at specific minute)
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return min === 0 ? 'Runs every hour' : `Runs every hour at :${min.toString().padStart(2, '0')}`;
  }

  // Parse hours (could be single, list, or range)
  const parseHours = (h: string): number[] => {
    if (h === '*') return [];
    if (h.includes(',')) {
      return h.split(',').map(x => parseInt(x, 10)).sort((a, b) => a - b);
    }
    if (h.includes('-')) {
      const [start, end] = h.split('-').map(x => parseInt(x, 10));
      const range: number[] = [];
      for (let i = start; i <= end; i++) range.push(i);
      return range;
    }
    return [parseInt(h, 10)];
  };

  const hours = parseHours(hour);

  // Parse days of week
  const parseDaysOfWeek = (dow: string): number[] => {
    if (dow === '*') return [];
    if (dow.includes(',')) {
      return dow.split(',').map(x => parseInt(x, 10)).sort((a, b) => a - b);
    }
    if (dow.includes('-')) {
      const [start, end] = dow.split('-').map(x => parseInt(x, 10));
      const range: number[] = [];
      for (let i = start; i <= end; i++) range.push(i);
      return range;
    }
    return [parseInt(dow, 10)];
  };

  const weekDays = parseDaysOfWeek(dayOfWeek);

  // Format times
  const formatTimes = (hrs: number[], m: number): string => {
    if (hrs.length === 0) return '';
    if (hrs.length === 1) return formatTime(hrs[0], m);
    if (hrs.length <= 3) {
      return hrs.map(h => formatTime(h, m)).join(', ');
    }
    return `${hrs.length} times daily`;
  };

  // Daily at specific time(s)
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && hours.length > 0) {
    const times = formatTimes(hours, min);
    if (hours.length === 1) {
      return `Runs daily at ${times}`;
    }
    return `Runs daily at ${times}`;
  }

  // Weekly on specific days
  if (dayOfMonth === '*' && month === '*' && weekDays.length > 0 && hours.length > 0) {
    const times = formatTimes(hours, min);
    if (weekDays.length === 5 && !weekDays.includes(0) && !weekDays.includes(6)) {
      return `Runs weekdays at ${times}`;
    }
    if (weekDays.length === 2 && weekDays.includes(0) && weekDays.includes(6)) {
      return `Runs weekends at ${times}`;
    }
    if (weekDays.length === 1) {
      return `Runs ${dayNames[weekDays[0]]}s at ${times}`;
    }
    const days = weekDays.map(d => dayNames[d].slice(0, 3)).join(', ');
    return `Runs ${days} at ${times}`;
  }

  // Monthly on specific day
  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*' && hours.length > 0) {
    const day = parseInt(dayOfMonth, 10);
    const times = formatTimes(hours, min);
    const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
    return `Runs monthly on the ${day}${suffix} at ${times}`;
  }

  // Fall back to showing the cron expression
  return cron;
}

// Format interval (milliseconds) to human-readable format
export function formatIntervalSchedule(ms: number): string {
  if (ms < 60000) {
    const secs = ms / 1000;
    return `Runs every ${secs} second${secs !== 1 ? 's' : ''}`;
  }
  if (ms < 3600000) {
    const mins = ms / 60000;
    return `Runs every ${mins} minute${mins !== 1 ? 's' : ''}`;
  }
  const hours = ms / 3600000;
  return `Runs every ${hours} hour${hours !== 1 ? 's' : ''}`;
}
