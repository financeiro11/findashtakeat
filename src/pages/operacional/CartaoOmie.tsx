/**
 * Cartão → Omie: separar a fatura e conferir, antes de qualquer lançamento.
 *
 * O TRABALHO QUE ESTA TELA TIRA DA MÃO
 * Quando a fatura do cartão chega, a analista precisa decidir linha a linha o
 * que vai para o Omie. Na fatura de julho/26 são 647 linhas e três destinos
 * diferentes: 162 são parcelas de 2 em diante, já provisionadas meses atrás
 * (lançar de novo duplica); 426 são compras à vista, que entram inteiras neste
 * mês; 45 são primeiras parcelas, que têm de virar 45 séries de títulos com a
 * competência de cada mês à frente. O parser separa os três sozinho, pelo
 * marcador `NN/MM` que o Sicoob mantém no extrato.
 *
 * O ENVIO (desde 24/08/2026)
 * Conferida a prévia, o botão manda a fatura para o Omie — um título por
 * lançamento, fornecedor genérico do cartão, o MEMO cru na observação. Quem
 * escreve é a Edge Function `cartao-omie-enviar`; esta tela só monta a lista e
 * repete a chamada até a fila zerar (uma fatura real tem ~470 títulos e não cabe
 * numa invocação).
 *
 * O que impede um envio em dobro não está aqui: está no marco do banco, no
 * registro de `cartao_envios_omie` e no `codigo_lancamento_integracao` que o
 * próprio Omie recusa repetido. A tela desabilita o botão pela MESMA função que
 * o servidor usa para recusar (`recusaDoEnvio`) — não por uma regra própria.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ChevronRight, CreditCard, FileUp, Loader2, Lock,
  RefreshCw, Send, Sparkles, Upload, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useCategoriasOmie, type CategoriaOmie } from "@/components/demonstracoes/TrocarCategoria";
import { chaveDe, lerMemo, parseOfx, rotuloMes, type FaturaOfx } from "@/lib/cartao/ofx";
import {
  agrupar, expandir, separar, type Balde, type Grupo, type Separacao,
} from "@/lib/cartao/provisionar";
import {
  aprender, casar, cobertura, sugerir, type LinhaHistorico, type Mapa, type Sugestao, type TituloOmie,
} from "@/lib/cartao/depara";
import {
  bloqueioDeEnvio, ehTeste, recusaDoEnvio, titulosDaFatura, type EstadoDaFatura,
} from "@/lib/cartao/envio";
import {
  auditar, pendencias, type Auditoria, type LinhaAuditada, type Veredito,
} from "@/lib/cartao/auditoria";
import { fmtBRLStr, intStr } from "@/pages/cartao/fmt";
import { fmtBRL } from "@/pages/cartao/valores";
import { useApelidos } from "@/hooks/useApelidos";
import { apelidoDe } from "@/lib/apelidos";

/* As tabelas do cartão são novas e ainda não estão no types.ts gerado (que não
   se edita à mão). O cast fica confinado aqui. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* ------------------------------------------------------------------ */

type Escolha = { codigo: string; descricao: string | null };

/** O que a Edge Function devolve a cada lote. */
type Resultado = {
  status: string;
  erro?: string;
  total?: number;
  ja_estavam?: number;
  criados?: number;
  recuperados?: number;
  restantes?: number;
  fatura_fechada?: boolean;
  falhas?: { integracao: string; estabelecimento: string; erro: string }[];
};

type Envio = {
  integracao: string;
  cod_titulo: string | null;
  estabelecimento: string | null;
  valor: number;
  vencimento: string | null;
  status: string;
  erro: string | null;
};

const BALDES: { id: Balde; rotulo: string; nota: string }[] = [
  { id: "avista", rotulo: "À vista", nota: "entram inteiras neste mês" },
  { id: "primeira", rotulo: "1ª parcela", nota: "geram a série de títulos" },
  { id: "ignorar", rotulo: "Ignoradas", nota: "já provisionadas antes" },
  { id: "nao-financeiro", rotulo: "Não é despesa", nota: "pagamento e estornos" },
];

/** Onde a fatura em conferência espera o próximo F5. */
const FATURA_GUARDADA = "cartao-omie:fatura";

export default function CartaoOmie() {
  const [fatura, setFatura] = useState<FaturaOfx | null>(null);
  const [arquivo, setArquivo] = useState<string>("");
  /** O OFX cru, para regravar o rascunho quando as datas mudarem. */
  const [textoOfx, setTextoOfx] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [aba, setAba] = useState<Balde | "auditoria">("avista");
  const [mapa, setMapa] = useState<Mapa>(new Map());
  const [escolhas, setEscolhas] = useState<Map<string, Escolha>>(new Map());
  const [aprendendo, setAprendendo] = useState(false);
  const [estadoDaFatura, setEstadoDaFatura] = useState<EstadoDaFatura>(null);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  const { categorias } = useCategoriasOmie(true);

  /* ---- de-para já gravado ---------------------------------------- */

  const carregarMapa = useCallback(async () => {
    const { data, error } = await db.from("cartao_omie_map").select("*");
    if (error) { toast.error("Não consegui ler o de-para: " + error.message); return; }
    const m: Mapa = new Map();
    for (const r of data ?? []) {
      m.set(r.chave, {
        chave: r.chave,
        codigoCategoria: r.codigo_categoria,
        descricaoCategoria: r.descricao_categoria,
        origem: r.origem,
        votos: r.votos ?? 0,
        examinados: r.examinados ?? 0,
        exemplos: r.exemplos ?? [],
      });
    }
    setMapa(m);
  }, []);

  useEffect(() => { carregarMapa(); }, [carregarMapa]);

  /* ---- o que desta fatura já subiu ao Omie ------------------------
     A pergunta é por `competencia_fatura`, nunca por `competencia`: esta última
     é o mês em que cada PARCELA cai, e as parcelas 2..N caem à frente. Filtrar
     por ela esconderia os títulos já criados e a tela ofereceria reenviá-los. */

  const carregarEnvios = useCallback(async (competenciaAlvo: string) => {
    if (!competenciaAlvo) { setEnvios([]); return; }
    const { data, error } = await db
      .from("cartao_envios_omie")
      .select("integracao, cod_titulo, estabelecimento, valor, vencimento, status, erro")
      .eq("competencia_fatura", competenciaAlvo);
    if (error) { toast.error("Não consegui ler os envios já feitos: " + error.message); return; }
    setEnvios((data ?? []).map((e: Envio) => ({ ...e, valor: Number(e.valor) })));
  }, []);

  /* ---- importar o arquivo ---------------------------------------- */

  /**
   * Põe uma fatura na tela — venha ela do arraste ou do que ficou guardado.
   *
   * `salvo` traz a competência e o vencimento que a pessoa já tinha ajustado.
   * Sem ele são o palpite inicial: o mês seguinte ao fechamento e o dia 10. O
   * OFX não traz vencimento (o `LEDGERBAL` é saldo devedor acumulado, não o
   * total do ciclo), então o campo nasce editável e em destaque.
   */
  const aplicar = useCallback(async (
    nome: string,
    texto: string,
    salvo?: { competencia: string; vencimento: string },
  ) => {
    const f = parseOfx(texto);
    setFatura(f);
    setArquivo(nome);
    setTextoOfx(texto);
    setEscolhas(new Map());

    const comp = salvo?.competencia || f.competencia;
    setCompetencia(comp);
    setVencimento(salvo?.vencimento || (f.competencia ? `${f.competencia.slice(0, 8)}10` : ""));

    const { data } = await db
      .from("cartao_faturas").select("competencia, provisionamento")
      .eq("competencia", comp).maybeSingle();
    setEstadoDaFatura((data?.provisionamento ?? null) as EstadoDaFatura);
    setResultado(null);
    await carregarEnvios(comp);
    return f;
  }, [carregarEnvios]);

  const abrirArquivo = useCallback(async (file: File) => {
    // windows-1252, e não UTF-8: o OFX declara CHARSET:1252 e traz acento em
    // nome de lojista. Ler como UTF-8 devolve caractere quebrado no meio de uma
    // coluna que é posicional.
    const texto = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
    if (!/<STMTTRN>/i.test(texto)) {
      toast.error("Não parece um OFX de fatura — não encontrei lançamentos no arquivo.");
      return;
    }

    const f = await aplicar(file.name, texto);
    if (!f.competenciaConfiavel) {
      toast.warning("O fechamento deste arquivo não é fim de mês — confira a competência.");
    }
  }, [aplicar]);

  /* ---- a fatura sobrevive ao F5 -----------------------------------
     Conferir uma fatura leva meia hora e ninguém a termina de uma sentada. A
     categoria escolhida sempre foi para o banco (`cartao_omie_map_gravar`), mas
     o ARQUIVO só existia na memória do React: um F5 devolvia a tela de arraste e
     mandava procurar o .ofx de novo.

     Fica no localStorage, e não no banco, porque é um rascunho de conferência —
     de quem está mexendo, naquela máquina. O que vira registro da empresa (o
     de-para e os envios) continua no Postgres. */

  useEffect(() => {
    const cru = localStorage.getItem(FATURA_GUARDADA);
    if (!cru) return;
    try {
      const g = JSON.parse(cru) as { nome: string; texto: string; competencia: string; vencimento: string };
      if (g?.texto) aplicar(g.nome, g.texto, { competencia: g.competencia, vencimento: g.vencimento });
    } catch {
      localStorage.removeItem(FATURA_GUARDADA);
    }
  }, [aplicar]);

  useEffect(() => {
    if (!textoOfx || !arquivo) return;
    try {
      localStorage.setItem(
        FATURA_GUARDADA,
        JSON.stringify({ nome: arquivo, texto: textoOfx, competencia, vencimento }),
      );
    } catch {
      // Cota estourada (uma fatura real tem ~650 linhas, mas o limite é do
      // navegador). Perder o rascunho é chato; travar a tela seria pior.
    }
  }, [textoOfx, arquivo, competencia, vencimento]);

  /* Trocar de aba muda o que está abaixo da dobra; sem isto o clique parece não
     ter efeito. Só rola quando a aba muda de verdade, não a cada render. */
  useEffect(() => {
    if (aba === "auditoria") {
      painelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [aba]);

  const descartar = useCallback(() => {
    localStorage.removeItem(FATURA_GUARDADA);
    setFatura(null); setArquivo(""); setTextoOfx("");
    setCompetencia(""); setVencimento("");
    setEnvios([]); setEstadoDaFatura(null); setResultado(null);
  }, []);

  /* ---- aprender o de-para do histórico ---------------------------- */

  /**
   * Lê o que a empresa já classificou e transforma em de-para.
   *
   * Tudo vem do banco: os lançamentos das faturas já importadas e os títulos do
   * `omie_cache`. NENHUMA chamada ao Omie — dá para rodar em pleno fechamento.
   */
  const aprenderDoHistorico = useCallback(async () => {
    setAprendendo(true);
    try {
      // O client corta em 1000 linhas por consulta e são ~3.400 lançamentos.
      // Desempate por `id` obrigatório: `data` sozinha empata às dezenas (uma
      // fatura fecha tudo no mesmo dia) e, sem ordem total, a fronteira entre
      // duas páginas repete uma linha e engole outra — o de-para aprenderia com
      // um histórico furado.
      const lancamentos: LinhaHistorico[] = [];
      for (let pagina = 0; ; pagina++) {
        const { data, error } = await db
          .from("cartao_lancamentos")
          .select("data, estabelecimento, descricao, valor, tipo")
          .eq("tipo", "gasto")
          .order("data").order("id")
          .range(pagina * 1000, pagina * 1000 + 999);
        if (error) throw new Error(error.message);
        const linhas = data ?? [];
        for (const l of linhas) {
          if (!l.data) continue;
          // A chave sai do MEMO original quando ele existe: é ele que carrega as
          // variantes que `chaveDe` sabe fundir.
          const nome = l.descricao ? lerMemo(l.descricao).estabelecimento : l.estabelecimento;
          lancamentos.push({
            chave: chaveDe(nome),
            estabelecimento: nome,
            data: l.data,
            valor: Number(l.valor),
          });
        }
        if (linhas.length < 1000) break;
      }

      if (!lancamentos.length) {
        toast.error("Não há faturas importadas para aprender. Importe o histórico na tela de Cartão.");
        return;
      }

      const datas = lancamentos.map((l) => l.data).sort();
      const { data: brutos, error } = await db.rpc("cartao_omie_titulos", {
        p_de: recuar(datas[0], 60),
        p_ate: recuar(datas[datas.length - 1], -120),
      });
      if (error) throw new Error(error.message);

      const titulos: TituloOmie[] = (brutos ?? [])
        .filter((t: { data: string | null }) => t.data)
        .map((t: Record<string, unknown>) => ({
          codTitulo: String(t.cod_titulo),
          data: String(t.data),
          valor: Number(t.valor),
          codigoCategoria: (t.codigo_categoria as string) ?? null,
          descricaoCategoria: (t.descricao_categoria as string) ?? null,
        }));

      const aprendido = aprender(casar(lancamentos, titulos));
      if (!aprendido.size) {
        toast.error("Nenhum lançamento casou com título do Omie. O cache do Omie está atualizado?");
        return;
      }

      const { error: erroGravar } = await db.rpc("cartao_omie_map_gravar", {
        p_itens: [...aprendido.values()].map((e) => ({
          chave: e.chave,
          codigo_categoria: e.codigoCategoria,
          descricao_categoria: e.descricaoCategoria,
          origem: "historico",
          votos: e.votos,
          examinados: e.examinados,
          exemplos: e.exemplos,
        })),
      });
      if (erroGravar) throw new Error(erroGravar.message);

      await carregarMapa();
      toast.success(
        `${aprendido.size} lojistas aprendidos de ${intStr(lancamentos.length)} lançamentos já classificados no Omie.`,
      );
    } catch (e) {
      toast.error("Não consegui aprender do histórico: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAprendendo(false);
    }
  }, [carregarMapa]);

  /* ---- escolher categoria de um lojista --------------------------- */

  const definir = useCallback(async (chave: string, c: CategoriaOmie) => {
    setEscolhas((m) => new Map(m).set(chave, { codigo: c.codigo, descricao: c.descricao }));
    const { error } = await db.rpc("cartao_omie_map_gravar", {
      p_itens: [{
        chave, codigo_categoria: c.codigo, descricao_categoria: c.descricao, origem: "manual",
      }],
    });
    if (error) { toast.error("Não consegui salvar a escolha: " + error.message); return; }
    carregarMapa();
  }, [carregarMapa]);

  /* ---- o que a tela mostra ---------------------------------------- */

  const separacao: Separacao | null = useMemo(
    () => (fatura ? separar(fatura.linhas) : null),
    [fatura],
  );

  const grupos = useMemo(
    () => (separacao && aba !== "auditoria" ? agrupar(separacao.porBalde[aba]) : []),
    [separacao, aba],
  );

  const escolhaDe = useCallback((chave: string): (Sugestao & { manual: boolean }) | null => {
    const local = escolhas.get(chave);
    if (local) {
      return {
        codigoCategoria: local.codigo, descricaoCategoria: local.descricao,
        origem: "manual", confianca: "alta", manual: true,
      };
    }
    const s = sugerir(mapa, chave);
    return s ? { ...s, manual: false } : null;
  }, [escolhas, mapa]);

  const provisoes = useMemo(
    () => (separacao && competencia && vencimento
      ? expandir(separacao.linhas, competencia, vencimento)
      : []),
    [separacao, competencia, vencimento],
  );

  const cob = useMemo(() => {
    if (!separacao) return { total: 0, cobertas: 0, faltando: [] as string[] };
    const chaves = [...separacao.porBalde.avista, ...separacao.porBalde.primeira].map((l) => l.chave);
    const comEscolha = new Map(mapa);
    for (const [k, v] of escolhas) {
      comEscolha.set(k, {
        chave: k, codigoCategoria: v.codigo, descricaoCategoria: v.descricao,
        origem: "manual", votos: 0, examinados: 0, exemplos: [],
      });
    }
    return cobertura(comEscolha, chaves);
  }, [separacao, mapa, escolhas]);

  /* ---- envio ao Omie ---------------------------------------------- */

  // Trocar a competência à mão troca a fatura de que estamos falando: o que já
  // subiu naquele mês tem de vir junto, senão a tela ofereceria reenviar.
  useEffect(() => { carregarEnvios(competencia); }, [competencia, carregarEnvios]);

  const titulos = useMemo(
    () => titulosDaFatura(provisoes, (chave) => {
      const e = escolhaDe(chave);
      return e ? { codigo: e.codigoCategoria, descricao: e.descricaoCategoria } : null;
    }),
    [provisoes, escolhaDe],
  );

  /**
   * Em que mês da DRE esta fatura cai — que NÃO é o mês da fatura.
   *
   * O Omie ancora a competência em `data_entrada`, e `data_entrada` é a data da
   * COMPRA (ver `montarTitulo`). A fatura que fecha em 30/11 e vence em 11/12 é
   * "fatura de dez/26" para quem paga, mas a despesa dela é de novembro — e uma
   * compra em 4× reconhece o valor cheio em novembro, com só o vencimento
   * andando. A tela dizia apenas o mês da fatura, e quem lia concluía, com toda
   * a razão pelo que estava escrito, que a DRE receberia dezembro.
   *
   * O ciclo pode atravessar dois meses (compra em 31/10 numa fatura que fecha em
   * 30/11), então isto é uma lista, não um mês só.
   */
  const mesesDaDre = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of titulos) {
      const mes = `${t.dataCompra.slice(0, 7)}-01`;
      m.set(mes, (m.get(mes) ?? 0) + t.valor);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [titulos]);

  const jaSubiram = useMemo(
    () => new Set(envios.filter((e) => e.status === "enviado").map((e) => e.integracao)),
    [envios],
  );
  const aEnviar = useMemo(() => titulos.filter((t) => !jaSubiram.has(t.integracao)), [titulos, jaSubiram]);

  /* A conferência. Roda sobre os MESMOS dados que a tela já mostra — não
     reconsulta nada — porque auditar com uma segunda fonte só provaria que as
     duas fontes concordam, e não que a separação está certa. */
  const auditoria: Auditoria | null = useMemo(
    () => (separacao
      ? auditar({
        separacao,
        provisoes,
        envios: envios.map((e) => ({
          integracao: e.integracao,
          codTitulo: e.cod_titulo,
          estabelecimento: e.estabelecimento,
          valor: Number(e.valor),
          vencimento: e.vencimento,
          status: e.status,
          erro: e.erro,
        })),
        categoriaDe: (chave) => escolhaDe(chave)?.codigoCategoria ?? null,
      })
      : null),
    [separacao, provisoes, envios, escolhaDe],
  );

  /* A MESMA função que a Edge Function usa para recusar. Escrever a regra duas
     vezes é como não a ter: a cópia permissiva é a que duplica o mês. */
  const recusa = useMemo(
    () => recusaDoEnvio({ competencia, estadoDaFatura, titulos }),
    [competencia, estadoDaFatura, titulos],
  );

  const faturaDeTeste = titulos.length > 0 && titulos.every((t) => ehTeste(t.fitid));

  /**
   * Manda a fatura. Repete até a fila zerar: o Omie serializa as chamadas do
   * mesmo método e uma fatura real tem ~470 títulos, então a função devolve
   * `restantes` em vez de estourar o tempo da invocação.
   */
  const enviar = useCallback(async () => {
    if (recusa) { toast.error(recusa); return; }
    setResultado(null);

    const acumulado: Resultado = { status: "ok", criados: 0, ja_estavam: 0, recuperados: 0, falhas: [] };
    try {
      for (let volta = 1; ; volta++) {
        setEnviando(volta === 1 ? "Enviando…" : `Enviando… (lote ${volta})`);
        const { data, error } = await supabase.functions.invoke("cartao-omie-enviar", {
          body: { action: "enviar", competencia, titulos: aEnviar },
        });
        if (error) throw new Error(error.message);
        const r = data as Resultado;
        if (r.status === "erro") { setResultado(r); toast.error(r.erro ?? "Envio recusado."); return; }

        acumulado.criados = (acumulado.criados ?? 0) + (r.criados ?? 0);
        acumulado.recuperados = (acumulado.recuperados ?? 0) + (r.recuperados ?? 0);
        acumulado.ja_estavam = r.ja_estavam ?? 0;
        acumulado.falhas = [...(acumulado.falhas ?? []), ...(r.falhas ?? [])];
        acumulado.total = r.total;
        acumulado.restantes = r.restantes;
        acumulado.fatura_fechada = r.fatura_fechada;

        // Sem progresso e ainda com fila é o único jeito de isto virar laço
        // infinito — para em vez de martelar o Omie.
        if (!r.restantes) break;
        if (!r.criados && !r.falhas?.length) {
          acumulado.status = "parcial";
          toast.error("O envio parou sem conseguir criar nenhum título neste lote.");
          break;
        }
      }

      acumulado.status = acumulado.falhas?.length ? "parcial" : "ok";
      setResultado(acumulado);
      if (acumulado.falhas?.length) {
        toast.error(`${acumulado.criados} título(s) criado(s), ${acumulado.falhas.length} com erro.`);
      } else {
        toast.success(`${acumulado.criados} título(s) criado(s) no Omie.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResultado({ status: "erro", erro: msg });
      toast.error("Não consegui enviar: " + msg);
    } finally {
      setEnviando(null);
      await carregarEnvios(competencia);
      const { data } = await db
        .from("cartao_faturas").select("provisionamento").eq("competencia", competencia).maybeSingle();
      setEstadoDaFatura((data?.provisionamento ?? null) as EstadoDaFatura);
    }
  }, [recusa, competencia, aEnviar, carregarEnvios]);

  /** Apaga do Omie o que a fatura sintética criou. Só ela — ver a função. */
  const limparTeste = useCallback(async () => {
    setEnviando("Limpando…");
    try {
      const { data, error } = await supabase.functions.invoke("cartao-omie-enviar", {
        body: { action: "limpar-teste" },
      });
      if (error) throw new Error(error.message);
      const r = data as { status: string; erro?: string; apagados?: number; problemas?: unknown[] };
      if (r.status === "erro") { toast.error(r.erro ?? "Não consegui limpar."); return; }
      toast.success(`${r.apagados ?? 0} título(s) de teste excluído(s) do Omie.`);
      setResultado(null);
    } catch (e) {
      toast.error("Não consegui limpar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(null);
      await carregarEnvios(competencia);
    }
  }, [competencia, carregarEnvios]);

  /* ---------------------------------------------------------------- */

  if (!fatura || !separacao) {
    return (
      <SemFatura
        onArquivo={abrirArquivo}
        inputRef={inputRef}
        aprendidos={mapa.size}
        aprendendo={aprendendo}
        onAprender={aprenderDoHistorico}
      />
    );
  }

  return (
    <div className="space-y-5 p-5">
      {/* ---- cabeçalho ---- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Hub Financeiro · Operacional</div>
          <h1 className="mt-0.5 text-3xl font-bold tracking-tight">Cartão → Omie</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {arquivo} · fechamento {fatura.fechamento ?? "—"} · {intStr(fatura.linhas.length)} lançamentos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={aprenderDoHistorico} disabled={aprendendo}>
            {aprendendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Aprender do histórico
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => inputRef.current?.click()}>
            <RefreshCw className="h-4 w-4" /> Trocar arquivo
          </Button>
          <Button variant="ghost" size="sm" className="h-9" onClick={descartar}>
            <XCircle className="h-4 w-4" /> Descartar
          </Button>
          <input
            ref={inputRef} type="file" accept=".ofx,.OFX" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) abrirArquivo(f); e.target.value = ""; }}
          />
        </div>
      </div>

      <AvisoEnvioDesligado />

      {/* ---- competência e vencimento ---- */}
      <div className="card-surface flex flex-wrap items-end gap-5 p-4">
        <Campo
          rotulo="Fatura de (mês do pagamento)"
          alerta={!fatura.competenciaConfiavel}
          dica={
            fatura.competenciaConfiavel
              ? `Fechou em ${fatura.fechamento} → paga-se em ${rotuloMes(competencia || fatura.competencia)}. `
                + "Projeta o vencimento das parcelas; não é a competência contábil."
              : "O fechamento deste arquivo não é fim de mês, então o mês é palpite. Confira."
          }
        >
          <Input
            type="month" className="h-9 w-[150px]"
            value={competencia.slice(0, 7)}
            onChange={(e) => setCompetencia(e.target.value ? `${e.target.value}-01` : "")}
          />
        </Campo>

        <Campo
          rotulo="Vencimento da fatura"
          alerta={!vencimento}
          dica="O OFX não traz o vencimento — ele vem do PDF ou daqui. As parcelas seguintes herdam o dia."
        >
          <Input
            type="date" className="h-9 w-[160px]"
            value={vencimento} onChange={(e) => setVencimento(e.target.value)}
          />
        </Campo>

        {/* A pergunta que a tela precisa responder sem que ninguém deduza: em que
            mês a despesa entra na DRE. Não é o mês da fatura — é o da compra. */}
        <div className="ml-auto flex flex-wrap items-end gap-x-8 gap-y-3 text-right">
          <div>
            <div className="eyebrow">Despesa na DRE</div>
            <div className="text-[16px] font-bold leading-tight">
              {mesesDaDre.length === 0
                ? "—"
                : mesesDaDre.length === 1
                  ? rotuloMes(mesesDaDre[0][0])
                  : `${mesesDaDre.length} meses`}
            </div>
            <div className="max-w-[260px] text-[11.5px] leading-snug text-muted-foreground">
              {mesesDaDre.length > 1
                ? mesesDaDre.map(([m, v]) => `${rotuloMes(m)} ${fmtBRLStr(v)}`).join(" · ")
                : "pela data da compra — parcelada entra inteira aqui"}
            </div>
          </div>
          <div>
            <div className="eyebrow">Títulos que serão criados</div>
            <div className="num text-[22px] font-bold leading-tight">{intStr(provisoes.length)}</div>
            <div className="text-[11.5px] text-muted-foreground">
              {intStr(separacao.porBalde.avista.length + separacao.porBalde.primeira.length)} linhas da fatura
            </div>
          </div>
        </div>
      </div>

      {/* ---- os quatro baldes ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BALDES.map((b) => (
          <button
            key={b.id}
            onClick={() => setAba(b.id)}
            className={cn(
              "card-surface p-4 text-left transition",
              aba === b.id ? "ring-2 ring-primary" : "hover:border-primary/40",
            )}
          >
            <div className="eyebrow">{b.rotulo}</div>
            <div className="num mt-1 text-[24px] font-bold leading-none">
              {fmtBRL(separacao.totais[b.id])}
            </div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              {intStr(separacao.porBalde[b.id].length)} linhas · {b.nota}
            </div>
          </button>
        ))}

        {/* A 5ª aba não é um balde: é a pergunta "sobrou alguma coisa?". Fica na
            mesma fileira porque o número dela só vale ao lado dos outros. */}
        {auditoria && (
          <button
            onClick={() => setAba("auditoria")}
            className={cn(
              "card-surface p-4 text-left transition",
              aba === "auditoria" ? "ring-2 ring-primary" : "hover:border-primary/40",
              !auditoria.fecha && aba !== "auditoria" && "border-destructive/50",
            )}
          >
            <div className="eyebrow">Auditoria</div>
            <div
              className={cn(
                "mt-1 text-[19px] font-bold leading-none",
                auditoria.fecha ? "text-emerald-600" : "text-destructive",
              )}
            >
              {auditoria.fecha ? "A conta fecha" : "Não fecha"}
            </div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              {pendencias(auditoria) === 0
                ? "nenhuma pendência · clique para ver"
                : `${intStr(pendencias(auditoria))} pendência(s) · clique para ver`}
            </div>
          </button>
        )}
      </div>

      {/* ---- a conta que tem de fechar ---- */}
      <div className="card-surface flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 text-[12.5px]">
        <Conta rotulo="Gastos da fatura" valor={separacao.totalFatura} forte />
        <span className="text-muted-foreground">−</span>
        <Conta rotulo="Já provisionado antes" valor={separacao.totais.ignorar} />
        <span className="text-muted-foreground">=</span>
        <Conta rotulo="A provisionar agora" valor={separacao.totalAProvisionar} forte />
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          A diferença é exatamente o que se duplicaria lançando a fatura inteira.
        </span>
      </div>

      {/* ---- cobertura do de-para ---- */}
      {(aba === "avista" || aba === "primeira") && (
        <Cobertura cob={cob} aprendidos={mapa.size} />
      )}

      {/* ---- o envio ---- */}
      <PainelEnvio
        total={titulos.length}
        aEnviar={aEnviar.length}
        valor={aEnviar.reduce((a, t) => a + t.valor, 0)}
        envios={envios}
        orfaos={auditoria?.orfaos.length ?? 0}
        recusa={recusa}
        enviando={enviando}
        resultado={resultado}
        faturaDeTeste={faturaDeTeste}
        onEnviar={enviar}
        onLimparTeste={limparTeste}
      />

      {/* ---- a tabela, ou a conferência ----
           O conteúdo troca abaixo da dobra, então o card de cima parecia não
           fazer nada: quem clicava em "Auditoria" via a mesma tela e concluía
           que a aba não existia. A rolagem leva os olhos até onde a resposta
           apareceu. */}
      <div ref={painelRef} className="scroll-mt-4">
        {aba === "auditoria" ? (
          auditoria && <PainelAuditoria auditoria={auditoria} />
        ) : (
          <div className="card-surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <span className="text-[13px] font-bold">
                {BALDES.find((b) => b.id === aba)?.rotulo} · {intStr(grupos.length)} lojistas
              </span>
              <span className="text-[11px] text-muted-foreground">
                {aba === "ignorar"
                  ? "Nada aqui vai para o Omie — a lista existe para conferir a exclusão."
                  : aba === "nao-financeiro"
                    ? "Pagamento da fatura e estornos não viram título."
                    : "A categoria é por lojista; no Omie cada compra vira um título seu."}
              </span>
            </div>
            <TabelaGrupos
              grupos={grupos}
              balde={aba}
              categorias={categorias}
              escolhaDe={escolhaDe}
              onDefinir={definir}
            />
          </div>
        )}
      </div>

      <p className="px-1 text-[11.5px] text-muted-foreground">
        Cada linha da fatura vira um título próprio no Omie, no fornecedor "Lancamento Fatura Cartao" e com o texto
        da fatura na observação — é dele que a DRE tira o lojista. A despesa é reconhecida na data da COMPRA, então
        uma compra parcelada entra inteira no mês em que foi feita e só o vencimento anda mês a mês.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Peças
 * ------------------------------------------------------------------ */

/** Desloca uma data ISO em dias, sem passar pelo fuso local. */
function recuar(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

function Campo({
  rotulo, dica, alerta, children,
}: { rotulo: string; dica: string; alerta?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className={cn("eyebrow mb-1", alerta && "text-destructive")}>{rotulo}</div>
      {children}
      <div className={cn("mt-1 max-w-[280px] text-[11px] leading-snug", alerta ? "text-destructive" : "text-muted-foreground")}>
        {dica}
      </div>
    </div>
  );
}

function Conta({ rotulo, valor, forte }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{rotulo}</div>
      <div className={cn("num", forte ? "text-[15px] font-bold" : "text-[15px] font-medium text-muted-foreground")}>
        {fmtBRL(valor)}
      </div>
    </div>
  );
}

/**
 * Enquanto a chave de envio está desligada, a tela diz isso em toda visita —
 * não numa nota de rodapé. Quem confere a fatura precisa saber, antes de gastar
 * meia hora nela, que o resultado não vai sozinho para lugar nenhum.
 */
function AvisoEnvioDesligado() {
  const motivo = bloqueioDeEnvio();
  if (!motivo) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
      <Lock className="mt-0.5 h-4.5 w-4.5 shrink-0 text-muted-foreground" />
      <div className="text-[12.5px] leading-relaxed">
        <div className="font-bold">Envio ao Omie desligado</div>
        <p className="mt-0.5 text-muted-foreground">{motivo}</p>
      </div>
    </div>
  );
}

/**
 * O painel de envio.
 *
 * Mostra sempre as três coisas na mesma ordem: quanto falta subir, o que já
 * subiu e por que (se for o caso) não dá para enviar. O motivo da recusa vem
 * pronto de `recusaDoEnvio` — o mesmo texto que o servidor devolveria —, então
 * ninguém descobre na hora do clique uma regra que a tela não contou.
 */
function PainelEnvio({
  total, aEnviar, valor, envios, orfaos, recusa, enviando, resultado, faturaDeTeste, onEnviar, onLimparTeste,
}: {
  total: number;
  aEnviar: number;
  valor: number;
  envios: Envio[];
  /** Quantos dos que estão no Omie NÃO pertencem à fatura aberta agora. */
  orfaos: number;
  recusa: string | null;
  enviando: string | null;
  resultado: Resultado | null;
  faturaDeTeste: boolean;
  onEnviar: () => void;
  onLimparTeste: () => void;
}) {
  const subiram = envios.filter((e) => e.status === "enviado");
  const comErro = envios.filter((e) => e.status === "erro");
  const tudoLa = total > 0 && aEnviar === 0;
  /* Apagar título de conta a pagar no ERP de produção não pode caber num clique
     distraído. O segundo clique escreve o que vai sumir. */
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className={cn(
      "card-surface overflow-hidden",
      recusa ? "border-border" : tudoLa ? "border-pos/40" : "border-primary/40",
    )}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold">Enviar ao Omie</span>
            {faturaDeTeste && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary">
                fatura de teste
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
            {recusa
              ? recusa
              : tudoLa
                ? `Os ${total} títulos desta fatura já estão no Omie. Reenviar não cria nada: o `
                  + "código de integração de cada parcela é único e o ERP recusa o repetido."
                : `${aEnviar} de ${total} títulos ainda não subiram — ${fmtBRLStr(valor)}. `
                  + "Cada um vira uma conta a pagar própria, com o texto da fatura na observação."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {faturaDeTeste && subiram.length > 0 && (
            <Button
              variant={confirmando ? "destructive" : "outline"}
              size="sm"
              className="h-9"
              disabled={!!enviando}
              onClick={() => {
                if (!confirmando) { setConfirmando(true); return; }
                setConfirmando(false);
                onLimparTeste();
              }}
            >
              <XCircle className="h-4 w-4" />
              {confirmando
                ? `Apagar mesmo os ${subiram.length}?`
                : `Apagar ${subiram.length} do Omie`}
            </Button>
          )}
          <Button
            size="sm"
            className="h-9"
            onClick={onEnviar}
            disabled={!!recusa || !!enviando || tudoLa}
            title={recusa ?? undefined}
          >
            {enviando
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {enviando}</>
              : recusa
                ? <><Lock className="h-4 w-4" /> Envio bloqueado</>
                : <><Send className="h-4 w-4" /> Enviar {aEnviar} título{aEnviar === 1 ? "" : "s"}</>}
          </Button>
        </div>
      </div>

      {(subiram.length > 0 || comErro.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border bg-muted/30 px-4 py-2.5 text-[12px]">
          {subiram.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-pos">
              <Check className="h-3.5 w-3.5" />
              {subiram.length} no Omie · {fmtBRLStr(subiram.reduce((a, e) => a + e.valor, 0))}
            </span>
          )}
          {/* "N no Omie" conta tudo que subiu NESTE mês de fatura, e não só o que
              está no arquivo aberto. Sem esta linha, títulos de uma importação
              anterior se leem como se fossem desta fatura. */}
          {orfaos > 0 && (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {orfaos === subiram.length
                ? "nenhum deles é desta fatura"
                : `${orfaos} deles não são desta fatura`}
              {" — veja a aba Auditoria"}
            </span>
          )}
          {comErro.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {comErro.length} com erro (serão tentados de novo)
            </span>
          )}
          {resultado?.fatura_fechada && (
            <span className="text-muted-foreground">Fatura marcada como enviada.</span>
          )}
        </div>
      )}

      {/* Falha por falha, com o texto que o Omie devolveu. Um resumo do tipo
          "3 erros" obrigaria a abrir o log da função para saber o que houve. */}
      {!!resultado?.falhas?.length && (
        <div className="max-h-52 overflow-auto border-t border-border">
          <table className="w-full text-[11.5px]">
            <tbody>
              {resultado.falhas.map((f) => (
                <tr key={f.integracao} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-1.5 font-medium">{f.estabelecimento}</td>
                  <td className="px-3 py-1.5 font-mono text-[10.5px] text-muted-foreground">{f.integracao}</td>
                  <td className="px-4 py-1.5 text-destructive">{f.erro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cobertura({
  cob, aprendidos,
}: { cob: { total: number; cobertas: number; faltando: string[] }; aprendidos: number }) {
  const pronto = cob.total > 0 && cob.cobertas === cob.total;
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 text-[12.5px]",
      pronto ? "border-pos/40 bg-pos-soft/40" : "border-border bg-muted/40",
    )}>
      {pronto ? <Check className="h-4 w-4 text-pos" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      <span>
        <span className="font-bold">{cob.cobertas} de {cob.total}</span> lojistas com categoria definida
        {aprendidos > 0 && <span className="text-muted-foreground"> · {aprendidos} no de-para</span>}
      </span>
      {cob.faltando.length > 0 && (
        <span className="text-muted-foreground">
          faltam: {cob.faltando.slice(0, 6).join(", ")}
          {cob.faltando.length > 6 && ` e mais ${cob.faltando.length - 6}`}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
 * A auditoria
 * ------------------------------------------------------------------ */

const VEREDITOS: Record<Veredito, { rotulo: string; classe: string }> = {
  orfao: { rotulo: "Órfão", classe: "bg-destructive/10 text-destructive" },
  "sem-categoria": { rotulo: "Sem categoria", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  "a-enviar": { rotulo: "A enviar", classe: "bg-primary/10 text-primary" },
  enviado: { rotulo: "No Omie", classe: "bg-pos-soft text-pos" },
  "nao-gera": { rotulo: "Não gera", classe: "bg-muted text-muted-foreground" },
};

function Selo({ v }: { v: Veredito }) {
  const s = VEREDITOS[v];
  return (
    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10.5px] font-bold", s.classe)}>
      {s.rotulo}
    </span>
  );
}

/**
 * A aba que responde "sobrou alguma coisa?".
 *
 * Três blocos, do geral ao específico: as igualdades que têm de fechar, os
 * títulos que estão no ERP e não têm dono nesta fatura, e a lista completa —
 * TODA linha do arquivo, inclusive as que de propósito não geram título. É a
 * lista completa que dá a garantia; os dois blocos de cima só apontam onde
 * olhar primeiro.
 */
function PainelAuditoria({ auditoria }: { auditoria: Auditoria }) {
  const apelidos = useApelidos();
  const [filtro, setFiltro] = useState<Veredito | "todos">("todos");
  const [busca, setBusca] = useState("");

  const nomeDe = useCallback(
    (l: LinhaAuditada) => apelidoDe(apelidos, l.linha.estabelecimento)?.apelido ?? l.linha.estabelecimento,
    [apelidos],
  );

  const contagem = useMemo(() => {
    const c = new Map<Veredito, number>();
    for (const l of auditoria.linhas) c.set(l.veredito, (c.get(l.veredito) ?? 0) + 1);
    return c;
  }, [auditoria.linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return auditoria.linhas.filter((l) => {
      if (filtro !== "todos" && l.veredito !== filtro) return false;
      if (!q) return true;
      // O apelido entra na varredura: quem lê "Café dos eventos" na tela procura
      // por isso, e não pelo nome cru que o Sicoob mandou.
      return `${l.linha.memo} ${l.linha.estabelecimento} ${nomeDe(l)}`.toLowerCase().includes(q);
    });
  }, [auditoria.linhas, filtro, busca, nomeDe]);

  return (
    <div className="space-y-4">
      {/* ---- as igualdades ---- */}
      <div className="card-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="text-[13px] font-bold">A conta fecha?</span>
          <span className={cn("text-[12px] font-bold", auditoria.fecha ? "text-pos" : "text-destructive")}>
            {auditoria.fecha
              ? "As 7 conferências fecham."
              : `${auditoria.contas.filter((c) => !c.ok).length} de ${auditoria.contas.length} não fecham.`}
          </span>
        </div>
        <table className="w-full text-[12.5px]">
          <tbody>
            {auditoria.contas.map((c) => (
              <tr key={c.rotulo} className="border-b border-border/60 last:border-0">
                <td className="w-6 py-2 pl-4">
                  {c.ok
                    ? <Check className="h-4 w-4 text-pos" />
                    : <XCircle className="h-4 w-4 text-destructive" />}
                </td>
                <td className="py-2 pl-2 pr-3">
                  <div className={cn(!c.ok && "font-bold text-destructive")}>{c.rotulo}</div>
                  {!c.ok && <div className="text-[11px] text-muted-foreground">{c.nota}</div>}
                </td>
                <td className="num whitespace-nowrap py-2 pr-4 text-right text-muted-foreground">
                  {c.tipo === "dinheiro"
                    ? <>{fmtBRL(c.esquerda)} <span className="px-1">×</span> {fmtBRL(c.direita)}</>
                    : `${intStr(c.esquerda)} × ${intStr(c.direita)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- os órfãos ---- */}
      {auditoria.orfaos.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-destructive/40 bg-destructive/5">
          <div className="border-b border-destructive/30 px-4 py-2.5">
            <div className="text-[13px] font-bold text-destructive">
              {intStr(auditoria.orfaos.length)} título(s) no Omie sem dono nesta fatura
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Subiram por este Hub numa importação anterior e não estão no arquivo de hoje. Ou o arquivo
              mudou, ou a fatura é outra — enquanto estiverem assim, são despesa lançada que ninguém confere.
            </p>
          </div>
          <div className="max-h-[220px] overflow-auto">
            <table className="w-full text-[12px]">
              <tbody>
                {auditoria.orfaos.map((o) => (
                  <tr key={o.integracao} className="border-b border-destructive/20 last:border-0">
                    <td className="px-4 py-1.5 font-medium">{o.estabelecimento}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{o.integracao}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {o.codTitulo ? `Omie ${o.codTitulo}` : "sem código"}
                    </td>
                    <td className="num px-4 py-1.5 text-right">{fmtBRL(o.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- linha a linha ---- */}
      <div className="card-surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-[13px] font-bold">
            Linha a linha · {intStr(visiveis.length)} de {intStr(auditoria.linhas.length)}
          </span>
          <div className="flex flex-wrap gap-1">
            {(["todos", "enviado", "a-enviar", "sem-categoria", "nao-gera"] as const).map((f) => {
              const n = f === "todos" ? auditoria.linhas.length : (contagem.get(f) ?? 0);
              if (f !== "todos" && n === 0) return null;
              return (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-medium transition",
                    filtro === f ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70",
                  )}
                >
                  {f === "todos" ? "Todas" : VEREDITOS[f].rotulo} {intStr(n)}
                </button>
              );
            })}
          </div>
          <Input
            className="ml-auto h-8 w-[220px]"
            placeholder="Procurar lojista ou texto da fatura"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Compra</th>
                <th className="px-3 py-2 font-medium">Lojista e texto da fatura</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-3 py-2 font-medium">O que a automação fez</th>
                <th className="px-4 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.linha.fitid + l.linha.memo} className="border-b border-border/60 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{l.linha.data}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{nomeDe(l)}</div>
                    {/* O MEMO cru fica à mostra: é ele que vai para a observação
                        do título e é por ele que se procura no Omie. */}
                    <div className="font-mono text-[10.5px] text-muted-foreground">{l.linha.memo.trim()}</div>
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right">
                    {fmtBRL(l.linha.valor)}
                    {l.linha.sinal === "credito" && <div className="text-[10px] text-muted-foreground">crédito</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <div>{l.linha.motivo}</div>
                    {l.titulos.length > 0 && (
                      <div className="mt-0.5 text-[11px]">
                        {intStr(l.titulos.length)} título(s) · {fmtBRL(l.totalTitulos)}
                        {l.titulos[0].parcela && ` · vence ${l.titulos.map((t) => t.vencimento.slice(5)).join(", ")}`}
                      </div>
                    )}
                    {l.titulos.filter((t) => t.divergencia).map((t) => (
                      <div key={t.integracao} className="mt-0.5 text-[11px] font-medium text-destructive">
                        {t.divergencia}
                      </div>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <Selo v={l.veredito} />
                    {l.titulos.some((t) => t.codTitulo) && (
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                        Omie {l.titulos.filter((t) => t.codTitulo).map((t) => t.codTitulo).join(", ")}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    Nenhuma linha neste filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabelaGrupos({
  grupos, balde, categorias, escolhaDe, onDefinir,
}: {
  grupos: Grupo[];
  balde: Balde;
  categorias: CategoriaOmie[];
  escolhaDe: (chave: string) => (Sugestao & { manual: boolean }) | null;
  onDefinir: (chave: string, c: CategoriaOmie) => void;
}) {
  const apelidos = useApelidos();
  const [aberto, setAberto] = useState<string | null>(null);
  const classifica = balde === "avista" || balde === "primeira";

  if (!grupos.length) {
    return <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">Nada neste balde.</p>;
  }

  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium">Lojista</th>
            <th className="px-3 py-2 text-right font-medium">Linhas</th>
            <th className="px-3 py-2 text-right font-medium">Títulos</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            {classifica && <th className="px-4 py-2 font-medium">Categoria no Omie</th>}
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => {
            const e = escolhaDe(g.chave);
            const expandido = aberto === g.chave;
            return (
              <Fragment key={g.chave}>
                <tr className="border-b border-border/50 hover:bg-muted/40">
                  <td className="px-4 py-2">
                    <button
                      className="flex items-center gap-1.5 text-left"
                      onClick={() => setAberto(expandido ? null : g.chave)}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition", expandido && "rotate-90")} />
                      {/* Apelido em cima, lojista do OFX embaixo (Configurações
                          › Parametrização). Aqui o nome cru importa mais que em
                          outras telas: é o que se confere contra a fatura. */}
                      <span className="min-w-0">
                        <span className="block font-medium"
                          title={apelidoDe(apelidos, g.estabelecimento)?.oQueE ?? undefined}>
                          {apelidoDe(apelidos, g.estabelecimento)?.apelido ?? g.estabelecimento}
                        </span>
                        {apelidoDe(apelidos, g.estabelecimento) && (
                          <span className="block text-[10.5px] text-muted-foreground">{g.estabelecimento}</span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="num px-3 py-2 text-right text-muted-foreground">{g.linhas.length}</td>
                  <td className="num px-3 py-2 text-right">
                    {g.titulos !== g.linhas.length ? <span className="font-semibold">{g.titulos}</span> : g.titulos}
                  </td>
                  <td className="num px-3 py-2 text-right font-medium">{fmtBRL(g.total)}</td>
                  {classifica && (
                    <td className="px-4 py-2">
                      <SeletorCategoria
                        atual={e}
                        categorias={categorias}
                        onEscolher={(c) => onDefinir(g.chave, c)}
                      />
                    </td>
                  )}
                </tr>
                {expandido && (
                  <tr className="bg-muted/30">
                    <td colSpan={classifica ? 5 : 4} className="px-4 py-2">
                      <div className="max-h-56 overflow-auto rounded border border-border/60 bg-card">
                        <table className="w-full text-[11.5px]">
                          <tbody>
                            {g.linhas.map((l) => (
                              <tr key={l.fitid} className="border-b border-border/40 last:border-0">
                                <td className="px-3 py-1.5 text-muted-foreground">{l.data}</td>
                                <td className="px-3 py-1.5 font-mono text-[11px]">{l.memo.trim()}</td>
                                <td className="px-3 py-1.5 text-muted-foreground">{l.motivo}</td>
                                <td className="num px-3 py-1.5 text-right">{fmtBRLStr(l.valor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CORES_CONFIANCA = {
  alta: "text-pos",
  media: "text-muted-foreground",
  baixa: "text-destructive",
} as const;

function SeletorCategoria({
  atual, categorias, onEscolher,
}: {
  atual: (Sugestao & { manual: boolean }) | null;
  categorias: CategoriaOmie[];
  onEscolher: (c: CategoriaOmie) => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex w-full max-w-[340px] items-center justify-between gap-2 rounded border px-2 py-1 text-left transition hover:bg-muted",
            atual ? "border-border" : "border-destructive/50 bg-destructive/5",
          )}
        >
          <span className="truncate">
            {atual
              ? (atual.descricaoCategoria ?? atual.codigoCategoria)
              : <span className="text-destructive">sem categoria</span>}
          </span>
          {atual && (
            <span className={cn("shrink-0 text-[10px] uppercase tracking-wide", CORES_CONFIANCA[atual.confianca])}>
              {atual.manual ? "escolhida" : atual.origem === "historico" ? atual.confianca : atual.origem}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar categoria do Omie…" />
          <CommandList>
            <CommandEmpty>Nenhuma categoria.</CommandEmpty>
            <CommandGroup>
              {categorias.filter((c) => c.despesa).map((c) => (
                <CommandItem
                  key={c.codigo}
                  value={`${c.descricao} ${c.codigo}`}
                  onSelect={() => { onEscolher(c); setAberto(false); }}
                >
                  <div className="min-w-0">
                    <div className="truncate">{c.descricao}</div>
                    <div className="text-[10.5px] text-muted-foreground">
                      {c.codigo}{c.rubrica_dre && ` · DRE: ${c.rubrica_dre}`}
                    </div>
                  </div>
                  {c.usos > 0 && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.usos}×</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Estado inicial: explica o fluxo antes de pedir o arquivo. */
function SemFatura({
  onArquivo, inputRef, aprendidos, aprendendo, onAprender,
}: {
  onArquivo: (f: File) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  aprendidos: number;
  aprendendo: boolean;
  onAprender: () => void;
}) {
  const [sobre, setSobre] = useState(false);

  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="eyebrow">Hub Financeiro · Operacional</div>
        <h1 className="mt-0.5 text-3xl font-bold tracking-tight">Cartão → Omie</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Suba o OFX da fatura do Sicoob. A tela separa o que já foi provisionado em meses anteriores, o que é
          compra à vista e o que é primeira parcela de uma série — e mostra o que iria para o Omie, com a categoria
          que a empresa já usa para cada lojista.
        </p>
      </div>

      <AvisoEnvioDesligado />

      <div
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault(); setSobre(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onArquivo(f);
        }}
        className={cn(
          "card-surface flex flex-col items-center justify-center gap-3 border-dashed p-12 text-center transition",
          sobre && "border-primary bg-primary/5",
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileUp className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[14px] font-semibold">Arraste o .ofx da fatura aqui</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Os arquivos ficam em <span className="font-mono">Desktop\Faturas_Cartão_Sicoob</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" /> Escolher arquivo
        </Button>
        <input
          ref={inputRef} type="file" accept=".ofx,.OFX" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onArquivo(f); e.target.value = ""; }}
        />
      </div>

      <div className="card-surface flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <CreditCard className="mt-0.5 h-4.5 w-4.5 shrink-0 text-muted-foreground" />
          <div className="text-[12.5px] leading-relaxed">
            <div className="font-semibold">De-para de categoria</div>
            <p className="text-muted-foreground">
              {aprendidos > 0
                ? `${aprendidos} lojistas já mapeados. Rodar de novo reaprende com as faturas mais recentes.`
                : "Ainda vazio. O Hub aprende sozinho: casa as faturas já importadas com os títulos do Omie e vê em que categoria cada lojista foi lançado."}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onAprender} disabled={aprendendo}>
          {aprendendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Aprender do histórico
        </Button>
      </div>
    </div>
  );
}
