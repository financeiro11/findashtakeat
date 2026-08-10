// Aba Extratos — a fatura do cartão, o extrato do Sicoob e o do Asaas, um mês por vez.
//
// As três fontes viram a mesma lista (ver src/lib/mobile/extratos.ts), então a tela é uma
// só: buscar, filtrar por categoria/natureza, tocar para ver o lançamento inteiro.
//
// O mês é o recorte porque é o recorte de quem confere: a fatura fecha por mês e o extrato
// se lê por mês. E porque carregar "tudo" no 4G é como o app fica lento sem ninguém saber
// por quê — o pior mês de qualquer uma das fontes tem ~3.100 linhas, o que cabe; o
// histórico inteiro do Asaas, não.
//
// A tela abre no mês MAIS RECENTE COM DADO, não no mês corrente. Quando uma sync para (já
// aconteceu com o Sicoob), abrir em "agosto" mostraria uma tela vazia que se lê como "não
// gastamos nada" — em vez do que de fato houve, que é o dado ter parado de chegar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Calendar, ChevronDown, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAoVoltar } from "@/hooks/useAoVoltar";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { fmtBRL } from "@/lib/mobile/formato";
import {
  agruparPorDia, categoriasDe, ehFonte, filtrar, fmtDia, FONTES, limitesDoMes, mesAtual, mesDe,
  normalizarBanco, normalizarCartao, rotuloDia, rotuloMes, rotuloMesLongo, totais, ultimosMeses,
  type FonteKey, type LinhaExtrato,
} from "@/lib/mobile/extratos";

const sb = supabase as any;

/** Nenhum mês passa disso hoje; o teto existe para uma fonte que cresça não travar o app. */
const TETO = 4000;
/** Quantos meses o seletor oferece nas fontes bancárias (o cartão lista as faturas reais). */
const MESES_BANCO = 18;

type Estado = {
  linhas: LinhaExtrato[];
  meses: string[];
  /** Data do lançamento mais novo da fonte inteira — denuncia sync parada. */
  ultimoDado: string | null;
  truncado: boolean;
};

const VAZIO: Estado = { linhas: [], meses: [], ultimoDado: null, truncado: false };

export default function MobileExtratos() {
  const [params, setParams] = useSearchParams();
  const fonte: FonteKey = ehFonte(params.get("fonte")) ? (params.get("fonte") as FonteKey) : "cartao";
  const mesUrl = params.get("mes");

  const [estado, setEstado] = useState<Estado>(VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [tipo, setTipo] = useState<"todos" | "entrada" | "saida">("todos");
  const [aberta, setAberta] = useState<LinhaExtrato | null>(null);
  const [trocandoMes, setTrocandoMes] = useState(false);

  const trocarFonte = (f: FonteKey) => {
    setBusca("");
    setCats(new Set());
    setTipo("todos");
    setParams({ fonte: f }, { replace: true }); // sem `mes`: cada fonte reabre no mês dela
  };
  const trocarMes = (m: string) => setParams({ fonte, mes: m }, { replace: true });

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { meses, ultimoDado } = await carregarMeses(fonte);
      // Sem `?mes=` a tela escolhe: o mais recente com dado, ou o mês corrente se a
      // fonte estiver vazia (aí o "nenhum lançamento" é a resposta certa).
      const mes = mesUrl || meses[0] || mesAtual();
      const { linhas, truncado } = await carregarLinhas(fonte, mes);
      setEstado({ linhas, meses: meses.includes(mes) ? meses : [mes, ...meses], ultimoDado, truncado });
    } catch (e: any) {
      // Consulta do Supabase não rejeita sozinha — sem checar `error`, uma policy negando
      // vira "nenhum lançamento neste mês", que é mentira e ninguém investiga.
      setEstado(VAZIO);
      setErro(e?.message ?? "Falha ao carregar");
    } finally {
      setCarregando(false);
    }
  }, [fonte, mesUrl]);

  useEffect(() => { buscar(); }, [buscar]);
  useAoVoltar(buscar);

  const mes = mesUrl || estado.meses[0] || mesAtual();

  const porTipo = useMemo(
    () => (tipo === "todos" ? estado.linhas : estado.linhas.filter((l) => l.entrada === (tipo === "entrada"))),
    [estado.linhas, tipo],
  );
  // Os chips refletem a busca, mas não a si mesmos: filtrar por "Marketing" não pode
  // apagar os outros chips da faixa, senão não há como trocar de categoria sem limpar.
  const categorias = useMemo(() => categoriasDe(filtrar(porTipo, busca, new Set())), [porTipo, busca]);
  const visiveis = useMemo(() => filtrar(porTipo, busca, cats), [porTipo, busca, cats]);
  const soma = useMemo(() => totais(visiveis), [visiveis]);
  const dias = useMemo(() => agruparPorDia(visiveis), [visiveis]);

  const alternarCat = (chave: string) =>
    setCats((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });

  const rotEntrada = fonte === "cartao" ? "Créditos" : "Entradas";
  const rotSaida = fonte === "cartao" ? "Gastos" : "Saídas";
  const filtrando = busca.trim() !== "" || cats.size > 0 || tipo !== "todos";

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-background px-4 pb-2 pt-2.5">
        <div className="flex rounded-lg bg-secondary p-0.5" role="tablist">
          {FONTES.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={fonte === f.key}
              onClick={() => trocarFonte(f.key)}
              className={cn(
                "min-h-[34px] flex-1 rounded-md text-[13px] font-medium transition-colors",
                fonte === f.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {f.nome}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={fonte === "cartao" ? "Buscar lojista, categoria, valor…" : "Buscar nome, histórico, valor…"}
              // text-base (16px) não é estética: abaixo disso o iOS dá zoom no campo ao focar.
              className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-9 text-base placeholder:text-[13px] placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              type="search"
              enterKeyHint="search"
            />
            {busca && (
              <button
                onClick={() => setBusca("")}
                aria-label="Limpar busca"
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setTrocandoMes(true)}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium"
          >
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="num">{rotuloMes(mes)}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip ativo={tipo === "saida"} onClick={() => setTipo(tipo === "saida" ? "todos" : "saida")}>
            {rotSaida}
          </Chip>
          <Chip ativo={tipo === "entrada"} onClick={() => setTipo(tipo === "entrada" ? "todos" : "entrada")}>
            {rotEntrada}
          </Chip>
          <span className="my-1.5 w-px shrink-0 bg-border" aria-hidden />
          {categorias.map((c) => (
            <Chip key={c.chave} ativo={cats.has(c.chave)} onClick={() => alternarCat(c.chave)}>
              <span className="flex items-center gap-1.5">
                {c.dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dot)} />}
                {c.rotulo}
                <span className="num opacity-60">{c.n}</span>
              </span>
            </Chip>
          ))}
        </div>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando {FONTES.find((f) => f.key === fonte)?.nome}…
        </div>
      ) : erro ? (
        <Aviso tom="erro">Não deu para carregar: {erro}</Aviso>
      ) : (
        <>
          <div className="px-4 pt-3">
            <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card py-2.5">
              <Total rotulo={rotEntrada} valor={soma.entradas} classe="text-pos" />
              <Total rotulo={rotSaida} valor={soma.saidas} classe="text-neg" />
              <Total
                rotulo={fonte === "cartao" ? "Fatura" : "Saldo"}
                valor={fonte === "cartao" ? soma.saidas - soma.entradas : soma.saldo}
                classe=""
              />
            </div>
            <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">
              <span className="num">{soma.n}</span> de <span className="num">{estado.linhas.length}</span>{" "}
              {estado.linhas.length === 1 ? "lançamento" : "lançamentos"} em {rotuloMesLongo(mes)}
              {filtrando ? "" : " · sem filtro"}
            </p>
          </div>

          {estado.truncado && (
            <Aviso tom="alerta">
              Mês grande demais: mostrando os {TETO.toLocaleString("pt-BR")} lançamentos mais recentes. O
              restante está no computador.
            </Aviso>
          )}
          {fonte !== "cartao" && estado.ultimoDado && diasAtras(estado.ultimoDado) > 2 && (
            <Aviso tom="alerta">
              Última movimentação registrada em {fmtDia(estado.ultimoDado)} — a sincronização parece parada.
            </Aviso>
          )}

          {dias.length === 0 ? (
            <div className="mx-4 mt-3 rounded-xl border border-border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
              {estado.linhas.length === 0
                ? `Nenhum lançamento em ${rotuloMesLongo(mes)}.`
                : "Nada encontrado com esse filtro."}
              {estado.linhas.length > 0 && (
                <button
                  onClick={() => { setBusca(""); setCats(new Set()); setTipo("todos"); }}
                  className="mt-3 block w-full text-[13px] font-medium text-primary"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {dias.map((d) => (
                <section key={d.dia}>
                  <div className="flex items-baseline justify-between px-4 pb-1.5">
                    <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {rotuloDia(d.dia)}
                    </h2>
                    <span className="num text-[11px] text-muted-foreground">
                      {d.saidas > 0 && <span className="text-neg">−{fmtBRL(d.saidas)}</span>}
                      {d.saidas > 0 && d.entradas > 0 && " · "}
                      {d.entradas > 0 && <span className="text-pos">+{fmtBRL(d.entradas)}</span>}
                    </span>
                  </div>
                  <ul className="divide-y divide-border border-y border-border bg-card">
                    {d.linhas.map((l) => (
                      <li key={l.id}>
                        <button
                          onClick={() => setAberta(l)}
                          className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-secondary/50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">{l.titulo}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                              {l.catDot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", l.catDot)} />}
                              <span className="truncate">{l.catRotulo}</span>
                            </span>
                          </span>
                          <span
                            className={cn(
                              "num shrink-0 text-[14px] font-semibold tabular-nums",
                              l.entrada ? "text-pos" : "text-foreground",
                            )}
                          >
                            {l.entrada ? "+" : "−"}
                            {fmtBRL(l.valor)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <FolhaDetalhe linha={aberta} onFechar={() => setAberta(null)} />
      <FolhaMes
        aberta={trocandoMes}
        meses={estado.meses}
        atual={mes}
        onFechar={() => setTrocandoMes(false)}
        onEscolher={(m) => { trocarMes(m); setTrocandoMes(false); }}
      />
    </div>
  );
}

/* ------------------------------ carregamento ------------------------------ */

/** Estoura em vez de devolver lista vazia — ver o comentário do `catch` lá em cima. */
function conferir<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/**
 * Os meses que o seletor oferece. No cartão são as faturas que existem de fato — não
 * adianta oferecer um mês sem OFX importado. Nas fontes bancárias o extrato é contínuo,
 * então o seletor conta para trás a partir do último lançamento que chegou.
 */
async function carregarMeses(fonte: FonteKey): Promise<{ meses: string[]; ultimoDado: string | null }> {
  if (fonte === "cartao") {
    const dados = conferir(
      await sb.from("cartao_faturas").select("competencia").order("competencia", { ascending: false }),
    ) as { competencia: string }[];
    const meses = (dados ?? []).map((f) => mesDe(f.competencia));
    return { meses, ultimoDado: dados?.[0]?.competencia ?? null };
  }

  const tabela = FONTES.find((f) => f.key === fonte)!.tabela;
  const dados = conferir(
    await sb.from(tabela).select("data_movimento").order("data_movimento", { ascending: false }).limit(1),
  ) as { data_movimento: string }[];
  const ultimoDado = dados?.[0]?.data_movimento ?? null;
  return { meses: ultimosMeses(ultimoDado ? mesDe(ultimoDado) : mesAtual(), MESES_BANCO), ultimoDado };
}

async function carregarLinhas(
  fonte: FonteKey,
  mes: string,
): Promise<{ linhas: LinhaExtrato[]; truncado: boolean }> {
  if (fonte === "cartao") {
    const dados = conferir(
      await sb
        .from("cartao_lancamentos")
        .select("id,data,estabelecimento,categoria,descricao,parcela,cidade,valor,tipo")
        .eq("competencia", `${mes}-01`)
        // Desempate por `id`: ordenar só por `data` é ordem parcial, e o Postgres não
        // promete estabilidade — no desktop isso já duplicou e sumiu linha na paginação.
        .order("data", { ascending: false })
        .order("id")
        .limit(TETO + 1),
    ) as any[];
    return { linhas: (dados ?? []).slice(0, TETO).map(normalizarCartao), truncado: (dados?.length ?? 0) > TETO };
  }

  const tabela = FONTES.find((f) => f.key === fonte)!.tabela;
  const { de, ate } = limitesDoMes(mes);
  const dados = conferir(
    await sb
      .from(tabela)
      .select("id,id_transacao,data_movimento,tipo,valor,historico,contraparte_nome,contraparte_documento,numero_documento")
      .gte("data_movimento", de)
      .lte("data_movimento", ate)
      .order("data_movimento", { ascending: false })
      .order("id")
      .limit(TETO + 1),
  ) as any[];
  return { linhas: (dados ?? []).slice(0, TETO).map(normalizarBanco), truncado: (dados?.length ?? 0) > TETO };
}

function diasAtras(data: string): number {
  const d = new Date(data.slice(0, 10) + "T12:00:00").getTime();
  return Number.isNaN(d) ? 0 : Math.floor((Date.now() - d) / 86_400_000);
}

/* ------------------------------ componentes ------------------------------ */

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-[32px] shrink-0 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
        ativo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Total({ rotulo, valor, classe }: { rotulo: string; valor: number; classe: string }) {
  return (
    <div className="px-2 text-center">
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className={cn("num mt-0.5 truncate text-[13px] font-semibold tabular-nums", classe)}>{fmtBRL(valor)}</div>
    </div>
  );
}

function Aviso({ tom, children }: { tom: "erro" | "alerta"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mx-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]",
        tom === "erro"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400",
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="leading-snug">{children}</span>
    </div>
  );
}

function FolhaDetalhe({ linha, onFechar }: { linha: LinhaExtrato | null; onFechar: () => void }) {
  return (
    <Drawer open={!!linha} onOpenChange={(v) => !v && onFechar()}>
      <DrawerContent className="max-h-[85dvh]">
        {linha && (
          <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <DrawerTitle className="break-words pr-6 text-[16px] leading-snug">{linha.titulo}</DrawerTitle>
            <p
              className={cn(
                "num mt-1 text-[24px] font-bold tabular-nums",
                linha.entrada ? "text-pos" : "text-foreground",
              )}
            >
              {linha.entrada ? "+" : "−"}
              {fmtBRL(linha.valor)}
            </p>
            <dl className="mt-4 divide-y divide-border border-t border-border">
              {linha.campos.map(([rotulo, valor]) => (
                <div key={rotulo} className="flex gap-3 py-2.5">
                  <dt className="w-[38%] shrink-0 text-[12px] text-muted-foreground">{rotulo}</dt>
                  <dd className="min-w-0 flex-1 break-words text-[13px]">{valor}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function FolhaMes({
  aberta, meses, atual, onFechar, onEscolher,
}: {
  aberta: boolean;
  meses: string[];
  atual: string;
  onFechar: () => void;
  onEscolher: (mes: string) => void;
}) {
  return (
    <Drawer open={aberta} onOpenChange={(v) => !v && onFechar()}>
      <DrawerContent className="max-h-[70dvh]">
        <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <DrawerTitle className="text-[16px]">Escolher o mês</DrawerTitle>
          <ul className="mt-3 divide-y divide-border">
            {meses.map((m) => (
              <li key={m}>
                <button
                  onClick={() => onEscolher(m)}
                  className={cn(
                    "flex min-h-[48px] w-full items-center justify-between py-2 text-left text-[14px] active:opacity-60",
                    m === atual && "font-semibold text-primary",
                  )}
                >
                  <span className="capitalize">{rotuloMesLongo(m)}</span>
                  <span className="num text-[12px] text-muted-foreground">{rotuloMes(m)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
