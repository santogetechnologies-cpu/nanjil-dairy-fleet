import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production, you'd log to a service like Sentry here
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] Uncaught error:", error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
          <div className="mb-4 text-6xl">⚠️</div>
          <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            An unexpected error occurred. Please restart the app or contact support if the issue persists.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 max-w-full overflow-auto rounded bg-muted p-4 text-left text-xs text-destructive">
              {this.state.error.message}
            </pre>
          )}
          <button
            className="mt-6 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.hash = "/";
            }}
          >
            Go to Home
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
