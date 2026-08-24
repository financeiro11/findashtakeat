import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2, ArrowDown, ExternalLink, FileText, Landmark, Users, Scale,
  Calendar, PieChart, BookOpen, Coins, ArrowRight, Info, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { comValorExato } from "@/components/ValorExato";
import {
  ACORDOS_ACESSORIOS, APROVACOES, ASSESSORES, CAMBIO_RODADA, CAP_TABLE,
  CAP_TABLE_TOTAIS, CONSELHO, CONVERSOES_SEED, DOCS_DRIVE, ENTIDADES,
  FECHAMENTO_LABEL, GLOSSARIO, LINHA_DO_TEMPO, NOTA_CLASSES, PASTA_DRIVE,
  PRECOS_POR_ACAO, SCHEDULE_I, SCHEDULE_I_TOTAL, SEED_TOTAL, SERIE_A,
  SERIE_A_TOTAL, TOTAL_ACOES, USO_DOS_RECURSOS,
  type GrupoMarco, type TipoSocio,
} from "./flip-dados";
import { DOCUMENTOS, type Bloco, type Documento } from "./flip-documentos";

// ============================================================================
// O flip da Takeat — /investimentos/flip
//
// Esta tela não calcula nada a partir do banco: ela CONTA uma operação que já
// aconteceu. Os números vêm dos contratos (flip-dados.ts) e o texto dos quatro
// cadernos do Financeiro (flip-documentos.ts). O que a tela faz é o que o .docx
// não faz — deixa navegar: a estrutura vira desenho, os marcos viram linha do
// tempo, o cap table vira barra e a rodada vira quadro somável.
//
// A aba "Cap table" é a foto do fechamento, e só. Quem quer simular uma rodada
// nova vai para /captable — ali o simulador parte exatamente destes números.
// Duas telas, um número só: se o cap table de fechamento mudar, muda aqui e o
// simulador acompanha.
// ============================================================================

/* ------------------------------------------------------------- formatação */
// Convenção da casa: o formatador "normal" devolve ReactNode com o valor cheio
// no hover; a variante `…Str` devolve string pura, para template literal,
// `title=` e prompt de IA (senão sai "[object Object]").

const usdStr = (n: number, casas = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: casas, maximumFractionDigits: casas });
const brlStr = (n: number, casas = 0) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });

const usdCompactoStr = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `US$ ${(n / 1_000_000).toFixed(2).replace(".", ",")}M`;
  if (Math.abs(n) >= 10_000) return `US$ ${(n / 1_000).toFixed(0)}k`;
  return usdStr(n);
};
const brlCompactoStr = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(2).replace(".", ",")}M`;
  if (Math.abs(n) >= 10_000) return `R$ ${(n / 1_000).toFixed(0)}k`;
  return brlStr(n);
};

const usd = (n: number) => comValorExato(n, usdStr(n), { moeda: "USD" });
const usdCompacto = (n: number) => comValorExato(n, usdCompactoStr(n), { moeda: "USD" });
const brlCompacto = (n: number) => comValorExato(n, brlCompactoStr(n), { moeda: true });
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;

/* ------------------------------------------------------- cores por natureza */

const CORES_SOCIO: Record<TipoSocio, { barra: string; chip: string; rotulo: string }> = {
  fundador: { barra: "bg-primary", chip: "bg-primary/10 text-primary", rotulo: "Fundador" },
  fundo: { barra: "bg-blue-500", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400", rotulo: "Fundo" },
  anjo: { barra: "bg-violet-500", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400", rotulo: "Anjo" },
  pool: { barra: "bg-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", rotulo: "Reserva" },
};

const CORES_MARCO: Record<GrupoMarco, { ponto: string; texto: string; rotulo: string }> = {
  estrutura: { ponto: "bg-blue-500", texto: "text-blue-600 dark:text-blue-400", rotulo: "Montagem da estrutura" },
  flip: { ponto: "bg-primary", texto: "text-primary", rotulo: "Flip & rodada" },
  pos: { ponto: "bg-muted-foreground", texto: "text-muted-foreground", rotulo: "Pós-fechamento" },
};

/* ============================================================ peças da tela */

function Kpi({
  rotulo, valor, apoio, icon: Icon, destaque,
}: {
  rotulo: string;
  valor: React.ReactNode;
  apoio: string;
  icon: typeof Building2;
  destaque?: boolean;
}) {
  return (
    <Card className="border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</div>
        <div className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          destaque ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="num mt-1.5 text-[24px] font-bold leading-none text-foreground">{valor}</div>
      <div className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{apoio}</div>
    </Card>
  );
}

function Titulo({ children, apoio }: { children: React.ReactNode; apoio?: string }) {
  return (
    <div>
      <h2 className="text-[15px] font-bold tracking-tight text-foreground">{children}</h2>
      {apoio && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{apoio}</p>}
    </div>
  );
}

/** Caixa explicativa — o mesmo papel das caixas cinzas do documento. */
function Caixa({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        {titulo}
      </div>
      <div className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

/** Quadro simples — colunas à esquerda, valores à direita quando numéricas. */
function Quadro({
  colunas, linhas, alinharDireita = [], totalUltima,
}: {
  colunas: string[];
  linhas: React.ReactNode[][];
  alinharDireita?: number[];
  totalUltima?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            {colunas.map((c, i) => (
              <th
                key={i}
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
                  alinharDireita.includes(i) ? "text-right" : "text-left",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => {
            const ehTotal = totalUltima && i === linhas.length - 1;
            return (
              <tr
                key={i}
                className={cn(
                  "border-b border-border/40 last:border-0",
                  ehTotal ? "bg-muted/30 font-semibold" : "hover:bg-muted/30",
                )}
              >
                {linha.map((celula, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-2 text-[12.5px] align-top",
                      alinharDireita.includes(j) ? "num text-right whitespace-nowrap" : "text-left",
                    )}
                  >
                    {celula}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =================================================== aba 1 · Panorama */

function Panorama({ irPara }: { irPara: (aba: string) => void }) {
  return (
    <div className="space-y-5">
      <Card className="border-border p-5">
        <Titulo apoio="O que aconteceu, em três parágrafos">Sumário executivo</Titulo>
        <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-muted-foreground">
          <p>
            Em dezembro de 2025, a Takeat concluiu uma reestruturação societária conhecida no mercado de venture
            capital como <strong className="text-foreground">flip</strong>: a operação que transferiu o controle do
            negócio — antes detido diretamente pelos fundadores no Brasil — para uma holding constituída no exterior.
            No mesmo ato, a empresa fechou uma rodada de investimento que combinou aporte novo de Series A com a
            conversão de instrumentos de dívida anteriores em ações preferenciais Series Seed.
          </p>
          <p>
            Ao final, a estrutura passou a ter três níveis: uma holding em Cayman no topo, uma LLC em Delaware no meio
            e a operação brasileira na base. A atividade da empresa permaneceu integralmente na Takeat Tecnologia
            Ltda.; o que mudou foi a cadeia de controle acima dela.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Caixa titulo="O que é um “flip”?">
          É a reorganização pela qual uma empresa operacional brasileira passa a ser controlada por uma holding no
          exterior (tipicamente nas Ilhas Cayman), em vez de pertencer diretamente aos sócios pessoas físicas. Faz-se
          isso para receber investimento estrangeiro com a segurança jurídica, a língua (inglês) e os instrumentos
          contratuais que fundos internacionais conhecem e exigem — e para simplificar futuras rodadas, vendas ou um
          eventual IPO.
        </Caixa>
        <Caixa titulo="Por que Cayman e Delaware ao mesmo tempo?">
          Cayman oferece o regime societário de preferência dos fundos internacionais (direito flexível, contratos em
          inglês, neutralidade tributária na holding). Delaware acrescenta uma camada jurídica norte-americana sólida e
          familiar a investidores dos EUA. A combinação holding-Cayman sobre LLC-Delaware é um arranjo recorrente em
          startups brasileiras que captam capital lá fora.
        </Caixa>
      </div>

      {/* Antes e depois — a transformação em duas colunas */}
      <Card className="border-border p-5">
        <Titulo apoio="Duas contribuições encadeadas, ambas fechadas em 22/dez/2025">
          A transformação: antes e depois
        </Titulo>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Antes</div>
            <div className="mt-2 space-y-2">
              <div className="rounded-md border border-border bg-card px-3 py-2 text-[12.5px]">
                <div className="font-semibold">Fundadores (pessoas físicas)</div>
                <div className="text-[11.5px] text-muted-foreground">Detêm as duas empresas lado a lado</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border bg-card px-3 py-2 text-[12px]">🇺🇸 Takeat LLC</div>
                <div className="rounded-md border border-border bg-card px-3 py-2 text-[12px]">🇧🇷 Takeat Tecnologia</div>
              </div>
              <div className="text-[11.5px] text-muted-foreground">Sem vínculo societário entre elas.</div>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <ArrowRight className="hidden h-6 w-6 text-muted-foreground md:block" />
            <ArrowDown className="h-6 w-6 text-muted-foreground md:hidden" />
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-primary">Depois</div>
            <div className="mt-2 space-y-2">
              <div className="rounded-md border border-border bg-card px-3 py-2 text-[12.5px]">
                <div className="font-semibold">🇰🇾 Takeat Holding Ltd.</div>
                <div className="text-[11.5px] text-muted-foreground">Acionistas: fundador, fundos e anjos</div>
              </div>
              <div className="pl-4 text-[11px] text-muted-foreground">↓ 100%</div>
              <div className="ml-4 rounded-md border border-border bg-card px-3 py-2 text-[12px]">🇺🇸 Takeat LLC</div>
              <div className="pl-8 text-[11px] text-muted-foreground">↓ 100%</div>
              <div className="ml-8 rounded-md border border-border bg-card px-3 py-2 text-[12px]">🇧🇷 Takeat Tecnologia</div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          Na primeira etapa (<em>Subscription and Contribution Agreement</em>), os fundadores contribuíram à holding
          tanto suas quotas da Ltda. quanto suas participações na LLC, recebendo ações da holding em troca. Na segunda
          (<em>Deed of Contribution</em>), a holding desceu as 1.000 quotas brasileiras para dentro da LLC,
          posicionando-a como detentora direta da operação.
        </p>
      </Card>

      {/* Atalhos para o resto da tela */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { aba: "estrutura", icon: Building2, titulo: "A estrutura", texto: "As três entidades, com registro, agente e endereço" },
          { aba: "tempo", icon: Calendar, titulo: "Linha do tempo", texto: "De 3/out a 30/dez de 2025, marco a marco" },
          { aba: "rodada", icon: Coins, titulo: "A rodada", texto: "Preço por ação, tickets e conversões" },
          { aba: "captable", icon: PieChart, titulo: "Cap table", texto: "A foto de 18/dez, com % por sócio" },
        ].map((a) => (
          <button
            key={a.aba}
            onClick={() => irPara(a.aba)}
            className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <a.icon className="h-4 w-4 text-muted-foreground" />
            <div className="mt-2 text-[13px] font-semibold">{a.titulo}</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{a.texto}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* =================================================== aba 2 · Estrutura */

function Estrutura() {
  return (
    <div className="space-y-5">
      {/* Cadeia de controle */}
      <Card className="border-border p-5">
        <Titulo apoio="Cada nível detém 100% do nível imediatamente inferior">Cadeia societária hoje</Titulo>
        <div className="mt-5 flex flex-col items-center">
          {ENTIDADES.map((e, i) => (
            <div key={e.id} className="flex w-full max-w-2xl flex-col items-center">
              <div className={cn(
                "w-full rounded-xl border p-4",
                i === 0 ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-card",
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl leading-none">{e.bandeira}</span>
                    <div>
                      <div className="text-[14px] font-bold">{e.nome}</div>
                      <div className="text-[11.5px] text-muted-foreground">{e.tipo} · {e.jurisdicao}</div>
                    </div>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] text-muted-foreground">
                    desde {e.nascimento}
                  </span>
                </div>
                <div className="mt-2 text-[12px] text-muted-foreground">{e.papel}</div>
              </div>
              {i < ENTIDADES.length - 1 && (
                <div className="flex flex-col items-center py-1.5">
                  <ArrowDown className="h-4 w-4 text-muted-foreground" />
                  <span className="num text-[10.5px] font-semibold text-muted-foreground">100%</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Ficha de cada entidade */}
      <div className="grid gap-4 lg:grid-cols-3">
        {ENTIDADES.map((e) => (
          <Card key={e.id} className="border-border p-4">
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">{e.bandeira}</span>
              <div className="text-[13px] font-bold">{e.nome}</div>
            </div>
            <dl className="mt-3 space-y-2">
              {e.campos.map((c) => (
                <div key={c.rotulo}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{c.rotulo}</dt>
                  <dd className="text-[12px] leading-snug text-foreground">{c.valor}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>

      {/* Governança */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border p-5">
          <Titulo apoio="Nomeado pelas Director Resolutions, nos termos do Voting Agreement">
            Conselho da holding
          </Titulo>
          <ul className="mt-3 space-y-2">
            {CONSELHO.map((d) => (
              <li key={d.nome} className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-[12.5px] font-semibold">{d.nome}</div>
                  <div className="text-[11.5px] text-muted-foreground">{d.observacao}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="border-border p-5">
          <Titulo apoio="Assinados em 22/dez/2025, junto com o SPA">Acordos acessórios</Titulo>
          <div className="mt-3">
            <Quadro
              colunas={["Acordo", "Função"]}
              linhas={ACORDOS_ACESSORIOS.map((a) => [
                <span className="font-medium">{a.nome}</span>,
                <span className="text-muted-foreground">{a.funcao}</span>,
              ])}
            />
          </div>
        </Card>
      </div>

      <Card className="border-border p-5">
        <Titulo apoio="O pacote “Approvals” que autorizou tudo">Aprovações societárias</Titulo>
        <div className="mt-3">
          <Quadro
            colunas={["Deliberação", "O que aprovou"]}
            linhas={APROVACOES.map((a) => [
              <span className="font-medium">{a.nome}</span>,
              <span className="text-muted-foreground">{a.funcao}</span>,
            ])}
          />
        </div>
      </Card>

      <Card className="border-border p-5">
        <Titulo apoio="Quem conduziu cada peça da operação">Assessores</Titulo>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {ASSESSORES.map((a) => (
            <div key={a.nome} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="text-[12.5px] font-semibold">{a.nome}</div>
              </div>
              <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{a.papel}</div>
              {a.pessoas && (
                <div className="mt-1.5 text-[11px] text-muted-foreground/80">{a.pessoas}</div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* =================================================== aba 3 · Linha do tempo */

function LinhaDoTempo() {
  return (
    <Card className="border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Titulo apoio="A montagem da estrutura e a rodada, de outubro a dezembro de 2025">
          Linha do tempo
        </Titulo>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CORES_MARCO) as GrupoMarco[]).map((g) => (
            <span key={g} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", CORES_MARCO[g].ponto)} />
              {CORES_MARCO[g].rotulo}
            </span>
          ))}
        </div>
      </div>

      <ol className="relative mt-5 space-y-0">
        {LINHA_DO_TEMPO.map((m, i) => {
          const c = CORES_MARCO[m.grupo];
          const ultimo = i === LINHA_DO_TEMPO.length - 1;
          return (
            <li key={`${m.dataCurta}-${m.titulo}`} className="flex gap-4">
              <div className="flex w-[92px] shrink-0 flex-col items-end pt-0.5">
                <span className={cn("num text-[11.5px] font-semibold", c.texto)}>{m.dataCurta}</span>
              </div>
              <div className="relative flex flex-col items-center">
                <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-background", c.ponto)} />
                {!ultimo && <span className="w-px flex-1 bg-border" />}
              </div>
              <div className={cn("min-w-0 flex-1", ultimo ? "pb-0" : "pb-5")}>
                <div className="text-[13px] font-semibold leading-snug">{m.titulo}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{m.descricao}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* =================================================== aba 4 · A rodada */

function Rodada() {
  const seedPorClasse = useMemo(() => {
    const m = new Map<string, { acoes: number; brl: number }>();
    for (const c of CONVERSOES_SEED) {
      const at = m.get(c.classe) ?? { acoes: 0, brl: 0 };
      m.set(c.classe, { acoes: at.acoes + c.acoes, brl: at.brl + c.brl });
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, []);

  const maiorTicket = SERIE_A[0].usd;

  return (
    <div className="space-y-5">
      {/* Preço por ação */}
      <Card className="border-border p-5">
        <Titulo apoio="Valor nominal de todas as classes: US$ 0,01">Preço por ação, por classe</Titulo>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PRECOS_POR_ACAO.map((p) => (
            <div
              key={p.classe}
              className={cn(
                "rounded-lg border p-3",
                p.classe === "Series A" ? "border-primary/40 bg-primary/[0.04]" : "border-border",
              )}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{p.classe}</div>
              <div className="num mt-1 text-[19px] font-bold leading-none">
                {p.usd > 0 ? comValorExato(p.usd, usdStr(p.usd, 2), { moeda: "USD" }) : "—"}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {p.ano !== "—" ? `Rodada de ${p.ano}` : ""}{p.nota ? `${p.ano !== "—" ? " · " : ""}${p.nota}` : ""}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          A pilha de preferências ficou em cinco camadas (Series Seed-1 a Seed-4 e Series A). As rodadas Seed
          ocorreram em 2020, 2022 e 2024; a Series Seed-4 foi um <em>secondary</em>, sem aporte de capital novo.
        </p>
      </Card>

      {/* Dinheiro novo */}
      <Card className="border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Titulo apoio="Sete investidores subscreveram ações Series A no fechamento">
            Dinheiro novo — Series A
          </Titulo>
          <div className="text-right">
            <div className="num text-[20px] font-bold leading-none">{usd(SERIE_A_TOTAL.usd)}</div>
            <div className="num text-[11.5px] text-muted-foreground">
              {comValorExato(SERIE_A_TOTAL.brl, brlStr(SERIE_A_TOTAL.brl))} · {num(SERIE_A_TOTAL.acoes)} ações
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {SERIE_A.map((t) => (
            <div key={t.investidor} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{t.investidor}</span>
                    {t.lead && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-primary">
                        lead
                      </span>
                    )}
                  </div>
                  {t.veiculo && <div className="text-[11px] text-muted-foreground">{t.veiculo}</div>}
                </div>
                <div className="text-right">
                  <div className="num text-[12.5px] font-bold">{usd(t.usd)}</div>
                  <div className="num text-[11px] text-muted-foreground">
                    {num(t.acoes)} ações · {pct((t.acoes / SERIE_A_TOTAL.acoes) * 100)} da rodada
                  </div>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${(t.usd / maiorTicket) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[12px] text-muted-foreground">
          Câmbio implícito da rodada: <span className="num">{CAMBIO_RODADA.toFixed(4).replace(".", ",")}</span>{" "}
          (BRL {num(SERIE_A_TOTAL.brl)} ÷ USD {num(Math.round(SERIE_A_TOTAL.usd))}). O Closing ocorreu na data do
          contrato; o pagamento das ações Series A deu-se até 30/dez/2025.
        </p>
      </Card>

      {/* Conversões */}
      <Card className="border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Titulo apoio="Notas conversíveis e SAFEs anteriores viraram ação no fechamento">
            Conversão — Series Seed
          </Titulo>
          <div className="text-right">
            <div className="num text-[20px] font-bold leading-none">{comValorExato(SEED_TOTAL.brl, brlStr(SEED_TOTAL.brl))}</div>
            <div className="num text-[11.5px] text-muted-foreground">{num(SEED_TOTAL.acoes)} ações</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {seedPorClasse.map(([classe, v]) => (
            <span key={classe} className="rounded-md border border-border px-2.5 py-1 text-[11.5px]">
              <span className="font-semibold">{classe}</span>
              <span className="num ml-1.5 text-muted-foreground">{num(v.acoes)} ações · {brlCompacto(v.brl)}</span>
            </span>
          ))}
        </div>

        <div className="mt-3">
          <Quadro
            colunas={["Investidor", "Classe", "Ações", "Valor (BRL)"]}
            alinharDireita={[2, 3]}
            totalUltima
            linhas={[
              ...CONVERSOES_SEED.map((c) => [
                c.investidor,
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{c.classe}</span>,
                num(c.acoes),
                comValorExato(c.brl, brlStr(c.brl)),
              ]),
              ["Total", "", num(SEED_TOTAL.acoes), comValorExato(SEED_TOTAL.brl, brlStr(SEED_TOTAL.brl))],
            ]}
          />
        </div>
      </Card>

      {/* Schedule I + uso dos recursos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border p-5">
          <Titulo apoio="Schedule I do Subscription and Contribution Agreement">
            O que os sócios contribuíram e receberam
          </Titulo>
          <div className="mt-3">
            <Quadro
              colunas={["Sócio", "Contribuído", "Recebido na holding"]}
              totalUltima
              linhas={[
                ...SCHEDULE_I.map((s) => [
                  <span className="font-medium">{s.socio}</span>,
                  <span className="text-muted-foreground">{s.contribuido}</span>,
                  <span>{s.recebido}</span>,
                ]),
                ["Total", "100% da LLC e da Ltda.", `${num(SCHEDULE_I_TOTAL)} ações`],
              ]}
            />
          </div>
          <Caixa titulo="Por que ações diferentes?">
            O fundador recebeu Class B Ordinary (ações ordinárias, de controle). Rafael Furlanetti, sócio minoritário de
            origem, recebeu Series Seed-4 Preference — ações preferenciais —, refletindo sua condição de investidor
            inicial, e não de fundador.
          </Caixa>
        </Card>

        <Card className="border-border p-5">
          <Titulo apoio="Para onde vai o dinheiro que entrou">Uso dos recursos</Titulo>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">{USO_DOS_RECURSOS.texto}</p>
          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reserva carimbada</div>
            <div className="num mt-1 text-[18px] font-bold">
              {comValorExato(USO_DOS_RECURSOS.recompraBrl, brlStr(USO_DOS_RECURSOS.recompraBrl))}
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{USO_DOS_RECURSOS.recompra}</div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* =================================================== aba 5 · Cap table */

function CapTable() {
  const totalConferido = CAP_TABLE.reduce((s, l) => s + l.total, 0);
  const maior = CAP_TABLE[0].total;

  const porTipo = useMemo(() => {
    const m = new Map<TipoSocio, number>();
    for (const l of CAP_TABLE) m.set(l.tipo, (m.get(l.tipo) ?? 0) + l.total);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const classes = [
    { rotulo: "Ordinárias", valor: CAP_TABLE_TOTAIS.ordinarias, cor: "bg-primary" },
    { rotulo: "Series Seed", valor: CAP_TABLE_TOTAIS.seed, cor: "bg-violet-500" },
    { rotulo: "Series A", valor: CAP_TABLE_TOTAIS.serieA, cor: "bg-blue-500" },
  ];

  return (
    <div className="space-y-5">
      {/* Barra de participação */}
      <Card className="border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Titulo apoio="Capital totalmente diluído — revisão de 18/dez/2025">
            Participação por sócio
          </Titulo>
          <div className="text-right">
            <div className="num text-[20px] font-bold leading-none">{num(TOTAL_ACOES)}</div>
            <div className="text-[11.5px] text-muted-foreground">ações no total</div>
          </div>
        </div>

        <div className="mt-4 flex h-7 w-full overflow-hidden rounded-lg border border-border">
          {CAP_TABLE.map((l) => (
            <div
              key={l.socio}
              title={`${l.socio} — ${pct(l.pct)} (${num(l.total)} ações)`}
              className={cn(CORES_SOCIO[l.tipo].barra, "transition-opacity hover:opacity-80")}
              style={{ width: `${(l.total / TOTAL_ACOES) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-3">
          {porTipo.map(([tipo, total]) => (
            <span key={tipo} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span className={cn("h-2.5 w-2.5 rounded-sm", CORES_SOCIO[tipo].barra)} />
              {CORES_SOCIO[tipo].rotulo}
              <span className="num font-semibold text-foreground">{pct((total / TOTAL_ACOES) * 100)}</span>
            </span>
          ))}
        </div>
      </Card>

      {/* Tabela sócio a sócio */}
      <Card className="border-border p-5">
        <Titulo apoio="Ordinárias, Series Seed e Series A somadas por sócio">Cap table consolidado</Titulo>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                {["Sócio", "Ordinárias", "Series Seed", "Series A", "Total", "%"].map((c, i) => (
                  <th
                    key={c}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
                      i === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAP_TABLE.map((l) => (
                <tr key={l.socio} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", CORES_SOCIO[l.tipo].barra)} />
                      <span className="font-medium">{l.socio}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider", CORES_SOCIO[l.tipo].chip)}>
                        {CORES_SOCIO[l.tipo].rotulo}
                      </span>
                    </div>
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-[12.5px] text-muted-foreground">
                    {l.ordinarias ? num(l.ordinarias) : "—"}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-[12.5px] text-muted-foreground">
                    {l.seed ? num(l.seed) : "—"}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-[12.5px] text-muted-foreground">
                    {l.serieA ? num(l.serieA) : "—"}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-[12.5px] font-semibold">{num(l.total)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", CORES_SOCIO[l.tipo].barra)} style={{ width: `${(l.total / maior) * 100}%` }} />
                      </div>
                      <span className="num w-[52px] text-[12.5px] font-semibold">{pct(l.pct)}</span>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-semibold">
                <td className="px-3 py-2 text-[12.5px]">Total</td>
                <td className="num px-3 py-2 text-right text-[12.5px]">{num(CAP_TABLE_TOTAIS.ordinarias)}</td>
                <td className="num px-3 py-2 text-right text-[12.5px]">{num(CAP_TABLE_TOTAIS.seed)}</td>
                <td className="num px-3 py-2 text-right text-[12.5px]">{num(CAP_TABLE_TOTAIS.serieA)}</td>
                <td className="num px-3 py-2 text-right text-[12.5px]">{num(totalConferido)}</td>
                <td className="num px-3 py-2 text-right text-[12.5px]">100,00%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Composição por classe */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border p-5">
          <Titulo apoio="Como as 100.000 ações se dividem entre as classes">Composição por classe</Titulo>
          <div className="mt-4 space-y-3">
            {classes.map((c) => (
              <div key={c.rotulo}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium">{c.rotulo}</span>
                  <span className="num text-muted-foreground">
                    {num(c.valor)} · {pct((c.valor / TOTAL_ACOES) * 100)}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", c.cor)} style={{ width: `${(c.valor / TOTAL_ACOES) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <Caixa titulo="Nota sobre os rótulos das classes">{NOTA_CLASSES}</Caixa>
        </Card>

        <div className="space-y-4">
          <Caixa titulo="Capital totalmente diluído e pool de opções">
            “Totalmente diluído” considera todas as ações como se já emitidas, inclusive o estoque reservado a opções.
            O SOP (Stock Option Pool) — 11.566 ações, cerca de 11,6% — é a reserva destinada a remunerar o time com
            participação societária e ainda não está atribuída a pessoas específicas.
          </Caixa>

          <Card className="border-primary/30 bg-primary/[0.03] p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <div className="text-[13px] font-bold">Simular uma rodada nova</div>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Esta é a foto do fechamento e ela não muda. Para testar pre-money, tamanho de cheque, aumento do pool
              ou uma sequência de rodadas — o que hoje se faz no Excel — o simulador vive no Captable e parte
              exatamente destes números.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/captable?aba=simulador">
                Abrir o simulador
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* =================================================== aba 6 · Documentos */

function RenderBloco({ b }: { b: Bloco }) {
  if (b.t === "p") {
    return <p className="text-[13px] leading-relaxed text-muted-foreground">{b.texto}</p>;
  }
  if (b.t === "destaque") {
    return <Caixa titulo={b.titulo}>{b.texto}</Caixa>;
  }
  if (b.t === "lista") {
    return (
      <ul className="space-y-2.5">
        {b.itens.map((it, i) => (
          <li key={i} className="text-[13px] leading-relaxed text-muted-foreground">
            {it.titulo && <span className="font-semibold text-foreground">{it.titulo}. </span>}
            {it.texto}
          </li>
        ))}
      </ul>
    );
  }
  if (b.t === "figura") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">
        <PieChart className="h-3.5 w-3.5" />
        <span className="italic">{b.legenda}</span>
        {b.veja && <span className="text-muted-foreground/70">— o desenho está na {b.veja} desta página</span>}
      </div>
    );
  }
  // tabela
  const ehNumerica = (v: string) => /^[\d.,%—-]+$/.test(v.trim());
  const direita = b.colunas.map((_, j) => b.linhas.some((l) => ehNumerica(l[j] ?? ""))).flatMap((v, j) => (v ? [j] : []));
  return (
    <Quadro
      colunas={b.colunas}
      alinharDireita={direita}
      totalUltima={b.totalUltima}
      linhas={b.linhas.map((l) => l.map((c) => c))}
    />
  );
}

function LeitorDocumentos() {
  const [doc, setDoc] = useState<Documento>(DOCUMENTOS[0]);

  return (
    <div className="space-y-5">
      {/* Escolha do caderno */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DOCUMENTOS.map((d) => {
          const drive = DOCS_DRIVE.find((x) => x.numero === d.numero);
          const ativo = d.numero === doc.numero;
          return (
            <button
              key={d.numero}
              onClick={() => setDoc(d)}
              className={cn(
                "rounded-lg border p-3.5 text-left transition-colors",
                ativo ? "border-primary/50 bg-primary/[0.05]" : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider",
                  ativo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {d.etapa}
                </span>
                <FileText className={cn("h-3.5 w-3.5", ativo ? "text-primary" : "text-muted-foreground")} />
              </div>
              <div className="mt-2 text-[12.5px] font-semibold leading-snug">{d.titulo}</div>
              {drive && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{drive.conteudo}</div>}
            </button>
          );
        })}
      </div>

      {/* O caderno aberto */}
      <Card className="border-border">
        <div className="border-b border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Documento {doc.numero} de 4
              </div>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight">{doc.titulo}</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{doc.subtitulo}</p>
            </div>
            {(() => {
              const drive = DOCS_DRIVE.find((x) => x.numero === doc.numero);
              if (!drive) return null;
              return (
                <Button asChild variant="outline" size="sm">
                  <a href={drive.url} target="_blank" rel="noreferrer">
                    Abrir o .docx
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              );
            })()}
          </div>

          <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {doc.meta.map((m) => (
              <div key={m.rotulo} className="rounded-md border border-border px-3 py-2">
                <dt className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{m.rotulo}</dt>
                <dd className="text-[11.5px] leading-snug">{m.valor}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-[11.5px] italic leading-relaxed text-muted-foreground">{doc.aviso}</p>
        </div>

        {/* Índice */}
        <div className="border-b border-border bg-muted/20 px-5 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Conteúdo</div>
          <ol className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {doc.secoes.map((s) => (
              <li key={s.numero} className="text-[12px]">
                <a href={`#doc${doc.numero}-s${s.numero}`} className="text-muted-foreground hover:text-foreground hover:underline">
                  <span className="num">{s.numero}.</span> {s.titulo}
                </a>
              </li>
            ))}
          </ol>
        </div>

        {/* Seções */}
        <div className="space-y-7 p-5">
          {doc.secoes.map((s) => (
            <section key={s.numero} id={`doc${doc.numero}-s${s.numero}`} className="scroll-mt-20 space-y-3">
              <h3 className="text-[14px] font-bold tracking-tight">
                <span className="num mr-1.5 text-muted-foreground">{s.numero}.</span>
                {s.titulo}
              </h3>
              {s.blocos.map((b, i) => (
                <RenderBloco key={i} b={b} />
              ))}
            </section>
          ))}

          {/* Notas de rodapé */}
          {doc.notas.length > 0 && (
            <section className="border-t border-border pt-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notas</div>
              <ol className="mt-2 space-y-1">
                {doc.notas.map((n, i) => (
                  <li key={i} className="text-[11.5px] leading-relaxed text-muted-foreground">
                    <span className="num mr-1.5 font-semibold">{i + 1}.</span>
                    {n}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </Card>

      <Card className="border-border p-5">
        <Titulo apoio="Os quatro .docx originais, na pasta compartilhada">Arquivos no Drive</Titulo>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DOCS_DRIVE.map((d) => (
            <a
              key={d.driveId}
              href={d.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted/40"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{d.titulo}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{d.etapa}</span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
        <a
          href={PASTA_DRIVE}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Abrir a pasta inteira no Drive
          <ExternalLink className="h-3 w-3" />
        </a>
      </Card>

      {/* Glossário — fora do caderno, porque serve à tela toda */}
      <Card className="border-border p-5">
        <Titulo apoio="Os termos que aparecem nos contratos e nesta tela">Glossário</Titulo>
        <dl className="mt-3 grid gap-3 md:grid-cols-2">
          {GLOSSARIO.map((g) => (
            <div key={g.termo} className="rounded-md border border-border px-3 py-2">
              <dt className="text-[12px] font-semibold">{g.termo}</dt>
              <dd className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{g.texto}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

/* ================================================================= página */

export default function Flip() {
  const [aba, setAba] = useState("panorama");

  const fundador = CAP_TABLE.find((l) => l.tipo === "fundador");

  return (
    <div className="space-y-4 p-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            INVESTIMENTOS · O FLIP
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Flip &amp; Series A</h1>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              Fechamento em {FECHAMENTO_LABEL}
            </span>
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            Reestruturação societária internacional · Cayman → Delaware → Brasil · Uso interno / data room
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="h-9">
          <Link to="/investimentos">
            Financials LTD / LLC
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          rotulo="Aporte novo (Series A)"
          valor={usdCompacto(SERIE_A_TOTAL.usd)}
          apoio={`${brlCompactoStr(SERIE_A_TOTAL.brl)} · 7 investidores · lead DGF 8, L.P.`}
          icon={Coins}
          destaque
        />
        <Kpi
          rotulo="Conversão (Series Seed)"
          valor={brlCompacto(SEED_TOTAL.brl)}
          apoio={`${num(SEED_TOTAL.acoes)} ações · notas conversíveis e SAFEs de 2020 a 2024`}
          icon={Scale}
        />
        <Kpi
          rotulo="Preço por ação (Series A)"
          valor={comValorExato(PRECOS_POR_ACAO[0].usd, usdStr(PRECOS_POR_ACAO[0].usd, 2), { moeda: "USD" })}
          apoio="Valor nominal US$ 0,01 · cinco camadas de preferência"
          icon={Landmark}
        />
        <Kpi
          rotulo="Capital diluído"
          valor={num(TOTAL_ACOES)}
          apoio="Ações da holding, incluindo o pool de opções (11,57%)"
          icon={PieChart}
        />
        <Kpi
          rotulo="Participação do fundador"
          valor={pct(fundador?.pct ?? 0)}
          apoio={`${num(fundador?.total ?? 0)} ações ordinárias · DGF com 24,00%`}
          icon={Users}
        />
      </div>

      {/* Abas */}
      <Tabs value={aba} onValueChange={setAba} className="space-y-4">
        <div className="border-b border-border">
          <TabsList className="h-auto w-full justify-start gap-0.5 rounded-none border-0 bg-transparent p-0">
            {[
              { v: "panorama", label: "Panorama", icon: BookOpen },
              { v: "estrutura", label: "Estrutura", icon: Building2 },
              { v: "tempo", label: "Linha do tempo", icon: Calendar },
              { v: "rodada", label: "A rodada", icon: Coins },
              { v: "captable", label: "Cap table", icon: PieChart },
              { v: "documentos", label: "Documentos", icon: FileText },
            ].map((t) => (
              <TabsTrigger
                key={t.v}
                value={t.v}
                className={cn(
                  "-mb-px gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2.5 text-[13px] font-medium text-muted-foreground shadow-none",
                  "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="panorama" className="mt-0"><Panorama irPara={setAba} /></TabsContent>
        <TabsContent value="estrutura" className="mt-0"><Estrutura /></TabsContent>
        <TabsContent value="tempo" className="mt-0"><LinhaDoTempo /></TabsContent>
        <TabsContent value="rodada" className="mt-0"><Rodada /></TabsContent>
        <TabsContent value="captable" className="mt-0"><CapTable /></TabsContent>
        <TabsContent value="documentos" className="mt-0"><LeitorDocumentos /></TabsContent>
      </Tabs>
    </div>
  );
}
