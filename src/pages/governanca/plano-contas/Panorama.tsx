import { useMemo } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { abrev } from "@/pages/cartao/valores";
import { abrevStr } from "@/pages/cartao/fmt";
import { rotuloPeriodo, sinaisDaCategoria, type Base, type NoPlano, type Recorte } from "@/lib/planoContas";
import { Secao, Variacao } from "./comum";

/**
 * O que a tela mostra antes de alguém escolher uma categoria.
 *
 * Não é um resumo decorativo: são as categorias que pedem que se olhe para elas —
 * os sinais escritos por regra e as maiores variações em VALOR. Variação em
 * porcentagem sozinha poria no topo a categoria que foi de R$ 12 para R$ 90.
 */
export function Panorama({ folhas, base, recorte, onSelecionar }: {
  folhas: NoPlano[];
  base: Base;
  recorte: Recorte;
  onSelecionar: (codigo: string) => void;
}) {
  const sinais = useMemo(
    () => folhas
      .flatMap((no) => sinaisDaCategoria(no, base, null, abrevStr).map((s) => ({ no, s })))
      .sort((a, b) =>
        a.s.gravidade !== b.s.gravidade
          ? (a.s.gravidade === "atencao" ? -1 : 1)
          : Math.abs(b.no.stats.total) - Math.abs(a.no.stats.total)),
    [folhas, base],
  );

  const variacoes = useMemo(
    () => folhas
      .filter((f) => f.stats.anterior !== null)
      .map((f) => ({ f, delta: f.stats.total - (f.stats.anterior ?? 0) }))
      .filter((x) => Math.abs(x.delta) >= 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 10),
    [folhas],
  );

  const periodo = rotuloPeriodo(recorte.meses);
  const anterior = rotuloPeriodo(recorte.anteriores);

  return (
    <div className="space-y-3.5">
      <div className="card-surface flex items-start gap-2.5 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Escolha uma categoria na árvore — ou um grupo, que soma as categorias dele — para ver a evolução mês a mês,
          quem concentra o valor, os lançamentos e as trocas de categoria. Abaixo, o que salta em <b>{periodo}</b>.
        </p>
      </div>

      <Secao
        titulo="O que salta no período"
        nota={`${sinais.length} ${sinais.length === 1 ? "sinal" : "sinais"} · regra escrita, não IA · a concentração por contraparte aparece ao abrir a categoria`}
      >
        {sinais.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Nenhuma categoria acendeu sinal neste período.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {sinais.slice(0, 14).map(({ no, s }, i) => (
              <li key={`${no.codigo}-${s.tipo}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelecionar(no.codigo)}
                  className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-2 text-left transition hover:bg-secondary"
                >
                  {s.gravidade === "atencao"
                    ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                    : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-foreground">
                      {no.descricao} <span className="font-mono text-[10.5px] font-normal text-muted-foreground">{no.codigo}</span>
                    </span>
                    <span className="block text-[11.5px] text-muted-foreground">{s.texto}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Maiores variações em valor"
        nota={recorte.comBase
          ? `${periodo} contra ${anterior}`
          : `Sem comparação: ${anterior} cai antes do começo dos dados do Omie no Hub`}
      >
        {!recorte.comBase || variacoes.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            {recorte.comBase ? "Nenhuma categoria mudou de valor." : "Escolha um período mais curto para comparar."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-1.5 font-medium">Categoria</th>
                  <th className="pb-1.5 text-right font-medium">{anterior}</th>
                  <th className="pb-1.5 text-right font-medium">{periodo}</th>
                  <th className="pb-1.5 text-right font-medium">Δ</th>
                  <th className="pb-1.5 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {variacoes.map(({ f, delta }) => {
                  const favoravel = f.despesa ? delta < 0 : delta > 0;
                  return (
                    <tr
                      key={f.codigo}
                      onClick={() => onSelecionar(f.codigo)}
                      className="cursor-pointer border-t border-border/60 transition hover:bg-secondary"
                    >
                      <td className="max-w-[260px] py-1.5 pr-2">
                        <div className="truncate font-medium text-foreground">{f.descricao}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {f.codigo} · {f.despesa ? "despesa" : "receita"}
                        </div>
                      </td>
                      <td className="num py-1.5 text-right text-muted-foreground">{abrev(f.stats.anterior)}</td>
                      <td className="num py-1.5 text-right">{abrev(f.stats.total)}</td>
                      <td className={cn("num py-1.5 text-right", favoravel ? "text-pos" : "text-neg")}>
                        {delta > 0 ? "+" : ""}{abrev(delta)}
                      </td>
                      <td className="py-1.5 text-right"><Variacao v={f.stats.variacao} despesa={f.despesa} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  );
}
