import { useMemo, useRef, useState } from "react";
import {
  ArrowRight, Check, CheckCircle2, ListChecks, Loader2, Pencil, Tag, TriangleAlert, Wrench, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { trocarEmLote, type ResultadoLote } from "@/lib/loteCategoria";
import { salvarApelido } from "@/hooks/useApelidos";
import {
  fraseDoResultado, itensAplicaveis, lerAcao, motivoSemBotao, paraLote, tituloDaAcao, totalDosItens,
  type AcaoCelula, type ResultadoAcao,
} from "@/lib/acaoCelula";
import type { Pergunta } from "@/lib/perguntas";

/* ---------------------------------------------------------------------------
 * A correção, logo abaixo da resposta que a motivou.
 *
 * O chat da célula respondia e parava. Quando a frase não era pergunta mas
 * conserto — "isso é da Paytime, deveria ser markup" —, a pessoa lia uma resposta
 * concordando com ela e ia corrigir à mão noutro lugar. Este cartão fecha o
 * ciclo: a IA aponta os títulos, a pessoa confere e clica.
 *
 * A PRÉVIA É O PONTO, não um atrito a ser removido depois. Um clique aqui altera
 * o ERP, e o que a IA erra não é o raciocínio — é a identificação: ela junta a
 * contraparte certa com o título vizinho, ou pega quatro quando eram três. Ler
 * "PAYTIME · 12/08 · R$ 8.204,10" leva um segundo e é a única checagem que
 * existe entre o texto de um modelo e o histórico contábil da empresa.
 *
 * Por isso cada item tem sua caixa de marcar: aceitar três de quatro é o desfecho
 * comum, e sem isso a pessoa teria que dispensar tudo e ir fazer à mão.
 *
 * QUEM ESCREVE NO OMIE CONTINUA SENDO `omie-trocar-categoria`, item a item, pelo
 * mesmo laço do lote do drill-down (`trocarEmLote`) — inclusive a parada por
 * recusa repetida, que é o que impede 40 chamadas para colecionar 40 cópias de
 * "período contábil fechado".
 * ------------------------------------------------------------------------- */

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rotuloMes(k: string | null): string {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(k ?? "");
  if (!m) return k ?? "—";
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i >= 0 ? `${MES_PT[i]}/${m[2]}` : k!;
}

const diaCurto = (d: string | null) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : "—");

const quando = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/* ============================================================
 *  Já resolvido: o registro do que aconteceu
 * ============================================================
 * A proposta muda de estado uma vez só. Depois disso o cartão deixa de ser botão
 * e vira recibo — é o que responde "eu cheguei a aplicar isso?" quando alguém
 * volta à célula três dias depois.
 */
function Recibo({ pergunta }: { pergunta: Pergunta }) {
  const aplicada = pergunta.acao_estado === "aplicada";
  const r = pergunta.acao_resultado;

  return (
    <div
      className={cn(
        "mt-1.5 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed",
        aplicada
          ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {aplicada
        ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
        : <X className="mt-0.5 h-3 w-3 shrink-0" />}
      <span>
        {aplicada ? (r ? fraseDoResultado(r) : "Correção aplicada.") : "Proposta dispensada."}
        {pergunta.acao_em && <span className="opacity-70"> · {quando(pergunta.acao_em)}</span>}
        {/* A recusa do ERP fica escrita: "3 alterados, 2 recusados" sem dizer de
            quê é a metade que não serve para nada. */}
        {!!r?.falhas?.length && (
          <span className="block opacity-80">
            {r.falhas.slice(0, 3).map((f) => `${f.cod_titulo}: ${f.erro}`).join(" · ")}
            {r.falhas.length > 3 && ` · e mais ${r.falhas.length - 3}`}
          </span>
        )}
      </span>
    </div>
  );
}

/* ============================================================
 *  A proposta aberta
 * ============================================================ */

export function AcaoProposta({
  pergunta, onMudou, aposAplicar, promover,
}: {
  pergunta: Pergunta;
  /** Recarrega o fio da célula — o cartão vira recibo. */
  onMudou: () => void | Promise<void>;
  /** Recalcula a demonstração depois de o Omie mudar. */
  aposAplicar?: () => void | Promise<void>;
  /** "Virar comentário", o mesmo gesto do botão do fio. */
  promover: () => Promise<void>;
}) {
  const acao = useMemo(() => lerAcao(pergunta.acao), [pergunta.acao]);

  const [dispensados, setDispensados] = useState<Set<string>>(new Set());
  const [comentar, setComentar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const cancelar = useRef(false);

  if (!acao) return null;
  if (pergunta.acao_estado && pergunta.acao_estado !== "proposta") return <Recibo pergunta={pergunta} />;

  const marcados = acao.tipo === "trocar_categoria"
    ? itensAplicaveis(acao).filter((i) => !dispensados.has(i.cod_titulo))
    : [];
  const impedimento = motivoSemBotao(acao);

  /* Carimba o desfecho na linha da pergunta. Falhar aqui NÃO é motivo para
     esconder o que já aconteceu no Omie: o toast do resultado sai de qualquer
     jeito, e o cartão volta na próxima carga se o carimbo não pegou. */
  const registrar = async (estado: "aplicada" | "descartada", resultado: ResultadoAcao | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("pergunta_acao_registrar", {
      p_id: pergunta.id,
      p_estado: estado,
      p_resultado: resultado,
    });
    if (error) console.error("não consegui registrar a ação:", error.message);
    await onMudou();
  };

  const dispensar = async () => {
    setOcupado(true);
    await registrar("descartada", null);
    setOcupado(false);
  };

  /* ---------------- Trocar categoria: o caminho que mexe no ERP ------------- */
  const aplicarTroca = async () => {
    if (acao.tipo !== "trocar_categoria" || !marcados.length) return;
    setOcupado(true);
    cancelar.current = false;
    setProgresso({ feitos: 0, total: marcados.length });

    // O mês de cada título, para a trilha registrar a competência certa: uma
    // proposta pode atravessar o mês anterior.
    const mesDe = new Map(marcados.map((i) => [i.cod_titulo, i.mes]));

    let lote: ResultadoLote;
    try {
      lote = await trocarEmLote(
        paraLote(marcados),
        async (item) => {
          const { data, error } = await supabase.functions.invoke("omie-trocar-categoria", {
            body: {
              action: "trocar",
              cod_titulo: item.codTitulo,
              codigo: acao.categoria.codigo,
              // A trilha distingue o que veio do chat do que veio do lápis: são
              // decisões de origem diferente e revisar uma delas é outro trabalho.
              origem: `${pergunta.tipo}-chat`,
              mes: mesDe.get(item.codTitulo) ?? pergunta.mes,
              motivo: acao.motivo ?? pergunta.pergunta.slice(0, 400),
            },
          });
          const r = data as { status?: string; erro?: string; ja_estava?: boolean } | null;
          if (error || r?.status === "erro") {
            return { ok: false, erro: r?.erro ?? error?.message ?? "Não consegui alterar no Omie." };
          }
          return { ok: true, jaEstava: r?.ja_estava };
        },
        {
          onProgresso: (feitos, total) => setProgresso({ feitos, total }),
          cancelado: () => cancelar.current,
        },
      );
    } finally {
      setProgresso(null);
    }

    const resultado: ResultadoAcao = {
      tipo: "trocar_categoria",
      ok: lote.resultados.filter((x) => x.ok).length,
      falhas: lote.resultados
        .filter((x) => !x.ok)
        .map((x) => ({ cod_titulo: x.item.codTitulo, erro: x.erro ?? "recusado" })),
      naoTentados: lote.naoTentados.length,
      interrompidoPor: lote.interrompidoPor,
    };

    const frase = fraseDoResultado(resultado);
    if (resultado.ok) {
      toast.success(frase, {
        duration: 8000,
        description: acao.rubrica_destino ? `Agora entram em ${acao.rubrica_destino}.` : undefined,
      });
    } else {
      toast.error(frase, { duration: 12000, description: lote.interrompidoPor ?? undefined });
    }

    /* Só carimba como aplicada se ALGUMA coisa foi. Zero alterações com o ERP
       recusando tudo é uma proposta que continua de pé — o mês reabre e ela volta
       a valer; apagar o botão obrigaria a perguntar de novo. */
    if (resultado.ok > 0) {
      if (comentar) {
        try { await promover(); } catch { /* o toast do promover já falou */ }
      }
      await registrar("aplicada", resultado);
      await aposAplicar?.();
    } else {
      await onMudou();
    }
    setOcupado(false);
  };

  /* ---------------- Apelido: o nome, não a linha --------------------------- */
  const aplicarApelido = async () => {
    if (acao.tipo !== "apelido") return;
    setOcupado(true);
    const { error } = await salvarApelido(acao.nome, {
      apelido: acao.apelido,
      oQueE: acao.motivo,
      documento: acao.documento,
      origem: "dre-chat",
    });
    if (error) {
      toast.error("Não consegui cadastrar o apelido: " + error);
      setOcupado(false);
      return;
    }
    toast.success(`“${acao.nome}” agora aparece como “${acao.apelido}”.`, {
      duration: 7000,
      description: "Vale em todo o Hub. O nome cru continua na linha de apoio, que é o que se procura no Omie.",
    });
    await registrar("aplicada", { tipo: "apelido", ok: 1, detalhe: acao.apelido });
    setOcupado(false);
  };

  /* ---------------- Tarefa: o que não é para consertar agora --------------- */
  const aplicarTarefa = async () => {
    if (acao.tipo !== "tarefa") return;
    setOcupado(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("tarefa_fechamento_subtarefa", {
      p_titulo: acao.titulo,
      p_responsavel: acao.responsavel,
    });
    if (error) {
      toast.error("Não consegui criar a subtarefa: " + error.message);
      setOcupado(false);
      return;
    }
    const r = data as { criou_card?: boolean; repetida?: boolean } | null;
    toast.success(
      r?.repetida ? "Essa pendência já estava no checklist do Fechamento." : "Subtarefa criada no card Fechamento.",
      {
        duration: 7000,
        description: r?.criou_card ? "O card “Fechamento” foi criado no Backlog." : undefined,
      },
    );
    await registrar("aplicada", { tipo: "tarefa", ok: 1, detalhe: acao.titulo });
    setOcupado(false);
  };

  const icone = acao.tipo === "trocar_categoria" ? Wrench : acao.tipo === "apelido" ? Tag : ListChecks;
  const Icone = icone;

  return (
    <div className="mt-1.5 rounded-md border border-indigo-200 bg-indigo-50/50 px-2.5 py-2">
      <div className="flex items-start gap-1.5">
        <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-700" />
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-semibold leading-snug text-foreground">{tituloDaAcao(acao)}</div>

          {/* --------- Trocar categoria --------- */}
          {acao.tipo === "trocar_categoria" && (
            <>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
                <span>Para</span>
                <b className="text-foreground">{acao.categoria.descricao}</b>
                <span className="font-mono opacity-70">{acao.categoria.codigo}</span>
                {acao.rubrica_destino
                  ? <><ArrowRight className="h-2.5 w-2.5" /><b className="text-foreground">{acao.rubrica_destino}</b></>
                  : <span className="text-amber-700">· fora do DE-PARA: sairia da demonstração</span>}
              </div>

              {!!acao.itens.length && (
                <div className="mt-1.5 max-h-[168px] space-y-px overflow-y-auto rounded border border-border/70 bg-card">
                  {acao.itens.map((i) => {
                    const podeIr = itensAplicaveis(acao).some((x) => x.cod_titulo === i.cod_titulo);
                    const marcado = podeIr && !dispensados.has(i.cod_titulo);
                    return (
                      <button
                        key={i.cod_titulo}
                        type="button"
                        disabled={!podeIr || ocupado}
                        onClick={() => setDispensados((s) => {
                          const n = new Set(s);
                          if (n.has(i.cod_titulo)) n.delete(i.cod_titulo); else n.add(i.cod_titulo);
                          return n;
                        })}
                        className={cn(
                          "flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-[10.5px] transition",
                          podeIr ? "hover:bg-secondary" : "opacity-50",
                          !marcado && podeIr && "opacity-45",
                        )}
                      >
                        <span className={cn(
                          "flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border",
                          marcado ? "border-indigo-600 bg-indigo-600 text-white" : "border-muted-foreground/50",
                        )}>
                          {marcado && <Check className="h-2 w-2" strokeWidth={3.5} />}
                        </span>
                        <span className="w-9 shrink-0 tabular-nums text-muted-foreground">{diaCurto(i.data)}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground" title={i.contraparte ?? undefined}>
                          {i.contraparte ?? "sem nome no cadastro"}
                        </span>
                        {/* De onde ele sai — é o que denuncia a proposta que pegou
                            a linha vizinha por engano. */}
                        <span
                          className="hidden max-w-[110px] shrink-0 truncate text-muted-foreground sm:inline"
                          title={`Hoje em ${i.rubrica_atual ?? "nenhuma rubrica"} · ${i.categoria_descricao ?? "?"}`}
                        >
                          {i.rubrica_atual ?? "fora do DE-PARA"}
                        </span>
                        <span className="w-[74px] shrink-0 text-right tabular-nums text-foreground">
                          {brl(i.valor)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {marcados.length > 1 && (
                <div className="mt-1 text-right text-[10.5px] tabular-nums text-muted-foreground">
                  {marcados.length} selecionados · <b className="text-foreground">{brl(totalDosItens(marcados))}</b>
                </div>
              )}

              {!!acao.recusados.length && (
                <div className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-amber-900">
                  <TriangleAlert className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                  <span>
                    {acao.recusados.length} ficaram de fora:{" "}
                    {[...new Set(acao.recusados.map((r) => r.motivo))].join("; ")}.
                  </span>
                </div>
              )}
            </>
          )}

          {/* --------- Apelido --------- */}
          {acao.tipo === "apelido" && (
            <div className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
              Grava em Configurações › Parametrização e passa a valer em todo o Hub.
              O nome cru continua na linha de apoio — é ele que se procura no Omie.
            </div>
          )}

          {/* --------- Tarefa --------- */}
          {acao.tipo === "tarefa" && (
            <div className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
              Vira uma linha do checklist do card <b>Fechamento</b> em /tarefas
              {acao.responsavel ? <> · para <b>{acao.responsavel}</b></> : null}.
            </div>
          )}

          {/* --------- O que impede o botão --------- */}
          {impedimento && (
            <div className="mt-1 flex items-start gap-1 text-[10.5px] leading-snug text-amber-900">
              <TriangleAlert className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              <span>{impedimento}</span>
            </div>
          )}

          {/* --------- Botões --------- */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {acao.tipo === "trocar_categoria" && !impedimento && (
              <button
                onClick={aplicarTroca}
                disabled={ocupado || !marcados.length}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10.5px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {ocupado
                  ? <><Loader2 className="h-3 w-3 animate-spin" />
                      {progresso ? `Alterando ${progresso.feitos}/${progresso.total}…` : "Alterando no Omie…"}</>
                  : <><Wrench className="h-3 w-3" /> Aplicar no Omie{marcados.length > 1 ? ` (${marcados.length})` : ""}</>}
              </button>
            )}
            {acao.tipo === "apelido" && (
              <button
                onClick={aplicarApelido}
                disabled={ocupado}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10.5px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tag className="h-3 w-3" />}
                Cadastrar apelido
              </button>
            )}
            {acao.tipo === "tarefa" && (
              <button
                onClick={aplicarTarefa}
                disabled={ocupado}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10.5px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListChecks className="h-3 w-3" />}
                Criar subtarefa
              </button>
            )}

            {ocupado && progresso
              ? (
                <button
                  onClick={() => { cancelar.current = true; }}
                  className="rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary"
                >
                  Parar
                </button>
              )
              : (
                <button
                  onClick={dispensar}
                  disabled={ocupado}
                  title="A proposta some do fio. Nada é alterado."
                  className="rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                >
                  Dispensar
                </button>
              )}

            {/* O gesto seguinte quase sempre é este — a correção explicada vira o
                comentário que vai para o tracker. Junto do botão para não virar
                um segundo trabalho que se esquece. */}
            {acao.tipo === "trocar_categoria" && !impedimento && (
              <button
                onClick={() => setComentar((v) => !v)}
                disabled={ocupado}
                title="Depois de aplicar, a resposta vira o comentário oficial desta célula"
                className={cn(
                  "ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition disabled:opacity-50",
                  comentar ? "text-sky-800" : "text-muted-foreground hover:bg-secondary",
                )}
              >
                <span className={cn(
                  "flex h-2.5 w-2.5 items-center justify-center rounded-[2px] border",
                  comentar ? "border-sky-700 bg-sky-700 text-white" : "border-muted-foreground/50",
                )}>
                  {comentar && <Check className="h-1.5 w-1.5" strokeWidth={4} />}
                </span>
                <Pencil className="h-2.5 w-2.5" /> virar comentário
              </button>
            )}
          </div>

          {acao.tipo === "trocar_categoria" && !impedimento && (
            <div className="mt-1 text-[9.5px] leading-snug text-muted-foreground/80">
              Altera o Omie, espelha no Hub e recalcula a {pergunta.tipo.toUpperCase()}. Fica na trilha de alterações.
              {pergunta.travado && (
                <span className="text-amber-800">
                  {" "}{rotuloMes(pergunta.mes)} está travado: o Omie muda, mas o valor na tela continua vindo do tracker.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type { AcaoCelula };
