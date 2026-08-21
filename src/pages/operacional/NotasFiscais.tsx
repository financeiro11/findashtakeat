// /operacional/notas-fiscais — a cobrança do Asaas e a nota do Omie, lado a lado.
//
// A PERGUNTA QUE ESTA TELA RESPONDE: "esta cobrança tem nota?" — que hoje tem duas
// respostas possíveis em dois sistemas que não sabem um do outro. Até a data de
// corte quem emite é o Asaas; do corte em diante, o Omie.
//
// ONDE A NOTA MORA NO OMIE. Dentro da ORDEM DE SERVIÇO, não num cadastro de notas:
//
//     OS na etapa 50  --FaturarLoteOS-->  faturada  ==>  NFS-e emitida
//
// Emitir, portanto, é faturar a OS — e quando a cobrança não tem OS (a maioria: são
// 1.207 OS contra milhares de cobranças), é criar a OS e faturar. Quem faz isso é a
// edge function `omie-nfse-sync`; esta tela só monta o lote e mostra o resultado.
// (Trocar a etapa da OS NÃO fatura: o Omie aceita e não faz nada. E o `FaturarLoteOS`
// fatura a etapa inteira, por isso a função isola a OS antes — está tudo explicado
// lá, e é de lá que vem a diferença entre "emitida", "já tinha nota" e "no forno".)
//
// O CASAMENTO entre os dois lados é feito no Postgres (`notas_fiscais_painel`) em
// duas camadas: o `cCodIntOS`, que o Hub carimba com o id da cobrança ao criar a OS
// (exato), e — para o histórico que nasceu sem carimbo — CNPJ + valor + competência.
// Por CNPJ e nunca por nome: o Asaas guarda o fantasia e o Omie a razão social.
//
// A LISTA É PAGINADA CONTRA O TETO DO POSTGREST, que corta em 1.000 linhas sem
// avisar. Um mês tem ~3.600 cobranças, então ler de uma vez mostraria 1.000 e
// esconderia o resto — parecendo que o mês é menor do que é.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import {
  FileText, RefreshCw, Loader2, Search, ExternalLink, AlertTriangle,
  ChevronLeft, ChevronRight, CheckCircle2, Send, Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import NotasFiscaisLog from "./NotasFiscaisLog";
import NotasFiscaisAuditoria from "./NotasFiscaisAuditoria";
import {
  SITUACOES, motivoBloqueio, motivoCurto, podeEmitir, resumoLote, xmlAindaVale, formatarDoc, statusAsaas,
  type LinhaNota, type Situacao,
} from "@/lib/notasFiscais";

const sb = supabase as any;

/* ------------------------------ formatação ------------------------------ */
// Convenção do projeto: o formatador normal devolve ReactNode com o valor cheio no
// hover; a variante `…Str` devolve string pura (title, template literal, eixo).
const brlStr = (n: number) => `R$ ${Math.round(n || 0).toLocaleString("pt-BR")}`;
const brl = (n: number) => comValorExato(n, brlStr(n));
const dataStr = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** O Asaas começou em out/2022; antes disso não há o que mostrar. */
const ANO_INICIAL = 2022;

const TOM: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  aviso: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  erro: "bg-destructive/10 text-destructive border-destructive/20",
  neutro: "bg-muted text-muted-foreground border-border",
};

interface Resumo {
  cobrancas: number; valor_total: number; falta: number; valor_falta: number;
  emitida_omie: number; emitida_asaas: number; em_processamento: number;
  nota_rejeitada: number; nota_a_cancelar: number; nao_exige: number;
}

/** As mesmas contagens da RPC `notas_fiscais_resumo`, feitas sobre o que já veio. */
function contar(linhas: LinhaNota[]): Resumo {
  const n = (s: Situacao) => linhas.filter((l) => l.situacao === s).length;
  return {
    cobrancas: linhas.length,
    valor_total: linhas.reduce((s, l) => s + Number(l.valor || 0), 0),
    falta: n("falta"),
    valor_falta: linhas.filter((l) => l.situacao === "falta").reduce((s, l) => s + Number(l.valor || 0), 0),
    emitida_omie: n("emitida_omie"),
    emitida_asaas: n("emitida_asaas"),
    em_processamento: n("em_processamento"),
    nota_rejeitada: n("nota_rejeitada"),
    nota_a_cancelar: n("nota_a_cancelar"),
    nao_exige: n("nao_exige"),
  };
}

export default function NotasFiscais() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth()); // 0-11
  const [linhas, setLinhas] = useState<LinhaNota[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [corte, setCorte] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [emitindo, setEmitindo] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Situacao | "todas">("todas");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aba, setAba] = useState<"painel" | "auditoria" | "log">("painel");

  const periodo = useMemo(() => {
    const ult = new Date(ano, mes + 1, 0).getDate();
    const mm = String(mes + 1).padStart(2, "0");
    return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${String(ult).padStart(2, "0")}` };
  }, [ano, mes]);

  /**
   * Lê o painel do mês numa chamada só.
   *
   * A RPC devolve JSONB, e não linhas, por dois motivos que se somam: o PostgREST
   * corta resultado em 1.000 linhas sem avisar (um mês tem ~3.600 cobranças, e o
   * mês apareceria truncado sem ninguém perceber), e paginar com `.range` seria
   * pior — cada página REEXECUTA a função inteira no banco, quatro vezes o mesmo
   * trabalho. Um jsonb é um valor único: não sofre o teto e roda uma vez.
   */
  const carregar = useCallback(async () => {
    setCarregando(true);
    setSel(new Set());
    try {
      const { data, error } = await sb.rpc("notas_fiscais_painel_json", {
        p_de: periodo.de, p_ate: periodo.ate,
      });
      if (error) throw error;
      const todas = (data ?? []) as LinhaNota[];
      setLinhas(todas);

      // O resumo sai das linhas que já estão na mão. Existe a RPC
      // `notas_fiscais_resumo`, mas chamá-la aqui rodaria o painel inteiro uma
      // SEGUNDA vez no banco — num mês de 3.600 cobranças isso dobrava o custo
      // da tela para produzir seis contagens que o cliente faz de graça. A RPC
      // continua servindo quem quer o número sem as linhas (SQL, outra tela).
      setResumo(contar(todas));

      const { data: cfg } = await sb.from("nf_config").select("data_corte").eq("id", 1).maybeSingle();
      setCorte(cfg?.data_corte ?? null);
    } catch (e: any) {
      toast.error("Não foi possível carregar o período.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, [periodo.de, periodo.ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  const atualizarDoOmie = async () => {
    setSincronizando(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "espelhar" } });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      toast.success(
        `${data.os_listadas} ordens de serviço no Omie`,
        { description: `${data.status_lidos} status conferidos · ${data.com_nota} com nota autorizada` +
            (data.status_pendentes > data.status_lidos ? ` · faltam ${data.status_pendentes - data.status_lidos}, rode de novo` : "") },
      );
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao atualizar do Omie.", { description: e?.message });
    } finally {
      setSincronizando(false);
    }
  };

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtro !== "todas" && l.situacao !== filtro) return false;
      if (!q) return true;
      // O documento entra na varredura formatado E cru: quem procura cola do Omie
      // (com pontuação) ou digita só os números.
      return [
        l.cliente_asaas, l.descricao, l.id_asaas, l.cnpj_cpf, formatarDoc(l.cnpj_cpf),
        l.nfse_numero, l.nf_asaas_numero,
      ].some((c) => (c ?? "").toLowerCase().includes(q));
    });
  }, [linhas, busca, filtro]);

  const lote = useMemo(() => resumoLote(linhas, sel), [linhas, sel]);

  const alternar = (id: string) => {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  /** Marca só o que dá para emitir — marcar o bloqueado seria promessa falsa. */
  const marcarEmitiveis = () => setSel(new Set(visiveis.filter(podeEmitir).map((l) => l.id_asaas)));

  const emitir = async () => {
    const ids = linhas.filter((l) => sel.has(l.id_asaas)).filter(podeEmitir).map((l) => l.id_asaas);
    if (!ids.length) return;
    const aviso =
      `Emitir ${ids.length} nota${ids.length > 1 ? "s" : ""} fiscal${ids.length > 1 ? "is" : ""} no Omie ` +
      `(${brlStr(lote.valor)})?\n\nIsto cria a Ordem de Serviço e fatura, o que emite a NFS-e de verdade. ` +
      `Nota emitida não se apaga — cancela-se, com prazo e justificativa.`;
    if (!window.confirm(aviso)) return;

    setEmitindo(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "emitir", ids } });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      /* Três desfechos, três avisos. "Em processamento" é o que mais importa
       * separar: o faturamento do Omie é assíncrono e a nota costuma nascer
       * minutos depois do disparo. Chamar isso de falha faz o operador mandar
       * emitir de novo — e a segunda nota da mesma cobrança não se apaga. */
      const emProcesso = (data.resultados ?? []).filter((r: any) => r.em_processamento);
      const falhas = (data.resultados ?? []).filter((r: any) => !r.ok && !r.em_processamento);
      const jaEmitidas = (data.resultados ?? []).filter((r: any) => r.ja_emitida);

      if (data.emitidas) toast.success(`${data.emitidas} nota(s) emitida(s) no Omie.`);
      if (jaEmitidas.length) {
        toast.info(`${jaEmitidas.length} já tinha(m) nota.`, {
          description: jaEmitidas.slice(0, 3).map((r: any) => r.aviso).join(" · "),
          duration: 10000,
        });
      }
      if (emProcesso.length) {
        toast.warning(`${emProcesso.length} ainda no forno do Omie.`, {
          description: `${emProcesso.slice(0, 2).map((r: any) => r.erro).join(" · ")} Atualize em alguns minutos — não emita de novo.`,
          duration: 15000,
        });
      }
      if (falhas.length) {
        toast.error(`${falhas.length} não saíram.`, {
          description: falhas.slice(0, 3).map((f: any) => f.erro).join(" · "),
          duration: 12000,
        });
      }
      await carregar();
    } catch (e: any) {
      toast.error("Falha na emissão.", { description: e?.message });
    } finally {
      setEmitindo(false);
    }
  };

  const kpis = resumo ? [
    { r: "Cobranças", v: resumo.cobrancas.toLocaleString("pt-BR"), s: brlStr(resumo.valor_total), tom: "neutro" },
    { r: "Sem nota", v: resumo.falta.toLocaleString("pt-BR"), s: brlStr(resumo.valor_falta), tom: resumo.falta ? "erro" : "ok" },
    { r: "Emitida no Omie", v: resumo.emitida_omie.toLocaleString("pt-BR"), s: "NFS-e autorizada", tom: "ok" },
    { r: "Emitida no Asaas", v: resumo.emitida_asaas.toLocaleString("pt-BR"), s: "antes do corte", tom: "ok" },
    { r: "NFS-e rejeitada", v: resumo.nota_rejeitada.toLocaleString("pt-BR"), s: "faturada sem nota válida", tom: resumo.nota_rejeitada ? "erro" : "neutro" },
    { r: "Nota a cancelar", v: resumo.nota_a_cancelar.toLocaleString("pt-BR"), s: "estorno com nota", tom: resumo.nota_a_cancelar ? "erro" : "neutro" },
  ] : [];

  return (
    <div className="space-y-4">
      {/* ------------------------------ cabeçalho ------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Notas Fiscais</h1>
            <p className="text-xs text-muted-foreground">
              Cobranças do Asaas × emissão no Omie
              {corte && <> · corte em <span className="num">{dataStr(corte)}</span></>}
            </p>
          </div>
        </div>
        <button
          onClick={atualizarDoOmie}
          disabled={sincronizando}
          className="ghost-btn flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
        >
          {sincronizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar do Omie
        </button>
      </div>

      {/* --------------------------------- abas -------------------------------- */}
      {/* Três perguntas diferentes, e por isso três abas:
          • Painel      — "o que falta emitir neste mês"
          • Auditoria   — "o que nunca vai virar nota, e por quê" (a fila descarta
                          cliente sem cadastro no Omie em silêncio: nem erro, nem
                          linha no registro — some)
          • Registro    — "o que o processo fez, quando, e por quê"
          Misturar as duas primeiras numa tela só é o que deixaria a falta
          silenciosa parecendo ausência de problema. */}
      <div className="flex items-center gap-1 border-b border-border">
        {([["painel", "Painel do mês"], ["auditoria", "Auditoria"], ["log", "Registro de emissões"]] as const).map(([k, r]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium",
              aba === k
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {aba === "log" && <NotasFiscaisLog />}

      {/* ------------------------------- período ------------------------------- */}
      {/* Fora do bloco do painel de propósito: a auditoria olha o MESMO recorte, e
          um seletor por aba faria a pessoa trocar o mês duas vezes para comparar
          o que falta com o que nunca vai sair. O registro de emissões é o único
          que não tem mês — ele é uma linha do tempo. */}
      {aba !== "log" && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <button onClick={() => setAno((a) => Math.max(ANO_INICIAL, a - 1))} className="ghost-icone rounded p-1">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="num w-12 text-center text-sm font-semibold">{ano}</span>
        <button
          onClick={() => setAno((a) => Math.min(hoje.getFullYear(), a + 1))}
          className="ghost-icone rounded p-1"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="ml-2 flex flex-wrap gap-1">
          {MESES.map((m, i) => (
            <button
              key={m}
              onClick={() => setMes(i)}
              className={cn(
                "rounded px-2 py-1 text-xs capitalize transition-colors",
                i === mes ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      )}

      {aba === "auditoria" && <NotasFiscaisAuditoria de={periodo.de} ate={periodo.ate} />}

      {aba === "painel" && (
      <>
      {/* --------------------------------- KPIs -------------------------------- */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.r} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">{k.r}</p>
            <p className={cn("num text-xl font-semibold", k.tom === "erro" && "text-destructive")}>{k.v}</p>
            <p className="truncate text-[11px] text-muted-foreground">{k.s}</p>
          </div>
        ))}
      </div>

      {/* ------------------------------- filtros ------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Cliente, CNPJ, descrição, nº da nota…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["todas", "falta", "nota_rejeitada", "emitida_omie", "emitida_asaas", "em_processamento", "nota_a_cancelar", "nao_exige"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cn(
                "rounded border px-2 py-1 text-[11px] transition-colors",
                filtro === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f === "todas" ? "Todas" : SITUACOES[f].rotulo}
            </button>
          ))}
        </div>
      </div>

      {/* -------------------------------- lote --------------------------------- */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex-1 text-xs">
            <span className="font-semibold">{lote.emitiveis}</span> de {lote.selecionadas} selecionadas vão ser emitidas
            {" · "}{brl(lote.valor)}
            {lote.bloqueadas > 0 && (
              <span className="ml-2 text-muted-foreground" title={lote.motivos.map(([m, n]) => `${n}× ${m}`).join("\n")}>
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {lote.bloqueadas} fora do lote
              </span>
            )}
          </div>
          <button onClick={() => setSel(new Set())} className="ghost-btn rounded border border-border px-2 py-1 text-xs">
            Limpar
          </button>
          <button
            onClick={emitir}
            disabled={emitindo || lote.emitiveis === 0}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {emitindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Emitir no Omie
          </button>
        </div>
      )}

      {/* -------------------------------- tabela ------------------------------- */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-muted/40">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="w-8 p-2">
                <button onClick={marcarEmitiveis} title="Marcar tudo que dá para emitir" className="ghost-icone rounded p-0.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              </th>
              <th className="p-2">Cliente</th>
              <th className="p-2">Cobrança</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2">Vencimento</th>
              <th className="p-2">Nota</th>
              <th className="p-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </td></tr>
            )}
            {!carregando && visiveis.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                Nenhuma cobrança neste recorte.
              </td></tr>
            )}
            {!carregando && visiveis.map((l) => {
              const s = SITUACOES[l.situacao];
              const bloqueio = motivoBloqueio(l);
              return (
                <tr key={l.id_asaas} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={sel.has(l.id_asaas)}
                      onChange={() => alternar(l.id_asaas)}
                      disabled={!!bloqueio}
                      title={bloqueio ?? "Selecionar para emitir"}
                      className="h-3.5 w-3.5 accent-[hsl(var(--primary))] disabled:opacity-30"
                    />
                  </td>
                  <td className="max-w-[220px] p-2">
                    <div className="truncate font-medium text-foreground">{l.cliente_asaas ?? "—"}</div>
                    <div className="num truncate text-[11px] text-muted-foreground">{formatarDoc(l.cnpj_cpf) || "sem documento"}</div>
                  </td>
                  <td className="max-w-[260px] p-2">
                    <div className="truncate text-muted-foreground" title={l.descricao ?? ""}>{l.descricao ?? "—"}</div>
                    {(() => {
                      const st = statusAsaas(l.status_asaas);
                      return (
                        <span
                          className={cn(
                            "mt-0.5 inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium",
                            TOM[st.tom],
                          )}
                          title={st.ajuda}
                        >
                          {st.rotulo}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="num p-2 text-right">{brl(Number(l.valor))}</td>
                  {/* A linha entra no mês por pagamento OU por vencimento (o que
                      existir). Quando o vencimento cai FORA do mês selecionado —
                      cobrança paga adiantada, parcela lá na frente — mostrar só ele
                      faz a data parecer errada. Então a data que trouxe a linha
                      aparece junto. */}
                  <td className="num p-2">
                    {dataStr(l.data_vencimento)}
                    {l.data_pagamento && l.data_pagamento.slice(0, 7) !== (l.data_vencimento ?? "").slice(0, 7) && (
                      <div className="text-[10px] text-muted-foreground" title="Data em que o pagamento entrou — é ela que traz a linha para este mês">
                        pago {dataStr(l.data_pagamento)}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    {l.nfse_numero ? (
                      <span className="num flex items-center gap-1">
                        {l.nfse_numero}
                        {xmlAindaVale(l.nfse_xml) && (
                          <a href={l.nfse_xml!} target="_blank" rel="noreferrer" title="XML da NFS-e" className="text-primary">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </span>
                    ) : l.nf_asaas_numero ? (
                      <span className="num text-muted-foreground" title="Nota emitida pelo Asaas">{l.nf_asaas_numero}</span>
                    ) : l.n_cod_os ? (
                      <span className="num text-[11px] text-muted-foreground" title="Ordem de serviço no Omie, ainda sem nota">
                        OS {l.n_cod_os}
                      </span>
                    ) : "—"}
                  </td>
                  {/* A situação e, embaixo, POR QUE. O rótulo sozinho ("NFS-e
                      rejeitada") manda abrir o Omie e procurar; o motivo — que o
                      Omie sempre mandou e o Hub descartava — diz o que consertar.
                      Curto na linha, inteiro no hover, que é a convenção daqui. */}
                  <td className="max-w-[220px] p-2">
                    <span
                      className={cn("inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px]", TOM[s.tom])}
                      title={s.ajuda}
                    >
                      {s.rotulo}
                    </span>
                    {motivoCurto(l.nfse_mensagem) && (
                      <div
                        className="mt-0.5 flex items-start gap-1 text-[10px] leading-tight text-muted-foreground"
                        title={l.nfse_mensagem ?? ""}
                      >
                        <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" />
                        <span className="line-clamp-2">{motivoCurto(l.nfse_mensagem)}</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!carregando && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3" />
          {visiveis.length.toLocaleString("pt-BR")} de {linhas.length.toLocaleString("pt-BR")} cobranças do mês.
          Emitir cria a Ordem de Serviço no Omie e a fatura — é isso que gera a NFS-e.
        </p>
      )}
      </>
      )}
    </div>
  );
}
