import { useEffect, useMemo, useState } from "react";
import {
  Search, CreditCard, Building2, Sparkles, Loader2, Check, Pencil, Tags,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import { normalize } from "@/lib/normalize";
import {
  filaDeAnonimos, cobertura, apelidoDe, chaveContraparte,
  type Candidato,
} from "@/lib/apelidos";
import { useApelidos, useApelidosCadastro, salvarApelido } from "@/hooks/useApelidos";
import { PainelNomear, type Alvo } from "@/components/parametrizacao/PainelNomear";

/* ---------------------------------------------------------------------------
 * Parametrização — o nome que a contraparte tem para nós.
 *
 * Numa reunião alguém aponta uma linha da DRE e pergunta o que é. O que está
 * escrito é "JIM.COM GRUPO SOUZA" — o que o adquirente mandou, nunca feito para
 * ser lido por gente. Aqui essa contraparte vira "Café dos eventos", e é isso
 * que passa a aparecer na DRE, na DFC, no cartão e nos textos da IA.
 *
 * São ~700 nomes (336 lojistas de cartão + 361 fornecedores do Omie) e é
 * trabalho de uma vez só; depois entra o pingado de cada fatura. A fila não é
 * ordenada por valor — por valor o topo seria META ADS, que ninguém precisa
 * explicar. Ver `chanceDePerguntarem` em src/lib/apelidos.ts.
 * ------------------------------------------------------------------------- */

const db = supabase as unknown as {
  rpc: (n: string, a?: Record<string, unknown>) => any;
  functions: { invoke: (n: string, o?: { body?: unknown }) => any };
};

/** Compacto na tabela; o número cheio fica no hover. */
function brlCurtoStr(v: number | null | undefined): string {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} M`;
  if (a >= 1_000) return `R$ ${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} k`;
  return `R$ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
const brlCurto = (v: number | null | undefined) => comValorExato(v ?? 0, brlCurtoStr(v), { casas: 2 });

const mesCurto = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "") : "";

const periodo = (c: Candidato) => {
  const a = mesCurto(c.primeira);
  const b = mesCurto(c.ultima);
  if (!a && !b) return "—";
  return a === b ? a : `${a} – ${b}`;
};

type Sugestao = { apelido: string; o_que_e?: string | null; confianca?: string | null };

/** Quantas a IA olha por vez. Lote grande estoura o tempo da função. */
const LOTE_SUGESTAO = 25;

export default function Parametrizacao() {
  const mapa = useApelidos();
  const { cadastro, recarregar } = useApelidosCadastro();

  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<"todas" | "cartao" | "omie">("todas");
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [sugestoes, setSugestoes] = useState<Map<string, Sugestao>>(new Map());
  const [sugerindo, setSugerindo] = useState(false);
  const [aceitando, setAceitando] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Configurações · Parametrização";
    db.rpc("parametrizacao_contrapartes").then(
      ({ data, error }: { data: Candidato[] | null; error: { message?: string } | null }) => {
        if (error) {
          toast.error(`Não foi possível ler as contrapartes: ${error.message ?? "erro"}`);
          setCandidatos([]);
          return;
        }
        setCandidatos(data ?? []);
      },
    );
  }, []);

  const porOrigem = useMemo(
    () => (candidatos ?? []).filter((c) => origem === "todas" || c.origem === origem),
    [candidatos, origem],
  );

  const fila = useMemo(() => filaDeAnonimos(porOrigem, mapa), [porOrigem, mapa]);
  const cob = useMemo(() => cobertura(porOrigem, mapa), [porOrigem, mapa]);

  /* Na fila só há nome cru para casar — apelido é justamente o que falta. Na
     aba das nomeadas a busca varre os dois: quem procura "café" tem de achar o
     Grupo Souza, e quem procura "JIM" também. */
  const filaVisivel = useMemo(() => {
    const q = normalize(busca).trim();
    return q ? fila.filter((c) => normalize(c.nome).includes(q)) : fila;
  }, [fila, busca]);

  /* As nomeadas: o cadastro cruzado com o movimento, para mostrar quanto cada
     apelido está cobrindo de verdade. */
  const nomeadas = useMemo(() => {
    const porChave = new Map<string, Candidato>();
    for (const c of porOrigem) {
      const dono = apelidoDe(mapa, c.nome, c.documento);
      if (!dono?.id) continue;
      const atual = porChave.get(dono.id);
      porChave.set(dono.id, atual
        ? { ...atual, lancamentos: atual.lancamentos + c.lancamentos, total: Number(atual.total) + Number(c.total) }
        : c);
    }
    const linhas = cadastro
      .filter((f) => (f.apelido ?? "").trim())
      .map((f) => ({ f, mov: porChave.get(f.id) ?? null }));
    const q = normalize(busca).trim();
    return (q
      ? linhas.filter(({ f }) => normalize(f.nome).includes(q) || normalize(f.apelido ?? "").includes(q))
      : linhas
    ).sort((a, b) => Number(b.mov?.total ?? 0) - Number(a.mov?.total ?? 0));
  }, [cadastro, porOrigem, mapa, busca]);

  const pedirSugestoes = async () => {
    const lote = filaVisivel.slice(0, LOTE_SUGESTAO);
    if (!lote.length) { toast.info("Não há contraparte sem nome nesta lista."); return; }

    setSugerindo(true);
    try {
      const { data, error } = await db.functions.invoke("parametrizacao-sugerir", {
        body: {
          contrapartes: lote.map((c) => ({
            nome: c.nome, origem: c.origem, categoria: c.categoria, cidade: c.cidade,
            lancamentos: c.lancamentos, total: c.total, primeira: c.primeira, ultima: c.ultima,
          })),
        },
      });
      if (error) throw error;

      const novas = new Map(sugestoes);
      for (const s of data?.sugestoes ?? []) {
        if (s?.nome && s?.apelido) novas.set(chaveContraparte(s.nome), s);
      }
      setSugestoes(novas);

      const quantas = (data?.sugestoes ?? []).filter((s: Sugestao & { nome?: string }) => s?.apelido).length;
      toast.success(`${quantas} de ${lote.length} com sugestão. Confira cada uma antes de aceitar.`);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Não foi possível pedir as sugestões.");
    } finally {
      setSugerindo(false);
    }
  };

  const aceitar = async (c: Candidato, s: Sugestao) => {
    setAceitando(c.nome);
    const { error } = await salvarApelido(c.nome, {
      apelido: s.apelido,
      oQueE: s.o_que_e ?? null,
      documento: c.documento,
      categoria: c.categoria,
      origem: c.origem,
    });
    setAceitando(null);
    if (error) { toast.error(error); return; }
    toast.success(`"${c.nome}" agora é "${s.apelido}".`);
    await recarregar();
  };

  const abrir = (c: Candidato) => {
    const dono = apelidoDe(mapa, c.nome, c.documento);
    const cad = dono?.id ? cadastro.find((f) => f.id === dono.id) ?? null : null;
    const s = sugestoes.get(chaveContraparte(c.nome));
    setAlvo({
      candidato: c,
      cadastro: cad,
      rascunho: s ? { apelido: s.apelido, oQueE: s.o_que_e ?? null } : null,
    });
  };

  const pct = Math.round(cob.pct * 100);

  return (
    <div className="grid max-w-5xl gap-4">
      {/* ------------------------ cabeçalho ------------------------ */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Tags className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Parametrização</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              O nome que a contraparte tem <em>para nós</em>. O extrato entrega
              "JIM.COM GRUPO SOUZA"; aqui isso vira "Café dos eventos" e passa a
              aparecer assim na DRE, na DFC, no cartão e nos textos da IA — com o
              nome original logo abaixo, para conferir no Omie.
            </p>
          </div>
        </div>

        {/* A cobertura é medida em VALOR, não em contagem: nomear 300 lojistas
            de R$ 50 não muda uma reunião. */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium">
              {pct}% do valor já sabe dizer o próprio nome
            </span>
            <span className="text-muted-foreground">
              {cob.nomeadas} de {cob.total} contrapartes ·{" "}
              <span title={valorExato(cob.valorNomeado)}>{brlCurtoStr(cob.valorNomeado)}</span>
              {" de "}
              <span title={valorExato(cob.valorTotal)}>{brlCurtoStr(cob.valorTotal)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(pct, cob.nomeadas > 0 ? 1 : 0))}%` }}
            />
          </div>
        </div>
      </Card>

      {/* ------------------------ filtros ------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pelo nome do extrato ou pelo apelido…"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        {(["todas", "cartao", "omie"] as const).map((o) => (
          <Button
            key={o} size="sm"
            variant={origem === o ? "secondary" : "ghost"}
            className="h-8 text-[12px]"
            onClick={() => setOrigem(o)}
          >
            {o === "todas" ? "Todas" : o === "cartao" ? "Cartão" : "Omie"}
          </Button>
        ))}
      </div>

      {/* ------------------------ as duas listas ------------------------ */}
      <Tabs defaultValue="fila">
        <TabsList>
          <TabsTrigger value="fila" className="text-[12.5px]">
            A nomear <span className="ml-1 text-muted-foreground">{fila.length}</span>
          </TabsTrigger>
          <TabsTrigger value="nomeadas" className="text-[12.5px]">
            Nomeadas <span className="ml-1 text-muted-foreground">{nomeadas.length}</span>
          </TabsTrigger>
        </TabsList>

        {/* ---------- fila ---------- */}
        <TabsContent value="fila" className="mt-3">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <p className="text-[11.5px] text-muted-foreground">
                Primeiro <strong className="font-medium text-foreground">os nomes que não dizem o que são</strong> —
                categoria genérica ou lojista cortado pelo extrato. Não é por valor: o maior gasto
                costuma ser o mais óbvio. Transferência entre contas próprias e pagamento de fatura
                já ficam de fora.
              </p>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11.5px]"
                onClick={pedirSugestoes} disabled={sugerindo || !filaVisivel.length}>
                {sugerindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Sugerir os {Math.min(LOTE_SUGESTAO, filaVisivel.length)} primeiros
              </Button>
            </div>

            {candidatos === null ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </div>
            ) : filaVisivel.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
                {busca ? "Nada com esse termo." : "Todas as contrapartes desta lista já têm nome."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Contraparte</th>
                      <th className="px-2 py-2 text-right font-medium">Lçtos</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="px-2 py-2 font-medium">Período</th>
                      <th className="px-4 py-2 font-medium">Sugestão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filaVisivel.map((c) => {
                      const s = sugestoes.get(chaveContraparte(c.nome));
                      const Icone = c.origem === "cartao" ? CreditCard : Building2;
                      return (
                        <tr
                          key={`${c.origem}:${c.nome}`}
                          className="cursor-pointer border-b border-border/60 align-top last:border-0 hover:bg-muted/40"
                          onClick={() => abrir(c)}
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-start gap-1.5">
                              <Icone className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <div className="break-all font-medium">{c.nome}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {[c.categoria, c.cidade].filter(Boolean).join(" · ") || "—"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right num text-muted-foreground">
                            {c.lancamentos}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right num font-medium">
                            {brlCurto(c.total)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-[11px] text-muted-foreground">
                            {periodo(c)}
                          </td>
                          <td className="px-4 py-2">
                            {s ? (
                              <div className="flex items-start gap-1.5">
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium">{s.apelido}</div>
                                  {s.o_que_e && (
                                    <div className="text-[10px] leading-snug text-muted-foreground">{s.o_que_e}</div>
                                  )}
                                  {s.confianca && s.confianca !== "alta" && (
                                    <Badge variant="outline" className="mt-0.5 h-4 px-1 text-[9px]">
                                      {s.confianca === "media" ? "confiança média" : "incerto"}
                                    </Badge>
                                  )}
                                </div>
                                <Button
                                  size="sm" variant="ghost"
                                  className="ghost-icone ghost-icone-sm shrink-0"
                                  title={`Aceitar "${s.apelido}"`}
                                  disabled={aceitando === c.nome}
                                  onClick={(e) => { e.stopPropagation(); void aceitar(c, s); }}
                                >
                                  {aceitando === c.nome
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Check className="h-3.5 w-3.5 text-emerald-600" />}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Nomear…</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ---------- nomeadas ---------- */}
        <TabsContent value="nomeadas" className="mt-3">
          <Card className="overflow-hidden">
            {nomeadas.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
                {busca ? "Nada com esse termo." : "Nenhuma contraparte nomeada ainda — comece pela fila."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Apelido</th>
                      <th className="px-2 py-2 font-medium">No extrato</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {nomeadas.map(({ f, mov }) => (
                      <tr key={f.id} className="border-b border-border/60 align-top last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2">
                          <div className="font-medium">{f.apelido}</div>
                          {f.o_que_e && (
                            <div className="text-[10px] leading-snug text-muted-foreground">{f.o_que_e}</div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="break-all text-[11px] text-muted-foreground">{f.nome}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right num">
                          {mov ? brlCurto(mov.total) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm" variant="ghost" className="ghost-icone ghost-icone-sm"
                            title="Editar"
                            onClick={() => abrir(mov ?? {
                              origem: f.origem ?? "manual", nome: f.nome, documento: f.documento,
                              categoria: f.categoria, cidade: null, lancamentos: 0, total: 0,
                              primeira: null, ultima: null,
                            })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <PainelNomear
        alvo={alvo}
        cadastro={cadastro}
        onFechar={() => setAlvo(null)}
        onGravado={() => { void recarregar(); }}
      />
    </div>
  );
}
