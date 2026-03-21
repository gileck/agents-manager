import { toast } from 'sonner';

interface NormalizedError {
  message: string;
  stack?: string;
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  if (error !== null && typeof error === 'object' && 'message' in error) {
    return { message: String((error as { message: unknown }).message) };
  }
  return { message: String(error) };
}

/** Extract task ID from the current route (hash-based routing). */
export function extractTaskIdFromRoute(): string | null {
  const hash = window.location.hash || '';
  const match = hash.match(/\/tasks\/([^/]+)/);
  return match?.[1] ?? null;
}

/** Collect rich debug context: app debug logs, task timeline, and task events. */
export async function collectDebugContext(stackTrace: string): Promise<string> {
  const sections: string[] = [];

  // Always include the stack trace first
  if (stackTrace) {
    sections.push('--- Stack Trace ---', stackTrace);
  }

  // Fetch recent application debug logs (last 5 minutes)
  try {
    const logs = await window.api.debugLogs.list({
      since: Date.now() - 5 * 60_000,
      limit: 50,
    });
    if (logs.length > 0) {
      const formatted = logs.map((entry) => {
        const time = new Date(entry.createdAt).toISOString();
        return `[${time}] [${entry.source}/${entry.level}] ${entry.message}`;
      }).join('\n');
      sections.push('', '--- Application Debug Logs (last 5 min) ---', formatted);
    }
  } catch {
    sections.push('', '--- Application Debug Logs: failed to fetch ---');
  }

  // If we're on a task page, fetch task-specific debug data
  const taskId = extractTaskIdFromRoute();
  if (taskId) {
    // Fetch task debug timeline
    try {
      const timeline = await window.api.tasks.debugTimeline(taskId);
      if (timeline.length > 0) {
        const formatted = timeline.slice(0, 50).map((entry) => {
          const time = new Date(entry.timestamp).toISOString();
          return `[${time}] [${entry.source}/${entry.severity}] ${entry.title}`;
        }).join('\n');
        sections.push('', `--- Timeline (task ${taskId}) ---`, formatted);
      }
    } catch {
      sections.push('', `--- Timeline (task ${taskId}): failed to fetch ---`);
    }

    // Fetch task events
    try {
      const events = await window.api.events.list({ taskId });
      if (events.length > 0) {
        const formatted = events.slice(0, 50).map((event) => {
          const time = new Date(event.createdAt).toISOString();
          return `[${time}] [${event.category}/${event.severity}] ${event.message}`;
        }).join('\n');
        sections.push('', `--- Events (task ${taskId}) ---`, formatted);
      }
    } catch {
      sections.push('', `--- Events (task ${taskId}): failed to fetch ---`);
    }
  }

  return sections.join('\n');
}

export async function createBugReport(title: string, message: string, fullDetail: string): Promise<void> {
  try {
    const settings = await window.api.settings.get();
    const projectId = settings.currentProjectId;
    if (!projectId) {
      toast.warning('Select a project first');
      return;
    }

    let pipelineId = settings.defaultPipelineId;
    if (!pipelineId) {
      const pipelines = await window.api.pipelines.list();
      if (pipelines.length === 0) {
        toast.warning('No pipelines configured');
        return;
      }
      pipelineId = pipelines[0].id;
    }

    // Extract route context
    const currentRoute = window.location.hash || window.location.pathname;
    const taskId = extractTaskIdFromRoute();

    // Build rich description with context
    const descriptionSections: string[] = [
      '## Error',
      `\`\`\`\n${message}\n\`\`\``,
      '',
      '## Context',
      `- **Route:** \`${currentRoute}\``,
    ];
    if (taskId) {
      descriptionSections.push(`- **Related Task:** \`${taskId}\``);
    }

    const description = descriptionSections.join('\n');

    // Collect rich debug info (non-fatal — falls back to stack trace only)
    let debugInfo: string;
    try {
      debugInfo = await collectDebugContext(fullDetail);
    } catch {
      debugInfo = fullDetail;
    }

    const task = await window.api.tasks.create({
      projectId,
      pipelineId,
      title: `[Bug] ${title}`,
      description,
      debugInfo,
      type: 'bug',
      tags: ['bug'],
      metadata: {
        ...(taskId ? { relatedTaskId: taskId } : {}),
        route: currentRoute,
      },
    });

    toast.success('Bug report created', {
      action: {
        label: 'View Task',
        onClick: () => {
          window.location.hash = `#/tasks/${task.id}`;
        },
      },
    });
  } catch (err) {
    console.error('[createBugReport]', err);
    toast.error('Failed to create bug report');
  }
}

export function reportError(error: unknown, context?: string): void {
  const { message, stack } = normalizeError(error);

  const title = context ? `${context} failed` : 'Something went wrong';
  const fullDetail = stack || message;

  console.error(context ? `[${context}]` : '[error]', error);

  toast.error(title, {
    description: message,
    duration: 8000,
    action: {
      label: 'Copy Error',
      onClick: () => {
        navigator.clipboard.writeText(fullDetail);
      },
    },
    cancel: {
      label: 'Report Bug',
      onClick: () => {
        createBugReport(title, message, fullDetail);
      },
    },
  });
}
