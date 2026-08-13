import { useState } from "react";
import { ChevronDown, ChevronRight, Check, TriangleAlert, Loader2, CreditCard, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { mesCurto } from "@/lib/demonstracoes-schema";
import { ChipSituacao } from "@/components/demonstracoes/ChipSituacao";
import { lerGastoDeCartao } from "@/lib/observacaoTitulo";
import { rotuloSituacao, type Comparativo, type Situacao } from "@/lib/comparativoFornecedores";
import {
  explicarPeca, rotuloContagem, rotuloGrupo,
  type LancamentoDaPonte, type PecaDaPonte, type Ponte,
} from "@/lib/ponteVariacao";

/* ---------------------------------------------------------------------------
 * "Por que esta linha mudou?" — o detalhe do chip FORNECEDORES do painel.
 *
 * A lista responde "o que tem aqui". Esta peça responde a pergunta seguinte, e
 * é ela que se leva para a reunião: a variação contra o mês anterior aberta
 * fornecedor a fornecedor, dos dois lados — o que entrou e aumentou de um lado,
 * o que sumiu e reduziu do outro —, e cada fornecedor abre nos lançamentos dos
 * DOIS meses. É onde se vê que a PRINTI não é nova: a parcela é que virou três.
 *
 * Três decisões desenham esta tela:
 *
 * 1. QUEM ABRE É O CHIP, E A ALTURA É TETO. O cabeçalho recolhível saiu: quem
 *    abre e fecha é o chip da linha RESUMO, e só um detalhe fica aberto por vez.
 *    Aqui dentro sobra o teto de altura — a lista de lançamentos é o que se veio
 *    conferir, e esta faixa não pode empurrá-la para fora da tela.
 *
 * 2. NADA DE TOP-5. Todos os fornecedores dos dois lados, do que mais pesou ao
 *    que menos, com rolagem própria dentro do teto. Cortar a lista pouparia
 *    altura e devolveria a pergunta "e o resto?" — que é exatamente a pergunta
 *    que a faixa existe para eliminar. O rodapé afirma que a conta fecha porque
 *    ela fecha: os deltas exibidos somam, no centavo, a variação do topo.
 *
 * 3. O SINAL É O DA CÉLULA. Despesa continua negativa aqui, como na grade e na
 *    lista: -482,54 na coluna DIFERENÇA, dentro do grupo "Gastou a mais". A cor
 *    e o título do grupo dizem o que o sinal significa; trocar o sinal para
 *    "+482,54" faria a coluna deixar de somar com o número do topo, que é
 *    justamente a prova de que nada ficou de fora.
 * ------------------------------------------------------------------------- */

const dataCurta = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

/* ----- o chip da peça ----------------------------------------------------
 * A ponte enxerga dois meses; "novo" é uma afirmação sobre doze. Quando o
 * comparativo já carregou, ele refina: o que entrou pode ser "voltou · Abr 26",
 * e o fornecedor trimestral deixa de ser carimbado de novidade todo trimestre.
 * Sem ele, a peça se diz só "entrou" — que é o que os dados sustentam. */
function chipDaPeca(p: PecaDaPonte, comp: Comparativo | null): { situacao: Situacao; rotulo: string } {
  if (p.movimento === "entrou") {
    const cod = p.lancamentos.find((l) => l.cod_titulo)?.cod_titulo;
    const f = (cod ? comp?.porTitulo.get(cod) : undefined) ?? comp?.porContraparte.get(p.nome);
    if (f?.situacao === "voltou") return { situacao: "voltou", rotulo: rotuloSituacao(f) };
    return { situacao: "novo", rotulo: f?.situacao === "novo" ? "novo" : "entrou" };
  }
  if (p.movimento === "saiu") return { situacao: "sumiu", rotulo: "sumiu" };
  if (p.movimento === "igual") return { situacao: "igual", rotulo: "igual" };
  const seta = p.deltaModulo > 0 ? "subiu" : "caiu";
  return {
    situacao: seta,
    rotulo: p.pct == null ? seta : `${p.deltaModulo > 0 ? "+" : "−"}${Math.round(Math.abs(p.pct) * 100)}%`,
  };
}

/** Um lançamento dentro da peça aberta — a linha do centavo. */
function LinhaLancamento({
  l, obsDe, moeda,
}: {
  l: LancamentoDaPonte;
  obsDe: (cod: string | null) => string | null | undefined;
  moeda: (n: number) => string;
}) {
  const obs = obsDe(l.cod_titulo);
  const lida = lerGastoDeCartao(l.contraparte, obs);
  const apoio = [
    lida?.detalhe,
    lida?.parcela ? `parcela ${lida.parcela}` : null,
    l.documento ? `NF ${l.documento}` : null,
    l.status,
    l.categoria_descricao,
  ].filter(Boolean) as string[];

  return (
    <div className="flex items-start justify-between gap-3 py-[3px]">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[10.5px] text-foreground">
          <span className="num shrink-0 text-muted-foreground">{dataCurta(l.data)}</span>
          {lida ? (
            <span className="inline-flex items-center gap-1 truncate" title={obs ?? undefined}>
              <CreditCard className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
              {lida.estabelecimento}
            </span>
          ) : (
            <span className="truncate">{l.contraparte ?? "—"}</span>
          )}
          {l.titulo && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[9.5px] text-muted-foreground">
              <FileText className="h-2.5 w-2.5" />{l.titulo}
            </span>
          )}
        </div>
        {apoio.length > 0 && (
          <div className="truncate text-[9.5px] text-muted-foreground" title={apoio.join(" · ")}>
            {apoio.join(" · ")}
          </div>
        )}
      </div>
      <span className={cn(
        "num shrink-0 whitespace-nowrap text-[10.5px] font-medium",
        (l.valor ?? 0) < 0 ? "text-primary" : "text-emerald-700",
      )}>
        {moeda(Number(l.valor) || 0)}
      </span>
    </div>
  );
}

/** Os lançamentos de um mês dentro da peça aberta. */
function MesDaPeca({
  mes, lancamentos, total, obsDe, moeda, vazio,
}: {
  mes: string;
  lancamentos: LancamentoDaPonte[];
  total: number;
  obsDe: (cod: string | null) => string | null | undefined;
  moeda: (n: number) => string;
  vazio: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-0.5">
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {mesCurto(mes)}
          {lancamentos.length > 0 && (
            <span className="ml-1 font-medium normal-case tracking-normal">
              · {lancamentos.length} {lancamentos.length === 1 ? "lançamento" : "lançamentos"}
            </span>
          )}
        </span>
        {lancamentos.length > 0 && (
          <span className="num shrink-0 text-[10px] font-semibold text-foreground">{moeda(total)}</span>
        )}
      </div>
      {lancamentos.length === 0 ? (
        <div className="py-1.5 text-[10.5px] italic text-muted-foreground">{vazio}</div>
      ) : (
        <div className="divide-y divide-border/40">
          {lancamentos.map((l, i) => (
            <LinhaLancamento key={l.cod_titulo ?? i} l={l} obsDe={obsDe} moeda={moeda} />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaPeca({
  p, ponte, comp, aberta, onAlternar, moeda, moedaSemCentavos, obsDe,
}: {
  p: PecaDaPonte;
  ponte: Ponte;
  comp: Comparativo | null;
  aberta: boolean;
  onAlternar: () => void;
  moeda: (n: number) => string;
  moedaSemCentavos: (n: number) => string;
  obsDe: (cod: string | null) => string | null | undefined;
}) {
  const chip = chipDaPeca(p, comp);
  const explicacao = explicarPeca(p, ponte, moeda, mesCurto);
  const celula = (v: number, tem: boolean) =>
    tem ? <span title={moeda(v)}>{moedaSemCentavos(v)}</span> : <span className="text-muted-foreground/50">—</span>;

  return (
    <>
      <tr
        onClick={onAlternar}
        className={cn("cursor-pointer border-b border-border/50", aberta ? "bg-muted/60" : "hover:bg-muted/50")}
        title={`${explicacao}\n\nClique para ver os lançamentos dos dois meses.`}
      >
        {/* Nome e chip na MESMA linha: empilhados, cada fornecedor custava duas
            alturas de texto e a faixa comia a lista inteira. O nome corta e o
            inteiro fica no hover — quem precisa do nome completo vai à lista. */}
        <td className="py-1 pl-5 pr-1">
          <div className="flex items-center gap-1">
            {aberta
              ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
            <span className="max-w-[165px] truncate text-[11px] text-foreground" title={p.nome}>{p.nome}</span>
            <ChipSituacao
              situacao={chip.situacao}
              favoravel={p.favoravel}
              rotulo={chip.rotulo}
              titulo={explicacao}
            />
          </div>
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-right text-[11px] num text-muted-foreground">
          {celula(p.anterior, p.anteriores.length > 0)}
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-right text-[11px] num text-muted-foreground">
          {celula(p.atual, p.lancamentos.length > 0)}
        </td>
        {/* A coluna que soma: é ela que fecha com o número do topo. */}
        <td className={cn(
          "whitespace-nowrap px-5 py-1 text-right text-[11px] num font-semibold",
          p.favoravel ? "text-emerald-700" : "text-primary",
        )}>
          <span title={moeda(p.delta)}>{moedaSemCentavos(p.delta)}</span>
        </td>
      </tr>

      {aberta && (
        <tr className="border-b border-border/50 bg-muted/30">
          <td colSpan={4} className="px-5 pb-2.5 pt-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
              <MesDaPeca
                mes={ponte.mesAnterior}
                lancamentos={p.anteriores}
                total={p.anterior}
                obsDe={obsDe}
                moeda={moeda}
                vazio="Nenhum lançamento neste mês."
              />
              <MesDaPeca
                mes={ponte.mes}
                lancamentos={p.lancamentos}
                total={p.atual}
                obsDe={obsDe}
                moeda={moeda}
                vazio="Nenhum lançamento neste mês."
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Grupo({
  titulo, pecas, total, favoravel, ponte, comp, abertas, onAlternar, moeda, moedaSemCentavos, obsDe,
}: {
  titulo: string;
  pecas: PecaDaPonte[];
  total: number;
  /** null = nem bom nem ruim: o grupo de quem repetiu o valor. */
  favoravel: boolean | null;
  ponte: Ponte;
  comp: Comparativo | null;
  abertas: Set<string>;
  onAlternar: (chave: string) => void;
  moeda: (n: number) => string;
  moedaSemCentavos: (n: number) => string;
  obsDe: (cod: string | null) => string | null | undefined;
}) {
  if (!pecas.length) return null;
  const faixa = favoravel == null ? "border-border bg-muted/70"
    : favoravel ? "border-emerald-200 bg-emerald-50"
    : "border-rose-200 bg-rose-50";
  const texto = favoravel == null ? "text-muted-foreground"
    : favoravel ? "text-emerald-900"
    : "text-rose-900";

  return (
    <>
      <tr className={cn("border-y", faixa)}>
        <td colSpan={2} className={cn("px-5 py-1 text-[9.5px] font-bold uppercase tracking-[0.1em]", texto)}>
          {titulo}
          <span className="ml-1.5 font-medium normal-case tracking-normal opacity-80">
            · {pecas.length} {pecas.length === 1 ? "fornecedor" : "fornecedores"}
          </span>
        </td>
        <td colSpan={2} className={cn("whitespace-nowrap px-5 py-1 text-right text-[11px] num font-bold", texto)}
          title={moeda(total)}>
          {favoravel == null ? "" : moedaSemCentavos(total)}
        </td>
      </tr>
      {pecas.map((p) => (
        <LinhaPeca
          key={p.chave}
          p={p}
          ponte={ponte}
          comp={comp}
          aberta={abertas.has(p.chave)}
          onAlternar={() => onAlternar(p.chave)}
          moeda={moeda}
          moedaSemCentavos={moedaSemCentavos}
          obsDe={obsDe}
        />
      ))}
    </>
  );
}

export function PonteVariacao({
  ponte, comp, carregando, celula, celulaAnterior, travado, travadoAnterior,
  moeda, moedaSemCentavos, obsDe,
}: {
  ponte: Ponte;
  /** O comparativo de 12 meses, quando já carregou — só refina "entrou" em "voltou". */
  comp: Comparativo | null;
  /** O mês anterior ainda está vindo do banco. */
  carregando: boolean;
  /** O que a GRADE mostra nos dois meses — a ponte compara Omie com Omie. */
  celula: number | null;
  celulaAnterior: number | null | undefined;
  travado: boolean;
  travadoAnterior: boolean | undefined;
  moeda: (n: number) => string;
  moedaSemCentavos: (n: number) => string;
  obsDe: (cod: string | null) => string | null | undefined;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [verIguais, setVerIguais] = useState(false);
  const alternar = (chave: string) => setAbertas((s) => {
    const n = new Set(s);
    if (n.has(chave)) n.delete(chave); else n.add(chave);
    return n;
  });

  const mexeu = ponte.piora.length + ponte.melhora.length;
  const todasAbertas = mexeu > 0 && abertas.size >= mexeu;

  /* A grade e o Omie podem discordar — e é normal: em mês travado a célula vem
     do tracker, e fornecedor não existe no tracker. O que interessa dizer não é
     que os saldos diferem (o topo do painel já diz isso do mês em foco), e sim
     que a VARIAÇÃO da grade é outra — senão o número grande daqui seria lido
     como se fosse o da coluna ao lado, na tela de trás. */
  const deltaNaGrade = celula != null && celulaAnterior != null ? celula - celulaAnterior : null;
  const gradeDiscorda = deltaNaGrade != null && Math.abs(deltaNaGrade - ponte.delta) >= 0.5;
  const mesesTravados = [
    travadoAnterior ? mesCurto(ponte.mesAnterior) : null,
    travado ? mesCurto(ponte.mes) : null,
  ].filter(Boolean) as string[];

  /* O TETO É O PONTO. Sem ele a faixa cresce com o número de fornecedores e
     empurra a lista para fora da tela — e a lista é o que se veio conferir. O
     que não cabe rola aqui dentro; nada é escondido. */
  return (
    <div className="flex max-h-[min(32%,260px)] shrink-0 flex-col overflow-hidden border-b border-border bg-muted/30">
      {/* Enquanto o mês anterior não chegou, a ponte diria que TUDO entrou — é o
          mesmo dado com o outro lado vazio. Cala até ter os dois. */}
      {carregando && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-card px-5 py-5 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Buscando os lançamentos de {mesCurto(ponte.mesAnterior)} para comparar…
        </div>
      )}

      {!carregando && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* ----- a conferência: os dois meses, lado a lado -----
              O NÚMERO GRANDE SAIU DAQUI: quem carrega a variação agora é o chip
              que abriu esta faixa, e repeti-lo em corpo 13 gastaria uma linha
              para dizer de novo o que está dois centímetros acima. */}
          <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-card px-5 py-2">
            <span className="text-[11.5px] text-muted-foreground">
              {mesCurto(ponte.mesAnterior)}{" "}
              <b className="num text-foreground" title={moeda(ponte.somaAnterior)}>{moedaSemCentavos(ponte.somaAnterior)}</b>
              {" → "}
              {mesCurto(ponte.mes)}{" "}
              <b className="num text-foreground" title={moeda(ponte.soma)}>{moedaSemCentavos(ponte.soma)}</b>
              {ponte.pct != null && Math.abs(ponte.delta) >= 0.005 && (
                <span className="ml-1.5">
                  ({ponte.pct > 0 ? "+" : "−"}{Math.round(Math.abs(ponte.pct) * 100)}% em movimento)
                </span>
              )}
            </span>
            {mexeu > 0 && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {ponte.piora.length} {rotuloContagem(ponte, false)}
                {" · "}{ponte.melhora.length} {rotuloContagem(ponte, true)}
              </span>
            )}
          </div>

          {gradeDiscorda && (
            <div className="shrink-0 border-t border-amber-200 bg-amber-50 px-5 py-1.5 text-[10.5px] leading-relaxed text-amber-900">
              <TriangleAlert className="mr-1 inline h-3 w-3" />
              Na grade a variação é <b className="num">{moeda(deltaNaGrade as number)}</b>
              {" "}({mesCurto(ponte.mesAnterior)} <span className="num">{moeda(celulaAnterior as number)}</span>
              {" → "}{mesCurto(ponte.mes)} <span className="num">{moeda(celula as number)}</span>).
              {mesesTravados.length > 0 && (
                <> {mesesTravados.join(" e ")} {mesesTravados.length === 1 ? "está travado" : "estão travados"}:
                  o valor da grade veio do tracker, e fornecedor não existe no tracker.</>
              )}
              {" "}A ponte abaixo compara os lançamentos do Omie nos dois meses.
            </div>
          )}

          {/* ----- os dois lados ----- */}
          {mexeu === 0 ? (
            <div className="shrink-0 border-t border-border px-5 py-4 text-center text-[11.5px] text-muted-foreground">
              {ponte.soma === 0 && ponte.somaAnterior === 0
                ? "Nenhum lançamento nos dois meses."
                : `Nenhum fornecedor mudou de valor entre ${mesCurto(ponte.mesAnterior)} e ${mesCurto(ponte.mes)}.`}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto border-t border-border">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <tr className="border-b border-border text-[9px] font-semibold tracking-[0.06em] text-muted-foreground">
                    <th className="px-5 py-1.5 text-left">FORNECEDOR</th>
                    <th className="px-2 py-1.5 text-right uppercase">{mesCurto(ponte.mesAnterior)}</th>
                    <th className="px-2 py-1.5 text-right uppercase">{mesCurto(ponte.mes)}</th>
                    <th className="px-5 py-1.5 text-right">DIFERENÇA</th>
                  </tr>
                </thead>
                <tbody>
                  <Grupo
                    titulo={rotuloGrupo(ponte, false)}
                    pecas={ponte.piora}
                    total={ponte.totalPiora}
                    favoravel={false}
                    ponte={ponte} comp={comp} abertas={abertas} onAlternar={alternar}
                    moeda={moeda} moedaSemCentavos={moedaSemCentavos} obsDe={obsDe}
                  />
                  <Grupo
                    titulo={rotuloGrupo(ponte, true)}
                    pecas={ponte.melhora}
                    total={ponte.totalMelhora}
                    favoravel
                    ponte={ponte} comp={comp} abertas={abertas} onAlternar={alternar}
                    moeda={moeda} moedaSemCentavos={moedaSemCentavos} obsDe={obsDe}
                  />
                  {/* Quem repetiu o valor não explica nada — mas sumir com ele
                      deixaria a pergunta "e o resto da célula?" sem resposta.
                      Fica recolhido, à mão de quem quiser conferir. */}
                  {verIguais && (
                    <Grupo
                      titulo="Repetiram o valor"
                      pecas={ponte.iguais}
                      total={0}
                      favoravel={null}
                      ponte={ponte} comp={comp} abertas={abertas} onAlternar={alternar}
                      moeda={moeda} moedaSemCentavos={moedaSemCentavos} obsDe={obsDe}
                    />
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ----- o rodapé que afirma que a conta fecha ----- */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-emerald-50/60 px-5 py-1.5 text-[10px] leading-relaxed text-emerald-900">
            <span>
              <Check className="mr-1 inline h-3 w-3" />
              {mexeu === 0
                ? `Os ${ponte.iguais.length} fornecedores repetiram o valor de ${mesCurto(ponte.mesAnterior)}.`
                : <>
                    As duas listas somam <b className="num">{moeda(ponte.delta)}</b> — a variação inteira, no centavo.
                  </>}
              {ponte.iguais.length > 0 && mexeu > 0 && (
                <>
                  {" "}
                  <button
                    onClick={() => setVerIguais((v) => !v)}
                    className="font-medium underline-offset-2 transition hover:underline"
                    title="Fornecedores com o mesmo valor nos dois meses: não movem a variação, mas fazem parte da célula."
                  >
                    {verIguais ? "esconder" : "ver"} os {ponte.iguais.length}{" "}
                    {ponte.iguais.length === 1 ? "que repetiu" : "que repetiram"} o valor
                  </button>
                </>
              )}
            </span>
            {mexeu > 0 && (
              <button
                onClick={() => setAbertas(todasAbertas ? new Set() : new Set([...ponte.piora, ...ponte.melhora].map((p) => p.chave)))}
                className="shrink-0 font-medium underline-offset-2 transition hover:underline"
              >
                {todasAbertas ? "fechar todos os lançamentos" : "abrir todos os lançamentos"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}