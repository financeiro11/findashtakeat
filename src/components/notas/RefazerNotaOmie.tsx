/* ---------------------------------------------------------------------------
 * REFAZER A NOTA DO OMIE — uma tela, em vez de três sistemas.
 *
 * O CASO QUE ORIGINOU ISTO (AEVO, 15/09/2026). A NFS-e 20274 saiu com o
 * endereço antigo do tomador e com o valor que a cobrança tinha antes de ser
 * editada no Asaas. O caminho para consertar era: cancelar a nota na tela do
 * Omie, criar outra cobrança no Asaas (porque o Omie não aceita reusar o
 * carimbo `pay_…`), excluir a antiga lá, completar o endereço no Asaas, voltar
 * ao Hub para corrigir o cadastro no Omie e, por fim, emitir. Três sistemas,
 * seis passos, e uma cobrança duplicada no meio do caminho.
 *
 * O QUE MUDOU É QUE O OMIE CANCELA POR API — em `servicos/osp`, que a varredura
 * de 25/08 não tinha olhado — e também troca o carimbo de uma OS. Com isso o
 * Hub faz tudo na MESMA cobrança: corrige o cadastro com o do Asaas, solta o
 * carimbo, cancela a nota velha na prefeitura e entrega a emissão da certa ao
 * `EmitirAgora`. Ver `refazerNotaOmie` na omie-nfse-sync.
 *
 * A ORDEM DOS PASSOS NA TELA É A MESMA DO RISCO: o cadastro vem primeiro porque
 * se desfaz; o cancelamento vem depois porque não; e a emissão só começa com o
 * cancelamento CONFIRMADO no Omie — emitir a substituta com a velha de pé faria
 * duas notas se a prefeitura recusasse o cancelamento.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RefreshCw, ArrowRight, TriangleAlert, CheckCircle2, Hourglass } from "lucide-react";
import { EditarCadastroCliente, type ClienteEditavel } from "./EditarCadastroCliente";
import { formatarDoc, type LinhaNota } from "@/lib/notasFiscais";

const sb = supabase as any;

const brlStr = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataStr = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

const CAMPO: Record<string, string> = {
  endereco: "Logradouro", endereco_numero: "Número", complemento: "Complemento",
  bairro: "Bairro", cidade: "Cidade", estado: "UF", cep: "CEP", cidade_ibge: "Cód. município",
};

/** O corpo de erro da Edge Function — o `invoke` o esconde atrás de um 400 genérico. */
async function mensagemDe(error: any, data: any): Promise<string> {
  if (data?.erro) return String(data.erro);
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.erro) return String(corpo.erro);
  } catch { /* sem corpo legível */ }
  return error?.message ?? "Erro sem mensagem.";
}

interface LinhaDiff { campo: string; de: string; para: string; vazio: boolean; muda: boolean }
interface Diagnostico extends ClienteEditavel {
  sem_cadastro_omie: boolean;
  erro_leitura_omie: string | null;
  proposta: { fonte: string } | null;
  bloqueio: string | null;
  diff: LinhaDiff[];
}

type Fase = "lendo" | "pronto" | "cadastro" | "cancelando" | "em_andamento";

export function RefazerNotaOmie({
  linha, linhas, onFechar, onEmitir, onRecarregar,
}: {
  /** A linha da nota a refazer; `null` fecha o diálogo. */
  linha: LinhaNota | null;
  /** As linhas do mês — é nelas que se procura a cobrança substituta. */
  linhas: LinhaNota[];
  onFechar: () => void;
  /** Cancelada a velha, a emissão da certa segue pelo `EmitirAgora`. */
  onEmitir: (id: string, observacao: string) => void;
  /** Cancelou sem ter por onde emitir: a tela de trás relê. */
  onRecarregar: () => void;
}) {
  const [fase, setFase] = useState<Fase>("lendo");
  /* A cobrança da nota foi EXCLUÍDA no Asaas — quem já tentou consertar por fora
     criou outra e apagou esta. A nota velha cai do mesmo jeito; a certa sai pela
     cobrança nova, se ela estiver na lista. */
  const [excluida, setExcluida] = useState(false);
  const [valorAgora, setValorAgora] = useState<number | null>(null);
  const [vencimentoAgora, setVencimentoAgora] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [observacao, setObservacao] = useState("");
  const [recado, setRecado] = useState<string | null>(null);

  const id = linha?.id_asaas ?? "";

  const lerCadastro = useCallback(async () => {
    const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
      body: { action: "diagnostico", ids: [id] },
    });
    if (error || data?.erro) throw new Error(await mensagemDe(error, data));
    setDiag(((data?.clientes ?? [])[0] ?? null) as Diagnostico | null);
  }, [id]);

  /* AO ABRIR, as duas leituras que decidem se vale refazer: quanto a cobrança
     vale AGORA no Asaas (o espelho pode ser de horas atrás — foi assim que a
     20274 saiu com R$ 14.880) e o que muda no cadastro do tomador. */
  useEffect(() => {
    if (!linha) return;
    setFase("lendo"); setDiag(null); setValorAgora(null); setVencimentoAgora(null); setExcluida(false);
    setJustificativa(""); setObservacao(""); setRecado(null);
    (async () => {
      const [cob, cad] = await Promise.allSettled([
        sb.functions.invoke("asaas-sync", { body: { action: "cobranca", id: linha.id_asaas } }),
        lerCadastro(),
      ]);
      if (cob.status === "fulfilled") {
        const achada = (cob.value?.data?.achadas ?? []).find((a: any) => a.id_asaas === linha.id_asaas);
        if (achada) {
          setValorAgora(Number(achada.valor));
          setVencimentoAgora(achada.data_vencimento ?? null);
          setExcluida(achada.excluida === true);
        }
      }
      if (cad.status === "rejected") {
        toast.error("Não deu para ler o cadastro do tomador.", { description: String(cad.reason?.message ?? cad.reason) });
      }
      setFase("pronto");
    })();
  }, [linha, lerCadastro]);

  if (!linha) return null;

  const muda = (diag?.diff ?? []).filter((l) => l.muda);
  /* A SUBSTITUTA: mesmo cliente, mesmo valor, e sem nota nem OS de nenhum dos
     dois emissores. Mais de uma candidata não se escolhe — fica sem, e a pessoa
     emite pela lista. Errar para menos custa um clique; para mais, uma nota na
     cobrança errada. */
  const candidatas = excluida
    ? linhas.filter((x) =>
        x.cnpj_cpf === linha.cnpj_cpf && x.id_asaas !== linha.id_asaas
        && !x.nfse_numero && !x.nf_asaas_numero && !x.n_cod_os
        && Math.abs(Number(x.valor) - Number(valorAgora ?? linha.valor)) < 0.005)
    : [];
  const substituta = candidatas.length === 1 ? candidatas[0] : null;
  const mudouValor = valorAgora != null && Math.abs(valorAgora - Number(linha.valor)) > 0.005;
  const ocupado = fase === "lendo" || fase === "cadastro" || fase === "cancelando";

  const executar = async () => {
    if (!justificativa.trim()) {
      toast.error("Escreva por que a nota está sendo refeita.", { description: "O Omie não guarda motivo; o diário do Hub guarda." });
      return;
    }
    if (fase !== "em_andamento" && !window.confirm(
      `Cancelar a NFS-e ${linha.nfse_numero} no Omie e na prefeitura?\n\n` +
      "O cancelamento não tem volta. " +
      (!excluida
        ? "Confirmado, o Hub emite a nota certa nesta mesma cobrança" +
          (valorAgora != null ? `, no valor de ${brlStr(valorAgora)}` : "") + "."
        : substituta
        ? `Confirmado, o Hub emite a nota certa pela cobrança nova ${substituta.id_asaas} (${brlStr(Number(substituta.valor))}).`
        : "A cobrança desta nota foi excluída no Asaas e não há uma substituta clara na lista — nada será emitido agora."),
    )) return;

    try {
      /* 1) CADASTRO — primeiro, porque se desfaz. Só quando há o que mudar e o
            endereço proposto é confiável; falhar aqui para tudo antes de cancelar. */
      if (fase !== "em_andamento" && diag && !diag.bloqueio && !diag.sem_cadastro_omie && !diag.erro_leitura_omie && muda.length) {
        setFase("cadastro");
        const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
          body: { action: "corrigir_cadastro", doc: diag.doc, alvos: ["omie"], ids: [id] },
        });
        const om = data?.resultado?.omie;
        if (error || data?.erro || (om && om.ok === false && !om.nada_a_propor)) {
          throw new Error(`Cadastro não corrigido — nada foi cancelado. ${error || data?.erro ? await mensagemDe(error, data) : om?.motivo ?? ""}`);
        }
      }

      /* 2) CANCELAR — no Omie e na prefeitura, e só vale confirmado. */
      setFase("cancelando");
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
        body: { action: "refazer_omie", id, justificativa: justificativa.trim() },
      });
      if (error || data?.erro) throw new Error(await mensagemDe(error, data));

      if (data?.cancelamento_em_andamento) {
        setFase("em_andamento");
        setRecado(String(data.recado ?? "O cancelamento foi pedido e ainda não foi confirmado."));
        return;
      }

      /* 3) EMITIR — a corrente de sempre, com o cadastro já corrigido e a
            cobrança livre do carimbo da nota velha (ou pela substituta). */
      if (data?.cobranca_excluida) {
        if (substituta) {
          toast.success(`NFS-e ${linha.nfse_numero} cancelada.`, { description: `Emitindo a nota certa pela cobrança ${substituta.id_asaas}…` });
          onEmitir(substituta.id_asaas, observacao.trim());
        } else {
          toast.success(`NFS-e ${linha.nfse_numero} cancelada.`, {
            description: "A cobrança dela foi excluída no Asaas. Traga a cobrança nova com “Atualizar do Asaas” e emita por ela.",
            duration: 14000,
          });
          onRecarregar();
          onFechar();
        }
        return;
      }
      toast.success(`NFS-e ${linha.nfse_numero} cancelada.`, { description: "Emitindo a nota certa nesta cobrança…" });
      onEmitir(id, observacao.trim());
    } catch (e: any) {
      setFase("pronto");
      toast.error("O refazer parou.", { description: e?.message, duration: 14000 });
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !ocupado && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4 text-primary" />
            Refazer a nota {linha.nfse_numero}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            O Hub corrige o cadastro do tomador com o do Asaas, cancela esta nota no Omie e na prefeitura e emite
            a certa <strong>nesta mesma cobrança</strong>. Não é preciso abrir o Omie nem o Asaas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          {/* A COBRANÇA — o valor que a nota nova vai levar. */}
          <section className="rounded-lg border border-border p-3">
            <p className="font-semibold text-foreground">{linha.cliente_asaas ?? "—"}</p>
            <p className="num text-[11px] text-muted-foreground">{formatarDoc(linha.cnpj_cpf)} · {linha.id_asaas}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {fase === "lendo" ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Lendo a cobrança no Asaas…
                </span>
              ) : valorAgora == null ? (
                <span className="text-amber-700 dark:text-amber-400">
                  Não deu para conferir o valor no Asaas agora — a emissão confere de novo antes de sair.
                </span>
              ) : (
                <span className={cn(mudouValor && "font-medium text-amber-700 dark:text-amber-400")}>
                  Nota nova: <span className="num">{brlStr(valorAgora)}</span>, vencimento {dataStr(vencimentoAgora)}
                  {mudouValor && <> (a tela mostrava <span className="num">{brlStr(Number(linha.valor))}</span> — já atualizado)</>}
                </span>
              )}
            </div>
            {excluida && (
              <p className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                {substituta ? (
                  <span>
                    Esta cobrança foi <strong>excluída no Asaas</strong>. A nota {linha.nfse_numero} é cancelada e a certa sai pela
                    cobrança nova <span className="num">{substituta.id_asaas}</span> ({brlStr(Number(substituta.valor))}, vencimento{" "}
                    {dataStr(substituta.data_vencimento)}).
                  </span>
                ) : (
                  <span>
                    Esta cobrança foi <strong>excluída no Asaas</strong>, e a lista {candidatas.length > 1 ? `tem ${candidatas.length} cobranças sem nota deste cliente com o mesmo valor` : "não tem outra cobrança sem nota deste cliente com o mesmo valor"}.
                    O Hub cancela a nota {linha.nfse_numero}; a certa você emite pela cobrança nova, na lista.
                  </span>
                )}
              </p>
            )}
          </section>

          {/* O TOMADOR — o que o Omie tem e o que vai ficar. */}
          <section className="rounded-lg border border-border p-3">
            <p className="mb-1.5 font-semibold text-foreground">Cadastro do tomador no Omie</p>
            {fase === "lendo" && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Comparando o Omie com o Asaas…
              </span>
            )}
            {fase !== "lendo" && !diag && (
              <p className="text-amber-700 dark:text-amber-400">Não deu para ler o cadastro. Dá para refazer mesmo assim — a nota sai com o cadastro que o Omie tem.</p>
            )}
            {diag?.erro_leitura_omie && (
              <p className="text-destructive">O Omie não respondeu a leitura do cadastro ({diag.erro_leitura_omie}). Feche e abra de novo em alguns segundos.</p>
            )}
            {diag?.bloqueio && (
              <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                Sem endereço confiável para propor ({diag.bloqueio}). Corrija abaixo, à mão, antes de refazer.
              </p>
            )}
            {diag && !diag.erro_leitura_omie && !diag.bloqueio && (muda.length ? (
              <table className="w-full text-[11px]">
                <tbody>
                  {muda.map((l) => (
                    <tr key={l.campo} className="border-b border-border/40 last:border-0">
                      <td className="w-28 py-1 text-muted-foreground">{CAMPO[l.campo] ?? l.campo}</td>
                      <td className={cn("py-1", l.vazio ? "italic text-muted-foreground/60" : "text-foreground")}>{l.de}</td>
                      <td className="w-6 py-1 text-center text-muted-foreground"><ArrowRight className="mx-auto h-3 w-3" /></td>
                      <td className="py-1 font-medium text-emerald-700 dark:text-emerald-400">{l.para}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> O Omie já está igual ao Asaas.
              </p>
            ))}
            {diag && !diag.erro_leitura_omie && (
              <EditarCadastroCliente
                cliente={diag}
                ids={[id]}
                onGravado={() => { void lerCadastro().catch(() => {}); }}
              />
            )}
          </section>

          <section className="space-y-2">
            <label className="block space-y-1">
              <span className="font-medium text-foreground">Por que a nota está sendo refeita?</span>
              <Textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Ex.: valor e endereço do tomador incorretos"
                className="min-h-[56px] text-xs"
                disabled={ocupado}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Texto dentro da nota nova (opcional)</span>
              <Input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: Cessão onerosa referente a set/2026"
                className="h-8 text-xs"
                disabled={ocupado}
              />
            </label>
          </section>

          {recado && (
            <p className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              <Hourglass className="mt-0.5 h-3 w-3 shrink-0" /> {recado}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onFechar}
              disabled={ocupado}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
            >
              Fechar
            </button>
            <button
              onClick={() => void executar()}
              disabled={ocupado || !justificativa.trim() || !!diag?.erro_leitura_omie}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {ocupado && fase !== "lendo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {fase === "cadastro" ? "Corrigindo o cadastro…"
                : fase === "cancelando" ? "Cancelando no Omie…"
                : fase === "em_andamento" ? "Conferir o cancelamento de novo"
                : excluida && !substituta ? `Cancelar a ${linha.nfse_numero}`
                : `Cancelar a ${linha.nfse_numero} e emitir a certa`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
