import React from 'react';
import { reportError } from '../lib/error-handler';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, 'React render');
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleCopy = () => {
    const { error } = this.state;
    if (error) {
      navigator.clipboard.writeText(error.stack || error.message);
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm max-w-lg w-full p-6 space-y-4">
            <h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground shadow hover:bg-primary/90"
              >
                Try Again
              </button>
              <button
                onClick={this.handleCopy}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                Copy Error
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
