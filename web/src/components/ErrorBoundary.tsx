import { Component, type ReactNode } from "react";

/**
 * Minimal error boundary — a crash in one view degrades to a readable message
 * instead of blanking the entire app.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-glow">Something broke</p>
          <h1 className="mt-3 text-2xl font-medium tracking-tight">This view hit an error</h1>
          <p className="mt-3 text-sm text-muted-foreground">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-6 rounded-full border border-border-strong px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
