/* O relatório das ações da TETS — Excel e PDF.
 *
 * DUAS SAÍDAS, UM CONTEÚDO. A planilha é para continuar a conta (filtrar, somar,
 * colar noutro lugar); o PDF é para mandar para alguém que só vai ler. As duas
 * saem do MESMO `resumir()` que a tela mostra, de propósito: relatório que
 * recalcula por conta própria é relatório que uma hora diverge da tela, e aí
 * ninguém sabe qual dos dois está certo.
 *
 * O PDF É DE TEXTO, não retrato da tela. A folha da Revisão Mensal vira imagem
 * porque lá o desenho É a mensagem; aqui a trilha pode ter mil linhas, e mil
 * linhas fotografadas dariam um arquivo enorme onde não se pesquisa nada. Aqui
 * o texto é selecionável e a tabela quebra de página sozinha.
 *
 * AS LIBS ENTRAM POR IMPORT DINÂMICO. `xlsx` e `jspdf` juntas são alguns megas,
 * e quem abre o painel para olhar não deveria baixá-las para nada.
 */

import {
  brlStr, classeDe, detalheDe, diaLocal, excecaoAberta, excecaoVencida, horaLocal,
  modoDe, nomeDoArquivo, resumir, resumirExcecoes, rotuloDe, rotuloExcecao, textoCorrecao,
  valorLancado,
  type Excecao, type Execucao, type NomeDe, type Periodo, type Resumo,
} from "./thetys";

export type DadosRelatorio = {
  periodo: Periodo;
  execucoes: Execucao[];
  excecoes: Excecao[];
  nome: NomeDe;
  /** Quem pediu — vai no rodapé, para o relatório não ser anônimo. */
  autor?: string | null;
};

const CLASSE_ROTULO: Record<string, string> = {
  escrita: "Mudou algo",
  leitura: "Consultou",
  desconhecida: "Não classificada",
};

const RESULTADO_ROTULO: Record<string, string> = {
  executado: "Executado",
  proposto: "Proposto",
  escalado: "Escalado",
  falhou: "Falhou",
};

/* --------------------------------------------------------------- comum */

/** As linhas da trilha, já legíveis — a planilha e o PDF leem exatamente estas. */
function trilha(d: DadosRelatorio) {
  return [...d.execucoes]
    .sort((a, b) => a.executado_em.localeCompare(b.executado_em))
    .map((e) => ({
      quando: horaLocal(e.executado_em),
      dia: diaLocal(e.executado_em),
      tarefa: rotuloDe(e),
      classe: CLASSE_ROTULO[classeDe(e)] ?? classeDe(e),
      detalhe: detalheDe(e, d.nome),
      resultado: RESULTADO_ROTULO[e.resultado] ?? e.resultado,
      valor: valorLancado(e),
      alcada: e.alcada ?? "",
      modo: modoDe(e) === "teste" ? "TESTE" : "produção",
      erro: e.erro ?? "",
      correcao: textoCorrecao(e),
      tarefa_crua: e.tarefa,
    }));
}

/** As linhas do quadro de números — o mesmo texto nas duas saídas. */
function numeros(r: Resumo, x: ReturnType<typeof resumirExcecoes>): [string, string][] {
  return [
    ["Ações registradas", String(r.total)],
    ["… que mudaram algo", String(r.escritas)],
    ["… que só consultaram", String(r.leituras)],
    ...(r.desconhecidas ? ([["… não classificadas", String(r.desconhecidas)]] as [string, string][]) : []),
    ["Contas e obrigações lançadas", `${r.lancamentos.n} · ${brlStr(r.lancamentos.valor)}`],
    ["Falhas", String(r.falhas)],
    ["Escaladas para um humano", String(r.escaladas)],
    ["Corrigidas por alguém", String(r.corrigidas)],
    ["Exceções abertas na fila (hoje)", `${x.abertas}${x.vencidas ? ` · ${x.vencidas} vencida(s)` : ""}`],
    ["Exceções resolvidas no período", String(x.resolvidasNoPeriodo)],
    ["Em modo de teste", `${r.emTeste} de ${r.total}`],
  ];
}

/* --------------------------------------------------------------- Excel */

export async function exportarExcel(d: DadosRelatorio): Promise<void> {
  const XLSX = await import("xlsx");
  const r = resumir(d.execucoes);
  const x = resumirExcecoes(d.excecoes, { de: d.periodo.de, ate: d.periodo.ate });

  const wb = XLSX.utils.book_new();

  /* Aba 1 — o quadro, para quem abre e fecha. */
  const resumo: (string | number)[][] = [
    ["TETS — Tesouraria e CAP"],
    ["Período", d.periodo.rotulo],
    ["Gerado em", horaLocal(new Date().toISOString())],
    ...(d.autor ? [["Gerado por", d.autor]] : []),
    [],
    ["Número", "Valor"],
    ...numeros(r, x),
    [],
    ["Por tarefa", "Classe", "Vezes", "Falhas", "Valor lançado"],
    ...r.porTarefa.map((t) => [
      t.rotulo, CLASSE_ROTULO[t.classe] ?? t.classe, t.n, t.falhas, t.valor || "",
    ]),
    [],
    ["Por dia", "Ações", "Mudaram algo", "Falhas"],
    ...r.porDia.map((dia) => [dia.dia, dia.n, dia.escritas, dia.falhas]),
  ];
  const abaResumo = XLSX.utils.aoa_to_sheet(resumo);
  abaResumo["!cols"] = [{ wch: 34 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, abaResumo, "Resumo");

  /* Aba 2 — a trilha, uma linha por ação. É a aba que se filtra. */
  const acoes = trilha(d).map((l) => ({
    "Quando": l.quando,
    "Dia": l.dia,
    "Ação": l.tarefa,
    "Classe": l.classe,
    "Detalhe": l.detalhe,
    "Resultado": l.resultado,
    "Valor lançado": l.valor ?? "",
    "Alçada": l.alcada,
    "Modo": l.modo,
    "Erro": l.erro,
    "Correção humana": l.correcao,
    "Tarefa (crua)": l.tarefa_crua,
  }));
  const abaAcoes = XLSX.utils.json_to_sheet(
    acoes.length ? acoes : [{ "Quando": "sem ações no período" }],
  );
  abaAcoes["!cols"] = [
    { wch: 14 }, { wch: 11 }, { wch: 30 }, { wch: 16 }, { wch: 60 }, { wch: 12 },
    { wch: 14 }, { wch: 9 }, { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, abaAcoes, "Ações");

  /* Aba 3 — a fila do humano. Vem inteira, não recortada pelo período: uma
     exceção aberta há três semanas continua sendo trabalho de hoje. */
  const excecoes = [...d.excecoes]
    .sort((a, b) => Number(excecaoAberta(b)) - Number(excecaoAberta(a)) || a.criado_em.localeCompare(b.criado_em))
    .map((e) => ({
      "Aberta em": horaLocal(e.criado_em),
      "Tipo": rotuloExcecao(e.tipo),
      "Título": e.titulo,
      "Descrição": e.descricao ?? "",
      "Severidade": e.severidade,
      "Valor": e.valor ?? "",
      "Vence em": horaLocal(e.vence_em),
      "Vencida": excecaoVencida(e) ? "sim" : "",
      "Status": e.status,
      "Resolução": e.resolucao ?? "",
      "Resolvida em": horaLocal(e.resolvido_em),
    }));
  const abaExc = XLSX.utils.json_to_sheet(
    excecoes.length ? excecoes : [{ "Aberta em": "nenhuma exceção" }],
  );
  abaExc["!cols"] = [
    { wch: 14 }, { wch: 28 }, { wch: 44 }, { wch: 60 }, { wch: 11 }, { wch: 12 },
    { wch: 14 }, { wch: 9 }, { wch: 12 }, { wch: 40 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, abaExc, "Exceções");

  XLSX.writeFile(wb, `${nomeDoArquivo(d.periodo)}.xlsx`);
}

/* ----------------------------------------------------------------- PDF */

const MARGEM = 14;
const LARGURA = 210; // A4 retrato, em mm
const ALTURA = 297;
const UTIL = LARGURA - MARGEM * 2;

export async function exportarPdf(d: DadosRelatorio): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  const r = resumir(d.execucoes);
  const x = resumirExcecoes(d.excecoes, { de: d.periodo.de, ate: d.periodo.ate });

  let y = MARGEM;

  /* Quebra de página com uma margem de segurança embaixo: sem ela, um bloco cai
     rente ao pé da folha e a linha seguinte abre a página sozinha, órfã. */
  const cabe = (altura: number) => {
    if (y + altura <= ALTURA - MARGEM - 6) return;
    doc.addPage();
    y = MARGEM;
  };

  const titulo = (texto: string, tamanho = 10.5) => {
    cabe(10);
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(tamanho);
    doc.setTextColor(20);
    doc.text(texto, MARGEM, y);
    y += 4.5;
  };

  const linhaFina = () => {
    doc.setDrawColor(210);
    doc.setLineWidth(0.2);
    doc.line(MARGEM, y, LARGURA - MARGEM, y);
    y += 3;
  };

  /* ---- capa ---- */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("TETS — Tesouraria e CAP", MARGEM, y + 2);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(d.periodo.rotulo, MARGEM, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.text(
    `Gerado em ${horaLocal(new Date().toISOString())}${d.autor ? ` por ${d.autor}` : ""}`,
    MARGEM, y,
  );
  y += 4;

  /* O aviso do ensaio vem na capa, não numa nota de rodapé: um relatório em que
     tudo é teste, lido como se fosse produção, é pior do que relatório nenhum. */
  if (r.emTeste > 0) {
    const tudo = r.emTeste === r.total;
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(245, 200, 90);
    doc.roundedRect(MARGEM, y, UTIL, 9, 1.2, 1.2, "FD");
    doc.setTextColor(120, 80, 10);
    doc.setFontSize(8.5);
    doc.text(
      tudo
        ? "Todas as ações deste período foram executadas em MODO DE TESTE."
        : `${r.emTeste} de ${r.total} ações foram executadas em MODO DE TESTE.`,
      MARGEM + 3, y + 5.6,
    );
    y += 13;
  } else {
    y += 2;
  }

  /* ---- o quadro ---- */
  titulo("O que aconteceu no período");
  doc.setFontSize(9);
  for (const [rotulo, valor] of numeros(r, x)) {
    cabe(5.6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    doc.text(rotulo, MARGEM + 1, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20);
    doc.text(valor, LARGURA - MARGEM - 1, y, { align: "right" });
    y += 5.2;
  }
  y += 1;
  linhaFina();

  /* ---- por tarefa ---- */
  if (r.porTarefa.length) {
    titulo("Por tarefa");
    y = tabela(doc, y, {
      cabecalho: ["Ação", "Classe", "Vezes", "Falhas", "Valor lançado"],
      larguras: [86, 30, 16, 16, 34],
      alinhar: ["left", "left", "right", "right", "right"],
      linhas: r.porTarefa.map((t) => [
        t.rotulo,
        CLASSE_ROTULO[t.classe] ?? t.classe,
        String(t.n),
        t.falhas ? String(t.falhas) : "—",
        t.valor ? brlStr(t.valor) : "—",
      ]),
    });
  }

  /* ---- a fila do humano ---- */
  if (x.porTipo.length) {
    titulo("Exceções abertas na fila do humano");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(110);
    const nota = doc.splitTextToSize(
      "A fila não é recortada pelo período: uma exceção aberta há três semanas continua sendo trabalho de hoje.",
      UTIL,
    );
    cabe(nota.length * 4 + 2);
    doc.text(nota, MARGEM + 1, y);
    y += nota.length * 4 + 1;

    y = tabela(doc, y, {
      cabecalho: ["Tipo", "Abertas"],
      larguras: [148, 34],
      alinhar: ["left", "right"],
      linhas: x.porTipo.map((t) => [rotuloExcecao(t.tipo), String(t.n)]),
    });
  }

  /* ---- a trilha ---- */
  const linhas = trilha(d);
  titulo("A trilha, ação a ação");
  if (!linhas.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Nenhuma ação registrada neste período.", MARGEM + 1, y);
    y += 6;
  } else {
    y = tabela(doc, y, {
      cabecalho: ["Quando", "Ação", "Detalhe", "Resultado"],
      larguras: [22, 42, 88, 30],
      alinhar: ["left", "left", "left", "left"],
      linhas: linhas.map((l) => [
        l.quando,
        l.tarefa,
        [l.detalhe, l.erro && `erro: ${l.erro}`, l.correcao && `corrigido: ${l.correcao}`]
          .filter(Boolean).join(" — "),
        l.modo === "TESTE" ? `${l.resultado} (teste)` : l.resultado,
      ]),
    });
  }

  /* ---- rodapé com a paginação, depois de saber quantas páginas deu ---- */
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(150);
    doc.text("Central do Financeiro · Takeat", MARGEM, ALTURA - 8);
    doc.text(`${i} / ${paginas}`, LARGURA - MARGEM, ALTURA - 8, { align: "right" });
  }

  doc.save(`${nomeDoArquivo(d.periodo)}.pdf`);
}

type Alinhamento = "left" | "right";

type Tabela = {
  cabecalho: string[];
  /** Em mm, somando a largura útil da folha. */
  larguras: number[];
  alinhar: Alinhamento[];
  linhas: string[][];
};

/**
 * Uma tabela que quebra de página sozinha e reimprime o cabeçalho. Recebe o `y`
 * de onde começar e devolve o `y` de onde continuar.
 *
 * Escrita à mão em vez de trazer o `jspdf-autotable`: são quatro colunas e uma
 * regra de quebra — uma dependência a mais custaria mais do que resolve. A altura
 * de cada linha sai do texto JÁ quebrado por `splitTextToSize`; medir por número
 * de caracteres faria o detalhe longo de uma ação escrever por cima da linha
 * seguinte.
 */
function tabela(doc: import("jspdf").jsPDF, yInicial: number, t: Tabela): number {
  let y = yInicial;
  const xDe = (col: number) => MARGEM + t.larguras.slice(0, col).reduce((s, w) => s + w, 0);
  const posicao = (i: number) =>
    t.alinhar[i] === "right" ? xDe(i) + t.larguras[i] - 1.5 : xDe(i) + 1.5;

  const corpo = () => { doc.setFont("helvetica", "normal"); doc.setFontSize(7.8); };

  const imprimirCabecalho = () => {
    doc.setFillColor(243, 244, 246);
    doc.rect(MARGEM, y - 3.6, UTIL, 5.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.setTextColor(70);
    t.cabecalho.forEach((c, i) => doc.text(c, posicao(i), y, { align: t.alinhar[i] }));
    y += 4;
  };

  imprimirCabecalho();
  corpo();

  for (const linha of t.linhas) {
    const partes = linha.map(
      (celula, i) => doc.splitTextToSize(String(celula ?? ""), t.larguras[i] - 3) as string[],
    );
    const altura = Math.max(...partes.map((p) => p.length)) * 3.4 + 1.8;

    if (y + altura > ALTURA - MARGEM - 8) {
      doc.addPage();
      y = MARGEM;
      imprimirCabecalho();
      corpo();
    }

    doc.setTextColor(35);
    partes.forEach((p, i) => doc.text(p, posicao(i), y, { align: t.alinhar[i] }));

    doc.setDrawColor(233);
    doc.setLineWidth(0.15);
    doc.line(MARGEM, y + altura - 3.4, LARGURA - MARGEM, y + altura - 3.4);
    y += altura;
  }

  return y + 2;
}
