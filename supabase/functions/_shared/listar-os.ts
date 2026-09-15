/* A varredura de `servicos/os ListarOS` — as regras puras, sem Omie e sem Deno,
 * para o vitest alcançar (ver src/lib/listarOS.test.ts).
 *
 * POR QUE ISTO SAIU DO index.ts. Em 15/09/2026 a esteira de emissão parou às
 * 10:02 e não emitiu mais nada no dia. A guarda de truncamento contava PÁGINAS
 * ("teto de 40 páginas de 500 = 20.000 OS"), mas o Omie devolve no máximo 100 OS
 * por página, peça-se o que se pedir: 40 páginas eram 4.000 OS. O acervo tinha
 * exatamente 4.000; a rodada das 10:00 criou 16 e a leitura seguinte veio com 41
 * páginas. A guarda disparou, a emissão abortou, e o espelho — que é quem conta
 * que a nota nasceu — parou junto. Uma nota autorizada na véspera (NFS-e 20274)
 * passou o dia na tela como "parou no meio da emissão".
 *
 * A pergunta que a guarda sempre quis fazer é "li a lista INTEIRA?", e ela se
 * responde com REGISTROS, que o próprio Omie informa em `total_de_registros`.
 * Página é unidade do Omie, não nossa — e ele muda o tamanho sem avisar.
 */

/** A frase com que o Omie diz "acabou" (ou "etapa vazia"). Resposta, não falha. */
export const FIM_DA_LISTA = /n[ãa]o existem registros/i;

/**
 * Li tudo? Devolve a frase do problema, ou `null` quando a lista está completa.
 *
 * `totalDeRegistros` null = o Omie respondeu "não existem registros" já na
 * primeira página: lista vazia confirmada por ele, nada faltando.
 *
 * Ler MAIS do que o total é normal (OS criada no meio da varredura). Ler MENOS é
 * o que não se aceita: `limparCorredor` e `ocupantesDaEtapa` concluiriam "não há
 * mais ninguém aqui" sobre um corredor que não viram inteiro, e o `FaturarLoteOS`
 * seguinte fatura a ETAPA — emitindo nota de OS que não é nossa.
 */
export function conferirLeituraCompleta(p: {
  lidos: number;
  totalDeRegistros: number | null;
  etapa?: string;
}): string | null {
  const onde = p.etapa ? ` da etapa ${p.etapa}` : "";
  if (p.totalDeRegistros === null) return null;
  if (!Number.isFinite(p.totalDeRegistros)) {
    return `ListarOS${onde} não informou total_de_registros, e sem ele não há como saber se a lista veio inteira. ` +
      "Nada foi usado — decidir sobre uma lista possivelmente cortada é o que esta guarda existe para impedir.";
  }
  if (p.lidos >= p.totalDeRegistros) return null;
  return `ListarOS${onde} leu ${p.lidos} OS das ${p.totalDeRegistros} que o próprio Omie informou. ` +
    "Nada foi usado: uma lista incompleta faria a trava de raio decidir sobre um corredor que ela não viu " +
    "inteiro, e faturar a etapa emitiria nota de OS de terceiro. O comum é uma OS mudar de etapa ou ser " +
    "excluída no meio da leitura — a próxima rodada relê do zero.";
}

/**
 * O `registros_por_pagina` de cada varredura, DIFERENTE da anterior.
 *
 * A mesma requisição repetida em menos de 60s o Omie recusa como "Consumo
 * redundante" — e a emissão lê o corredor, espera 6s e lê de novo, com o mesmo
 * corpo. Variar o tamanho pedido torna as duas distintas por construção. Fica
 * sempre acima de 100 porque o Omie corta em 100 de todo jeito: o tamanho
 * EFETIVO da página não muda, só a impressão digital da chamada.
 */
export function tamanhoDePagina(sequencia: number): number {
  return 500 - (Math.abs(Math.trunc(sequencia)) % 50);
}

/**
 * Quais OS ainda estão "no forno" — disparadas, sem desfecho posterior.
 *
 * É a lista que o espelho confere pelo `StatusOS`, uma por uma, ANTES de varrer o
 * acervo. Assim a nota que nasceu aparece como emitida mesmo no dia em que a
 * varredura inteira quebra — que foi exatamente o dia 15/09/2026.
 *
 * A mais recente primeiro (é a que alguém está esperando ver), uma vez cada, e
 * só se nenhum desfecho (`ok`/`erro`/`bloqueado`) veio DEPOIS do disparo: uma OS
 * que falhou e foi redisparada volta a estar no forno.
 */
export function osAindaNoForno(
  abertas: Array<{ n_cod_os: number | string | null; criado_em: string }>,
  desfechos: Array<{ n_cod_os: number | string | null; criado_em: string }>,
  teto: number,
): number[] {
  const ultimoDesfecho = new Map<number, string>();
  for (const d of desfechos) {
    const k = Number(d.n_cod_os);
    if (!k) continue;
    const atual = ultimoDesfecho.get(k);
    if (!atual || d.criado_em > atual) ultimoDesfecho.set(k, d.criado_em);
  }

  const disparo = new Map<number, string>();
  for (const a of abertas) {
    const k = Number(a.n_cod_os);
    if (!k) continue;
    const atual = disparo.get(k);
    if (!atual || a.criado_em > atual) disparo.set(k, a.criado_em);
  }

  return [...disparo]
    .filter(([k, quando]) => (ultimoDesfecho.get(k) ?? "") < quando)
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .slice(0, Math.max(0, teto))
    .map(([k]) => k);
}

/**
 * A janela do espelho: "OS alteradas de `de` até `ate`", em datas de Brasília.
 *
 * `filtrar_por_data_de`/`_ate` do ListarOS pega inclusão OU alteração — provado
 * em 15/09/2026 com controle: o dia 14/09 devolveu 175 OS, entre elas a OS 1701
 * (incluída 27/08, alterada 14/09); com `filtrar_apenas_inclusao: "S"` vieram 154
 * e a 1701 sumiu. Faturar, cancelar e trocar etapa alteram a OS, então tudo que
 * o espelho precisa saber cabe na janela — e ela custa o movimento dos últimos
 * dias, não o acervo, que cresce ~150 OS por dia de emissão em massa.
 *
 * Brasília é UTC-3 fixo (sem horário de verão desde 2019): o dia do Omie vira
 * à meia-noite daqui, não à de Greenwich.
 */
export function janelaDeAlteracao(agoraMs: number, dias: number): { de: string; ate: string } {
  const hoje = new Date(agoraMs - 3 * 3_600_000);
  const inicio = new Date(hoje.getTime() - Math.max(0, Math.trunc(dias)) * 86_400_000);
  const br = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  return { de: br(inicio), ate: br(hoje) };
}

/**
 * As notas que precisam de `StatusOS`, escolhidas pelo ESPELHO GRAVADO — e não
 * pela listagem.
 *
 * Com o espelho por janela, a nota PRESA (faturada, RPS em '001'/'003' há
 * semanas) não vem mais na lista, porque ninguém mexe nela no Omie. Se a escolha
 * continuasse saindo da listagem, ela nunca mais seria relida. A regra é a mesma
 * de `ehStatusPendente`, lida das colunas:
 *   • faturada e nunca lida → sim;
 *   • já com nota ('004') → não, não muda mais;
 *   • recém-nascida (faturada há até `nascendoDias`) → sim, sem carência;
 *   • o resto → só depois de `carenciaH` desde a última leitura (é o que faz a
 *     varredura das presas convergir em vez de reler sempre as mesmas).
 */
export function statusPendenteDoEspelho(
  linhas: Array<{
    n_cod_os: number | string | null;
    faturada?: boolean | null;
    nfse_status?: string | null;
    status_lido_em?: string | null;
    data_faturamento?: string | null;
    cancelada?: boolean | null;
    excluida_em?: string | null;
  }>,
  agoraMs: number,
  regra: { carenciaH: number; nascendoDias: number },
): number[] {
  const out: number[] = [];
  for (const l of linhas) {
    const k = Number(l.n_cod_os);
    if (!k || l.faturada !== true) continue;
    /* OS apagada no Omie (`excluirOsRecusada`) segue no espelho com a última foto
     * — faturada, RPS '003'. A varredura do acervo nunca a trazia; o espelho
     * gravado traz, e cada uma custava um "OS não cadastrada" que derrubava o
     * laço de status. Medido em 15/09/2026: 431 linhas assim, TODAS com
     * `cancelada` e `excluida_em`, e nenhuma sem. */
    if (l.cancelada === true || l.excluida_em) continue;
    if (!l.status_lido_em) { out.push(k); continue; }
    if (l.nfse_status === "004") continue;
    const fat = l.data_faturamento ? Date.parse(`${String(l.data_faturamento).slice(0, 10)}T00:00:00Z`) : Number.NaN;
    const diasDesdeFat = Number.isFinite(fat) ? (agoraMs - fat) / 86_400_000 : Infinity;
    if (diasDesdeFat <= regra.nascendoDias) { out.push(k); continue; }
    const idadeH = (agoraMs - Date.parse(l.status_lido_em)) / 3_600_000;
    if (idadeH >= regra.carenciaH) out.push(k);
  }
  return out;
}
