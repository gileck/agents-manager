// Re-export template utilities so src/ components import from the app layer,
// not directly from @template/. This indirection allows swapping or extending
// template utilities without touching every consumer.
export { cn, formatDuration, stripAnsi } from '@template/renderer/lib/utils';

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
