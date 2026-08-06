import { Fragment } from "react";
import type { NoTipTap } from "@/lib/mobile/notas";

/**
 * Leitura do documento do TipTap (`workspace_pages.content`) sem carregar o editor.
 *
 * O editor do desktop traz tabela, menu de bolha e arrastar bloco — nada disso funciona no
 * toque, e ainda são ~300 kB de JS por nota aberta. Aqui é só HTML: a nota abre rápido e
 * rola numa mão. Tabela ganha rolagem própria (regra da tela: a página nunca rola de lado).
 */

const CLASSE_TITULO: Record<number, string> = {
  1: "mt-5 text-[21px] font-bold leading-tight",
  2: "mt-5 text-[18px] font-bold leading-tight",
  3: "mt-4 text-[16px] font-semibold leading-snug",
  4: "mt-4 text-[15px] font-semibold",
  5: "mt-3 text-[14px] font-semibold",
  6: "mt-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground",
};

function Texto({ no }: { no: NoTipTap }) {
  let elemento: React.ReactNode = no.text ?? "";
  for (const marca of no.marks ?? []) {
    switch (marca.type) {
      case "bold": elemento = <strong className="font-semibold">{elemento}</strong>; break;
      case "italic": elemento = <em>{elemento}</em>; break;
      case "underline": elemento = <u>{elemento}</u>; break;
      case "strike": elemento = <s className="text-muted-foreground">{elemento}</s>; break;
      case "code": elemento = <code className="num rounded bg-secondary px-1 py-0.5 text-[13px]">{elemento}</code>; break;
      case "highlight": elemento = <mark className="rounded bg-yellow-500/25 px-0.5 text-foreground">{elemento}</mark>; break;
      case "link":
        elemento = (
          <a href={String(marca.attrs?.href ?? "#")} target="_blank" rel="noreferrer" className="text-primary underline-offset-2">
            {elemento}
          </a>
        );
        break;
      default: break; // textStyle/color e afins não mudam a leitura
    }
  }
  return <>{elemento}</>;
}

function Filhos({ nos }: { nos?: NoTipTap[] }) {
  return (
    <>
      {(nos ?? []).map((n, i) => (
        <Fragment key={i}><No no={n} /></Fragment>
      ))}
    </>
  );
}

function No({ no }: { no: NoTipTap }) {
  switch (no.type) {
    case "text": return <Texto no={no} />;
    case "hardBreak": return <br />;

    case "paragraph": {
      if (!no.content?.length) return <div className="h-3" />;
      return <p className="my-2.5 text-[16px] leading-relaxed"><Filhos nos={no.content} /></p>;
    }

    case "heading": {
      const nivel = Math.min(6, Math.max(1, Number(no.attrs?.level) || 1));
      const Tag = `h${nivel}` as "h1";
      return <Tag className={CLASSE_TITULO[nivel]}><Filhos nos={no.content} /></Tag>;
    }

    case "bulletList":
      return <ul className="my-2.5 list-disc space-y-1 pl-5 text-[16px] leading-relaxed"><Filhos nos={no.content} /></ul>;
    case "orderedList":
      return (
        <ol start={Number(no.attrs?.start) || 1} className="my-2.5 list-decimal space-y-1 pl-5 text-[16px] leading-relaxed">
          <Filhos nos={no.content} />
        </ol>
      );
    case "listItem":
      return <li className="[&>p]:my-0"><Filhos nos={no.content} /></li>;

    case "taskList":
      return <ul className="my-2.5 space-y-1.5"><Filhos nos={no.content} /></ul>;
    case "taskItem":
      return (
        <li className="flex items-start gap-2.5 text-[15px] leading-snug">
          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
            no.attrs?.checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
          }`}>
            {no.attrs?.checked ? "✓" : ""}
          </span>
          <span className={no.attrs?.checked ? "text-muted-foreground line-through [&>p]:my-0" : "[&>p]:my-0"}>
            <Filhos nos={no.content} />
          </span>
        </li>
      );

    case "blockquote":
      return <blockquote className="my-3 border-l-2 border-primary/40 pl-3 text-[15px] italic text-muted-foreground"><Filhos nos={no.content} /></blockquote>;

    case "codeBlock":
      return (
        <pre className="num my-3 overflow-x-auto rounded-lg bg-secondary p-3 text-[13px] leading-relaxed">
          <code>{(no.content ?? []).map((c) => c.text ?? "").join("")}</code>
        </pre>
      );

    case "horizontalRule":
      return <hr className="my-5 border-border" />;

    case "image":
      return (
        <img
          src={String(no.attrs?.src ?? "")}
          alt={String(no.attrs?.alt ?? "")}
          className="my-3 h-auto max-w-full rounded-lg"
          loading="lazy"
        />
      );

    case "table":
      return (
        <div className="-mx-4 my-3 overflow-x-auto px-4">
          <table className="w-max min-w-full border-collapse text-[13px]">
            <tbody><Filhos nos={no.content} /></tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr className="border-b border-border"><Filhos nos={no.content} /></tr>;
    case "tableHeader":
      return <th className="border border-border bg-secondary px-2 py-1.5 text-left font-semibold [&>p]:my-0"><Filhos nos={no.content} /></th>;
    case "tableCell":
      return <td className="border border-border px-2 py-1.5 align-top [&>p]:my-0"><Filhos nos={no.content} /></td>;

    default:
      // Nó desconhecido (extensão nova no desktop): renderiza os filhos em vez de sumir
      // com o texto — perder conteúdo em silêncio é o pior desfecho possível.
      return <Filhos nos={no.content} />;
  }
}

export function NotaConteudo({ doc }: { doc: unknown }) {
  const raiz = (doc ?? {}) as NoTipTap;
  if (!raiz.content?.length) {
    return <p className="py-6 text-center text-[13px] text-muted-foreground">Esta nota está vazia.</p>;
  }
  // `break-words`: nota do time costuma ter URL e id de título colados; sem isso uma
  // palavra longa empurra a página inteira para o lado.
  return <div className="break-words text-foreground"><Filhos nos={raiz.content} /></div>;
}

export default NotaConteudo;
