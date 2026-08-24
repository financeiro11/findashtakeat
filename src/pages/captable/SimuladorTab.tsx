import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus, Trash2, Sparkles, Loader2, AlertTriangle, Info, TriangleAlert,
  RotateCcw, ArrowRight, ChevronDown, ChevronRight, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { supabase } from "@/integrations/supabase/client";
import {
  assinatura, rodadaVazia, simular, sinaisDaSimulacao,
  type Gravidade, type PosicaoBase, type ResultadoRodada, type RodadaSimulada, type Sinal,
} from "./simulador";
import { CAP_TABLE, PRECOS_POR_ACAO } from "../investimentos/flip-dados";

// ============================================================================
// Simulador de rodadas — a aba que tira a conta do Excel.
//
// A CONTA NÃO ESTÁ AQUI. Ela mora em ./simulador.ts, testada em
// ./simulador.test.ts. Esta tela só coleta os parâmetros, mostra o resultado e
// pede à IA que comente — nesta ordem, e nunca ao contrário: o número que
// aparece é o número que o teste garante, e o texto vem depois dele.
//
// A base de partida pode ser o ledger desta página (que é editável e vive no
// localStorage de cada navegador) ou a foto documentada do fechamento da
// Series A (que veio dos contratos e é igual para todo mundo). O padrão é a
// foto — é a única das duas que o Miguel e o Financeiro veem igual.
// ============================================================================

const STORAGE_KEY = "captable.simulador.v1";

type Fonte = "flip" | "ledger";

interface ComentarioIA {
  leitura: string;
  pontos: { titulo: string; texto: string }[];
  atencao: string | null;
}

/* ------------------------------------------------------------- formatação */

const moedaStr = (n: number, moeda: "BRL" | "USD", casas = 0) =>
  moeda === "USD"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: casas, maximumFractionDigits: casas })
    : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });

const compactoStr = (n: number, moeda: "BRL" | "USD") => {
  const s = moeda === "USD" ? "US$" : "R$";
  if (Math.abs(n) >= 1_000_000_000) return `${s} ${(n / 1_000_000_000).toFixed(2).replace(".", ",")}bi`;
  if (Math.abs(n) >= 1_000_000) return `${s} ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (Math.abs(n) >= 1_000) return `${s} ${(n / 1_000).toFixed(0)}k`;
  return moedaStr(n, moeda);
};

const compacto = (n: number, moeda: "BRL" | "USD") =>
  comValorExato(n, compactoStr(n, moeda), { moeda: moeda === "USD" ? "USD" : true });

const pct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
const pp = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2).replace(".", ",")} p.p.`;
const acoes = (n: number) => Math.round(n).toLocaleString("pt-BR");

/** Aceita "12.500.000", "12500000", "12,5" — devolve número. */
function parseValor(s: string): number {
  const limpo = s.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

/* --------------------------------------------------------- campo de valor */

/** Input que mostra número formatado quando não está em foco. */
function CampoValor({
  valor, onChange, moeda, sufixo, placeholder,
}: {
  valor: number;
  onChange: (n: number) => void;
  moeda?: "BRL" | "USD";
  sufixo?: string;
  placeholder?: string;
}) {
  const [foco, setFoco] = useState(false);
  const [rascunho, setRascunho] = useState("");

  const exibido = foco
    ? rascunho
    : valor
      ? (moeda ? moedaStr(valor, moeda) : valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 }))
      : "";

  return (
    <div className="relative">
      <Input
        className="num h-9 text-[13px]"
        value={exibido}
        placeholder={placeholder}
        onFocus={() => { setRascunho(valor ? String(valor) : ""); setFoco(true); }}
        onBlur={() => setFoco(false)}
        onChange={(e) => { setRascunho(e.target.value); onChange(parseValor(e.target.value)); }}
      />
      {sufixo && !foco && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {sufixo}
        </span>
      )}
    </div>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[10.5px] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

/** Seletor de duas ou três opções, no formato de segmento. */
function Segmentado<T extends string>({
  valor, opcoes, onChange,
}: {
  valor: T;
  opcoes: { v: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.v}
          type="button"
          title={o.title}
          onClick={() => onChange(o.v)}
          className={cn(
            "flex-1 rounded px-2 py-1.5 text-[11.5px] font-medium transition-colors",
            valor === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ sinais e IA */

const ESTILO_SINAL: Record<Gravidade, { cls: string; icon: typeof Info }> = {
  info: { cls: "border-border bg-muted/30 text-muted-foreground", icon: Info },
  atencao: { cls: "border-amber-500/40 bg-amber-500/[0.07] text-amber-700 dark:text-amber-400", icon: TriangleAlert },
  alerta: { cls: "border-destructive/40 bg-destructive/[0.06] text-destructive", icon: AlertTriangle },
};

function ListaSinais({ sinais }: { sinais: Sinal[] }) {
  if (!sinais.length) return null;
  return (
    <div className="space-y-2">
      {sinais.map((s) => {
        const e = ESTILO_SINAL[s.gravidade];
        return (
          <div key={s.chave} className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5", e.cls)}>
            <e.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-foreground">{s.titulo}</div>
              <div className="num mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{s.detalhe}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================== a aba inteira */

export default function SimuladorTab({ baseLedger }: { baseLedger: PosicaoBase[] }) {
  const [fonte, setFonte] = useState<Fonte>("flip");
  const [rodadas, setRodadas] = useState<RodadaSimulada[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p?.rodadas) && p.rodadas.length) return p.rodadas as RodadaSimulada[];
      }
    } catch { /* cenário corrompido: começa do zero */ }
    return [rodadaVazia(0)];
  });
  const [aberta, setAberta] = useState<Record<string, boolean>>({});
  const [auto, setAuto] = useState(true);
  const [carregando, setCarregando] = useState(false);
  // Comentário por assinatura do cenário: enquanto o resultado não mudar, o
  // texto continua valendo e a IA não é chamada de novo.
  const [cache, setCache] = useState<Record<string, ComentarioIA>>({});
  const pedidoEmVoo = useRef<string | null>(null);
  // Cenários em que a IA falhou. Sem isto, o modo automático reagendaria a cada
  // 1,4 s para sempre — uma chave vencida viraria uma chamada por segundo até
  // alguém fechar a aba.
  const falhas = useRef<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rodadas }));
  }, [rodadas]);

  /* ----------------------------------------------------------- base */

  const baseFlip: PosicaoBase[] = useMemo(
    () => CAP_TABLE.map((l) => ({
      id: l.socio, nome: l.socio, acoes: l.total, ehPool: l.tipo === "pool",
    })),
    [],
  );

  const base = fonte === "flip" ? baseFlip : baseLedger;
  const baseValida = base.reduce((s, p) => s + p.acoes, 0) > 0;

  const fundador = useMemo(() => {
    const porNome = base.find((p) => /miguel/i.test(p.nome));
    if (porNome) return porNome.nome;
    return [...base].filter((p) => !p.ehPool).sort((a, b) => b.acoes - a.acoes)[0]?.nome;
  }, [base]);

  /* ------------------------------------------------------- a simulação */

  const resultados = useMemo(() => (baseValida ? simular(base, rodadas) : []), [base, rodadas, baseValida]);
  const validos = resultados.filter((r) => !r.erro);

  const sinais = useMemo(
    () => sinaisDaSimulacao(resultados, {
      nomeFundador: fundador,
      precoAnterior: PRECOS_POR_ACAO[0].usd,
      moedaPrecoAnterior: "USD",
    }),
    [resultados, fundador],
  );

  const assin = useMemo(() => assinatura(resultados), [resultados]);
  const comentario = cache[assin];

  /* ---------------------------------------------------------- a IA */

  const pedirComentario = useCallback(async () => {
    if (!validos.length || pedidoEmVoo.current === assin) return;
    pedidoEmVoo.current = assin;
    setCarregando(true);
    try {
      const corpo = {
        base: fonte === "flip"
          ? "Fechamento da Series A em 22/dez/2025 — 100.000 ações, capital totalmente diluído"
          : "Ledger editável da página Captable",
        contexto:
          "A última rodada real foi a Series A de dezembro de 2025, a US$ 90,76 por ação, com a DGF como investidora líder (24% do capital). O pool de opções está em 11,57%.",
        rodadas: validos.map((r) => ({
          nome: r.rodada.nome,
          preMoney: moedaStr(r.preMoney, r.rodada.moeda),
          postMoney: moedaStr(r.postMoney, r.rodada.moeda),
          captado: moedaStr(r.totalCaptado, r.rodada.moeda),
          precoPorAcao: moedaStr(r.precoPorAcao, r.rodada.moeda, 2),
          pctInvestidores: pct(r.pctInvestidores),
          pctPool: pct(r.pctPool),
          momentoPool:
            r.rodada.momentoPool === "pre" ? "pré-money (quem já estava paga)"
              : r.rodada.momentoPool === "pos" ? "pós-money (todos pagam)"
                : "sem alteração de pool",
          poolAlvoPct: r.rodada.momentoPool === "nenhum" ? "—" : pct(r.rodada.poolAlvoPct),
          posicoes: r.posicoes.map((p) => ({
            nome: p.nome,
            pctAntes: pct(p.pctAntes),
            pct: pct(p.pct),
            delta: pp(p.deltaPct),
            investido: p.investido > 0 ? moedaStr(p.investido, r.rodada.moeda) : "—",
          })),
        })),
        sinais: sinais.map((s) => ({ chave: s.chave, gravidade: s.gravidade, titulo: s.titulo, detalhe: s.detalhe })),
      };

      const { data, error } = await supabase.functions.invoke("captable-comentar", { body: corpo });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      falhas.current.delete(assin);
      setCache((c) => ({ ...c, [assin]: { leitura: data.leitura, pontos: data.pontos ?? [], atencao: data.atencao ?? null } }));
    } catch (e) {
      falhas.current.add(assin);
      // Sem toast no modo automático: a pessoa está digitando, não pediu nada.
      if (!auto) toast.error("Não consegui comentar: " + ((e as Error)?.message ?? String(e)));
      console.error("captable-comentar:", e);
    } finally {
      setCarregando(false);
      pedidoEmVoo.current = null;
    }
  }, [assin, auto, fonte, sinais, validos]);

  // Comentário automático: espera a digitação parar. Sem o atraso, cada tecla
  // no pre-money viraria uma chamada de IA.
  useEffect(() => {
    if (!auto || !validos.length || cache[assin] || carregando || falhas.current.has(assin)) return;
    const t = setTimeout(() => { void pedirComentario(); }, 1400);
    return () => clearTimeout(t);
  }, [auto, assin, cache, carregando, pedirComentario, validos.length]);

  /* ------------------------------------------------------ mutações */

  const mexer = (id: string, patch: Partial<RodadaSimulada>) =>
    setRodadas((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const mexerTicket = (rid: string, tid: string, patch: Partial<{ nome: string; valor: number }>) =>
    setRodadas((rs) => rs.map((r) => r.id === rid
      ? { ...r, tickets: r.tickets.map((t) => (t.id === tid ? { ...t, ...patch } : t)) }
      : r));

  const addTicket = (rid: string) =>
    setRodadas((rs) => rs.map((r) => r.id === rid
      ? { ...r, tickets: [...r.tickets, { id: `${rid}-t${r.tickets.length}-${r.tickets.length}`, nome: "", valor: 0 }] }
      : r));

  const removeTicket = (rid: string, tid: string) =>
    setRodadas((rs) => rs.map((r) => r.id === rid
      ? { ...r, tickets: r.tickets.filter((t) => t.id !== tid) }
      : r));

  const addRodada = () => setRodadas((rs) => [...rs, rodadaVazia(rs.length, rs[rs.length - 1]?.moeda ?? "BRL")]);
  const removeRodada = (id: string) => setRodadas((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const zerar = () => { setRodadas([rodadaVazia(0)]); setCache({}); };

  /* ------------------------------------------- a evolução acumulada */

  const evolucao = useMemo(() => {
    if (!validos.length) return null;
    const nomes = new Set<string>();
    base.forEach((p) => nomes.add(p.nome));
    validos.forEach((r) => r.posicoes.forEach((p) => nomes.add(p.nome)));
    const totalBase = base.reduce((s, p) => s + p.acoes, 0);

    const linhas = [...nomes].map((nome) => {
      const inicial = base.find((p) => p.nome === nome);
      const pctInicial = inicial && totalBase > 0 ? (inicial.acoes / totalBase) * 100 : 0;
      const etapas = validos.map((r) => r.posicoes.find((p) => p.nome === nome)?.pct ?? 0);
      const final = etapas[etapas.length - 1] ?? pctInicial;
      return { nome, pctInicial, etapas, final, delta: final - pctInicial };
    });
    return linhas.sort((a, b) => b.final - a.final);
  }, [base, validos]);

  /* ================================================================ render */

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------- barra de controle */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Cenário
            </div>
            <h3 className="text-sm font-semibold">
              Simulador de rodadas
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                pre-money, cheques, pool e rodadas encadeadas
              </span>
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11.5px] text-muted-foreground">Comentar sozinho</span>
              <Switch checked={auto} onCheckedChange={setAuto} />
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={zerar}>
              <RotateCcw className="h-3.5 w-3.5" /> Limpar
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={addRodada}>
              <Plus className="h-3.5 w-3.5" /> Rodada
            </Button>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,340px)_1fr] md:items-center">
          <Campo
            label="Cap table de partida"
            hint={
              fonte === "flip"
                ? "A foto documentada do fechamento — igual para todo mundo que abrir a tela."
                : "O ledger editável desta página, que vive no localStorage deste navegador."
            }
          >
            <Segmentado
              valor={fonte}
              onChange={(v) => setFonte(v)}
              opcoes={[
                { v: "flip" as const, label: "Fechamento Series A", title: "Cap table de 18/dez/2025, dos contratos" },
                { v: "ledger" as const, label: "Ledger desta tela", title: "O que está editado na aba Resumo" },
              ]}
            />
          </Campo>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ações na base</div>
              <div className="num text-[16px] font-bold">{acoes(base.reduce((s, p) => s + p.acoes, 0))}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sócios</div>
              <div className="num text-[16px] font-bold">{base.length}</div>
            </div>
            {fundador && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{fundador}</div>
                <div className="num text-[16px] font-bold">
                  {pct(((base.find((p) => p.nome === fundador)?.acoes ?? 0) / Math.max(1, base.reduce((s, p) => s + p.acoes, 0))) * 100)}
                </div>
              </div>
            )}
            {fonte === "flip" && (
              <Link
                to="/investimentos/flip"
                className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
              >
                de onde vêm estes números
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        {!baseValida && (
          <div className="border-t border-border px-4 py-3 text-[12.5px] text-muted-foreground">
            A base escolhida não tem ações. Troque para o cap table do fechamento ou preencha o ledger na aba Resumo.
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ as rodadas */}
      {rodadas.map((r, i) => {
        const res = resultados[i];
        const expandida = aberta[r.id] ?? true;
        return (
          <section key={r.id} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <button
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() => setAberta((a) => ({ ...a, [r.id]: !expandida }))}
              >
                {expandida ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <Input
                  className="h-8 w-[150px] border-transparent px-2 text-[13px] font-semibold hover:border-border"
                  value={r.nome}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => mexer(r.id, { nome: e.target.value })}
                />
                {res && !res.erro && (
                  <span className="num hidden text-[11.5px] text-muted-foreground sm:inline">
                    {compactoStr(res.totalCaptado, r.moeda)} a {compactoStr(res.preMoney, r.moeda)} pre · investidores {pct(res.pctInvestidores)}
                  </span>
                )}
              </button>
              {rodadas.length > 1 && (
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => removeRodada(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {expandida && (
              <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,380px)_1fr]">
                {/* ---------------------------------------- formulário */}
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Moeda">
                      <Segmentado
                        valor={r.moeda}
                        onChange={(v) => mexer(r.id, { moeda: v })}
                        opcoes={[{ v: "BRL" as const, label: "R$" }, { v: "USD" as const, label: "US$" }]}
                      />
                    </Campo>
                    <Campo label="Valuation informado">
                      <Segmentado
                        valor={r.baseValuation}
                        onChange={(v) => mexer(r.id, { baseValuation: v })}
                        opcoes={[
                          { v: "pre" as const, label: "Pre-money" },
                          { v: "post" as const, label: "Post-money" },
                        ]}
                      />
                    </Campo>
                  </div>

                  <Campo
                    label={r.baseValuation === "pre" ? "Pre-money" : "Post-money"}
                    hint={
                      res && !res.erro
                        ? `${r.baseValuation === "pre" ? "Post" : "Pre"}-money: ${moedaStr(r.baseValuation === "pre" ? res.postMoney : res.preMoney, r.moeda)}`
                        : undefined
                    }
                  >
                    <CampoValor valor={r.valuation} moeda={r.moeda} onChange={(n) => mexer(r.id, { valuation: n })} placeholder="0" />
                  </Campo>

                  {/* Tickets */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-medium text-muted-foreground">Quem entra nesta rodada</Label>
                      <button
                        onClick={() => addTicket(r.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Plus className="h-3 w-3" /> cheque
                      </button>
                    </div>
                    {r.tickets.map((t) => (
                      <div key={t.id} className="flex items-center gap-2">
                        <Input
                          className="h-9 flex-1 text-[13px]"
                          value={t.nome}
                          placeholder="Nome do investidor"
                          onChange={(e) => mexerTicket(r.id, t.id, { nome: e.target.value })}
                        />
                        <div className="w-[140px]">
                          <CampoValor valor={t.valor} moeda={r.moeda} onChange={(n) => mexerTicket(r.id, t.id, { valor: n })} placeholder="0" />
                        </div>
                        {r.tickets.length > 1 && (
                          <button
                            onClick={() => removeTicket(r.id, t.id)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <p className="text-[10.5px] leading-snug text-muted-foreground/80">
                      Um nome igual ao de um sócio que já existe soma na linha dele — é assim que se simula pro-rata.
                    </p>
                  </div>

                  {/* Pool */}
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Campo
                      label="Pool de opções"
                      hint={
                        r.momentoPool === "pre"
                          ? "Pré-money: o pool nasce antes do dinheiro e sai do bolso de quem já estava. É o que o investidor pede."
                          : r.momentoPool === "pos"
                            ? "Pós-money: o pool nasce depois e dilui todos, inclusive quem acabou de entrar."
                            : "A rodada não mexe no tamanho do pool."
                      }
                    >
                      <Segmentado
                        valor={r.momentoPool}
                        onChange={(v) => mexer(r.id, { momentoPool: v, poolAlvoPct: v === "nenhum" ? 0 : (r.poolAlvoPct || 15) })}
                        opcoes={[
                          { v: "nenhum" as const, label: "Não mexe" },
                          { v: "pre" as const, label: "Pré-money" },
                          { v: "pos" as const, label: "Pós-money" },
                        ]}
                      />
                    </Campo>
                    {r.momentoPool !== "nenhum" && (
                      <Campo label="Pool alvo depois da rodada">
                        <CampoValor valor={r.poolAlvoPct} sufixo="%" onChange={(n) => mexer(r.id, { poolAlvoPct: n })} placeholder="15" />
                      </Campo>
                    )}
                  </div>
                </div>

                {/* ---------------------------------------- resultado */}
                <div className="space-y-3">
                  {!res || res.erro ? (
                    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 text-center">
                      <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                      <p className="mt-2 max-w-sm text-[12.5px] text-muted-foreground">
                        {res?.erro ?? "Preencha o valuation e ao menos um cheque para ver a conta."}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          { r: "Preço por ação", v: moedaStr(res.precoPorAcao, r.moeda, 2), s: `${acoes(res.acoesInvestidores)} ações emitidas` },
                          { r: "Post-money", v: compactoStr(res.postMoney, r.moeda), s: `pre ${compactoStr(res.preMoney, r.moeda)}` },
                          { r: "Investidores ficam com", v: pct(res.pctInvestidores), s: `por ${compactoStr(res.totalCaptado, r.moeda)}` },
                          {
                            r: "Diluição da base",
                            v: pct(Math.abs(res.diluicaoTotalPP)),
                            s: res.acoesPoolNovas > 0 ? `+${acoes(res.acoesPoolNovas)} ações de pool` : "sem mexer no pool",
                          },
                        ].map((k) => (
                          <div key={k.r} className="rounded-lg border border-border px-3 py-2">
                            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{k.r}</div>
                            <div className="num mt-0.5 text-[15px] font-bold leading-tight">{k.v}</div>
                            <div className="num mt-0.5 text-[10.5px] text-muted-foreground">{k.s}</div>
                          </div>
                        ))}
                      </div>

                      {/* Barra de participação depois da rodada */}
                      <div>
                        <div className="flex h-6 w-full overflow-hidden rounded-lg border border-border">
                          {res.posicoes.map((p) => (
                            <div
                              key={p.id}
                              title={`${p.nome} — ${pct(p.pct)}`}
                              className={cn(
                                p.novo ? "bg-blue-500" : p.ehPool ? "bg-amber-500" : p.nome === fundador ? "bg-primary" : "bg-muted-foreground/60",
                              )}
                              style={{ width: `${p.pct}%` }}
                            />
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> fundador</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-500" /> entrou nesta rodada</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500" /> pool</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted-foreground/60" /> demais sócios</span>
                        </div>
                      </div>

                      {/* Tabela antes → depois */}
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-border bg-secondary/50">
                              {["Sócio", "Ações", "% antes", "% depois", "Variação"].map((c, j) => (
                                <th key={c} className={cn(
                                  "whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
                                  j === 0 ? "text-left" : "text-right",
                                )}>
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {res.posicoes.map((p) => (
                              <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                                <td className="px-3 py-1.5 text-[12.5px]">
                                  <span className={cn(p.nome === fundador && "font-semibold")}>{p.nome}</span>
                                  {p.novo && (
                                    <span className="ml-1.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                      novo
                                    </span>
                                  )}
                                  {p.investido > 0 && !p.novo && (
                                    <span className="num ml-1.5 text-[10.5px] text-muted-foreground">
                                      +{compactoStr(p.investido, r.moeda)}
                                    </span>
                                  )}
                                </td>
                                <td className="num whitespace-nowrap px-3 py-1.5 text-right text-[12.5px] text-muted-foreground">{acoes(p.acoes)}</td>
                                <td className="num whitespace-nowrap px-3 py-1.5 text-right text-[12.5px] text-muted-foreground">
                                  {p.pctAntes > 0 ? pct(p.pctAntes) : "—"}
                                </td>
                                <td className="num whitespace-nowrap px-3 py-1.5 text-right text-[12.5px] font-semibold">{pct(p.pct)}</td>
                                <td className={cn(
                                  "num whitespace-nowrap px-3 py-1.5 text-right text-[12px]",
                                  p.deltaPct < -0.005 ? "text-destructive" : p.deltaPct > 0.005 ? "text-success" : "text-muted-foreground",
                                )}>
                                  {Math.abs(p.deltaPct) < 0.005 ? "—" : pp(p.deltaPct)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}

      {/* ------------------------------------------- diluição acumulada */}
      {evolucao && validos.length > 1 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Rodadas encadeadas
            </div>
            <h3 className="text-sm font-semibold">
              Participação ao longo do caminho
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                da base até depois de {validos[validos.length - 1].rodada.nome}
              </span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sócio</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hoje</th>
                  {validos.map((r) => (
                    <th key={r.rodada.id} className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      após {r.rodada.nome}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {evolucao.filter((l) => l.final > 0.004).map((l) => (
                  <tr key={l.nome} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-1.5 text-[12.5px]">
                      <span className={cn(l.nome === fundador && "font-semibold")}>{l.nome}</span>
                    </td>
                    <td className="num px-3 py-1.5 text-right text-[12.5px] text-muted-foreground">
                      {l.pctInicial > 0 ? pct(l.pctInicial) : "—"}
                    </td>
                    {l.etapas.map((e, j) => (
                      <td key={j} className={cn(
                        "num px-3 py-1.5 text-right text-[12.5px]",
                        j === l.etapas.length - 1 ? "font-semibold" : "text-muted-foreground",
                      )}>
                        {e > 0 ? pct(e) : "—"}
                      </td>
                    ))}
                    <td className={cn(
                      "num px-3 py-1.5 text-right text-[12px]",
                      l.delta < -0.005 ? "text-destructive" : l.delta > 0.005 ? "text-success" : "text-muted-foreground",
                    )}>
                      {Math.abs(l.delta) < 0.005 ? "—" : pp(l.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ sinais + IA */}
      {validos.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              O que a conta mostra
            </div>
            <h3 className="mb-3 text-sm font-semibold">
              Sinais
              <span className="ml-2 text-xs font-normal text-muted-foreground">detectados por regra fixa, sem IA</span>
            </h3>
            {sinais.length ? (
              <ListaSinais sinais={sinais} />
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Nenhum limiar relevante foi cruzado nesta simulação — nem controle, nem pool, nem preço.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-primary/25 bg-primary/[0.03] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  Leitura da IA
                </div>
                <h3 className="text-sm font-semibold">
                  O que isso quer dizer
                  <span className="ml-2 text-xs font-normal text-muted-foreground">escrita sobre os sinais acima</span>
                </h3>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={carregando}
                onClick={() => { setCache((c) => { const n = { ...c }; delete n[assin]; return n; }); void pedirComentario(); }}
              >
                {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {comentario ? "Reescrever" : "Comentar"}
              </Button>
            </div>

            <div className="mt-3">
              {carregando && !comentario && (
                <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo a simulação…
                </div>
              )}

              {!carregando && !comentario && (
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  {auto
                    ? "Assim que você parar de mexer nos números, o comentário aparece aqui."
                    : "Clique em Comentar para a IA ler esta simulação."}
                </p>
              )}

              {comentario && (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed text-foreground">{comentario.leitura}</p>
                  {comentario.pontos.length > 0 && (
                    <ul className="space-y-2">
                      {comentario.pontos.map((p, i) => (
                        <li key={i} className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="text-[12px] font-semibold">{p.titulo}</div>
                          <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{p.texto}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {comentario.atencao && (
                    <div className="flex gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="text-[12px] leading-relaxed text-foreground">{comentario.atencao}</div>
                    </div>
                  )}
                  <p className="text-[10.5px] leading-snug text-muted-foreground/80">
                    A IA escreve sobre os números da simulação — ela não faz a conta nem substitui a leitura dos
                    documentos da rodada.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Rodapé com o caminho de volta */}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>A foto que serve de base saiu dos contratos do flip.</span>
        <Link to="/investimentos/flip" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
          Ver o flip e a Series A
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
