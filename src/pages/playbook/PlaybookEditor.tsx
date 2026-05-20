import { useEditor, EditorContent, Editor } from "@tiptap/react";
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
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered,
  ListChecks, Link2, Minus, Code2, Table as TableIcon, ImagePlus, Quote,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  value: any;
  onChange: (val: any) => void;
  editable: boolean;
  playbookId?: string;
};

export function PlaybookEditor({ value, onChange, editable, playbookId }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
      Image.configure({ HTMLAttributes: { class: "rounded-md border my-2 max-w-full" } }),
      Placeholder.configure({ placeholder: "Comece a escrever o processo..." }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value && Object.keys(value).length ? value : { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: {
        class: "playbook-prose prose prose-base max-w-none focus:outline-none min-h-[55vh]",
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const it of Array.from(items)) {
          if (it.type.startsWith("image/")) {
            const file = it.getAsFile();
            if (file) {
              event.preventDefault();
              uploadImage(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files;
        if (files && files.length) {
          for (const f of Array.from(files)) {
            if (f.type.startsWith("image/")) {
              event.preventDefault();
              uploadImage(f);
              return true;
            }
          }
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      editor.commands.setContent(value && Object.keys(value).length ? value : { type: "doc", content: [{ type: "paragraph" }] }, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbookId]);

  async function uploadImage(file: File) {
    try {
      const path = `${playbookId ?? "temp"}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("playbook-assets").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("playbook-assets").getPublicUrl(path);
      editor?.chain().focus().setImage({ src: data.publicUrl }).run();
    } catch (e: any) {
      toast.error("Falha no upload da imagem", { description: e.message });
    }
  }

  if (!editor) return null;

  return (
    <div className="space-y-4">
      {editable && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-0.5 rounded-xl border bg-background/85 backdrop-blur-md px-2 py-1.5 shadow-sm">
          <ToolbarBtn label="Título 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Título 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Título 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4"/></ToolbarBtn>
          <Sep />
          <ToolbarBtn label="Negrito" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Itálico" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4"/></ToolbarBtn>
          <Sep />
          <ToolbarBtn label="Lista" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks className="h-4 w-4"/></ToolbarBtn>
          <Sep />
          <ToolbarBtn label="Citação" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Código" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Divisor" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Tabela" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Link" onClick={() => {
            const url = prompt("URL do link:");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}><Link2 className="h-4 w-4"/></ToolbarBtn>
          <ToolbarBtn label="Imagem" onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4"/></ToolbarBtn>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadImage(f);
            e.target.value = "";
          }} />
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarBtn({ active, onClick, children, label }: { active?: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={label}
      aria-label={label}
      className={`h-8 w-8 p-0 rounded-md transition-colors ${active ? "bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
function Sep() { return <span className="mx-1 h-5 w-px bg-border/70" />; }

