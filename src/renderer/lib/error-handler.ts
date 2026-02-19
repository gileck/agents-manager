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
  return { message: String(error) };
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

    const description = [
      '## Error',
      '```',
      message,
      '```',
      '',
      '## Stack Trace',
      '```',
      fullDetail,
      '```',
    ].join('\n');

    const task = await window.api.tasks.create({
      projectId,
      pipelineId,
      title: `[Bug] ${title}`,
      description,
      tags: ['bug'],
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
