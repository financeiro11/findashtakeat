import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { Instance as TippyInstance } from "tippy.js";
import { useEffect, useImperativeHandle, useState, forwardRef } from "react";
import {
  Heading1, Heading2, Heading3, List, ListOrdered, ListChecks,
  Quote, Code2, Minus, Table as TableIcon, Image as ImageIcon,
  ChevronRight, Pilcrow, AlertCircle, Smile,
} from "lucide-react";

type Item = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  command: (props: { editor: any; range: any }) => void;
};

const ITEMS: Item[] = [
  { title: "Texto", description: "Comece a escrever um parágrafo.", icon: Pilcrow, keywords: ["texto", "paragrafo", "p"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
  { title: "Título 1", description: "Cabeçalho grande.", icon: Heading1, keywords: ["h1", "titulo"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run() },
  { title: "Título 2", description: "Cabeçalho médio.", icon: Heading2, keywords: ["h2"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run() },
  { title: "Título 3", description: "Cabeçalho menor.", icon: Heading3, keywords: ["h3"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run() },
  { title: "Lista", description: "Lista com marcadores.", icon: List, keywords: ["lista", "bullet", "ul"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: "Lista numerada", description: "Lista 1, 2, 3.", icon: ListOrdered, keywords: ["numerada", "ol"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: "Checklist", description: "Tarefas com checkbox.", icon: ListChecks, keywords: ["check", "todo", "task"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
  { title: "Citação", description: "Bloco de citação.", icon: Quote, keywords: ["quote", "citacao"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { title: "Código", description: "Bloco de código.", icon: Code2, keywords: ["codigo", "code"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { title: "Callout", description: "Destaque informativo.", icon: AlertCircle, keywords: ["callout", "info"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "💡 ", marks: [] }] }]
    }).run() },
  { title: "Toggle", description: "Bloco recolhível.", icon: ChevronRight, keywords: ["toggle", "details"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent(
      `<details><summary>Toggle</summary><p>Conteúdo recolhível...</p></details>`
    ).run() },
  { title: "Divisor", description: "Linha horizontal.", icon: Minus, keywords: ["divisor", "hr", "linha"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  { title: "Tabela", description: "Tabela 3x3.", icon: TableIcon, keywords: ["tabela", "table"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Imagem", description: "Insira uma imagem por URL.", icon: ImageIcon, keywords: ["imagem", "image", "img"],
    command: ({ editor, range }) => {
      const url = prompt("URL da imagem:");
      if (url) editor.chain().focus().deleteRange(range).setImage({ src: url }).run();
      else editor.chain().focus().deleteRange(range).run();
    } },
  { title: "Emoji", description: "Inserir emoji.", icon: Smile, keywords: ["emoji"],
    command: ({ editor, range }) => {
      const e = prompt("Cole um emoji (ex: 🚀):");
      editor.chain().focus().deleteRange(range).insertContent(e || "").run();
    } },
];

const SlashList = forwardRef<any, { items: Item[]; command: (it: Item) => void }>((props, ref) => {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [props.items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === "ArrowUp") { setSelected((s) => (s + props.items.length - 1) % props.items.length); return true; }
      if (event.key === "ArrowDown") { setSelected((s) => (s + 1) % props.items.length); return true; }
      if (event.key === "Enter") { const it = props.items[selected]; if (it) props.command(it); return true; }
      return false;
    },
  }));
  return (
    <div className="w-72 max-h-80 overflow-y-auto rounded-xl border bg-popover shadow-xl p-1">
      {props.items.length === 0 && (
        <div className="px-3 py-4 text-xs text-muted-foreground">Nenhum bloco encontrado</div>
      )}
      {props.items.map((it, i) => {
        const Icon = it.icon;
        return (
          <button
            key={it.title}
            onClick={() => props.command(it)}
            className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${i === selected ? "bg-accent" : "hover:bg-accent/60"}`}
          >
            <span className="grid h-8 w-8 place-items-center rounded-md border bg-background">
              <Icon className="h-4 w-4 text-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-tight">{it.title}</span>
              <span className="block text-[11px] text-muted-foreground truncate">{it.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});
SlashList.displayName = "SlashList";

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }: any) => props.command({ editor, range }),
      },
    } as any;
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...(this.options as any).suggestion,
        items: ({ query }: any) => {
          const q = query.toLowerCase();
          return ITEMS.filter((i) =>
            i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q))
          ).slice(0, 12);
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: TippyInstance[] = [];
          return {
            onStart: (props: any) => {
              component = new ReactRenderer(SlashList, { props, editor: props.editor });
              popup = tippy("body", {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },
            onUpdate(props: any) { component?.updateProps(props); popup[0]?.setProps({ getReferenceClientRect: props.clientRect }); },
            onKeyDown(props: any) {
              if (props.event.key === "Escape") { popup[0]?.hide(); return true; }
              return (component?.ref as any)?.onKeyDown(props);
            },
            onExit() { popup[0]?.destroy(); component?.destroy(); },
          };
        },
      }),
    ];
  },
});
