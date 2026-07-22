import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Pencil, Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { brl } from "./utils";
import { WhatsAppBadge } from "@/components/brand-logos";

type Preview = {
  responsavel: string;
  colaborador_id: string | null;
  colaborador_nome: string | null;
  match_type: string | null;
  telefone: string | null;
  telefone_ok: boolean;
  qtd_itens: number;
  valor_total: number;
  formato: "lista" | "hibrido";
  competencia: string;
  id_unicos: string[];
  itens: any[];
  mensagem: string;
  prazo: string;
  erro?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  responsavel: string;
};

function initials(nome: string) {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] || "") + (parts[parts.length - 1][0] || "")).toUpperCase();
}
function maskPhone(tel: string | null) {
  if (!tel) return "—";
  const d = tel.replace(/\D/g, "");
  if (d.length < 10) return tel;
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : "55";
  const ddd = d.slice(-10, -8);
  return `+${cc} ${ddd} 9****-****`;
}

export default function SolicitarJustificativasModal({ open, onClose, onSent, responsavel }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const sendBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    setEditing(false);
    setPreview(null);
    (async () => {
      const { data, error } = await supabase.rpc("preview_msg_consolidada", { p_responsavel: responsavel });
      if (cancel) return;
      const p = data as unknown as Preview;
      if (error || (p && p.erro)) {
        toast.error(error?.message || p?.erro || "Erro ao carregar prévia");
        onClose();
        return;
      }
      setPreview(p);
      setMensagem(p?.mensagem || "");
      setLoading(false);
      setTimeout(() => sendBtnRef.current?.focus(), 50);
    })();
    return () => { cancel = true; };
  }, [open, responsavel]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const telefoneOk = !!preview?.telefone_ok;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nomeExibir = preview?.colaborador_nome || preview?.responsavel || responsavel;

  const handleSend = async () => {
    if (!preview || !telefoneOk) return;
    setSending(true);
    try {
      const { data: tokenData, error: tokErr } = await supabase.rpc("criar_token_e_registrar", {
        p_responsavel: preview.responsavel,
        p_id_unicos: preview.id_unicos,
        p_colaborador_id: preview.colaborador_id,
        p_telefone: preview.telefone,
        p_criado_por: user?.email ?? null,
      });
      if (tokErr || !tokenData || !(tokenData as any).token) {
        toast.error(tokErr?.message || "Falha ao gerar token");
        return;
      }
      const url = (tokenData as any).url as string;
      const mensagemFinal = mensagem.replace(
        "https://findashtakeat.lovable.app/l/{{TOKEN}}",
        url,
      );

      const { data, error } = await supabase.functions.invoke("enviar-consolidado", {
        body: {
          token: (tokenData as any).token,
          telefone: preview.telefone,
          mensagem_final: mensagemFinal,
          id_unicos: preview.id_unicos,
          enviado_por: user?.email ?? null,
        },
      });

      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || "Falha ao enviar");
        return;
      }

      const enviados = (data as any)?.enviados ?? preview.id_unicos.length;
      toast.success(`Mensagem enviada para ${nomeExibir} (${enviados} pendências)`);
      onSent();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Solicitar justificativas consolidadas via WhatsApp"
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
              {loading ? "…" : initials(nomeExibir)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {loading ? "Carregando…" : nomeExibir}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {loading ? "—" : maskPhone(preview?.telefone ?? null)}
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <MiniCard label="Qtd pendências" value={loading ? "…" : String(preview?.qtd_itens ?? 0)} />
            <MiniCard label="Valor total" value={loading ? "…" : brl(Number(preview?.valor_total ?? 0))} />
            <MiniCard label="Formato" value={loading ? "…" : (preview?.formato === "hibrido" ? "Resumo + top 3" : "Lista completa")} />
          </div>
        </div>

        <div className="flex justify-center py-3 flex-shrink-0">
          <span className="text-[11px] uppercase tracking-wide px-3 py-1 rounded-full bg-muted text-muted-foreground">
            Prévia da mensagem consolidada
          </span>
        </div>

        {/* WhatsApp area */}
        <div className="min-h-[220px] flex-1 overflow-y-auto px-5 py-4" style={{ backgroundColor: "#ECE5DD" }}>
          <div className="flex justify-end">
            <div className="max-w-[90%] rounded-lg px-3 py-2 shadow-sm" style={{ backgroundColor: "#DCF8C6" }}>
              {editing ? (
                <Textarea
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  rows={Math.max(8, mensagem.split("\n").length)}
                  className="border-0 bg-transparent focus-visible:ring-0 p-0 resize-none text-[13px] leading-[1.5] font-sans text-neutral-900"
                  style={{ minHeight: 160 }}
                  autoFocus
                />
              ) : (
                <pre
                  className="whitespace-pre-wrap break-words m-0 font-sans text-neutral-900"
                  style={{ fontSize: 13, lineHeight: 1.5 }}
                >
                  {loading ? "Carregando prévia…" : mensagem}
                </pre>
              )}
              <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-neutral-500">
                <span>{hhmm}</span>
                <Check className="h-3 w-3 -mr-1.5" />
                <Check className="h-3 w-3" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 border-t border-border flex-shrink-0">
          {preview && !telefoneOk && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Responsável sem telefone cadastrado em <strong>lib_colaboradores</strong>. Envio bloqueado. Peça pro RH atualizar o cadastro.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={sending}>Cancelar</Button>
            <Button variant="outline" onClick={() => setEditing(v => !v)} disabled={loading || sending}>
              {editing ? (<><Check className="h-4 w-4 mr-1.5" />Salvar edição</>) : (<><Pencil className="h-4 w-4 mr-1.5" />Editar texto</>)}
            </Button>
            <Button
              ref={sendBtnRef}
              onClick={handleSend}
              disabled={loading || sending || !telefoneOk}
              className="text-white"
              style={{ backgroundColor: "#0F6E56" }}
            >
              {sending ? (<><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Enviando…</>) : (<><WhatsAppBadge className="h-5 w-5 mr-1.5" />Enviar WhatsApp</>)}
            </Button>
          </div>
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
