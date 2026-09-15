import { useEffect, useMemo, useState } from "react";
import { CreditCard, Info, Loader2, Lock, Search, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalize } from "@/lib/normalize";
import { useApelidos } from "@/hooks/useApelidos";
import { abrev, fmtBRL } from "@/pages/cartao/valores";
import { intStr } from "@/pages/cartao/fmt";
import {
  SEM_DEPARTAMENTO, categoriasDoDepartamento, coberturaDepartamento, dataCurta, fimDoMes, rotularLancamento, rotuloPeriodo,
  type Base, type LancamentosPlano, type LinhaDepartamento, type Recorte, type ResumoPlano,
} from "@/lib/planoContas";
import { Chip, Secao, Variacao } from "./comum";
import { Evolucao } from "./AnaliseCategoria";

/* ---------------------------------------------------------------------------
 * Um departamento do Omie: de que despesas ele é feito.
 *
 * Departamento é a distribuição do título no Omie — só existe em conta a pagar,
 * e em ~28% delas (medido em ago/26). Por isso a visão olha só as despesas e
 * "Sem departamento" é uma linha de verdade, não um resto escondido.
 * ------------------------------------------------------------------------- */

const db = supabase as unknown as {
  rpc: (n: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const PASSO = 150;

export function AnaliseDepartamento({ linha, resumo, recorte, base, onAbrirCategoria }: {
  linha: LinhaDepartamento;
  resumo: ResumoPlano;
  recorte: Recorte;
  base: Base;
  onAbrirCategoria: (codigo: string) => void;
}) {
  const mapa = useApelidos();
  const [dados, setDados] = useState<LancamentosPlano | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(PASSO);

  const categorias = useMemo(() => categoriasDoDepartamento(resumo, recorte, linha.codigo), [resumo, recorte, linha.codigo]);
  const nomesCategoria = useMemo(() => new Map(resumo.categorias.map((c) => [c.codigo, c.descricao])), [resumo.categorias]);
  const media = recorte.meses.length ? linha.stats.total / recorte.meses.length : 0;
  const de = `${recorte.meses[0]}-01`;
  const ate = fimDoMes(recorte.meses[recorte.meses.length - 1]);

  useEffect(() => {
    setDados(null);
    setErro(null);
    setLimite(PASSO);
    let vivo = true;
    // Prefixo "2": só as despesas, igual ao total do departamento.
    db.rpc("plano_contas_lancamentos", { p_codigo: "2", p_base: base, p_de: de, p_ate: ate, p_departamento: linha.codigo })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setErro(error.message); return; }
        setDados((data ?? null) as LancamentosPlano | null);
      });
    return () => { vivo = false; };
  }, [linha.codigo, base, de, ate]);

  const linhas = useMemo(() => {
    const lista = (dados?.lancamentos ?? []).map((l) => ({ l, ...rotularLancamento(l, mapa) }));
    const termos = normalize(busca).toLowerCase().split(/\s+/).filter(Boolean);
    const filtradas = termos.length
      ? lista.filter((x) => {
          const alvo = normalize([x.nome, x.cru, x.l.titulo, x.l.observacao, x.l.nota, x.l.categoria, nomesCategoria.get(x.l.categoria)].filter(Boolean).join(" ")).toLowerCase();
          return termos.every((t) => alvo.includes(t));
        })
      : lista;
    return [...filtradas].sort((a, b) => Math.abs(b.l.valor_departamento ?? b.l.valor) - Math.abs(a.l.valor_departamento ?? a.l.valor));
  }, [dados, mapa, busca, nomesCategoria]);

  const soma = useMemo(() => (dados?.lancamentos ?? []).reduce((s, l) => s - Number(l.valor_departamento ?? l.valor), 0), [dados]);
  const periodo = rotuloPeriodo(recorte.meses);

  return (
    <div className="space-y-3.5">
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {linha.codigo !== SEM_DEPARTAMENTO && <span className="font-mono text-[11px] text-muted-foreground">{linha.codigo}</span>}
          <Chip tom="destaque">Departamento do Omie</Chip>
          {linha.inativo && <Chip tom="atencao">Inativo no Omie</Chip>}
        </div>
        <h2 className="mt-1.5 text-[18px] font-semibold tracking-tight text-foreground">{linha.descricao}</h2>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {linha.codigo === SEM_DEPARTAMENTO
            ? "Despesas cujo título não tem distribuição por departamento no Omie."
            : "Despesas cujo título foi distribuído a este departamento no Omie, pelo percentual da distribuição."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi rotulo={`Total · ${periodo}`}>
          <div className="num text-[20px] font-semibold">{abrev(linha.stats.total)}</div>
          <div className="text-[11px] text-muted-foreground">
            {recorte.comBase
              ? <><Variacao v={linha.stats.variacao} despesa /> contra {rotuloPeriodo(recorte.anteriores)}</>
              : "sem base de comparação"}
          </div>
        </Kpi>
        <Kpi rotulo="Média mensal">
          <div className="num text-[20px] font-semibold">{abrev(media)}</div>
          <div className="text-[11px] text-muted-foreground">{recorte.meses.length} {recorte.meses.length === 1 ? "mês fechado" : "meses fechados"}</div>
        </Kpi>
        <Kpi rotulo="Lançamentos">
          <div className="num text-[20px] font-semibold">{intStr(linha.stats.lancamentos)}</div>
          <div className="text-[11px] text-muted-foreground">no período</div>
        </Kpi>
        <Kpi rotulo="Categorias">
          <div className="num text-[20px] font-semibold">{intStr(categorias.filter((c) => Math.abs(c.stats.total) >= 0.005).length)}</div>
          <div className="text-[11px] text-muted-foreground">de despesa, com valor</div>
        </Kpi>
      </div>

      <Evolucao serie={linha.stats.serie} recorte={recorte} hoje={resumo.hoje} media={media} />

      <Secao titulo="De que o departamento é feito" nota="Categorias de despesa · clique para abrir a categoria">
        {categorias.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Nenhuma despesa neste departamento na janela.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-1.5 font-medium">Categoria</th>
                  <th className="pb-1.5 text-right font-medium">Total</th>
                  <th className="pb-1.5 text-right font-medium">Parte</th>
                  {recorte.comBase && <th className="pb-1.5 text-right font-medium">%</th>}
                </tr>
              </thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.codigo} onClick={() => onAbrirCategoria(c.codigo)} className="cursor-pointer border-t border-border/60 transition hover:bg-secondary">
                    <td className="max-w-[340px] py-1.5 pr-2">
                      <div className="truncate font-medium text-foreground">{c.descricao}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{c.codigo}</div>
                    </td>
                    <td className="num py-1.5 text-right">{abrev(c.stats.total)}</td>
                    <td className="num py-1.5 text-right text-muted-foreground">
                      {Math.abs(linha.stats.total) >= 0.005 ? `${Math.round((c.stats.total / linha.stats.total) * 100)}%` : "—"}
                    </td>
                    {recorte.comBase && <td className="py-1.5 text-right"><Variacao v={c.stats.variacao} despesa /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      {erro ? (
        <div className="card-surface flex items-start gap-2 p-4 text-[12.5px] text-neg">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Não consegui ler os lançamentos: {erro}
        </div>
      ) : !dados ? (
        <div className="card-surface flex items-center gap-2 p-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lendo os lançamentos…
        </div>
      ) : (
        <Secao
          titulo="Lançamentos"
          nota={<>
            {intStr(dados.lancamentos.length)} em {periodo} · soma {fmtBRL(soma)} · do maior para o menor
            {dados.ocultos > 0 && <> · <Lock className="inline h-3 w-3" /> {dados.ocultos} de folha ocultos</>}
          </>}
          acao={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(PASSO); }} placeholder="Buscar nome, categoria…" className="h-8 w-[220px] pl-7 text-[12px]" />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-1.5 font-medium">Data</th>
                  <th className="pb-1.5 font-medium">Contraparte</th>
                  <th className="pb-1.5 font-medium">Categoria</th>
                  <th className="pb-1.5 font-medium">Status</th>
                  <th className="pb-1.5 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, limite).map((x, i) => (
                  <tr key={`${x.l.cod_titulo ?? "s"}-${i}`} className="border-t border-border/60 align-top">
                    <td className="num whitespace-nowrap py-1.5 pr-2 text-muted-foreground">{dataCurta(x.l.data)}</td>
                    <td className="max-w-[260px] py-1.5 pr-2">
                      <div className="flex items-center gap-1 truncate font-medium text-foreground">
                        {x.cartao && <CreditCard className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        <span className="truncate" title={x.nome}>{x.nome}</span>
                      </div>
                      {x.cru && x.cru !== x.nome && <div className="truncate text-[10.5px] text-muted-foreground">{x.cru}</div>}
                    </td>
                    <td className="max-w-[240px] py-1.5 pr-2">
                      <div className="truncate text-foreground/90">{nomesCategoria.get(x.l.categoria) ?? x.l.categoria}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{x.l.categoria}</div>
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-[11px] text-muted-foreground">{x.l.status ?? "—"}</td>
                    <td className="num whitespace-nowrap py-1.5 text-right">{fmtBRL(-Number(x.l.valor_departamento ?? x.l.valor))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linhas.length > limite && (
            <button type="button" onClick={() => setLimite((n) => n + PASSO)} className="mt-2 text-[11.5px] font-medium text-primary hover:underline">
              Mostrar mais {Math.min(PASSO, linhas.length - limite)} de {intStr(linhas.length - limite)} restantes
            </button>
          )}
        </Secao>
      )}
    </div>
  );
}

/** O que a visão por departamento mostra antes de escolher um. */
export function PanoramaDepartamentos({ linhas, carregados, recorte }: {
  linhas: LinhaDepartamento[];
  carregados: boolean;
  recorte: Recorte;
}) {
  const cobertura = coberturaDepartamento(linhas.map((l) => ({ codigo: l.codigo, total: l.stats.total })));
  const total = linhas.reduce((s, l) => s + l.stats.total, 0);
  const sem = linhas.find((l) => l.codigo === SEM_DEPARTAMENTO)?.stats.total ?? 0;

  return (
    <div className="space-y-3.5">
      <div className="card-surface flex items-start gap-2.5 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1.5">
          <p>
            Departamento é a <b>distribuição do título no Omie</b>. No Omie desta empresa ela só aparece em contas a pagar —
            por isso esta visão olha só as despesas. Escolha um departamento na lista para ver de que categorias ele é feito.
          </p>
          <p>
            Não confunda com o sufixo do nome da categoria (“Pessoal - Comercial”): esse é o jeito da casa de separar áreas
            dentro do plano de contas, e continua valendo na visão por categoria.
          </p>
        </div>
      </div>

      <Secao titulo={`Cobertura em ${rotuloPeriodo(recorte.meses)}`}>
        {!carregados ? (
          <p className="text-[12.5px] text-muted-foreground">
            Os departamentos do Omie ainda não chegaram ao Hub: entram na próxima leitura do Omie (a varredura diária, ou
            “Atualizar do Omie” no Caixa). Até lá, tudo apareceria como “Sem departamento”.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="num text-[26px] font-semibold">{cobertura === null ? "—" : `${Math.round(cobertura * 100)}%`}</span>
              <span className="text-[12.5px] text-muted-foreground">do valor das despesas tem departamento no Omie</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("absolute inset-y-0 left-0 bg-primary")} style={{ width: `${Math.max(0, Math.min(100, (cobertura ?? 0) * 100))}%` }} />
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              {fmtBRL(total - sem)} com departamento · {fmtBRL(sem)} sem. Medido em ago/26: quem tem departamento é sobretudo a folha.
            </p>
          </div>
        )}
      </Secao>
    </div>
  );
}

function Kpi({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-3.5">
      <div className="mb-1 truncate text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{rotulo}</div>
      {children}
    </div>
  );
}
