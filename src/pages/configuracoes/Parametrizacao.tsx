import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, CreditCard, Building2, RefreshCw, Loader2, Check, Pencil, Tags,
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
  intervaloDaJanela, rotuloMesFechado,
  type Candidato, type Janela,
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
  from: (t: string) => any;
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

/* O que uma planilha de formulário diz sobre esta contraparte. Vem de
   `parametrizacao_evidencias`, escrita pelo sync — não é palpite de modelo, é o
   que alguém digitou no formulário quando fez o gasto. */
type Evidencia = {
  fonte: string;
  chave: string;
  chave_tipo: string;
  confianca: string;
  apelido: string | null;
  o_que_e: string | null;
  detalhe: string | null;
  ocorrencias: number;
  aplicado_em: string | null;
};

const ROTULO_FONTE: Record<string, string> = {
  compras: "Compras",
  reembolsos: "Reembolsos",
  nfs_colaboradores: "NFs colaborador",
  eventos: "Eventos & Parcerias",
};

const ROTULO_CHAVE: Record<string, string> = {
  cnpj: "CNPJ",
  valor_data: "valor + data",
  nome: "nome",
};

/* Um fornecedor sem nome em março pesa menos do que um de julho, que acabou de
   fechar. A janela não é filtro de tela: vai para a RPC, então o denominador da
   cobertura é o dinheiro DO PERÍODO. */
const JANELAS: { v: Janela; rotulo: string }[] = [
  { v: "fechado", rotulo: rotuloMesFechado() },
  { v: "3m", rotulo: "3 meses" },
  { v: "6m", rotulo: "6 meses" },
  { v: "12m", rotulo: "12 meses" },
  { v: "tudo", rotulo: "Tudo" },
];

const DESCRICAO_JANELA: Record<Janela, string> = {
  fechado: `do mês fechado (${rotuloMesFechado()})`,
  "3m": "dos últimos 3 meses",
  "6m": "dos últimos 6 meses",
  "12m": "dos últimos 12 meses",
  tudo: "de toda a base",
};

export default function Parametrizacao() {
  const mapa = useApelidos();
  const { cadastro, recarregar } = useApelidosCadastro();

  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<"todas" | "cartao" | "omie">("todas");
  /* Abre nos 3 meses e não em "Tudo": a fila serve para a próxima reunião, não
     para zerar o histórico. Quem quiser o retrato completo troca num clique. */
  const [janela, setJanela] = useState<Janela>("3m");
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [evidencias, setEvidencias] = useState<Map<string, Evidencia>>(new Map());
  const [sincronizando, setSincronizando] = useState(false);
  const [aceitando, setAceitando] = useState<string | null>(null);

  const carregarEvidencias = useCallback(async () => {
    const { data } = await db.from("parametrizacao_evidencias")
      .select("fonte,chave,chave_tipo,confianca,apelido,o_que_e,detalhe,ocorrencias,aplicado_em");
    const m = new Map<string, Evidencia>();
    // Uma contraparte pode ter evidência de mais de uma planilha; fica a de maior
    // confiança, e no empate a que tem mais linhas por trás.
    const peso = (e: Evidencia) => (e.confianca === "alta" ? 2 : e.confianca === "media" ? 1 : 0);
    for (const e of (data ?? []) as Evidencia[]) {
      const atual = m.get(e.chave);
      if (!atual || peso(e) > peso(atual) || (peso(e) === peso(atual) && e.ocorrencias > atual.ocorrencias)) {
        m.set(e.chave, e);
      }
    }
    setEvidencias(m);
  }, []);

  useEffect(() => { document.title = "Configurações · Parametrização"; }, []);
  useEffect(() => { void carregarEvidencias(); }, [carregarEvidencias]);

  /* Recarrega a cada troca de janela — a RPC é quem corta o período, então os
     números do cabeçalho mudam junto com a lista. */
  useEffect(() => {
    let vivo = true;
    setCandidatos(null);
    const { de, ate } = intervaloDaJanela(janela);
    db.rpc("parametrizacao_contrapartes", { p_de: de, p_ate: ate }).then(
      ({ data, error }: { data: Candidato[] | null; error: { message?: string } | null }) => {
        if (!vivo) return;
        if (error) {
          toast.error(`Não foi possível ler as contrapartes: ${error.message ?? "erro"}`);
          setCandidatos([]);
          return;
        }
        setCandidatos(data ?? []);
      },
    );
    return () => { vivo = false; };
  }, [janela]);

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

  /**
   * Relê as quatro planilhas de formulário e recruza com as contrapartes.
   *
   * O que vier por CNPJ é identidade e entra sozinho; o resto vira proposta na
   * coluna ao lado. Roda também num cron semanal — este botão é para quando
   * alguém acabou de preencher o formulário e não quer esperar.
   */
  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const { data, error } = await db.functions.invoke("parametrizacao-planilhas-sync", { body: {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "falhou");

      const bloqueadas = Object.entries(data.fontes ?? {})
        .filter(([, v]) => (v as { erro: string | null }).erro)
        .map(([k]) => ROTULO_FONTE[k] ?? k);

      await Promise.all([carregarEvidencias(), recarregar()]);
      toast.success(
        `${data.aplicados_por_cnpj} nomeadas pelo CNPJ e ${data.propostas} propostas a conferir.`
        + (bloqueadas.length ? ` Sem acesso a: ${bloqueadas.join(", ")}.` : ""),
      );
    } catch (e) {
      toast.error((e as Error)?.message ?? "Não foi possível ler as planilhas.");
    } finally {
      setSincronizando(false);
    }
  };

  const aceitar = async (c: Candidato, e: Evidencia) => {
    if (!e.apelido) return;
    setAceitando(c.nome);
    const { error } = await salvarApelido(c.nome, {
      apelido: e.apelido,
      oQueE: e.o_que_e ?? null,
      documento: c.documento,
      categoria: c.categoria,
      origem: c.origem,
    });
    setAceitando(null);
    if (error) { toast.error(error); return; }
    toast.success(`"${c.nome}" agora é "${e.apelido}".`);
    await recarregar();
  };

  const abrir = (c: Candidato) => {
    const dono = apelidoDe(mapa, c.nome, c.documento);
    const cad = dono?.id ? cadastro.find((f) => f.id === dono.id) ?? null : null;
    const e = evidencias.get(chaveContraparte(c.nome));
    setAlvo({
      candidato: c,
      cadastro: cad,
      // A proposta da planilha entra no painel como rascunho, para clicar na
      // linha não jogar fora o que o formulário já respondeu.
      rascunho: e?.apelido ? { apelido: e.apelido, oQueE: e.o_que_e ?? null } : null,
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
        {/* A janela fica JUNTO da barra, não na fileira de filtros: ela é o
            denominador do número que está logo abaixo, e não um filtro de lista. */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] text-muted-foreground">Cobrar nome de:</span>
          {JANELAS.map((j) => (
            <Button
              key={j.v} size="sm"
              variant={janela === j.v ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11.5px]"
              onClick={() => setJanela(j.v)}
            >
              {j.rotulo}
            </Button>
          ))}
        </div>

        <div className="mt-2.5">
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="font-medium">
              {pct}% do valor {DESCRICAO_JANELA[janela]} já sabe dizer o próprio nome
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
                onClick={sincronizar} disabled={sincronizando}
                title="Relê Compras, Reembolsos, NFs de colaborador e Eventos & Parcerias">
                {sincronizando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Atualizar das planilhas
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
                      <th className="px-4 py-2 font-medium">O que a planilha diz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filaVisivel.map((c) => {
                      const ev = evidencias.get(chaveContraparte(c.nome));
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
                          {/* Nada aqui é palpite: é o que alguém escreveu no
                              formulário na hora de gastar. O rodapé diz de qual
                              planilha veio e por qual chave casou — é o que
                              permite conferir antes de aceitar. */}
                          <td className="px-4 py-2">
                            {ev ? (
                              <div className="flex items-start gap-1.5">
                                <div className="min-w-0 flex-1">
                                  {ev.apelido
                                    ? <div className="font-medium">{ev.apelido}</div>
                                    : <div className="italic text-muted-foreground">sem nome na planilha</div>}
                                  {ev.o_que_e && (
                                    <div className="text-[10px] leading-snug text-muted-foreground">{ev.o_que_e}</div>
                                  )}
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                    <Badge variant="outline" className="h-4 px-1 text-[9px]" title={ev.detalhe ?? undefined}>
                                      {ROTULO_FONTE[ev.fonte] ?? ev.fonte}
                                    </Badge>
                                    <span className="text-[9px] text-muted-foreground">
                                      por {ROTULO_CHAVE[ev.chave_tipo] ?? ev.chave_tipo}
                                      {ev.ocorrencias > 1 && ` · ${ev.ocorrencias} linhas`}
                                    </span>
                                  </div>
                                </div>
                                {ev.apelido && (
                                  <Button
                                    size="sm" variant="ghost"
                                    className="ghost-icone ghost-icone-sm shrink-0"
                                    title={`Aceitar "${ev.apelido}"`}
                                    disabled={aceitando === c.nome}
                                    onClick={(e) => { e.stopPropagation(); void aceitar(c, ev); }}
                                  >
                                    {aceitando === c.nome
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <Check className="h-3.5 w-3.5 text-emerald-600" />}
                                  </Button>
                                )}
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
