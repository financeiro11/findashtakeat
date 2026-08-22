import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Paperclip, ExternalLink, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import {
  db, fmtBRL as fmtBRLStr, fmtData, FORMA_PAGAMENTO_LABEL, MESES_PT,
  PAGAMENTO_STATUS_OPTS,
  type Compra, type PagamentoStatus, type VinculoNf,
} from "./lib";
import { resolverComprovante } from "@/lib/comprovante";
import { comValorExato } from "@/components/ValorExato";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

type Filtro = { key: string; label: string };

function mesAtualKey() {
  const d = new Date();
  return `mes:${d.getFullYear()}-${d.getMonth()}`;
}

/** File → base64 puro (sem o prefixo `data:...;base64,`), que é o que a função espera. */
function lerBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ""));
    r.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    r.readAsDataURL(file);
  });
}

/* O que dizer na coluna NF. O ponto da tela é ele conseguir ver, sem sair do Hub
   dele, que a nota chegou na auditoria — é isso que faz o reenvio ser desnecessário. */
function selo(c: Compra, v?: VinculoNf) {
  if (!c.nf_arquivo && !c.nf_url) return null;
  if (v?.status === "aplicado") {
    return { txt: "na auditoria", cor: "text-emerald-600", dica: "A auditoria já aceitou esta nota como comprovante. Não precisa mandar de novo." };
  }
  if (v?.status === "proposto") {
    return { txt: "em conferência", cor: "text-sky-600", dica: "A nota chegou. O Financeiro está confirmando a qual lançamento ela pertence." };
  }
  return { txt: "guardada", cor: "text-muted-foreground", dica: "Nota guardada. Ela entra na auditoria assim que o lançamento correspondente aparecer (a fatura do cartão costuma demorar)." };
}

export default function Historico() {
  const [loading, setLoading] = useState(true);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [vinculos, setVinculos] = useState<Map<string, VinculoNf>>(new Map());
  const [filtro, setFiltro] = useState<string>(mesAtualKey());
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: vinc }] = await Promise.all([
      db.from("facilities_compras").select("*").order("data", { ascending: false }),
      db.from("facilities_nf_auditoria").select("id,compra_id,alvo_tipo,alvo_id_unico,confianca,status,score")
        .in("status", ["aplicado", "proposto"]),
    ]);
    setCompras((data as Compra[]) ?? []);
    // "aplicado" ganha de "proposto": é o desfecho, não a intenção.
    const mapa = new Map<string, VinculoNf>();
    for (const v of ((vinc as VinculoNf[]) ?? [])) {
      const atual = mapa.get(v.compra_id);
      if (!atual || (v.status === "aplicado" && atual.status !== "aplicado")) mapa.set(v.compra_id, v);
    }
    setVinculos(mapa);
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
    if (novo === "ok" && !c.nf_arquivo && !c.nf_url) {
      toast.error("Anexe a NF antes de marcar como OK.");
      return;
    }
    const { error } = await db.from("facilities_compras").update({ nf_status: novo }).eq("id", c.id);
    if (error) return toast.error(error.message);
    setCompras((prev) => prev.map((x) => x.id === c.id ? { ...x, nf_status: novo } : x));
  };

  const changePagStatus = async (c: Compra, novo: PagamentoStatus) => {
    if (novo === c.pagamento_status) return;
    const { error } = await db.from("facilities_compras").update({ pagamento_status: novo }).eq("id", c.id);
    if (error) return toast.error(error.message);
    setCompras((prev) => prev.map((x) => x.id === c.id ? { ...x, pagamento_status: novo } : x));
    toast.success("Status de pagamento atualizado.");
  };

  /* A NF sobe pela Edge Function, não direto do browser: o bucket da auditoria é
     privado e só tem policy de leitura — escrever exige service role. É o mesmo
     caminho do uploader da auditoria (auditoria-anexar-comprovante).

     A função guarda o arquivo, manda a IA transcrever a nota e já tenta casar com o
     lançamento que a auditoria ainda cobra. Por isso o toast fala do desfecho: é o
     retorno que diz a ele que a nota chegou lá e não precisa ser mandada de novo. */
  const anexarNf = async (c: Compra, file: File) => {
    setUploadingId(c.id);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Arquivo maior que 10 MB.");
      const base64 = await lerBase64(file);

      const { data, error } = await supabase.functions.invoke("facilities-nf-auditoria", {
        body: { action: "anexar", compra_id: c.id, nome: file.name, base64, mime: file.type || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await load();

      const casa = data?.casamento;
      if (casa?.aplicado) {
        toast.success("NF anexada e já lançada na auditoria — não precisa mandar de novo.");
      } else if (casa?.propostas > 0) {
        toast.success(`NF anexada. ${casa.propostas} lançamento(s) parecido(s) — o Financeiro confirma qual é.`);
      } else {
        toast.success("NF anexada. Ainda não há lançamento correspondente; ela entra assim que a fatura chegar.");
      }
      if (data?.aviso) toast.warning(data.aviso);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao anexar NF");
    } finally {
      setUploadingId(null);
    }
  };

  /** Abre a NF: caminho no bucket privado vira link assinado na hora. */
  const abrirNf = async (c: Compra) => {
    const alvo = c.nf_arquivo || c.nf_url;
    if (!alvo) return;
    try {
      window.open(await resolverComprovante(alvo), "_blank", "noopener");
    } catch (err: any) {
      toast.error(err?.message || "Não consegui abrir a NF.");
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
                  <th className="px-4 py-2.5 font-semibold">Status pagamento</th>
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
                        {(() => {
                          const pag = c.pagamento_status || "pendente";
                          const opt = PAGAMENTO_STATUS_OPTS.find((o) => o.key === pag) || PAGAMENTO_STATUS_OPTS[0];
                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-medium transition-opacity hover:opacity-80"
                                  style={{ backgroundColor: opt.bg, color: opt.color }}
                                  title="Alterar status de pagamento"
                                >
                                  {opt.label}
                                  <ChevronDown className="h-3 w-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="min-w-[160px]">
                                {PAGAMENTO_STATUS_OPTS.map((o) => (
                                  <DropdownMenuItem
                                    key={o.key}
                                    onClick={() => changePagStatus(c, o.key)}
                                    className="text-[12.5px]"
                                  >
                                    <span
                                      className="mr-2 inline-block h-2 w-2 rounded-full"
                                      style={{ backgroundColor: o.color }}
                                    />
                                    {o.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          );
                        })()}
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

                          {(() => {
                            const s = selo(c, vinculos.get(c.id));
                            return s ? (
                              <span className={cn("text-[11.5px]", s.cor)} title={s.dica}>
                                {s.txt}
                              </span>
                            ) : null;
                          })()}

                          {(c.nf_arquivo || c.nf_url) && (
                            <button
                              onClick={() => abrirNf(c)}
                              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                              title="Abrir NF"
                            >
                              <ExternalLink className="h-3 w-3" /> abrir
                            </button>
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
                            title={c.nf_arquivo || c.nf_url ? "Substituir NF" : "Anexar NF"}
                          >
                            {isUploading ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> enviando…</>
                            ) : (
                              <><Paperclip className="h-3 w-3" /> {c.nf_arquivo || c.nf_url ? "trocar" : "anexar"}</>
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

/* Os valores da tela saem sem centavos (fmtBRLStr); aqui eles viram um <span>
   que mostra o número cheio ao passar o mouse. Onde precisa ser string mesmo
   (toast, template literal, title), use fmtBRLStr direto. */
function fmtBRL(v: number | null | undefined, comCentavos = false) {
  return comValorExato(v, fmtBRLStr(v, comCentavos));
}
