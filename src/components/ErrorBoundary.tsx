import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  hardReset = async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.href = "/login";
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-elegant)]">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Algo deu errado</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            A tela não pôde ser renderizada. Detalhe técnico abaixo:
          </p>
          <pre className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs text-foreground/80">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2">
            <Button onClick={this.reset} className="flex-1">
              <RefreshCw className="mr-2 h-4 w-4" /> Recarregar
            </Button>
            <Button variant="outline" onClick={this.hardReset} className="flex-1">
              Sair e limpar sessão
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
