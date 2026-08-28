// O rastro da emissão — o que o processo fez, quando, e por que não deu quando não deu.
//
// SÃO DOIS NÍVEIS, e misturá-los foi o que faltou o dia inteiro em que este módulo
// mentiu sobre uma nota que existia:
//
//   • a RODADA (`nf_execucoes`) responde "o que o processo das 10h fez hoje" — e é
//     gravada MESMO quando não faz nada. Um dia em que a fila veio vazia por defeito
//     e um dia sem nada a emitir são indistinguíveis se ninguém registra os dois.
//   • a COBRANÇA (`nf_emissoes`) responde "o que aconteceu com esta cobrança", com
//     hora, resultado e motivo. É append-only: a linha "em processamento" das 10h02
//     não é apagada quando às 10h05 nasce a nota — ganha uma linha 'ok' ao lado.
//     O rastro é a sequência, não o último estado.
//
// "Em processamento" tem tom próprio de propósito. Ele não é falha: é nota a
// caminho da prefeitura, e chamá-la de erro é o que faz alguém mandar emitir de
// novo — e nota duplicada não se apaga, cancela-se com prazo e justificativa.
//
// DUAS COISAS QUE A TELA PLANA FAZIA MAL, e que esta versão desfaz:
//
//   • `resultado='ok'` NÃO quer dizer "saiu nota" — quer dizer "este passo deu
//     certo". A OS criada é um passo. Lendo a coluna crua, ela vestia o selo
//     "Emitida" e a contagem do dia inflava: quatro emitidas para duas notas.
//     O desfecho da tela é derivado da ação junto com o resultado.
//   • sendo o diário append-only e por passo, uma cobrança que tropeçou três
//     vezes antes de sair rende cinco linhas soltas — e a história ficava para
//     o leitor remontar de cabeça. A linha da tela é o CLIENTE, no estado em
//     que a coisa parou; a sequência de passos fica um clique abaixo.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import {
  RefreshCw, Loader2, CheckCircle2, XCircle, Clock, FlaskConical,
  PlayCircle, CalendarClock, Info, Power, FileText, ChevronRight, ChevronDown, ShieldAlert, Mail,
  AlertTriangle, Building2,
} from "lucide-react";
import { linkPortalNacional, chaveEmBlocos } from "@/lib/notasFiscais";
import { CorrigirCadastro } from "@/components/notas/CorrigirCadastro";

const sb = supabase as any;

const brlStr = (n: number) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brl = (n: number) => comValorExato(n, brlStr(n));

/** "2026-08-20T20:15:12Z" → "20/08 17:15:12" no fuso de quem opera. */
const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).replace(",", "");

interface LinhaLog {
  criado_em: string; id_asaas: string; cliente: string; valor: number | null;
  acao: string; resultado: string; nfse_numero: string | null;
  /** A chave de acesso da nota do evento, quando ela nasceu. Ver `SeloNota`. */
  nfse_chave: string | null;
  motivo: string | null; operador: string | null; n_cod_os: number | null;
  /**
   * O passo saiu sob a régua larga da emissão AVULSA — que aceita cobrança
   * confirmada, ainda não liquidada, além da recebida.
   *
   * É a coluna que responde, meses depois, à pergunta que um contador faz: esta
   * nota saiu antes de o dinheiro entrar? O `motivo` da linha guarda junto o
   * status exato no instante do disparo, porque `asaas_cache` MUDA — a
   * confirmada de hoje é a recebida de amanhã, e perguntar depois não
   * reconstitui nada.
   */
  avulsa: boolean | null;
}

/* --------------------------- o selo da nota emitida --------------------------
 *
 * "NFS-e 16902" era um número para copiar e ir procurar. Com a chave de acesso
 * ele vira o endereço da nota no Portal Nacional — que é o único que não expira
 * (o link do XML é uma URL assinada do Omie e morre em ~24h).
 *
 * O selo continua sendo selo quando não há chave: nota antiga, ou OS ainda não
 * relida do Omie. Link que não leva a lugar nenhum seria pior do que o número.
 */
const SELO_NOTA =
  "num mr-1 inline-block rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400";

const SeloNota = ({ numero, chave }: { numero: string; chave: string | null }) => {
  const portal = linkPortalNacional(chave);
  if (!portal) return <span className={SELO_NOTA}>NFS-e {numero}</span>;
  return (
    <a
      href={portal}
      target="_blank"
      rel="noreferrer"
      // A linha do cliente abre/fecha no clique; sem isto, abrir a nota também
      // sanfonava a linha por baixo.
      onClick={(e) => e.stopPropagation()}
      className={cn(SELO_NOTA, "underline-offset-2 hover:underline")}
      title={
        `Abrir a NFS-e ${numero} no Portal Nacional da NFS-e.\n` +
        `Chave: ${chaveEmBlocos(chave)}\n` +
        "A chave já vai preenchida; o portal ainda pede o captcha."
      }
    >
      NFS-e {numero}
    </a>
  );
};

interface Execucao {
  id: string; iniciada_em: string; concluida_em: string | null;
  origem: string; modo: string; fila: number; emitidas: number; falhas: number; bloqueadas: number;
  pulada: string | null; lote: number | null; erro: string | null;
}

/* --------------------------- o desfecho de verdade ---------------------------
 *
 * `nf_emissoes.resultado` responde "este PASSO deu certo", não "saiu nota". A OS
 * criada às 17:07 é um passo — a nota só nasce no faturamento, e pode nascer
 * minutos depois ou nunca. Enquanto a tela lia a coluna crua, um `ok` de
 * `criar_os` vestia o selo verde "Emitida" e inflava a contagem de emitidas do
 * dia com passos intermediários: quatro selos verdes para duas notas.
 *
 * Por isso o desfecho é DERIVADO da ação junto com o resultado. Só faturamento
 * concluído vira "Emitida"; criar OS vira "Sem nota", que é o que ela é.
 */
type EstadoKey = "emitida" | "email" | "no_forno" | "travada" | "falhou" | "barrada" | "sem_nota" | "ensaio";

/* "NO FORNO" TEM PRAZO — e o prazo é a correção que faltava.
 *
 * A emissão tem dois tempos assíncronos e os dois são de MINUTOS: o lote fecha em
 * ~2min e o RPS vira nota autorizada em mais ~1min. Passadas horas, "está saindo"
 * deixou de ser uma leitura possível do mesmo dado — e era a leitura que a tela
 * continuava fazendo, em âmbar, para sempre. Em 26/08/26 havia 16 cobranças
 * (R$ 6.257) com o selo "No forno" desde a véspera; 15 tinham sido recusadas pelo
 * Omie no próprio faturamento, por endereço incompleto do cliente, e nenhuma delas
 * ia sair nunca.
 *
 * Quem descobre o motivo é o `omie-nfse-sync` (`fecharRecusadas`), que relê o
 * `detalhes[]` do lote e fecha a linha com a frase do Omie. Este prazo é a rede
 * embaixo: enquanto ninguém releu — porque o sync não rodou, porque o lote sumiu
 * da listagem —, o selo para de prometer. Errar para o lado de "confira isto" é
 * barato; errar para o lado de "está saindo" é a fila que ninguém revisita.
 */
const HORAS_NO_FORNO = 2;

const ESTADO: Record<EstadoKey, { rotulo: string; ajuda: string; tom: string; Icone: typeof CheckCircle2 }> = {
  emitida:  {
    rotulo: "Emitida", Icone: CheckCircle2,
    ajuda: "O faturamento concluiu e a NFS-e foi autorizada pela prefeitura.",
    tom: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  },
  /* "Disparado", e não "entregue" — a diferença não é preciosismo. O Omie não tem
     API de e-mail nenhuma: o que este selo afirma é que a OS foi gravada com o
     envio ligado e que a nota foi autorizada, que é o instante em que o ERP
     dispara. Se chegou na caixa do cliente, ninguém consegue provar por API. */
  email: {
    rotulo: "E-mail disparado", Icone: Mail,
    ajuda: "A OS foi criada com o envio ligado (cEnvLink) e a nota foi autorizada — é neste instante que o Omie manda o link ao cliente. Entrega não se confirma por API; o comprovante fica na aba \"Emails Enviados\" da OS.",
    tom: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400",
  },
  no_forno: {
    rotulo: "No forno", Icone: Clock,
    ajuda: "O lote foi disparado e a nota está a caminho da prefeitura. Não é falha — emitir de novo criaria a segunda nota do mesmo serviço.",
    tom: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  },
  /* Travada ≠ no forno, e a diferença é a única que importa nesta tela: no forno
     é esperar, travada é agir. O selo é vermelho porque a cobrança está recebida,
     a receita está registrada e a nota fiscal NÃO existe — e ninguém ia descobrir
     isso enquanto o rótulo dissesse que era só demora. */
  travada:  {
    rotulo: "Parou no forno", Icone: AlertTriangle,
    ajuda: `O lote foi disparado há mais de ${HORAS_NO_FORNO}h e nenhuma nota nasceu. Isso não é lentidão da prefeitura: a emissão morreu no meio. Na quase totalidade dos casos é cadastro do cliente no Omie (endereço sem número, e-mail em branco), que o lote recusa antes de virar RPS. Abra os passos — o "Atualizar do Omie" traz a frase do Omie para cá.`,
    tom: "bg-destructive/10 text-destructive border-destructive/20",
  },
  falhou:   {
    rotulo: "Falhou", Icone: XCircle,
    ajuda: "O Omie recusou o passo. Nenhuma nota saiu; o motivo está ao lado.",
    tom: "bg-destructive/10 text-destructive border-destructive/20",
  },
  /* Barrada ≠ falhou, e a diferença muda o que se faz depois: falhou é o Omie
     recusando (conserta-se o cadastro e tenta de novo); barrada é o Hub se
     recusando a mandar, porque a cobrança foi estornada ou o dinheiro ainda não
     entrou. Aí não há nada a consertar — ou a cobrança muda de estado, ou aquela
     nota não existe. */
  barrada:  {
    rotulo: "Barrada", Icone: ShieldAlert,
    ajuda: "O Hub se recusou a emitir e NADA foi mandado ao Omie: a cobrança estava estornada, não recebida, ou o Asaas não confirmou o estado dela na hora.",
    tom: "bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400",
  },
  sem_nota: {
    rotulo: "Sem nota", Icone: FileText,
    ajuda: "A Ordem de Serviço existe no Omie, mas deste passo não sai nota — quem emite é o faturamento.",
    tom: "bg-muted text-muted-foreground border-border",
  },
  ensaio:   {
    rotulo: "Ensaio", Icone: FlaskConical,
    ajuda: "Modo ensaio: o processo registrou o que TERIA emitido, sem tocar no Omie.",
    tom: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400",
  },
};

const desfechoDe = (l: LinhaLog, agora = Date.now()): EstadoKey => {
  // Antes do ensaio: em modo `previa` a porta continua valendo, e uma cobrança
  // barrada ali não é "teria emitido" — é "não emitiria nem se estivesse ligada".
  if (l.resultado === "bloqueado") return "barrada";
  if (l.acao === "previa") return "ensaio";
  // Antes do `ok` genérico: o passo do e-mail é um `ok` que NÃO é nota emitida, e
  // sem esta linha ele vestiria o selo verde e contaria como uma segunda nota.
  if (l.acao === "email") return "email";
  if (l.resultado === "erro") return "falhou";
  if (l.resultado === "em_processamento") {
    const horas = (agora - new Date(l.criado_em).getTime()) / 3.6e6;
    return horas >= HORAS_NO_FORNO ? "travada" : "no_forno";
  }
  if (l.acao === "criar_os") return "sem_nota";   // 'ok' aqui é a OS, não a nota
  return l.resultado === "ok" ? "emitida" : "sem_nota";
};

const ACAO: Record<string, string> = {
  criar_os: "OS criada",
  faturar: "Faturamento",
  criar_e_faturar: "Criar + faturar",
  previa: "Ensaio",
  email: "E-mail da nota",
};

const Selo = ({ e }: { e: EstadoKey }) => {
  const s = ESTADO[e];
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px]", s.tom)}
      title={s.ajuda}
    >
      <s.Icone className="h-3 w-3" />
      {s.rotulo}
    </span>
  );
};

/* ------------------------------ a cobrança inteira ---------------------------
 *
 * O diário é append-only e por passo: uma cobrança que tropeçou três vezes antes
 * de sair rende cinco linhas soltas, e a tela plana obrigava a remontar a
 * história na cabeça. Aqui a unidade da tela é o CLIENTE (com suas cobranças
 * dentro), e a sequência de passos fica um clique abaixo.
 */
interface Cobranca {
  id_asaas: string; n_cod_os: number | null; valor: number | null; eventos: LinhaLog[];
}
interface Grupo {
  chave: string; cliente: string; cobrancas: Cobranca[]; eventos: LinhaLog[];
  valor: number; estado: EstadoKey; nfse: { numero: string; chave: string | null }[]; ultimo: LinhaLog;
}

function agrupar(linhas: LinhaLog[]): Grupo[] {
  const porCliente = new Map<string, LinhaLog[]>();
  for (const l of linhas) {
    // Cliente sem nome (o join do Asaas não achou) não pode virar um balde só:
    // aí a chave volta a ser a cobrança, que é sempre dela mesma.
    const chave = l.cliente && l.cliente !== "—" ? `cli:${l.cliente}` : `cob:${l.id_asaas}`;
    const atual = porCliente.get(chave);
    if (atual) atual.push(l);
    else porCliente.set(chave, [l]);
  }

  const grupos: Grupo[] = [];
  for (const [chave, todos] of porCliente) {
    // Do mais antigo para o mais recente: o rastro é uma sequência, e sequência
    // se lê para a frente. A RPC entrega ao contrário, para a lista de fora.
    const eventos = [...todos].sort((a, b) => a.criado_em.localeCompare(b.criado_em));

    const porCobranca = new Map<string, LinhaLog[]>();
    for (const e of eventos) {
      const atual = porCobranca.get(e.id_asaas);
      if (atual) atual.push(e);
      else porCobranca.set(e.id_asaas, [e]);
    }
    const cobrancas: Cobranca[] = [...porCobranca].map(([id_asaas, evs]) => ({
      id_asaas,
      n_cod_os: evs.find((e) => e.n_cod_os != null)?.n_cod_os ?? null,
      valor: evs.find((e) => e.valor != null)?.valor ?? null,
      eventos: evs,
    }));

    /* O estado do grupo é o do evento MAIS RECENTE — com uma exceção que é a
     * regra do módulo: nota emitida gruda. Ela não se apaga, cancela-se com
     * prazo e justificativa; um passo posterior que falhe não devolve a
     * cobrança para "falta emitir". */
    const ultimo = eventos[eventos.length - 1];
    const temNota = eventos.some((e) => desfechoDe(e) === "emitida");
    const estado: EstadoKey = temNota ? "emitida" : desfechoDe(ultimo);

    /* Uma nota por número, e a PRIMEIRA chave não-nula que aparecer para ele: o
     * diário é append-only e o mesmo número reaparece em passos seguintes, nem
     * todos com a chave em mãos. Guardar a última sobrescreveria a chave boa
     * com o `null` de um passo posterior. */
    const notas = new Map<string, string | null>();
    for (const e of eventos) {
      if (!e.nfse_numero) continue;
      if (notas.get(e.nfse_numero) == null) notas.set(e.nfse_numero, e.nfse_chave ?? null);
    }

    grupos.push({
      chave,
      cliente: ultimo.cliente,
      cobrancas,
      eventos,
      valor: cobrancas.reduce((s, c) => s + Number(c.valor ?? 0), 0),
      estado,
      nfse: [...notas].map(([numero, chave]) => ({ numero, chave })),
      ultimo,
    });
  }
  return grupos.sort((a, b) => b.ultimo.criado_em.localeCompare(a.ultimo.criado_em));
}

/** Os três estados da emissão automática, do ponto de vista de quem decide. */
const MODOS: Record<string, { rotulo: string; ajuda: string; tom: string }> = {
  off: {
    rotulo: "Desligada",
    ajuda: "O cron roda e não emite nada. Só a emissão manual, pelo painel do mês.",
    tom: "border-border bg-muted text-muted-foreground",
  },
  previa: {
    rotulo: "Ensaio",
    ajuda: "O cron monta a fila e registra aqui o que TERIA emitido, sem tocar no Omie. É o modo para conferir um dia antes de liberar.",
    tom: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  on: {
    rotulo: "Emitindo",
    ajuda: "O cron emite de verdade, todo dia às 10h, respeitando o teto diário.",
    tom: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

interface Config {
  emissao_automatica: string; teto_dia: number; teto_rodada: number; data_corte: string | null;
  cadastro_auto: string | null;
}

/* Os três graus do conserto automático de cadastro.
 *
 * Nasce em "Só no Omie" e não em "Desligado" porque o gatilho já é a recusa: só
 * entra cliente cujo faturamento o Omie ou a prefeitura acabou de rejeitar por
 * endereço, e sobre esse cadastro o Hub tem, sim, o que dizer. O Asaas fica
 * opt-in por ser o cadastro que o CLIENTE vê na cobrança — corrigir lá evita a
 * recaída no mês seguinte, e é uma escrita de raio maior. */
const CADASTRO_AUTO: Record<string, { rotulo: string; ajuda: string; tom: string }> = {
  off: {
    rotulo: "Desligado",
    ajuda: "A recusa por endereço fica no Registro esperando alguém abrir o \"Corrigir cadastro\". Nada é escrito sozinho.",
    tom: "border-border bg-muted text-muted-foreground",
  },
  omie: {
    rotulo: "Só no Omie",
    ajuda: "Todo dia às 12h45, quinze minutos antes da emissão, o Hub busca na Receita o endereço de quem foi recusado e corrige o cadastro do Omie. A cobrança volta sozinha para a fila das 13h — ela nunca saiu de lá.",
    tom: "border-primary/30 bg-primary/10 text-primary",
  },
  omie_asaas: {
    rotulo: "Omie e Asaas",
    ajuda: "O mesmo, e também corrige o cadastro no Asaas — que é a ORIGEM do dado. Sem isso o mesmo cliente volta torto na próxima cobrança e o conserto vira rotina mensal. É o cadastro que o cliente vê na fatura.",
    tom: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
};

/* --------------------------- rodadas seguidas iguais -------------------------
 *
 * Junta rodadas CONSECUTIVAS que não fizeram nada pelo mesmo motivo, no mesmo
 * dia — "nada a emitir" às 10h00, 10h10, 10h20… é um fato só, contado sete
 * vezes. Rodada que emitiu, ou que deu erro, nunca entra num grupo: ela é a
 * única coisa ali que alguém precisa ler linha a linha.
 */
interface GrupoRodada { id: string; n: number; primeira: Execucao; ultima: Execucao }

const juntavel = (r: Execucao) => !r.erro && !!r.pulada;
const chaveRodada = (r: Execucao) =>
  [hora(r.iniciada_em).slice(0, 5), r.modo, r.origem, r.pulada].join("§");

function agruparRodadas(rodadas: Execucao[]): GrupoRodada[] {
  const grupos: GrupoRodada[] = [];
  // A lista vem da mais recente para a mais antiga: `ultima` é a que abre o
  // grupo e `primeira` vai recuando conforme as iguais vão sendo absorvidas.
  for (const r of rodadas) {
    const anterior = grupos[grupos.length - 1];
    if (anterior && juntavel(r) && juntavel(anterior.ultima) && chaveRodada(r) === chaveRodada(anterior.ultima)) {
      anterior.n += 1;
      anterior.primeira = r;
      continue;
    }
    grupos.push({ id: r.id, n: 1, primeira: r, ultima: r });
  }
  return grupos;
}

export default function NotasFiscaisLog() {
  const [linhas, setLinhas] = useState<LinhaLog[]>([]);
  const [rodadas, setRodadas] = useState<Execucao[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [salvandoModo, setSalvandoModo] = useState(false);
  const [dias, setDias] = useState(7);
  const [filtro, setFiltro] = useState<"todas" | EstadoKey>("todas");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [rodadasAbertas, setRodadasAbertas] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [log, exec, conf] = await Promise.all([
        sb.rpc("notas_fiscais_log", { p_dias: dias, p_limite: 400 }),
        sb.from("nf_execucoes").select("*").order("iniciada_em", { ascending: false }).limit(30),
        sb.from("nf_config").select("emissao_automatica, teto_dia, teto_rodada, data_corte, cadastro_auto").eq("id", 1).maybeSingle(),
      ]);
      if (log.error) throw log.error;
      if (exec.error) throw exec.error;
      setLinhas((log.data ?? []) as LinhaLog[]);
      setRodadas((exec.data ?? []) as Execucao[]);
      setCfg((conf.data ?? null) as Config | null);
    } catch (e: any) {
      toast.error("Não foi possível carregar o log.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  /* Ligar a emissão pede confirmação escrita; desligar, não.
     A assimetria é de propósito: ligar passa a emitir nota fiscal sem ninguém
     olhando, e nota emitida não se apaga — cancela-se, com prazo e justificativa.
     Desligar só faz o processo parar, e parar nunca é o erro caro. */
  const trocarModo = async (novo: string) => {
    if (novo === "on") {
      const ok = window.confirm(
        "Ligar a emissão automática?\n\n" +
        "A partir de agora o Hub vai emitir NFS-e sozinho, todo dia às 10h, sem ninguém conferir antes — " +
        `até ${cfg?.teto_dia ?? 120} notas por dia.\n\n` +
        "Nota emitida não se apaga: cancela-se, com prazo e justificativa. " +
        "O recomendado é rodar um dia em Ensaio e conferir o registro antes de ligar.",
      );
      if (!ok) return;
    }
    setSalvandoModo(true);
    try {
      const { error } = await sb.from("nf_config").update({ emissao_automatica: novo }).eq("id", 1);
      if (error) throw error;
      setCfg((c) => (c ? { ...c, emissao_automatica: novo } : c));
      toast.success(`Emissão automática: ${MODOS[novo]?.rotulo ?? novo}.`);
    } catch (e: any) {
      toast.error("Não foi possível mudar o modo.", { description: e?.message });
    } finally {
      setSalvandoModo(false);
    }
  };

  /* Ligar o Asaas pede confirmação; o resto, não. Mesma assimetria da emissão:
     o cadastro do Asaas é o que o CLIENTE vê na fatura, e escrever nele sozinho
     é raio maior do que corrigir o ERP. Desligar nunca é o erro caro. */
  const trocarCadastroAuto = async (novo: string) => {
    if (novo === "omie_asaas" && !window.confirm(
      "Corrigir também o cadastro no Asaas?\n\n" +
      "O endereço da Receita passa a ser escrito também no cliente do Asaas, sozinho, " +
      "sempre que uma emissão for recusada por endereço. É o cadastro que o cliente vê na fatura.\n\n" +
      "A favor: sem isso o mesmo cliente volta torto na próxima cobrança.",
    )) return;
    setSalvandoModo(true);
    try {
      const { error } = await sb.from("nf_config").update({ cadastro_auto: novo }).eq("id", 1);
      if (error) throw error;
      setCfg((c) => (c ? { ...c, cadastro_auto: novo } : c));
      toast.success(`Conserto do cadastro: ${CADASTRO_AUTO[novo]?.rotulo ?? novo}.`);
    } catch (e: any) {
      toast.error("Não foi possível mudar o modo.", { description: e?.message });
    } finally {
      setSalvandoModo(false);
    }
  };

  useEffect(() => { void carregar(); }, [carregar]);

  /* Rodar agora é o MESMO caminho do cron, não um atalho paralelo — se fosse
     outro, o que se testa aqui não seria o que roda de madrugada. */
  const rodarAgora = async () => {
    setRodando(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "emitir_dia" } });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      if (data?.pulada) toast.info("A rodada não emitiu.", { description: data.pulada, duration: 10000 });
      else toast.success(`${data?.emitidas ?? 0} cobrança(s) mandadas para o lote ${data?.lote ?? "?"}.`);
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao rodar.", { description: e?.message });
    } finally {
      setRodando(false);
    }
  };

  /* Conferir no Omie é o MESMO `espelhar` do botão do cabeçalho — é ele quem relê
     o `detalhes[]` do lote e fecha no diário a linha que o Omie recusou. Está
     repetido aqui porque a faixa é o lugar onde a pessoa descobre o problema, e
     mandá-la procurar o botão lá em cima é onde a correção se perde. */
  const [conferindo, setConferindo] = useState(false);
  /* As cobranças que o diálogo de cadastro vai diagnosticar. Vazio = fechado.
     Guardar os IDS (e não o grupo) é o que permite abrir o mesmo diálogo da
     faixa (a leva inteira) e de uma linha só, sem dois caminhos de código. */
  const [aCorrigir, setACorrigir] = useState<string[]>([]);
  const conferirNoOmie = async () => {
    setConferindo(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "espelhar" } });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      const f = Number(data?.recusas?.fechadas ?? 0);
      toast.success(
        f ? `${f} emissão(ões) fechada(s) com o motivo do Omie.` : "Nada novo a fechar.",
        { description: `${data?.status_lidos ?? 0} status conferidos no Omie.` },
      );
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao conferir no Omie.", { description: e?.message });
    } finally {
      setConferindo(false);
    }
  };

  const grupos = useMemo(() => agrupar(linhas), [linhas]);
  /* O que parou. `travada` já é o estado do grupo (ver `desfechoDe`); aqui só se
     conta e se soma, porque "16 clientes" sem o valor não dimensiona nada. */
  const travadas = useMemo(() => grupos.filter((g) => g.estado === "travada"), [grupos]);
  const valorTravado = travadas.reduce((s, g) => s + g.valor, 0);
  // Quantas ainda estão com "em processamento" como última palavra — essas são as
  // que precisam de uma leitura do Omie para ganhar motivo.
  const semMotivo = travadas.filter((g) => g.ultimo.resultado === "em_processamento").length;
  const ultima = rodadas[0] ?? null;
  const gruposRodada = useMemo(() => agruparRodadas(rodadas), [rodadas]);
  const visiveis = filtro === "todas" ? grupos : grupos.filter((g) => g.estado === filtro);

  const alternar = (chave: string) =>
    setAbertos((s) => {
      const novo = new Set(s);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });

  const tudoAberto = visiveis.length > 0 && visiveis.every((g) => abertos.has(g.chave));

  const modo = cfg?.emissao_automatica ?? "previa";
  const m = MODOS[modo] ?? MODOS.previa;
  const modoCad = cfg?.cadastro_auto ?? "omie";

  return (
    <div className="space-y-4">
      {/* --------------------------- a chave geral --------------------------- */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[240px] flex-1">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Power className="h-3.5 w-3.5" /> Emissão automática
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", m.tom)}>{m.rotulo}</span>
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{m.ajuda}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Roda todo dia às <strong className="text-foreground">10h</strong> (depois da carga do Asaas),
              até <span className="num">{cfg?.teto_rodada ?? 20}</span> por vez e{" "}
              <span className="num">{cfg?.teto_dia ?? 120}</span> por dia.
              {cfg?.data_corte && (
                <> A fila só considera cobranças a partir do corte,{" "}
                  <span className="num">{cfg.data_corte.split("-").reverse().join("/")}</span>.</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(["off", "previa", "on"] as const).map((k) => (
              <button
                key={k}
                onClick={() => trocarModo(k)}
                disabled={salvandoModo || modo === k}
                className={cn(
                  "rounded border px-2.5 py-1 text-[11px] font-medium disabled:cursor-default",
                  modo === k ? MODOS[k].tom : "border-border text-muted-foreground hover:bg-muted",
                )}
                title={MODOS[k].ajuda}
              >
                {MODOS[k].rotulo}
              </button>
            ))}
          </div>
        </div>

        {/* --------------------- o conserto que vem antes ---------------------
            Segunda chave, e não outra caixa, porque é a mesma esteira: às 12h45
            UTC o Hub arruma o cadastro; às 13h ele emite. Quase toda emissão que
            morre morre por endereço do cliente, e esperar alguém reparar foi o
            desenho que produziu 12h de silêncio sobre R$ 6.257. */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-[240px] flex-1">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Building2 className="h-3.5 w-3.5" /> Conserto do cadastro
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", CADASTRO_AUTO[modoCad]?.tom)}>
                {CADASTRO_AUTO[modoCad]?.rotulo}
              </span>
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {CADASTRO_AUTO[modoCad]?.ajuda}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Entra só quem a última tentativa de faturamento recusou por endereço, o endereço vem da{" "}
              <strong className="text-foreground">Receita</strong> (ou do CEP), e o mesmo cliente não é
              reescrito duas vezes pela mesma recusa — três tentativas encerram e a linha fica para
              conferência humana.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(["off", "omie", "omie_asaas"] as const).map((k) => (
              <button
                key={k}
                onClick={() => trocarCadastroAuto(k)}
                disabled={salvandoModo || modoCad === k}
                className={cn(
                  "rounded border px-2.5 py-1 text-[11px] font-medium disabled:cursor-default",
                  modoCad === k ? CADASTRO_AUTO[k].tom : "border-border text-muted-foreground hover:bg-muted",
                )}
                title={CADASTRO_AUTO[k].ajuda}
              >
                {CADASTRO_AUTO[k].rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------ rodadas ------------------------------
          O cron bate de 10 em 10 minutos e quase toda rodada não tem nada a
          emitir — sete linhas iguais dizendo "nada a emitir" tomavam meia tela
          para contar um fato só. Fechada, a barra é uma linha com a última
          rodada; aberta, as rodadas seguidas de mesmo desfecho vêm juntas numa
          linha só, com a faixa de horário. A rodada que fez alguma coisa tem
          texto próprio e por isso nunca é engolida por um grupo. */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            onClick={() => setRodadasAbertas((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title={rodadasAbertas ? "Recolher" : "Ver todas as rodadas"}
          >
            {rodadasAbertas
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-xs font-semibold text-foreground">Rodadas</span>
            {ultima && (
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                <span className="num">{hora(ultima.iniciada_em)}</span>
                {" · "}
                {ultima.erro
                  ? <span className="text-destructive">{ultima.erro}</span>
                  : ultima.pulada ?? `fila ${ultima.fila} · ${ultima.emitidas} no lote${ultima.lote ? ` ${ultima.lote}` : ""}`}
              </span>
            )}
            {!ultima && !carregando && (
              <span className="text-[11px] text-muted-foreground">nenhuma rodada registrada ainda.</span>
            )}
            {rodadas.length > 1 && !rodadasAbertas && (
              <span className="num shrink-0 text-[10px] text-muted-foreground" title={`mais ${rodadas.length - 1} rodada(s) registrada(s)`}>
                +{rodadas.length - 1}
              </span>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={rodarAgora}
              disabled={rodando}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
              title="Executa agora exatamente o que o cron executa às 10h"
            >
              {rodando ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
              Rodar agora
            </button>
            <button onClick={carregar} className="ghost-icone rounded p-1" title="Atualizar">
              <RefreshCw className={cn("h-3.5 w-3.5", carregando && "animate-spin")} />
            </button>
          </div>
        </div>

        {rodadasAbertas && gruposRodada.length > 0 && (
          <div className="max-h-56 space-y-1 overflow-y-auto border-t border-border px-3 py-2">
            {gruposRodada.map((g) => {
              const r = g.ultima;
              return (
                <div key={r.id} className="flex items-start gap-2 rounded border border-border/50 px-2 py-1.5 text-[11px]">
                  <span className="num shrink-0 text-muted-foreground">
                    {g.n > 1 ? `${hora(g.primeira.iniciada_em)} → ${hora(r.iniciada_em).slice(6)}` : hora(r.iniciada_em)}
                  </span>
                  <span className={cn(
                    "shrink-0 rounded border px-1.5 text-[10px]",
                    r.modo === "on" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : r.modo === "previa" ? "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : "border-border bg-muted text-muted-foreground",
                  )}>
                    {r.modo === "on" ? "emitindo" : r.modo === "previa" ? "ensaio" : "desligada"}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{r.origem}</span>
                  {g.n > 1 && (
                    <span className="num shrink-0 rounded border border-border bg-muted px-1.5 text-[10px] text-muted-foreground">
                      {g.n}×
                    </span>
                  )}
                  <span className="flex-1">
                    {r.erro ? (
                      <span className="text-destructive">{r.erro}</span>
                    ) : r.pulada ? (
                      <span className="text-muted-foreground">{r.pulada}</span>
                    ) : (
                      <>
                        fila {r.fila} · <strong className="text-foreground">{r.emitidas}</strong> no lote
                        {r.lote ? ` ${r.lote}` : ""}
                        {r.bloqueadas > 0 && (
                          <span
                            className="text-orange-600 dark:text-orange-400"
                            title="Cobranças que a conferência com o Asaas recusou: estornadas, não recebidas, ou sem resposta do Asaas na hora. Nada foi mandado ao Omie por elas."
                          > · {r.bloqueadas} barrada(s)</span>
                        )}
                        {r.falhas > 0 && <span className="text-destructive"> · {r.falhas} falha(s)</span>}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------- o que parou e ninguém viu ----------------------
          A sinalização por FILTRO não é sinalização: quem não desconfia não
          clica em "Parou no forno", e o que trava aqui é receita já recebida sem
          nota fiscal. Esta faixa só existe quando existe o problema, e diz as
          três coisas que decidem o que fazer: quantas, quanto, e se o motivo já
          foi lido do Omie ou ainda precisa ser buscado. */}
      {travadas.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-[260px] flex-1 space-y-1">
              <p className="text-xs font-semibold text-destructive">
                {travadas.length} {travadas.length === 1 ? "cliente parou" : "clientes pararam"} no meio da emissão
                {" · "}{brl(valorTravado)} recebidos sem nota
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                O lote foi disparado há mais de {HORAS_NO_FORNO}h e a nota não nasceu. Isso não se resolve
                esperando: o Omie recusa o faturamento antes de virar RPS quando o cadastro do cliente está
                incompleto — endereço sem número, e-mail em branco — e a prefeitura recusa o RPS quando o
                CEP não bate com o município.{" "}
                {semMotivo > 0
                  ? <><strong className="text-foreground">{semMotivo}</strong> {semMotivo === 1 ? "ainda está" : "ainda estão"} sem o motivo lido do Omie — "Conferir no Omie" busca a frase do lote e a grava aqui.</>
                  : "O motivo de cada uma está na coluna ao lado."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {/* O conserto no mesmo lugar onde o problema aparece. Quase toda
                  emissão que para aqui para por cadastro do cliente, e mandar a
                  pessoa para o Omie é onde o conserto se perdia. */}
              <button
                onClick={() => setACorrigir(travadas.flatMap((g) => g.cobrancas.map((c) => c.id_asaas)))}
                className="flex items-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/20"
              >
                <Building2 className="h-3 w-3" />
                Corrigir cadastro e reemitir
              </button>
              <button
                onClick={() => setFiltro("travada")}
                className="rounded border border-destructive/30 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
              >
                Ver as {travadas.length}
              </button>
              <button
                onClick={conferirNoOmie}
                disabled={conferindo}
                className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              >
                {conferindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Conferir no Omie
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------- filtros ------------------------------
          A contagem é de CLIENTE, não de linha do diário: "Emitida 2" são duas
          notas na rua. Contar linhas era o que fazia dois clientes virarem
          quatro emitidas, somando o passo da OS ao faturamento que a emitiu. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(["todas", "emitida", "no_forno", "travada", "falhou", "barrada", "sem_nota", "ensaio"] as const).map((f) => {
          const n = f === "todas" ? grupos.length : grupos.filter((g) => g.estado === f).length;
          // Os estados de canto só aparecem quando existem — barra curta dia
          // normal, completa no dia em que algo ficou pelo caminho.
          if (n === 0 && (f === "sem_nota" || f === "ensaio" || f === "barrada" || f === "travada")) return null;
          return (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              title={f === "todas" ? "Todos os clientes com movimento no recorte" : ESTADO[f].ajuda}
              className={cn(
                "rounded border px-2 py-1 text-[11px]",
                filtro === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f === "todas" ? "Tudo" : ESTADO[f].rotulo}
              <span className="ml-1 opacity-60">{n}</span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setAbertos(tudoAberto ? new Set() : new Set(visiveis.map((g) => g.chave)))}
            className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            {tudoAberto ? "Recolher tudo" : "Abrir tudo"}
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={cn(
                "rounded border px-2 py-1 text-[11px]",
                dias === d ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {d === 1 ? "hoje" : `${d} dias`}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------- o rastro ----------------------------- */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-muted/40">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="p-2">Última ação</th>
              <th className="p-2">Cliente</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2">Passos</th>
              <th className="p-2">Como está</th>
              <th className="p-2">Nota / motivo</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </td></tr>
            )}
            {!carregando && visiveis.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                Nenhum registro neste recorte.
              </td></tr>
            )}
            {!carregando && visiveis.map((g) => {
              const aberto = abertos.has(g.chave);
              const varias = g.cobrancas.length > 1;
              return (
                <Fragment key={g.chave}>
                  {/* ---- o cliente: onde a cobrança PAROU, não o último passo ---- */}
                  <tr
                    onClick={() => alternar(g.chave)}
                    className={cn(
                      "cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/30",
                      aberto && "bg-muted/20",
                    )}
                  >
                    <td className="num whitespace-nowrap p-2 align-top text-muted-foreground">
                      {hora(g.ultimo.criado_em)}
                    </td>
                    <td className="max-w-[220px] p-2 align-top">
                      <div className="flex items-start gap-1">
                        {aberto
                          ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{g.cliente}</div>
                          <div className="num truncate text-[10px] text-muted-foreground" title={g.cobrancas.map((c) => c.id_asaas).join(", ")}>
                            {varias
                              ? `${g.cobrancas.length} cobranças`
                              : g.cobrancas[0].n_cod_os ? `OS ${g.cobrancas[0].n_cod_os}` : g.cobrancas[0].id_asaas}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num p-2 text-right align-top">{g.valor ? brl(g.valor) : "—"}</td>
                    <td className="whitespace-nowrap p-2 align-top text-muted-foreground">
                      {g.eventos.length} {g.eventos.length === 1 ? "passo" : "passos"}
                    </td>
                    <td className="p-2 align-top">
                      <Selo e={g.estado} />
                      {/* Cadastro é a causa da quase totalidade do que para aqui.
                          O atalho fica na linha porque é onde a pessoa está
                          olhando quando entende que aquela nota não vai sair. */}
                      {(g.estado === "travada" || g.estado === "falhou") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setACorrigir(g.cobrancas.map((c) => c.id_asaas)); }}
                          className="mt-1 block whitespace-nowrap rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                          title="Ver o cadastro deste cliente no Omie, no Asaas e na Receita — e corrigir sem sair do Hub."
                        >
                          Corrigir cadastro
                        </button>
                      )}
                    </td>
                    <td className="max-w-[380px] p-2 align-top">
                      {g.nfse.map((n) => <SeloNota key={n.numero} numero={n.numero} chave={n.chave} />)}
                      {/* O e-mail ao lado do número da nota. "O cliente recebeu?"
                          é justamente a pergunta que fazia abrir o Omie — e ela
                          se responde aqui, sem precisar expandir os passos.
                          Ícone, não selo: o desfecho da linha continua sendo a
                          nota; o envio é uma nota de rodapé dela. */}
                      {(() => {
                        const enviados = g.eventos.filter((e) => e.acao === "email");
                        if (!enviados.length) return null;
                        return (
                          <span
                            className="ml-1 inline-flex items-center gap-0.5 align-middle text-[11px] text-violet-600 dark:text-violet-400"
                            title={enviados.map((e) => e.motivo).filter(Boolean).join(" · ")
                              || "O Omie disparou o e-mail com o link da nota."}
                          >
                            <Mail className="h-3 w-3" />
                            {enviados.length > 1 ? enviados.length : null}
                          </span>
                        );
                      })()}
                      {/* Fechado, vale o motivo do passo mais recente: é ele que
                          diz o que falta fazer agora. O resto está um clique abaixo. */}
                      {!aberto && g.ultimo.motivo && (
                        <span className="text-[11px] leading-tight text-muted-foreground" title={g.ultimo.motivo}>
                          <span className="line-clamp-2">{g.ultimo.motivo}</span>
                        </span>
                      )}
                      {g.nfse.length === 0 && (aberto || !g.ultimo.motivo) && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>

                  {/* ---- os passos, do primeiro ao último ---- */}
                  {aberto && g.cobrancas.map((c) => (
                    <Fragment key={c.id_asaas}>
                      {varias && (
                        <tr className="border-b border-border/50 bg-muted/30">
                          <td colSpan={6} className="px-2 py-1 text-[10px] text-muted-foreground">
                            <span className="num">{c.n_cod_os ? `OS ${c.n_cod_os}` : c.id_asaas}</span>
                            {c.valor != null && <> · {brl(Number(c.valor))}</>}
                            {c.n_cod_os && <span className="num"> · {c.id_asaas}</span>}
                          </td>
                        </tr>
                      )}
                      {c.eventos.map((l, i) => {
                        const d = desfechoDe(l);
                        return (
                          <tr
                            key={`${l.id_asaas}-${l.criado_em}-${i}`}
                            className="border-b border-border/50 bg-muted/10 last:border-0 hover:bg-muted/30"
                          >
                            <td className="num whitespace-nowrap p-2 pl-6 align-top text-muted-foreground">{hora(l.criado_em)}</td>
                            {/* Debaixo do cliente, quem mandou o passo — quando o
                                registro sabe. Emissão pelo painel guarda o usuário,
                                não o operador, e inventar "automático" aqui seria
                                atribuir ao cron o que alguém fez à mão. */}
                            <td className="max-w-[220px] p-2 align-top">
                              {l.operador && (
                                <span className="block truncate text-[10px] text-muted-foreground" title={l.operador}>
                                  {l.operador}
                                </span>
                              )}
                            </td>
                            <td className="num p-2 text-right align-top">{l.valor != null ? brl(Number(l.valor)) : "—"}</td>
                            {/* A ação diz o que foi feito no Omie; o selo âmbar,
                                sob que régua. São coisas diferentes e por isso
                                convivem na mesma célula: "criar e faturar" é o
                                mesmo passo na rodada e na avulsa. */}
                            <td className="whitespace-nowrap p-2 align-top text-muted-foreground">
                              {ACAO[l.acao] ?? l.acao}
                              {l.avulsa && (
                                <span
                                  className="ml-1 inline-block rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400"
                                  title="Emissão avulsa: a régua larga, que aceita cobrança confirmada e ainda não liquidada. O status no instante do disparo está no motivo, ao lado."
                                >
                                  avulsa
                                </span>
                              )}
                            </td>
                            <td className="p-2 align-top"><Selo e={d} /></td>
                            {/* O número quando saiu; o motivo quando não saiu. Nunca os dois
                                vazios — linha sem explicação é o que obriga a abrir o Omie. */}
                            <td className="max-w-[380px] p-2 align-top">
                              {l.nfse_numero && <SeloNota numero={l.nfse_numero} chave={l.nfse_chave} />}
                              {l.motivo && (
                                <span className="text-[11px] leading-tight text-muted-foreground" title={l.motivo}>
                                  <span className="line-clamp-2">{l.motivo}</span>
                                </span>
                              )}
                              {!l.nfse_numero && !l.motivo && <span className="text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-px h-3 w-3 shrink-0" />
        Cada linha é um cliente, e a contagem lá em cima é de cliente: "Emitida 2" são duas notas
        na rua. Abra para ver os passos, do primeiro ao último — o registro é append-only, então a
        linha "no forno" continua ali depois que a nota nasce, com a linha da nota embaixo. "OS
        criada" é passo, não nota: quem emite é o faturamento. E "no forno" não é falha — é nota a
        caminho da prefeitura, e emitir de novo criaria a segunda nota do mesmo serviço.
      </p>

      <CorrigirCadastro
        ids={aCorrigir}
        aberto={aCorrigir.length > 0}
        onFechar={() => setACorrigir([])}
        onFeito={carregar}
      />
    </div>
  );
}
