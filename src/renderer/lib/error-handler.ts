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
  });
}
