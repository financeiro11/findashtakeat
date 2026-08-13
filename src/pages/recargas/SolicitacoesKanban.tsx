// Fila de solicitações de recarga de celular, em kanban.
//
// O Financeiro só consegue fazer ~40 recargas por dia, então o que importa aqui não é
// "quais linhas existem" (isso é a aba Linhas) e sim "o que está na fila, por ordem de
// pedido". Cada card é uma solicitação vinda do TakeatOS.
//
// Arrastar entre colunas grava o status. Ao cair em Concluída, a data da recarga é
// registrada — é ela que o TakeatOS recebe de volta no callback.

import { useEffect, useMemo, useState } from "react";
import {
  Smartphone,
  Clock,
  Search,
  RefreshCw,
  CalendarCheck,
  Calendar as CalendarIcon,
  FilterX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type StatusSolicitacao = "Pendente" | "Concluída" | "Cancelada";

// A ordem aqui é a ordem das colunas na tela.
const COLUNAS: { status: StatusSolicitacao; titulo: string; cls: string; dot: string }[] = [
  {
    status: "Pendente",
    titulo: "Pendentes",
    cls: "border-amber-500/30 bg-amber-500/5",
    dot: "bg-amber-500",
  },
  {
    status: "Concluída",
    titulo: "Feitas",
    cls: "border-emerald-500/30 bg-emerald-500/5",
    dot: "bg-emerald-500",
  },
  {
    status: "Cancelada",
    titulo: "Canceladas",
    cls: "border-border bg-muted/30",
    dot: "bg-muted-foreground",
  },
];

// Intervalo de datas — mesma mecânica de filtro de data usada em SheetMirrorPage.
type Periodo = { from?: Date; to?: Date; preset?: string };

const PRESETS: { id: string; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "mes", label: "Mês atual" },
  { id: "mes_ant", label: "Mês passado" },
  { id: "3m", label: "Últimos 3 meses" },
  { id: "ano", label: "Este ano" },
];

function aplicarPreset(preset: string): Periodo {
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const fim = new Date(hoje);
  fim.setHours(23, 59, 59, 999);
  switch (preset) {
    case "hoje":
      return { from: hoje, to: fim, preset };
    case "7d": {
      const f = new Date(hoje);
      f.setDate(f.getDate() - 6);
      return { from: f, to: fim, preset };
    }
    case "mes":
      return { from: new Date(agora.getFullYear(), agora.getMonth(), 1), to: fim, preset };
    case "mes_ant": {
      const f = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
      const t = new Date(agora.getFullYear(), agora.getMonth(), 0);
      t.setHours(23, 59, 59, 999);
      return { from: f, to: t, preset };
    }
    case "3m":
      return { from: new Date(agora.getFullYear(), agora.getMonth() - 2, 1), to: fim, preset };
    case "ano":
      return { from: new Date(agora.getFullYear(), 0, 1), to: fim, preset };
    default:
      return {};
  }
}

const fmtDia = (d?: Date) => (d ? d.toLocaleDateString("pt-BR") : "—");

const AVATAR_COLORS = [
  "bg-rose-500", "bg-violet-500", "bg-emerald-500", "bg-sky-500",
  "bg-amber-500", "bg-fuchsia-500", "bg-teal-500", "bg-orange-500",
];
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "").join("") || "—";

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    : "—";

export type Solicitacao = {
  id: string;
  colaborador: string;
  numero: string | null;
  operadora: string | null;
  setor: string | null;
  valor: number | null;
  solicitado_em: string;
  concluido_em: string | null;
  posicao_do_dia: number | null;
  status: StatusSolicitacao;
};

export default function SolicitacoesKanban() {
  const [itens, setItens] = useState<Solicitacao[]>([]);
  const [loading, setLoading] = useState(false);
  // Distingue "não há pedidos" de "a tabela ainda não existe neste banco" — sem isso
  // a tela mostraria "nenhuma solicitação" e esconderia um erro de setup.
  const [semTabela, setSemTabela] = useState(false);
  const [q, setQ] = useState("");
  // Sem período escolhido a fila mostra tudo — o Financeiro decide o recorte.
  const [periodo, setPeriodo] = useState<Periodo>({});
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<StatusSolicitacao | null>(null);

  useEffect(() => { carregar(); }, []);

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("recargas_celulares_solicitacoes" as never)
      .select("*")
      .order("solicitado_em", { ascending: true });
    setLoading(false);
    if (error) {
      // 42P01 = tabela inexistente; PGRST205 = schema cache do PostgREST sem ela.
      if (error.code === "42P01" || error.code === "PGRST205") {
        setSemTabela(true);
        return;
      }
      toast.error(error.message);
      return;
    }
    setSemTabela(false);
    setItens((data as unknown as Solicitacao[]) || []);
  };

  const mover = async (id: string, status: StatusSolicitacao) => {
    const atual = itens.find((i) => i.id === id);
    if (!atual || atual.status === status) return;

    // Cair em "Feitas" É o registro da data da recarga. Sair de lá limpa a marca,
    // senão um card reaberto ficaria alegando uma recarga que não aconteceu.
    const concluido_em = status === "Concluída" ? new Date().toISOString() : null;

    setItens((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status, concluido_em } : i)),
    );

    const { error } = await supabase
      .from("recargas_celulares_solicitacoes" as never)
      .update({ status, concluido_em } as never)
      .eq("id", id);

    if (error) {
      setItens((prev) => prev.map((i) => (i.id === id ? atual : i)));
      toast.error("Não foi possível mover: " + error.message);
      return;
    }
    toast.success(
      status === "Concluída"
        ? `Recarga de ${atual.colaborador} registrada como feita.`
        : `Solicitação movida para ${status}.`,
    );
  };

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    const noPeriodo = (s: Solicitacao) => {
      if (!periodo.from && !periodo.to) return true;
      if (!s.solicitado_em) return false;
      const d = new Date(s.solicitado_em);
      if (periodo.from && d < periodo.from) return false;
      if (periodo.to && d > periodo.to) return false;
      return true;
    };
    return itens.filter(noPeriodo).filter((s) =>
      !termo
        ? true
        : [s.colaborador, s.numero, s.operadora, s.setor].some((x) =>
            String(x || "").toLowerCase().includes(termo),
          ),
    );
  }, [itens, q, periodo]);

  const porColuna = (status: StatusSolicitacao) =>
    filtrados.filter((s) => s.status === status);

  const temPeriodo = !!(periodo.from || periodo.to);
  // Rótulo do botão: o nome do preset quando há um, senão o intervalo escolhido.
  const rotuloPeriodo = !temPeriodo
    ? "Período"
    : periodo.preset
      ? PRESETS.find((p) => p.id === periodo.preset)?.label || "Período"
      : `${fmtDia(periodo.from)} → ${fmtDia(periodo.to)}`;

  // Só o que está pendente no recorte: é o dinheiro que o Financeiro ainda vai gastar.
  const totalPendente = useMemo(
    () =>
      filtrados
        .filter((s) => s.status === "Pendente")
        .reduce((a, s) => a + Number(s.valor || 0), 0),
    [filtrados],
  );

  return (
    <div className="space-y-4">
      {/* Busca + período + resumo, tudo numa barra só */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por colaborador, número ou operadora…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border-0 bg-transparent pl-8 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* Filtro por data da solicitação — presets + calendário */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn(temPeriodo && "border-rose-500/40 text-rose-600 dark:text-rose-400")}>
                <CalendarIcon className="mr-1.5 h-4 w-4" />
                {rotuloPeriodo}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="pointer-events-auto w-auto p-3" align="end">
              <div className="mb-2 grid grid-cols-2 gap-1">
                {PRESETS.map((pr) => (
                  <Button
                    key={pr.id}
                    variant={periodo.preset === pr.id ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPeriodo(aplicarPreset(pr.id))}
                  >
                    {pr.label}
                  </Button>
                ))}
              </div>
              <div className="space-y-2 border-t pt-2">
                <div className="text-xs font-medium text-muted-foreground">Personalizado</div>
                <Calendar
                  mode="range"
                  selected={{ from: periodo.from, to: periodo.to }}
                  onSelect={(r) => setPeriodo({ from: r?.from, to: r?.to, preset: undefined })}
                  numberOfMonths={1}
                  className="pointer-events-auto p-0"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{fmtDia(periodo.from)} → {fmtDia(periodo.to)}</span>
                  {temPeriodo && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setPeriodo({})}>
                      <FilterX className="mr-1 h-3 w-3" /> Limpar
                    </Button>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground">
            {filtrados.length} solicitação(ões)
          </span>
          <span className="font-semibold">{fmtBRL(totalPendente)} pendente</span>
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {semTabela ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium">A fila de solicitações ainda não existe neste banco</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Falta aplicar a migration <code>20260813120000_recargas_celulares_solicitacoes.sql</code>.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {COLUNAS.map((col) => {
            const cards = porColuna(col.status);
            const soltando = alvo === col.status;
            return (
              <div
                key={col.status}
                onDragOver={(e) => { e.preventDefault(); setAlvo(col.status); }}
                onDragLeave={() => setAlvo((a) => (a === col.status ? null : a))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (arrastando) mover(arrastando, col.status);
                  setArrastando(null);
                  setAlvo(null);
                }}
                className={cn(
                  "flex min-h-[260px] flex-col gap-2 rounded-lg border p-2.5 transition",
                  col.cls,
                  soltando && "ring-2 ring-rose-500/40",
                )}
              >
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                    <span className="text-[13px] font-semibold">{col.titulo}</span>
                  </div>
                  <Badge variant="outline" className="h-5 rounded-full px-2 text-[10.5px]">
                    {cards.length}
                  </Badge>
                </div>

                {cards.map((s) => (
                  <div
                    key={s.id}
                    draggable
                    onDragStart={() => setArrastando(s.id)}
                    onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                    className={cn(
                      "cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing",
                      arrastando === s.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
                            colorFor(s.colaborador),
                          )}
                        >
                          {initials(s.colaborador)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold leading-tight">
                            {s.colaborador}
                          </div>
                          <div className="truncate text-[10.5px] text-muted-foreground">
                            {s.setor || "Colaborador"}
                          </div>
                        </div>
                      </div>
                      {/* Posição na fila do dia: o Financeiro atende por ordem de pedido */}
                      {s.posicao_do_dia != null && (
                        <Badge variant="outline" className="h-5 shrink-0 rounded-full px-2 text-[10.5px]">
                          #{s.posicao_do_dia}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-start gap-1.5">
                      <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12.5px] font-medium leading-tight">
                          {s.numero || "—"}
                        </div>
                        {s.operadora && (
                          <div className="truncate text-[11px] text-muted-foreground">{s.operadora}</div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        Solicitado em {fmtDataHora(s.solicitado_em)}
                      </div>
                      {s.concluido_em && (
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <CalendarCheck className="h-3 w-3" />
                          Recarga feita em {fmtDataHora(s.concluido_em)}
                        </div>
                      )}
                    </div>

                    <div className="mt-2.5 border-t border-border pt-2 text-base font-bold leading-none">
                      {fmtBRL(Number(s.valor || 0))}
                    </div>
                  </div>
                ))}

                {!cards.length && (
                  <p className="px-1 py-6 text-center text-[11.5px] text-muted-foreground">
                    {loading ? "Carregando…" : "Nada aqui"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Arraste um card entre as colunas para mudar o status. Ao soltar em{" "}
        <strong className="font-semibold">Feitas</strong>, a data da recarga é registrada.
      </p>
    </div>
  );
}
