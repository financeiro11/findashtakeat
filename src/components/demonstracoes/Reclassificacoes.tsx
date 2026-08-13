import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { DetalheStatus, SegmentoStatus, SeloPendencia } from "@/components/demonstracoes/BarraStatus";

/* ---------------------------------------------------------------------------
 * Alerta de reclassificação na célula da DRE/DFC.
 *
 * O banco (migration 20260804120000) compara cada lançamento com a rubrica em
 * que aquele fornecedor vinha caindo nos meses anteriores e guarda as
 * divergências em `omie_reclassificacoes`. Aqui a tela só marca a célula que
 * contém alguma — o detalhe fica no drill-down, que é onde os lançamentos já
 * estão listados.
 *
 * Uma chamada por página: o RPC devolve só as células que têm alerta (dezenas),
 * não os lançamentos.
 * ------------------------------------------------------------------------- */

export type Severidade = "alta" | "media" | "baixa";

export type AlertaCelula = {
  alertas: number;
  severidade: Severidade;
  valorTotal: number;
};

export const chaveCelula = (rubrica: string, mes: string) => `${rubrica}|${mes}`;

export function useReclassificacoes(tipo: "dre" | "dfc") {
  const [mapa, setMapa] = useState<Map<string, AlertaCelula>>(new Map());

  const recarregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("demonstracoes_reclassificacoes", { p_tipo: tipo });
    if (error) {
      // Alerta é acessório: se a consulta falhar, a demonstração continua na
      // tela sem marca nenhuma em vez de derrubar a página inteira.
      setMapa(new Map());
      return;
    }
    const m = new Map<string, AlertaCelula>();
    for (const r of data ?? []) {
      m.set(chaveCelula(r.rubrica, r.mes), {
        alertas: Number(r.alertas) || 0,
        severidade: (r.severidade ?? "baixa") as Severidade,
        valorTotal: Number(r.valor_total) || 0,
      });
    }
    setMapa(m);
  }, [tipo]);

  useEffect(() => { recarregar(); }, [recarregar]);

  return { reclassificacoes: mapa, recarregarReclassificacoes: recarregar };
}

/** Texto do `title` da célula — o mesmo que explica o porquê da marca. */
export function tituloReclassificacao(a: AlertaCelula): string {
  const n = a.alertas === 1
    ? "1 lançamento com classificação fora do padrão do fornecedor"
    : `${a.alertas} lançamentos com classificação fora do padrão do fornecedor`;
  return `${n} (${valorExato(a.valorTotal)})`;
}

/** Marca dentro da célula, na fila à esquerda do número. A caixa de 18px é a
 *  mesma do balão e do lápis: as marcas ficam alinhadas e separadas, em vez de
 *  encostadas uma na outra. */
export function MarcaReclassificacao({ alerta }: { alerta: AlertaCelula }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <TriangleAlert
        strokeWidth={2.5}
        className={cn(
          "h-3.5 w-3.5",
          // Triângulo PREENCHIDO: em contorno fino de 12px o aviso sumia no meio
          // da grade. A severidade muda a intensidade do preenchimento, mas
          // nenhuma delas é discreta — alerta que não se vê não é alerta.
          alerta.severidade === "alta" ? "fill-amber-400 text-amber-800"
            : alerta.severidade === "media" ? "fill-amber-300 text-amber-800"
            : "fill-amber-200 text-amber-700",
        )}
      />
    </span>
  );
}

/** Fundo da célula marcada — mantém DRE e DFC com o mesmo peso visual. */
export function fundoCelulaReclassificacao(alerta: AlertaCelula): string {
  return alerta.severidade === "alta"
    ? "bg-amber-100 ring-1 ring-inset ring-amber-300"
    : alerta.severidade === "media"
      ? "bg-amber-100/70"
      : "bg-amber-50";
}

/** Resumo acima da tabela — sem ele, marcas espalhadas na grade passam batido. */
export function ResumoReclassificacoes({ mapa }: { mapa: Map<string, AlertaCelula> }) {
  if (!mapa.size) return null;
  const total = [...mapa.values()].reduce((s, a) => s + a.alertas, 0);
  const fortes = [...mapa.values()].filter(a => a.severidade === "alta").length;

  return (
    <SegmentoStatus
      icone={<TriangleAlert strokeWidth={2.2} className="h-[13px] w-[13px] fill-amber-300 text-amber-700" />}
      valor={total}
      rotulo={total === 1 ? "fora do padrão" : "fora do padrão"}
      selo={
        fortes > 0
          ? <SeloPendencia titulo="Mesmo valor de sempre numa rubrica diferente — o sinal mais forte de classificação trocada.">
              {fortes} {fortes === 1 ? "forte" : "fortes"}
            </SeloPendencia>
          : undefined
      }
      titulo={`${total} ${total === 1 ? "lançamento caiu" : "lançamentos caíram"} numa rubrica diferente da que o fornecedor vinha usando, em ${mapa.size} ${mapa.size === 1 ? "célula" : "células"}.`}
      larguraDetalhe={340}
      detalhe={
        <DetalheStatus
          titulo="Lançamentos fora do padrão do fornecedor"
          nota="Só meses destravados entram: mês fechado se corrige no ERP. Clique na célula marcada na grade para ver quais lançamentos são."
        >
          <div className="px-3 py-2 text-[11.5px] leading-relaxed text-foreground">
            <b>{total}</b> {total === 1 ? "lançamento caiu" : "lançamentos caíram"} numa rubrica diferente
            da que o fornecedor vinha usando, em <b>{mapa.size}</b> {mapa.size === 1 ? "célula" : "células"}
            {fortes > 0 && <> — <b>{fortes}</b> com valor igual ao de sempre, o sinal mais forte de classificação trocada</>}.
          </div>
        </DetalheStatus>
      }
    />
  );
}
