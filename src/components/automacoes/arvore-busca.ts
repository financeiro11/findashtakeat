/* ============================================================================
 * Busca da Árvore de Automações — achar o nó sem ter que caçá-lo no desenho.
 *
 * A árvore é boa para ler relação (quem destrava quem) e péssima para achar UMA
 * automação: são dezenas de bolinhas de 48px espalhadas em quatro trilhas. Aqui
 * mora a parte que responde "onde está a X" — e responde também por
 * característica, não só por nome: ferramenta, responsável, status, nível,
 * trilha, impacto/esforço e o texto da dor/solução/upgrade.
 *
 * Duas decisões que valem a pena estar escritas:
 *
 *  · Todo termo digitado precisa bater em ALGUM campo (E entre as palavras, OU
 *    entre os campos). "julia nota" acha o que a Júlia fez em Notas Fiscais, e
 *    não a soma de tudo que é dela com tudo que é de nota.
 *
 *  · O resultado devolve ONDE bateu e o trecho, porque casar por dor/solução
 *    traz linha cujo nome não tem nenhuma letra do que foi digitado — sem dizer
 *    o porquê, o resultado parece erro.
 *
 * Fica separado do componente para dar para testar sem montar o React.
 * Ver arvore-busca.test.ts.
 * ========================================================================== */

import {
  trilhaDe, nomeNivel, listaFerramentas, impactoDe, esforcoDe, temUpgrade, bandaDe,
  NIVEIS_PADRAO,
  type Automacao, type Nivel,
} from "./arvore-layout";

/** Abaixo disso a busca fica calada: uma letra só acende meia árvore. */
export const MIN_TERMO = 2;

export type Faixa = { de: number; ate: number };

export type Achado = {
  r: Automacao;
  pontos: number;
  /** rótulos dos campos onde bateu, do mais forte para o mais fraco */
  onde: string[];
  /** faixas a grifar dentro do nome da automação */
  nome: Faixa[];
  /** por que essa linha apareceu, quando não foi pelo nome */
  trecho: { rotulo: string; texto: string; faixas: Faixa[] } | null;
};

/**
 * Achata acento e caixa PRESERVANDO os índices — é o que permite grifar o
 * pedaço certo do texto cru depois de casar no texto achatado. `normalize()` do
 * projeto não serve aqui: ele troca pontuação por espaço e colapsa espaços, o
 * que desloca as posições.
 */
export function achatar(s: string | null | undefined): string {
  const bruto = s || "";
  const semAcento = bruto.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const alvo = semAcento.length === bruto.length ? semAcento : bruto;
  const maiusc = alvo.toUpperCase();
  return maiusc.length === bruto.length ? maiusc : alvo; // "ß" → "SS" desalinharia
}

/** Palavras do termo, sem a pontuação das pontas ("n8n" e "fp&a" seguem inteiros). */
export function palavrasDe(termo: string): string[] {
  return achatar(termo)
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, ""))
    .filter(Boolean);
}

type Campo = { rotulo: string; texto: string; peso: number };

/**
 * Os campos por onde a busca varre, com o peso de cada um. O peso é o que decide
 * a ordem: bater no nome vale mais que bater na observação, senão uma linha que
 * cita "Omie" no meio de um parágrafo passa na frente da automação chamada
 * "Omie → Tracker".
 */
export function camposDe(r: Automacao, niveis: Nivel[] = NIVEIS_PADRAO): Campo[] {
  const marcadores = [
    temUpgrade(r) ? "upgrade sugerido" : "",
    r.esteira_upgrade ? "linha de produção" : "",
    bandaDe(r, niveis) ? "" : "sem nível",
    r.depende_de ? "" : "sem pré-requisito",
  ].filter(Boolean).join(" · ");

  return [
    { rotulo: "nome", texto: r.automacao || "", peso: 100 },
    { rotulo: "ferramenta", texto: listaFerramentas(r.ferramentas).join(", "), peso: 72 },
    { rotulo: "responsável", texto: r.responsavel || "", peso: 70 },
    { rotulo: "categoria", texto: r.categoria || "", peso: 62 },
    { rotulo: "trilha", texto: trilhaDe(r.categoria), peso: 58 },
    { rotulo: "status", texto: r.status || "", peso: 54 },
    { rotulo: "nível", texto: nomeNivel(niveis, bandaDe(r, niveis) || null), peso: 50 },
    { rotulo: "solução", texto: r.solucao || "", peso: 42 },
    { rotulo: "dor", texto: r.dor || "", peso: 40 },
    { rotulo: "upgrade", texto: r.upgrade || "", peso: 38 },
    { rotulo: "impacto", texto: r.impacto ? `impacto ${impactoDe(r).nome}` : "", peso: 30 },
    { rotulo: "esforço", texto: r.esforco ? `esforço ${esforcoDe(r).nome}` : "", peso: 30 },
    { rotulo: "marcador", texto: marcadores, peso: 26 },
    { rotulo: "observação", texto: r.observacao || "", peso: 22 },
  ];
}

const BONUS_INICIO = 30;   // o campo começa com o que foi digitado
const BONUS_PALAVRA = 14;  // começo de palavra no meio do campo
const BONUS_EXATO = 12;    // o campo é exatamente aquilo

type Batida = { rotulo: string; peso: number; pontos: number; faixa: Faixa };

/** Melhor campo em que a palavra bate — e quanto isso vale. */
function baterPalavra(campos: { rotulo: string; peso: number; chave: string }[], palavra: string): Batida | null {
  let melhor: Batida | null = null;
  for (const c of campos) {
    const i = c.chave.indexOf(palavra);
    if (i < 0) continue;
    const anterior = i > 0 ? c.chave[i - 1] : "";
    const pontos =
      c.peso +
      (i === 0 ? BONUS_INICIO : /[A-Z0-9]/.test(anterior) ? 0 : BONUS_PALAVRA) +
      (c.chave.length === palavra.length ? BONUS_EXATO : 0);
    if (!melhor || pontos > melhor.pontos) {
      melhor = { rotulo: c.rotulo, peso: c.peso, pontos, faixa: { de: i, ate: i + palavra.length } };
    }
  }
  return melhor;
}

/** Todas as faixas de casamento das palavras dentro de um texto, já unidas. */
function faixasEm(texto: string, palavras: string[]): Faixa[] {
  const chave = achatar(texto);
  const cruas: Faixa[] = [];
  for (const p of palavras) {
    let i = chave.indexOf(p);
    while (i >= 0) {
      cruas.push({ de: i, ate: i + p.length });
      i = chave.indexOf(p, i + p.length);
    }
  }
  return unirFaixas(cruas);
}

/** Junta faixas que se tocam — grifar duas vezes o mesmo pedaço quebra o texto. */
export function unirFaixas(faixas: Faixa[]): Faixa[] {
  const ord = [...faixas].sort((a, b) => a.de - b.de || a.ate - b.ate);
  const out: Faixa[] = [];
  for (const f of ord) {
    const ult = out[out.length - 1];
    if (ult && f.de <= ult.ate) ult.ate = Math.max(ult.ate, f.ate);
    else out.push({ ...f });
  }
  return out;
}

const JANELA_ANTES = 26;
const JANELA_DEPOIS = 74;

/** Recorta o trecho em volta do primeiro casamento, com as faixas realinhadas. */
function recortar(texto: string, faixas: Faixa[]) {
  const primeira = faixas[0];
  if (!primeira) return { texto, faixas };
  const de = Math.max(0, primeira.de - JANELA_ANTES);
  const ate = Math.min(texto.length, primeira.ate + JANELA_DEPOIS);
  const corpo = (de > 0 ? "…" : "") + texto.slice(de, ate) + (ate < texto.length ? "…" : "");
  const desloc = (de > 0 ? 1 : 0) - de;
  return {
    texto: corpo,
    faixas: faixas
      .filter((f) => f.de >= de && f.ate <= ate)
      .map((f) => ({ de: f.de + desloc, ate: f.ate + desloc })),
  };
}

/**
 * As automações que casam com o termo, da mais provável para a menos. Termo
 * curto demais devolve `null` — o chamador usa isso para saber que a busca está
 * desligada (e não que "não achou nada").
 */
export function buscarAutomacoes(
  rows: Automacao[],
  termo: string,
  niveis: Nivel[] = NIVEIS_PADRAO,
): Achado[] | null {
  if (achatar(termo).trim().length < MIN_TERMO) return null;
  const palavras = palavrasDe(termo);
  if (!palavras.length) return null;

  const achados: Achado[] = [];
  for (const r of rows) {
    const campos = camposDe(r, niveis)
      .filter((c) => c.texto.trim())
      .map((c) => ({ ...c, chave: achatar(c.texto) }));

    const batidas: Batida[] = [];
    let falhou = false;
    for (const p of palavras) {
      const b = baterPalavra(campos, p);
      if (!b) { falhou = true; break; }
      batidas.push(b);
    }
    if (falhou) continue;

    // rótulos únicos, do campo mais forte para o mais fraco
    const onde = Array.from(
      new Map(batidas.map((b) => [b.rotulo, b.peso])).entries(),
    ).sort((a, z) => z[1] - a[1]).map(([rotulo]) => rotulo);

    const nome = faixasEm(r.automacao || "", palavras);

    // O "por que apareceu" é o campo mais forte fora do nome — o nome já está
    // na linha de cima, repeti-lo embaixo não explica nada.
    const forte = batidas
      .filter((b) => b.rotulo !== "nome")
      .sort((a, z) => z.pontos - a.pontos)[0];
    const campoForte = forte && campos.find((c) => c.rotulo === forte.rotulo);
    const trecho = campoForte
      ? { rotulo: campoForte.rotulo, ...recortar(campoForte.texto, faixasEm(campoForte.texto, palavras)) }
      : null;

    achados.push({
      r,
      pontos: batidas.reduce((s, b) => s + b.pontos, 0),
      onde,
      nome,
      trecho,
    });
  }

  return achados.sort(
    (a, z) => z.pontos - a.pontos || (a.r.automacao || "").localeCompare(z.r.automacao || "", "pt-BR"),
  );
}

/** Quebra o texto nos pedaços a grifar — o componente só decide a cor. */
export function grifar(texto: string, faixas: Faixa[]): { texto: string; forte: boolean }[] {
  if (!faixas.length) return [{ texto, forte: false }];
  const partes: { texto: string; forte: boolean }[] = [];
  let cursor = 0;
  for (const f of unirFaixas(faixas)) {
    if (f.de > cursor) partes.push({ texto: texto.slice(cursor, f.de), forte: false });
    partes.push({ texto: texto.slice(f.de, f.ate), forte: true });
    cursor = f.ate;
  }
  if (cursor < texto.length) partes.push({ texto: texto.slice(cursor), forte: false });
  return partes.filter((p) => p.texto);
}
