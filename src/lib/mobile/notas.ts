// Ponte entre o documento do editor rico (TipTap, `workspace_pages.content`) e o texto
// simples que dá para editar no celular.
//
// O editor do desktop (WorkspaceEditor / TipTap com tabela, imagem, bolha de seleção) não
// funciona no toque, então o mobile abre a nota em LEITURA. Editar é opcional e só onde é
// seguro: `podeEditarNoCelular` recusa qualquer nota que use algo fora do subconjunto
// abaixo. Salvar um texto simples por cima de uma nota com tabela ou imagem apagaria o
// conteúdo — perder nota do time é pior do que não poder editar no celular.

export type NoTipTap = {
  type?: string;
  content?: NoTipTap[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
  attrs?: Record<string, any>;
};

/** Nós que o texto simples consegue representar sem perder informação. */
const NOS_SUPORTADOS = new Set([
  "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem",
  "blockquote", "codeBlock", "text", "hardBreak", "horizontalRule",
]);
/** Marcas idem. `underline`, `highlight`, `textStyle` etc. tornam a nota só-leitura. */
const MARCAS_SUPORTADAS = new Set(["bold", "italic", "code", "link"]);

function percorrer(no: NoTipTap | null | undefined, visita: (n: NoTipTap) => void) {
  if (!no || typeof no !== "object") return;
  visita(no);
  (no.content ?? []).forEach((f) => percorrer(f, visita));
}

export function podeEditarNoCelular(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return true; // nota vazia/nova
  let ok = true;
  percorrer(doc as NoTipTap, (n) => {
    if (n.type && !NOS_SUPORTADOS.has(n.type)) ok = false;
    for (const m of n.marks ?? []) if (!MARCAS_SUPORTADAS.has(m.type)) ok = false;
  });
  return ok;
}

/* ------------------------------ documento → texto ------------------------------ */
function inlineParaTexto(filhos: NoTipTap[] | undefined): string {
  return (filhos ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "\n";
      if (n.type !== "text") return inlineParaTexto(n.content);
      let t = n.text ?? "";
      const marcas = n.marks ?? [];
      const tem = (tipo: string) => marcas.some((m) => m.type === tipo);
      if (tem("code")) t = `\`${t}\``;
      if (tem("bold")) t = `**${t}**`;
      if (tem("italic")) t = `*${t}*`;
      const link = marcas.find((m) => m.type === "link");
      if (link?.attrs?.href) t = `[${t}](${link.attrs.href})`;
      return t;
    })
    .join("");
}

export function docParaTexto(doc: unknown): string {
  const raiz = (doc ?? {}) as NoTipTap;
  const blocos: string[] = [];

  const escreverLista = (no: NoTipTap, ordenada: boolean) => {
    const linhas = (no.content ?? []).map((item, i) => {
      const marcador = ordenada ? `${(Number(no.attrs?.start) || 1) + i}. ` : "- ";
      const corpo = (item.content ?? []).map((p) => inlineParaTexto(p.content)).join("\n");
      return marcador + corpo.replace(/\n/g, "\n  ");
    });
    blocos.push(linhas.join("\n"));
  };

  for (const no of raiz.content ?? []) {
    switch (no.type) {
      case "heading":
        blocos.push(`${"#".repeat(Math.min(6, Number(no.attrs?.level) || 1))} ${inlineParaTexto(no.content)}`);
        break;
      case "bulletList": escreverLista(no, false); break;
      case "orderedList": escreverLista(no, true); break;
      case "blockquote":
        blocos.push((no.content ?? []).map((p) => `> ${inlineParaTexto(p.content)}`).join("\n"));
        break;
      case "codeBlock":
        blocos.push(["```", inlineParaTexto(no.content), "```"].join("\n"));
        break;
      case "horizontalRule":
        blocos.push("---");
        break;
      default:
        blocos.push(inlineParaTexto(no.content));
    }
  }
  return blocos.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Texto corrido, sem marcação — usado na prévia do card da lista. */
export function resumoDoc(doc: unknown, max = 120): string {
  let txt = "";
  percorrer(doc as NoTipTap, (n) => {
    if (n.type === "text" && n.text) txt += (txt ? " " : "") + n.text;
  });
  txt = txt.replace(/\s+/g, " ").trim();
  return txt.length > max ? `${txt.slice(0, max - 1)}…` : txt;
}

/* ------------------------------ texto → documento ------------------------------ */
const RE_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/;
const RE_CODE = /`([^`]+)`/;
const RE_NEGRITO = /\*\*([^*]+)\*\*/;
const RE_ITALICO = /\*([^*]+)\*/;

function textoParaInline(texto: string): NoTipTap[] {
  if (!texto) return [];
  const saida: NoTipTap[] = [];

  for (const pedaco of texto.split("\n")) {
    if (saida.length) saida.push({ type: "hardBreak" });
    let resto = pedaco;
    while (resto) {
      const casos = [
        { re: RE_LINK, marca: "link" },
        { re: RE_CODE, marca: "code" },
        { re: RE_NEGRITO, marca: "bold" },
        { re: RE_ITALICO, marca: "italic" },
      ]
        .map((c) => ({ ...c, m: c.re.exec(resto) }))
        .filter((c) => c.m)
        .sort((a, b) => a.m!.index - b.m!.index);

      const primeiro = casos[0];
      if (!primeiro) { saida.push({ type: "text", text: resto }); break; }

      const m = primeiro.m!;
      if (m.index > 0) saida.push({ type: "text", text: resto.slice(0, m.index) });
      const conteudo = m[1];
      if (conteudo) {
        saida.push({
          type: "text",
          text: conteudo,
          marks: primeiro.marca === "link"
            ? [{ type: "link", attrs: { href: m[2] } }]
            : [{ type: primeiro.marca }],
        });
      }
      resto = resto.slice(m.index + m[0].length);
    }
  }
  return saida.filter((n) => n.type !== "text" || n.text);
}

const paragrafo = (texto: string): NoTipTap => {
  const filhos = textoParaInline(texto);
  return filhos.length ? { type: "paragraph", content: filhos } : { type: "paragraph" };
};

export function textoParaDoc(texto: string): NoTipTap {
  const linhas = (texto ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocos: NoTipTap[] = [];
  let i = 0;

  const eBloco = (l: string) =>
    /^\s*$/.test(l) || /^#{1,6}\s+/.test(l) || /^[-*]\s+/.test(l) ||
    /^\d+[.)]\s+/.test(l) || /^>\s?/.test(l) || /^```/.test(l) || /^(-{3,}|\*{3,})\s*$/.test(l);

  while (i < linhas.length) {
    const linha = linhas[i];

    if (/^\s*$/.test(linha)) { i++; continue; }

    if (/^```/.test(linha)) {
      const corpo: string[] = [];
      i++;
      while (i < linhas.length && !/^```/.test(linhas[i])) corpo.push(linhas[i++]);
      i++; // fecha a cerca
      blocos.push({ type: "codeBlock", content: corpo.length ? [{ type: "text", text: corpo.join("\n") }] : [] });
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(linha)) { blocos.push({ type: "horizontalRule" }); i++; continue; }

    const tit = /^(#{1,6})\s+(.*)$/.exec(linha);
    if (tit) {
      blocos.push({ type: "heading", attrs: { level: tit[1].length }, content: textoParaInline(tit[2]) });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(linha)) {
      const itens: NoTipTap[] = [];
      while (i < linhas.length && /^[-*]\s+/.test(linhas[i])) {
        itens.push({ type: "listItem", content: [paragrafo(linhas[i].replace(/^[-*]\s+/, ""))] });
        i++;
      }
      blocos.push({ type: "bulletList", content: itens });
      continue;
    }

    if (/^\d+[.)]\s+/.test(linha)) {
      const inicio = Number(/^(\d+)/.exec(linha)![1]) || 1;
      const itens: NoTipTap[] = [];
      while (i < linhas.length && /^\d+[.)]\s+/.test(linhas[i])) {
        itens.push({ type: "listItem", content: [paragrafo(linhas[i].replace(/^\d+[.)]\s+/, ""))] });
        i++;
      }
      blocos.push({ type: "orderedList", attrs: { start: inicio }, content: itens });
      continue;
    }

    if (/^>\s?/.test(linha)) {
      const dentro: NoTipTap[] = [];
      while (i < linhas.length && /^>\s?/.test(linhas[i])) {
        dentro.push(paragrafo(linhas[i].replace(/^>\s?/, "")));
        i++;
      }
      blocos.push({ type: "blockquote", content: dentro });
      continue;
    }

    // Parágrafo: linhas seguidas viram quebras leves dentro do mesmo bloco.
    const corpo: string[] = [];
    while (i < linhas.length && !eBloco(linhas[i])) corpo.push(linhas[i++]);
    blocos.push(paragrafo(corpo.join("\n")));
  }

  return { type: "doc", content: blocos.length ? blocos : [{ type: "paragraph" }] };
}
