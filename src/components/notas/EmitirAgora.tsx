/* ---------------------------------------------------------------------------
 * EMITIR AGORA — a corrente inteira, num clique, até o número da nota.
 *
 * O PEDIDO QUE ORIGINOU ISTO (Henrique, 11/09/2026): "a partir do momento que eu
 * falar que eu quero emitir aquela nota, você tem que fazer tudo para que aquela
 * nota seja emitida. Antes de chegar para mim um erro, você tem que me garantir
 * que já atentou a tudo. Senão não é automação."
 *
 * A REGRA DESTE ARQUIVO, e ela vale linha a linha: só sobe para a pessoa o que
 * sobrar de três filtros — (1) o Hub tentou e não conseguiu, (2) falta uma
 * informação que só ela tem, (3) seguir seria arriscar errar de um jeito que não
 * se desfaz. Tudo o mais é espera, retentativa ou trabalho, e espera não é
 * pergunta. Quando algo ASSIM MESMO chega até ela, chega dizendo o que já foi
 * tentado — senão "não deu" se lê como "ninguém tentou".
 *
 * POR QUE A ORQUESTRAÇÃO MORA NO NAVEGADOR e não numa Edge Function: a corrente
 * inteira não cabe nos 150s do worker. Só o cadastro custa até 40s, a emissão de
 * uma cobrança ~40-90s, e a nota nasce 2-3 MINUTOS depois do lote.
 *
 * E ELA É UMA TAREFA EM SEGUNDO PLANO (18/09/2026), não um diálogo. Até aqui a
 * corrente vivia dentro do componente: fechar a janela ou era proibido, ou — pelo
 * "Fechar e deixar rodando" — desligava o laço, e a nota da cobrança ficava sem
 * sair. Agora quem conduz é `lib/segundo-plano`; a janela é só uma vista sobre
 * ela, e fechá-la não para nada. Ver `iniciarEmissao`.
 * ------------------------------------------------------------------------- */

import { supabase } from "@/integrations/supabase/client";
import {
  BLOQUEIOS_CADASTRO, formatarDoc, precisaEsperarOLote, esperaAntesDeRepetir,
} from "@/lib/notasFiscais";
import { iniciarTarefa, type Contexto, type Desfecho, type ParaVoce, type Tarefa } from "@/lib/segundo-plano";

export type { ParaVoce } from "@/lib/segundo-plano";

const sb = supabase as any;
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* OS DEGRAUS. São fixos e sempre visíveis, inclusive os que ainda não
 * aconteceram: "parou no passo 3 de 5" é uma informação diferente de "falhou". */
export const PASSOS_EMISSAO = [
  { id: "destravar", titulo: "Ordem de serviço recusada, aposentada" },
  { id: "cadastro", titulo: "Cadastro do tomador no Omie" },
  { id: "emissao", titulo: "Ordem de serviço e faturamento" },
  { id: "nota", titulo: "NFS-e autorizada pela prefeitura" },
  { id: "espelho", titulo: "Número gravado no Hub" },
] as const;

/* Quanto tempo esperar a prefeitura antes de desistir de OLHAR (a nota continua
 * a caminho de qualquer jeito). Medido: o lote fecha em ~2min e o RPS vira '004'
 * ~1min depois. */
const ESPERA_NOTA_MS = 5 * 60_000;
const INTERVALO_NOTA_MS = 20_000;

/** A nota que não nasce de cobrança — ver `NotaSemCobranca`. */
export interface EmissaoSemCobranca {
  /** O carimbo `avl_…`, que faz o papel do id da cobrança em toda a corrente. */
  id: string;
  nome: string;
  doc: string;
  valor: number;
}

export interface ParamsEmissao {
  ids: string[];
  /** Nome e valor de cada cobrança, lidos de quem pediu — a lista do mês não
      tem a cobrança de outro mês, e a janela mostrava "pay_… · R$ 0,00". */
  cobrancas: Array<{ id_asaas: string; nome: string | null; valor: number }>;
  observacao?: string | null;
  /** A régua larga: a CONFIRMADA passa. Estorno e cobrança excluída barram sempre. */
  avulsa?: boolean;
  /** OS faturadas com NFS-e recusada, a aposentar antes (`nfse_status = '003'`). */
  osRecusadas?: number[];
  /** O que a prefeitura recusou na OS velha, em português — vira a instrução. */
  motivoRecusa?: string | null;
  semCobranca?: EmissaoSemCobranca | null;
}

/** O rótulo da tarefa — o que aparece no cabeçalho e no toast. */
export function rotuloEmissao(p: Pick<ParamsEmissao, "ids" | "cobrancas" | "semCobranca">) {
  if (p.semCobranca) {
    return {
      titulo: `Nota sem cobrança · ${p.semCobranca.nome}`,
      subtitulo: `${formatarDoc(p.semCobranca.doc)} · ${brl(p.semCobranca.valor)}`,
    };
  }
  const total = p.cobrancas.reduce((s, c) => s + Number(c.valor || 0), 0);
  if (p.ids.length === 1) {
    const c = p.cobrancas.find((x) => x.id_asaas === p.ids[0]);
    return { titulo: `Emitir nota · ${c?.nome ?? p.ids[0]}`, subtitulo: `${p.ids[0]} · ${brl(total)}` };
  }
  return { titulo: `Emitir ${p.ids.length} notas`, subtitulo: `${p.ids.length} cobranças · ${brl(total)}` };
}

/**
 * Começa a emissão em segundo plano e devolve o id da tarefa. Chamar de novo com
 * as mesmas cobranças enquanto ela roda devolve a MESMA tarefa — dois cliques
 * não viram duas rodadas sobre as mesmas notas.
 */
export function iniciarEmissao(p: ParamsEmissao, aoTerminar?: (t: Tarefa) => void): string {
  return iniciarTarefa(
    { chave: `emitir:${[...p.ids].sort().join(",")}`, ...rotuloEmissao(p), passos: [...PASSOS_EMISSAO] },
    (ctx) => correrEmissao(p, ctx),
    { aoTerminar },
  );
}

/**
 * A corrente, sobre um contexto de tarefa. Exportada porque o refazer a usa
 * dentro da própria tarefa, depois do cancelamento: um só andamento, do começo
 * ao número da nota nova.
 */
export async function correrEmissao(p: ParamsEmissao, ctx: Contexto): Promise<Desfecho> {
  const { ids, observacao, avulsa, osRecusadas, semCobranca } = p;
  const pendencias: ParaVoce[] = [];
  const nomeDe = (id: string) =>
    (semCobranca && semCobranca.id === id ? semCobranca.nome : null)
    ?? p.cobrancas.find((c) => c.id_asaas === id)?.nome ?? id;
  const marcar = ctx.passo;
  const fim = (): Desfecho => {
    ctx.atualizar({ paraVoce: pendencias });
    return {};
  };

  /* ---------------- PASSO 0 — a OS recusada que segura a cobrança ---------------- */
  const alvo = (osRecusadas ?? []).filter((n) => Number(n) > 0);
  if (!alvo.length) {
    marcar("destravar", "pulado", "Nenhuma OS recusada segurando estas cobranças.");
  } else {
    marcar("destravar", "correndo", `Soltando ${alvo.length} ordem(ns) de serviço recusada(s)…`);
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
        body: { action: "devolver_a_esteira", dias: 180, limite: Math.max(alvo.length, 1), ids: alvo },
      });
      if (error || data?.erro) throw new Error(error?.message ?? data?.erro);
      if (Number(data?.devolvidas ?? 0) > 0) {
        marcar("destravar", "ok", `${data.devolvidas} OS aposentada(s) — a cobrança voltou a poder virar nota.`);
      } else if (Number(data?.com_carimbo_impossivel ?? 0) > 0) {
        marcar("destravar", "atencao", "A OS recusada tem o carimbo desta cobrança preso no Omie.");
        pendencias.push({
          id_asaas: ids[0] ?? null, nome: nomeDe(ids[0] ?? ""),
          titulo: "O carimbo desta cobrança ficou preso numa OS recusada",
          oQueFazer:
            "O Omie não libera o `cCodIntOS` de uma OS faturada por API, e sem ele uma OS nova não pode " +
            "carregar o carimbo desta cobrança. Esta nota sai pelo botão \"Reenviar NFS-e\" na tela do Omie, " +
            "depois de corrigir o que a prefeitura recusou.",
          tentado: ["aposentar a OS recusada (o Omie não libera o carimbo de OS faturada)"],
        });
        marcar("cadastro", "espera", "A OS recusada ainda está segurando a cobrança.");
        return fim();
      } else {
        marcar("destravar", "atencao", "Nenhuma OS pôde ser aposentada.");
        pendencias.push({
          id_asaas: ids[0] ?? null, nome: nomeDe(ids[0] ?? ""),
          titulo: "A nota anterior foi recusada e o cadastro ainda não foi corrigido",
          oQueFazer:
            `${p.motivoRecusa ?? "A prefeitura recusou o RPS"}. ` +
            "Enquanto o cadastro não for corrigido, soltar esta OS só produziria outra " +
            "com a mesma recusa. Use \"Consertar cadastro\" na aba Recusas a tratar e depois emita de novo.",
          tentado: ["aposentar a OS recusada (recusado: cadastro ainda não consertado)"],
        });
        marcar("cadastro", "espera", "A OS recusada ainda está segurando a cobrança.");
        return fim();
      }
    } catch (e: any) {
      marcar("destravar", "falhou", e?.message ?? "Falhou.");
      pendencias.push({
        id_asaas: null, nome: "—", titulo: "Não deu para soltar a OS recusada",
        oQueFazer: `${e?.message ?? "Erro sem mensagem."} Nada foi alterado no Omie.`,
        tentado: ["devolver_a_esteira"],
      });
      return fim();
    }
  }
  if (!ctx.segue()) return fim();

  /* ---------------- PASSO 1 — o cadastro do tomador ---------------- */
  marcar("cadastro", "correndo", "Conferindo no Omie e criando o que faltar…");
  const cad = await sb.functions.invoke("omie-clientes-criar", {
    body: semCobranca ? { action: "garantir", sem_cobranca: [semCobranca.id] } : { action: "garantir", ids },
  });
  if (cad.error || cad.data?.erro) {
    marcar("cadastro", "falhou", cad.error?.message ?? cad.data?.erro);
    pendencias.push({
      id_asaas: null, nome: "—", titulo: "Não deu para conferir o cadastro no Omie",
      oQueFazer: "É falha de conexão com o Omie ou com o Hub, não de dado. Tente de novo em um minuto — " +
        "nada foi escrito em lugar nenhum.",
      tentado: ["chamada ao Omie"],
    });
    marcar("emissao", "espera", "Não há tomador pronto para emitir.");
    return fim();
  }
  const res: any[] = cad.data?.resultados ?? [];
  const criados = res.filter((r) => r.situacao === "criado");
  const jaTinham = res.filter((r) => r.situacao === "ja_tinha" || r.situacao === "ja_existia");
  const travados = res.filter((r) => r.situacao === "bloqueado" || r.situacao === "falhou" || r.situacao === "nao_tentado");
  /* Quem não ficou com o cadastro certo sai da leva aqui: com o cadastro que
     EXISTE mas diverge, ninguém recusa — a nota sairia com o endereço velho. */
  const barrados = new Set<string>(travados.flatMap((r) => (r.ids ?? []).map(String)));
  const atualizados = res.filter((r) => r.cadastro_atualizado === true);
  for (const r of travados) {
    pendencias.push({
      id_asaas: null,
      nome: `${r.nome ?? "cliente sem nome"} · ${formatarDoc(r.doc)}`,
      titulo: r.situacao === "bloqueado"
        ? "O cadastro deste tomador não pode ser montado sozinho"
        : r.situacao === "nao_tentado" && r.motivo === "omie_pausa"
        ? "O Omie pediu uma pausa — tente em alguns minutos"
        : r.situacao === "nao_tentado"
        ? "Não deu tempo de conferir este cadastro — mande de novo"
        : r.n_cod_cli
        ? "O endereço do cadastro no Omie não pôde ser atualizado"
        : "O Omie recusou o cadastro",
      oQueFazer: BLOQUEIOS_CADASTRO[r.motivo ?? ""] ?? r.motivo ?? "Sem motivo informado.",
      tentado: r.tentado ?? ["cadastro do Asaas", "Receita Federal (CNPJ)", "Correios (CEP)"],
    });
  }
  const partes = [
    jaTinham.length ? `${jaTinham.length} já tinha${jaTinham.length > 1 ? "m" : ""}` : "",
    atualizados.length ? `${atualizados.length} com o endereço atualizado no Omie` : "",
    criados.length ? `${criados.length} criado${criados.length > 1 ? "s" : ""} agora` : "",
    travados.length ? `${travados.length} sem caminho automático` : "",
  ].filter(Boolean).join(" · ");
  marcar("cadastro", travados.length ? "atencao" : "ok", partes || "Nada a fazer.");
  if (!(Number(cad.data?.prontos ?? 0) > 0)) {
    marcar("emissao", "espera", "Não há tomador pronto para emitir.");
    return fim();
  }
  if (semCobranca && barrados.has(semCobranca.id)) {
    marcar("emissao", "espera", "O cadastro do tomador não ficou certo — nada foi emitido.");
    return fim();
  }
  const liberados = ids.filter((id) => !barrados.has(id));
  if (!semCobranca && !liberados.length) {
    marcar("emissao", "espera", "Nenhuma cobrança com o cadastro certo para emitir.");
    return fim();
  }
  if (!ctx.segue()) return fim();

  /* ---------------- PASSO 2 — a emissão ----------------
   * "LOTE EM VOO" NÃO É ERRO, É FILA DO OMIE: esperar e repetir a MESMA leva. */
  marcar("emissao", "correndo", "Criando a OS no Omie e disparando o lote…");
  let oss: Array<{ id_asaas: string; n_cod_os: number }> | null = null;
  for (let tentativa = 1; tentativa <= 6 && ctx.segue(); tentativa++) {
    const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
      body: {
        action: "emitir", ids: liberados, avulsa: avulsa === true,
        ...(semCobranca ? { sem_cobranca: semCobranca.id } : {}),
        observacao: observacao?.trim() || null,
        /* O CLIQUE É A AUTORIZAÇÃO (Henrique, 11/09/2026): chave geral e teto do
           dia são freios de VAZÃO. O que foi furado volta e aparece na tela. */
        forcar: true,
      },
    });
    if (error) {
      marcar("emissao", "falhou", error.message);
      pendencias.push({
        id_asaas: null, nome: "—", titulo: "A emissão não respondeu",
        oQueFazer: "Falha de rede ou a função caiu. Nada foi faturado. Tente de novo — " +
          "se a OS tiver sido criada, a próxima tentativa a reencontra pelo carimbo, sem duplicar.",
        tentado: [`${tentativa} tentativa(s)`],
      });
      return fim();
    }
    if (Array.isArray(data?.freios_furados) && data.freios_furados.length) {
      ctx.atualizar({
        avisos: [`Seu clique venceu ${data.freios_furados.length > 1 ? "estes freios" : "este freio"}: ` +
          `${data.freios_furados.join(" ")} A emissão seguiu assim mesmo, e isso fica registrado com o seu nome.`],
      });
    }
    if (precisaEsperarOLote(data)) {
      const espera = esperaAntesDeRepetir(tentativa);
      marcar("emissao", "correndo",
        `O Omie está faturando um lote anterior — esperando ${Math.round(espera / 1000)}s e tentando de novo ` +
        `(${tentativa}ª vez). Nada foi perdido.`);
      await dorme(espera);
      continue;
    }

    const resultados: any[] = data?.resultados ?? [];
    const despachadas = resultados.filter((r) => r.em_processamento);
    const jaTinhamNota = resultados.filter((r) => r.ja_emitida);
    const barradas = resultados.filter((r) => r.bloqueado);
    const falhas = resultados.filter((r) => !r.ok && !r.em_processamento && !r.bloqueado && !r.ja_emitida);
    /* A BARRAGEM COM O MOTIVO (18/09/2026). Quando a rodada inteira é barrada, a
       função devolve só `pulada` ("as 1 cobranças da fila foram barradas") e o
       motivo mora em `detalhe.barradas`. Mostrar só a frase genérica escondia o
       que a pessoa precisava ler: "cobrança confirmada e ainda não liquidada". */
    const barradasSemResultado: any[] = !resultados.length ? (data?.detalhe?.barradas ?? []) : [];
    for (const b of [...barradas.map((x) => ({ id_asaas: x.id_asaas, motivo: x.erro })), ...barradasSemResultado]) {
      pendencias.push({
        id_asaas: b.id_asaas ?? null, nome: nomeDe(b.id_asaas ?? ""),
        titulo: "Barrada na conferência com o Asaas",
        oQueFazer: `${b.motivo ?? "Sem motivo."} Nada foi mandado ao Omie.`,
        tentado: ["leitura ao vivo da cobrança no Asaas, no instante da emissão"],
      });
    }
    for (const f of falhas) {
      pendencias.push({
        id_asaas: f.id_asaas, nome: nomeDe(f.id_asaas), titulo: "O Omie recusou",
        oQueFazer: f.erro ?? "Sem motivo informado.",
        tentado: ["cadastro conferido/criado", "OS criada", "faturamento"],
      });
    }
    if (data?.pulada && !despachadas.length) {
      const motivo = barradasSemResultado[0]?.motivo ?? String(data.pulada);
      marcar("emissao", "falhou", motivo);
      if (!barradasSemResultado.length) {
        pendencias.push({
          id_asaas: null, nome: "—", titulo: "A rodada não andou", oQueFazer: String(data.pulada),
          tentado: ["emissão com os freios furados"],
        });
      }
      return fim();
    }
    const resumo = [
      despachadas.length ? `${despachadas.length} despachada${despachadas.length > 1 ? "s" : ""}` : "",
      jaTinhamNota.length ? `${jaTinhamNota.length} já tinha${jaTinhamNota.length > 1 ? "m" : ""} nota` : "",
      barradas.length ? `${barradas.length} barrada${barradas.length > 1 ? "s" : ""}` : "",
      falhas.length ? `${falhas.length} recusada${falhas.length > 1 ? "s" : ""} pelo Omie` : "",
    ].filter(Boolean).join(" · ");
    marcar("emissao", despachadas.length ? (barradas.length || falhas.length ? "atencao" : "ok") : "falhou",
      `${resumo || "Nada a emitir."}${data?.lote ? ` · lote ${data.lote}` : ""}`);
    if (!despachadas.length) return fim();
    oss = despachadas.filter((d) => Number(d.n_cod_os) > 0)
      .map((d) => ({ id_asaas: d.id_asaas, n_cod_os: Number(d.n_cod_os) }));
    break;
  }
  if (!oss) {
    if (ctx.segue()) {
      marcar("emissao", "falhou", "O Omie seguiu ocupado com outro lote em todas as tentativas.");
      pendencias.push({
        id_asaas: null, nome: "—", titulo: "O Omie ficou ocupado o tempo todo",
        oQueFazer: "Um lote anterior seguiu em processamento por mais de 3 minutos. Nada foi perdido e nada foi " +
          "criado em duplicidade — mande de novo daqui a pouco.",
        tentado: ["6 tentativas, com espera crescente entre elas"],
      });
    }
    return fim();
  }

  /* ---------------- PASSO 3 — a nota. Aqui só se espera ---------------- */
  if (!oss.length) {
    marcar("nota", "espera", "Nenhuma OS para acompanhar.");
    return fim();
  }
  marcar("nota", "correndo", "O lote foi para a prefeitura. A nota costuma nascer em 2 a 3 minutos…");
  const achadas = new Map<string, string>();
  const ate = Date.now() + ESPERA_NOTA_MS;
  while (ctx.segue() && Date.now() < ate && achadas.size < oss.length) {
    await dorme(INTERVALO_NOTA_MS);
    for (const os of oss) {
      if (!ctx.segue() || achadas.has(os.id_asaas)) continue;
      try {
        const { data } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "etapas", os: os.n_cod_os } });
        const numero = data?.nfse?.nfse_numero ?? null;
        const status = String(data?.nfse?.nfse_status ?? "");
        if (numero && status === "004") achadas.set(os.id_asaas, String(numero));
        // '003' é RECUSA DA PREFEITURA, definitiva para esta OS: o tempo não resolve.
        else if (status === "003") achadas.set(os.id_asaas, "");
      } catch { /* uma volta perdida não é desfecho; a próxima tenta de novo */ }
    }
    const quantas = [...achadas.values()].filter(Boolean).length;
    if (achadas.size < oss.length) {
      marcar("nota", "correndo",
        `${quantas} de ${oss.length} já autorizada${quantas === 1 ? "" : "s"} — ` +
        `faltam ${Math.max(0, Math.round((ate - Date.now()) / 1000))}s de espera.`);
    }
  }
  const comNumero = oss.filter((o) => achadas.get(o.id_asaas));
  ctx.atualizar({
    destaques: comNumero.map((o) => ({ rotulo: nomeDe(o.id_asaas), valor: `NFS-e ${achadas.get(o.id_asaas)}` })),
  });
  const recusadas = oss.filter((o) => achadas.get(o.id_asaas) === "");
  if (recusadas.length) {
    marcar("nota", "atencao", `${comNumero.length} autorizada(s) · ${recusadas.length} recusada(s) pela prefeitura.`);
    for (const r of recusadas) {
      pendencias.push({
        id_asaas: r.id_asaas, nome: nomeDe(r.id_asaas), titulo: "A prefeitura recusou a nota",
        oQueFazer: "O motivo está na linha da cobrança, em Notas Fiscais › Recusas a tratar.",
        tentado: ["OS criada e faturada", "espera pela prefeitura"],
      });
    }
  } else if (comNumero.length === oss.length) {
    marcar("nota", "ok", comNumero.map((c) => `nota ${achadas.get(c.id_asaas)}`).join(" · "));
  } else if (ctx.segue()) {
    /* NÃO É FALHA: a nota continua a caminho e o espelho a encontra sozinho —
       dizer "falhou" mandaria alguém emitir de novo o que já está na rua. */
    marcar("nota", "atencao",
      `${comNumero.length} de ${oss.length} autorizada(s) até agora. O resto continua a caminho — ` +
      "o Hub pega o número sozinho na próxima sincronização.");
  }
  if (!ctx.segue()) return fim();

  /* ---------------- PASSO 4 — gravar o número aqui dentro ---------------- */
  marcar("espelho", "correndo", "Gravando o número no Hub…");
  try {
    const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "espelhar", anexar: false } });
    if (error || data?.erro) throw new Error(error?.message ?? data?.erro);
    marcar("espelho", "ok", `${data?.com_nota ?? 0} OS com nota autorizada no espelho.`);
  } catch {
    marcar("espelho", "atencao", "Não deu para sincronizar agora — o cron do espelho grava o número em até 10 min.");
  }
  const r = fim();
  if (comNumero.length) {
    return { ...r, resumo: comNumero.map((c) => `NFS-e ${achadas.get(c.id_asaas)} · ${nomeDe(c.id_asaas)}`).join(" · ") };
  }
  return r;
}
