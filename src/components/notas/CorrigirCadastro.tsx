/* ---------------------------------------------------------------------------
 * Consertar o cadastro que trava a nota — no Omie, no Asaas, e reemitir.
 *
 * O CAMINHO QUE FALTAVA. Quando o `FaturarLoteOS` recusa com "Para emitir a
 * NFS-e falta preencher o Número do Endereço", a emissão morre e o conserto
 * estava fora do Hub: abrir o Omie, achar o cliente, digitar o número, voltar,
 * reemitir. Em 26/08/26 isso eram 15 clientes e R$ 6.083 de receita recebida sem
 * nota — e o mesmo trabalho de novo no mês seguinte, porque o cadastro do Asaas
 * (que é a origem) continuava torto.
 *
 * TRÊS DECISÕES DE DESENHO, e todas vêm do mesmo lugar: isto escreve em cadastro
 * de terceiro, nos dois sistemas.
 *
 *   • O DIFF ANTES DO BOTÃO. Cada campo aparece com o que está lá e o que
 *     entraria, e "(vazio)" tem destaque próprio: preencher buraco não desfaz
 *     decisão de ninguém, sobrescrever valor diferente pode. Quem clica viu.
 *   • O ENDEREÇO NÃO VEM DO ASAAS, vem da Receita (CNPJ) ou do CEP. Foi o Asaas
 *     que produziu a fila de notas presas em E0240 — copiar dele seria fabricar
 *     a próxima. A fonte fica escrita em cada linha.
 *   • CORRIGIR E REEMITIR SÃO DOIS PASSOS. Emitir nota fiscal é ato que não se
 *     apaga; juntar os dois num clique só faria a correção arrastar a emissão
 *     junto, sem ninguém conferir se o cadastro ficou como devia.
 *
 * O que este componente NÃO resolve, e diz na cara: OS já faturada. Aí a nota
 * saiu do nosso alcance (o Omie só a deixa ir para a etapa 60) e não existe
 * reenvio pela API — é o botão "Reenviar NFS-e" da tela do Omie.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, RefreshCw, Building2, CheckCircle2, TriangleAlert, ArrowRight, Send, Lock,
} from "lucide-react";

const sb = supabase as any;

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CAMPO: Record<string, string> = {
  endereco: "Logradouro", endereco_numero: "Número", complemento: "Complemento",
  bairro: "Bairro", cidade: "Cidade", estado: "UF", cep: "CEP",
};

/** De onde saiu o endereço proposto — e por que isso importa na linha. */
const FONTE: Record<string, { rotulo: string; ajuda: string }> = {
  receita: { rotulo: "Receita Federal", ajuda: "Endereço oficial do CNPJ (BrasilAPI /cnpj). É o mais coerente com o que a prefeitura valida." },
  cep: { rotulo: "CEP", ajuda: "Consulta do CEP (BrasilAPI /cep). Um CEP pertence a exatamente um município — é o par que o erro E0240 recusa." },
  asaas: { rotulo: "Asaas", ajuda: "As duas consultas caíram; vale o que o Asaas tem, e só porque está completo." },
};

interface Cobranca {
  id_asaas: string; valor: number; status: string | null;
  n_cod_os: number | null; c_num_os: string | null;
  etapa: string | null; faturada: boolean | null;
  nfse_status: string | null; nfse_numero: string | null;
  reemitivel: boolean; motivo: string | null; resultado: string | null;
}
interface LinhaDiff { campo: string; de: string; para: string; vazio: boolean; muda: boolean }
interface ClienteDiag {
  doc: string; nome: string; id_customer: string; n_cod_cli: number | null;
  pessoa_fisica: boolean; cobrancas: Cobranca[];
  sem_cadastro_omie: boolean; erro_leitura_omie: string | null;
  omie: Record<string, string> | null;
  asaas: Record<string, string | null>;
  proposta: { fonte: string; razao_social: string; situacao_receita?: string } | null;
  bloqueio: string | null;
  diff: LinhaDiff[]; diff_asaas: LinhaDiff[];
}

/** O que dá para consertar sozinho: tem proposta, tem cadastro no Omie, e há o que mudar. */
const consertavel = (c: ClienteDiag) =>
  !!c.proposta && !c.bloqueio && !c.erro_leitura_omie && !c.sem_cadastro_omie && c.diff.some((l) => l.muda);

export function CorrigirCadastro({
  ids, aberto, onFechar, onFeito,
}: {
  /** As cobranças travadas que se quer destravar. */
  ids: string[];
  aberto: boolean;
  onFechar: () => void;
  /** Chamado depois de corrigir ou reemitir, para a tela de trás recarregar. */
  onFeito: () => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [clientes, setClientes] = useState<ClienteDiag[]>([]);
  const [trabalhando, setTrabalhando] = useState<string | null>(null);
  const [corrigidos, setCorrigidos] = useState<Set<string>>(new Set());
  const [emitindo, setEmitindo] = useState(false);

  const diagnosticar = useCallback(async () => {
    if (!ids.length) return;
    setCarregando(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
        body: { action: "diagnostico", ids },
      });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      setClientes((data?.clientes ?? []) as ClienteDiag[]);
    } catch (e: any) {
      toast.error("Não foi possível ler os cadastros.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, [ids]);

  useEffect(() => { if (aberto) { setCorrigidos(new Set()); void diagnosticar(); } }, [aberto, diagnosticar]);

  /* A escrita, um cliente por chamada — é assim que a Edge Function aceita, e é
     de propósito: "corrija todos" sem nomear ninguém é o pedido que cria
     duplicado e emite para o tomador errado. */
  const corrigir = async (c: ClienteDiag, alvos: ("omie" | "asaas")[]) => {
    setTrabalhando(c.doc);
    try {
      const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
        body: { action: "corrigir_cadastro", doc: c.doc, alvos, ids: c.cobrancas.map((x) => x.id_asaas) },
      });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      const r = data?.resultado ?? {};
      const falhou = alvos.filter((a) => r[a] && r[a].ok === false);
      if (falhou.length) {
        toast.error(`${c.nome}: ${falhou.map((a) => `${a} não aceitou`).join(" e ")}.`, {
          description: falhou.map((a) => r[a].motivo).join(" · "), duration: 12000,
        });
      } else {
        setCorrigidos((s) => new Set(s).add(c.doc));
        toast.success(`${c.nome}: cadastro corrigido em ${alvos.join(" e ")}.`, {
          description: `Endereço lido de ${FONTE[data?.fonte]?.rotulo ?? data?.fonte}.`,
        });
      }
      onFeito();
    } catch (e: any) {
      toast.error(`Falha ao corrigir ${c.nome}.`, { description: e?.message });
    } finally {
      setTrabalhando(null);
    }
  };

  /* Corrigir a leva: a mesma chamada de um em um, em sequência. O que autoriza é
     que os diffs estão TODOS na tela acima do botão — não é escrita cega, é a
     mesma decisão tomada uma vez para uma lista que se leu. */
  const corrigirTodos = async () => {
    const alvo = clientes.filter((c) => consertavel(c) && !corrigidos.has(c.doc));
    if (!alvo.length) return;
    if (!window.confirm(
      `Corrigir o endereço de ${alvo.length} cliente(s) no Omie?\n\n` +
      "Cada um recebe o que a Receita/CEP devolveu, escrito por cima do cadastro atual — " +
      "só os campos de endereço listados acima.\n\nO Asaas não é tocado por aqui; " +
      "para ele, use o botão de cada cliente.",
    )) return;
    for (const c of alvo) await corrigir(c, ["omie"]);
  };

  /** Reemitir: só o que ainda dá, e com o aviso de sempre. */
  const reemitir = async () => {
    const alvo = clientes
      .filter((c) => corrigidos.has(c.doc))
      .flatMap((c) => c.cobrancas.filter((x) => x.reemitivel).map((x) => x.id_asaas));
    if (!alvo.length) { toast.info("Nada a reemitir: corrija algum cadastro antes."); return; }
    if (!window.confirm(
      `Reemitir ${alvo.length} nota(s)?\n\n` +
      "Isto fatura as Ordens de Serviço no Omie, o que emite a NFS-e de verdade. " +
      "Nota emitida não se apaga — cancela-se, com prazo e justificativa.",
    )) return;

    setEmitindo(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "emitir", ids: alvo } });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      const emProcesso = (data.resultados ?? []).filter((r: any) => r.em_processamento).length;
      const falhas = (data.resultados ?? []).filter((r: any) => !r.ok && !r.em_processamento && !r.bloqueado);
      if (emProcesso) {
        toast.success(`${emProcesso} cobrança(s) mandadas para o lote ${data?.lote ?? "?"}.`, {
          description: "A nota nasce em alguns minutos. Não emita de novo — o Registro fecha sozinho no próximo Atualizar do Omie.",
          duration: 12000,
        });
      }
      if (falhas.length) {
        toast.error(`${falhas.length} não entraram no lote.`, {
          description: falhas.slice(0, 2).map((r: any) => r.erro).join(" · "), duration: 14000,
        });
      }
      onFeito();
    } catch (e: any) {
      toast.error("Falha ao reemitir.", { description: e?.message });
    } finally {
      setEmitindo(false);
    }
  };

  const aCorrigir = clientes.filter((c) => consertavel(c) && !corrigidos.has(c.doc)).length;
  const prontoParaEmitir = clientes
    .filter((c) => corrigidos.has(c.doc))
    .flatMap((c) => c.cobrancas.filter((x) => x.reemitivel)).length;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />
            Cadastro do cliente — o que trava a nota
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            O endereço proposto vem da <strong>Receita Federal</strong> (CNPJ) ou da consulta de{" "}
            <strong>CEP</strong>, nunca do Asaas — foi o dado do Asaas que produziu a fila de notas
            recusadas por município. A escrita é por cima do cadastro atual: só os campos abaixo.
          </DialogDescription>
        </DialogHeader>

        {carregando && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lendo o Omie, o Asaas e a Receita…
          </div>
        )}

        {!carregando && clientes.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Nenhum cadastro para conferir nesta seleção.
          </p>
        )}

        {!carregando && clientes.map((c) => {
          const feito = corrigidos.has(c.doc);
          const muda = c.diff.filter((l) => l.muda);
          const mudaAsaas = c.diff_asaas.filter((l) => l.muda);
          const valor = c.cobrancas.reduce((s, x) => s + Number(x.valor ?? 0), 0);
          const travadas = c.cobrancas.filter((x) => !x.reemitivel);

          return (
            <div key={c.doc} className={cn(
              "rounded-lg border p-3",
              feito ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card",
            )}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {feito && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                    <span className="truncate text-sm font-medium text-foreground">{c.nome}</span>
                  </div>
                  <div className="num text-[10px] text-muted-foreground">
                    {c.doc}
                    {c.n_cod_cli ? ` · Omie ${c.n_cod_cli}` : ""}
                    {" · "}{c.cobrancas.length} cobrança(s) · {brl(valor)}
                  </div>
                </div>
                {c.proposta && (
                  <span
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title={FONTE[c.proposta.fonte]?.ajuda}
                  >
                    fonte: {FONTE[c.proposta.fonte]?.rotulo ?? c.proposta.fonte}
                  </span>
                )}
              </div>

              {/* O motivo, como o Omie escreveu. É ele que diz o que consertar. */}
              {c.cobrancas[0]?.motivo && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {c.cobrancas[0].motivo}
                </p>
              )}

              {/* Os casos em que não há botão — e o porquê, que é o que vale. */}
              {c.erro_leitura_omie && (
                <p className="mt-2 flex items-start gap-1.5 rounded border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  Não deu para ler o cadastro atual no Omie ({c.erro_leitura_omie}). Nada foi comparado —
                  feche e abra de novo em alguns segundos.
                </p>
              )}
              {c.sem_cadastro_omie && (
                <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                  Este cliente não tem cadastro no Omie. O conserto aqui é <strong>criar</strong>, não corrigir —
                  use a aba Auditoria, que cadastra pelo mesmo endereço da Receita.
                </p>
              )}
              {c.bloqueio && (
                <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
                  Sem endereço confiável para escrever: <span className="num">{c.bloqueio}</span>.
                  Corrigir no Omie exigiria digitar o endereço à mão.
                </p>
              )}

              {/* O diff. "(vazio)" com peso próprio: preencher buraco é seguro,
                  sobrescrever valor diferente é decisão. */}
              {muda.length > 0 && (
                <table className="mt-2 w-full text-[11px]">
                  <tbody>
                    {muda.map((l) => (
                      <tr key={l.campo} className="border-b border-border/40 last:border-0">
                        <td className="w-28 py-1 text-muted-foreground">{CAMPO[l.campo] ?? l.campo}</td>
                        <td className={cn("py-1", l.vazio ? "italic text-muted-foreground/60" : "text-foreground")}>
                          {l.de}
                        </td>
                        <td className="w-6 py-1 text-center text-muted-foreground">
                          <ArrowRight className="mx-auto h-3 w-3" />
                        </td>
                        <td className="py-1 font-medium text-emerald-700 dark:text-emerald-400">{l.para}</td>
                        <td className="w-24 py-1 text-right text-[10px] text-muted-foreground">
                          {l.vazio ? "estava em branco" : "substitui"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!muda.length && !c.erro_leitura_omie && !c.sem_cadastro_omie && c.proposta && (
                <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                  O cadastro do Omie <strong>já bate</strong> com a Receita/CEP — não há campo a corrigir daqui,
                  e mesmo assim a nota não saiu. Ou o endereço está formalmente completo e materialmente errado
                  (logradouro preenchido com o nome da cidade, número "00"), ou a recusa é da prefeitura e não do
                  cadastro. Este é caso de olhar um a um.
                </p>
              )}

              {/* A OS já faturada não volta: dizer isso aqui evita o clique que
                  o Omie recusaria com "pode ser alterado apenas para as etapas: 60". */}
              {travadas.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                  {travadas.length === c.cobrancas.length ? "A OS" : `${travadas.length} OS`}
                  {" "}já está faturada no Omie ({travadas.map((x) => x.c_num_os).join(", ")}) com o RPS recusado.
                  Corrigir o cadastro aqui adianta as próximas, mas esta nota só sai pelo
                  botão <strong>"Reenviar NFS-e"</strong> da tela do Omie — não existe reenvio pela API.
                </p>
              )}

              {/* Os botões. Omie e Asaas separados porque frequentemente só um
                  dos dois está errado — o número costuma existir no Asaas e
                  faltar no ERP. */}
              {consertavel(c) && !feito && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => corrigir(c, ["omie"])}
                    disabled={trabalhando === c.doc}
                    className="flex items-center gap-1.5 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-50"
                  >
                    {trabalhando === c.doc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Building2 className="h-3 w-3" />}
                    Corrigir no Omie
                  </button>
                  {mudaAsaas.length > 0 && (
                    <button
                      onClick={() => corrigir(c, ["omie", "asaas"])}
                      disabled={trabalhando === c.doc}
                      className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                      title={
                        "Escreve o mesmo endereço nos dois sistemas. O Asaas é a ORIGEM do dado: " +
                        "sem consertar lá, o mesmo cliente volta torto na próxima cobrança.\n\n" +
                        `No Asaas mudaria: ${mudaAsaas.map((l) => `${CAMPO[l.campo] ?? l.campo} ${l.de} → ${l.para}`).join(" · ")}`
                      }
                    >
                      Corrigir no Omie e no Asaas ({mudaAsaas.length} campo{mudaAsaas.length > 1 ? "s" : ""})
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ------------------------- os dois passos ------------------------- */}
        {!carregando && clientes.length > 0 && (
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center gap-2 border-t border-border bg-card px-6 py-3">
            <button
              onClick={diagnosticar}
              disabled={!!trabalhando || emitindo}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" /> Reler
            </button>
            {aCorrigir > 0 && (
              <button
                onClick={corrigirTodos}
                disabled={!!trabalhando}
                className="flex items-center gap-1.5 rounded border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {trabalhando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Building2 className="h-3 w-3" />}
                Corrigir no Omie os {aCorrigir} acima
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {corrigidos.size > 0
                  ? `${corrigidos.size} corrigido(s) · ${prontoParaEmitir} nota(s) a reemitir`
                  : "Corrija o cadastro antes de reemitir"}
              </span>
              <button
                onClick={reemitir}
                disabled={emitindo || prontoParaEmitir === 0}
                className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-40 dark:text-emerald-400"
              >
                {emitindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Reemitir {prontoParaEmitir || ""}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
