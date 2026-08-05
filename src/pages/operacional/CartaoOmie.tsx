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
 * O QUE ELA AINDA NÃO FAZ, DE PROPÓSITO: enviar.
 * Não existe botão de envio aqui. As faturas até ago/26 foram lançadas no Omie à
 * mão e o banco as marca como `fora_do_hub` — mandar de novo duplicaria um mês
 * inteiro de despesa. O caminho de escrita entra depois, contra uma fatura de
 * teste, fora do fechamento.
 *
 * Enquanto isso a tela já vale por si: mostra o que seria lançado, quanto, em
 * que categoria e com que grau de certeza — e é a conferência dessa prévia que
 * torna o envio seguro quando ele existir.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ChevronRight, CreditCard, FileUp, Loader2, Lock,
  RefreshCw, Sparkles, Upload,
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
import { bloqueioDeEnvio } from "@/lib/cartao/envio";
import { fmtBRLStr, intStr } from "@/pages/cartao/fmt";
import { fmtBRL } from "@/pages/cartao/valores";

/* As tabelas do cartão são novas e ainda não estão no types.ts gerado (que não
   se edita à mão). O cast fica confinado aqui. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Até esta competência, as faturas foram lançadas no Omie FORA do Hub.
 *
 * Espelha o marco da migration `20260806120000_cartao_provisionamento.sql`. Está
 * duplicado de propósito: o banco é quem trava de verdade (trigger), e esta
 * cópia serve para a tela explicar o motivo antes de o usuário tentar.
 */
const MARCO_FORA_DO_HUB = "2026-08-01";

/* ------------------------------------------------------------------ */

type Escolha = { codigo: string; descricao: string | null };

const BALDES: { id: Balde; rotulo: string; nota: string }[] = [
  { id: "avista", rotulo: "À vista", nota: "entram inteiras neste mês" },
  { id: "primeira", rotulo: "1ª parcela", nota: "geram a série de títulos" },
  { id: "ignorar", rotulo: "Ignoradas", nota: "já provisionadas antes" },
  { id: "nao-financeiro", rotulo: "Não é despesa", nota: "pagamento e estornos" },
];

export default function CartaoOmie() {
  const [fatura, setFatura] = useState<FaturaOfx | null>(null);
  const [arquivo, setArquivo] = useState<string>("");
  const [vencimento, setVencimento] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [aba, setAba] = useState<Balde>("avista");
  const [mapa, setMapa] = useState<Mapa>(new Map());
  const [escolhas, setEscolhas] = useState<Map<string, Escolha>>(new Map());
  const [aprendendo, setAprendendo] = useState(false);
  const [travada, setTravada] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  /* ---- importar o arquivo ---------------------------------------- */

  const abrirArquivo = useCallback(async (file: File) => {
    // windows-1252, e não UTF-8: o OFX declara CHARSET:1252 e traz acento em
    // nome de lojista. Ler como UTF-8 devolve caractere quebrado no meio de uma
    // coluna que é posicional.
    const texto = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
    if (!/<STMTTRN>/i.test(texto)) {
      toast.error("Não parece um OFX de fatura — não encontrei lançamentos no arquivo.");
      return;
    }

    const f = parseOfx(texto);
    setFatura(f);
    setArquivo(file.name);
    setCompetencia(f.competencia);
    setEscolhas(new Map());
    // Chute inicial do vencimento: dia 10 do mês da fatura. É palpite, e o campo
    // fica editável em destaque — o OFX não traz o vencimento (o LEDGERBAL é
    // saldo devedor acumulado, não o total do ciclo).
    setVencimento(f.competencia ? `${f.competencia.slice(0, 8)}10` : "");

    const { data } = await db
      .from("cartao_faturas").select("competencia, provisionamento")
      .eq("competencia", f.competencia).maybeSingle();
    setTravada(
      f.competencia <= MARCO_FORA_DO_HUB
        ? "Esta fatura foi lançada no Omie à mão, antes de o Hub existir."
        : data?.provisionamento === "enviado"
          ? "Esta fatura já foi enviada ao Omie pelo Hub."
          : null,
    );

    if (!f.competenciaConfiavel) {
      toast.warning("O fechamento deste arquivo não é fim de mês — confira a competência.");
    }
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
      const lancamentos: LinhaHistorico[] = [];
      for (let pagina = 0; ; pagina++) {
        const { data, error } = await db
          .from("cartao_lancamentos")
          .select("data, estabelecimento, descricao, valor, tipo")
          .eq("tipo", "gasto")
          .order("data")
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
    () => (separacao ? agrupar(separacao.porBalde[aba]) : []),
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
          <input
            ref={inputRef} type="file" accept=".ofx,.OFX" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) abrirArquivo(f); e.target.value = ""; }}
          />
        </div>
      </div>

      <AvisoEnvioDesligado />
      {travada && <AvisoTravada motivo={travada} />}

      {/* ---- competência e vencimento ---- */}
      <div className="card-surface flex flex-wrap items-end gap-5 p-4">
        <Campo
          rotulo="Competência da fatura"
          alerta={!fatura.competenciaConfiavel}
          dica={
            fatura.competenciaConfiavel
              ? `Fechou em ${fatura.fechamento} → fatura de ${rotuloMes(competencia || fatura.competencia)}.`
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

        <div className="ml-auto text-right">
          <div className="eyebrow">Títulos que seriam criados</div>
          <div className="num text-[22px] font-bold leading-tight">{intStr(provisoes.length)}</div>
          <div className="text-[11.5px] text-muted-foreground">
            {intStr(separacao.porBalde.avista.length + separacao.porBalde.primeira.length)} linhas da fatura
          </div>
        </div>
      </div>

      {/* ---- os quatro baldes ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

      {/* ---- a tabela ---- */}
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

      <p className="px-1 text-[11.5px] text-muted-foreground">
        Esta tela ainda não envia nada ao Omie — ela mostra o que seria enviado. O caminho de escrita entra depois,
        contra uma fatura de teste e fora do fechamento.
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

function AvisoTravada({ motivo }: { motivo: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <Lock className="mt-0.5 h-4.5 w-4.5 shrink-0 text-destructive" />
      <div className="text-[12.5px] leading-relaxed">
        <div className="font-bold text-destructive">Fatura travada para envio</div>
        <p className="mt-0.5 text-foreground/85">
          {motivo} Reenviar duplicaria a despesa do mês inteiro. A conferência abaixo continua valendo — é só a
          escrita que está bloqueada, no banco, e não por configuração desta tela.
        </p>
      </div>
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

function TabelaGrupos({
  grupos, balde, categorias, escolhaDe, onDefinir,
}: {
  grupos: Grupo[];
  balde: Balde;
  categorias: CategoriaOmie[];
  escolhaDe: (chave: string) => (Sugestao & { manual: boolean }) | null;
  onDefinir: (chave: string, c: CategoriaOmie) => void;
}) {
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
                      <span className="font-medium">{g.estabelecimento}</span>
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
