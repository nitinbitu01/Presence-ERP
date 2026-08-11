// src/components/student/ErrorBoundary.tsx
// ─────────────────────────────────────────────────────────────────────────────
import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Shown in the fallback UI so the user knows which section failed */
  sectionName?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Section-level error boundary.
 * Catches render errors in child components and shows a contained
 * fallback — preventing one broken card from crashing the whole dashboard.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage:
        error.message?.toLowerCase().includes("network")
          ? "Network error — check your connection."
          : "This section encountered an error.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary:${this.props.sectionName}]`,
      error,
      info.componentStack,
    );
  }

  reset = () => this.setState({ hasError: false, errorMessage: "" });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center"
      >
        <AlertTriangle className="h-8 w-8 text-destructive/60" />
        <div>
          <p className="text-sm font-medium text-destructive">
            {this.props.sectionName
              ? `${this.props.sectionName} failed to load`
              : "Section failed to load"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {this.state.errorMessage}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={this.reset}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    );
  }
}
