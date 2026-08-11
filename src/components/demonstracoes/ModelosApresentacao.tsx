/* ============================================================================
 * Modelos — o deck que se repete.
 *
 * "Conselho Trimestral" é o mesmo material todo trimestre, com números novos.
 * O modelo guarda o ROTEIRO e a JANELA; gerar cria uma apresentação apontando
 * para o período pedido, e os números vêm sozinhos porque o roteiro guarda
 * chave de card, não valor.
 *
 * O QUE ACONTECE NA GERAÇÃO
 *   1. `sanear` contra o catálogo do mês escolhido: um modelo montado em julho
 *      pode citar "Rubrica · Servidor", que em outubro não existe. Sai da folha
 *      com aviso, em vez de virar um buraco silencioso no meio da reunião.
 *   2. O nome vira "Conselho Trimestral · 3T26" — e passa por `nomeLivre`,
 *      porque gerar duas vezes o mesmo trimestre é rotina e `(mes, nome)` é
 *      único no banco.
 *   3. A apresentação nasce RASCUNHO. Publicar continua sendo um ato de gente:
 *      material que vai para fora não se publica sozinho.
 * ========================================================================== */

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { contarPecas, sanear, type ItemCatalogo, type Roteiro } from "@/lib/apresentacao";
import { resolverPeriodo, TIPOS, type TipoPeriodo } from "@/lib/periodo";

const sb = supabase as any;

export type Modelo = {
  id: string;
  nome: string;
  descricao: string | null;
  roteiro: Roteiro;
  periodo_tipo: TipoPeriodo;
  atualizado_em: string;
};

type Props = {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  /** Meses com dado, para escolher o fechamento da geração. */
  meses: string[];
  rotuloDoMes: (col: string) => string;
  catalogo: ItemCatalogo[];
  /** O roteiro em edição — vira modelo em "salvar como". Null fora de uma apresentação. */
  roteiroAtual: Roteiro | null;
  nomeAtual: string;
  periodoAtual: TipoPeriodo;
  /** Cria a apresentação e abre. Devolve false se não deu. */
  onGerar: (opts: { nome: string; roteiro: Roteiro; mes: string; tipo: TipoPeriodo }) => Promise<boolean>;
};

export function ModelosApresentacao({
  aberto, onOpenChange, meses, rotuloDoMes, catalogo, roteiroAtual, nomeAtual, periodoAtual, onGerar,
}: Props) {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mesAlvo, setMesAlvo] = useState<string>("");
  const [novoNome, setNovoNome] = useState("");

  const carregar = async () => {
    const { data } = await sb
      .from("demonstracoes_apresentacao_modelos")
      .select("*")
      .order("nome", { ascending: true });
    setModelos((data ?? []) as Modelo[]);
  };

  useEffect(() => {
    if (!aberto) return;
    void carregar();
    // O fechamento padrão é o mês mais recente com dado — que é o que a pessoa
    // quer em nove de cada dez gerações.
    setMesAlvo((m) => m || meses[meses.length - 1] || "");
    setNovoNome(nomeAtual);
  }, [aberto, meses, nomeAtual]);

  const salvarComoModelo = async () => {
    if (!roteiroAtual || !novoNome.trim()) return;
    setOcupado("salvar");
    const { error } = await sb.rpc("modelo_apresentacao_salvar", {
      p_nome: novoNome.trim(),
      p_roteiro: roteiroAtual,
      p_periodo_tipo: periodoAtual,
      p_descricao: null,
      p_id: modelos?.find((m) => m.nome === novoNome.trim())?.id ?? null,
    });
    setOcupado(null);
    if (error) { toast.error("Não consegui salvar o modelo: " + error.message); return; }
    await carregar();
    toast.success(`"${novoNome.trim()}" guardado como modelo.`);
  };

  const gerar = async (m: Modelo) => {
    if (!mesAlvo) { toast.error("Escolha o mês de fechamento."); return; }
    setOcupado(m.id);
    const periodo = resolverPeriodo(m.periodo_tipo, mesAlvo, meses);
    const { roteiro, removidas } = sanear(m.roteiro ?? { folhas: [] }, catalogo);
    if (removidas.length) {
      toast.message(`${removidas.length} card(s) do modelo não existem neste período.`, {
        description: removidas.join(", "),
      });
    }
    const ok = await onGerar({
      nome: `${m.nome} · ${periodo.rotulo}`,
      roteiro,
      mes: mesAlvo,
      tipo: m.periodo_tipo,
    });
    setOcupado(null);
    if (ok) onOpenChange(false);
  };

  const excluir = async (m: Modelo) => {
    if (!window.confirm(`Excluir o modelo "${m.nome}"? As apresentações já geradas continuam.`)) return;
    const { error } = await sb.rpc("modelo_apresentacao_excluir", { p_id: m.id });
    if (error) { toast.error(error.message); return; }
    await carregar();
    toast.success("Modelo excluído.");
  };

  const nomeDoTipo = (t: TipoPeriodo) => TIPOS.find((x) => x.tipo === t)?.nome ?? t;

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Modelos de apresentação</DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            Um modelo guarda o <b>roteiro</b> e a <b>janela</b>, não os números. Gerar cria uma
            apresentação nova apontando para o período que você escolher — os números vêm de onde
            sempre vieram.
          </DialogDescription>
        </DialogHeader>

        {/* ---------------------------- gerar ---------------------------- */}
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[11.5px] text-muted-foreground">Fechamento</span>
          <select
            value={mesAlvo}
            onChange={(e) => setMesAlvo(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {[...meses].reverse().map((c) => (
              <option key={c} value={c}>{rotuloDoMes(c)}</option>
            ))}
          </select>
        </div>

        <div className="flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto">
          {modelos == null ? (
            <p className="py-3 text-center text-[12px] text-muted-foreground">Carregando…</p>
          ) : modelos.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] leading-relaxed text-muted-foreground">
              Nenhum modelo ainda. Monte uma apresentação do jeito que ela deve se repetir e
              guarde-a aqui embaixo — na virada do trimestre, gerar é um clique.
            </p>
          ) : (
            modelos.map((m) => {
              const periodo = mesAlvo ? resolverPeriodo(m.periodo_tipo, mesAlvo, meses) : null;
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{m.nome}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {nomeDoTipo(m.periodo_tipo)} · {m.roteiro?.folhas?.length ?? 0} folha(s) ·{" "}
                      {contarPecas(m.roteiro ?? { folhas: [] })} peça(s)
                      {periodo && <> · geraria <b className="text-foreground">{periodo.rotulo}</b></>}
                    </div>
                  </div>
                  <button
                    onClick={() => gerar(m)}
                    disabled={ocupado != null}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    {ocupado === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Repeat className="h-3 w-3" />}
                    Gerar
                  </button>
                  <button
                    onClick={() => excluir(m)}
                    title="Excluir o modelo (as apresentações geradas continuam)"
                    className="ghost-btn ghost-icone ghost-icone-sm text-muted-foreground hover:border-neg/40 hover:bg-neg-soft hover:text-neg"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* ------------------------ salvar como modelo ------------------------ */}
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="eyebrow">Guardar a apresentação aberta como modelo</span>
          {!roteiroAtual ? (
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Abra uma apresentação para poder guardá-la. O modelo leva as folhas e a janela; o
              texto que você escreveu para esta plateia fica na apresentação — ele fala deste
              período, e num deck do trimestre seguinte estaria contando o passado.
            </p>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Nome do modelo"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={salvarComoModelo}
                disabled={!novoNome.trim() || ocupado != null}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium transition hover:bg-secondary disabled:opacity-50",
                )}
              >
                {ocupado === "salvar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {modelos?.some((m) => m.nome === novoNome.trim()) ? "Atualizar" : "Guardar"}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
