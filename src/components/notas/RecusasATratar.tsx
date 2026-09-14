/**
 * AS NOTAS QUE A PREFEITURA RECUSOU — e o que fazer com cada uma.
 *
 * Nasceu em 01/09/2026, no dia em que a emissão do Asaas foi desligada. Antes,
 * uma recusa era contratempo: o Asaas emitia a nota daquela cobrança de qualquer
 * jeito. Com o Omie como único emissor, recusa virou cliente SEM NOTA — e o que
 * não tem tela não é trabalhado.
 *
 * AGRUPADA POR AÇÃO, não por código de erro. "E0240, 49 casos" descreve o
 * defeito; o que a pessoa precisa é saber o que fazer, e são três coisas:
 *
 *   ✔ consertado        → a máquina já corrigiu o cadastro. Falta só reenviar.
 *   ✖ precisa_de_gente  → o cadastro bate com a Receita e mesmo assim recusa.
 *   ~ so_reenviar       → oscilação da prefeitura; não há cadastro a corrigir.
 *
 * O REENVIO NÃO TEM BOTÃO AQUI, e não é esquecimento: OS faturada com recusa não
 * volta pela API do Omie (dez métodos sondados, todos "Method not exists"). O
 * único caminho é o "Reenviar NFS-e" na tela do Omie. Prometer o botão aqui
 * seria pior do que não ter: a pessoa clicaria e nada aconteceria.
 *
 * OS TRÊS GRUPOS NASCEM FECHADOS. Uma etapa com 250 linhas empurra as outras duas
 * para fora da tela, e a primeira pergunta de quem chega aqui é de tamanho — "quanto
 * está esperando em cada etapa?" —, não de conteúdo. Fechado, o cabeçalho já responde
 * (quantas e quanto); aberto, é a lista de trabalho. O que estava aberto fica guardado
 * no navegador para a visita seguinte.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Check, RefreshCw, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";

const sb = supabase as any;

type Recusa = {
  n_cod_os: number;
  c_num_os: string | null;
  id_cobranca: string | null;
  cnpj_cpf: string | null;
  nome: string | null;
  valor: number;
  data_faturamento: string | null;
  motivo: string | null;
  motivo_curto: string | null;
  cep: string | null;
  cep_generico: boolean | null;
  emitivel: boolean | null;
  situacao: "consertado" | "precisa_de_gente" | "so_reenviar";
  consertado_em: string | null;
  o_que_foi_feito: string | null;
};

const fmtBRL = (v: number) =>
  comValorExato(
    v,
    Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
  );

const dataBR = (d: string | null) => {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}` : d;
};

const GRUPOS = [
  {
    chave: "consertado" as const,
    titulo: "Já consertei o cadastro",
    ajuda: "Corrigi o endereço no ERP depois da recusa. Falta só reenviar a nota na tela do Omie.",
    Icone: Check,
    cor: "text-emerald-600 dark:text-emerald-400",
    borda: "border-l-emerald-500",
  },
  {
    chave: "precisa_de_gente" as const,
    titulo: "Precisam de você",
    /* O TEXTO ENCOLHEU EM 12/09/2026, e encolheu porque a máquina cresceu.
       Telefone inválido e código do município eram "conferir com o cliente" e
       viraram conserto automático — a lista aqui é o que sobra de verdade, e
       dizer isso é o que evita alguém ir conferir um telefone que a rodada das
       12:45 já vai trocar. Se a linha estiver aqui e a causa for uma dessas,
       clique em "Consertar cadastros" acima em vez de ligar para o cliente. */
    ajuda:
      "A máquina olhou e não soube resolver. O que sobra aqui é endereço materialmente errado (logradouro com nome de cidade, número “00”), CEP que não existe nos Correios e a Receita não substitui, e CPF que a Receita não reconhece. Conferir com o cliente.",
    Icone: AlertTriangle,
    cor: "text-amber-600 dark:text-amber-400",
    borda: "border-l-amber-500",
  },
  {
    chave: "so_reenviar" as const,
    titulo: "Só reenviar",
    ajuda: "A prefeitura oscilou. Não há cadastro a corrigir — reenviar costuma bastar.",
    Icone: RefreshCw,
    cor: "text-sky-600 dark:text-sky-400",
    borda: "border-l-sky-500",
  },
];

const CHAVE_ABERTOS = "nfse:recusas:abertos";

const lerAbertos = (): string[] => {
  try {
    const cru = localStorage.getItem(CHAVE_ABERTOS);
    const v = cru ? JSON.parse(cru) : [];
    return Array.isArray(v) ? v.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
};

export default function RecusasATratar() {
  const [linhas, setLinhas] = useState<Recusa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dias, setDias] = useState(45);
  const [abertos, setAbertos] = useState<string[]>(lerAbertos);

  const alternar = (chave: string) =>
    setAbertos((atual) => {
      const proximo = atual.includes(chave) ? atual.filter((c) => c !== chave) : [...atual, chave];
      try {
        localStorage.setItem(CHAVE_ABERTOS, JSON.stringify(proximo));
      } catch {
        /* navegador sem storage — a tela funciona igual, só não lembra */
      }
      return proximo;
    });

  const todosAbertos = (abrir: boolean) => {
    const proximo = abrir ? GRUPOS.map((g) => g.chave as string) : [];
    setAbertos(proximo);
    try {
      localStorage.setItem(CHAVE_ABERTOS, JSON.stringify(proximo));
    } catch {
      /* idem */
    }
  };

  /* Virou `useCallback` porque a devolução à esteira precisa relê-la no fim: as
     OS aposentadas somem desta lista (a RPC filtra por `carimbo_liberado_em is
     null`), e uma tela que continua mostrando o que acabou de sair é a mesma
     mentira do "No forno" eterno, de outro jeito. */
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.rpc("nfse_recusas_a_tratar", { p_dias: dias });
    if (error) setErro(error.message);
    else {
      setErro(null);
      setLinhas((data ?? []) as Recusa[]);
    }
    setCarregando(false);
  }, [dias]);

  useEffect(() => { void carregar(); }, [carregar]);

  const total = useMemo(() => linhas.reduce((s, l) => s + Number(l.valor ?? 0), 0), [linhas]);

  /* A devolução em LEVAS, e o laço mora aqui e não no servidor.
   *
   * Cada volta lê o `StatusOS` da OS no Omie antes de aposentá-la — a guarda que
   * impede aposentar o que já virou nota, e a única coisa cara do processo. Isso
   * põe umas dezenas de OS dentro dos 150s da Edge, então a função devolve
   * `faltam` e a tela chama de novo. É o mesmo desenho da emissão em massa do
   * painel do mês, pelo mesmo motivo. */
  const [devolvendo, setDevolvendo] = useState(false);
  const [devolvido, setDevolvido] = useState<{ devolvidas: number; cobrancas: number; faltam: number } | null>(null);

  const devolver = async () => {
    setDevolvendo(true);
    let devolvidas = 0;
    const cobrancas = new Set<string>();
    try {
      // O teto de voltas existe para o laço não virar infinito se `faltam` parar
      // de diminuir (uma OS que falha sempre continua sendo candidata).
      for (let volta = 0; volta < 12; volta++) {
        const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
          body: { action: "devolver_a_esteira", dias, limite: 50 },
        });
        if (error) throw error;
        if (data?.erro) throw new Error(data.erro);
        devolvidas += Number(data?.devolvidas ?? 0);
        for (const d of (data?.detalhe?.devolvidas ?? [])) cobrancas.add(String(d.id_cobranca));
        setDevolvido({ devolvidas, cobrancas: cobrancas.size, faltam: Number(data?.faltam ?? 0) });
        if (!Number(data?.faltam ?? 0) || !Number(data?.devolvidas ?? 0)) break;
      }
      toast.success(`${devolvidas} OS devolvida(s) à esteira.`, {
        description: "A emissão roda de 10 em 10 minutos das 13h às 21h (UTC) e vai pegando a fila. Acompanhe no Registro de emissões.",
        duration: 12000,
      });
      await carregar();
    } catch (e: any) {
      toast.error("Não deu para devolver à esteira.", { description: e?.message });
    } finally {
      setDevolvendo(false);
    }
  };

  /* TENTAR O CONSERTO AGORA, em vez de esperar as 12:45 UTC.
   *
   * A rodada automática existe desde 29/08/2026 e roda uma vez por dia, com teto
   * de quinze cadastros. Quem abre esta tela com sessenta e duas recusas na mão
   * não tinha como dizer "tente estas agora" — e a partir de 12/09/2026 isso
   * passou a importar, porque a rodada aprendeu a consertar telefone e código do
   * município (ver `camposAcusados`): dezessete das sessenta e duas eram
   * conserto de máquina esperando o relógio.
   *
   * EM LEVAS, e o laço mora aqui, pelo mesmo motivo da devolução à esteira: cada
   * cliente custa três chamadas externas e a Edge morre aos 150s. O teto de
   * voltas impede laço infinito quando o servidor deixa de avançar — o que
   * acontece por desenho: quem foi tentado sai da fila até a recusa seguinte.
   *
   * NÃO REEMITE NADA. Conserta o CADASTRO; a nota sai depois, pelo "Devolver à
   * esteira" ao lado ou pelo reenvio na tela do Omie. Dizer isso no toast é o
   * que evita alguém ficar esperando a nota aparecer sozinha. */
  const [consertando, setConsertando] = useState(false);
  const [consertado, setConsertado] = useState<
    { corrigidos: number; alvos: number; precisam: number } | null
  >(null);

  const consertarCadastros = async () => {
    setConsertando(true);
    let corrigidos = 0;
    let alvos = 0;
    let precisam = 0;
    try {
      for (let volta = 0; volta < 6; volta++) {
        const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
          body: { action: "corrigir_recusados", operador: "tela-recusas" },
        });
        if (error) throw error;
        if (data?.erro) throw new Error(data.erro);
        if (data?.pulada) throw new Error(String(data.pulada));
        const nesta = Number(data?.alvos ?? 0);
        alvos += nesta;
        corrigidos += Number(data?.corrigidos ?? 0);
        precisam += Number(data?.precisam_de_gente ?? 0);
        setConsertado({ corrigidos, alvos, precisam });
        // Fila vazia: nada mais a tentar até a próxima recusa.
        if (!nesta) break;
      }
      if (!alvos) {
        toast.info("Nenhum cadastro na fila do conserto.", {
          description: "Ou já foram tentados depois da última recusa, ou alguém os editou à mão — "
            + "nos dois casos a máquina não redecide.",
        });
      } else {
        toast.success(`${corrigidos} de ${alvos} cadastro(s) corrigidos no Omie.`, {
          description: "Isto conserta o CADASTRO, não emite nota. Use “Devolver à esteira” para a "
            + "nota sair de novo — ou o “Reenviar NFS-e” do Omie, na OS que já faturou.",
          duration: 12000,
        });
      }
      await carregar();
    } catch (e) {
      toast.error("Não deu para consertar os cadastros.", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConsertando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo as recusas…
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Não deu para ler as recusas: {erro}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
        <div className="text-sm">
          <span className="font-semibold">{linhas.length}</span> nota(s) recusada(s) ·{" "}
          <span className="font-semibold">{fmtBRL(total)}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Com o Omie como único emissor, enquanto não saírem esses clientes ficam sem nota.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => todosAbertos(abertos.length === 0)}
            className="mr-2 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {abertos.length === 0 ? "Expandir tudo" : "Recolher tudo"}
          </button>
          {[15, 45, 120].map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={cn(
                "rounded border px-2 py-1 text-xs",
                dias === d
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {/* --------------------- devolver à esteira, em levas ---------------------
       *
       * O QUE ESTE BOTÃO FAZ: marca a OS recusada como aposentada aqui dentro, e
       * a esteira normal — a das 13h às 21h, com todas as guardas de sempre —
       * cria uma OS NOVA e emite. Ele NÃO emite; se emitisse, seria um segundo
       * caminho de emissão, e o módulo já pagou caro por ter dois emissores
       * vivos ao mesmo tempo (28/08/2026, 99 cobranças com nota dos dois lados).
       *
       * SÓ ALCANÇA A OS SEM CARIMBO do Asaas, que é a maioria. A que nasceu aqui
       * ficou com o `cCodIntOS` ocupado para sempre: `AlterarOS` não renomeia o
       * próprio identificador e `IncluirOS` recusa carimbo repetido — as duas
       * recusas foram medidas no Omie em 09/09/2026. Essas continuam pedindo o
       * "Reenviar NFS-e" da tela, e o rodapé diz isso.
       */}
      {linhas.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="min-w-[260px] flex-1">
            <p className="text-xs font-semibold text-foreground">Devolver à esteira</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Aposenta a OS recusada e a cobrança volta para a fila de emissão, onde uma OS nova nasce e
              vira nota — sem ninguém reenviar à mão. Não emite agora: quem emite é a esteira, com a
              conferência ao vivo no Asaas e a guarda anti-duplicata de sempre.
              {devolvido && (
                <>
                  {" "}
                  <strong className="text-foreground">
                    {devolvido.devolvidas} OS devolvida(s) · {devolvido.cobrancas} cobrança(s)
                  </strong>
                  {devolvido.faltam > 0 ? ` · faltam ${devolvido.faltam}` : " · acabou"}
                </>
              )}
            </p>
          </div>
          <button
            onClick={devolver}
            disabled={devolvendo}
            className="flex shrink-0 items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
          >
            {devolvendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {devolvendo ? "Devolvendo…" : "Devolver à esteira"}
          </button>
        </div>
      )}

      {/* O CONSERTO DO CADASTRO, antes de devolver à esteira.
          A ordem dos dois blocos é a ordem do trabalho: devolver uma OS cujo
          cadastro continua torto só produz a mesma recusa mais tarde. */}
      {linhas.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div className="min-w-[260px] flex-1">
            <p className="text-xs font-semibold text-foreground">Tentar consertar o cadastro agora</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              A mesma rodada que corre às 12:45 UTC, disparada na hora. Ela lê a recusa e escreve no
              cadastro do cliente o que a prefeitura nomeou: endereço e CEP pela Receita, o e-mail que
              falta, e — desde 12/09/2026 — o telefone inválido e o código do município. Não emite nota:
              depois dela, use “Devolver à esteira”.
              {consertado && (
                <>
                  {" "}
                  <strong className="text-foreground">
                    {consertado.corrigidos} de {consertado.alvos} corrigido(s)
                  </strong>
                  {consertado.precisam > 0 ? ` · ${consertado.precisam} seguem precisando de gente` : ""}
                </>
              )}
            </p>
          </div>
          <button
            onClick={consertarCadastros}
            disabled={consertando || devolvendo}
            className="flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted/60 px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            {consertando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {consertando ? "Consertando…" : "Consertar cadastros"}
          </button>
        </div>
      )}

      {linhas.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nenhuma recusa no período. Tudo que foi emitido saiu.
        </div>
      )}

      {GRUPOS.map(({ chave, titulo, ajuda, Icone, cor, borda }) => {
        const itens = linhas.filter((l) => l.situacao === chave);
        if (!itens.length) return null;
        const soma = itens.reduce((s, l) => s + Number(l.valor ?? 0), 0);
        const aberto = abertos.includes(chave);
        return (
          <section key={chave} className={cn("rounded-lg border border-l-4 border-border bg-card", borda)}>
            <button
              type="button"
              onClick={() => alternar(chave)}
              aria-expanded={aberto}
              className={cn(
                "flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-muted/40",
                aberto && "border-b border-border",
              )}
            >
              <ChevronRight
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  aberto && "rotate-90",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className={cn("flex flex-wrap items-center gap-2 text-sm font-semibold", cor)}>
                  <Icone className="h-4 w-4 shrink-0" />
                  {titulo}
                  <span className="font-normal text-muted-foreground">
                    · {itens.length} · {fmtBRL(soma)}
                  </span>
                </span>
                {aberto && <span className="mt-1 block text-xs text-muted-foreground">{ajuda}</span>}
              </span>
            </button>
            <div className={cn("divide-y divide-border", !aberto && "hidden")}>
              {itens.map((l) => (
                <div key={l.n_cod_os} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-2.5 text-sm">
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    OS {l.c_num_os ?? l.n_cod_os}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{l.nome ?? "—"}</span>
                  <span className="num shrink-0">{fmtBRL(Number(l.valor ?? 0))}</span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {dataBR(l.data_faturamento)}
                  </span>
                  <div className="w-full text-xs text-muted-foreground">
                    {l.motivo_curto}
                    {l.cep_generico && <span className="ml-2 text-amber-600 dark:text-amber-400">[CEP de cidade]</span>}
                    {l.emitivel === false && (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">[cadastro incompleto]</span>
                    )}
                    {l.o_que_foi_feito && (
                      <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                        escrevi: {l.o_que_foi_feito}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Não existe reenviar pela API do Omie — dez métodos sondados, todos inexistentes. O que o botão
        acima faz é outra coisa: <strong className="text-foreground">aposenta a OS recusada</strong> para
        que a cobrança volte à fila e a nota saia por uma OS nova. Isso não duplica nota (a recusada nunca
        gerou documento fiscal), duplica OS.{" "}
        <strong className="text-foreground">Ele não alcança a OS que nasceu aqui</strong>, com carimbo
        <span className="num"> pay_</span> do Asaas: esse código de integração fica ocupado para sempre —
        o <span className="num">AlterarOS</span> não renomeia o próprio identificador e o{" "}
        <span className="num">IncluirOS</span> recusa carimbo repetido (as duas recusas medidas no Omie em
        09/09/2026). Essas continuam pedindo o “Reenviar NFS-e” da tela do Omie, uma a uma.
      </p>
    </div>
  );
}
