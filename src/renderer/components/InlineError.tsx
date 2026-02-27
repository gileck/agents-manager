import { Button } from './ui/button';
import { createBugReport } from '../lib/error-handler';

interface InlineErrorProps {
  message: string;
  context?: string;
}

export function InlineError({ message, context }: InlineErrorProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(message);
  };

  const handleReportBug = () => {
    const title = context ? `${context}: ${message}` : message;
    createBugReport(title, message, message);
  };

  return (
    <div className="space-y-2">
      <p className="text-destructive">{message}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" type="button" onClick={handleCopy}>
          Copy Error
        </Button>
        <Button variant="outline" size="sm" type="button" onClick={handleReportBug}>
          Report Bug
        </Button>
      </div>
    </div>
  );
}
