/* ============================================================================
 * A folha da Revisão do Mês — montar, capturar, salvar.
 *
 * A tela é um rolo; o relatório é folha. Aqui está a ponte: medir o que está
 * renderizado, pedir a quebra a `exportarRevisao.ts` e MONTAR folhas de tamanho
 * fixo fora da tela, prontas para virar PDF, PowerPoint ou papel.
 *
 * POR QUE MONTAR A FOLHA EM VEZ DE MANDAR IMPRIMIR
 *   Deixar o navegador quebrar sozinho é o que produzia card partido ao meio e
 *   título de bloco sozinho no rodapé. Aqui a folha já nasce com o que cabe
 *   nela, e o que não coube foi para a folha seguinte inteiro.
 *
 * POR QUE CLONAR O DOM EM VEZ DE RE-RENDERIZAR EM REACT
 *   O relatório tem de ser IGUAL à tela que a pessoa acabou de conferir. Um
 *   segundo componente "versão para impressão" viraria duas verdades que se
 *   desencontram no primeiro ajuste de layout. Clonar o nó real custa nada e
 *   nunca diverge.
 *
 * AS TRÊS SAÍDAS, O MESMO MIOLO
 *   · PDF        → a folha A4 paisagem virada imagem e costurada com jsPDF
 *   · PowerPoint → a mesma folha em 16:9, uma por slide, com pptxgenjs
 *   · Imprimir   → as folhas já estão no documento; o CSS de
 *                  `body.revisao-imprimindo` (index.css) tira o Hub da frente.
 *   A impressão é a única saída com texto vetorial — dá para selecionar e fica
 *   nítida em qualquer zoom. As outras duas são pixels, e é esse o preço de
 *   garantir que o arquivo abre igualzinho em qualquer máquina.
 *
 * As libs pesadas (jspdf, pptxgenjs, html-to-image) entram por import dinâmico:
 * quem nunca clica em exportar não baixa um byte delas.
 * ========================================================================== */

import { paginar, type BlocoMedido, type Pagina, type PecaMedida } from "./exportarRevisao";

export type FormatoExport = "pdf" | "pptx" | "imprimir";

/* Medidas da folha, em px de CSS.
   A4 paisagem a 96dpi dá 1122×793 — é exatamente a caixa que o Chrome usa para
   imprimir com margem zero, então a mesma medição serve para o arquivo baixado
   e para a impressão do navegador, e os dois saem com a MESMA paginação. */
export const FOLHA: Record<FormatoExport, { largura: number; altura: number; densidade: number }> = {
  pdf: { largura: 1122, altura: 793, densidade: 2.2 },
  imprimir: { largura: 1122, altura: 793, densidade: 0 },
  pptx: { largura: 1280, altura: 720, densidade: 2 },
};

const MARGEM_X = 38;
const MARGEM_Y = 24;
const ALTURA_TOPO = 24;
const ALTURA_RODAPE = 18;
const GAP_MOLDURA = 12;
/** O mesmo `gap-3.5` que separa as peças na tela. */
const GAP_PECAS = 14;
const ESCALA_MINIMA = 0.55;

/** O retângulo que sobra para o conteúdo depois da margem, do topo e do rodapé. */
export const areaUtil = (f: FormatoExport) => ({
  largura: FOLHA[f].largura - MARGEM_X * 2,
  altura: FOLHA[f].altura - MARGEM_Y * 2 - ALTURA_TOPO - ALTURA_RODAPE - GAP_MOLDURA * 2,
});

/* ------------------------------------------------------------------ medir -- */

/** Lê a altura de cada peça do bloco e marca quais dão para repartir. */
function medirPecas(caixa: HTMLElement): PecaMedida[] {
  return [...caixa.children].map((filho, i) => {
    const el = filho as HTMLElement;
    const altura = el.getBoundingClientRect().height;
    if (!el.matches("[data-export-pilha]")) return { i, altura };
    const alturas = [...el.children].map((c) => (c as HTMLElement).getBoundingClientRect().height);
    const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
    // Pilha de um filho só não é pilha — reparti-la não geraria folha nenhuma.
    return alturas.length > 1 ? { i, altura, pilha: { alturas, gap } } : { i, altura };
  });
}

/* ----------------------------------------------------------------- montar -- */

/**
 * Encolhe o conteúdo até caber na folha — e só se precisar.
 *
 * A paginação já evita chegar aqui; isto é a rede de segurança para a peça que
 * é mais alta que a folha inteira (uma tabela de trinta linhas) e para o erro
 * de meio pixel entre medir e desenhar. Alargar junto com o `scale` é de
 * propósito: reduzir sem alargar deixaria a folha com tarja branca dos dois
 * lados, que é exatamente o defeito que motivou este trabalho.
 */
function encaixar(corpo: HTMLElement, alturaUtil: number, larguraUtil: number): number {
  let e = 1;
  for (let volta = 0; volta < 4; volta++) {
    corpo.style.width = `${larguraUtil / e}px`;
    corpo.style.transform = e < 1 ? `scale(${e})` : "";
    const altura = corpo.scrollHeight * e;
    if (altura <= alturaUtil + 0.5) break;
    // 0.997 de folga: sem isso, o arredondamento devolve uma escala que ainda
    // estoura por uma fração de pixel e a volta seguinte repete a conta.
    const proxima = Math.max(ESCALA_MINIMA, (e * alturaUtil) / altura * 0.997);
    if (proxima >= e - 0.0005) { e = proxima; break; }
    e = proxima;
  }
  corpo.style.width = `${larguraUtil / e}px`;
  corpo.style.transform = e < 1 ? `scale(${e})` : "";
  return e;
}

/** A faixa de cima (assunto da folha) e a de baixo (assinatura e paginação). */
function faixa(esquerda: string, direita: string, altura: number, forte: boolean): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "display:flex", "align-items:center", "justify-content:space-between",
    "gap:16px", "flex:0 0 auto", `height:${altura}px`,
    `font-size:${forte ? 12 : 10.5}px`, "letter-spacing:0.01em",
    "color:hsl(var(--muted-foreground))",
    forte ? "border-bottom:1px solid hsl(var(--border))" : "border-top:1px solid hsl(var(--border))",
  ].join(";");
  const a = document.createElement("span");
  a.textContent = esquerda;
  if (forte) a.style.cssText = "font-weight:600;color:hsl(var(--foreground))";
  const b = document.createElement("span");
  b.textContent = direita;
  b.style.cssText = "flex:0 0 auto";
  el.append(a, b);
  return el;
}

export type Documento = { raiz: HTMLDivElement; folhas: HTMLElement[] };

/**
 * Monta o documento inteiro fora da tela e devolve as folhas prontas.
 *
 * `blocos` são as seções `[data-revisao-bloco]` que estão na tela, na ordem em
 * que devem sair. Quem chama é dono do `raiz` e tem de removê-lo no fim —
 * inclusive quando dá erro no meio, senão fica um documento de oito folhas
 * pendurado no `<body>`.
 */
export function montarDocumento(
  blocos: HTMLElement[],
  rotulos: string[],
  formato: FormatoExport,
  cabecalho: string,
): Documento {
  const { largura: larguraUtil, altura: alturaUtil } = areaUtil(formato);
  const raiz = document.createElement("div");
  raiz.setAttribute("data-revisao-doc", "");
  raiz.className = "tema-claro";
  /* Longe da tela em vez de escondido: `display:none` não mede, e `visibility`
     ou `opacity:0` desenhariam PNG em branco. Elemento `fixed` não conta para a
     rolagem do documento, então nada de barra horizontal fantasma.
     E o `fixed` fica no ENVELOPE, nunca na folha: o html-to-image copia o estilo
     computado do nó que recebe, e uma folha "fixed em -200000px" seria desenhada
     fora da moldura do PNG — ou seja, em branco. */
  raiz.style.cssText = "position:fixed;top:0;left:-200000px;z-index:-1;pointer-events:none";
  document.body.appendChild(raiz);

  // 1. medir: os clones vão para uma caixa da LARGURA DA FOLHA e são medidos
  //    lá, não na tela — a largura da tela é outra e as alturas seriam mentira.
  const medidor = document.createElement("div");
  medidor.style.cssText = `position:absolute;top:0;left:0;width:${larguraUtil}px`;
  raiz.appendChild(medidor);

  const medidos: BlocoMedido[] = [];
  const clones: HTMLElement[][] = [];
  blocos.forEach((bloco, k) => {
    const conteudo = bloco.querySelector<HTMLElement>("[data-revisao-conteudo]");
    if (!conteudo) { medidos.push({ n: k, titulo: rotulos[k], pecas: [] }); clones.push([]); return; }
    const caixa = document.createElement("div");
    caixa.style.cssText = `display:flex;flex-direction:column;gap:${GAP_PECAS}px;width:${larguraUtil}px`;
    for (const filho of [...conteudo.children]) caixa.appendChild(filho.cloneNode(true));
    medidor.appendChild(caixa);
    medidos.push({ n: k, titulo: rotulos[k], pecas: medirPecas(caixa) });
    clones.push([...caixa.children] as HTMLElement[]);
  });

  // 2. decidir a quebra
  const paginas = paginar(medidos, alturaUtil, { gap: GAP_PECAS, escalaMinima: ESCALA_MINIMA });

  // 3. desenhar as folhas
  const folhas: HTMLElement[] = [];
  paginas.forEach((p: Pagina, i) => {
    const folha = document.createElement("div");
    folha.setAttribute("data-revisao-folha", "");
    folha.setAttribute("data-titulo", p.titulo);
    folha.style.cssText = [
      `width:${FOLHA[formato].largura}px`, `height:${FOLHA[formato].altura}px`,
      `padding:${MARGEM_Y}px ${MARGEM_X}px`, "box-sizing:border-box",
      "display:flex", "flex-direction:column", `gap:${GAP_MOLDURA}px`,
      "background:hsl(var(--background))", "color:hsl(var(--foreground))", "overflow:hidden",
    ].join(";");

    folha.appendChild(faixa(
      cabecalho,
      p.partes > 1 ? `${p.titulo} · ${p.parte} de ${p.partes}` : p.titulo,
      ALTURA_TOPO,
      true,
    ));

    const janela = document.createElement("div");
    janela.style.cssText = `flex:1 1 auto;min-height:0;height:${alturaUtil}px;overflow:hidden;display:flex;flex-direction:column`;
    const corpo = document.createElement("div");
    corpo.setAttribute("data-revisao-corpo", "");
    corpo.style.cssText = `display:flex;flex-direction:column;gap:${GAP_PECAS}px;transform-origin:top left;width:${larguraUtil}px`;

    const pecasDoBloco = clones[p.bloco] ?? [];
    for (const item of p.itens) {
      const fonte = pecasDoBloco[item.i];
      if (!fonte) continue;
      if (item.de == null || item.ate == null) {
        corpo.appendChild(fonte.cloneNode(true));
        continue;
      }
      // Fatia de pilha: o invólucro é clonado VAZIO e recebe só os filhos deste
      // pedaço, para a fatia herdar o espaçamento e o estilo da lista inteira.
      const fatia = fonte.cloneNode(false) as HTMLElement;
      for (let k = item.de; k < item.ate; k++) {
        const filho = fonte.children[k];
        if (filho) fatia.appendChild(filho.cloneNode(true));
      }
      corpo.appendChild(fatia);
    }

    janela.appendChild(corpo);
    folha.appendChild(janela);
    folha.appendChild(faixa(
      "Central do Financeiro · Takeat",
      `${i + 1} / ${paginas.length}`,
      ALTURA_RODAPE,
      false,
    ));
    raiz.appendChild(folha);
    folhas.push(folha);
    // Depois de estar no documento: antes disso não há layout para medir.
    const escala = encaixar(corpo, alturaUtil, larguraUtil);

    /* Folha que sobrou muito espaço fica com o conteúdo CENTRADO na vertical.
       A última folha de um bloco quase nunca fecha certinho, e conteúdo colado
       no topo com um palmo de branco embaixo lê como página que faltou
       imprimir; centrado, lê como página que acabou ali. */
    if (corpo.scrollHeight * escala < alturaUtil * 0.8) janela.style.justifyContent = "center";
  });

  medidor.remove();
  return { raiz, folhas };
}

/* --------------------------------------------------------------- capturar -- */

export async function capturar(
  folhas: HTMLElement[],
  formato: FormatoExport,
  aviso: (feito: number, total: number) => void,
): Promise<string[]> {
  const { toPng, getFontEmbedCSS } = await import("html-to-image");
  /* As fontes são do Google Fonts: sem embutir, o PNG sai em Times New Roman —
     o PNG é desenhado num documento à parte, onde o @font-face da página não
     alcança. Buscar uma vez e reaproveitar corta segundos por folha; se a busca
     falhar (rede, CORS), o relatório sai com a fonte de sistema, feio e não
     quebrado. */
  let fontEmbedCSS: string | undefined;
  try {
    fontEmbedCSS = await getFontEmbedCSS(folhas[0]);
  } catch {
    fontEmbedCSS = undefined;
  }
  const fundo = getComputedStyle(folhas[0]).backgroundColor;

  const pngs: string[] = [];
  for (const [i, folha] of folhas.entries()) {
    aviso(i, folhas.length);
    pngs.push(await toPng(folha, {
      pixelRatio: FOLHA[formato].densidade,
      backgroundColor: fundo,
      width: FOLHA[formato].largura,
      height: FOLHA[formato].altura,
      cacheBust: false,
      fontEmbedCSS,
    }));
  }
  aviso(folhas.length, folhas.length);
  return pngs;
}

export async function gerarPdf(pngs: string[], arquivo: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  pngs.forEach((png, i) => {
    if (i) doc.addPage("a4", "landscape");
    // A folha foi montada na proporção da A4 paisagem, então ela cobre a página
    // inteira sem esticar nada.
    doc.addImage(png, "PNG", 0, 0, 297, 210, `f${i}`, "FAST");
  });
  doc.save(`${arquivo}.pdf`);
}

export async function gerarPptx(pngs: string[], arquivo: string, titulo: string) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = titulo;
  pptx.company = "Takeat";
  for (const png of pngs) {
    // A folha JÁ é 16:9 e ocupa o slide inteiro. Nada é reposicionado aqui — é
    // por isso que nenhum elemento pode cair em cima do outro no PowerPoint.
    pptx.addSlide().addImage({ data: png, x: 0, y: 0, w: 10, h: 5.625 });
  }
  await pptx.writeFile({ fileName: `${arquivo}.pptx` });
}

/**
 * Imprime só as folhas: o resto do Hub some por CSS (ver `index.css`).
 *
 * O documento continua fora da tela até a hora da impressão — quem o traz para
 * a folha é a regra dentro do `@media print`. Trazer por JavaScript acenderia o
 * relatório inteiro por cima da página no instante antes da caixa abrir.
 */
export function imprimirDocumento(): Promise<void> {
  return new Promise((resolve) => {
    document.body.classList.add("revisao-imprimindo");
    let fechado = false;
    const limpar = () => {
      if (fechado) return;
      fechado = true;
      document.body.classList.remove("revisao-imprimindo");
      window.removeEventListener("afterprint", limpar);
      resolve();
    };
    window.addEventListener("afterprint", limpar);
    window.print();
    // Navegador que não dispara `afterprint` deixaria a página presa no layout
    // de impressão e o documento pendurado no <body>.
    window.setTimeout(limpar, 2000);
  });
}
