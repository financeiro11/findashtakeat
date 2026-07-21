import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Paperclip, ExternalLink, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import {
  db, fmtBRL, fmtData, FORMA_PAGAMENTO_LABEL, MESES_PT,
  PAGAMENTO_STATUS_OPTS,
  type Compra, type PagamentoStatus,
} from "./lib";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

type Filtro = { key: string; label: string };

const NF_BUCKET = "facilities-contratos"; // bucket público já existente

function mesAtualKey() {
  const d = new Date();
  return `mes:${d.getFullYear()}-${d.getMonth()}`;
}

export default function Historico() {
  const [loading, setLoading] = useState(true);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [filtro, setFiltro] = useState<string>(mesAtualKey());
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await db.from("facilities_compras").select("*").order("data", { ascending: false });
    setCompras((data as Compra[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtros: Filtro[] = useMemo(() => {
    const meses = new Map<string, string>();
    const hoje = new Date();
    const chaveAtual = `mes:${hoje.getFullYear()}-${hoje.getMonth()}`;
    meses.set(chaveAtual, MESES_PT[hoje.getMonth()]);
    for (const c of compras) {
      const d = new Date(c.data + "T00:00:00");
      const key = `mes:${d.getFullYear()}-${d.getMonth()}`;
      if (!meses.has(key)) meses.set(key, MESES_PT[d.getMonth()]);
    }
    const mesFiltros = [...meses.entries()].slice(0, 4).map(([key, label]) => ({ key, label }));
    return [...mesFiltros, { key: "todas", label: "Todas" }, { key: "sem_nf", label: "NF pendente" }];
  }, [compras]);

  const filtradas = useMemo(() => {
    if (filtro === "todas") return compras;
    if (filtro === "sem_nf") return compras.filter((c) => c.nf_status !== "ok");
    if (filtro.startsWith("mes:")) {
      const [y, m] = filtro.slice(4).split("-").map(Number);
      return compras.filter((c) => {
        const d = new Date(c.data + "T00:00:00");
        return d.getFullYear() === y && d.getMonth() === m;
      });
    }
    return compras;
  }, [compras, filtro]);

  const total = filtradas.reduce((s, c) => s + Number(c.valor || 0), 0);

  const toggleNf = async (c: Compra) => {
    // Só permite marcar manualmente como OK se já houver anexo.
    // Sem anexo, o toggle vira "pendente" (útil pra reverter).
    const novo = c.nf_status === "ok" ? "pendente" : "ok";
    if (novo === "ok" && !c.nf_url) {
      toast.error("Anexe a NF antes de marcar como OK.");
      return;
    }
    const { error } = await db.from("facilities_compras").update({ nf_status: novo }).eq("id", c.id);
    if (error) return toast.error(error.message);
    setCompras((prev) => prev.map((x) => x.id === c.id ? { ...x, nf_status: novo } : x));
  };

  const anexarNf = async (c: Compra, file: File) => {
    setUploadingId(c.id);
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const path = `nf/${c.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(NF_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(NF_BUCKET).getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: dbErr } = await db
        .from("facilities_compras")
        .update({ nf_url: url, nf_status: "ok" })
        .eq("id", c.id);
      if (dbErr) throw dbErr;
      setCompras((prev) => prev.map((x) => x.id === c.id ? { ...x, nf_url: url, nf_status: "ok" } : x));
      toast.success("NF anexada com sucesso.");
    } catch (err: any) {
      toast.error(err?.message || "Falha ao anexar NF");
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Histórico de compras</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Todas as compras já registradas — filtre por período, forma de pagamento e status da NF, e anexe notas fiscais pendentes.
        </p>
      </div>

      <FacToolbar onChanged={load} />

      <div className="card-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">Compras realizadas</h3>
            <p className="text-[12px] text-muted-foreground">
              <span className="num">{filtradas.length}</span> compra(s) · <span className="num">{fmtBRL(total)}</span> no total
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filtros.map((f) => (
              <button
                key={f.key}
                onClick={() => setFiltro(f.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                  filtro === f.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <Skeleton className="m-4 h-64 rounded" />
        ) : filtradas.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-muted-foreground">Nenhuma compra registrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Data</th>
                  <th className="px-4 py-2.5 font-semibold">Item</th>
                  <th className="px-4 py-2.5 font-semibold">Fornecedor</th>
                  <th className="px-4 py-2.5 font-semibold">Pagamento</th>
                  <th className="px-4 py-2.5 font-semibold">NF</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => {
                  const isUploading = uploadingId === c.id;
                  return (
                    <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                      <td className="num px-5 py-2.5 text-[12.5px] text-muted-foreground">{fmtData(c.data)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <CatDot cat={c.categoria} />
                          <span className="text-[13px] text-foreground">{c.item}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground">{c.fornecedor_nome || "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-foreground">
                          {c.forma_pagamento ? FORMA_PAGAMENTO_LABEL[c.forma_pagamento] : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {c.nf_status === "ok" ? (
                            <button
                              onClick={() => toggleNf(c)}
                              className="inline-flex items-center gap-1 text-[12px] text-emerald-600"
                              title="Clique para reverter para pendente"
                            >
                              <Check className="h-3.5 w-3.5" /> NF
                            </button>
                          ) : (
                            <span className="text-[12px] text-amber-600">pendente</span>
                          )}

                          {c.nf_url && (
                            <a
                              href={c.nf_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                              title="Abrir NF"
                            >
                              <ExternalLink className="h-3 w-3" /> abrir
                            </a>
                          )}

                          <input
                            ref={(el) => { fileInputs.current[c.id] = el; }}
                            type="file"
                            accept="application/pdf,image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) anexarNf(c, f);
                              e.target.value = "";
                            }}
                          />
                          <button
                            onClick={() => fileInputs.current[c.id]?.click()}
                            disabled={isUploading}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-muted disabled:opacity-60"
                            title={c.nf_url ? "Substituir NF" : "Anexar NF"}
                          >
                            {isUploading ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> enviando…</>
                            ) : (
                              <><Paperclip className="h-3 w-3" /> {c.nf_url ? "trocar" : "anexar"}</>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="num px-5 py-2.5 text-right text-[13px] font-semibold text-foreground">{fmtBRL(c.valor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
