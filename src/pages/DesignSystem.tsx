import { Delta } from "@/components/ui/delta";

const Swatch = ({ name, varName }: { name: string; varName: string }) => (
  <div className="flex flex-col gap-2">
    <div
      className="h-16 w-full rounded-md border border-border"
      style={{ background: `hsl(var(${varName}))` }}
    />
    <div className="flex flex-col">
      <span className="text-xs font-medium text-foreground">{name}</span>
      <span className="num text-[11px] text-muted-foreground">{varName}</span>
    </div>
  </div>
);

export default function DesignSystem() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Design System</h1>
        <p className="text-sm text-muted-foreground">
          Central do Financeiro · base tokens, tipografia e utilitários.
        </p>
      </header>

      {/* Cores */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cores</h2>
        <div className="grid grid-cols-5 gap-4">
          <Swatch name="Takeat Red" varName="--takeat-red" />
          <Swatch name="Neutral 900" varName="--neutral-900" />
          <Swatch name="Neutral 500" varName="--neutral-500" />
          <Swatch name="Positive" varName="--pos" />
          <Swatch name="Negative" varName="--neg" />
        </div>
      </section>

      {/* Tipografia */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tipografia</h2>
        <div className="space-y-2">
          <p className="text-3xl font-semibold tracking-tight">Inter Tight · 30px / 600</p>
          <p className="text-base font-medium">Inter Tight · 16px / 500 — corpo padrão da interface.</p>
          <p className="text-xs text-muted-foreground">Inter Tight · 12px / 400 — captions e metadata.</p>
        </div>
      </section>

      {/* Delta */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Componente Delta</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-md border border-border p-4">
            <div className="text-xs text-muted-foreground">Positivo</div>
            <Delta value={12.4} />
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="text-xs text-muted-foreground">Negativo</div>
            <Delta value={-8.2} />
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="text-xs text-muted-foreground">Inverse · positivo (gasto subindo)</div>
            <Delta value={5.1} inverse />
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="text-xs text-muted-foreground">Inverse · negativo (gasto caindo)</div>
            <Delta value={-3.7} inverse />
          </div>
        </div>
      </section>

      {/* Linha monetária */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Valor monetário</h2>
        <div className="rounded-md border border-border p-4">
          <span className="text-sm text-muted-foreground">Receita: </span>
          <span className="num text-lg font-semibold text-foreground">R$ 2.768.420,00</span>
        </div>
      </section>
    </div>
  );
}
