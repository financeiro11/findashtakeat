import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { linkCelula, mesDaChave, tipoDaBase } from "@/lib/linksPlanoContas";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRightLeft, ArrowUpRight, CreditCard, History, Info, Loader2, Lock, MessageSquareText, Pencil, Search, Tags, TriangleAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { normalize } from "@/lib/normalize";
import { useApelidos } from "@/hooks/useApelidos";
import { abrev, fmtBRL } from "@/pages/cartao/valores";
import { abrevStr, intStr } from "@/pages/cartao/fmt";
import {
  SEM_DEPARTAMENTO, concentracao, coberturaDepartamento, dataCurta, ehPosicaoLivre, fimDoMes, noSentido, porStatus,
  rotularLancamento, rotuloMes, rotuloPeriodo, sinaisDaCategoria,
  chaveMarca, type MarcaFora,
  type AlteracaoCadastro, type Base, type CategoriaPlano, type SuspeitoReclassificacao, type LancamentoPlano, type LancamentosPlano, type LinhaContraparte,
  type LinhaDepartamentoDaCategoria, type NoPlano, type Recorte, type RotuloLancamento,
} from "@/lib/planoContas";
import { Chip, Secao, Variacao } from "./comum";
import type { Operacao } from "./EditarCategoria";

/* `types.ts` é gerado e ainda não conhece as RPCs do plano de contas. */
const db = supabase as unknown as {
  rpc: (n: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const REGRA_NOTA: Record<string, { rotulo: string; dica: string }> = {
  exige: { rotulo: "Exige nota", dica: "Título nesta categoria precisa de nota de fornecedor no ERP" },
  dispensa: { rotulo: "Dispensa nota", dica: "Não há nota de fornecedor para este tipo de saída" },
  conferir: { rotulo: "Nota a conferir", dica: "Depende do caso — a fila de Notas no ERP pergunta" },
};

type Linha = { l: LancamentoPlano } & RotuloLancamento;

export function AnaliseCategoria({
  no, base, recorte, hoje, onSelecionar, podeEditar, onEditar, cadastro, departamentos, nomesDepartamento, onMapear, marcas,
}: {
  no: NoPlano;
  base: Base;
  recorte: Recorte;
  hoje: string;
  onSelecionar: (codigo: string) => void;
  /** capacidade `conciliacao`: cria, renomeia e desativa categorias no Omie */
  podeEditar: boolean;
  onEditar: (op: Operacao) => void;
  /** a trilha do cadastro desta categoria (ou das categorias deste grupo) */
  cadastro: AlteracaoCadastro[];
  /** a divisão por departamento; null em receita, onde o Omie não tem departamento */
  departamentos: { carregados: boolean; linhas: LinhaDepartamentoDaCategoria[] } | null;
  nomesDepartamento: Map<string, string>;
  /** abre o DE-PARA desta categoria; ausente para quem não pode editar */
  onMapear?: (c: CategoriaPlano) => void;
  /** as marcas "fora de propósito", por `codigo|dre|dfc` */
  marcas: ReadonlyMap<string, MarcaFora>;
}) {
  const mapa = useApelidos();
  const [dados, setDados] = useState<LancamentosPlano | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /* Uma ida só: o período em foco e o anterior juntos. A comparação por
     contraparte sai do recorte no cliente. */
  const de = `${recorte.comBase ? recorte.anteriores[0] : recorte.meses[0]}-01`;
  const ate = fimDoMes(recorte.meses[recorte.meses.length - 1]);
  const buscavel = !no.codigo.includes("?");

  useEffect(() => {
    setDados(null);
    if (!buscavel) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    db.rpc("plano_contas_lancamentos", { p_codigo: no.codigo, p_base: base, p_de: de, p_ate: ate })
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (!vivo) return;
        setCarregando(false);
        if (error) { setErro(error.message); return; }
        setDados((data ?? null) as LancamentosPlano | null);
      });
    return () => { vivo = false; };
  }, [no.codigo, base, de, ate, buscavel]);

  /* O nome que a pessoa reconhece: no cartão, o lojista lido da observação do
     título (a contraparte é sempre "Lancamento Fatura Cartao"); nos outros, o
     apelido da Parametrização. O nome cru fica na linha de apoio — é o que se
     procura no Omie. */
  const linhas = useMemo<Linha[]>(
    () => (dados?.lancamentos ?? []).map((l) => ({ l, ...rotularLancamento(l, mapa) })),
    [dados, mapa],
  );

  const nomePorLancamento = useMemo(() => new Map(linhas.map((x) => [x.l, x.nome])), [linhas]);
  const categoriaDoTitulo = useMemo(
    () => new Map((dados?.lancamentos ?? []).filter((l) => l.cod_titulo).map((l) => [String(l.cod_titulo), l.categoria])),
    [dados],
  );
  const titulosSuspeitos = useMemo(() => new Set((dados?.suspeitos ?? []).map((s) => String(s.cod_titulo))), [dados]);
  const anteriores = recorte.comBase ? recorte.anteriores : null;

  const contrapartes = useMemo<LinhaContraparte[] | null>(
    () => dados
      ? concentracao(dados.lancamentos, (l) => nomePorLancamento.get(l) ?? "", no.despesa, recorte.meses, anteriores)
      : null,
    [dados, nomePorLancamento, no.despesa, recorte.meses, anteriores],
  );

  const marcaAtual = marcas.get(chaveMarca(no.codigo, tipoDaBase(base)));
  const sinais = useMemo(
    () => sinaisDaCategoria(no, base, contrapartes, abrevStr, !!marcaAtual),
    [no, base, contrapartes, marcaAtual],
  );
  const status = useMemo(
    () => (dados ? porStatus(dados.lancamentos, no.despesa, recorte.meses) : []),
    [dados, no.despesa, recorte.meses],
  );

  const c = no.categoria;
  const ehGrupo = no.filhos.length > 0;
  const ativas = contrapartes?.filter((x) => x.lancamentos > 0).length ?? null;
  const media = recorte.meses.length ? no.stats.total / recorte.meses.length : 0;
  const ticket = no.stats.lancamentos ? no.stats.total / no.stats.lancamentos : null;
  const periodo = rotuloPeriodo(recorte.meses);
  // O link para a demonstração abre o último mês do período em foco.
  const mesLink = recorte.meses[recorte.meses.length - 1];

  return (
    <div className="space-y-3.5">
      {/* ---------------- Identidade ---------------- */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">{no.codigo}</span>
          <Chip>{no.despesa ? "Despesa" : "Receita"}</Chip>
          {ehGrupo && <Chip tom="destaque">Grupo · {no.filhos.length} categorias</Chip>}
          {c?.inativa && <Chip tom="atencao" title="Marcada como inativa no cadastro do Omie">Inativa no Omie</Chip>}
          {c?.folha && <Chip title="Categoria de folha: os lançamentos só aparecem para quem vê a Remuneração"><Lock className="h-2.5 w-2.5" /> Folha</Chip>}
          {c && !ehGrupo && !c.inativa && c.conta_contabil === null && (
            <Chip tom="atencao" title="A categoria não está ligada a uma conta contábil no Omie — a contabilidade completa lá (a API não preenche)">
              Sem conta contábil
            </Chip>
          )}
          {c?.regra_nota && REGRA_NOTA[c.regra_nota] && (
            <Chip title={REGRA_NOTA[c.regra_nota].dica}>{REGRA_NOTA[c.regra_nota].rotulo}</Chip>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-[18px] font-semibold tracking-tight text-foreground">{no.descricao}</h2>
          {podeEditar && c && (
            <div className="flex flex-wrap gap-1.5">
              {ehGrupo ? (
                !c.inativa && (
                  <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => onEditar({ tipo: "criar", superior: c.codigo })}>
                    Nova categoria neste grupo
                  </Button>
                )
              ) : (
                <>
                  {!ehPosicaoLivre(c.descricao) && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]" onClick={() => onEditar({ tipo: "renomear", categoria: c })}>
                      <Pencil className="h-3 w-3" /> Renomear
                    </Button>
                  )}
                  {/* Sem botão de propósito: o Omie aceita desativar pela API,
                      responde "sucesso" e não desativa (medido em 15/09/2026). */}
                  <span
                    className="self-center text-[11px] text-muted-foreground"
                    title="A API do Omie responde “sucesso” e não muda a categoria. Desative ou reative no Omie; o Hub acompanha na sincronização diária."
                  >
                    {c.inativa ? "Reativar" : "Desativar"}: só no Omie
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {c && !ehGrupo && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <RubricaLink tipo="dre" rubrica={c.rubrica_dre} mes={mesLink} codigo={c.codigo} marca={marcas.get(chaveMarca(c.codigo, "dre"))} />
            <RubricaLink tipo="dfc" rubrica={c.rubrica_dfc} mes={mesLink} codigo={c.codigo} marca={marcas.get(chaveMarca(c.codigo, "dfc"))} />
            {onMapear && !ehPosicaoLivre(c.descricao) && (
              <button
                type="button"
                onClick={() => onMapear(c)}
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
              >
                <Tags className="h-3 w-3" /> {c.rubrica_dre || c.rubrica_dfc ? "Mudar a linha" : "Escolher a linha"}
              </button>
            )}
          </div>
        )}
        {c && !ehGrupo && (
          <div className="mt-1 text-[11.5px] text-muted-foreground">
            {c.usos
              ? `${intStr(c.usos)} lançamento(s) em todo o cache do Omie · último em ${dataCurta(c.ultimo_uso)}`
              : "Nunca usada — nenhum lançamento no cache do Omie"}
            {c.observacao && <> · observação no Omie: “{c.observacao}”</>}
          </div>
        )}
      </div>

      {/* ---------------- Números do período ---------------- */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi rotulo={`Total · ${periodo}`}>
          <div className="num text-[20px] font-semibold">{abrev(no.stats.total)}</div>
          <div className="text-[11px] text-muted-foreground">
            {recorte.comBase
              ? <><Variacao v={no.stats.variacao} despesa={no.despesa} /> contra {rotuloPeriodo(recorte.anteriores)} ({abrevStr(no.stats.anterior)})</>
              : "sem base de comparação"}
          </div>
        </Kpi>
        <Kpi rotulo="Média mensal">
          <div className="num text-[20px] font-semibold">{abrev(media)}</div>
          <div className="text-[11px] text-muted-foreground">{recorte.meses.length} {recorte.meses.length === 1 ? "mês fechado" : "meses fechados"}</div>
        </Kpi>
        <Kpi rotulo="Lançamentos">
          <div className="num text-[20px] font-semibold">{intStr(no.stats.lancamentos)}</div>
          <div className="text-[11px] text-muted-foreground">ticket médio {ticket === null ? "—" : abrev(ticket)}</div>
        </Kpi>
        <Kpi rotulo="Contrapartes">
          <div className="num text-[20px] font-semibold">
            {ativas === null ? (carregando ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : "—") : intStr(ativas)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {contrapartes?.[0] && contrapartes[0].lancamentos > 0
              ? `a maior é ${Math.round(contrapartes[0].participacao * 100)}% do valor`
              : "distintas no período"}
          </div>
        </Kpi>
      </div>

      <Evolucao serie={no.stats.serie} recorte={recorte} hoje={hoje} media={media} />

      {sinais.length > 0 && (
        <Secao titulo="Sinais" nota="Regra escrita, com limiar explícito — não IA">
          <ul className="space-y-1.5">
            {sinais.map((s, i) => (
              <li key={`${s.tipo}-${i}`} className="flex items-start gap-2 text-[12.5px]">
                {s.gravidade === "atencao"
                  ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                  : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="text-foreground/90">{s.texto}</span>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {ehGrupo && <Composicao no={no} comBase={recorte.comBase} onSelecionar={onSelecionar} />}

      {departamentos && <PorDepartamento dados={departamentos} comBase={recorte.comBase} despesa={no.despesa} />}

      {!buscavel ? (
        <div className="card-surface p-4 text-[12.5px] text-muted-foreground">
          Estas categorias estão fora do cadastro do Omie; abra cada uma para ver os lançamentos.
        </div>
      ) : erro ? (
        <div className="card-surface flex items-start gap-2 p-4 text-[12.5px] text-neg">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Não consegui ler os lançamentos: {erro}
        </div>
      ) : !dados ? (
        <div className="card-surface flex items-center gap-2 p-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lendo os lançamentos…
        </div>
      ) : (
        <>
          {dados.ocultos > 0 && (
            <div className="card-surface flex items-start gap-2 p-3 text-[12px] text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {dados.ocultos} lançamento(s) de folha ficam fora da lista e da concentração — só quem vê a Remuneração os enxerga.
              O total acima continua completo.
            </div>
          )}
          <Suspeitos itens={dados.suspeitos ?? []} base={base} categoriaDe={categoriaDoTitulo} />
          {contrapartes && <Contrapartes linhas={contrapartes} despesa={no.despesa} comBase={recorte.comBase} meses={recorte.meses.length} />}
          {status.length > 0 && (
            <Secao titulo="Status dos títulos" nota={`Lançamentos de ${periodo}`}>
              <div className="flex flex-wrap gap-2">
                {status.map((s) => (
                  <div key={s.status} className="rounded-lg border border-border px-3 py-2">
                    <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{s.status}</div>
                    <div className="num text-[14px] font-semibold">{abrev(s.total)}</div>
                    <div className="text-[11px] text-muted-foreground">{intStr(s.n)} lanç.</div>
                  </div>
                ))}
              </div>
            </Secao>
          )}
          <Lancamentos linhas={linhas} no={no} meses={recorte.meses} ocultos={dados.ocultos} nomesDep={nomesDepartamento} suspeitos={titulosSuspeitos} />
          <Alteracoes dados={dados} codigo={no.codigo} />
        </>
      )}

      {cadastro.length > 0 && <HistoricoCadastro itens={cadastro} />}
    </div>
  );
}

const ACAO: Record<AlteracaoCadastro["acao"], string> = {
  criar: "criou", renomear: "renomeou", reaproveitar: "deu nome à posição livre", desativar: "desativou", reativar: "reativou",
};

function HistoricoCadastro({ itens }: { itens: AlteracaoCadastro[] }) {
  return (
    <Secao titulo="Cadastro pelo Hub" nota="Criações, nomes e desativações feitas por esta tela — gravadas no Omie">
      <ul className="divide-y divide-border/60">
        {itens.map((a, i) => (
          <li key={`${a.codigo}-${a.criado_em}-${i}`} className="flex items-start gap-2.5 py-2 text-[12px]">
            <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-foreground">
                <b className="font-medium">{a.por ?? "Alguém"}</b> {ACAO[a.acao] ?? a.acao}{" "}
                <span className="font-mono text-[11px]">{a.codigo}</span>
                {a.acao === "renomear" || a.acao === "reaproveitar"
                  ? <>: {a.descricao_de} → <b className="font-medium">{a.descricao_para}</b></>
                  : <> · {a.descricao_para ?? a.descricao_de}</>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {dataCurta(a.criado_em)}
                {a.rubrica_dre && ` · DRE → ${a.rubrica_dre}`}
                {a.rubrica_dfc && ` · DFC → ${a.rubrica_dfc}`}
                {a.motivo && ` · “${a.motivo}”`}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
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

/* ───────────────────────── Evolução mensal ───────────────────────── */

export function Evolucao({ serie, recorte, hoje, media }: { serie: number[]; recorte: Recorte; hoje: string; media: number }) {
  const atual = hoje.slice(0, 7);
  const foco = new Set(recorte.meses);
  const antes = new Set(recorte.comBase ? recorte.anteriores : []);
  const dados = recorte.serieMeses.map((m, i) => ({
    mes: m, rotulo: rotuloMes(m), v: serie[i] ?? 0,
    foco: foco.has(m), anterior: antes.has(m), andamento: m === atual,
  }));

  const cor = (d: (typeof dados)[number]) =>
    d.foco ? "hsl(var(--primary))"
      : d.anterior ? "hsl(var(--primary) / 0.35)"
        : d.andamento ? "hsl(var(--muted-foreground) / 0.2)"
          : "hsl(var(--muted-foreground) / 0.35)";

  return (
    <Secao
      titulo="Evolução mensal"
      nota={<>
        <span className="text-primary">■</span> período em foco
        {recorte.comBase && <> · <span className="text-primary/40">■</span> período anterior</>}
        {" "}· tracejado = média do período · {rotuloMes(atual)} em andamento, fora da conta
      </>}
    >
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(v: number) => abrevStr(v)} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
              content={({ active, payload }) => {
                const d = active ? payload?.[0]?.payload as (typeof dados)[number] | undefined : undefined;
                if (!d) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-[12px] shadow-md">
                    <div className="font-medium">{d.rotulo}{d.andamento ? " · em andamento" : ""}</div>
                    <div className="num">{valorExato(d.v)}</div>
                  </div>
                );
              }}
            />
            {recorte.meses.length > 1 && (
              <ReferenceLine y={media} stroke="hsl(var(--foreground) / 0.45)" strokeDasharray="4 3" />
            )}
            <Bar dataKey="v" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {dados.map((d) => <Cell key={d.mes} fill={cor(d)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Secao>
  );
}

/* ───────────────────────── Composição do grupo ───────────────────────── */

function Composicao({ no, comBase, onSelecionar }: { no: NoPlano; comBase: boolean; onSelecionar: (c: string) => void }) {
  const filhos = no.filhos
    .filter((f) => Math.abs(f.stats.total) >= 0.005 || Math.abs(f.stats.anterior ?? 0) >= 0.005)
    .sort((a, b) => Math.abs(b.stats.total) - Math.abs(a.stats.total));
  const parados = no.filhos.length - filhos.length;

  return (
    <Secao titulo="De que o grupo é feito" nota={parados ? `${parados} categoria(s) sem movimento ficam fora da tabela` : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-1.5 font-medium">Categoria</th>
              <th className="pb-1.5 text-right font-medium">Total</th>
              <th className="pb-1.5 text-right font-medium">Parte</th>
              {comBase && <th className="pb-1.5 text-right font-medium">Anterior</th>}
              {comBase && <th className="pb-1.5 text-right font-medium">%</th>}
            </tr>
          </thead>
          <tbody>
            {filhos.map((f) => (
              <tr key={f.codigo} onClick={() => onSelecionar(f.codigo)} className="cursor-pointer border-t border-border/60 transition hover:bg-secondary">
                <td className="max-w-[320px] py-1.5 pr-2">
                  <div className="truncate font-medium text-foreground">{f.descricao}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{f.codigo}</div>
                </td>
                <td className="num py-1.5 text-right">{abrev(f.stats.total)}</td>
                <td className="num py-1.5 text-right text-muted-foreground">
                  {Math.abs(no.stats.total) >= 0.005 ? `${Math.round((f.stats.total / no.stats.total) * 100)}%` : "—"}
                </td>
                {comBase && <td className="num py-1.5 text-right text-muted-foreground">{abrev(f.stats.anterior)}</td>}
                {comBase && <td className="py-1.5 text-right"><Variacao v={f.stats.variacao} despesa={f.despesa} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

/* ───────────────────────── Por departamento ───────────────────────── */

function PorDepartamento({ dados, comBase, despesa }: {
  dados: { carregados: boolean; linhas: LinhaDepartamentoDaCategoria[] }; comBase: boolean; despesa: boolean;
}) {
  if (!dados.carregados) {
    return (
      <Secao titulo="Por departamento">
        <p className="text-[12.5px] text-muted-foreground">
          Os departamentos do Omie ainda não chegaram ao Hub: entram na próxima leitura do Omie (a varredura diária, ou
          “Atualizar do Omie” no Caixa).
        </p>
      </Secao>
    );
  }
  if (!dados.linhas.length) return null;
  const com = dados.linhas.filter((l) => l.codigo !== SEM_DEPARTAMENTO);
  const cobertura = coberturaDepartamento(dados.linhas);

  return (
    <Secao
      titulo="Por departamento"
      nota={com.length
        ? `${cobertura === null ? "—" : `${Math.round(cobertura * 100)}%`} do valor tem departamento no Omie · o lançamento entra pelo percentual da distribuição`
        : "Nenhum lançamento desta categoria no período tem departamento no Omie"}
    >
      {com.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-1.5 font-medium">Departamento</th>
                <th className="pb-1.5 text-right font-medium">Total</th>
                <th className="pb-1.5 text-right font-medium">Parte</th>
                {comBase && <th className="pb-1.5 text-right font-medium">Anterior</th>}
                {comBase && <th className="pb-1.5 text-right font-medium">%</th>}
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l) => (
                <tr key={l.codigo} className={cn("border-t border-border/60", l.codigo === SEM_DEPARTAMENTO && "text-muted-foreground")}>
                  <td className="py-1.5 pr-2 font-medium">{l.descricao}</td>
                  <td className="num py-1.5 text-right">{abrev(l.total)}</td>
                  <td className="num py-1.5 text-right text-muted-foreground">{Math.round(l.participacao * 100)}%</td>
                  {comBase && <td className="num py-1.5 text-right text-muted-foreground">{abrev(l.anterior)}</td>}
                  {comBase && <td className="py-1.5 text-right"><Variacao v={l.variacao} despesa={despesa} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  );
}

/* ───────────────────────── Ligações com a DRE/DFC ───────────────────────── */

function RubricaLink({ tipo, rubrica, mes, codigo, marca }: {
  tipo: "dre" | "dfc"; rubrica: string | null; mes: string; codigo: string; marca?: MarcaFora;
}) {
  const nome = tipo.toUpperCase();
  if (!rubrica && marca) {
    return (
      <span title={`${marca.motivo ?? "Fica fora de propósito"} — ${marca.marcado_por_email ?? "financeiro"} em ${dataCurta(marca.marcado_em)}`}>
        {nome} → <span className="text-muted-foreground">fora de propósito</span>
      </span>
    );
  }
  if (!rubrica) return <span>{nome} → <span className="text-warn">fora do DE-PARA</span></span>;
  return (
    <span>
      {nome} →{" "}
      <Link
        to={linkCelula({ tipo, rubrica, mes, categorias: [codigo] })}
        title={`Abrir ${rubrica} · ${rotuloMes(mes)} na ${nome}, com a lista filtrada nesta categoria`}
        className="inline-flex items-center gap-0.5 font-medium text-foreground hover:underline"
      >
        {rubrica} <ArrowUpRight className="h-3 w-3" />
      </Link>
    </span>
  );
}

/* O alerta de reclassificação da DRE/DFC, do lado da categoria. A decisão
   (trocar, "está certo", "pode cair nas duas") continua na célula — é lá que o
   botão existe e que a trilha é gravada. */
function Suspeitos({ itens, base, categoriaDe }: {
  itens: SuspeitoReclassificacao[]; base: Base; categoriaDe: Map<string, string>;
}) {
  if (!itens.length) return null;
  const tipo = tipoDaBase(base);
  const nome = tipo.toUpperCase();
  return (
    <Secao
      titulo="Classificação suspeita"
      nota={`${itens.length} lançamento(s) numa rubrica da ${nome} diferente da que o fornecedor vinha usando · a decisão é na célula`}
    >
      <ul className="divide-y divide-border/60">
        {itens.map((s) => {
          const mes = mesDaChave(s.mes);
          const categoria = categoriaDe.get(String(s.cod_titulo));
          return (
            <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-[12px]">
              <TriangleAlert className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.severidade === "alta" ? "text-warn" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <div className="text-foreground">
                  <b className="font-medium">{s.fornecedor ?? "Lançamento"}</b> · <span className="num">{fmtBRL(Math.abs(Number(s.valor)))}</span>
                  {mes && <span className="text-muted-foreground"> · {rotuloMes(mes)}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Caiu em <b className="font-medium text-foreground">{s.rubrica}</b>
                  {s.rubrica_padrao && <> — costumava cair em <b className="font-medium text-foreground">{s.rubrica_padrao}</b></>}
                  {s.hist_lancamentos ? ` (${s.hist_no_padrao ?? 0} de ${s.hist_lancamentos} lançamentos)` : ""}
                </div>
              </div>
              <Link
                to={linkCelula({ tipo, rubrica: s.rubrica, mes: s.mes, categorias: categoria ? [categoria] : [] })}
                className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium hover:bg-secondary"
              >
                Decidir na {nome} <ArrowUpRight className="h-3 w-3" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}

/* ───────────────────────── Contrapartes ───────────────────────── */

const SITUACAO: Record<string, string> = { novo: "novo", sumiu: "sumiu", subiu: "subiu", caiu: "caiu", estavel: "estável" };

function Contrapartes({ linhas, despesa, comBase, meses }: {
  linhas: LinhaContraparte[]; despesa: boolean; comBase: boolean; meses: number;
}) {
  const [todas, setTodas] = useState(false);
  const visiveis = todas ? linhas : linhas.slice(0, 12);
  const ativas = linhas.filter((l) => l.lancamentos > 0);
  const oitenta = ativas.findIndex((l) => l.acumulado >= 0.8) + 1;

  if (!linhas.length) return null;

  return (
    <Secao
      titulo="Quem concentra o valor"
      nota={`${ativas.length} contraparte(s) no período${oitenta ? ` · ${oitenta} fazem 80% do valor` : ""} · agrupado pelo nome exibido (apelido ou lojista do cartão)`}
      acao={linhas.length > 12 && (
        <button type="button" onClick={() => setTodas((v) => !v)} className="text-[11.5px] font-medium text-primary hover:underline">
          {todas ? "Mostrar só as 12 maiores" : `Mostrar todas (${linhas.length})`}
        </button>
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-1.5 font-medium">Contraparte</th>
              <th className="pb-1.5 text-right font-medium">Total</th>
              <th className="w-[120px] pb-1.5 pl-3 font-medium">Parte · acumulado</th>
              <th className="pb-1.5 text-right font-medium" title="Em quantos meses do período apareceu">Meses</th>
              {comBase && <th className="pb-1.5 text-right font-medium">Anterior</th>}
              {comBase && <th className="pb-1.5 pl-2 text-right font-medium">Situação</th>}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => {
              const ruim = despesa ? l.situacao === "subiu" || l.situacao === "novo" : l.situacao === "caiu" || l.situacao === "sumiu";
              const boa = despesa ? l.situacao === "caiu" || l.situacao === "sumiu" : l.situacao === "subiu" || l.situacao === "novo";
              return (
                <tr key={l.nome} className={cn("border-t border-border/60", l.lancamentos === 0 && "text-muted-foreground")}>
                  <td className="max-w-[260px] py-1.5 pr-2">
                    <div className="truncate font-medium">{l.nome}</div>
                    <div className="text-[10.5px] text-muted-foreground">{intStr(l.lancamentos)} lanç.</div>
                  </td>
                  <td className="num py-1.5 text-right">{l.lancamentos ? abrev(l.total) : "—"}</td>
                  <td className="py-1.5 pl-3">
                    {l.lancamentos > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="absolute inset-y-0 left-0 bg-primary/25" style={{ width: `${Math.min(100, Math.max(0, l.acumulado * 100))}%` }} />
                          <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(100, Math.max(0, l.participacao * 100))}%` }} />
                        </div>
                        <span className="num w-9 text-right text-[11px] text-muted-foreground">{Math.round(l.participacao * 100)}%</span>
                      </div>
                    )}
                  </td>
                  <td className="num py-1.5 text-right text-muted-foreground">{l.mesesPresente}/{meses}</td>
                  {comBase && <td className="num py-1.5 text-right text-muted-foreground">{l.anterior ? abrev(l.anterior) : "—"}</td>}
                  {comBase && (
                    <td className="py-1.5 pl-2 text-right">
                      {l.situacao && <Chip tom={ruim ? "neg" : boa ? "pos" : "neutro"}>{SITUACAO[l.situacao]}</Chip>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

/* ───────────────────────── Lançamentos ───────────────────────── */

const PASSO = 150;

function Lancamentos({ linhas, no, meses, ocultos, nomesDep, suspeitos }: {
  linhas: Linha[]; no: NoPlano; meses: string[]; ocultos: number; nomesDep: Map<string, string>;
  /** cod_titulo com alerta de reclassificação aberto */
  suspeitos: Set<string>;
}) {
  const departamentosDe = useCallback(
    (l: LancamentoPlano) =>
      (l.departamentos ?? []).map((d) => `${nomesDep.get(d.codigo) ?? d.codigo}${Number(d.pct) !== 100 ? ` ${d.pct}%` : ""}`).join(" · "),
    [nomesDep],
  );
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<"data" | "valor">("data");
  const [limite, setLimite] = useState(PASSO);
  const ehGrupo = no.filhos.length > 0;

  const noPeriodo = useMemo(() => {
    const set = new Set(meses);
    return linhas.filter((x) => set.has(x.l.data.slice(0, 7)));
  }, [linhas, meses]);

  const filtradas = useMemo(() => {
    const termos = normalize(busca).toLowerCase().split(/\s+/).filter(Boolean);
    const lista = termos.length
      ? noPeriodo.filter((x) => {
          // A busca varre o que está ESCRITO na linha — apelido e nome cru —, mais a
          // observação e a justificativa.
          const alvo = normalize([x.nome, x.cru, x.l.titulo, x.l.documento, x.l.observacao, x.l.nota, x.l.categoria, x.l.cnpj_cpf, departamentosDe(x.l)].filter(Boolean).join(" ")).toLowerCase();
          return termos.every((t) => alvo.includes(t));
        })
      : noPeriodo;
    return ordem === "valor" ? [...lista].sort((a, b) => Math.abs(b.l.valor) - Math.abs(a.l.valor)) : lista;
  }, [noPeriodo, busca, ordem, departamentosDe]);

  /* A prova de que a lista está completa: a soma dos lançamentos contra o total
     da categoria. Filtro nenhum mexe nela. */
  const soma = useMemo(() => noPeriodo.reduce((s, x) => s + noSentido(no.despesa, Number(x.l.valor)), 0), [noPeriodo, no.despesa]);
  const bate = Math.abs(soma - no.stats.total) < 0.01;

  useEffect(() => { setLimite(PASSO); }, [busca, ordem, no.codigo]);

  return (
    <Secao
      titulo="Lançamentos"
      nota={
        <>
          {intStr(noPeriodo.length)} no período · soma {fmtBRL(soma)}{" "}
          {bate
            ? <span className="text-pos">· bate com o total</span>
            : <span className={ocultos ? "text-muted-foreground" : "text-warn"}>
                · difere do total em {fmtBRL(no.stats.total - soma)}{ocultos ? " (lançamentos de folha ocultos)" : ""}
              </span>}
        </>
      }
      acao={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, título, observação…" className="h-8 w-[220px] pl-7 text-[12px]" />
          </div>
          <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-card p-[3px]">
            {(["data", "valor"] as const).map((o) => (
              <button key={o} type="button" onClick={() => setOrdem(o)}
                className={cn("h-6 rounded-[5px] px-2 text-[11.5px] font-medium transition-colors",
                  ordem === o ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {o === "data" ? "Recentes" : "Maiores"}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {busca && <div className="mb-2 text-[11.5px] text-muted-foreground">{intStr(filtradas.length)} de {intStr(noPeriodo.length)} com “{busca}”</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-1.5 font-medium">Data</th>
              <th className="pb-1.5 font-medium">Contraparte</th>
              <th className="pb-1.5 font-medium">Título</th>
              {ehGrupo && <th className="pb-1.5 font-medium">Categoria</th>}
              <th className="pb-1.5 font-medium">Status</th>
              <th className="pb-1.5 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.slice(0, limite).map((x, i) => (
              <tr key={`${x.l.cod_titulo ?? "s"}-${i}`} className="border-t border-border/60 align-top">
                <td className="num whitespace-nowrap py-1.5 pr-2 text-muted-foreground">{dataCurta(x.l.data)}</td>
                <td className="max-w-[280px] py-1.5 pr-2">
                  <div className="flex items-center gap-1 truncate font-medium text-foreground">
                    {x.l.cod_titulo && suspeitos.has(String(x.l.cod_titulo)) && (
                      <span title="Classificação suspeita: o fornecedor costumava cair noutra rubrica">
                        <TriangleAlert className="h-3 w-3 shrink-0 text-warn" />
                      </span>
                    )}
                    {x.cartao && <CreditCard className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <span className="truncate" title={x.nome}>{x.nome}</span>
                  </div>
                  {x.cru && x.cru !== x.nome && <div className="truncate text-[10.5px] text-muted-foreground" title={x.cru}>{x.cru}</div>}
                  {x.detalhe && <div className="truncate text-[10.5px] text-muted-foreground">{x.detalhe}</div>}
                  {!!x.l.departamentos?.length && (
                    <div className="truncate text-[10.5px] text-muted-foreground" title="Departamento no Omie">Depto: {departamentosDe(x.l)}</div>
                  )}
                  {x.l.nota && (
                    <div className="mt-0.5 flex items-start gap-1 text-[11px] text-violet-600 dark:text-violet-400">
                      <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0" /> <span className="line-clamp-2">{x.l.nota}</span>
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground">
                  <div>{x.l.titulo ?? x.l.documento ?? "—"}{x.l.parcela && x.l.parcela !== "001/001" ? ` · ${x.l.parcela}` : ""}</div>
                  {x.l.cod_titulo && <div className="font-mono text-[10px]">{x.l.cod_titulo}</div>}
                </td>
                {ehGrupo && <td className="whitespace-nowrap py-1.5 pr-2 font-mono text-[10.5px] text-muted-foreground">{x.l.categoria}</td>}
                <td className="whitespace-nowrap py-1.5 pr-2 text-[11px] text-muted-foreground">{x.l.status ?? "—"}</td>
                <td className="num whitespace-nowrap py-1.5 text-right">{fmtBRL(noSentido(no.despesa, Number(x.l.valor)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtradas.length > limite && (
        <button type="button" onClick={() => setLimite((n) => n + PASSO)} className="mt-2 text-[11.5px] font-medium text-primary hover:underline">
          Mostrar mais {Math.min(PASSO, filtradas.length - limite)} de {intStr(filtradas.length - limite)} restantes
        </button>
      )}
    </Secao>
  );
}

/* ───────────────────────── Trocas de categoria ───────────────────────── */

function Alteracoes({ dados, codigo }: { dados: LancamentosPlano; codigo: string }) {
  if (!dados.alteracoes.length) return null;
  const dentro = (c: string | null) => !!c && (c === codigo || c.startsWith(codigo + "."));

  return (
    <Secao titulo="Trocas de categoria pelo Hub" nota="Feitas no drill-down da DRE/DFC, no lote ou pelo chat da célula — as últimas 100">
      <ul className="divide-y divide-border/60">
        {dados.alteracoes.map((a, i) => {
          const entrou = dentro(a.categoria_para) && !dentro(a.categoria_de);
          const saiu = dentro(a.categoria_de) && !dentro(a.categoria_para);
          return (
            <li key={`${a.cod_titulo}-${a.criado_em}-${i}`} className="flex items-start gap-2.5 py-2 text-[12px]">
              <ArrowRightLeft className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", entrou ? "text-pos" : saiu ? "text-neg" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <div className="text-foreground">
                  <b className="font-medium">{a.contraparte ?? "Lançamento"}</b>
                  {a.valor != null && <> · <span className="num">{fmtBRL(Math.abs(a.valor))}</span></>}
                  {" "}{entrou ? "entrou vindo de" : saiu ? "saiu para" : "mudou de"}{" "}
                  <b className="font-medium">{entrou ? a.descricao_de : saiu ? a.descricao_para : `${a.descricao_de} → ${a.descricao_para}`}</b>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {dataCurta(a.criado_em)} · {a.por ?? "—"}{a.origem ? ` · pela ${a.origem.toUpperCase()}` : ""}{a.motivo ? ` · “${a.motivo}”` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}
