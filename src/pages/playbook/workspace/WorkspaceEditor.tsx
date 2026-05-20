import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Typography from "@tiptap/extension-typography";
import Dropcursor from "@tiptap/extension-dropcursor";
import { useEffect, useRef } from "react";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Highlighter, Link2, AlignLeft, AlignCenter, AlignRight, Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SlashCommand } from "./SlashCommand";

type Props = {
  value: any;
  onChange: (val: any) => void;
  pageId: string;
};

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#0f172a"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff"];

export function WorkspaceEditor({ value, onChange, pageId }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, dropcursor: false }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Subscript,
      Superscript,
      Typography,
      Dropcursor.configure({ color: "hsl(var(--primary))", width: 2 }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline underline-offset-2" } }),
      Image.configure({ HTMLAttributes: { class: "rounded-lg border my-3 max-w-full" } }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Título";
          return "Digite '/' para inserir blocos...";
        },
        showOnlyCurrent: false,
      }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
      SlashCommand,
    ],
    content: value && Object.keys(value).length ? value : { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: { class: "playbook-prose prose prose-base max-w-none focus:outline-none min-h-[60vh] py-4" },
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const it of Array.from(items)) {
          if (it.type.startsWith("image/")) {
            const file = it.getAsFile();
            if (file) { event.preventDefault(); uploadImage(file); return true; }
          }
        }
        return false;
      },
      handleDrop(_view, event) {
        const files = (event as DragEvent).dataTransfer?.files;
        if (files && files.length) {
          for (const f of Array.from(files)) {
            if (f.type.startsWith("image/")) { event.preventDefault(); uploadImage(f); return true; }
          }
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      editor.commands.setContent(value && Object.keys(value).length ? value : { type: "doc", content: [{ type: "paragraph" }] }, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  async function uploadImage(file: File) {
    try {
      const path = `${pageId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("workspace-assets").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("workspace-assets").getPublicUrl(path);
      editor?.chain().focus().setImage({ src: data.publicUrl }).run();
    } catch (e: any) {
      toast.error("Falha no upload", { description: e.message });
    }
  }

  async function uploadAndInsertFile(file: File) {
    try {
      const path = `${pageId}/files/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("workspace-assets").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("workspace-assets").getPublicUrl(path);
      editor?.chain().focus().insertContent(
        `<p>📎 <a href="${data.publicUrl}" target="_blank" rel="noreferrer">${file.name}</a></p>`
      ).run();
      toast.success("Arquivo anexado");
    } catch (e: any) {
      toast.error("Erro no upload", { description: e.message });
    }
  }

  if (!editor) return null;

  return (
    <div className="relative">
      <BubbleMenu editor={editor} className="flex items-center gap-0.5 rounded-lg border bg-popover px-1 py-1 shadow-xl">
        <BBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito"><Bold className="h-3.5 w-3.5"/></BBtn>
        <BBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico"><Italic className="h-3.5 w-3.5"/></BBtn>
        <BBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado"><UnderlineIcon className="h-3.5 w-3.5"/></BBtn>
        <BBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado"><Strikethrough className="h-3.5 w-3.5"/></BBtn>
        <Sep />
        <BBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Esquerda"><AlignLeft className="h-3.5 w-3.5"/></BBtn>
        <BBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Centro"><AlignCenter className="h-3.5 w-3.5"/></BBtn>
        <BBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Direita"><AlignRight className="h-3.5 w-3.5"/></BBtn>
        <Sep />
        <div className="group relative">
          <BBtn title="Cor"><Palette className="h-3.5 w-3.5"/></BBtn>
          <div className="invisible group-hover:visible absolute top-full mt-1 left-0 z-50 flex gap-1 rounded-md border bg-popover p-1.5 shadow-md">
            {COLORS.map(c => (
              <button key={c} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c).run(); }}
                className="h-5 w-5 rounded-full border" style={{ background: c }} />
            ))}
            <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); }} className="h-5 w-5 rounded-full border bg-background text-[9px]">×</button>
          </div>
        </div>
        <div className="group relative">
          <BBtn active={editor.isActive("highlight")} title="Marca-texto"><Highlighter className="h-3.5 w-3.5"/></BBtn>
          <div className="invisible group-hover:visible absolute top-full mt-1 left-0 z-50 flex gap-1 rounded-md border bg-popover p-1.5 shadow-md">
            {HIGHLIGHTS.map(c => (
              <button key={c} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: c }).run(); }}
                className="h-5 w-5 rounded-sm border" style={{ background: c }} />
            ))}
            <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetHighlight().run(); }} className="h-5 w-5 rounded-sm border bg-background text-[9px]">×</button>
          </div>
        </div>
        <Sep />
        <BBtn onClick={() => {
          const url = prompt("URL:");
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }} title="Link" active={editor.isActive("link")}><Link2 className="h-3.5 w-3.5"/></BBtn>
      </BubbleMenu>

      <input ref={fileInput} type="file" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) {
          if (f.type.startsWith("image/")) uploadImage(f);
          else uploadAndInsertFile(f);
        }
        e.target.value = "";
      }} />

      <EditorContent editor={editor} />
    </div>
  );
}

function BBtn({ active, onClick, children, title }: { active?: boolean; onClick?: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick?.(); }}
      className={`h-7 w-7 grid place-items-center rounded-md transition-colors ${active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"}`}
    >{children}</button>
  );
}
function Sep() { return <span className="mx-0.5 h-4 w-px bg-border" />; }
