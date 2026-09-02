import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageSquareText, MessageSquareWarning, Copy, Check, Pencil, Trash2, RotateCcw, Sparkles, Loader2,
  UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chaveCelula } from "@/components/demonstracoes/Reclassificacoes";
import {
  CLASSE_SEGMENTO, DetalheStatus, SegmentoStatus, SeloPendencia,
} from "@/components/demonstracoes/BarraStatus";
import { BlocoPerguntas, type Pergunta } from "@/components/demonstracoes/Perguntas";
import type { PayloadPergunta } from "@/lib/perguntas";
import { usePessoasPJ, salvarPessoaPJ } from "@/hooks/usePessoasPJ";
import { pessoaDe, pessoasNoTexto, sugestaoDeNome, type MapaPessoas } from "@/lib/pessoasPJ";

/* ---------------------------------------------------------------------------
 * Justificativa da variação, na célula da DRE/DFC.
 *
 * É o comentário que hoje é escrito à mão no Tracker de Orçamento. A máquina faz
 * o rascunho a partir dos lançamentos do Omie; aqui a pessoa lê, confere contra
 * os drivers (que vêm salvos junto), corrige se precisar e copia para o tracker.
 *
 * Por que Popover e não o `title` da célula, como o alerta de reclassificação:
 * o texto tem três frases, uma lista de fornecedores e três botões. Um tooltip
 * de sistema não segura isso — e, principalmente, não dá para SELECIONAR nem
 * copiar, que é o objetivo final do recurso.
 * ------------------------------------------------------------------------- */

export type DriverJustificativa = {
  contraparte: string;
  /* A razão social do Omie, quando `contraparte` é o nome da pessoa que a
     substituiu. Só vem nas gerações feitas depois do de-para existir; nas mais
     antigas a troca acontece aqui, na exibição. */
  razaoSocial?: string | null;
  categoria?: string | null;
  atual: number;
  anterior: number;
  delta: number;
  movimento: "entrou" | "saiu" | "aumentou" | "reduziu";
  fmtAtual?: string;
  fmtAnterior?: string;
  fmtDelta?: string;
};

export type Justificativa = {
  id: string;
  tipo: "dre" | "dfc";
  rubrica: string;
  mes: string;
  mes_anterior: string | null;
  valor: number | null;
  valor_anterior: number | null;
  delta: number | null;
  delta_pct: number | null;
  despesa: boolean;
  texto: string;
  texto_editado: string | null;
  drivers: DriverJustificativa[];
  cobertura: number | null;
  confianca: "alta" | "media" | "baixa" | null;
  sinais: { codigo: string; detalhe: string }[];
  status: "novo" | "aceito" | "descartado";
  /** 'pergunta' = o texto que vale veio de uma resposta promovida (ver Perguntas) */
  origem?: "auto" | "pergunta" | null;
  gerado_em: string;
};

/**
 * O que vale é o que a pessoa escreveu; o rascunho é o padrão.
 *
 * Com `mapa`, a razão social que é a PJ de alguém sai trocada pelo nome da
 * pessoa NA HORA DE LER — inclusive em comentário escrito antes de o de-para
 * existir. É o que faz cadastrar um nome corrigir a grade inteira na hora, sem
 * "Regerar" (que apagaria o que já foi conferido).
 */
export const textoFinal = (j: Justificativa, mapa?: MapaPessoas | null) =>
  pessoasNoTexto(mapa, (j.texto_editado?.trim() || j.texto || "").trim());

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela nem a
   função criadas na migration 20260804160000. Este atalho tipado evita `any`
   solto pelo arquivo — some quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (tabela: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{
        data: Justificativa[] | null;
        error: { message: string } | null;
      }>;
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rotuloMes(k: string | null): string {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(k ?? "");
  if (!m) return k ?? "—";
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i >= 0 ? `${MES_PT[i]}/${m[2]}` : k!;
}

/* ============================================================
 *  Carga
 * ============================================================ */

export function useJustificativas(tipo: "dre" | "dfc") {
  const [mapa, setMapa] = useState<Map<string, Justificativa>>(new Map());
  const [carregando, setCarregando] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await db
      .from("demonstracoes_justificativas")
      .select("*")
      .eq("tipo", tipo);
    setCarregando(false);
    if (error) {
      // Acessório, como o alerta de reclassificação: falhou, a demonstração
      // continua na tela sem marca nenhuma em vez de derrubar a página.
      setMapa(new Map());
      return;
    }
    const m = new Map<string, Justificativa>();
    for (const r of data ?? []) {
      m.set(chaveCelula(r.rubrica, r.mes), {
        ...r,
        // Vêm como jsonb: uma linha antiga ou um insert manual pode trazer algo
        // que não é lista, e o render assume que é.
        drivers: Array.isArray(r.drivers) ? r.drivers : [],
        sinais: Array.isArray(r.sinais) ? r.sinais : [],
      });
    }
    setMapa(m);
  }, [tipo]);

  useEffect(() => { recarregar(); }, [recarregar]);

  return { justificativas: mapa, recarregarJustificativas: recarregar, carregandoJustificativas: carregando };
}

/* ============================================================
 *  Marca na célula
 * ============================================================ */

const CORES = {
  novo: "text-sky-700",
  aceito: "text-emerald-600",
  descartado: "text-muted-foreground/40",
} as const;

export function fundoCelulaJustificativa(j: Justificativa): string {
  if (j.status === "descartado") return "";
  return j.status === "aceito" ? "bg-emerald-50/60" : "bg-sky-50/70";
}

async function copiar(texto: string, rotulo: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${rotulo} copiado — é só colar no tracker.`);
  } catch {
    toast.error("O navegador bloqueou a cópia. Selecione o texto e copie à mão.");
  }
}

/**
 * O comentário fala do número contra o qual foi escrito — e a tabela guarda
 * esse número justamente para dar para perceber quando ele envelhece. Só que
 * ninguém comparava: em Jul/26 o balão dizia "Receita Recorrente caiu 1,13M"
 * numa célula que mostrava 1,23M, porque o texto tinha sido escrito com o mês
 * ainda pela metade. Divergiu, a tela diz que divergiu.
 */
function numeroMudou(j: Justificativa, valorCelula: number | null | undefined): boolean {
  if (valorCelula === undefined) return false;   // a página não informou; não invente
  const escrito = j.valor == null ? null : Number(j.valor);
  if (escrito == null) return valorCelula != null;
  if (valorCelula == null) return true;
  return Math.abs(valorCelula - escrito) > Math.max(1, Math.abs(escrito) * 0.005);
}

/* ============================================================
 *  "Isso não é uma empresa, é uma pessoa"
 * ============================================================
 * O Omie guarda razão social, então o comentário sai dizendo "a saída de DALBER
 * NEGOCIOS" onde quem lê esperava "a saída do Dalber" — e alguém corrige à mão
 * antes de colar no tracker, toda vez.
 *
 * O cadastro fica AQUI, na lista de drivers, e não só numa tela de configuração:
 * é lendo o comentário que a pessoa percebe o problema, e é com a razão social na
 * frente dos olhos que ela sabe qual grafia cadastrar. Salvar corrige na hora
 * todos os comentários da grade — o mapa é compartilhado e avisa os inscritos.
 */
function LinhaDriver({ d, mapa }: { d: DriverJustificativa; mapa: MapaPessoas }) {
  const [cadastrando, setCadastrando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  /* `pessoaDe` é inerte para nome já trocado (a chave dele não está no mapa),
     então a mesma chamada serve para o driver novo — que já veio trocado do
     servidor — e para o antigo, gravado com a razão social. */
  const exibido = pessoaDe(mapa, d.contraparte);
  const razaoSocial = d.razaoSocial ?? (exibido !== d.contraparte ? d.contraparte : null);

  const salvar = async () => {
    const alvo = razaoSocial ?? d.contraparte;
    setSalvando(true);
    const { error } = await salvarPessoaPJ(alvo, nome);
    setSalvando(false);
    if (error) { toast.error(error); return; }
    setCadastrando(false);
    toast.success(`"${alvo}" agora aparece como ${nome.trim()} em todos os comentários.`);
  };

  if (cadastrando) {
    return (
      <tr>
        <td colSpan={3} className="py-1">
          <div className="rounded-md border border-sky-300 bg-sky-50/70 px-2 py-1.5">
            <div className="mb-1 text-[9.5px] leading-snug text-sky-900">
              No Omie: <b className="font-semibold">{razaoSocial ?? d.contraparte}</b>. Como escrever nos comentários?
            </div>
            <div className="flex items-center gap-1">
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") salvar();
                  if (e.key === "Escape") setCadastrando(false);
                }}
                autoFocus
                placeholder="Nome da pessoa"
                className="h-6 flex-1 rounded border border-input bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={salvar}
                disabled={salvando || nome.trim().length < 2}
                className="inline-flex h-6 items-center gap-1 rounded bg-primary px-1.5 text-[10px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {salvando ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                Salvar
              </button>
              <button
                onClick={() => setCadastrando(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-secondary"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="group/driver align-baseline">
      <td className="py-px pr-2 text-[11px] text-foreground/90">
        {exibido}
        {(d.movimento === "entrou" || d.movimento === "saiu") && (
          <span className="ml-1 text-[9px] uppercase text-muted-foreground">{d.movimento}</span>
        )}
        {razaoSocial ? (
          /* Sem este selo o nome trocado passaria por nome do Omie, e quem fosse
             conferir lá procuraria por uma string que não existe no cadastro. */
          <span
            title={`No Omie está como "${razaoSocial}"`}
            className="ml-1 inline-flex translate-y-px items-center text-muted-foreground/70"
          >
            <UserRound className="h-2.5 w-2.5" />
          </span>
        ) : (
          <button
            onClick={() => { setNome(sugestaoDeNome(d.contraparte)); setCadastrando(true); }}
            title="É uma pessoa, não uma empresa — cadastrar o nome dela"
            className="ml-1 hidden translate-y-px align-middle text-muted-foreground/70 transition hover:text-sky-700 group-hover/driver:inline-flex"
          >
            <UserRound className="h-2.5 w-2.5" />
          </button>
        )}
      </td>
      <td className="whitespace-nowrap py-px text-right text-[10.5px] num text-muted-foreground">
        {d.fmtAnterior ?? valorExato(d.anterior)} → {d.fmtAtual ?? valorExato(d.atual)}
      </td>
      <td className={cn(
        "whitespace-nowrap py-px pl-2 text-right text-[10.5px] num font-medium",
        d.delta >= 0 ? "text-primary" : "text-emerald-700",
      )}>
        {d.fmtDelta ?? `${d.delta >= 0 ? "+" : ""}${Math.round(d.delta)}`}
      </td>
    </tr>
  );
}

export function MarcaJustificativa({
  justificativa, onMudou, valorCelula, perguntas, montarPayload, onPerguntaMudou, aposAplicar,
}: {
  justificativa: Justificativa;
  onMudou: () => void;
  /** O que a célula mostra AGORA. Omitido, a marca não checa envelhecimento. */
  valorCelula?: number | null;
  /* O fio de perguntas da MESMA célula. Vive aqui dentro, e não numa segunda
     marca ao lado, porque é a mesma conversa: quem lê o comentário e discorda
     dele quer perguntar dali mesmo. Sem estes três, o balão é só o comentário —
     é assim que ele se comporta em telas que ainda não passaram o fio. */
  perguntas?: Pergunta[];
  montarPayload?: () => (PayloadPergunta | null);
  onPerguntaMudou?: () => void | Promise<void>;
  /** Recalcula a demonstração quando uma correção do fio altera o Omie. */
  aposAplicar?: () => void | Promise<void>;
}) {
  const j = justificativa;
  const mapaPessoas = usePessoasPJ();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(textoFinal(j, mapaPessoas));
  const [salvando, setSalvando] = useState(false);

  const desatualizado = numeroMudou(j, valorCelula) && j.status !== "descartado";
  const temSinal = j.sinais.length > 0 && j.status !== "descartado";
  const Icone = temSinal || desatualizado ? MessageSquareWarning : MessageSquareText;

  const decidir = async (status: Justificativa["status"] | null, texto?: string | null) => {
    setSalvando(true);
    const { error } = await db.rpc("justificativa_decidir", {
      p_id: j.id,
      p_status: status,
      p_texto: texto ?? null,
    });
    setSalvando(false);
    if (error) { toast.error("Não consegui salvar: " + error.message); return; }
    setEditando(false);
    onMudou();
  };

  const delta = Number(j.delta ?? 0);
  const pct = j.delta_pct == null ? null : Number(j.delta_pct);

  return (
    <Popover onOpenChange={(o) => { if (o) setRascunho(textoFinal(j, mapaPessoas)); setEditando(false); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          /* A célula inteira abre o drill-down de lançamentos. Sem isto, ler o
             comentário abriria também a gaveta por baixo. */
          onClick={(e) => e.stopPropagation()}
          title={[
            desatualizado
              ? "O número desta célula mudou depois do comentário — clique para ver"
              : "Ver a justificativa desta variação",
            perguntas?.length
              ? `${perguntas.length} pergunta(s) respondida(s) aqui`
              : montarPayload ? "e perguntar sobre este valor" : null,
          ].filter(Boolean).join(" · ")}
          /* Caixa de 18px: o ícone tem 14 e, encostado nas outras marcas da
             célula, virava um alvo que só se acerta na sorte. */
          className={cn(
            "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm transition hover:bg-black/10",
            desatualizado ? "text-amber-600" : CORES[j.status],
          )}
        >
          <Icone strokeWidth={2.25} className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[440px] p-0 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- cabeçalho: a variação que motivou o comentário ---- */}
        <div className="border-b border-border px-4 pb-2.5 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[13px] font-semibold leading-tight text-foreground">
              {j.rubrica}
              <span className="font-normal text-muted-foreground"> · {rotuloMes(j.mes)}</span>
            </div>
            <span className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
              j.status === "aceito" ? "bg-emerald-100 text-emerald-800"
                : j.status === "descartado" ? "bg-muted text-muted-foreground"
                : "bg-sky-100 text-sky-800",
            )}>
              {j.status === "aceito" ? "conferido" : j.status === "descartado" ? "descartado" : "rascunho"}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="num">{valorExato(j.valor_anterior)}</span>
            <span>→</span>
            <span className="num font-semibold text-foreground">{valorExato(j.valor)}</span>
            <span className={cn("num font-semibold", delta >= 0 ? "text-primary" : "text-emerald-700")}>
              {delta >= 0 ? "+" : ""}{valorExato(delta)}
              {pct != null && ` (${(pct * 100).toFixed(1).replace(".", ",")}%)`}
            </span>
            <span className="opacity-70">vs {rotuloMes(j.mes_anterior)}</span>
          </div>
        </div>

        {/* Sem este aviso o comentário passaria por atual. Ele descreve a
            variação que existia quando foi escrito — se a célula mudou depois,
            a frase pode estar falando de outro número. */}
        {desatualizado && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[10.5px] leading-relaxed text-amber-900">
            <b>O número mudou depois deste comentário.</b> A célula mostra{" "}
            <span className="num">{valorExato(valorCelula ?? null)}</span> e o texto foi escrito contra{" "}
            <span className="num">{valorExato(j.valor)}</span>. Use “Regerar”, no resumo acima da tabela,
            para reescrevê-lo com os números de agora.
          </div>
        )}

        {/* ---- o comentário ---- */}
        <div className="px-4 py-3">
          {editando ? (
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              rows={5}
              autoFocus
              className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">
              {textoFinal(j, mapaPessoas) || "—"}
            </p>
          )}

          {/* Sem isto o texto passaria por verdade contábil. Ele é hipótese: o
              Omie diz QUEM se mexeu, não POR QUÊ. */}
          {!editando && (
            <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Sparkles className="h-2.5 w-2.5" />
              {j.texto_editado
                ? (j.origem === "pergunta"
                    ? "Resposta a uma pergunta feita nesta célula, promovida a comentário."
                    : "Reescrito por você.")
                : <>Rascunho automático dos lançamentos do Omie{j.confianca && ` · confiança ${j.confianca}`}. Confira antes de levar ao tracker.</>}
            </p>
          )}
        </div>

        {/* ---- sinais: o que pode ser erro de lançamento ---- */}
        {!!j.sinais.length && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-2">
            {j.sinais.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-amber-900">
                <MessageSquareWarning className="mt-0.5 h-3 w-3 shrink-0" />
                {/* O sinal é redigido no servidor com o nome da contraparte
                    dentro da frase ("X sozinho responde por 80% da variação"):
                    sem esta passada ele mostraria a razão social ao lado de um
                    comentário que já fala da pessoa. */}
                <span>{pessoasNoTexto(mapaPessoas, s.detalhe)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ---- os drivers: a prova, para conferir sem sair da tela ---- */}
        {!!j.drivers.length && (
          <div className="border-t border-border bg-muted/30 px-4 py-2">
            <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-muted-foreground">
              QUEM SE MEXEU (OMIE)
            </div>
            <table className="w-full">
              <tbody>
                {j.drivers.slice(0, 5).map((d, i) => (
                  <LinhaDriver key={i} d={d} mapa={mapaPessoas} />
                ))}
              </tbody>
            </table>
            {j.cobertura != null && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Explica {Math.round(Number(j.cobertura) * 100)}% da variação.
              </div>
            )}
          </div>
        )}

        {/* ---- ações ---- */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
          {editando ? (
            <>
              <button
                onClick={() => decidir(null, rascunho)}
                disabled={salvando}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Salvar
              </button>
              <button
                onClick={() => { setRascunho(textoFinal(j, mapaPessoas)); setEditando(false); }}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-secondary"
              >
                Cancelar
              </button>
              {j.texto_editado && (
                <button
                  onClick={() => decidir(null, "")}
                  disabled={salvando}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                  title="Descarta a sua reescrita e volta a valer o rascunho automático"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> Voltar ao rascunho
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => copiar(textoFinal(j, mapaPessoas), "Comentário")}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition hover:bg-secondary"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
              <button
                onClick={() => setEditando(true)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition hover:bg-secondary"
              >
                <Pencil className="h-3 w-3" /> Editar
              </button>
              {j.status !== "aceito" && (
                <button
                  onClick={() => decidir("aceito")}
                  disabled={salvando}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-card px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" /> Conferi
                </button>
              )}
              {j.status === "descartado" ? (
                <button
                  onClick={() => decidir("novo")}
                  disabled={salvando}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> Restaurar
                </button>
              ) : (
                <button
                  onClick={() => decidir("descartado")}
                  disabled={salvando}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                  title="Some da grade. Dá para restaurar depois."
                >
                  <Trash2 className="h-2.5 w-2.5" /> Descartar
                </button>
              )}
            </>
          )}
        </div>

        {/* ---- perguntar sobre este valor ----
            No rodapé, e não numa marca própria na célula: é a mesma conversa
            sobre o mesmo número, e uma segunda marca alargaria toda a grade
            para dizer isso duas vezes. */}
        {montarPayload && onPerguntaMudou && (
          <BlocoPerguntas
            perguntas={perguntas ?? []}
            montarPayload={montarPayload}
            onMudou={onPerguntaMudou}
            aposAplicar={aposAplicar}
            compacto
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ============================================================
 *  Resumo acima da tabela
 * ============================================================ */

export function ResumoJustificativas({
  mapa, colunas, gerando, progresso, onGerar, apenasUltimoMes, onApenasUltimoMesChange,
}: {
  mapa: Map<string, Justificativa>;
  colunas: string[];
  gerando: boolean;
  progresso: string | null;
  onGerar: (force: boolean) => void;
  apenasUltimoMes?: boolean;
  onApenasUltimoMesChange?: (v: boolean) => void;
}) {
  const mapaPessoas = usePessoasPJ();

  const visiveis = useMemo(() => {
    const cols = new Set(colunas);
    return [...mapa.values()].filter((j) => cols.has(j.mes) && j.status !== "descartado");
  }, [mapa, colunas]);

  const novos = visiveis.filter((j) => j.status === "novo").length;
  const comSinal = visiveis.filter((j) => j.sinais.length > 0).length;

  /** Bloco pronto para colar no tracker, na ordem em que as colunas aparecem. */
  const copiarTudo = () => {
    const ordem = new Map(colunas.map((c, i) => [c, i]));
    const txt = [...visiveis]
      .sort((a, b) => (ordem.get(a.mes)! - ordem.get(b.mes)!) || a.rubrica.localeCompare(b.rubrica))
      // Este é o caminho que leva ao tracker de verdade — se a troca não valesse
      // aqui, o recurso inteiro não teria efeito onde importa.
      .map((j) => `${rotuloMes(j.mes)} — ${j.rubrica}\n${textoFinal(j, mapaPessoas)}`)
      .join("\n\n");
    if (!txt) { toast.info("Nada para copiar nos meses visíveis."); return; }
    copiar(txt, `${visiveis.length} comentários`);
  };

  /* Sem nenhum comentário não há segmento — mas o botão de gerar não pode sumir
     junto, senão a primeira geração fica sem porta. Ele vira o próprio segmento,
     e é o único caso em que a barra existe com um botão dentro. */
  if (!visiveis.length) {
    return (
      <span className={CLASSE_SEGMENTO}>
        <button
          onClick={() => onGerar(false)}
          disabled={gerando}
          title="A cada importação de tracker ou sincronização com o Omie os comentários saem sozinhos — ou gere agora para os meses já carregados."
          className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          {gerando
            ? <><Loader2 className="h-3 w-3 animate-spin" /> {progresso ?? "Gerando…"}</>
            : <><Sparkles className="h-3 w-3" /> Gerar comentários</>}
        </button>
      </span>
    );
  }

  return (
    <SegmentoStatus
      icone={<MessageSquareText strokeWidth={2.2} className="h-[13px] w-[13px] text-sky-600" />}
      valor={visiveis.length}
      rotulo={visiveis.length === 1 ? "comentário" : "comentários"}
      /* O ÚNICO lugar com cor forte na barra: é o que ainda dá trabalho. */
      selo={novos > 0
        ? <SeloPendencia titulo="Comentários que ninguém leu nem aceitou ainda.">{novos} a conferir</SeloPendencia>
        : undefined}
      titulo={`${visiveis.length} ${visiveis.length === 1 ? "célula variou" : "células variaram"} mais de 5% e ganharam um comentário${comSinal > 0 ? `; ${comSinal} com sinal de possível erro de lançamento` : ""}.`}
      larguraDetalhe={400}
      detalhe={
        <DetalheStatus
          titulo="Comentários de variação"
          nota="Só mês travado ganha comentário, e variação abaixo de 10% ou de R$ 1 mil não vira comentário — nem célula cuja variação nenhum lançamento do Omie explica. Para perguntar sobre um valor específico — inclusive numa célula sem comentário — clique no “?” dentro da célula."
        >
          <div className="px-3 py-2 text-[11.5px] leading-relaxed text-foreground">
            <b>{visiveis.length}</b> {visiveis.length === 1 ? "célula variou" : "células variaram"} mais de 5% e
            {visiveis.length === 1 ? " ganhou" : " ganharam"} um comentário
            {novos > 0 && <> — <b>{novos}</b> ainda sem conferir</>}
            {comSinal > 0 && <>, <b>{comSinal}</b> com sinal de possível erro de lançamento</>}.
            Clique no balão dentro da célula para ler, ajustar e copiar.
          </div>
          {/* "Copiar todos" e "Apenas mês recente" desceram da barra para cá: são
              ações de quem já parou para trabalhar os comentários, não coisas a
              ter na frente toda vez que a página abre. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
            <button
              onClick={copiarTudo}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-foreground transition hover:bg-secondary"
            >
              <Copy className="h-3 w-3" /> Copiar todos
            </button>
            {onApenasUltimoMesChange && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-foreground transition hover:bg-secondary">
                <input
                  type="checkbox"
                  checked={apenasUltimoMes ?? false}
                  onChange={(e) => onApenasUltimoMesChange(e.target.checked)}
                  className="rounded"
                />
                Marcar só no mês recente
              </label>
            )}
          </div>
        </DetalheStatus>
      }
    />
  );
}

/**
 * O botão "Regerar" da barra de status — fora dos segmentos, à direita.
 *
 * Continua à mão porque reescrever comentário é decisão, não rotina; o que
 * desceu para o detalhe foram as ações de quem já está trabalhando a lista.
 */
export function RegerarJustificativas({
  gerando, progresso, onGerar,
}: {
  gerando: boolean;
  progresso: string | null;
  onGerar: (force: boolean) => void;
}) {
  return (
    <button
      onClick={() => onGerar(true)}
      disabled={gerando}
      title="Reescreve todos os comentários dos meses visíveis, inclusive os já conferidos"
      className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-[11.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-50"
    >
      {gerando
        ? <><Loader2 className="h-3 w-3 animate-spin" /> {progresso ?? "Gerando…"}</>
        : <><Sparkles className="h-3 w-3" /> Regerar</>}
    </button>
  );
}
