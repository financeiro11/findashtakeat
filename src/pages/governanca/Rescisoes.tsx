/* /governanca/rescisoes — o detalhamento de cada desligamento, parcela a parcela.
 *
 * Quem calcula é a skill "Rescisão PJ" (ela cruza a planilha de RH com o e-mail
 * de desligamento do gestor); esta tela é o registro. A conta chegava por
 * conversa e sumia: um mês depois ninguém sabia mais de que os R$ 22 mil eram
 * feitos, se já tinham sido pagos, nem qual foi o motivo escrito pelo gestor —
 * no Hub só sobrava a saída consolidada dentro da folha, sem nome.
 *
 * A DIVISÃO DE TRABALHO é a do cartão (ver supabase/migrations/…_cartao_ofx.sql):
 * a skill entrega as seis parcelas que ela já imprime na resposta e o Hub guarda,
 * soma, CONFERE e controla o pagamento.
 *
 * A conferência é o motivo de a tela existir em tabela e não em texto: o total a
 * receber vem da skill e é recalculado das parcelas aqui. Quando discordam,
 * ninguém escolhe em silêncio — a divergência aparece na barra de status e na
 * linha.
 *
 * A tela também aceita rescisão CLT (com FGTS, INSS e aviso prévio) — colunas e
 * campos que não valem para PJ simplesmente não aparecem. Hoje, na prática, tudo
 * que entra aqui é PJ.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { Input } from "@/components/ui/input";
import * as XLSX from "xlsx";
import {
  Loader2, Download, Search, UserMinus, Wallet, Scale, CalendarClock,
  AlertTriangle, Check, FileCode2, Braces,
} from "lucide-react";
import {
  MOTIVOS, SITUACOES, AVISOS, brlStr, conferir, custoDe, filtrar, fmtData,
  paraAOA, prazo, resumoAno, tempoDeCasa, temEncargos,
  type MotivoRescisao, type Rescisao, type Verba,
} from "@/lib/rescisoes";
import { DetalheRescisao } from "./rescisoes/DetalheRescisao";
import { ContratoSkill } from "./rescisoes/ContratoSkill";

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece as tabelas desta
   migration — mesmo atalho do Painel CAC. Some quando os tipos forem regerados. */
const db = supabase as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

/** Compacto na grade; o valor cheio no hover. */
const brl = (n: number | null | undefined) => comValorExato(n, brlStr(n));

const LOTE = 1000;

/* O PostgREST desta instância devolve no máximo 1000 linhas por chamada e NÃO
   avisa quando cortou (`.limit(2000)` volta 1000 calado — a lição do Asaas).
   Verba é linha miúda e são muitas por rescisão: sem paginar, a conferência
   acusaria divergência falsa justamente em quem ficou de fora da leitura. */
async function lerVerbas(ids: string[]): Promise<Verba[]> {
  const out: Verba[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const fatia = ids.slice(i, i + 200);
    for (let de = 0; ; de += LOTE) {
      const { data, error } = await db
        .from("rescisoes_verbas")
        .select("*")
        .in("rescisao_id", fatia)
        .order("rescisao_id", { ascending: true })
        .order("ordem", { ascending: true })
        .range(de, de + LOTE - 1);
      if (error) throw error;
      const bloco = (data ?? []) as Verba[];
      out.push(...bloco);
      if (bloco.length < LOTE) break;
    }
  }
  return out;
}

export default function Rescisoes() {
  const [rows, setRows] = useState<Rescisao[]>([]);
  const [verbas, setVerbas] = useState<Verba[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ano, setAno] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [motivo, setMotivo] = useState<MotivoRescisao | "todos">("todos");
  const [soAbertas, setSoAbertas] = useState(false);
  /* Guarda-se o ID, não a linha: marcar "paga" recarrega a lista, e um objeto
     congelado no estado deixaria o detalhe aberto mostrando a situação velha. */
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [contrato, setContrato] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await db
      .from("rescisoes")
      .select("*")
      .order("desligamento", { ascending: false });

    if (error) {
      toast.error("Não consegui ler as rescisões", { description: error.message });
      setRows([]); setVerbas([]); setCarregando(false);
      return;
    }
    const lista = (data ?? []) as Rescisao[];
    setRows(lista);

    try {
      setVerbas(lista.length ? await lerVerbas(lista.map((r) => r.id)) : []);
    } catch (e) {
      toast.error("Não consegui ler o detalhamento", { description: (e as Error).message });
      setVerbas([]);
    }
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /* Os anos que existem, do mais novo para o mais velho. O padrão é o ano
     corrente quando ele tem rescisão — senão o mais recente que tem, porque
     abrir num ano vazio parece "não há registro nenhum". */
  const anos = useMemo(
    () => [...new Set(rows.map((r) => r.desligamento.slice(0, 4)))].sort().reverse(),
    [rows],
  );
  useEffect(() => {
    if (ano || !anos.length) return;
    const atual = String(new Date().getFullYear());
    setAno(anos.includes(atual) ? atual : anos[0]);
  }, [anos, ano]);

  const doAno = useMemo(
    () => (ano === "todos" ? rows : rows.filter((r) => r.desligamento.slice(0, 4) === ano)),
    [rows, ano],
  );

  const verbasPor = useMemo(() => {
    const m = new Map<string, Verba[]>();
    for (const v of verbas) {
      const l = m.get(v.rescisao_id);
      if (l) l.push(v); else m.set(v.rescisao_id, [v]);
    }
    return m;
  }, [verbas]);

  const resumo = useMemo(() => resumoAno(doAno), [doAno]);

  /* Rescisão PJ não tem FGTS nem encargos — o custo da empresa É o total a
     receber. A coluna só aparece quando há alguma celetista no período, senão
     seriam duas colunas com o mesmo número lado a lado. */
  const comEncargos = useMemo(() => temEncargos(doAno), [doAno]);

  const aberta = useMemo(() => rows.find((r) => r.id === abertaId) ?? null, [rows, abertaId]);

  /* Conferência de todas as rescisões do período — é o que a barra de status
     resume e o que marca a linha. */
  const conferencias = useMemo(() => {
    const m = new Map<string, ReturnType<typeof conferir>>();
    for (const r of doAno) m.set(r.id, conferir(r, verbasPor.get(r.id) ?? []));
    return m;
  }, [doAno, verbasPor]);

  const divergentes = useMemo(
    () => doAno.filter((r) => { const c = conferencias.get(r.id); return c && !c.semVerbas && !c.fecha; }),
    [doAno, conferencias],
  );
  const semDetalhe = useMemo(
    () => doAno.filter((r) => conferencias.get(r.id)?.semVerbas),
    [doAno, conferencias],
  );

  const visiveis = useMemo(() => {
    let l = doAno;
    if (motivo !== "todos") l = l.filter((r) => r.motivo === motivo);
    if (soAbertas) l = l.filter((r) => r.situacao !== "paga" && r.situacao !== "cancelada" && !r.data_pagamento);
    return filtrar(l, busca);
  }, [doAno, motivo, soAbertas, busca]);

  /* O carimbo de quando a skill escreveu por último. É a resposta para "isso
     está atualizado?" sem obrigar a abrir uma rescisão. */
  const ultimaGravacao = useMemo(() => {
    const t = rows.map((r) => Date.parse(r.atualizado_em)).filter((n) => !isNaN(n));
    return t.length ? new Date(Math.max(...t)) : null;
  }, [rows]);

  const motivosNoPeriodo = useMemo(
    () => resumo.porMotivo.map((m) => m.motivo),
    [resumo],
  );

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(paraAOA(visiveis)), "Rescisões");
    const nome = `rescisoes-${ano || "todas"}.xlsx`;
    XLSX.writeFile(wb, nome);
    toast.success("Planilha gerada", { description: nome });
  }

  async function mudarSituacao(r: Rescisao, situacao: string, dataPagamento?: string | null) {
    const { error } = await db.rpc("rescisao_situacao", {
      p_id: r.id, p_situacao: situacao, p_data_pagamento: dataPagamento ?? null,
    });
    if (error) { toast.error("Não consegui mudar a situação", { description: error.message }); return; }
    toast.success(`Rescisão de ${r.colaborador}: ${SITUACOES[situacao as keyof typeof SITUACOES]?.label ?? situacao}`);
    await carregar();
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo as rescisões…
      </div>
    );
  }

  if (!rows.length) {
    return (
      <>
        <div className="card-surface p-8 text-center">
          <UserMinus className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">Nenhuma rescisão registrada ainda</p>
          <p className="mx-auto mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-muted-foreground">
            O cálculo é da skill <b>Rescisão PJ</b>; este painel é onde ele fica guardado — parcela a
            parcela, com as fontes que ela consultou, a conferência da soma e o controle do pagamento.
            Peça à skill para registrar o cálculo no Hub e ele aparece aqui.
          </p>
          <button className="chip mx-auto mt-4" onClick={() => setContrato(true)}>
            <Braces className="h-3.5 w-3.5" /> Ver o que a skill precisa gravar
          </button>
        </div>
        <ContratoSkill aberto={contrato} onFechar={() => setContrato(false)} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---------------- barra de comando ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {anos.map((a) => (
            <button
              key={a}
              onClick={() => setAno(a)}
              className={cn("chip", ano === a && "border-primary text-primary")}
            >
              {a}
            </button>
          ))}
          {anos.length > 1 && (
            <button
              onClick={() => setAno("todos")}
              className={cn("chip", ano === "todos" && "border-primary text-primary")}
            >
              Todos
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pessoa, cargo, área…"
              className="h-8 w-[210px] pl-8 text-[12.5px]"
            />
          </div>
          <button className="chip" onClick={() => setContrato(true)} title="O contrato do payload que a skill grava">
            <Braces className="h-3.5 w-3.5" /> Contrato da skill
          </button>
          <button className="chip" onClick={exportar} disabled={!visiveis.length}>
            <Download className="h-3.5 w-3.5" /> Exportar
          </button>
        </div>
      </div>

      {/* ---------------- a conta ---------------- */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          eyebrow={ano === "todos" ? "Rescisões registradas" : `Rescisões em ${ano}`}
          valor={<span className="num">{resumo.qtd}</span>}
          icone={<UserMinus className="h-3.5 w-3.5" />}
          rodape={
            <>
              {resumo.porMotivo[0]
                ? <>maior custo: {MOTIVOS[resumo.porMotivo[0].motivo].curto} ({resumo.porMotivo[0].qtd})</>
                : <>sem rescisão no período</>}
              {resumo.canceladas > 0 && <> · {resumo.canceladas} cancelada(s) fora da conta</>}
            </>
          }
        />
        <Kpi
          eyebrow="Custo do período"
          valor={brl(resumo.custo)}
          icone={<Wallet className="h-3.5 w-3.5" />}
          destaque
          rodape={
            comEncargos ? (
              <>
                total a receber {brlStr(resumo.liquido)} + FGTS {brlStr(resumo.fgts)}
                {resumo.encargos > 0 && <> + encargos {brlStr(resumo.encargos)}</>}
              </>
            ) : (
              <>soma dos totais a receber · PJ não tem FGTS nem encargos</>
            )
          }
        />
        <Kpi
          eyebrow="Custo médio"
          valor={brl(resumo.medio)}
          icone={<Scale className="h-3.5 w-3.5" />}
          tom="neutro"
          rodape={
            resumo.mesesCasa != null
              ? <>tempo de casa médio: {formatarMeses(resumo.mesesCasa)}</>
              : <>sem data de admissão para calcular o tempo de casa</>
          }
        />
        <Kpi
          eyebrow="A pagar"
          valor={brl(resumo.aPagar)}
          icone={<CalendarClock className="h-3.5 w-3.5" />}
          tom={resumo.atrasadas > 0 ? undefined : "neutro"}
          rodape={
            <>
              {resumo.qtdAPagar} sem pagamento registrado
              {resumo.atrasadas > 0 && (
                <span className="ml-1 font-semibold text-neg">
                  · {resumo.atrasadas} fora do prazo ({brlStr(resumo.valorAtrasado)})
                </span>
              )}
            </>
          }
        />
      </div>

      {/* ---------------- barra de status ----------------
          Uma faixa, não quatro caixas de aviso: é a lição da limpeza visual da
          DRE. O que interessa aqui é "posso confiar nesses números?". */}
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {divergentes.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-warn">
              <AlertTriangle className="h-3.5 w-3.5" />
              {divergentes.length} rescisão(ões) em que a soma das verbas não fecha com o total da skill —
              <b>{divergentes.map((r) => r.colaborador.split(" ")[0]).join(", ")}</b>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-pos">
              <Check className="h-3.5 w-3.5" /> toda rescisão com detalhamento fecha com o total calculado
            </span>
          )}
          {semDetalhe.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <FileCode2 className="h-3.5 w-3.5" />
              {semDetalhe.length} sem verba gravada (só o total) — nada a conferir nelas
            </span>
          )}
        </div>
        <span className="text-muted-foreground/80">
          {ultimaGravacao
            ? `última gravação da skill ${ultimaGravacao.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
            : "sem carimbo de gravação"}
        </span>
      </div>

      {/* ---------------- filtros da lista ----------------
          Estes filtros mexem SÓ na lista: os KPIs e a barra de status acima
          continuam falando do período inteiro (mesma convenção do drill-down da
          DRE, para o cabeçalho não mudar de número quando se procura alguém). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setMotivo("todos")}
          className={cn("chip", motivo === "todos" && "border-primary text-primary")}
        >
          Todos os motivos
        </button>
        {motivosNoPeriodo.map((m) => (
          <button
            key={m}
            onClick={() => setMotivo(m)}
            className={cn("chip", motivo === m && "border-primary text-primary")}
          >
            {MOTIVOS[m].curto}
          </button>
        ))}
        <button
          onClick={() => setSoAbertas((v) => !v)}
          className={cn("chip", soAbertas && "border-primary text-primary")}
          title="Só o que ainda não tem pagamento registrado"
        >
          <CalendarClock className="h-3.5 w-3.5" /> {soAbertas ? "Só a pagar" : "Todas"}
        </button>
        {(motivo !== "todos" || soAbertas || busca) && (
          <span className="text-[11.5px] text-muted-foreground">
            {visiveis.length} de {doAno.length} na lista
          </span>
        )}
      </div>

      {/* ---------------- a lista ---------------- */}
      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Colaborador</th>
                <th className="px-3 py-2 text-left font-semibold">Motivo</th>
                <th className="px-3 py-2 text-left font-semibold">Saída</th>
                <th className="px-3 py-2 text-right font-semibold">Proventos</th>
                <th className="px-3 py-2 text-right font-semibold">(−) Descontos</th>
                <th className="px-3 py-2 text-right font-semibold">Total a receber</th>
                {comEncargos && <th className="px-3 py-2 text-right font-semibold">Custo da empresa</th>}
                <th className="px-3 py-2 text-left font-semibold">Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r) => (
                <Linha
                  key={r.id}
                  r={r}
                  conf={conferencias.get(r.id)}
                  comEncargos={comEncargos}
                  onAbrir={() => setAbertaId(r.id)}
                />
              ))}
              {!visiveis.length && (
                <tr>
                  <td colSpan={comEncargos ? 8 : 7} className="px-3 py-8 text-center text-muted-foreground">
                    {busca || motivo !== "todos" || soAbertas
                      ? "Nada encontrado com estes filtros."
                      : "Nenhuma rescisão neste período."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetalheRescisao
        r={aberta}
        verbas={aberta ? (verbasPor.get(aberta.id) ?? []) : []}
        onFechar={() => setAbertaId(null)}
        onSituacao={mudarSituacao}
      />
      <ContratoSkill aberto={contrato} onFechar={() => setContrato(false)} />
    </div>
  );
}

/* ------------------------------ peças ------------------------------ */

function Linha({ r, conf, comEncargos, onAbrir }: {
  r: Rescisao;
  conf: ReturnType<typeof conferir> | undefined;
  comEncargos: boolean;
  onAbrir: () => void;
}) {
  const casa = tempoDeCasa(r.admissao, r.desligamento);
  const p = prazo(r);
  const cancelada = r.situacao === "cancelada";
  const tom = MOTIVOS[r.motivo]?.tom ?? "neu";

  return (
    <tr
      onClick={onAbrir}
      className={cn("cursor-pointer border-t border-border hover:bg-muted/30", cancelada && "opacity-60")}
    >
      <td className="px-3 py-2">
        <div className={cn("font-medium", cancelada && "line-through")}>
          {r.colaborador}
          {conf && !conf.semVerbas && !conf.fecha && (
            /* O `title` vai no <span>, não no ícone: atributo `title` em <svg> não
               vira tooltip nenhum (a mesma armadilha do ValorExato dentro de SVG). */
            <span
              className="ml-1.5 inline-flex align-text-bottom"
              title={`A soma das verbas difere do total calculado em ${brlStr(Math.abs(conf.difLiquido))}`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-warn" />
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {[r.cargo, r.departamento ?? r.centro_custo].filter(Boolean).join(" · ") || "—"}
          {r.vinculo !== "clt" && <> · {r.vinculo.toUpperCase()}</>}
        </div>
      </td>

      <td className="px-3 py-2">
        <span className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
          tom === "neg" && "bg-neg-soft text-neg",
          tom === "warn" && "bg-warn-soft text-warn",
          tom === "neu" && "bg-muted text-muted-foreground",
        )}>
          {MOTIVOS[r.motivo]?.curto ?? r.motivo}
        </span>
        {/* O motivo escrito pelo gestor no e-mail é o que explica a saída — a
            etiqueta só diz de quem foi a iniciativa. */}
        {(r.motivo_texto || r.aviso_previo) && (
          <div className="mt-0.5 max-w-[200px] truncate text-[11px] text-muted-foreground" title={r.motivo_texto ?? undefined}>
            {r.motivo_texto ??
              `${AVISOS[r.aviso_previo!] ?? r.aviso_previo}${r.aviso_dias ? ` · ${r.aviso_dias} dias` : ""}`}
          </div>
        )}
      </td>

      <td className="px-3 py-2">
        <div className="num">{fmtData(r.desligamento)}</div>
        <div className="text-[11px] text-muted-foreground">
          {casa ? `${casa.texto} de casa` : "sem admissão"}
        </div>
      </td>

      <td className="px-3 py-2 text-right num text-muted-foreground">{brl(r.total_proventos)}</td>
      <td className="px-3 py-2 text-right num text-muted-foreground">
        {Number(r.total_descontos) ? <span className="text-neg">− {brlStr(r.total_descontos)}</span> : "—"}
      </td>
      <td className="px-3 py-2 text-right num font-semibold">{brl(r.liquido)}</td>
      {comEncargos && <td className="px-3 py-2 text-right num">{brl(custoDe(r))}</td>}

      <td className="px-3 py-2">
        <span className={cn(
          "inline-flex items-center gap-1 text-[11.5px]",
          p.estado === "atrasado" && "font-semibold text-neg",
          p.estado === "hoje" && "font-semibold text-warn",
          p.estado === "pago" && "text-pos",
          (p.estado === "no_prazo" || p.estado === "sem_prazo" || p.estado === "cancelada") && "text-muted-foreground",
        )}>
          {p.texto}
        </span>
        <div className="text-[11px] text-muted-foreground">
          {SITUACOES[r.situacao]?.label ?? r.situacao}
          {p.estado !== "pago" && p.data && <> · prazo {fmtData(p.data)}</>}
        </div>
      </td>
    </tr>
  );
}

function Kpi({ eyebrow, valor, rodape, icone, destaque, tom }: {
  eyebrow: string;
  valor: React.ReactNode;
  rodape?: React.ReactNode;
  icone: React.ReactNode;
  destaque?: boolean;
  tom?: "neutro";
}) {
  return (
    <div className={cn("card-surface flex flex-col gap-2 p-4", destaque && "border-primary/40")}>
      <div className="flex items-center justify-between">
        <div className="eyebrow">{eyebrow}</div>
        <div className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg",
          tom === "neutro" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}>
          {icone}
        </div>
      </div>
      <div className={cn("num text-2xl font-bold tracking-tight", destaque && "text-primary")}>{valor}</div>
      {rodape && <div className="text-xs text-muted-foreground">{rodape}</div>}
    </div>
  );
}

/** "18 meses" não se lê; "1a 6m" se lê. */
function formatarMeses(meses: number): string {
  const m = Math.round(meses);
  if (m < 12) return `${m} ${m === 1 ? "mês" : "meses"}`;
  const a = Math.floor(m / 12), resto = m % 12;
  return resto ? `${a}a ${resto}m` : `${a}a`;
}
