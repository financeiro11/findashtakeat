import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Paperclip, Check, X, Trash2, Plus, ShoppingCart, ChevronsUpDown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot, StatusBadge } from "./components";
import {
  db, fmtBRL, parseValor, PIPELINE, STATUS_LABEL, FORMA_PAGAMENTO_LABEL, LIMITE_APROVACAO,
  type Solicitacao, type Cotacao, type Fornecedor, type SolicStatus,
} from "./lib";


export default function Solicitacoes() {
  const [loading, setLoading] = useState(true);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [sel, setSel] = useState<Solicitacao | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, q] = await Promise.all([
      db.from("facilities_solicitacoes").select("*").order("created_at", { ascending: false }),
      db.from("facilities_cotacoes").select("*"),
    ]);
    setSolicitacoes((s.data as Solicitacao[]) ?? []);
    setCotacoes((q.data as Cotacao[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const cotCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of cotacoes) m.set(q.solicitacao_id, (m.get(q.solicitacao_id) ?? 0) + 1);
    return m;
  }, [cotacoes]);

  const emAndamento = solicitacoes.filter((s) => s.status !== "comprado" && s.status !== "recusado");
  const valorMov = emAndamento.reduce((s, x) => s + Number(x.valor || 0), 0);

  const porStatus = (st: SolicStatus) => solicitacoes.filter((s) => s.status === st);

  return (
    <div className="space-y-4 p-5">
      <FacToolbar context="Pipeline de compras" onChanged={load} />

      <p className="text-[13px] text-muted-foreground">
        <span className="num font-semibold text-foreground">{emAndamento.length}</span> solicitações em andamento ·{" "}
        <span className="num font-semibold text-foreground">{fmtBRL(valorMov)}</span> em movimento
      </p>

      {loading ? (
        <Skeleton className="h-[420px] rounded-lg" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {PIPELINE.map((col) => {
            const itens = porStatus(col.key);
            const soma = itens.reduce((s, x) => s + Number(x.valor || 0), 0);
            return (
              <div key={col.key} className="flex flex-col rounded-lg border border-border bg-muted/20">
                <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                    <div>
                      <div className="text-[12.5px] font-semibold text-foreground">{col.label}</div>
                      <div className="num text-[11px] text-muted-foreground">{fmtBRL(soma)}</div>
                    </div>
                  </div>
                  <span className="num rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">{itens.length}</span>
                </div>
                <div className="flex-1 space-y-2 p-2">
                  {itens.map((it) => {
                    const n = cotCount.get(it.id) ?? 0;
                    return (
                      <button
                        key={it.id}
                        onClick={() => setSel(it)}
                        className="w-full rounded-md border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:shadow-sm"
                      >
                        <div className="text-[12.5px] font-medium leading-snug text-foreground">{it.titulo}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <CatDot cat={it.categoria} /> {it.categoria ?? "—"}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="num text-[13px] font-semibold text-foreground">{fmtBRL(it.valor)}</span>
                          {n > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Paperclip className="h-3 w-3" /> {n} cot.
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {itens.length === 0 && (
                    <div className="py-6 text-center text-[11px] text-muted-foreground/70">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SolicitacaoDetail
        solic={sel}
        cotacoes={cotacoes.filter((q) => q.solicitacao_id === sel?.id)}
        onClose={() => setSel(null)}
        onChanged={() => { load(); }}
      />
    </div>
  );
}

function SolicitacaoDetail({
  solic, cotacoes, onClose, onChanged,
}: {
  solic: Solicitacao | null;
  cotacoes: Cotacao[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [novoForn, setNovoForn] = useState("");
  const [novoValor, setNovoValor] = useState("");
  const [fornOpen, setFornOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // registrar compra
  const [forma, setForma] = useState<string>("cartao_corporativo");

  useEffect(() => {
    if (solic) db.from("facilities_fornecedores").select("*").order("nome").then((r: any) => setFornecedores(r.data ?? []));
    setNovoForn(""); setNovoValor(""); setForma("cartao_corporativo");
  }, [solic]);


  if (!solic) return null;

  const setStatus = async (status: SolicStatus, extra: Record<string, any> = {}) => {
    setBusy(true);
    const { error } = await db.from("facilities_solicitacoes").update({ status, ...extra }).eq("id", solic.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const addCotacao = async () => {
    const v = parseValor(novoValor);
    if (!novoForn.trim() || v == null) { toast.error("Informe fornecedor e valor"); return; }
    setBusy(true);
    const primeira = cotacoes.length === 0;
    const { error } = await db.from("facilities_cotacoes").insert({
      solicitacao_id: solic.id,
      fornecedor_nome: novoForn.trim(),
      valor: v,
      escolhida: primeira, // a primeira já entra como escolhida por padrão
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setNovoForn(""); setNovoValor("");
    // Se o valor desta cotação (ou de alguma já existente) supera o limite, envia para aprovação.
    const menor = Math.min(v, ...cotacoes.map((c) => Number(c.valor)));
    const precisaAprovacao = menor > LIMITE_APROVACAO;
    if (precisaAprovacao && solic.status !== "aprovado" && solic.status !== "aguardando_aprovacao") {
      await setStatus("aguardando_aprovacao");
      toast.info(`Compra acima de ${fmtBRL(LIMITE_APROVACAO)} — enviada para aprovação do financeiro.`);
    } else if (solic.status === "solicitado") {
      await setStatus("em_cotacao");
    } else {
      onChanged();
    }
  };


  const escolher = async (id: string) => {
    setBusy(true);
    await db.from("facilities_cotacoes").update({ escolhida: false }).eq("solicitacao_id", solic.id);
    const { error } = await db.from("facilities_cotacoes").update({ escolhida: true }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const removerCot = async (id: string) => {
    const { error } = await db.from("facilities_cotacoes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const registrarCompra = async () => {
    const escolhida = cotacoes.find((c) => c.escolhida) ?? cotacoes[0];
    const valor = escolhida?.valor ?? solic.valor ?? 0;
    setBusy(true);
    const { error: e1 } = await db.from("facilities_compras").insert({
      solicitacao_id: solic.id,
      data: new Date().toISOString().slice(0, 10),
      item: solic.titulo,
      fornecedor_id: escolhida?.fornecedor_id ?? null,
      fornecedor_nome: escolhida?.fornecedor_nome ?? null,
      categoria: solic.categoria,
      forma_pagamento: forma,
      nf_status: "pendente",
      valor,
    });
    if (e1) { setBusy(false); return toast.error(e1.message); }
    await setStatus("comprado");
    toast.success("Compra registrada no histórico");
  };

  const excluirSolic = async () => {
    if (!confirm(`Excluir a solicitação "${solic.titulo}"?`)) return;
    const { error } = await db.from("facilities_solicitacoes").delete().eq("id", solic.id);
    if (error) return toast.error(error.message);
    toast.success("Excluída");
    onClose(); onChanged();
  };

  const melhor = Math.min(...cotacoes.map((c) => Number(c.valor)), Infinity);

  return (
    <Dialog open={!!solic} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-[16px]">{solic.titulo}</DialogTitle>
            <StatusBadge status={solic.status} />
          </div>
          <DialogDescription className="flex items-center gap-1.5">
            <CatDot cat={solic.categoria} /> {solic.categoria ?? "Sem categoria"}
            {solic.solicitante ? ` · ${solic.solicitante}` : ""}
            {solic.valor != null ? ` · estimado ${fmtBRL(solic.valor)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {solic.observacao && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-[12.5px] text-muted-foreground">{solic.observacao}</p>
        )}

        {/* Status */}
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</Label>
          <Select value={solic.status} onValueChange={(v) => setStatus(v as SolicStatus)} disabled={busy}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABEL) as SolicStatus[]).map((k) => (
                <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Cotações */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Cotações</Label>
          {cotacoes.length > 0 && (
            <div className="space-y-1.5">
              {cotacoes.map((c) => {
                const isMelhor = Number(c.valor) === melhor;
                return (
                  <div key={c.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${c.escolhida ? "border-emerald-300 bg-emerald-50/50" : "border-border"}`}>
                    <button onClick={() => escolher(c.id)} title="Escolher" className={`flex h-4 w-4 items-center justify-center rounded-full border ${c.escolhida ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40"}`}>
                      {c.escolhida && <Check className="h-3 w-3" />}
                    </button>
                    <span className="flex-1 truncate text-[12.5px] text-foreground">{c.fornecedor_nome}</span>
                    {isMelhor && <span className="rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700">melhor</span>}
                    <span className="num text-[12.5px] font-semibold text-foreground">{fmtBRL(c.valor)}</span>
                    <button onClick={() => removerCot(c.id)} className="text-muted-foreground hover:text-primary"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Popover open={fornOpen} onOpenChange={setFornOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 flex-1 items-center justify-between rounded-md border border-input bg-background px-2.5 text-[12.5px] text-foreground hover:bg-accent/40"
                >
                  <span className={novoForn ? "" : "text-muted-foreground"}>
                    {novoForn || "Fornecedor"}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="start">
                <Command
                  filter={(value, search) => {
                    if (value === "__outro__") return 1;
                    return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                  }}
                >
                  <CommandInput placeholder="Buscar fornecedor…" className="h-9" />
                  <CommandList className="max-h-56">
                    <CommandEmpty>
                      <button
                        type="button"
                        className="text-[12.5px] text-primary hover:underline"
                        onClick={() => {
                          const el = document.querySelector<HTMLInputElement>('[cmdk-input=""]');
                          const v = el?.value?.trim();
                          if (v) { setNovoForn(v); setFornOpen(false); }
                        }}
                      >
                        Usar como novo fornecedor
                      </button>
                    </CommandEmpty>
                    <CommandGroup>
                      {fornecedores.map((f) => (
                        <CommandItem
                          key={f.id}
                          value={f.nome}
                          onSelect={(val) => { setNovoForn(val); setFornOpen(false); }}
                        >
                          {f.nome}
                        </CommandItem>
                      ))}
                      <CommandItem
                        value="__outro__"
                        onSelect={() => { setNovoForn("Outro"); setFornOpen(false); }}
                        className="text-muted-foreground"
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Outro (digitar)
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {novoForn === "Outro" && (
              <Input
                value={novoForn === "Outro" ? "" : novoForn}
                onChange={(e) => setNovoForn(e.target.value)}
                placeholder="Nome do fornecedor"
                className="h-8 flex-1"
                autoFocus
              />
            )}
            <Input value={novoValor} onChange={(e) => setNovoValor(e.target.value)} placeholder="R$" inputMode="decimal" className="h-8 w-24" />
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addCotacao} disabled={busy}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>

        </div>

        {/* Ações */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {solic.status === "aguardando_aprovacao" && (
            <>
              <Button size="sm" className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy}
                onClick={() => setStatus("aprovado", { decidido_por: profile?.nome ?? null, decidido_em: new Date().toISOString() })}>
                <Check className="h-4 w-4" /> Aprovar
              </Button>
              <Button size="sm" variant="outline" className="gap-1" disabled={busy}
                onClick={() => setStatus("recusado", { decidido_por: profile?.nome ?? null, decidido_em: new Date().toISOString() })}>
                <X className="h-4 w-4" /> Recusar
              </Button>
            </>
          )}
          {solic.status !== "comprado" && (
            <div className="flex items-center gap-2">
              <Select value={forma} onValueChange={setForma}>
                <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FORMA_PAGAMENTO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" className="gap-1" onClick={registrarCompra} disabled={busy}>
                <ShoppingCart className="h-4 w-4" /> Registrar compra
              </Button>
            </div>
          )}
          <button onClick={excluirSolic} className="ml-auto text-[12px] text-muted-foreground hover:text-primary">Excluir</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
