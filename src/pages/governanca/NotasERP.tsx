/* /governanca/notas-erp — "a nota do fornecedor está dentro do Omie?"
 *
 * A PERGUNTA QUE ESTA TELA RESPONDE é a que não tinha resposta até 25/08/2026.
 * O Hub sabia o que ELE tinha mandado (82 anexos) e o que a varredura do PIX
 * tinha lido de UMA conta. Para todo o resto — o cartão corporativo, o BTG, as
 * contas de subvenção — um título com nota anexada à mão no ERP e um título sem
 * nota nenhuma eram indistinguíveis daqui.
 *
 * O NÚMERO PRECISA SOBREVIVER A UMA PERGUNTA. Por isso a tela é construída em
 * cima de duas coisas que não são opinião:
 *
 *   • o DENOMINADOR vem da régua (`omie_categoria_regra`), e a régua é visível e
 *     editável na última aba. Transferência entre contas próprias, folha, tributo
 *     e tarifa bancária não têm nota de fornecedor; contá-las como "faltando"
 *     derruba a cobertura por um motivo que não é problema.
 *
 *   • o NUMERADOR vem de `ListarAnexo` chamado no Omie, título a título, e não
 *     do que o Hub acha que mandou. Anexo posto à mão por alguém conta; anexo que
 *     o Hub mandou e o Omie recusou, não conta.
 *
 * E ENQUANTO HOUVER TÍTULO NÃO VERIFICADO, a cobertura é dita como PISO, nunca
 * como o número. Prometer precisão que o dado ainda não tem é o jeito mais rápido
 * de perder a autoridade do painel inteiro.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, CreditCard,
  FileWarning, Flame, Loader2, Paperclip, RefreshCw, Scale, Search, Send,
  ShieldQuestion, ThumbsDown, ThumbsUp, Upload,
} from "lucide-react";
import {
  brlStr, categoriasCriticas, dataStr, fatias, formatarDoc, frasePanorama, mesCurto,
  nomeDaLinha, pctStr, periodoPadrao, GRAVIDADE, GRAVIDADES, REGRA, SITUACAO,
  SITUACOES_EXIGIVEIS, SITUACOES_FALTANDO,
  type Gravidade, type LinhaTitulo, type Regra, type ResumoNotas, type SituacaoTitulo,
} from "@/lib/notasErp";
import { useApelidos } from "@/hooks/useApelidos";
import { nomeExibido } from "@/lib/apelidos";

const sb = supabase as any;
const brl = (n: number) => comValorExato(n, brlStr(n));

/**
 * O nome de cada linha, com o apelido por cima — inclusive no gasto de cartão,
 * cujo lojista só existe dentro da observação. Ver `nomeDaLinha`.
 */
function useNomeDaLinha() {
  const mapa = useApelidos();
  return useCallback(
    (l: Pick<LinhaTitulo, "favorecido" | "favorecido_cru" | "observacao" | "doc">) =>
      nomeDaLinha(l, (nome, doc) => nomeExibido(mapa, nome, doc ?? null)),
    [mapa],
  );
}

/** Favorecido em duas linhas: o nome que se lê, e o que se procura no Omie. */
function Favorecido({ l, nomear }: {
  l: LinhaTitulo;
  nomear: ReturnType<typeof useNomeDaLinha>;
}) {
  const n = nomear(l);
  return (
    <>
      <span className="block">
        {n.nome}
        {n.deCartao && (
          <span className="ml-1.5 text-[11px] text-muted-foreground" title="Gasto de cartão: o lojista vem da observação do título">
            cartão
          </span>
        )}
      </span>
      <span className="block font-mono text-[11px] text-muted-foreground">
        {/* O nome CRU fica aqui porque é ele que se procura no Omie — e some do
            filtro se não estiver escrito na linha (convenção do repo). */}
        {n.cru !== n.nome ? `${n.cru} · ` : ""}
        {formatarDoc(l.doc)} · título {l.cod_titulo}
      </span>
    </>
  );
}

type Aba = "panorama" | "categorias" | "fornecedores" | "titulos" | "revisar" | "quase" | "regua";

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: "panorama", rotulo: "Panorama" },
  { id: "categorias", rotulo: "Categorias" },
  { id: "fornecedores", rotulo: "Quem deve nota" },
  { id: "titulos", rotulo: "Títulos" },
  { id: "revisar", rotulo: "Anexo a conferir" },
  { id: "quase", rotulo: "Falta um passo" },
  { id: "regua", rotulo: "Régua" },
];

const TOM: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  falta: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
  atencao: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
  neutro: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400",
  fora: "bg-muted text-muted-foreground border-border",
};

/** As cores da barra empilhada — as mesmas em todos os lugares da tela. */
const BARRA: Record<string, string> = {
  com_nota: "bg-emerald-500",
  pronta: "bg-amber-500",
  sem_nota: "bg-red-500",
  nao_verificado: "bg-violet-400/70",
};

/**
 * A faixa em dinheiro de cada gravidade, escrita como a pessoa lê.
 *
 * Os cortes vêm do banco (`cap_notas_config`), não daqui: quem muda o limiar
 * muda numa linha do Postgres e a tela acompanha — inclusive esta legenda.
 */
function faixaDe(g: Gravidade, lim?: { medio: number; grave: number; urgente: number }): string {
  if (!lim) return "";
  const n = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  if (g === "urgente") return `acima de ${n(lim.urgente)}`;
  if (g === "grave") return `${n(lim.grave)} a ${n(lim.urgente)}`;
  if (g === "medio") return `${n(lim.medio)} a ${n(lim.grave)}`;
  return `abaixo de ${n(lim.medio)}`;
}

function BarraCobertura({ v, total }: {
  v: { com_nota: number; pronta: number; sem_nota: number; nao_verificado: number };
  total: number;
}) {
  const f = fatias({ ...v, total });
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      {(["com_nota", "pronta", "sem_nota", "nao_verificado"] as const).map((k) =>
        f[k] > 0 ? <div key={k} className={BARRA[k]} style={{ width: `${f[k]}%` }} /> : null,
      )}
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
      {([
        ["com_nota", "com nota no ERP"],
        ["pronta", "pronta para subir"],
        ["sem_nota", "sem nota"],
        ["nao_verificado", "não verificado"],
      ] as const).map(([k, t]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <i className={cn("inline-block h-2.5 w-2.5 rounded-sm", BARRA[k])} /> {t}
        </span>
      ))}
    </div>
  );
}

export default function NotasERP() {
  const [{ de, ate }, setPeriodo] = useState(() => periodoPadrao());
  const [resumo, setResumo] = useState<ResumoNotas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>("panorama");
  const [trabalhando, setTrabalhando] = useState<"varrer" | "subir" | null>(null);
  /* Qual faixa de gravidade a aba Títulos abre. Vem de um clique no painel — é
     o que transforma "R$ 1,21 mi urgentes" na LISTA daqueles 180 títulos. */
  const [gravidadeFoco, setGravidadeFoco] = useState<Gravidade[]>([]);

  /* ------------------------------- resumo ------------------------------- */
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.rpc("cap_notas_resumo", { p_de: de, p_ate: ate });
    if (error) toast.error(`Não deu para ler a cobertura: ${error.message}`);
    setResumo((data as ResumoNotas) ?? null);
    setCarregando(false);
  }, [de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  /* ------------------------- ações contra o Omie ------------------------ */

  const varrer = async () => {
    setTrabalhando("varrer");
    try {
      const { data, error } = await sb.functions.invoke("omie-anexos-varredura", {
        body: { action: "varrer", limite: 150 },
      });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      const { lidos = 0, com_anexo = 0, falhas = 0 } = data ?? {};
      toast.success(
        `${lidos} título(s) lidos no Omie · ${com_anexo} com anexo` +
        (falhas ? ` · ${falhas} não deram para ler` : ""),
      );
      await carregar();
    } catch (e: any) {
      toast.error(`A varredura falhou: ${e?.message ?? e}`);
    } finally { setTrabalhando(null); }
  };

  const subir = async () => {
    setTrabalhando("subir");
    try {
      const { data, error } = await sb.functions.invoke("omie-anexar-comprovante", {
        body: { action: "varredura", limite: 40 },
      });
      if (error) throw error;
      const { enviados = 0, falhas = 0, fila = 0 } = data ?? {};
      if (!fila) toast.info("Nada pronto para subir: toda nota que o Hub tem já está no ERP.");
      else toast.success(`${enviados} nota(s) anexadas no Omie` + (falhas ? ` · ${falhas} falharam` : ""));
      await carregar();
    } catch (e: any) {
      toast.error(`O envio falhou: ${e?.message ?? e}`);
    } finally { setTrabalhando(null); }
  };

  /* -------------------------------- derivados ---------------------------- */

  const m = resumo?.meta;
  const porSituacao = useMemo(() => {
    const mapa = new Map<SituacaoTitulo, { titulos: number; valor: number }>();
    for (const s of resumo?.situacoes ?? []) mapa.set(s.situacao, { titulos: s.titulos, valor: s.valor });
    return mapa;
  }, [resumo]);

  const val = (s: SituacaoTitulo) => porSituacao.get(s)?.valor ?? 0;
  const qtd = (s: SituacaoTitulo) => porSituacao.get(s)?.titulos ?? 0;

  const anos = useMemo(() => {
    const atual = new Date().getUTCFullYear();
    return [atual - 1, atual];
  }, []);

  if (carregando && !resumo) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo a cobertura de notas…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---------------------- barra de comando ---------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {anos.map((a) => (
            <button
              key={a}
              className={cn("chip", de.startsWith(String(a)) && ate.startsWith(String(a)) && "border-primary text-primary")}
              onClick={() => setPeriodo({ de: `${a}-01-01`, ate: `${a}-12-31` })}
            >
              {a}
            </button>
          ))}
          <button className="chip" onClick={() => setPeriodo(periodoPadrao())}>Últimos 6 meses</button>
          <span className="ml-1 flex items-center gap-1 text-[12px] text-muted-foreground">
            <Input
              type="date" value={de} onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))}
              className="h-7 w-[132px] text-[12px]"
            />
            até
            <Input
              type="date" value={ate} onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))}
              className="h-7 w-[132px] text-[12px]"
            />
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {m?.atualizado_em && (
            <span className="text-[11.5px] text-muted-foreground" title={m.atualizado_em}>
              ERP lido até {dataStr(m.atualizado_em)}
            </span>
          )}
          <button className="chip" onClick={varrer} disabled={!!trabalhando} title="Pergunta ao Omie, título a título, quais têm anexo. Só leitura — não escreve nada no ERP.">
            {trabalhando === "varrer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Varrer o ERP
          </button>
          <button className="chip" onClick={subir} disabled={!!trabalhando} title="Sobe ao Omie toda nota que o Hub já tem e o ERP ainda não.">
            {trabalhando === "subir" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Subir o que está pronto
          </button>
        </div>
      </div>

      {/* ------------------------- o número ------------------------- */}
      <div className="card-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Despesa que exige nota</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{brl(m?.exigivel_valor ?? 0)}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {(m?.exigivel_titulos ?? 0).toLocaleString("pt-BR")} títulos de{" "}
              {(m?.titulos ?? 0).toLocaleString("pt-BR")} no período
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Com nota confirmada no Omie</p>
            <p className={cn(
              "mt-1 text-3xl font-semibold tabular-nums",
              (m?.cobertura_valor ?? 0) >= 90 ? "text-emerald-600 dark:text-emerald-400"
                : (m?.cobertura_valor ?? 0) >= 60 ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400",
            )}>
              {pctStr(m?.cobertura_valor ?? null)}
            </p>
            <p className="text-[12.5px] text-muted-foreground">{brlStr(val("com_nota"))}</p>
          </div>
        </div>

        <div className="mt-4">
          <BarraCobertura
            v={{
              com_nota: val("com_nota"), pronta: val("pronta_para_enviar"),
              sem_nota: val("sem_nota") + val("erro_leitura"), nao_verificado: val("nao_verificado"),
            }}
            total={m?.exigivel_valor ?? 0}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Legenda />
            <p className="text-[12.5px] text-muted-foreground">{frasePanorama(resumo)}</p>
          </div>
        </div>

        {/* POR ONDE COMEÇAR A COBRAR. Tudo exige nota; a gravidade só ordena —
            e o número diz por que ela importa: em agosto/26, 180 títulos
            urgentes concentravam R$ 1,21 mi dos R$ 1,30 mi que faltavam. */}
        <div className="mt-5">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            Por onde começar — nota que falta, por gravidade
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {GRAVIDADES.map((g) => {
              const f = resumo?.gravidade?.find((x) => x.gravidade === g);
              return (
                <button
                  key={g}
                  className={cn("rounded-md border p-3 text-left transition hover:brightness-105", TOM[GRAVIDADE[g].tom])}
                  onClick={() => { setGravidadeFoco([g]); setAba("titulos"); }}
                  title={faixaDe(g, m?.limiares)}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                    {g === "urgente" ? <Flame className="h-3.5 w-3.5" /> : <FileWarning className="h-3.5 w-3.5" />}
                    {GRAVIDADE[g].rotulo}
                  </span>
                  <span className="mt-1 block text-lg font-semibold tabular-nums">{brlStr(f?.valor ?? 0)}</span>
                  <span className="text-[11.5px] opacity-80">
                    {(f?.titulos ?? 0).toLocaleString("pt-BR")} títulos · {faixaDe(g, m?.limiares)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Os estados que exigem ação nossa, e não do fornecedor. */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["pronta_para_enviar", <Send key="s" className="h-3.5 w-3.5" />],
            ["anexo_suspeito", <ShieldQuestion key="a" className="h-3.5 w-3.5" />],
            ["nao_verificado", <ShieldQuestion key="v" className="h-3.5 w-3.5" />],
            ["erro_leitura", <AlertTriangle key="e" className="h-3.5 w-3.5" />],
          ] as const).map(([sit, icone]) => (
            <button
              key={sit}
              className={cn("rounded-md border p-3 text-left transition hover:brightness-105", TOM[SITUACAO[sit].tom])}
              onClick={() => { setGravidadeFoco([]); setAba(sit === "anexo_suspeito" ? "revisar" : "titulos"); }}
              title={SITUACAO[sit].ajuda}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                {icone} {SITUACAO[sit].rotulo}
              </span>
              <span className="mt-1 block text-lg font-semibold tabular-nums">{brlStr(val(sit))}</span>
              <span className="text-[11.5px] opacity-80">{qtd(sit).toLocaleString("pt-BR")} títulos</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------------------------- abas ---------------------------- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ABAS.map((a) => (
          <button key={a.id} className={cn("chip", aba === a.id && "border-primary text-primary")} onClick={() => setAba(a.id)}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "panorama" && <Panorama resumo={resumo} />}
      {aba === "categorias" && <Categorias resumo={resumo} />}
      {aba === "fornecedores" && <Fornecedores resumo={resumo} />}
      {aba === "titulos" && <Titulos de={de} ate={ate} gravidadeInicial={gravidadeFoco} />}
      {aba === "revisar" && <Revisar de={de} ate={ate} aoRevisar={carregar} />}
      {aba === "quase" && <QuaseLa />}
      {aba === "regua" && <Regua aoMudar={carregar} />}
    </div>
  );
}

/* ============================== Panorama ============================== */

function Panorama({ resumo }: { resumo: ResumoNotas | null }) {
  if (!resumo) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card-surface p-4">
        <h3 className="mb-3 text-sm font-semibold">Mês a mês</h3>
        {!resumo.meses.length && <p className="text-[13px] text-muted-foreground">Nada no período.</p>}
        <div className="space-y-2.5">
          {resumo.meses.map((mm) => (
            <div key={mm.mes} className="grid grid-cols-[52px_1fr_112px] items-center gap-3">
              <span className="text-[12px] tabular-nums text-muted-foreground">{mesCurto(mm.mes)}</span>
              <BarraCobertura
                v={{
                  com_nota: mm.valor_com_nota, pronta: 0,
                  sem_nota: mm.valor_sem_nota,
                  nao_verificado: Math.max(0, mm.valor - mm.valor_com_nota - mm.valor_sem_nota),
                }}
                total={mm.valor}
              />
              <span className="text-right text-[12px] tabular-nums text-muted-foreground" title={`${mm.titulos} títulos`}>
                {brlStr(mm.valor)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <h3 className="border-b border-border p-4 pb-3 text-sm font-semibold">Por conta de pagamento</h3>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 text-right font-medium">Títulos</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-4 py-2 text-right font-medium">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {resumo.contas.map((c) => (
              <tr key={c.conta} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2">
                  {c.conta}
                  {c.nao_verificado > 0 && (
                    <span className="ml-1.5 text-[11px] text-violet-600 dark:text-violet-400">
                      {c.nao_verificado} não verificado(s)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.titulos.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(c.valor)}</td>
                <td className={cn(
                  "px-4 py-2 text-right font-medium tabular-nums",
                  (c.cobertura ?? 0) >= 90 ? "text-emerald-600 dark:text-emerald-400"
                    : (c.cobertura ?? 0) >= 60 ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400",
                )}>
                  {pctStr(c.cobertura)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================= Categorias ============================= */

function Categorias({ resumo }: { resumo: ResumoNotas | null }) {
  const linhas = categoriasCriticas(resumo);
  return (
    <div className="card-surface overflow-x-auto p-0">
      <div className="border-b border-border p-4 pb-3">
        <h3 className="text-sm font-semibold">Onde a nota mais falta</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Ordenado por <b>valor faltante</b>, não por percentual: uma categoria de R$ 12 com 0% de
          cobertura lideraria a lista sem ser problema de ninguém.
        </p>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Categoria</th>
            <th className="px-3 py-2 text-right font-medium">Títulos</th>
            <th className="px-3 py-2 text-right font-medium">Falta</th>
            <th className="px-3 py-2 text-right font-medium">Sem nota</th>
            <th className="px-3 py-2 text-right font-medium">Pronta</th>
            <th className="px-3 py-2 text-right font-medium">Não verificado</th>
            <th className="px-4 py-2 text-right font-medium">Cobertura</th>
          </tr>
        </thead>
        <tbody>
          {!linhas.length && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
              Nenhuma categoria com nota faltando no período.
            </td></tr>
          )}
          {linhas.map((c) => (
            <tr key={c.codigo ?? c.categoria} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2">
                {c.categoria}
                {c.codigo && <span className="ml-1.5 text-[11px] text-muted-foreground">{c.codigo}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{c.titulos}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-red-600 dark:text-red-400">{brl(c.valor_faltante)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{c.sem_nota || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{c.pronta || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-violet-600 dark:text-violet-400">{c.nao_verificado || "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{pctStr(c.cobertura)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ Fornecedores ============================ */

function Fornecedores({ resumo }: { resumo: ResumoNotas | null }) {
  const linhas = resumo?.fornecedores ?? [];
  const cartaoTitulos = resumo?.meta?.cartao_titulos ?? 0;
  return (
    <div className="card-surface overflow-x-auto p-0">
      <div className="border-b border-border p-4 pb-3">
        <h3 className="text-sm font-semibold">Quem deve nota</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          A cobrança é por CNPJ, não por título: um fornecedor com oito títulos em aberto é um
          e-mail, não oito.
        </p>
        {cartaoTitulos > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[12.5px] text-amber-700 dark:text-amber-400">
            <CreditCard className="h-3.5 w-3.5" />
            Fora desta lista: <b>{cartaoTitulos.toLocaleString("pt-BR")} gastos de cartão</b>
            {" "}({brlStr(resumo?.meta?.cartao_valor ?? 0)}). A nota deles se cobra de quem gastou,
            na Auditoria do cartão — não de um CNPJ. Continuam contando na cobertura.
          </p>
        )}
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Favorecido</th>
            <th className="px-3 py-2 font-medium">CNPJ/CPF</th>
            <th className="px-3 py-2 text-right font-medium">Títulos</th>
            <th className="px-4 py-2 text-right font-medium">Valor sem nota</th>
          </tr>
        </thead>
        <tbody>
          {!linhas.length && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
              Ninguém devendo nota no período.
            </td></tr>
          )}
          {linhas.map((f, i) => (
            <tr key={`${f.doc}-${i}`} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2">{f.favorecido || "—"}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{formatarDoc(f.doc)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.titulos}</td>
              <td className="px-4 py-2 text-right font-medium tabular-nums">{brl(f.valor_faltante)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== Títulos =============================== */

const PAGINA = 60;

function Titulos({ de, ate, gravidadeInicial }: {
  de: string; ate: string; gravidadeInicial: Gravidade[];
}) {
  const [situacoes, setSituacoes] = useState<SituacaoTitulo[]>([...SITUACOES_FALTANDO]);
  const [gravidades, setGravidades] = useState<Gravidade[]>(gravidadeInicial);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [linhas, setLinhas] = useState<LinhaTitulo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const nomear = useNomeDaLinha();

  // O clique no painel de gravidade troca o foco com a aba já aberta.
  useEffect(() => { setGravidades(gravidadeInicial); }, [gravidadeInicial]);
  useEffect(() => { setPagina(0); }, [situacoes, gravidades, busca, de, ate]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      const { data, error } = await sb.rpc("cap_notas_titulos", {
        p_de: de, p_ate: ate,
        p_situacoes: situacoes.length ? situacoes : null,
        p_gravidades: gravidades.length ? gravidades : null,
        p_busca: busca.trim() || null,
        p_limite: PAGINA, p_offset: pagina * PAGINA,
      });
      if (!vivo) return;
      if (error) toast.error(`Não deu para listar: ${error.message}`);
      setLinhas((data as LinhaTitulo[]) ?? []);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [de, ate, situacoes, gravidades, busca, pagina]);

  const total = linhas[0]?.total_geral ?? 0;
  const paginas = Math.max(1, Math.ceil(total / PAGINA));

  const alternar = (s: SituacaoTitulo) =>
    setSituacoes((atual) => (atual.includes(s) ? atual.filter((x) => x !== s) : [...atual, s]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {SITUACOES_EXIGIVEIS.map((s) => (
          <button
            key={s}
            className={cn("chip", situacoes.includes(s) && "border-primary text-primary")}
            onClick={() => alternar(s)}
            title={SITUACAO[s].ajuda}
          >
            {SITUACAO[s].rotulo}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {GRAVIDADES.map((g) => (
          <button
            key={g}
            className={cn("chip", gravidades.includes(g) && "border-primary text-primary")}
            onClick={() => setGravidades((a) => (a.includes(g) ? a.filter((x) => x !== g) : [...a, g]))}
          >
            {GRAVIDADE[g].rotulo}
          </button>
        ))}

        <span className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="fornecedor, CNPJ ou nº do título"
            className="h-8 w-[260px] pl-7 text-[12.5px]"
          />
        </span>
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Favorecido</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Gravidade</th>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-4 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            )}
            {!carregando && !linhas.length && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                Nenhum título com estes filtros.
              </td></tr>
            )}
            {!carregando && linhas.map((l) => (
              <tr key={l.cod_titulo} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-2"><Favorecido l={l} nomear={nomear} /></td>
                <td className="px-3 py-2 text-[12.5px]">{l.categoria}</td>
                <td className="px-3 py-2 text-[12.5px] text-muted-foreground">{l.conta}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(l.valor)}</td>
                <td className="px-3 py-2">
                  <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px]", TOM[GRAVIDADE[l.gravidade].tom])}>
                    {GRAVIDADE[l.gravidade].rotulo}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataStr(l.competencia)}</td>
                <td className="px-4 py-2">
                  <span
                    className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px]", TOM[SITUACAO[l.situacao].tom])}
                    title={l.erro_leitura ?? SITUACAO[l.situacao].ajuda}
                  >
                    {SITUACAO[l.situacao].rotulo}
                  </span>
                  {l.nota_no_hub && l.situacao !== "com_nota" && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                      <Paperclip className="h-3 w-3" /> {l.nota_no_hub}
                    </span>
                  )}
                  {l.nf_no_campo && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">NF {l.nf_no_campo}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGINA && (
        <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
          <span>{total.toLocaleString("pt-BR")} títulos</span>
          <span className="flex items-center gap-1.5">
            <button className="ghost-icone" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            página {pagina + 1} de {paginas}
            <button className="ghost-icone" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/* ========================== Anexo a conferir ========================== */

/**
 * O ERP tem arquivo — mas é a nota?
 *
 * A primeira heurística presumia culpa e mandou 89 de 356 anexos para cá. A
 * lista era quase toda legítima (chave de NF-e de 44 dígitos, "cesan jun.pdf",
 * "Alude_Cobrança-De-Aluguel…"), e fila cheia de falso positivo é fila que
 * ninguém abre duas vezes — aí o `nf_undefined_correta.pdf` de verdade se
 * esconde no meio dos 89. A regra virou a inversa: só chega aqui quem tem sinal
 * NEGATIVO no nome e nenhum positivo. Sobraram 18.
 */
function Revisar({ de, ate, aoRevisar }: { de: string; ate: string; aoRevisar: () => void }) {
  const [linhas, setLinhas] = useState<LinhaTitulo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<number | null>(null);
  const nomear = useNomeDaLinha();

  const ler = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.rpc("cap_notas_titulos", {
      p_de: de, p_ate: ate, p_situacoes: ["anexo_suspeito"], p_limite: 300,
    });
    if (error) toast.error(`Não deu para ler: ${error.message}`);
    setLinhas((data as LinhaTitulo[]) ?? []);
    setCarregando(false);
  }, [de, ate]);

  useEffect(() => { void ler(); }, [ler]);

  const decidir = async (cod: number, veredito: "nota" | "nao_e_nota") => {
    setSalvando(cod);
    const { error } = await sb.rpc("cap_anexo_revisar", { p_cod_titulo: cod, p_veredito: veredito });
    setSalvando(null);
    if (error) { toast.error(`Não deu para salvar: ${error.message}`); return; }
    setLinhas((l) => l.filter((x) => x.cod_titulo !== cod));
    toast.success(veredito === "nota"
      ? "Marcado como nota — o título passa a contar como coberto."
      : "Marcado como \"não é a nota\" — o título volta para a lista do que falta.");
    aoRevisar();
  };

  return (
    <div className="space-y-3">
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold">O ERP tem arquivo — mas é a nota?</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          Chegam aqui só os anexos cujo nome não identifica documento nenhum: o que o sistema
          nomeou sozinho (<code>nf_undefined_correta.pdf</code>, UUID, <code>.tmp</code>) e foto sem
          renomear. Nome de fornecedor comum — <i>“cesan jun.pdf”</i>, <i>“4407 - TAKEAT.pdf”</i> —
          e chave de NF-e de 44 dígitos <b>não</b> entram: presumir culpa lotaria a fila e
          esconderia o problema de verdade no meio dela.
        </p>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Enquanto não decidido, o título <b>não conta</b> como coberto.
        </p>
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Favorecido</th>
              <th className="px-3 py-2 font-medium">Arquivo no Omie</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-4 py-2 font-medium">É a nota?</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            )}
            {!carregando && !linhas.length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                Nenhum anexo em dúvida no período.
              </td></tr>
            )}
            {!carregando && linhas.map((l) => (
              <tr key={l.cod_titulo} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-2"><Favorecido l={l} nomear={nomear} /></td>
                <td className="px-3 py-2">
                  {(l.anexos ?? []).map((a, i) => (
                    <span key={i} className="block break-all font-mono text-[11.5px]">{a.nome ?? "(sem nome)"}</span>
                  ))}
                  {!l.anexos?.length && <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(l.valor)}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataStr(l.competencia)}</td>
                <td className="px-4 py-2">
                  <span className="flex gap-1.5">
                    <button
                      className={cn("chip", TOM.ok)} disabled={salvando === l.cod_titulo}
                      onClick={() => decidir(l.cod_titulo, "nota")}
                      title="Abri o arquivo e é a nota deste título."
                    >
                      <ThumbsUp className="h-3.5 w-3.5" /> É a nota
                    </button>
                    <button
                      className={cn("chip", TOM.falta)} disabled={salvando === l.cod_titulo}
                      onClick={() => decidir(l.cod_titulo, "nao_e_nota")}
                      title="Não é a nota — o título volta para a lista do que falta cobrar."
                    >
                      <ThumbsDown className="h-3.5 w-3.5" /> Não é
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================== Falta um passo ============================== */

type QuaseLinha = {
  origem: string; ref_id: string; rotulo: string; competencia: string | null;
  valor: number; tem_comprovante: boolean; tem_titulo: boolean; falta: string;
};

function QuaseLa() {
  const [linhas, setLinhas] = useState<QuaseLinha[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await sb.rpc("auditoria_envio_quase_la", { p_limite: 400 });
      if (error) toast.error(`Não deu para ler: ${error.message}`);
      setLinhas((data as QuaseLinha[]) ?? []);
      setCarregando(false);
    })();
  }, []);

  const prontas = linhas.filter((l) => l.falta === "pronta para subir");
  const resto = linhas.filter((l) => l.falta !== "pronta para subir");

  return (
    <div className="space-y-3">
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold">Por que esta nota não subiu</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          A fila de envio exige três coisas ao mesmo tempo: a nota anexada, o título do Omie casado
          e nenhum carimbo de envio. Faltando uma, a linha some da fila <b>sem erro e sem aviso</b> —
          foi assim que os 79 achados de junho ficaram inteiros de fora por dois meses. Esta lista é
          o oposto disso: o que está a um passo, e qual é o passo.
        </p>
        {!!prontas.length && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[12.5px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {prontas.length} pronta(s) para subir — use “Subir o que está pronto” lá em cima.
          </p>
        )}
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Origem</th>
              <th className="px-3 py-2 font-medium">Lançamento</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-4 py-2 font-medium">O que falta</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            )}
            {!carregando && ![...prontas, ...resto].length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                Nada pendente: tudo que tinha nota já está no ERP.
              </td></tr>
            )}
            {[...prontas, ...resto].map((l) => (
              <tr key={`${l.origem}-${l.ref_id}`} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2 text-[12px] capitalize text-muted-foreground">{l.origem}</td>
                <td className="px-3 py-2">{l.rotulo}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(l.valor)}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataStr(l.competencia)}</td>
                <td className={cn(
                  "px-4 py-2 text-[12.5px]",
                  l.falta === "pronta para subir" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                )}>
                  {l.falta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================= Régua ================================= */

type LinhaRegua = {
  codigo: string; descricao: string | null; regra: Regra;
  motivo: string | null; origem: string;
};

function Regua({ aoMudar }: { aoMudar: () => void }) {
  const [linhas, setLinhas] = useState<LinhaRegua[]>([]);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  const ler = useCallback(async () => {
    const { data, error } = await sb.from("omie_categoria_regra")
      .select("codigo, descricao, regra, motivo, origem").order("codigo");
    if (error) toast.error(`Não deu para ler a régua: ${error.message}`);
    setLinhas((data as LinhaRegua[]) ?? []);
  }, []);

  useEffect(() => { void ler(); }, [ler]);

  const trocar = async (codigo: string, regra: Regra) => {
    setSalvando(codigo);
    const { error } = await sb.from("omie_categoria_regra")
      .update({ regra, origem: "humano", atualizado_em: new Date().toISOString() })
      .eq("codigo", codigo);
    setSalvando(null);
    if (error) { toast.error(`Não deu para salvar: ${error.message}`); return; }
    setLinhas((l) => l.map((x) => (x.codigo === codigo ? { ...x, regra, origem: "humano" } : x)));
    toast.success("Régua atualizada — a cobertura já reflete isso.");
    aoMudar();
  };

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return linhas;
    return linhas.filter((l) =>
      l.codigo.toLowerCase().includes(q) || (l.descricao ?? "").toLowerCase().includes(q));
  }, [linhas, busca]);

  return (
    <div className="space-y-3">
      <div className="card-surface p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Scale className="h-4 w-4" /> O que exige nota</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
          É o <b>denominador</b> de toda a medição. A classificação inicial saiu do nome da categoria;
          onde ela erra, a decisão de quem está aqui vence e passa a valer para sempre — a semente
          nunca sobrescreve o que uma pessoa marcou.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
          {(Object.keys(REGRA) as Regra[]).map((r) => (
            <span key={r}>
              <b className="text-foreground">{REGRA[r].rotulo}:</b> {REGRA[r].ajuda}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="categoria ou código" className="h-8 w-[280px] pl-7 text-[12.5px]" />
        </span>
        <span className="text-[12px] text-muted-foreground">{filtradas.length} categorias</span>
      </div>

      <div className="card-surface overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Regra</th>
              <th className="px-4 py-2 font-medium">Por quê</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr key={l.codigo} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2">
                  <span className="block">{l.descricao ?? "(sem cadastro)"}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">{l.codigo}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex gap-1">
                    {(Object.keys(REGRA) as Regra[]).map((r) => (
                      <button
                        key={r}
                        disabled={salvando === l.codigo}
                        onClick={() => trocar(l.codigo, r)}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[11px] transition",
                          l.regra === r
                            ? r === "exige" ? TOM.falta : r === "dispensa" ? TOM.fora : TOM.atencao
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                        title={REGRA[r].ajuda}
                      >
                        {REGRA[r].rotulo}
                      </button>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-2 text-[12px] text-muted-foreground">
                  {l.motivo ?? "—"}
                  {l.origem === "humano" && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-foreground">
                      <ArrowUpRight className="h-3 w-3" /> decidido aqui
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
