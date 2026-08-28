// /operacional/notas-fiscais — a cobrança do Asaas e a nota do Omie, lado a lado.
//
// A PERGUNTA QUE ESTA TELA RESPONDE: "esta cobrança tem nota?" — que hoje tem duas
// respostas possíveis em dois sistemas que não sabem um do outro. Até a data de
// corte quem emite é o Asaas; do corte em diante, o Omie.
//
// ONDE A NOTA MORA NO OMIE. Dentro da ORDEM DE SERVIÇO, não num cadastro de notas:
//
//     OS na etapa 50  --FaturarLoteOS-->  faturada  ==>  NFS-e emitida
//
// Emitir, portanto, é faturar a OS — e quando a cobrança não tem OS (a maioria: são
// 1.207 OS contra milhares de cobranças), é criar a OS e faturar. Quem faz isso é a
// edge function `omie-nfse-sync`; esta tela só monta o lote e mostra o resultado.
// (Trocar a etapa da OS NÃO fatura: o Omie aceita e não faz nada. E o `FaturarLoteOS`
// fatura a etapa inteira, por isso a função isola a OS antes — está tudo explicado
// lá, e é de lá que vem a diferença entre "emitida", "já tinha nota" e "no forno".)
//
// O CASAMENTO entre os dois lados é feito no Postgres (`notas_fiscais_painel`) em
// duas camadas: o `cCodIntOS`, que o Hub carimba com o id da cobrança ao criar a OS
// (exato), e — para o histórico que nasceu sem carimbo — CNPJ + valor + competência.
// Por CNPJ e nunca por nome: o Asaas guarda o fantasia e o Omie a razão social.
//
// A LISTA É PAGINADA CONTRA O TETO DO POSTGREST, que corta em 1.000 linhas sem
// avisar. Um mês tem ~3.600 cobranças, então ler de uma vez mostraria 1.000 e
// esconderia o resto — parecendo que o mês é menor do que é.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import {
  FileText, RefreshCw, Loader2, Search, FileCode2, AlertTriangle,
  ChevronLeft, ChevronRight, CheckCircle2, Send, Info, Zap, Layers, Square,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import NotasFiscaisLog from "./NotasFiscaisLog";
import NotasFiscaisAuditoria from "./NotasFiscaisAuditoria";
import {
  SITUACOES, motivoBloqueio, motivoCurto, podeEmitir, exigeAvulsa, resumoLote,
  xmlAindaVale, formatarDoc, statusAsaas,
  linkPortalNacional, chaveEmBlocos,
  somarBloco, precisaEsperarOLote, tetoDoDiaAtingido,
  esperaAntesDeRepetir, PROGRESSO_ZERO, CABEM_NUMA_CHAMADA,
  type LinhaNota, type Situacao, type ProgressoMassa,
} from "@/lib/notasFiscais";

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sb = supabase as any;

/* ------------------------------ formatação ------------------------------ */
// Convenção do projeto: o formatador normal devolve ReactNode com o valor cheio no
// hover; a variante `…Str` devolve string pura (title, template literal, eixo).
const brlStr = (n: number) => `R$ ${Math.round(n || 0).toLocaleString("pt-BR")}`;
const brl = (n: number) => comValorExato(n, brlStr(n));
const dataStr = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** O Asaas começou em out/2022; antes disso não há o que mostrar. */
const ANO_INICIAL = 2022;

const TOM: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  aviso: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  erro: "bg-destructive/10 text-destructive border-destructive/20",
  neutro: "bg-muted text-muted-foreground border-border",
};

interface Resumo {
  cobrancas: number; valor_total: number; falta: number; valor_falta: number;
  emitida_omie: number; emitida_asaas: number; em_processamento: number;
  nota_rejeitada: number; nota_a_cancelar: number; nao_exige: number;
}

/** As mesmas contagens da RPC `notas_fiscais_resumo`, feitas sobre o que já veio. */
function contar(linhas: LinhaNota[]): Resumo {
  const n = (s: Situacao) => linhas.filter((l) => l.situacao === s).length;
  return {
    cobrancas: linhas.length,
    valor_total: linhas.reduce((s, l) => s + Number(l.valor || 0), 0),
    falta: n("falta"),
    valor_falta: linhas.filter((l) => l.situacao === "falta").reduce((s, l) => s + Number(l.valor || 0), 0),
    emitida_omie: n("emitida_omie"),
    emitida_asaas: n("emitida_asaas"),
    em_processamento: n("em_processamento"),
    nota_rejeitada: n("nota_rejeitada"),
    nota_a_cancelar: n("nota_a_cancelar"),
    nao_exige: n("nao_exige"),
  };
}

export default function NotasFiscais() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth()); // 0-11
  const [linhas, setLinhas] = useState<LinhaNota[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [corte, setCorte] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [emitindo, setEmitindo] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Situacao | "todas">("todas");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aba, setAba] = useState<"painel" | "auditoria" | "log">("painel");
  /* A CHAVE DA AVULSA — desligada sempre que a tela nasce, e nunca lembrada.
   *
   * Não vai para o localStorage de propósito, ao contrário de quase toda
   * preferência daqui. Preferência que sobrevive à sessão é boa quando o pior
   * caso é uma coluna escondida; aqui o pior caso é abrir a tela amanhã sob uma
   * régua que se ligou ontem e emitir nota antes de o dinheiro entrar sem ter
   * decidido isso hoje. A avulsa é um ato, e ato se repete, não se herda. */
  const [avulsa, setAvulsa] = useState(false);
  /* A EMISSÃO EM MASSA — o estado da esteira quando ela roda por aqui.
   * `null` = parada. O `esperando` é o que distingue "travou" de "o Omie está
   * faturando o lote anterior", que é a coisa mais comum de acontecer e a mais
   * fácil de confundir com pane. O ref (e não o state) é o que o laço consegue
   * ler no meio da execução — state dentro de um `for await` fica congelado no
   * valor da renderização em que o laço começou. */
  const [massa, setMassa] = useState<ProgressoMassa | null>(null);
  const [esperando, setEsperando] = useState(0);
  const pararMassa = useRef(false);
  /* O TAMANHO DA FILA DA ESTEIRA — e ele não sai das linhas desta tela.
   * A tela mostra o MÊS; a fila é o que a esteira pode emitir AGORA, sob todas
   * as guardas (paralelo com o Asaas, cadastro no Omie, carência). Os dois
   * números são diferentes de propósito e por muito: em agosto, 1.989 contra
   * 1.004. Quem oferece o botão de massa é a fila. */
  const [filaResumo, setFilaResumo] = useState<{ cobrancas: number; valor: number } | null>(null);

  const periodo = useMemo(() => {
    const ult = new Date(ano, mes + 1, 0).getDate();
    const mm = String(mes + 1).padStart(2, "0");
    return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${String(ult).padStart(2, "0")}` };
  }, [ano, mes]);

  /**
   * Lê o painel do mês numa chamada só.
   *
   * A RPC devolve JSONB, e não linhas, por dois motivos que se somam: o PostgREST
   * corta resultado em 1.000 linhas sem avisar (um mês tem ~3.600 cobranças, e o
   * mês apareceria truncado sem ninguém perceber), e paginar com `.range` seria
   * pior — cada página REEXECUTA a função inteira no banco, quatro vezes o mesmo
   * trabalho. Um jsonb é um valor único: não sofre o teto e roda uma vez.
   */
  const carregar = useCallback(async () => {
    setCarregando(true);
    setSel(new Set());
    try {
      const { data, error } = await sb.rpc("notas_fiscais_painel_json", {
        p_de: periodo.de, p_ate: periodo.ate,
      });
      if (error) throw error;
      const todas = (data ?? []) as LinhaNota[];
      setLinhas(todas);

      // O resumo sai das linhas que já estão na mão. Existe a RPC
      // `notas_fiscais_resumo`, mas chamá-la aqui rodaria o painel inteiro uma
      // SEGUNDA vez no banco — num mês de 3.600 cobranças isso dobrava o custo
      // da tela para produzir seis contagens que o cliente faz de graça. A RPC
      // continua servindo quem quer o número sem as linhas (SQL, outra tela).
      setResumo(contar(todas));

      const { data: cfg } = await sb.from("nf_config").select("data_corte").eq("id", 1).maybeSingle();
      setCorte(cfg?.data_corte ?? null);

      /* A fila é do dia, não do mês em foco — por isso ela é lida aqui e não
         derivada das linhas. Falhar aqui não pode derrubar a tela: sem o número
         a faixa de massa some, e o painel do mês continua servindo. */
      const { data: fr } = await sb.rpc("notas_fiscais_fila_resumo");
      const linha = Array.isArray(fr) ? fr[0] : fr;
      setFilaResumo(linha ? { cobrancas: Number(linha.cobrancas ?? 0), valor: Number(linha.valor ?? 0) } : null);
    } catch (e: any) {
      toast.error("Não foi possível carregar o período.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, [periodo.de, periodo.ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  const atualizarDoOmie = async () => {
    setSincronizando(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "espelhar" } });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      toast.success(
        `${data.os_listadas} ordens de serviço no Omie`,
        { description: `${data.status_lidos} status conferidos · ${data.com_nota} com nota autorizada` +
            // Emissão que MORREU também é desfecho, e é o que some se ninguém conta:
            // ela some do "com nota" sem aparecer em lugar nenhum. Ver `fecharRecusadas`.
            (Number(data?.recusas?.fechadas ?? 0) ? ` · ${data.recusas.fechadas} emissão(ões) sem nota, fechadas com o motivo` : "") +
            (data.status_pendentes > data.status_lidos ? ` · faltam ${data.status_pendentes - data.status_lidos}, rode de novo` : "") },
      );
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao atualizar do Omie.", { description: e?.message });
    } finally {
      setSincronizando(false);
    }
  };

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtro !== "todas" && l.situacao !== filtro) return false;
      if (!q) return true;
      // O documento entra na varredura formatado E cru: quem procura cola do Omie
      // (com pontuação) ou digita só os números.
      return [
        l.cliente_asaas, l.descricao, l.id_asaas, l.cnpj_cpf, formatarDoc(l.cnpj_cpf),
        l.nfse_numero, l.nf_asaas_numero,
      ].some((c) => (c ?? "").toLowerCase().includes(q));
    });
  }, [linhas, busca, filtro]);

  const lote = useMemo(() => resumoLote(linhas, sel, { avulsa }), [linhas, sel, avulsa]);

  const alternar = (id: string) => {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  /** Marca só o que dá para emitir — marcar o bloqueado seria promessa falsa. */
  const marcarEmitiveis = () =>
    setSel(new Set(visiveis.filter((l) => podeEmitir(l, { avulsa })).map((l) => l.id_asaas)));

  /**
   * DESLIGAR A CHAVE DESMARCA O QUE SÓ ELA DEIXAVA MARCAR.
   *
   * Sem isto a confirmada continuaria selecionada com a chave desligada: a barra
   * de lote diria "3 de 5 vão ser emitidas" e as duas de fora seriam justamente
   * as que a pessoa escolheu a dedo. Some da barra o que sumiu da régua.
   */
  const trocarAvulsa = (ligada: boolean) => {
    setAvulsa(ligada);
    if (!ligada) {
      setSel((s) => new Set(
        linhas.filter((l) => s.has(l.id_asaas) && podeEmitir(l)).map((l) => l.id_asaas),
      ));
    }
  };

  const emitir = async () => {
    const escolhidas = linhas.filter((l) => sel.has(l.id_asaas)).filter((l) => podeEmitir(l, { avulsa }));
    const ids = escolhidas.map((l) => l.id_asaas);
    if (!ids.length) return;
    const plural = ids.length > 1;
    /* O aviso diz o que a régua larga acrescentou, com número e valor. "Emitir
     * 12 notas" e "emitir 12 notas, 5 delas sobre cobrança que ainda não
     * liquidou" são dois pedidos diferentes, e quem clica tem de saber qual dos
     * dois está fazendo antes de clicar. */
    const aviso =
      `Emitir ${ids.length} nota${plural ? "s" : ""} fiscal${plural ? "is" : ""} no Omie ` +
      `(${brlStr(lote.valor)})?\n\n` +
      (lote.confirmadas
        ? `ATENÇÃO — ${lote.confirmadas} dela${lote.confirmadas > 1 ? "s" : ""} (${brlStr(lote.valorConfirmadas)}) ` +
          `${lote.confirmadas > 1 ? "são de cobranças CONFIRMADAS" : "é de cobrança CONFIRMADA"}: ` +
          `pagamento autorizado cuja liquidação ainda não caiu na conta. Se não liquidar, a nota vira imposto ` +
          `sobre receita que não existiu.\n\n`
        : "") +
      `Isto cria a Ordem de Serviço e fatura, o que emite a NFS-e de verdade. ` +
      `Nota emitida não se apaga — cancela-se, com prazo e justificativa.`;
    if (!window.confirm(aviso)) return;

    setEmitindo(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
        // `avulsa` viaja no corpo e não é lido de configuração nenhuma: é a
        // decisão desta chamada, e o servidor confere a régua de novo do lado de
        // lá (ver `bloqueioDeEmissao` na edge function). A tela explica; ela não
        // é a guarda.
        body: { action: "emitir", ids, avulsa },
      });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      /* Três desfechos, três avisos. "Em processamento" é o que mais importa
       * separar: o faturamento do Omie é assíncrono e a nota costuma nascer
       * minutos depois do disparo. Chamar isso de falha faz o operador mandar
       * emitir de novo — e a segunda nota da mesma cobrança não se apaga. */
      const emProcesso = (data.resultados ?? []).filter((r: any) => r.em_processamento);
      const barradas = (data.resultados ?? []).filter((r: any) => r.bloqueado);
      const falhas = (data.resultados ?? []).filter((r: any) => !r.ok && !r.em_processamento && !r.bloqueado);
      const jaEmitidas = (data.resultados ?? []).filter((r: any) => r.ja_emitida);

      if (data.emitidas) toast.success(`${data.emitidas} nota(s) emitida(s) no Omie.`);
      if (jaEmitidas.length) {
        toast.info(`${jaEmitidas.length} já tinha(m) nota.`, {
          description: jaEmitidas.slice(0, 3).map((r: any) => r.aviso).join(" · "),
          duration: 10000,
        });
      }
      if (emProcesso.length) {
        toast.warning(`${emProcesso.length} ainda no forno do Omie.`, {
          description: `${emProcesso.slice(0, 2).map((r: any) => r.erro).join(" · ")} Atualize em alguns minutos — não emita de novo.`,
          duration: 15000,
        });
      }
      /* Barrada não é falha, e misturar as duas mandaria o operador tentar de
       * novo o que nunca vai passar. A conferência da porta lê o Asaas no
       * instante da emissão: se ela barrou, a cobrança foi estornada ou o
       * dinheiro ainda não entrou — e o espelho da tela pode estar mostrando o
       * estado de ontem, por isso o recarregamento abaixo. */
      if (barradas.length) {
        toast.warning(`${barradas.length} barrada(s) na conferência com o Asaas.`, {
          description: `${barradas.slice(0, 3).map((b: any) => b.erro).join(" · ")} Nada foi mandado ao Omie.`,
          duration: 15000,
        });
      }
      if (falhas.length) {
        toast.error(`${falhas.length} não saíram.`, {
          description: falhas.slice(0, 3).map((f: any) => f.erro).join(" · "),
          duration: 12000,
        });
      }
      if (data.nao_tentadas?.length) {
        toast.info(`${data.nao_tentadas.length} não couberam nesta chamada.`, {
          description: "Cada emissão espera o Omie faturar (~2 min) e a função tem 150s. Estas não foram tocadas — mande de novo.",
          duration: 15000,
        });
      }
      await carregar();
    } catch (e: any) {
      toast.error("Falha na emissão.", { description: e?.message });
    } finally {
      setEmitindo(false);
    }
  };

  /* ------------------------- emissão em massa ---------------------------- */
  /**
   * Emite a fila inteira, uma leva por vez, esperando o Omie entre elas.
   *
   * DE ONDE SAI A LISTA, e esta é a decisão que mais importa aqui: da FILA
   * (`notas_fiscais_fila_emissao`), que é a mesma que o cron consome — não do
   * que está selecionado nem do que a tela mostra.
   *
   * A régua da tela (`motivoBloqueio`) responde "esta linha pode ser
   * selecionada?" e não conhece as guardas da fila: o paralelo com o Asaas, o
   * cadastro do cliente no Omie, a nota do Asaas em `SCHEDULED`/`ERROR`. Numa
   * seleção a dedo isso está certo — a porta do servidor confere de novo. Em
   * massa, não: medido em 27/08, a tela ofereceria 1.989 cobranças de agosto e
   * 1.070 delas (R$ 591 mil) já tinham nota do Asaas. Seriam mil chamadas para
   * colher mil recusas e mil linhas `bloqueado` no diário.
   *
   * A fila é relida A CADA LEVA, e não uma vez no começo. Duas razões que se
   * somam: o teto de 1.000 linhas do PostgREST não alcança uma lista de 1.004, e
   * a fila já exclui sozinha quem acabou de ser despachado (a guarda das 12h
   * sobre `nf_emissoes`). Reler é mais barato do que paginar e não erra.
   *
   * O laço é burro de propósito. O único julgamento que faz é separar os três
   * motivos de uma leva não andar: lote em voo (espera e REPETE), teto do dia
   * (para — só abre amanhã) e o resto (desiste dessa leva, porque uma leva ruim
   * não pode impedir o mês de fechar).
   */
  const emitirEmMassa = async () => {
    const total = filaResumo?.cobrancas ?? 0;
    if (!total) return;
    const levas = Math.ceil(total / CABEM_NUMA_CHAMADA);

    if (!window.confirm(
      `Emitir as ${total.toLocaleString("pt-BR")} notas fiscais da fila no Omie (${brlStr(filaResumo?.valor ?? 0)})?\n\n` +
      `Vai em ${levas} leva${levas > 1 ? "s" : ""} de até ${CABEM_NUMA_CHAMADA}, esperando o Omie faturar ` +
      `entre uma e outra — cada lote leva alguns minutos. ` +
      `Estimativa: ${Math.max(1, Math.round(levas * 2.5))} a ${Math.round(levas * 4)} minutos.\n\n` +
      `ESTA ABA PRECISA FICAR ABERTA. Fechar no meio não desfaz o que já saiu — ` +
      `só interrompe o resto, e a esteira retoma de onde parou.\n\n` +
      `Sai a fila da esteira: só cobrança recebida, com cliente no Omie e sem nota do Asaas. ` +
      `A chave Avulsa não vale aqui — ela é ato de seleção, não de varredura.\n\n` +
      `Nota emitida não se apaga: cancela-se, com prazo e justificativa.`,
    )) return;

    pararMassa.current = false;
    let acc = PROGRESSO_ZERO(levas);
    setMassa(acc);

    try {
      for (let leva = 0; leva < levas + 5; leva++) {
        if (pararMassa.current) throw new Error("__parado__");

        // A fila de agora, não a de um minuto atrás.
        const { data: proximas, error: erroFila } = await sb.rpc(
          "notas_fiscais_fila_emissao", { p_limite: CABEM_NUMA_CHAMADA },
        );
        if (erroFila) throw erroFila;
        const ids = ((proximas ?? []) as Array<{ id_asaas: string }>).map((l) => l.id_asaas);
        if (!ids.length) break; // acabou

        for (let tentativa = 1; ; tentativa++) {
          if (pararMassa.current) throw new Error("__parado__");

          const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
            body: { action: "emitir", ids },
          });
          const r = error ? { erro: error.message ?? String(error) } : (data ?? {});

          /* O LOTE ANTERIOR AINDA ESTÁ NO FORNO. Nada foi criado, então repetir
           * é seguro — e é a única coisa que faz o mês fechar. */
          if (precisaEsperarOLote(r) && tentativa <= 12) {
            const seg = Math.round(esperaAntesDeRepetir(tentativa) / 1000);
            // Conta regressiva: sem ela a tela fica parada e parece pane.
            for (let s = seg; s > 0 && !pararMassa.current; s--) {
              setEsperando(s);
              await dorme(1000);
            }
            setEsperando(0);
            continue;
          }

          acc = somarBloco(acc, r);
          setMassa({ ...acc });

          if (tetoDoDiaAtingido(r)) {
            toast.warning("O teto do dia foi atingido.", {
              description: "A esteira para por hoje e retoma amanhã sozinha. Para empurrar mais, suba o teto do dia em nf_config.",
              duration: 15000,
            });
            throw new Error("__teto__");
          }
          break;
        }
      }
      toast.success(`${acc.despachadas} nota(s) despachada(s) ao Omie.`, {
        description: "O lote é assíncrono: os números chegam nos próximos minutos. Use \"Atualizar do Omie\" para vê-los.",
        duration: 15000,
      });
    } catch (e) {
      /* Os dois nomes com underscore são desvios de fluxo, não panes: "parado"
         é o botão da pessoa e "teto" é o freio do dia, que já avisou por conta
         própria. Só o que não é nenhum dos dois merece cara de erro. */
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "__parado__") {
        toast.info(`Interrompido. ${acc.despachadas} já foram despachadas.`, {
          description: "O que saiu, saiu — não se desfaz. O resto continua na fila e a esteira retoma.",
          duration: 12000,
        });
      } else if (msg !== "__teto__") {
        toast.error("A emissão em massa parou.", { description: msg, duration: 12000 });
      }
    } finally {
      setEsperando(0);
      pararMassa.current = false;
      await carregar();
      // O progresso fica na tela depois de terminar: é o resumo do que
      // aconteceu, e apagá-lo no fim levaria embora justamente o relatório.
    }
  };

  const kpis = resumo ? [
    { r: "Cobranças", v: resumo.cobrancas.toLocaleString("pt-BR"), s: brlStr(resumo.valor_total), tom: "neutro" },
    { r: "Sem nota", v: resumo.falta.toLocaleString("pt-BR"), s: brlStr(resumo.valor_falta), tom: resumo.falta ? "erro" : "ok" },
    { r: "Emitida no Omie", v: resumo.emitida_omie.toLocaleString("pt-BR"), s: "NFS-e autorizada", tom: "ok" },
    { r: "Emitida no Asaas", v: resumo.emitida_asaas.toLocaleString("pt-BR"), s: "antes do corte", tom: "ok" },
    { r: "NFS-e rejeitada", v: resumo.nota_rejeitada.toLocaleString("pt-BR"), s: "faturada sem nota válida", tom: resumo.nota_rejeitada ? "erro" : "neutro" },
    { r: "Nota a cancelar", v: resumo.nota_a_cancelar.toLocaleString("pt-BR"), s: "estorno com nota", tom: resumo.nota_a_cancelar ? "erro" : "neutro" },
  ] : [];

  return (
    <div className="space-y-4">
      {/* ------------------------------ cabeçalho ------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Notas Fiscais</h1>
            <p className="text-xs text-muted-foreground">
              Cobranças do Asaas × emissão no Omie
              {corte && <> · corte em <span className="num">{dataStr(corte)}</span></>}
            </p>
          </div>
        </div>
        <button
          onClick={atualizarDoOmie}
          disabled={sincronizando}
          className="ghost-btn flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
        >
          {sincronizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar do Omie
        </button>
      </div>

      {/* --------------------------------- abas -------------------------------- */}
      {/* Três perguntas diferentes, e por isso três abas:
          • Painel      — "o que falta emitir neste mês"
          • Auditoria   — "o que nunca vai virar nota, e por quê" (a fila descarta
                          cliente sem cadastro no Omie em silêncio: nem erro, nem
                          linha no registro — some)
          • Registro    — "o que o processo fez, quando, e por quê"
          Misturar as duas primeiras numa tela só é o que deixaria a falta
          silenciosa parecendo ausência de problema. */}
      <div className="flex items-center gap-1 border-b border-border">
        {([["painel", "Painel do mês"], ["auditoria", "Auditoria"], ["log", "Registro de emissões"]] as const).map(([k, r]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium",
              aba === k
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {aba === "log" && <NotasFiscaisLog />}

      {/* ------------------------------- período ------------------------------- */}
      {/* Fora do bloco do painel de propósito: a auditoria olha o MESMO recorte, e
          um seletor por aba faria a pessoa trocar o mês duas vezes para comparar
          o que falta com o que nunca vai sair. O registro de emissões é o único
          que não tem mês — ele é uma linha do tempo. */}
      {aba !== "log" && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <button onClick={() => setAno((a) => Math.max(ANO_INICIAL, a - 1))} className="ghost-icone rounded p-1">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="num w-12 text-center text-sm font-semibold">{ano}</span>
        <button
          onClick={() => setAno((a) => Math.min(hoje.getFullYear(), a + 1))}
          className="ghost-icone rounded p-1"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="ml-2 flex flex-wrap gap-1">
          {MESES.map((m, i) => (
            <button
              key={m}
              onClick={() => setMes(i)}
              className={cn(
                "rounded px-2 py-1 text-xs capitalize transition-colors",
                i === mes ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      )}

      {aba === "auditoria" && <NotasFiscaisAuditoria de={periodo.de} ate={periodo.ate} />}

      {aba === "painel" && (
      <>
      {/* --------------------------------- KPIs -------------------------------- */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.r} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">{k.r}</p>
            <p className={cn("num text-xl font-semibold", k.tom === "erro" && "text-destructive")}>{k.v}</p>
            <p className="truncate text-[11px] text-muted-foreground">{k.s}</p>
          </div>
        ))}
      </div>

      {/* ------------------------------- filtros ------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Cliente, CNPJ, descrição, nº da nota…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["todas", "falta", "nota_rejeitada", "emitida_omie", "emitida_asaas", "em_processamento", "nota_a_cancelar", "nao_exige"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cn(
                "rounded border px-2 py-1 text-[11px] transition-colors",
                filtro === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f === "todas" ? "Todas" : SITUACOES[f].rotulo}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------- avulsa -------------------------------- */}
      {/* A CHAVE, e por que ela é uma chave e não um botão a mais.
          Um botão "Emitir avulsa" ao lado de "Emitir no Omie" faria a régua ser
          escolhida no último clique, depois de a seleção já estar montada — e as
          duas listas seriam idênticas na tela. A chave inverte a ordem: primeiro
          se decide sob que régua se está trabalhando, e a LISTA responde na hora
          (caixas que acendem, selo âmbar nas que só saem assim). O risco fica
          visível durante a escolha, que é quando dá para desistir dele. */}
      <div className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border p-2 transition-colors",
        avulsa ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card",
      )}>
        <button
          onClick={() => trocarAvulsa(!avulsa)}
          role="switch"
          aria-checked={avulsa}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
            avulsa
              ? "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          <Zap className={cn("h-3.5 w-3.5", avulsa && "fill-current")} />
          Emissão avulsa
        </button>
        <p className="flex-1 text-[11px] leading-relaxed text-muted-foreground">
          {avulsa ? (
            <>
              A régua larga está ligada: cobrança <strong className="text-amber-600 dark:text-amber-400">confirmada</strong> também
              pode ser emitida agora, com a competência no vencimento. Estorno, pendente e vencida continuam barrados,
              e nenhuma guarda contra nota duplicada foi afrouxada. Quem manda assina no registro de emissões.
            </>
          ) : (
            <>
              Só cobrança <strong>recebida</strong> pode ser emitida — é a régua da rodada diária. Ligue a avulsa para
              emitir também as <strong>confirmadas</strong> (pagamento autorizado, liquidação ainda não caiu na conta),
              uma a uma e sob sua assinatura.
            </>
          )}
        </p>
      </div>

      {/* ---------------------------- emissão em massa ------------------------- */}
      {/* A FAIXA DO FECHAMENTO DE MÊS.
          Fica acima da barra de lote porque responde outra pergunta: a de baixo
          é "o que eu escolhi", esta é "tudo o que dá para emitir agora". Só
          aparece quando há leva — uma faixa permanente dizendo "0 para emitir"
          seria um botão de emitir nota fiscal em massa sempre à mão, e este é
          exatamente o tipo de botão que não deve estar sempre à mão. */}
      {((filaResumo?.cobrancas ?? 0) > 0 || massa) && (
        <div className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border p-3",
          massa ? "border-primary/40 bg-primary/5" : "border-border bg-card",
        )}>
          <Layers className="h-4 w-4 shrink-0 text-primary" />
          <div className="flex-1 text-xs leading-relaxed">
            {massa ? (
              <>
                <span className="font-semibold">
                  Leva {Math.min(massa.blocosFeitos + 1, massa.blocosTotal)} de {massa.blocosTotal}
                </span>
                {" · "}
                <span className="num">{massa.despachadas}</span> despachada{massa.despachadas === 1 ? "" : "s"} ao Omie
                {massa.jaEmitidas > 0 && <> · <span className="num">{massa.jaEmitidas}</span> já tinham nota</>}
                {massa.barradas > 0 && <> · <span className="num">{massa.barradas}</span> barradas no Asaas</>}
                {massa.falhas > 0 && <> · <span className="num text-destructive">{massa.falhas}</span> não saíram</>}
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {esperando > 0
                    ? `O Omie ainda está faturando a leva anterior — nova tentativa em ${esperando}s. Nada se perdeu.`
                    : "Despachada não é emitida: o lote é assíncrono e o número da nota chega minutos depois."}
                </div>
                {/* Os motivos agrupados são o relatório do que NÃO saiu — sem
                    eles, "12 barradas" manda abrir o registro e garimpar. */}
                {massa.motivos.length > 0 && (
                  <div className="mt-1 text-[11px] text-muted-foreground" title={massa.motivos.map(([m, n]) => `${n}× ${m}`).join("\n")}>
                    {massa.motivos.slice(0, 2).map(([m, n]) => `${n}× ${m}`).join(" · ")}
                    {massa.motivos.length > 2 && ` · +${massa.motivos.length - 2} motivo(s)`}
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="font-semibold">{(filaResumo?.cobrancas ?? 0).toLocaleString("pt-BR")}</span>
                {" "}na fila da esteira, prontas para virar nota {" · "}{brl(filaResumo?.valor ?? 0)}
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {/* O contraste com a lista é o ponto: sem esta frase, quem vê
                      "1.004" numa tela que mostra 3.241 linhas acha que o Hub
                      perdeu algo. Não perdeu — a fila é mais estreita porque
                      exclui o que é do Asaas e quem não tem cadastro no Omie. */}
                  É a lista da esteira — só recebida, com cliente no Omie e sem nota do Asaas —,
                  e não o que está filtrado acima. Vai em levas de {CABEM_NUMA_CHAMADA},
                  esperando o Omie faturar entre uma e outra
                  {" · "}~{Math.max(1, Math.round(Math.ceil((filaResumo?.cobrancas ?? 0) / CABEM_NUMA_CHAMADA) * 2.5))}–
                  {Math.round(Math.ceil((filaResumo?.cobrancas ?? 0) / CABEM_NUMA_CHAMADA) * 4)} min, com esta aba aberta
                </div>
              </>
            )}
          </div>
          {massa && esperando === 0 && massa.blocosFeitos < massa.blocosTotal && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          {massa && massa.blocosFeitos < massa.blocosTotal ? (
            <button
              onClick={() => { pararMassa.current = true; }}
              className="ghost-btn flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs"
              title="Para depois da leva atual. O que já foi despachado não se desfaz."
            >
              <Square className="h-3.5 w-3.5" />
              Parar
            </button>
          ) : massa ? (
            <button onClick={() => setMassa(null)} className="ghost-btn rounded-md border border-border px-3 py-1.5 text-xs">
              Fechar
            </button>
          ) : (
            <button
              onClick={emitirEmMassa}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Layers className="h-3.5 w-3.5" />
              Emitir as {(filaResumo?.cobrancas ?? 0).toLocaleString("pt-BR")}
            </button>
          )}
        </div>
      )}

      {/* -------------------------------- lote --------------------------------- */}
      {sel.size > 0 && (
        <div className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border p-3",
          lote.confirmadas > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-primary/30 bg-primary/5",
        )}>
          <div className="flex-1 text-xs">
            <span className="font-semibold">{lote.emitiveis}</span> de {lote.selecionadas} selecionadas vão ser emitidas
            {" · "}{brl(lote.valor)}
            {/* O contraste é o ponto: quantas do lote saem ANTES de o dinheiro
                entrar. Sem este número, a barra diria a mesma frase para um lote
                inteiramente recebido e para um lote metade confirmado. */}
            {lote.confirmadas > 0 && (
              <span
                className="ml-2 font-medium text-amber-600 dark:text-amber-400"
                title="Pagamento autorizado cuja liquidação ainda não caiu na conta. Se não liquidar, a nota vira imposto sobre receita que não existiu."
              >
                <Zap className="mr-1 inline h-3 w-3" />
                {lote.confirmadas} ainda não liquidada{lote.confirmadas > 1 ? "s" : ""} · {brl(lote.valorConfirmadas)}
              </span>
            )}
            {lote.bloqueadas > 0 && (
              <span className="ml-2 text-muted-foreground" title={lote.motivos.map(([m, n]) => `${n}× ${m}`).join("\n")}>
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {lote.bloqueadas} fora do lote
              </span>
            )}
          </div>
          <button onClick={() => setSel(new Set())} className="ghost-btn rounded border border-border px-2 py-1 text-xs">
            Limpar
          </button>
          <button
            onClick={emitir}
            disabled={emitindo || lote.emitiveis === 0}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50",
              lote.confirmadas > 0
                ? "bg-amber-600 text-white hover:bg-amber-700"
                : "bg-primary text-primary-foreground",
            )}
          >
            {emitindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : lote.confirmadas > 0 ? <Zap className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {lote.confirmadas > 0 ? "Emitir avulsa no Omie" : "Emitir no Omie"}
          </button>
        </div>
      )}

      {/* -------------------------------- tabela ------------------------------- */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-muted/40">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="w-8 p-2">
                <button onClick={marcarEmitiveis} title="Marcar tudo que dá para emitir" className="ghost-icone rounded p-0.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              </th>
              <th className="p-2">Cliente</th>
              <th className="p-2">Cobrança</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2">Vencimento</th>
              <th className="p-2">Nota</th>
              <th className="p-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </td></tr>
            )}
            {!carregando && visiveis.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                Nenhuma cobrança neste recorte.
              </td></tr>
            )}
            {!carregando && visiveis.map((l) => {
              const s = SITUACOES[l.situacao];
              const bloqueio = motivoBloqueio(l, { avulsa });
              // Esta linha só está marcável porque a chave está ligada? É o que o
              // selo âmbar mais abaixo anuncia, e o que muda a cor da caixa.
              const soAvulsa = exigeAvulsa(l);
              return (
                <tr
                  key={l.id_asaas}
                  className={cn(
                    "border-b border-border/50 last:border-0 hover:bg-muted/30",
                    avulsa && soAvulsa && "bg-amber-500/[0.04]",
                  )}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={sel.has(l.id_asaas)}
                      onChange={() => alternar(l.id_asaas)}
                      disabled={!!bloqueio}
                      title={
                        bloqueio ??
                        (soAvulsa
                          ? "Selecionar para emitir como AVULSA — a cobrança ainda não liquidou."
                          : "Selecionar para emitir")
                      }
                      className={cn(
                        "h-3.5 w-3.5 disabled:opacity-30",
                        soAvulsa && !bloqueio
                          ? "accent-amber-600"
                          : "accent-[hsl(var(--primary))]",
                      )}
                    />
                  </td>
                  <td className="max-w-[220px] p-2">
                    <div className="truncate font-medium text-foreground">{l.cliente_asaas ?? "—"}</div>
                    <div className="num truncate text-[11px] text-muted-foreground">{formatarDoc(l.cnpj_cpf) || "sem documento"}</div>
                  </td>
                  <td className="max-w-[260px] p-2">
                    <div className="truncate text-muted-foreground" title={l.descricao ?? ""}>{l.descricao ?? "—"}</div>
                    {(() => {
                      const st = statusAsaas(l.status_asaas);
                      return (
                        <span
                          className={cn(
                            "mt-0.5 inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium",
                            TOM[st.tom],
                          )}
                          title={st.ajuda}
                        >
                          {st.rotulo}
                        </span>
                      );
                    })()}
                    {/* O SELO SÓ APARECE COM A CHAVE LIGADA, e isso é deliberado:
                        desligada, a confirmada já se explica pelo bloqueio do
                        hover da caixa, e um selo permanente viraria propaganda
                        de um atalho que quase nunca é a resposta certa. */}
                    {avulsa && soAvulsa && (
                      <span
                        className="ml-1 mt-0.5 inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                        title="Sai só como avulsa: o pagamento foi autorizado e a liquidação ainda não caiu na conta. A nota vai com a competência no vencimento."
                      >
                        <Zap className="h-2.5 w-2.5" />
                        avulsa
                      </span>
                    )}
                  </td>
                  <td className="num p-2 text-right">{brl(Number(l.valor))}</td>
                  {/* A linha entra no mês por pagamento OU por vencimento (o que
                      existir). Quando o vencimento cai FORA do mês selecionado —
                      cobrança paga adiantada, parcela lá na frente — mostrar só ele
                      faz a data parecer errada. Então a data que trouxe a linha
                      aparece junto. */}
                  <td className="num p-2">
                    {dataStr(l.data_vencimento)}
                    {l.data_pagamento && l.data_pagamento.slice(0, 7) !== (l.data_vencimento ?? "").slice(0, 7) && (
                      <div className="text-[10px] text-muted-foreground" title="Data em que o pagamento entrou — é ela que traz a linha para este mês">
                        pago {dataStr(l.data_pagamento)}
                      </div>
                    )}
                  </td>
                  {/* O NÚMERO É O LINK, e o link é o do Portal Nacional — não o do
                      XML. Os dois abrem a mesma nota, mas o XML é uma URL assinada
                      do CDN do Omie que morre em ~24h; a chave de acesso não morre
                      nunca. Por isso o endereço permanente ficou no número, que é
                      onde a pessoa clica, e o XML virou o ícone ao lado. */}
                  <td className="p-2">
                    {l.nfse_numero ? (
                      <span className="num flex items-center gap-1">
                        {(() => {
                          const portal = linkPortalNacional(l.nfse_chave);
                          if (!portal) return <span title="Nota sem chave de acesso gravada — sincronize com o Omie">{l.nfse_numero}</span>;
                          return (
                            <a
                              href={portal}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline-offset-2 hover:underline"
                              title={
                                `Abrir a NFS-e ${l.nfse_numero} no Portal Nacional da NFS-e.\n` +
                                `Chave: ${chaveEmBlocos(l.nfse_chave)}\n` +
                                "A chave já vai preenchida; o portal ainda pede o captcha."
                              }
                            >
                              {l.nfse_numero}
                            </a>
                          );
                        })()}
                        {xmlAindaVale(l.nfse_xml) && (
                          <a
                            href={l.nfse_xml!}
                            target="_blank"
                            rel="noreferrer"
                            title="XML da NFS-e (link do Omie — expira ~24h depois da última sincronização)"
                            className="text-muted-foreground hover:text-primary"
                          >
                            <FileCode2 className="h-3 w-3" />
                          </a>
                        )}
                      </span>
                    ) : l.nf_asaas_numero ? (
                      <span className="num text-muted-foreground" title="Nota emitida pelo Asaas">{l.nf_asaas_numero}</span>
                    ) : l.n_cod_os ? (
                      <span className="num text-[11px] text-muted-foreground" title="Ordem de serviço no Omie, ainda sem nota">
                        OS {l.n_cod_os}
                      </span>
                    ) : "—"}
                  </td>
                  {/* A situação e, embaixo, POR QUE. O rótulo sozinho ("NFS-e
                      rejeitada") manda abrir o Omie e procurar; o motivo — que o
                      Omie sempre mandou e o Hub descartava — diz o que consertar.
                      Curto na linha, inteiro no hover, que é a convenção daqui. */}
                  <td className="max-w-[220px] p-2">
                    <span
                      className={cn("inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px]", TOM[s.tom])}
                      title={s.ajuda}
                    >
                      {s.rotulo}
                    </span>
                    {motivoCurto(l.nfse_mensagem) && (
                      <div
                        className="mt-0.5 flex items-start gap-1 text-[10px] leading-tight text-muted-foreground"
                        title={l.nfse_mensagem ?? ""}
                      >
                        <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" />
                        <span className="line-clamp-2">{motivoCurto(l.nfse_mensagem)}</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!carregando && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" />
          <span>
            {visiveis.length.toLocaleString("pt-BR")} de {linhas.length.toLocaleString("pt-BR")} cobranças do mês.
            Emitir cria a Ordem de Serviço no Omie e a fatura — é isso que gera a NFS-e.
            O número da nota abre ela no Portal Nacional da NFS-e, com a chave de acesso já
            preenchida (o portal ainda pede o captcha); o ícone ao lado é o XML, e esse é um
            link do Omie que expira em cerca de 24h.
          </span>
        </p>
      )}
      </>
      )}
    </div>
  );
}
