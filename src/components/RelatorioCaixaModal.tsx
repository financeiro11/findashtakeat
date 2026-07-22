import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Pencil, Check, Copy } from "lucide-react";
import { WhatsAppLogo } from "@/components/brand-logos";
import { toast } from "sonner";

// Destinatário fixo — Miguel Macedo de Carvalho Filho (CEO), lib_colaboradores
const MIGUEL = {
  nome: "Miguel Macedo",
  telefoneDigits: "5527996549956",
  telefoneMasc: "+55 27 9****-****",
};

type Props = {
  open: boolean;
  onClose: () => void;
  titulo: string;
  texto: string;
  onChangeTexto: (v: string) => void;
  onCopiar: () => void;
};

function initials(nome: string) {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts[parts.length - 1][0] || "")).toUpperCase();
}

// Renderiza *negrito* e _itálico_ do WhatsApp para a prévia visual
function renderWhatsApp(txt: string) {
  const html = txt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>");
  return { __html: html };
}

export default function RelatorioCaixaModal({
  open, onClose, titulo, texto, onChangeTexto, onCopiar,
}: Props) {
  const [editing, setEditing] = useState(false);
  if (!open) return null;

  const hhmm = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const enviar = () => {
    const url = `https://wa.me/${MIGUEL.telefoneDigits}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank");
    toast.success(`Abrindo WhatsApp para ${MIGUEL.nome}`);
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Prévia do relatório de caixa"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-lg w-full max-w-[620px] max-h-[90vh] min-h-0 flex flex-col border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-muted/50 rounded-t-xl px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-3">
            <div
              className="h-11 w-11 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
              style={{ backgroundColor: "#0F6E56" }}
            >
              {initials(MIGUEL.nome)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">{MIGUEL.nome}</div>
              <div className="text-xs text-muted-foreground font-mono">{MIGUEL.telefoneMasc}</div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <MiniCard label="Relatório" value={titulo || "Corte do dia"} />
            <MiniCard label="Destinatário" value="Miguel (CEO)" />
            <MiniCard label="Canal" value="WhatsApp" />
          </div>
        </div>

        <div className="flex justify-center py-3 flex-shrink-0">
          <span className="text-[11px] uppercase tracking-wide px-3 py-1 rounded-full bg-muted text-muted-foreground">
            Prévia do relatório de caixa
          </span>
        </div>

        {/* WhatsApp area */}
        <div className="min-h-[220px] flex-1 overflow-y-auto px-5 py-4" style={{ backgroundColor: "#ECE5DD" }}>
          {editing ? (
            <Textarea
              value={texto}
              onChange={(e) => onChangeTexto(e.target.value)}
              className="w-full h-full min-h-[300px] bg-white border border-border rounded-lg p-3 resize-none text-[13px] leading-[1.5] font-sans text-neutral-900 focus-visible:ring-1"
              autoFocus
            />
          ) : (
            <div className="flex justify-end">
              <div className="max-w-[92%] rounded-lg px-3 py-2 shadow-sm" style={{ backgroundColor: "#DCF8C6" }}>
                <div
                  className="whitespace-pre-wrap break-words m-0 font-sans text-neutral-900"
                  style={{ fontSize: 13, lineHeight: 1.5 }}
                  dangerouslySetInnerHTML={renderWhatsApp(texto)}
                />
                <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-neutral-500">
                  <span>{hhmm}</span>
                  <Check className="h-3 w-3 -mr-1.5" />
                  <Check className="h-3 w-3" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 flex flex-wrap items-center justify-end gap-2 border-t border-border flex-shrink-0">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="outline" onClick={onCopiar}>
            <Copy className="h-4 w-4 mr-1.5" /> Copiar
          </Button>
          <Button variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? (<><Check className="h-4 w-4 mr-1.5" />Salvar edição</>) : (<><Pencil className="h-4 w-4 mr-1.5" />Editar texto</>)}
          </Button>
          <Button onClick={enviar} className="text-white" style={{ backgroundColor: "#0F6E56" }}>
            <WhatsAppLogo className="h-4 w-4 mr-1.5" /> Enviar WhatsApp
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MiniCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-medium text-foreground truncate mt-0.5">{value}</div>
    </div>
  );
}
