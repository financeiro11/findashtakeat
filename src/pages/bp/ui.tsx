/** Primitivas visuais compartilhadas pelas abas do BP. */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  titulo,
  legenda,
  children,
  className,
}: {
  titulo?: ReactNode;
  legenda?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {(titulo || legenda) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
          {titulo && <h3 className="text-[13.5px] font-semibold text-foreground">{titulo}</h3>}
          {legenda && <span className="text-[11px] text-muted-foreground">{legenda}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({
  titulo,
  valor,
  nota,
  tom = "neutro",
  title,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  tom?: "neutro" | "positivo" | "negativo";
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">{titulo}</div>
      <div
        className={cn(
          "mt-2 text-[19px] font-bold tracking-tight num",
          title && "cursor-help",
          tom === "positivo" && "text-emerald-600",
          tom === "negativo" && "text-primary",
          tom === "neutro" && "text-foreground",
        )}
        title={title}
      >
        {valor}
      </div>
      {nota && <div className="mt-1 text-[10.5px] text-muted-foreground">{nota}</div>}
    </div>
  );
}

/** Faixa de KPIs — 2 colunas no mobile, até 6 no desktop. */
export function FaixaKpis({ children, colunas = 6 }: { children: ReactNode; colunas?: 5 | 6 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 md:grid-cols-3",
        colunas === 6 ? "lg:grid-cols-6" : "lg:grid-cols-5",
      )}
    >
      {children}
    </div>
  );
}

/** Barra de proporção usada nas tabelas de canal e custo por time. */
export function Barra({ valor, className }: { valor: number; className?: string }) {
  return (
    <div className="h-1.5 w-full max-w-[180px] rounded-full bg-muted overflow-hidden">
      <div
        className={cn("h-full rounded-full bg-primary", className)}
        style={{ width: `${Math.min(100, Math.max(0, valor * 100))}%` }}
      />
    </div>
  );
}

const TONS = {
  critico: {
    faixa: "bg-primary/10 text-primary",
    caixa: "border-primary/20 bg-primary/5",
    rotulo: "CRÍTICO",
  },
  atencao: {
    faixa: "bg-amber-100 text-amber-700",
    caixa: "border-amber-200 bg-amber-50/60",
    rotulo: "ATENÇÃO",
  },
  info: {
    faixa: "bg-blue-100 text-blue-700",
    caixa: "border-blue-200 bg-blue-50/60",
    rotulo: "INFO",
  },
} as const;

export type TomAlerta = keyof typeof TONS;

export function Alerta({
  tom,
  titulo,
  children,
}: {
  tom: TomAlerta;
  titulo: string;
  children: ReactNode;
}) {
  const t = TONS[tom];
  return (
    <div className={cn("rounded-lg border p-4", t.caixa)}>
      <span
        className={cn(
          "inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.08em]",
          t.faixa,
        )}
      >
        {t.rotulo}
      </span>
      <h4 className="mt-2 text-[13px] font-semibold text-foreground">{titulo}</h4>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/** Cabeçalho de tabela no padrão do módulo. */
export function Th({
  children,
  alinhar = "right",
  className,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { alinhar?: "left" | "right" }) {
  return (
    <th
      {...rest}
      className={cn(
        "px-2 py-2 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap",
        alinhar === "left" ? "text-left" : "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  alinhar = "right",
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { alinhar?: "left" | "right" }) {
  return (
    <td
      {...rest}
      className={cn(
        "px-2 py-1.5 text-[12px] whitespace-nowrap",
        alinhar === "left" ? "text-left" : "text-right num",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Aviso de dado incompleto — usado onde a planilha ainda não foi importada. */
export function Ressalva({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border/60">
      {children}
    </p>
  );
}
