import { Button } from './ui/button';
import { createBugReport } from '../lib/error-handler';

interface InlineErrorProps {
  message: string;
  context?: string;
  onDismiss?: () => void;
}

export function InlineError({ message, context, onDismiss }: InlineErrorProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(message);
  };

  const handleReportBug = () => {
    const title = context ? `${context}: ${message}` : message;
    createBugReport(title, message, message);
  };

  return (
    <div
      style={{
        borderRadius: 6,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        fontSize: 13,
        backgroundColor: '#2d1111',
        border: '1px solid #7f1d1d',
      }}
    >
      <span style={{ color: '#f87171', marginTop: 1, flexShrink: 0 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: '#f87171' }}>
          {context ? `${context} error` : 'Error'}
        </span>
        <p style={{ fontSize: 12, marginTop: 3, color: '#f87171', opacity: 0.85, wordBreak: 'break-word' }}>
          {message}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={handleCopy}
          style={{ borderColor: '#7f1d1d', color: '#f87171' }}
        >
          Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={handleReportBug}
          style={{ borderColor: '#7f1d1d', color: '#f87171' }}
        >
          Report Bug
        </Button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
