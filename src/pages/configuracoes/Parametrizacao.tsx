import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, CreditCard, Building2, RefreshCw, Loader2, Check, CheckCircle2, CheckSquare,
  ChevronRight, Flag, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { normalize } from "@/lib/normalize";
import {
  filaDeAnonimos, apelidoDe, chaveContraparte, intervaloDaJanela,
  type Candidato, type Janela,
} from "@/lib/apelidos";
import {
  agruparGrafias, chaveGrafia, ordenarGrupos, totalDoGrupo,
  type Confianca, type GrupoDeGrafias, type Proposta,
} from "@/lib/clustersParametrizacao";
import {
  useApelidos, useApelidosCadastro, salvarGruposApelido,
  ignorarContrapartes, marcarRevisao, removerApelido, desfazerGrafia,
  type FornecedorCadastro, type Grafia,
} from "@/hooks/useApelidos";
import { PainelNomear, type Alvo } from "@/components/parametrizacao/PainelNomear";

/* ---------------------------------------------------------------------------
 * Parametrização — o nome que a contraparte tem para nós.
 *
 * Numa reunião alguém aponta uma linha da DRE e pergunta o que é. O que está
 * escrito é "JIM.COM GRUPO SOUZA" — o que o adquirente mandou, nunca feito para
 * ser lido por gente. Aqui essa contraparte vira "Café dos eventos", e é isso
 * que passa a aparecer na DRE, na DFC, no cartão e nos textos da IA.
 *
 * A TELA TEM DUAS SUPERFÍCIES:
 *   • Fila — o que ainda não tem nome, JÁ AGRUPADO. A unidade de trabalho é o
 *     grupo, não a grafia: "AFIXCODE SOLU" e "AFIXCODE SOLUCOE" são uma pergunta
 *     só, e responder duas vezes é o que fazia 440 linhas parecerem
 *     intransponíveis. Quem agrupa é `clustersParametrizacao.ts`, e o motivo da
 *     junção fica escrito na linha — junção sem motivo visível é junção que
 *     ninguém confere.
 *   • Base — o que já tem nome, com as grafias que cada nome está cobrindo, quem
 *     nomeou e quando. É onde se solta uma grafia que entrou errada e se marca
 *     para reler o que ficou em dúvida.
 *
 * A janela é fixa em 12 meses. A barra de cobertura ("43% do valor já sabe dizer
 * o próprio nome") saiu junto com o seletor de janela: o que a tira de números
 * responde agora é "quanto falta e por onde começar", não "quanto já andamos".
 * ------------------------------------------------------------------------- */

const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
  functions: { invoke: (n: string, o?: { body?: unknown }) => any };
};

const JANELA: Janela = "12m";

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

const dataCurta = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }).replace(".", "") : "";

/** "hoje, 09:12" enquanto for hoje; depois vira data. Nomear é trabalho de sessão
 *  — dentro dela a hora é o que localiza; uma semana depois, não. */
function quando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (d.toDateString() === new Date().toDateString()) {
    return `hoje, ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }).replace(".", "");
}

const ehHoje = (iso: string | null) =>
  !!iso && new Date(iso).toDateString() === new Date().toDateString();

/* A cor diz uma coisa só: o quanto dá para confiar no que está proposto. Verde
   vai em bloco, âmbar pede um olhar, roxo pede leitura. */
const CONF: Record<Confianca, { chip: string; faixa: string }> = {
  alta: { chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", faixa: "border-l-emerald-500" },
  media: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", faixa: "border-l-amber-400" },
  baixa: { chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400", faixa: "border-l-violet-400" },
};

const ORIGEM: Record<string, { rotulo: string; classe: string; Icone: typeof CreditCard }> = {
  cartao: { rotulo: "cartão", classe: "bg-sky-500/10 text-sky-700 dark:text-sky-400", Icone: CreditCard },
  omie: { rotulo: "Omie", classe: "bg-purple-500/10 text-purple-700 dark:text-purple-400", Icone: Building2 },
};
const origemDe = (o: string | null | undefined) =>
  ORIGEM[String(o ?? "")] ?? { rotulo: String(o ?? "manual"), classe: "bg-muted text-muted-foreground", Icone: Building2 };

const ROTULO_FONTE: Record<string, string> = {
  compras: "Compras",
  reembolsos: "Reembolsos",
  nfs_colaboradores: "NFs colaborador",
  eventos: "Eventos & Parcerias",
};

type Evidencia = {
  fonte: string;
  chave: string;
  chave_tipo: string;
  confianca: string;
  apelido: string | null;
  o_que_e: string | null;
  ocorrencias: number;
};

/* As colunas moram numa constante porque a linha aberta REPETE a grade: sem o
   mesmo template, a grafia de dentro não fica embaixo da coluna de fora e a
   tabela deixa de ser tabela. */
const GRADE_FILA = "34px minmax(140px,1fr) minmax(0,124px) 54px minmax(0,104px) minmax(0,244px) 30px";
const GRADE_BASE = "minmax(150px,1.1fr) minmax(120px,1fr) 60px 54px minmax(0,104px) minmax(0,150px) 30px";

/** O segmentado do desenho — abas e filtros usam a mesma peça. */
function Segmentado<T extends string>({
  valor, onEscolher, opcoes, alto,
}: {
  valor: T;
  onEscolher: (v: T) => void;
  opcoes: { v: T; rotulo: string; n?: number }[];
  alto?: boolean;
}) {
  return (
    <div className={cn("inline-flex items-center rounded-md bg-muted p-[3px]", alto ? "h-8" : "h-[30px]")}>
      {opcoes.map((o) => (
        <button
          key={o.v} type="button" onClick={() => onEscolher(o.v)}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-[4px] px-3 py-1 text-[12.5px] font-medium transition",
            valor === o.v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.rotulo}
          {o.n !== undefined && <span className="num text-[10.5px] text-muted-foreground">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}

function SeloOrigem({ origem }: { origem: string | null | undefined }) {
  const o = origemDe(origem);
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-px text-[10.5px] font-semibold", o.classe)}>
      {o.rotulo}
    </span>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">{children}</div>;
}

export default function Parametrizacao() {
  const mapa = useApelidos();
  const { cadastro, grafias, recarregar } = useApelidosCadastro();

  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [evidencias, setEvidencias] = useState<Map<string, Evidencia>>(new Map());
  const [autores, setAutores] = useState<Map<string, string>>(new Map());

  const [aba, setAba] = useState<"fila" | "base">("fila");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "alta" | "revisar">("todos");
  const [buscaBase, setBuscaBase] = useState("");
  const [filtroBase, setFiltroBase] = useState<"todas" | "multiplas" | "revisar">("todas");

  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const [abertosBase, setAbertosBase] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [soltas, setSoltas] = useState<Record<string, string[]>>({});
  /* Os grupos que acabaram de ganhar nome. Eles JÁ SAÍRAM da fila (o cadastro
     mudou), mas continuam desenhados no lugar até a próxima troca de filtro:
     confirmar quarenta e ver quarenta linhas sumirem de uma vez é perder o fio
     de onde se estava. */
  const [feitos, setFeitos] = useState<Map<string, { apelido: string; grupo: GrupoDeGrafias }>>(() => new Map());

  const [sincronizando, setSincronizando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [alvo, setAlvo] = useState<Alvo | null>(null);

  useEffect(() => { document.title = "Configurações · Parametrização"; }, []);

  const carregarEvidencias = useCallback(async () => {
    const { data } = await db.from("parametrizacao_evidencias")
      .select("fonte,chave,chave_tipo,confianca,apelido,o_que_e,ocorrencias");
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

  useEffect(() => { void carregarEvidencias(); }, [carregarEvidencias]);

  useEffect(() => {
    db.from("profiles").select("user_id,nome").then(
      ({ data }: { data: { user_id: string; nome: string | null }[] | null }) =>
        setAutores(new Map((data ?? []).map((p) => [p.user_id, (p.nome ?? "").trim()]))),
    );
  }, []);

  useEffect(() => {
    let vivo = true;
    const { de, ate } = intervaloDaJanela(JANELA);
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
  }, []);

  /* ------------------------------------------------------------------ fila */

  const fila = useMemo(() => filaDeAnonimos(candidatos ?? [], mapa), [candidatos, mapa]);

  /* O que as planilhas de formulário responderam. Não é palpite de modelo: é o
     que alguém digitou no formulário na hora de gastar, e por isso manda no nome
     proposto. Casou por CNPJ é identidade — entra como alta. */
  const propostas = useMemo(() => {
    const m = new Map<string, Proposta>();
    for (const [chave, e] of evidencias) {
      m.set(chave, {
        apelido: e.apelido,
        forte: e.chave_tipo === "cnpj",
        fonte: ROTULO_FONTE[e.fonte] ?? e.fonte,
      });
    }
    return m;
  }, [evidencias]);

  const grupos = useMemo(() => agruparGrafias(fila, { propostas }), [fila, propostas]);

  const nomeDo = useCallback(
    (g: GrupoDeGrafias) => (nomes[g.id] !== undefined ? nomes[g.id] : g.sugestao),
    [nomes],
  );
  const somaDo = useCallback(
    (g: GrupoDeGrafias) => totalDoGrupo(g, soltas[g.id] ?? []),
    [soltas],
  );

  const nAlta = grupos.filter((g) => g.conf === "alta").length;
  const valorNaFila = grupos.reduce((t, g) => t + somaDo(g).total, 0);
  const nomeadosHoje = cadastro.filter((f) => (f.apelido ?? "").trim() && ehHoje(f.apelido_em)).length;

  const visiveis = useMemo(() => {
    const q = normalize(busca).trim();
    const lista = grupos.filter((g) => {
      if (filtro === "alta" && g.conf !== "alta") return false;
      if (filtro === "revisar" && g.conf === "alta") return false;
      if (q && !g.grafias.some((c) => normalize(c.nome).includes(q))) return false;
      return true;
    });
    return ordenarGrupos(lista, (g) => somaDo(g).total);
  }, [grupos, busca, filtro, somaDo]);

  /* Os recém-nomeados voltam para a lista NO LUGAR onde estavam — mesma ordem,
     mesmos filtros. Se subissem para o topo, confirmar uma linha do meio da tela
     jogaria a rolagem para longe do ponto em que se estava lendo. */
  const linhasDaFila = useMemo(() => {
    const q = normalize(busca).trim();
    const ordem: Record<Confianca, number> = { alta: 0, media: 1, baixa: 2 };
    const prontos = [...feitos.values()]
      .filter(({ grupo }) => {
        if (filtro === "alta" && grupo.conf !== "alta") return false;
        if (filtro === "revisar" && grupo.conf === "alta") return false;
        return !q || grupo.grafias.some((c) => normalize(c.nome).includes(q));
      })
      .map(({ grupo, apelido }) => ({ g: grupo, apelido }));

    const jaProntos = new Set(prontos.map((p) => p.g.id));
    const pendentes = visiveis
      .filter((g) => !jaProntos.has(g.id))
      .map((g) => ({ g, apelido: "" }));

    return [...prontos, ...pendentes].sort(
      (a, b) => ordem[a.g.conf] - ordem[b.g.conf] || somaDo(b.g).total - somaDo(a.g).total,
    );
  }, [visiveis, feitos, busca, filtro, somaDo]);

  const marcados = useMemo(
    () => visiveis.filter((g) => sel.has(g.id)),
    [visiveis, sel],
  );
  const todosMarcados = visiveis.length > 0 && visiveis.every((g) => sel.has(g.id));

  const alternar = <T,>(s: Set<T>, v: T) => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  };

  /* Trocar de filtro ou de aba é começar outra varredura: as linhas verdes do
     "acabei de nomear" ficam para trás, senão a lista vai acumulando o que já
     não faz parte do trabalho. */
  const trocarFiltro = (v: typeof filtro) => { setFiltro(v); setFeitos(new Map()); };
  const trocarAba = (v: typeof aba) => { setAba(v); setFeitos(new Map()); };

  const confirmar = async (lista: GrupoDeGrafias[]) => {
    const paraGravar = lista
      .map((g) => ({ g, apelido: (nomeDo(g) || "").trim(), dentro: somaDo(g).grafias }))
      .filter((x) => x.apelido.length >= 2 && x.dentro.length > 0);

    if (!paraGravar.length) {
      toast.error("Escreva o nome interno antes de confirmar.");
      return;
    }

    setGravando(true);
    const { gravados, grafias: juntadas, erros } = await salvarGruposApelido(
      paraGravar.map(({ g, apelido, dentro }) => ({
        apelido,
        grafias: dentro.map((c) => ({
          nome: c.nome, documento: c.documento, categoria: c.categoria, origem: c.origem,
        })),
      })),
    );
    setGravando(false);

    if (gravados) {
      setFeitos((m) => {
        const n = new Map(m);
        for (const { g, apelido } of paraGravar) n.set(g.id, { apelido, grupo: g });
        return n;
      });
      setSel((s) => {
        const n = new Set(s);
        for (const { g } of paraGravar) n.delete(g.id);
        return n;
      });
      toast.success(
        gravados === 1
          ? `"${paraGravar[0].apelido}" agora é o nome que aparece na DRE e na DFC.`
            + (juntadas ? ` ${juntadas} ${juntadas === 1 ? "grafia entrou junto" : "grafias entraram junto"}.` : "")
          : `${gravados} contrapartes nomeadas${juntadas ? `, com ${juntadas} grafias juntadas` : ""}.`,
      );
    }
    if (erros.length) toast.error(`Não gravou tudo: ${erros[0]}`);
  };

  const desfazer = async (g: GrupoDeGrafias) => {
    const principal = g.grafias[0];
    const dono = apelidoDe(mapa, principal.nome, principal.documento);
    setFeitos((m) => {
      const n = new Map(m);
      n.delete(g.id);
      return n;
    });
    if (!dono?.id) return;
    const { error } = await removerApelido(dono.id);
    if (error) { toast.error(error); return; }
    toast.success("Nome removido. A contraparte volta para a fila.");
  };

  /* O que foi separado não é descartado junto: separar já foi dizer "esta não é
     deste grupo", e o "não é fornecedor" fala do grupo. A grafia solta continua
     na fila, por conta própria. */
  const descartar = async (g: GrupoDeGrafias) => {
    const dentro = somaDo(g).grafias;
    if (!dentro.length) return;
    setGravando(true);
    const { error } = await ignorarContrapartes(
      dentro.map((c) => ({ nome: c.nome, documento: c.documento, origem: c.origem })),
    );
    setGravando(false);
    if (error) { toast.error(error); return; }
    setSel((s) => { const n = new Set(s); n.delete(g.id); return n; });
    toast.success(
      dentro.length === 1
        ? `"${dentro[0].nome}" saiu da fila.`
        : `${dentro.length} grafias saíram da fila.`,
    );
  };

  /**
   * Relê as quatro planilhas de formulário e recruza com as contrapartes.
   * O que vier por CNPJ é identidade e entra sozinho; o resto vira a sugestão da
   * linha. Roda também num cron semanal — este botão é para quem acabou de
   * preencher o formulário e não quer esperar.
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

  /* ------------------------------------------------------------------ base */

  /* O movimento por grafia, para a Base dizer quanto cada nome está cobrindo de
     verdade. Indexado pela mesma chave normalizada da exibição — é ela que casa
     "Banestes" do cadastro com "BANESTES" do extrato. */
  const movimento = useMemo(() => {
    const m = new Map<string, { lancamentos: number; total: number; primeira: string | null; ultima: string | null }>();
    for (const c of candidatos ?? []) {
      const k = chaveContraparte(c.nome);
      const a = m.get(k);
      m.set(k, {
        lancamentos: (a?.lancamentos ?? 0) + (Number(c.lancamentos) || 0),
        total: (a?.total ?? 0) + (Number(c.total) || 0),
        primeira: [a?.primeira, c.primeira].filter(Boolean).sort()[0] ?? null,
        ultima: [a?.ultima, c.ultima].filter(Boolean).sort().pop() ?? null,
      });
    }
    return m;
  }, [candidatos]);

  type LinhaBase = {
    f: FornecedorCadastro;
    grafias: {
      id: string | null;
      nome: string;
      origem: string | null;
      principal: boolean;
      lancamentos: number;
      total: number;
      periodo: string;
    }[];
    lancamentos: number;
    total: number;
    autoria: string;
  };

  const base = useMemo<LinhaBase[]>(() => {
    const porFornecedor = new Map<string, Grafia[]>();
    for (const g of grafias) {
      porFornecedor.set(g.fornecedor_id, [...(porFornecedor.get(g.fornecedor_id) ?? []), g]);
    }

    const linhas = cadastro
      .filter((f) => (f.apelido ?? "").trim())
      .map((f) => {
        const alias = porFornecedor.get(f.id) ?? [];
        const brutas = [
          { id: null as string | null, nome: f.nome, origem: f.origem, principal: true },
          ...alias.map((a) => ({ id: a.id, nome: a.alias, origem: a.fonte, principal: false })),
        ];
        const comMov = brutas.map((b) => {
          const mov = movimento.get(chaveContraparte(b.nome));
          const de = mesCurto(mov?.primeira ?? null);
          const ate = mesCurto(mov?.ultima ?? null);
          return {
            ...b,
            lancamentos: mov?.lancamentos ?? 0,
            total: mov?.total ?? 0,
            periodo: !de && !ate ? "sem movimento em 12 m" : de === ate ? de : `${de} – ${ate}`,
          };
        });
        const autor = f.apelido_por ? (autores.get(f.apelido_por) ?? "") : "";
        return {
          f,
          grafias: comMov,
          lancamentos: comMov.reduce((t, g) => t + g.lancamentos, 0),
          total: comMov.reduce((t, g) => t + g.total, 0),
          autoria: f.apelido_em
            ? `${autor ? `${autor.split(" ")[0]} · ` : ""}${quando(f.apelido_em)}`
            : "—",
        };
      });

    const q = normalize(buscaBase).trim();
    return linhas
      .filter((l) => {
        if (filtroBase === "revisar" && !l.f.revisar) return false;
        if (filtroBase === "multiplas" && l.grafias.length < 2) return false;
        if (q && !normalize(l.f.apelido ?? "").includes(q)
          && !l.grafias.some((g) => normalize(g.nome).includes(q))) return false;
        return true;
      })
      .sort((a, b) => b.total - a.total);
  }, [cadastro, grafias, movimento, autores, buscaBase, filtroBase]);

  const nomeadas = cadastro.filter((f) => (f.apelido ?? "").trim());
  const nRevisar = nomeadas.filter((f) => f.revisar).length;
  const nMultiplas = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const g of grafias) contagem.set(g.fornecedor_id, (contagem.get(g.fornecedor_id) ?? 0) + 1);
    return nomeadas.filter((f) => (contagem.get(f.id) ?? 0) >= 1).length;
  }, [grafias, nomeadas]);

  const soltar = async (id: string, nome: string) => {
    const { error } = await desfazerGrafia(id);
    if (error) { toast.error(error); return; }
    toast.success(`"${nome}" voltou para a fila.`);
  };

  const revisar = async (f: FornecedorCadastro) => {
    const { error } = await marcarRevisao(f.id, !f.revisar);
    if (error) toast.error(error);
  };

  const abrirCadastro = (f: FornecedorCadastro) => {
    const mov = movimento.get(chaveContraparte(f.nome));
    setAlvo({
      candidato: {
        origem: f.origem ?? "manual", nome: f.nome, documento: f.documento,
        categoria: f.categoria, cidade: null,
        lancamentos: mov?.lancamentos ?? 0, total: mov?.total ?? 0,
        primeira: mov?.primeira ?? null, ultima: mov?.ultima ?? null,
      },
      cadastro: f,
    });
  };

  /* ----------------------------------------------------------------- tela */

  const somaMarcada = marcados.reduce((t, g) => t + somaDo(g).total, 0);
  const lctosMarcados = marcados.reduce((t, g) => t + somaDo(g).lancamentos, 0);

  const tira = [
    { rotulo: "Sem nome", valor: String(fila.length), destaque: true },
    { rotulo: "Grupos na fila", valor: String(grupos.length), destaque: true },
    { rotulo: "Valor 12 m", valor: brlCurtoStr(valorNaFila) },
    { rotulo: "Alta confiança", valor: String(nAlta), classe: "text-emerald-700 dark:text-emerald-400" },
    { rotulo: "Nomeados hoje", valor: String(nomeadosHoje), classe: "text-sky-700 dark:text-sky-400" },
  ];

  return (
    <div className="p-4 md:p-5">
      <div className="grid max-w-[1320px] gap-3">

        {/* ---------------------- título e abas ---------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="text-[15px] font-semibold tracking-tight">Parametrização</h2>
            <span className="text-[12px] text-muted-foreground">
              Nome interno da contraparte. Vale para DRE, DFC, cartão e IA.
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]"
              onClick={sincronizar} disabled={sincronizando}
              title="Relê Compras, Reembolsos, NFs de colaborador e Eventos & Parcerias"
            >
              {sincronizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar das planilhas
            </Button>
            <Segmentado
              alto valor={aba} onEscolher={trocarAba}
              opcoes={[
                { v: "fila", rotulo: "Fila", n: grupos.length },
                { v: "base", rotulo: "Base", n: nomeadas.length },
              ]}
            />
          </div>
        </div>

        {/* ---------------------- a tira de números ----------------------
            Não é placar de progresso: é a resposta a "quanto falta e por onde
            começar". "Sem nome" conta grafias; "Grupos na fila" conta perguntas
            — a distância entre os dois é o que o agrupamento poupou. */}
        <div className="flex flex-wrap items-stretch rounded-md border border-border bg-card">
          {tira.map((m) => (
            <div
              key={m.rotulo}
              className={cn(
                "flex min-w-[118px] flex-col gap-px border-r border-border px-4 py-2",
                m.destaque && "bg-primary/[0.04]",
              )}
            >
              <span className={cn(
                "text-[10px] font-semibold uppercase tracking-wider",
                m.destaque ? "text-primary/80" : "text-muted-foreground",
              )}>
                {m.rotulo}
              </span>
              <span className={cn("num text-[14px] font-medium", m.destaque ? "text-primary" : m.classe)}>
                {m.valor}
              </span>
            </div>
          ))}
          <p className="min-w-[120px] flex-1 px-4 py-2 text-[11.5px] leading-snug text-muted-foreground">
            {nAlta > 0
              ? `${nAlta} ${nAlta === 1 ? "grupo tem" : "grupos têm"} nome de que dá para ir em bloco. O resto precisa de leitura.`
              : "Nenhum grupo com nome pronto — o que sobrou pede leitura, uma linha de cada vez."}
          </p>
        </div>

        {/* ============================== FILA ============================== */}
        {aba === "fila" && (
          <div className="grid gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[236px]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar grafia"
                  className="h-[30px] pl-8 text-[12.5px]"
                />
              </div>
              <Segmentado
                valor={filtro} onEscolher={trocarFiltro}
                opcoes={[
                  { v: "todos", rotulo: "Todos", n: grupos.length },
                  { v: "alta", rotulo: "Alta confiança", n: nAlta },
                  { v: "revisar", rotulo: "Precisa ler", n: grupos.length - nAlta },
                ]}
              />
              <div className="flex-1" />
              <Button
                size="sm" variant="outline" className="h-[30px] gap-1.5 text-[12px]"
                disabled={!visiveis.length}
                onClick={() => setSel(todosMarcados
                  ? new Set()
                  : new Set(visiveis.map((g) => g.id)))}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {todosMarcados ? "Desmarcar" : "Marcar visíveis"}
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <div
                className="grid min-w-[1024px] items-center gap-2 border-b border-border bg-muted/50 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                style={{ gridTemplateColumns: GRADE_FILA, height: 32 }}
              >
                <span />
                <span>Grafias agrupadas</span>
                <span title="Por que estas grafias vieram juntas. Sozinha na fila, diz o que sustenta o nome proposto.">
                  Por que juntou
                </span>
                <span className="text-right">Lctos</span>
                <span className="text-right">Valor 12 m</span>
                <span>Nome interno</span>
                <span />
              </div>

              {candidatos === null ? (
                <Vazio><Loader2 className="mx-auto h-4 w-4 animate-spin" /></Vazio>
              ) : linhasDaFila.length === 0 ? (
                <Vazio>
                  {busca || filtro !== "todos"
                    ? "Nada neste filtro."
                    : "Todas as contrapartes dos últimos 12 meses já têm nome."}
                </Vazio>
              ) : linhasDaFila.map(({ g, apelido }) => {
                const feito = !!apelido;
                const fora = soltas[g.id] ?? [];
                const t = somaDo(g);
                const marcado = sel.has(g.id);
                const aberto = abertos.has(g.id);
                const nome = feito ? apelido : nomeDo(g);
                const temNome = nome.trim().length >= 2;
                const principal = (t.grafias[0] ?? g.grafias[0]).nome;

                return (
                  <div
                    key={g.id}
                    className={cn(
                      "border-b border-border/70 border-l-[3px] last:border-b-0",
                      feito ? "border-l-emerald-500 bg-emerald-500/[0.04]" : CONF[g.conf].faixa,
                      !feito && marcado && "bg-sky-500/[0.05]",
                    )}
                  >
                    <div
                      className="grid min-w-[1024px] items-center gap-2 px-3 py-1.5"
                      style={{ gridTemplateColumns: GRADE_FILA, minHeight: 42 }}
                    >
                      <button
                        type="button"
                        disabled={feito}
                        onClick={() => setSel((s) => alternar(s, g.id))}
                        aria-label={`Marcar ${principal}`}
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded border transition",
                          marcado && !feito
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40 bg-background",
                          feito && "opacity-30",
                        )}
                      >
                        <Check className={cn("h-3 w-3", marcado && !feito ? "opacity-100" : "opacity-0")} />
                      </button>

                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAbertos((s) => alternar(s, g.id))}
                          aria-label={aberto ? "Fechar as grafias" : "Ver as grafias"}
                          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
                        >
                          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-90")} />
                        </button>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            {/* O nome cru é o que se procura no Omie — por isso
                                ele, e não o apelido, é quem lidera a linha aqui. */}
                            <button
                              type="button"
                              onClick={() => setAlvo({ candidato: t.grafias[0] ?? g.grafias[0] })}
                              title="Ver os lançamentos desta contraparte"
                              className={cn(
                                "num truncate text-[12px] font-medium hover:underline",
                                feito && "text-muted-foreground",
                              )}
                            >
                              {principal}
                            </button>
                            {t.grafias.length > 1 && (
                              <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-px text-[11px] font-medium text-sky-700 dark:text-sky-400">
                                +{t.grafias.length - 1} {t.grafias.length === 2 ? "grafia" : "grafias"}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {g.grafias.length} {g.grafias.length === 1 ? "grafia" : "grafias"}
                            {g.ultima ? ` · último ${dataCurta(g.ultima)}` : ""}
                          </div>
                        </div>
                      </div>

                      <div className="flex min-w-0 items-center">
                        <span className={cn(
                          "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-px text-[11px] font-medium",
                          CONF[g.conf].chip,
                        )}>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                          <span className="truncate">{g.motivo}</span>
                        </span>
                      </div>

                      <span className="num text-right text-[12px] text-muted-foreground">{t.lancamentos}</span>
                      <span className="num text-right text-[12.5px] font-medium">{brlCurto(t.total)}</span>

                      {feito ? (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span className="truncate text-[12.5px] font-medium">{apelido}</span>
                          <button
                            type="button"
                            onClick={() => void desfazer(g)}
                            className="ml-auto shrink-0 text-[11.5px] text-muted-foreground underline hover:text-foreground"
                          >
                            desfazer
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={nome}
                            onChange={(e) => setNomes((n) => ({ ...n, [g.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); void confirmar([g]); }
                            }}
                            placeholder={g.conf === "baixa" ? "sem sugestão — escreva" : "nome interno"}
                            className={cn("h-7 px-2 text-[12.5px]", !temNome && "border-amber-400/70")}
                          />
                          <Button
                            size="sm" className="h-7 shrink-0 px-2.5 text-[12px]"
                            disabled={!temNome || gravando}
                            onClick={() => void confirmar([g])}
                          >
                            Confirmar
                          </Button>
                        </div>
                      )}

                      <Button
                        size="sm" variant="ghost" className="ghost-icone ghost-icone-sm"
                        title="Não é fornecedor — tira da fila"
                        disabled={feito || gravando}
                        onClick={() => void descartar(g)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {aberto && (
                      <div className="border-t border-dashed border-border bg-muted/30 px-3 pb-2 pt-0.5">
                        {g.grafias.map((c) => {
                          const chave = chaveGrafia(c);
                          const solta = fora.includes(chave);
                          return (
                            <div
                              key={chave}
                              className="grid min-w-[1000px] items-center gap-2"
                              style={{ gridTemplateColumns: GRADE_FILA, minHeight: 32 }}
                            >
                              <span />
                              <div className="flex min-w-0 items-center gap-2 pl-[26px]">
                                <SeloOrigem origem={c.origem} />
                                <span className={cn(
                                  "num truncate text-[11.5px]",
                                  solta ? "text-muted-foreground line-through" : "text-foreground/80",
                                )}>
                                  {c.nome}
                                </span>
                              </div>
                              <span className="truncate text-[11px] text-muted-foreground">
                                {c.ultima ? `último ${dataCurta(c.ultima)}` : "—"}
                              </span>
                              <span className="num text-right text-[11.5px] text-muted-foreground">{c.lancamentos}</span>
                              <span className="num text-right text-[11.5px] text-muted-foreground">{brlCurto(c.total)}</span>
                              <div>
                                {/* Separar não desfaz nada no banco: tira da conta
                                    e do que vai ser gravado, e deixa a linha
                                    riscada para dar para voltar atrás. */}
                                <button
                                  type="button"
                                  disabled={feito}
                                  onClick={() => setSoltas((s) => ({
                                    ...s,
                                    [g.id]: solta ? fora.filter((x) => x !== chave) : [...fora, chave],
                                  }))}
                                  className="text-[11.5px] text-muted-foreground underline transition hover:text-foreground disabled:no-underline disabled:opacity-40"
                                >
                                  {solta ? "voltar ao grupo" : "separar"}
                                </button>
                              </div>
                              <span />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================== BASE ============================== */}
        {aba === "base" && (
          <div className="grid gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[236px]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={buscaBase} onChange={(e) => setBuscaBase(e.target.value)}
                  placeholder="Filtrar nome ou grafia"
                  className="h-[30px] pl-8 text-[12.5px]"
                />
              </div>
              <Segmentado<typeof filtroBase>
                valor={filtroBase} onEscolher={setFiltroBase}
                opcoes={[
                  { v: "todas", rotulo: "Todas", n: nomeadas.length },
                  { v: "multiplas", rotulo: "Com 2+ grafias", n: nMultiplas },
                  { v: "revisar", rotulo: "Em revisão", n: nRevisar },
                ]}
              />
            </div>

            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <div
                className="grid min-w-[940px] items-center gap-2 border-b border-border bg-muted/50 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                style={{ gridTemplateColumns: GRADE_BASE, height: 32 }}
              >
                <span>Nome interno</span>
                <span>O que é</span>
                <span className="text-right">Grafias</span>
                <span className="text-right">Lctos</span>
                <span className="text-right">Valor 12 m</span>
                <span>Quem nomeou</span>
                <span />
              </div>

              {base.length === 0 ? (
                <Vazio>
                  {buscaBase || filtroBase !== "todas"
                    ? "Nada neste filtro."
                    : "Nenhuma contraparte nomeada ainda — comece pela fila."}
                </Vazio>
              ) : base.map((l) => {
                const aberto = abertosBase.has(l.f.id);
                return (
                  <div
                    key={l.f.id}
                    className={cn(
                      "border-b border-border/70 border-l-[3px] last:border-b-0",
                      l.f.revisar ? "border-l-amber-400 bg-amber-500/[0.04]" : "border-l-sky-500/30",
                    )}
                  >
                    <div
                      className="grid min-w-[940px] items-center gap-2 px-3 py-1.5"
                      style={{ gridTemplateColumns: GRADE_BASE, minHeight: 40 }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAbertosBase((s) => alternar(s, l.f.id))}
                          aria-label={aberto ? "Fechar as grafias" : "Ver as grafias"}
                          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
                        >
                          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-90")} />
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirCadastro(l.f)}
                          title="Abrir para editar o nome, o que é e o dono"
                          className="truncate text-[12.5px] font-medium hover:underline"
                        >
                          {l.f.apelido}
                        </button>
                        {l.f.revisar && <Flag className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />}
                      </div>
                      <span className="truncate text-[12px] text-muted-foreground">{l.f.o_que_e ?? "—"}</span>
                      <span className="num text-right text-[12px] text-muted-foreground">{l.grafias.length}</span>
                      <span className="num text-right text-[12px] text-muted-foreground">{l.lancamentos}</span>
                      <span className="num text-right text-[12.5px] font-medium">
                        {l.total > 0 ? brlCurto(l.total) : <span className="text-muted-foreground">—</span>}
                      </span>
                      <span className="truncate text-[11.5px] text-muted-foreground">{l.autoria}</span>
                      <Button
                        size="sm" variant="ghost" className="ghost-icone ghost-icone-sm"
                        title={l.f.revisar ? "Tirar da revisão" : "Marcar para revisão"}
                        onClick={() => void revisar(l.f)}
                      >
                        <Flag className={cn(
                          "h-3.5 w-3.5",
                          l.f.revisar ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/60",
                        )} />
                      </Button>
                    </div>

                    {aberto && (
                      <div className="border-t border-dashed border-border bg-muted/30 px-3 pb-2 pt-0.5">
                        {l.grafias.map((g) => (
                          <div
                            key={g.id ?? "principal"}
                            className="grid min-w-[916px] items-center gap-2"
                            style={{ gridTemplateColumns: GRADE_BASE, minHeight: 30 }}
                          >
                            <div className="flex min-w-0 items-center gap-2 pl-[26px]">
                              <SeloOrigem origem={g.origem} />
                              <span className="num truncate text-[11.5px] text-foreground/80">{g.nome}</span>
                            </div>
                            <span className="truncate text-[11px] text-muted-foreground">{g.periodo}</span>
                            <span />
                            <span className="num text-right text-[11.5px] text-muted-foreground">{g.lancamentos}</span>
                            <span className="num text-right text-[11.5px] text-muted-foreground">{brlCurto(g.total)}</span>
                            <div>
                              {/* A principal é o nome canônico do cadastro: soltá-la
                                  não devolveria a grafia para a fila, apagaria o
                                  cadastro. Para desfazer o nome, o caminho é o
                                  painel — "Tirar o apelido". */}
                              {g.principal ? (
                                <span className="text-[11px] text-muted-foreground/70">principal</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void soltar(g.id!, g.nome)}
                                  className="text-[11.5px] text-muted-foreground underline transition hover:text-foreground"
                                >
                                  soltar
                                </button>
                              )}
                            </div>
                            <span />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ---------------- a barra da seleção ----------------
          Presa ao rodapé enquanto a fila rola: são centenas de linhas, e a barra
          tem de continuar ao alcance depois de meia lista. */}
      {aba === "fila" && marcados.length > 0 && (
        <div className="sticky bottom-0 z-40 -mx-4 mt-3 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-2.5 shadow-[0_-2px_8px_hsl(var(--foreground)/0.05)] backdrop-blur md:-mx-5 md:px-5">
          <span className="text-[12.5px] font-medium">
            {marcados.length} {marcados.length === 1 ? "grupo marcado" : "grupos marcados"}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {lctosMarcados} lançamentos · {brlCurtoStr(somaMarcada)}
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="h-[30px] text-[12.5px]" onClick={() => setSel(new Set())}>
            Limpar
          </Button>
          <Button
            size="sm" className="h-[30px] gap-1.5 text-[12.5px]"
            disabled={gravando}
            onClick={() => void confirmar(marcados)}
          >
            {gravando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirmar {marcados.length}
          </Button>
        </div>
      )}

      <PainelNomear
        alvo={alvo}
        cadastro={cadastro}
        onFechar={() => setAlvo(null)}
        onGravado={() => { void recarregar(); }}
      />
    </div>
  );
}
