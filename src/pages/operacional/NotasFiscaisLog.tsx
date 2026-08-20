// O rastro da emissão — o que o processo fez, quando, e por que não deu quando não deu.
//
// SÃO DOIS NÍVEIS, e misturá-los foi o que faltou o dia inteiro em que este módulo
// mentiu sobre uma nota que existia:
//
//   • a RODADA (`nf_execucoes`) responde "o que o processo das 10h fez hoje" — e é
//     gravada MESMO quando não faz nada. Um dia em que a fila veio vazia por defeito
//     e um dia sem nada a emitir são indistinguíveis se ninguém registra os dois.
//   • a COBRANÇA (`nf_emissoes`) responde "o que aconteceu com esta cobrança", com
//     hora, resultado e motivo. É append-only: a linha "em processamento" das 10h02
//     não é apagada quando às 10h05 nasce a nota — ganha uma linha 'ok' ao lado.
//     O rastro é a sequência, não o último estado.
//
// "Em processamento" tem tom próprio de propósito. Ele não é falha: é nota a
// caminho da prefeitura, e chamá-la de erro é o que faz alguém mandar emitir de
// novo — e nota duplicada não se apaga, cancela-se com prazo e justificativa.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import {
  RefreshCw, Loader2, CheckCircle2, XCircle, Clock, FlaskConical,
  PlayCircle, CalendarClock, Info, Power,
} from "lucide-react";

const sb = supabase as any;

const brlStr = (n: number) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brl = (n: number) => comValorExato(n, brlStr(n));

/** "2026-08-20T20:15:12Z" → "20/08 17:15:12" no fuso de quem opera. */
const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).replace(",", "");

interface LinhaLog {
  criado_em: string; id_asaas: string; cliente: string; valor: number | null;
  acao: string; resultado: string; nfse_numero: string | null;
  motivo: string | null; operador: string | null; n_cod_os: number | null;
}

interface Execucao {
  id: string; iniciada_em: string; concluida_em: string | null;
  origem: string; modo: string; fila: number; emitidas: number; falhas: number;
  pulada: string | null; lote: number | null; erro: string | null;
}

const DESFECHO: Record<string, { rotulo: string; tom: string; Icone: typeof CheckCircle2 }> = {
  ok:               { rotulo: "Emitida",         tom: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400", Icone: CheckCircle2 },
  erro:             { rotulo: "Falhou",          tom: "bg-destructive/10 text-destructive border-destructive/20",                        Icone: XCircle },
  em_processamento: { rotulo: "No forno",        tom: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",          Icone: Clock },
};

const ACAO: Record<string, string> = {
  criar_os: "OS criada",
  faturar: "Faturamento",
  criar_e_faturar: "Criar + faturar",
  previa: "Ensaio",
};

/** Os três estados da emissão automática, do ponto de vista de quem decide. */
const MODOS: Record<string, { rotulo: string; ajuda: string; tom: string }> = {
  off: {
    rotulo: "Desligada",
    ajuda: "O cron roda e não emite nada. Só a emissão manual, pelo painel do mês.",
    tom: "border-border bg-muted text-muted-foreground",
  },
  previa: {
    rotulo: "Ensaio",
    ajuda: "O cron monta a fila e registra aqui o que TERIA emitido, sem tocar no Omie. É o modo para conferir um dia antes de liberar.",
    tom: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  on: {
    rotulo: "Emitindo",
    ajuda: "O cron emite de verdade, todo dia às 10h, respeitando o teto diário.",
    tom: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

interface Config {
  emissao_automatica: string; teto_dia: number; teto_rodada: number; data_corte: string | null;
}

export default function NotasFiscaisLog() {
  const [linhas, setLinhas] = useState<LinhaLog[]>([]);
  const [rodadas, setRodadas] = useState<Execucao[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [salvandoModo, setSalvandoModo] = useState(false);
  const [dias, setDias] = useState(7);
  const [filtro, setFiltro] = useState<"todas" | "ok" | "erro" | "em_processamento">("todas");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [log, exec, conf] = await Promise.all([
        sb.rpc("notas_fiscais_log", { p_dias: dias, p_limite: 400 }),
        sb.from("nf_execucoes").select("*").order("iniciada_em", { ascending: false }).limit(30),
        sb.from("nf_config").select("emissao_automatica, teto_dia, teto_rodada, data_corte").eq("id", 1).maybeSingle(),
      ]);
      if (log.error) throw log.error;
      if (exec.error) throw exec.error;
      setLinhas((log.data ?? []) as LinhaLog[]);
      setRodadas((exec.data ?? []) as Execucao[]);
      setCfg((conf.data ?? null) as Config | null);
    } catch (e: any) {
      toast.error("Não foi possível carregar o log.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  /* Ligar a emissão pede confirmação escrita; desligar, não.
     A assimetria é de propósito: ligar passa a emitir nota fiscal sem ninguém
     olhando, e nota emitida não se apaga — cancela-se, com prazo e justificativa.
     Desligar só faz o processo parar, e parar nunca é o erro caro. */
  const trocarModo = async (novo: string) => {
    if (novo === "on") {
      const ok = window.confirm(
        "Ligar a emissão automática?\n\n" +
        "A partir de agora o Hub vai emitir NFS-e sozinho, todo dia às 10h, sem ninguém conferir antes — " +
        `até ${cfg?.teto_dia ?? 120} notas por dia.\n\n` +
        "Nota emitida não se apaga: cancela-se, com prazo e justificativa. " +
        "O recomendado é rodar um dia em Ensaio e conferir o registro antes de ligar.",
      );
      if (!ok) return;
    }
    setSalvandoModo(true);
    try {
      const { error } = await sb.from("nf_config").update({ emissao_automatica: novo }).eq("id", 1);
      if (error) throw error;
      setCfg((c) => (c ? { ...c, emissao_automatica: novo } : c));
      toast.success(`Emissão automática: ${MODOS[novo]?.rotulo ?? novo}.`);
    } catch (e: any) {
      toast.error("Não foi possível mudar o modo.", { description: e?.message });
    } finally {
      setSalvandoModo(false);
    }
  };

  useEffect(() => { void carregar(); }, [carregar]);

  /* Rodar agora é o MESMO caminho do cron, não um atalho paralelo — se fosse
     outro, o que se testa aqui não seria o que roda de madrugada. */
  const rodarAgora = async () => {
    setRodando(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "emitir_dia" } });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      if (data?.pulada) toast.info("A rodada não emitiu.", { description: data.pulada, duration: 10000 });
      else toast.success(`${data?.emitidas ?? 0} cobrança(s) mandadas para o lote ${data?.lote ?? "?"}.`);
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao rodar.", { description: e?.message });
    } finally {
      setRodando(false);
    }
  };

  const visiveis = filtro === "todas" ? linhas : linhas.filter((l) => l.resultado === filtro);

  const modo = cfg?.emissao_automatica ?? "previa";
  const m = MODOS[modo] ?? MODOS.previa;

  return (
    <div className="space-y-4">
      {/* --------------------------- a chave geral --------------------------- */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[240px] flex-1">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Power className="h-3.5 w-3.5" /> Emissão automática
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", m.tom)}>{m.rotulo}</span>
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{m.ajuda}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Roda todo dia às <strong className="text-foreground">10h</strong> (depois da carga do Asaas),
              até <span className="num">{cfg?.teto_rodada ?? 20}</span> por vez e{" "}
              <span className="num">{cfg?.teto_dia ?? 120}</span> por dia.
              {cfg?.data_corte && (
                <> A fila só considera cobranças a partir do corte,{" "}
                  <span className="num">{cfg.data_corte.split("-").reverse().join("/")}</span>.</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(["off", "previa", "on"] as const).map((k) => (
              <button
                key={k}
                onClick={() => trocarModo(k)}
                disabled={salvandoModo || modo === k}
                className={cn(
                  "rounded border px-2.5 py-1 text-[11px] font-medium disabled:cursor-default",
                  modo === k ? MODOS[k].tom : "border-border text-muted-foreground hover:bg-muted",
                )}
                title={MODOS[k].ajuda}
              >
                {MODOS[k].rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------ rodadas ------------------------------ */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Rodadas da emissão
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={rodarAgora}
              disabled={rodando}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
              title="Executa agora exatamente o que o cron executa às 10h"
            >
              {rodando ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
              Rodar agora
            </button>
            <button onClick={carregar} className="ghost-icone rounded p-1" title="Atualizar">
              <RefreshCw className={cn("h-3.5 w-3.5", carregando && "animate-spin")} />
            </button>
          </div>
        </div>

        {rodadas.length === 0 && !carregando && (
          <p className="py-3 text-center text-[11px] text-muted-foreground">Nenhuma rodada registrada ainda.</p>
        )}

        <div className="max-h-56 space-y-1 overflow-y-auto">
          {rodadas.map((r) => (
            <div key={r.id} className="flex items-start gap-2 rounded border border-border/50 px-2 py-1.5 text-[11px]">
              <span className="num shrink-0 text-muted-foreground">{hora(r.iniciada_em)}</span>
              <span className={cn(
                "shrink-0 rounded border px-1.5 text-[10px]",
                r.modo === "on" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : r.modo === "previa" ? "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                : "border-border bg-muted text-muted-foreground",
              )}>
                {r.modo === "on" ? "emitindo" : r.modo === "previa" ? "ensaio" : "desligada"}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{r.origem}</span>
              <span className="flex-1">
                {r.erro ? (
                  <span className="text-destructive">{r.erro}</span>
                ) : r.pulada ? (
                  <span className="text-muted-foreground">{r.pulada}</span>
                ) : (
                  <>
                    fila {r.fila} · <strong className="text-foreground">{r.emitidas}</strong> no lote
                    {r.lote ? ` ${r.lote}` : ""}
                    {r.falhas > 0 && <span className="text-destructive"> · {r.falhas} falha(s)</span>}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------- filtros ------------------------------ */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(["todas", "ok", "em_processamento", "erro"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={cn(
              "rounded border px-2 py-1 text-[11px]",
              filtro === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {f === "todas" ? "Tudo" : DESFECHO[f].rotulo}
            <span className="ml-1 opacity-60">
              {f === "todas" ? linhas.length : linhas.filter((l) => l.resultado === f).length}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={cn(
                "rounded border px-2 py-1 text-[11px]",
                dias === d ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {d === 1 ? "hoje" : `${d} dias`}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------- o rastro ----------------------------- */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-muted/40">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="p-2">Quando</th>
              <th className="p-2">Cliente</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2">Ação</th>
              <th className="p-2">Desfecho</th>
              <th className="p-2">Nota / motivo</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </td></tr>
            )}
            {!carregando && visiveis.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                Nenhum registro neste recorte.
              </td></tr>
            )}
            {!carregando && visiveis.map((l, i) => {
              const d = DESFECHO[l.resultado] ?? { rotulo: l.resultado, tom: "bg-muted text-muted-foreground border-border", Icone: Info };
              const ensaio = l.acao === "previa";
              return (
                <tr key={`${l.id_asaas}-${l.criado_em}-${i}`} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                  <td className="num whitespace-nowrap p-2 text-muted-foreground">{hora(l.criado_em)}</td>
                  <td className="max-w-[200px] p-2">
                    <div className="truncate font-medium text-foreground">{l.cliente}</div>
                    <div className="num truncate text-[10px] text-muted-foreground" title={l.id_asaas}>
                      {l.n_cod_os ? `OS ${l.n_cod_os}` : l.id_asaas}
                    </div>
                  </td>
                  <td className="num p-2 text-right">{l.valor != null ? brl(Number(l.valor)) : "—"}</td>
                  <td className="whitespace-nowrap p-2 text-muted-foreground">
                    {ensaio && <FlaskConical className="mr-1 inline h-3 w-3" />}
                    {ACAO[l.acao] ?? l.acao}
                  </td>
                  <td className="p-2">
                    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px]", ensaio ? "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400" : d.tom)}>
                      <d.Icone className="h-3 w-3" />
                      {ensaio ? "Ensaio" : d.rotulo}
                    </span>
                  </td>
                  {/* O número quando saiu; o motivo quando não saiu. Nunca os dois
                      vazios — linha sem explicação é o que obriga a abrir o Omie. */}
                  <td className="max-w-[380px] p-2">
                    {l.nfse_numero && (
                      <span className="num mr-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                        NFS-e {l.nfse_numero}
                      </span>
                    )}
                    {l.motivo && (
                      <span className="text-[11px] leading-tight text-muted-foreground" title={l.motivo}>
                        <span className="line-clamp-2">{l.motivo}</span>
                      </span>
                    )}
                    {!l.nfse_numero && !l.motivo && <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-px h-3 w-3 shrink-0" />
        O registro é append-only: a linha "no forno" continua ali depois que a nota nasce, com a
        linha da nota ao lado. "No forno" não é falha — é nota a caminho da prefeitura, e emitir
        de novo criaria a segunda nota do mesmo serviço.
      </p>
    </div>
  );
}
