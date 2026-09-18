/* ---------------------------------------------------------------------------
 * FICHA DO CLIENTE — o que cada sistema diz, num lugar só (16/09/2026).
 *
 * O PEDIDO: "eu conserto uma coisa e descubro outra". A AEVO saiu com o endereço
 * velho porque o Omie não tinha sido corrigido; a EMME saiu para a Vespera
 * porque a OS antiga apontava para outro cadastro. Nos dois casos a informação
 * existia — espalhada entre Asaas, Omie e Receita, e ninguém a via junta.
 *
 * A REGRA DA TELA: a coluna do OMIE é a que vai para a nota, e está marcada
 * assim. Linha que diverge do Asaas ou da Receita fica em âmbar. OS de cobrança
 * deste cliente que aponta para OUTRO cadastro do Omie fica em vermelho.
 *
 * Um painel e não uma página: abre por um clique no nome do cliente, busca
 * qualquer outro por nome/CNPJ/id, e tem endereço próprio (`?cliente=`).
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Loader2, Search, TriangleAlert, CheckCircle2, ExternalLink, Link2, ChevronDown, RefreshCw } from "lucide-react";
import { EMITIVEIS, formatarDoc, linkPortalNacional, statusAsaas, type LinhaNota } from "@/lib/notasFiscais";
import { EditarCadastroCliente } from "./EditarCadastroCliente";
import type { TomadorErrado } from "./RefazerNotaOmie";
import { iniciarEmissao } from "./EmitirAgora";
import { abrirTarefa, useTarefas } from "@/lib/segundo-plano";
import { toast } from "sonner";

const sb = supabase as any;

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const data = (s: string | null | undefined) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");
const dataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

async function mensagemDe(error: any, dados: any): Promise<string> {
  if (dados?.erro) return String(dados.erro);
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.erro) return String(corpo.erro);
  } catch { /* sem corpo legível */ }
  return error?.message ?? "Erro sem mensagem.";
}

interface Linha {
  campo: string; rotulo: string;
  asaas: string | null; omie: string | null; receita: string | null;
  difere_asaas: boolean; difere_receita: boolean;
}
interface Ficha {
  doc: string; doc_formatado: string; nome: string;
  id_customer: string | null; n_cod_cli: number | null; codigos_omie: number[];
  asaas_ao_vivo: boolean; erro_leitura_omie: string | null;
  comparacao: Linha[];
  omie: Record<string, string> | null;
  asaas: Record<string, string | null>;
  receita: { razao_social: string | null; situacao: string | null; data_situacao: string | null; atividade: string | null; abertura: string | null } | null;
  conferencia: Array<{ id_customer: string; resultado: string; detalhe: string | null; tentativas: number; sincronizado_em: string }>;
  antes_do_pagamento: Array<{ tipo: string; ativo: boolean; motivo: string; criado_por: string | null; criado_em: string }>;
  cobrancas: Array<{
    id_asaas: string; valor: number; status: string; vencimento: string | null; pagamento: string | null;
    descricao: string | null; forma: string | null; link: string | null;
    /** Calculado no servidor — a OS viva do Omie ou a nota autorizada do Asaas. */
    nota?: { situacao: "tem_nota" | "no_forno" | "recusada" | "os_aberta" | "sem_nota"; rotulo: string | null; n_cod_os: number | null };
  }>;
  notas: Array<{
    n_cod_os: number; c_num_os: string | null; c_cod_int_os: string | null; n_cod_cli: number | null;
    valor: number; nfse_numero: string | null; nfse_status: string | null; nfse_mensagem: string | null;
    nfse_verificacao: string | null; faturada: boolean; cancelada: boolean; data_faturamento: string | null;
    outro_cliente: boolean;
    /** Para quem a OS de "outro cliente" aponta — nome e CNPJ, e não só o código. */
    cliente_os_nome: string | null; cliente_os_doc: string | null;
  }>;
  notas_sem_cobranca: Array<{ id: string; valor: number; descricao: string; vencimento: string; criado_em: string }>;
  correcoes: Array<{ origem: string; fonte: string | null; operador: string | null; quando: string; ok: boolean | null; escrito: any; motivo: string | null }>;
  brutos: { asaas: any[]; omie: any; receita: any };
}

// As mesmas listas de `bloqueioDeEmissao` na omie-nfse-sync — quem decide é ela.
const SEM_VOLTA = [
  "REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS",
  "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL", "DELETED",
];

/** O que a linha da cobrança oferece: a nota que já tem, ou o botão de emitir. */
function AcaoNotaDaCobranca({
  c, antesAtivo, emitir,
}: {
  c: Ficha["cobrancas"][number];
  antesAtivo: boolean;
  emitir: (ehConfirmada: boolean) => void;
}) {
  const tarefas = useTarefas();
  const st = String(c.status ?? "").toUpperCase();
  const n = c.nota;
  const rodando = tarefas.find((t) => t.estado === "rodando" && t.chave === `emitir:${c.id_asaas}`);

  if (rodando) {
    return (
      <button
        onClick={() => abrirTarefa(rodando.id)}
        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
      >
        <Loader2 className="h-3 w-3 animate-spin" /> emitindo…
      </button>
    );
  }
  if (n && (n.situacao === "tem_nota" || n.situacao === "no_forno")) {
    return <span className="text-[10px] text-emerald-700 dark:text-emerald-400">{n.rotulo}</span>;
  }
  if (SEM_VOLTA.includes(st)) return <span className="text-[10px] text-muted-foreground">sem nota · estornada</span>;

  const recebida = EMITIVEIS.includes(st);
  const confirmada = st === "CONFIRMED";
  if (!recebida && !confirmada && !antesAtivo) {
    return (
      <span
        className="text-[10px] text-muted-foreground"
        title="A nota sai depois que o dinheiro entra. Para emitir antes, libere “nota antes do pagamento” na linha da cobrança em Notas Fiscais."
      >
        sem nota · aguarda pagamento
      </span>
    );
  }
  return (
    <button
      onClick={() => emitir(confirmada && !antesAtivo)}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        recebida ? "border-primary/40 text-primary hover:bg-primary/10"
          : "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400",
      )}
      title={
        (n?.situacao === "recusada" ? "A nota anterior foi recusada pela prefeitura. " : "") +
        (n?.situacao === "os_aberta" ? `Há uma ${n.rotulo} no Omie; a emissão a reaproveita ou a aposenta se não bater. ` : "") +
        (recebida ? "Cobrança recebida: emite a NFS-e agora, em segundo plano."
          : confirmada ? "Cobrança confirmada e ainda não liquidada: emite como AVULSA, com o seu nome no registro."
          : "Cliente liberado para nota antes do pagamento.")
      }
    >
      <RefreshCw className="h-2.5 w-2.5" />
      {n?.situacao === "recusada" ? "Emitir de novo" : confirmada && !antesAtivo ? "Emitir (avulsa)" : "Emitir nota"}
    </button>
  );
}

const ORIGEM: Record<string, string> = {
  manual: "correção pela tela", automatico: "rodada automática", preventivo: "pré-voo",
  emissao: "conferência antes de emitir", edicao: "edição à mão", edicao_falhou: "edição sem efeito",
};

export function FichaCliente({
  busca, onFechar, onRefazer, onMudou, versao = 0,
}: {
  /** Uma emissão disparada daqui terminou — a tela de trás relê. */
  onMudou?: () => void;
  /** O que abrir: documento, nome, `pay_…` ou `cus_…`. `null` fecha; "" abre vazio. */
  busca: string | null;
  onFechar: () => void;
  /* A NOTA QUE FOI PARA OUTRA EMPRESA se refaz pelo MESMO ato da linha do painel
     (`RefazerNotaOmie` → `EmitirAgora`), montado na página. Um segundo caminho
     aqui dentro teria de reimplementar a corrente de emissão — e a primeira
     tentativa disso cancelava a nota errada sem emitir a certa. */
  onRefazer?: (linha: LinhaNota, tomadorErrado: TomadorErrado) => void;
  /** Muda quando uma emissão ou um refazer termina — a ficha aberta relê. */
  versao?: number;
}) {
  const [termo, setTermo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [candidatos, setCandidatos] = useState<Array<{ doc: string; nome: string; fonte: string }> | null>(null);
  const [verBrutos, setVerBrutos] = useState(false);

  const carregar = useCallback(async (q: string) => {
    const t = q.trim();
    if (!t) return;
    setCarregando(true);
    setCandidatos(null);
    try {
      const { data: d, error } = await sb.functions.invoke("omie-clientes-criar", {
        body: { action: "ficha_cliente", busca: t },
      });
      if (error || d?.status !== "ok") throw new Error(await mensagemDe(error, d));
      if (Array.isArray(d.candidatos)) {
        setFicha(null);
        setCandidatos(d.candidatos);
        if (!d.candidatos.length) toast.info("Nenhum cliente com esse nome no Asaas nem no Omie.");
        return;
      }
      setFicha(d as Ficha);
      setTermo(d.doc_formatado);
      // O endereço da tela passa a apontar para este cliente — é o link que se manda.
      const url = new URL(window.location.href);
      url.searchParams.set("cliente", d.doc);
      window.history.replaceState(null, "", url.toString());
    } catch (e: any) {
      toast.error("Não deu para abrir a ficha.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (busca === null) return;
    setFicha(null); setCandidatos(null); setVerBrutos(false);
    setTermo(busca);
    if (busca.trim()) void carregar(busca);
  }, [busca, carregar]);

  const fechar = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("cliente");
    window.history.replaceState(null, "", url.toString());
    onFechar();
  };

  const docAberto = ficha?.doc;
  useEffect(() => {
    if (versao && docAberto) void carregar(docAberto);
    // Só a mudança de `versao` relê; abrir outro cliente já relê pelo efeito de cima.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao]);

  const diverge = ficha?.comparacao.filter((l) => l.difere_asaas) ?? [];
  const outroCliente = ficha?.notas.filter((n) => n.outro_cliente && !n.cancelada) ?? [];

  /* O refazer é por cobrança: só a OS faturada, autorizada e com carimbo `pay_…`
     tem por onde. OS aberta de outro cliente não precisa de botão — a emissão a
     aposenta sozinha (`osNaoBateComACobranca`) e cria outra no cadastro certo. */
  const refazivel = (n: Ficha["notas"][number]) =>
    n.outro_cliente && !n.cancelada && n.faturada && n.nfse_status === "004" && !!n.nfse_numero
    && /^pay_[A-Za-z0-9]+$/.test(n.c_cod_int_os ?? "");

  /* EMITIR DAQUI MESMO (18/09/2026): a ficha é onde se vê que a cobrança está
     sem nota, e mandar a pessoa achá-la no mês certo do painel era um desvio.
     A confirmação diz a régua; a emissão roda em segundo plano, com a conferência
     do servidor de sempre — estorno e cobrança excluída barram lá, não aqui. */
  const emitirCobranca = (c: Ficha["cobrancas"][number], ehConfirmada: boolean) => {
    if (!ficha) return;
    const aviso =
      `Emitir a NFS-e de ${brl(c.valor)} para ${ficha.nome} (${ficha.doc_formatado})?\n\n` +
      `Cobrança ${c.id_asaas}, vencimento ${data(c.vencimento)}${c.descricao ? ` — ${c.descricao}` : ""}.\n\n` +
      (ehConfirmada
        ? "ATENÇÃO — a cobrança está CONFIRMADA: pagamento autorizado cuja liquidação ainda não caiu na conta. " +
          "Emitir agora é emissão AVULSA, registrada com o seu nome. Se não liquidar, a nota vira imposto sobre " +
          "receita que não existiu.\n\n"
        : "") +
      (c.nota?.situacao === "recusada" ? "A OS anterior, recusada pela prefeitura, é aposentada antes.\n\n" : "") +
      "Isto cria a Ordem de Serviço e fatura, o que emite a NFS-e de verdade. Nota emitida não se apaga — " +
      "cancela-se, com prazo e justificativa.";
    if (!window.confirm(aviso)) return;
    const doc = ficha.doc;
    const id = iniciarEmissao(
      {
        ids: [c.id_asaas],
        cobrancas: [{ id_asaas: c.id_asaas, nome: ficha.nome, valor: Number(c.valor) }],
        avulsa: ehConfirmada,
        osRecusadas: c.nota?.situacao === "recusada" && c.nota.n_cod_os ? [c.nota.n_cod_os] : undefined,
      },
      () => { void carregar(doc); onMudou?.(); },
    );
    abrirTarefa(id);
  };

  const refazer = (n: Ficha["notas"][number]) => {
    if (!ficha || !onRefazer) return;
    const id = n.c_cod_int_os as string;
    const cob = ficha.cobrancas.find((c) => c.id_asaas === id);
    onRefazer(
      {
        id_asaas: id, descricao: cob?.descricao ?? null, cliente_asaas: ficha.nome, cnpj_cpf: ficha.doc,
        valor: Number(cob?.valor ?? n.valor), data_vencimento: cob?.vencimento ?? null,
        data_pagamento: cob?.pagamento ?? null, status_asaas: cob?.status ?? null, estornado: false,
        nf_asaas_status: null, nf_asaas_numero: null, n_cod_os: n.n_cod_os, os_etapa: null, os_faturada: true,
        nfse_numero: n.nfse_numero, nfse_status: n.nfse_status, nfse_xml: null, nfse_chave: n.nfse_verificacao,
        nfse_mensagem: n.nfse_mensagem, situacao: "emitida_omie",
      },
      { codigo: n.n_cod_cli, nome: n.cliente_os_nome, doc: n.cliente_os_doc },
    );
  };

  return (
    <Sheet open={busca !== null} onOpenChange={(v) => !v && fechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="text-base">Ficha do cliente</SheetTitle>
          <SheetDescription className="text-xs">
            Asaas, Omie e Receita lado a lado. A nota fiscal sai com o que está no <strong>Omie</strong>.
          </SheetDescription>
        </SheetHeader>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); void carregar(termo); }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome, CNPJ/CPF, pay_… ou cus_…"
              className="h-8 pl-7 text-xs"
              autoFocus={!busca}
            />
          </div>
          <button
            type="submit"
            disabled={carregando || termo.trim().length < 3}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"
          >
            {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Abrir
          </button>
        </form>

        {candidatos && candidatos.length > 0 && (
          <div className="mt-3 divide-y divide-border rounded-md border border-border text-xs">
            {candidatos.map((c) => (
              <button
                key={c.doc}
                onClick={() => void carregar(c.doc)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
              >
                <span className="truncate font-medium">{c.nome || "—"}</span>
                <span className="num shrink-0 text-muted-foreground">{formatarDoc(c.doc)} · {c.fonte}</span>
              </button>
            ))}
          </div>
        )}

        {carregando && !ficha && (
          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lendo o Asaas, o Omie e a Receita…
          </p>
        )}

        {ficha && (
          <div className={cn("mt-4 space-y-4 text-xs", carregando && "opacity-60")}>
            {/* ---------------- cabeçalho ---------------- */}
            <section>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{ficha.nome}</p>
                  <p className="num text-[11px] text-muted-foreground">
                    {ficha.doc_formatado}
                    {ficha.id_customer ? ` · Asaas ${ficha.id_customer}` : " · sem cliente no Asaas"}
                    {ficha.codigos_omie.length
                      ? ` · Omie ${ficha.codigos_omie.join(", ")}`
                      : " · sem cadastro no Omie"}
                  </p>
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(window.location.href);
                    toast.success("Link da ficha copiado.");
                  }}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  <Link2 className="h-3 w-3" /> Copiar link
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ficha.receita?.situacao && (
                  <span className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    ficha.receita.situacao.toUpperCase() === "ATIVA"
                      ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                      : "border-destructive/40 text-destructive",
                  )}>
                    Receita: {ficha.receita.situacao}
                  </span>
                )}
                {ficha.codigos_omie.length > 1 && (
                  <span
                    className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
                    title="A nota usa o cadastro de MENOR código. Os outros são duplicados."
                  >
                    {ficha.codigos_omie.length} cadastros no Omie — a nota usa o {ficha.codigos_omie[0]}
                  </span>
                )}
                {ficha.antes_do_pagamento.filter((x) => x.ativo).map((x) => (
                  <span key={x.criado_em} className="rounded border border-sky-500/40 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-400" title={x.motivo}>
                    Nota antes do pagamento ({x.tipo})
                  </span>
                ))}
                {ficha.conferencia.map((c) => (
                  <span
                    key={c.id_customer}
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px]",
                      c.resultado === "falhou"
                        ? "border-destructive/40 text-destructive"
                        : "border-border text-muted-foreground",
                    )}
                    title={c.detalhe ?? undefined}
                  >
                    Endereço conferido {dataHora(c.sincronizado_em)} ({c.resultado}{c.tentativas ? `, ${c.tentativas} falha(s)` : ""})
                  </span>
                ))}
                {!ficha.asaas_ao_vivo && (
                  <span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                    Asaas não respondeu — mostrando o espelho
                  </span>
                )}
              </div>
            </section>

            {/* ---------------- os alertas ---------------- */}
            {outroCliente.length > 0 && (
              <p className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {outroCliente.length} OS de cobrança deste cliente aponta{outroCliente.length > 1 ? "m" : ""} para{" "}
                  <strong>
                    {[...new Set(outroCliente.map((n) => n.cliente_os_nome ?? `o cadastro ${n.n_cod_cli} do Omie`))].join(", ")}
                  </strong>{" "}
                  (OS {outroCliente.map((n) => n.c_num_os ?? n.n_cod_os).join(", ")}).
                  {outroCliente.some(refazivel)
                    ? " A nota já saiu para essa empresa — use “Reemitir para este cliente” na linha dela, abaixo."
                    : " Nota que sair dela vai para a empresa errada."}
                </span>
              </p>
            )}
            {ficha.erro_leitura_omie && (
              <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                O Omie não respondeu a leitura do cadastro ({ficha.erro_leitura_omie}). Abra de novo em alguns segundos.
              </p>
            )}
            {diverge.length > 0 && (
              <p className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-amber-800 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  O Omie diverge do Asaas em: <strong>{diverge.map((l) => l.rotulo.toLowerCase()).join(", ")}</strong>.
                  Antes de emitir, o Hub atualiza o endereço do Omie com o do Asaas; nome e razão social se corrigem em
                  "Editar cadastro à mão", abaixo.
                </span>
              </p>
            )}

            {/* ---------------- a comparação ---------------- */}
            <section className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Campo</th>
                    <th className="p-2 font-medium">Asaas</th>
                    <th className="p-2 font-medium text-foreground">Omie · vai na nota</th>
                    <th className="p-2 font-medium">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {ficha.comparacao.map((l) => (
                    <tr key={l.campo} className={cn("border-t border-border", l.difere_asaas && "bg-amber-500/10")}>
                      <td className="p-2 text-muted-foreground">{l.rotulo}</td>
                      <td className="p-2">{l.asaas ?? <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="p-2 font-medium text-foreground">
                        {l.omie ?? <span className="font-normal italic text-muted-foreground/60">vazio</span>}
                      </td>
                      <td className={cn("p-2", l.difere_receita && "text-amber-700 dark:text-amber-400")}>
                        {l.receita ?? <span className="text-muted-foreground/50">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {ficha.cobrancas.length > 0 && !ficha.erro_leitura_omie ? (
              <EditarCadastroCliente
                cliente={{
                  doc: ficha.doc, nome: ficha.nome, n_cod_cli: ficha.n_cod_cli,
                  id_customer: ficha.id_customer ?? "", omie: ficha.omie, asaas: ficha.asaas,
                }}
                ids={ficha.cobrancas.map((c) => c.id_asaas)}
                onGravado={() => void carregar(ficha.doc)}
              />
            ) : (
              <p className="text-[11px] text-muted-foreground">
                A edição à mão precisa de pelo menos uma cobrança deste cliente no Asaas.
              </p>
            )}

            {/* ---------------- notas / OS ---------------- */}
            <section>
              <p className="mb-1.5 font-semibold text-foreground">Notas e ordens de serviço no Omie</p>
              {ficha.notas.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma OS deste cliente no espelho.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {ficha.notas.map((n) => {
                        const link = linkPortalNacional(n.nfse_verificacao);
                        const situacao = n.cancelada
                          ? (n.nfse_numero ? "cancelada" : "aposentada")
                          : n.faturada
                          ? (n.nfse_status === "004" ? "autorizada" : n.nfse_status === "003" ? "recusada" : "no forno")
                          : "OS aberta";
                        return (
                          <tr key={n.n_cod_os} className={cn("border-t border-border first:border-0", n.outro_cliente && !n.cancelada && "bg-destructive/10")}>
                            <td className="p-2">
                              {n.nfse_numero ? (
                                link ? (
                                  <a href={link} target="_blank" rel="noreferrer" className={cn("num font-medium text-primary hover:underline", n.cancelada && "line-through")}>
                                    NFS-e {n.nfse_numero}
                                  </a>
                                ) : <span className={cn("num font-medium", n.cancelada && "line-through")}>NFS-e {n.nfse_numero}</span>
                              ) : <span className="num text-muted-foreground">OS {n.c_num_os ?? n.n_cod_os}</span>}
                            </td>
                            <td className="num p-2 text-right">{brl(Number(n.valor))}</td>
                            <td className="p-2">{data(n.data_faturamento)}</td>
                            <td className="p-2" title={n.nfse_mensagem ?? undefined}>{situacao}</td>
                            <td className="num p-2 text-muted-foreground">{n.c_cod_int_os ?? "—"}</td>
                            <td className="p-2">
                              {n.outro_cliente && (
                                <span
                                  className={cn("block", n.cancelada ? "text-muted-foreground" : "text-destructive")}
                                  title={`A OS aponta para o cadastro ${n.n_cod_cli} do Omie, que não é deste documento.`}
                                >
                                  {n.cliente_os_nome ?? `outro cliente (${n.n_cod_cli})`}
                                  {n.cliente_os_doc && (
                                    <span className="num block text-[10px] opacity-80">{formatarDoc(n.cliente_os_doc)}</span>
                                  )}
                                </span>
                              )}
                              {refazivel(n) && onRefazer && (
                                <button
                                  onClick={() => refazer(n)}
                                  className="mt-1 flex items-center gap-1 rounded border border-destructive/40 px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10"
                                  title={
                                    `Cancela a NFS-e ${n.nfse_numero} no Omie e na prefeitura e emite a certa para ${ficha.nome}, ` +
                                    "na mesma cobrança. Antes de qualquer coisa, a tela mostra as duas empresas e o valor de agora."
                                  }
                                >
                                  <RefreshCw className="h-2.5 w-2.5" /> Reemitir para este cliente
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ---------------- cobranças ---------------- */}
            <section>
              <p className="mb-1.5 font-semibold text-foreground">Cobranças recentes no Asaas</p>
              {ficha.cobrancas.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma cobrança deste cliente no espelho.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {ficha.cobrancas.map((c) => (
                        <tr key={c.id_asaas} className="border-t border-border first:border-0">
                          <td className="num p-2 text-muted-foreground">{c.id_asaas}</td>
                          <td className="num p-2 text-right">{brl(c.valor)}</td>
                          <td className="p-2">venc. {data(c.vencimento)}</td>
                          <td className="p-2">{statusAsaas(c.status).rotulo}</td>
                          <td className="max-w-[220px] truncate p-2 text-muted-foreground" title={c.descricao ?? undefined}>{c.descricao ?? "—"}</td>
                          <td className="whitespace-nowrap p-2 text-right">
                            <AcaoNotaDaCobranca
                              c={c}
                              antesAtivo={ficha.antes_do_pagamento.some((x) => x.ativo)}
                              emitir={(ehConfirmada) => emitirCobranca(c, ehConfirmada)}
                            />
                          </td>
                          <td className="p-2">
                            {c.link && (
                              <a href={c.link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" title="Abrir a fatura no Asaas">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ficha.notas_sem_cobranca.length > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Notas sem cobrança pedidas: {ficha.notas_sem_cobranca.map((n) => `${brl(Number(n.valor))} em ${dataHora(n.criado_em)}`).join(" · ")}
                </p>
              )}
            </section>

            {/* ---------------- histórico ---------------- */}
            {ficha.correcoes.length > 0 && (
              <section>
                <p className="mb-1.5 font-semibold text-foreground">Mudanças no cadastro feitas pelo Hub</p>
                <ul className="space-y-1">
                  {ficha.correcoes.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px]">
                      {c.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> : <span className="mt-0.5 h-3 w-3 shrink-0" />}
                      <span>
                        <span className="text-muted-foreground">{dataHora(c.quando)}</span> · {ORIGEM[c.origem] ?? c.origem}
                        {c.operador ? ` · ${c.operador}` : ""}
                        {c.ok && c.escrito
                          ? ` — gravou ${Object.keys(c.escrito).filter((k) => k !== "codigo_cliente_omie").join(", ")}`
                          : c.motivo ? ` — ${c.motivo}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ---------------- tudo ---------------- */}
            <section>
              <button
                onClick={() => setVerBrutos((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", verBrutos && "rotate-180")} />
                Todos os campos, como cada sistema devolve
              </button>
              {verBrutos && (
                <div className="mt-2 grid gap-2 lg:grid-cols-3">
                  {(["asaas", "omie", "receita"] as const).map((k) => (
                    <div key={k} className="min-w-0">
                      <p className="mb-1 text-[11px] font-medium capitalize">{k}</p>
                      <pre className="max-h-80 overflow-auto rounded border border-border bg-muted/40 p-2 text-[10px] leading-snug">
                        {JSON.stringify(ficha.brutos[k], null, 2) ?? "—"}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
