import { useEffect, useState } from "react";
import { MessageSquareText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* ---------------------------------------------------------------------------
 * Justificativa de UM lançamento, escrita à mão.
 *
 * A justificativa da CÉLULA explica a variação da linha inteira ("Viagens subiu
 * 6%"); esta explica uma linha da lista — "o reembolso da Rita é da viagem do
 * evento em SP, aprovado pelo Henrique". Nada disso está no Omie, e sem lugar
 * para escrever a informação se perdia entre a reunião e o fechamento seguinte.
 *
 * A nota mora em `demonstracoes_lancamento_nota` pendurada no `cod_titulo`
 * (migration 20260813210000): vale na DRE e na DFC, e acompanha o título se ele
 * trocar de rubrica — o fato aconteceu com o lançamento, não com a célula.
 * ------------------------------------------------------------------------- */

export type NotaLancamento = {
  cod_titulo: string;
  texto: string;
  autor_nome: string | null;
  atualizado_em: string;
};

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela nem a
   função da migration 20260813210000. Mesmo atalho tipado dos valores manuais —
   some quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (tabela: string) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{
        data: NotaLancamento[] | null;
        error: { message: string } | null;
      }>;
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/** Lê as notas de um punhado de lançamentos. Em blocos pelo mesmo motivo das
 *  observações: a consulta vai por URL e uma fatura de cartão tem centenas de
 *  títulos — a lista inteira de uma vez estoura o limite e volta vazia. */
export async function lerNotas(cods: string[]): Promise<Map<string, NotaLancamento>> {
  const m = new Map<string, NotaLancamento>();
  if (!cods.length) return m;
  const BLOCO = 150;
  const blocos: string[][] = [];
  for (let i = 0; i < cods.length; i += BLOCO) blocos.push(cods.slice(i, i + BLOCO));
  const respostas = await Promise.all(blocos.map((bloco) =>
    db.from("demonstracoes_lancamento_nota")
      .select("cod_titulo,texto,autor_nome,atualizado_em")
      .in("cod_titulo", bloco)));
  for (const { data } of respostas) {
    for (const n of (data as NotaLancamento[]) ?? []) m.set(n.cod_titulo, n);
  }
  return m;
}

/** "Henrique · 13/08 14:20" — quem escreveu e quando, para a frase ter dono. */
export function carimboNota(n: NotaLancamento): string {
  const d = new Date(n.atualizado_em);
  const quando = isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return [n.autor_nome, quando].filter(Boolean).join(" · ");
}

export function BotaoNota({
  codTitulo, nota, contexto, onSalvo, className,
}: {
  codTitulo: string;
  nota?: NotaLancamento;
  /** De onde a nota está sendo escrita — vira rastro na linha, não chave. */
  contexto: { tipo: "dre" | "dfc"; rubrica: string; mes: string; contraparte: string | null; titulo: string };
  onSalvo: (nota: NotaLancamento | null) => void;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(nota?.texto ?? "");
  const [salvando, setSalvando] = useState(false);

  /* Reabrir a caixa recomeça do que está gravado: uma edição abandonada não
     pode reaparecer como se fosse a nota. */
  useEffect(() => { if (aberto) setTexto(nota?.texto ?? ""); }, [aberto, nota?.texto]);

  const salvar = async (novoTexto: string) => {
    setSalvando(true);
    const { data, error } = await db.rpc("lancamento_nota_salvar", {
      p_cod_titulo: codTitulo,
      p_texto: novoTexto,
      p_tipo: contexto.tipo,
      p_rubrica: contexto.rubrica,
      p_mes: contexto.mes,
      p_contraparte: contexto.contraparte,
    });
    setSalvando(false);
    if (error) { toast.error("Não consegui salvar a justificativa: " + error.message); return; }
    /* Texto em branco apaga, e a função devolve nulo — é o mesmo caminho do
       botão de apagar, então nada aqui precisa saber qual dos dois foi. */
    const salva = (data as NotaLancamento | null) ?? null;
    onSalvo(salva);
    setAberto(false);
    toast.success(salva ? "Justificativa salva." : "Justificativa apagada.");
  };

  const tem = !!nota;
  const mudou = texto.trim() !== (nota?.texto ?? "").trim();

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        {/* Sem nota o botão só aparece no hover da linha: 264 ícones acesos numa
            lista de fatura seriam ruído. Com nota ele fica sempre visível — é
            marca de que alguém já explicou esta linha. */}
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={nota
            ? `${nota.texto}${carimboNota(nota) ? `\n\n— ${carimboNota(nota)}` : ""}`
            : "Escrever uma justificativa para este lançamento"}
          className={cn(
            "shrink-0 rounded transition",
            tem
              ? "text-violet-600 hover:text-violet-800"
              : "text-transparent group-hover/linha:text-muted-foreground/70 hover:!text-foreground",
            aberto && "!text-violet-700",
            className,
          )}
        >
          <MessageSquareText className={cn("h-3 w-3", tem && "fill-violet-100")} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" className="w-[340px] p-0" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-3 py-2">
          <div className="text-[11.5px] font-semibold text-foreground">Justificativa deste lançamento</div>
          <div className="truncate text-[10.5px] text-muted-foreground" title={contexto.titulo}>
            {contexto.titulo}
          </div>
        </div>

        <div className="p-3">
          <textarea
            autoFocus
            rows={4}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && mudou) { e.preventDefault(); void salvar(texto); }
            }}
            placeholder="O que aconteceu aqui? Ex.: reembolso da viagem do evento em SP, aprovado pelo Henrique."
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[12px] leading-relaxed outline-none transition focus:border-primary/60"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-muted-foreground">
              {nota ? carimboNota(nota) : "Ctrl+Enter salva"}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {tem && (
                <button
                  onClick={() => salvar("")}
                  disabled={salvando}
                  title="Apagar a justificativa"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-primary disabled:opacity-50"
                >
                  <Trash2 className="h-2.5 w-2.5" /> Apagar
                </button>
              )}
              <button
                onClick={() => salvar(texto)}
                disabled={salvando || !mudou}
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[10.5px] font-semibold text-background transition hover:opacity-90 disabled:opacity-40"
              >
                {salvando && <Loader2 className="h-2.5 w-2.5 animate-spin" />} Salvar
              </button>
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
