import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Paperclip, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import { db, fmtBRL, parseValor, CATEGORIAS, type Contrato, type Fornecedor } from "./lib";

const STATUS_STYLE: Record<string, string> = {
  ativo: "bg-emerald-50 text-emerald-700",
  renovar: "bg-amber-50 text-amber-700",
  encerrado: "bg-slate-100 text-slate-500",
};
const STATUS_LABEL: Record<string, string> = { ativo: "Ativo", renovar: "Renovar", encerrado: "Encerrado" };

function prazoTexto(c: Contrato): string {
  if (c.sem_prazo) return "Sem prazo — mensal";
  if (c.vence_em) {
    const dias = Math.ceil((new Date(c.vence_em + "T00:00:00").getTime() - Date.now()) / 86400000);
    if (dias >= 0 && dias <= 90) return `Vence em ${dias} dia${dias === 1 ? "" : "s"}`;
    const d = new Date(c.vence_em + "T00:00:00");
    return `Vence em ${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  if (c.renova_em) {
    const d = new Date(c.renova_em + "T00:00:00");
    return `Renova em ${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  return "—";
}

type ContratoAnexado = {
  kind: "anexo";
  fornecedor_id: string;
  fornecedor_nome: string;
  categoria: string | null;
  anexos: { nome: string; url: string }[];
};
type ContratoNormal = { kind: "contrato"; data: Contrato };
type ContratoRow = ContratoNormal | ContratoAnexado;

export default function Contratos() {
  const [loading, setLoading] = useState(true);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [edit, setEdit] = useState<Contrato | "novo" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [ct, fn] = await Promise.all([
      db.from("facilities_contratos").select("*").order("valor_mensal", { ascending: false }),
      db.from("facilities_fornecedores").select("*").order("nome"),
    ]);
    setContratos((ct.data as Contrato[]) ?? []);
    setFornecedores((fn.data as Fornecedor[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // fornecedores com contrato ativo E arquivos anexados
  const fornecedoresContrato = useMemo(
    () => fornecedores.filter((f) => f.tem_contrato && Array.isArray(f.contratos) && f.contratos.length > 0),
    [fornecedores],
  );

  // mapa nome (normalizado) → anexos, para enriquecer contratos formais que tenham arquivo no fornecedor
  const anexosPorNome = useMemo(() => {
    const m = new Map<string, { nome: string; url: string }[]>();
    for (const f of fornecedoresContrato) {
      m.set(f.nome.trim().toLowerCase(), f.contratos.map((a) => ({ nome: a.nome, url: a.url })));
    }
    return m;
  }, [fornecedoresContrato]);

  const linhas: ContratoRow[] = useMemo(() => {
    const nomesContrato = new Set(contratos.map((c) => c.fornecedor_nome.trim().toLowerCase()));
    const anexadas: ContratoRow[] = fornecedoresContrato
      // evita duplicar quando o mesmo fornecedor já tem contrato formal com valor
      .filter((f) => !nomesContrato.has(f.nome.trim().toLowerCase()))
      .map((f) => ({
        kind: "anexo" as const,
        fornecedor_id: f.id,
        fornecedor_nome: f.nome,
        categoria: f.categoria,
        anexos: f.contratos.map((a) => ({ nome: a.nome, url: a.url })),
      }));
    return [...contratos.map((c) => ({ kind: "contrato" as const, data: c })), ...anexadas];
  }, [contratos, fornecedoresContrato]);

  const totalMensal = contratos
    .filter((c) => c.status !== "encerrado")
    .reduce((s, c) => s + Number(c.valor_mensal || 0), 0);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Contratos ativos</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Serviços recorrentes e acordos com fornecedores — valores mensais, prazos e arquivos anexados.{" "}
          <span className="num font-semibold text-foreground">{fmtBRL(totalMensal)}</span>/mês em contratos ativos.
        </p>
      </div>
      <FacToolbar onChanged={load}>
        <Button variant="outline" className="h-9 gap-2" onClick={() => setEdit("novo")}>
          <Plus className="h-4 w-4" /> Novo contrato
        </Button>
      </FacToolbar>

      {loading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : linhas.length === 0 ? (
        <div className="card-surface py-16 text-center text-[13px] text-muted-foreground">
          Nenhum contrato cadastrado. Clique em <span className="font-medium text-foreground">Novo contrato</span>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {linhas.map((row) => {
            if (row.kind === "contrato") {
              const c = row.data;
              return (
                <button key={c.id} onClick={() => setEdit(c)} className="card-surface flex h-full flex-col p-5 text-left transition-colors hover:border-primary/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-foreground">
                      {c.fornecedor_nome}
                    </div>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS_STYLE[c.status])}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </div>
                  {c.descricao && (
                    <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">
                      {c.descricao}
                    </div>
                  )}
                  <div className="num mt-4 text-[24px] font-bold leading-none text-foreground">
                    {fmtBRL(c.valor_mensal)}
                    <span className="ml-1 text-[12px] font-normal text-muted-foreground">/mês</span>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-[12px]">
                    <span className="truncate text-muted-foreground">{prazoTexto(c)}</span>
                    <CatDot cat={c.categoria} label />
                  </div>
                </button>
              );
            }
            // linha vinda de Fornecedores (contrato ativo + anexo)
            return (
              <div key={`f-${row.fornecedor_id}`} className="card-surface p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[14px] font-semibold text-foreground">{row.fornecedor_nome}</div>
                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                    Do fornecedor
                  </span>
                </div>
                <div className="mt-1 text-[14px] text-muted-foreground">Contrato ativo com arquivo anexado</div>
                <div className="mt-3 space-y-1 border-t border-border pt-3">
                  {row.anexos.map((a, i) => (
                    <a
                      key={i}
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-[12px] text-foreground hover:text-primary hover:underline"
                    >
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{a.nome}</span>
                    </a>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[12px]">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Paperclip className="h-3 w-3" /> {row.anexos.length} anexo(s)
                  </span>
                  <CatDot cat={row.categoria} label />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ContratoDialog alvo={edit} onClose={() => setEdit(null)} onSaved={load} />
    </div>
  );
}

function ContratoDialog({ alvo, onClose, onSaved }: { alvo: Contrato | "novo" | null; onClose: () => void; onSaved: () => void }) {
  const isNovo = alvo === "novo";
  const c = alvo && alvo !== "novo" ? alvo : null;
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState("ativo");
  const [venceEm, setVenceEm] = useState("");
  const [semPrazo, setSemPrazo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNome(c?.fornecedor_nome ?? "");
    setDescricao(c?.descricao ?? "");
    setCategoria(c?.categoria ?? "");
    setValor(c ? String(c.valor_mensal) : "");
    setStatus(c?.status ?? "ativo");
    setVenceEm(c?.vence_em ?? "");
    setSemPrazo(c?.sem_prazo ?? false);
  }, [alvo]);

  const salvar = async () => {
    if (!nome.trim()) { toast.error("Informe o fornecedor"); return; }
    const v = parseValor(valor);
    if (v == null) { toast.error("Informe o valor mensal"); return; }
    setBusy(true);
    const payload = {
      fornecedor_nome: nome.trim(),
      descricao: descricao.trim() || null,
      categoria: categoria || null,
      valor_mensal: v,
      status,
      vence_em: semPrazo ? null : (venceEm || null),
      sem_prazo: semPrazo,
    };
    const { error } = c
      ? await db.from("facilities_contratos").update(payload).eq("id", c.id)
      : await db.from("facilities_contratos").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(c ? "Contrato atualizado" : "Contrato criado");
    onClose(); onSaved();
  };

  const excluir = async () => {
    if (!c) return;
    if (!confirm(`Excluir o contrato de "${c.fornecedor_nome}"?`)) return;
    const { error } = await db.from("facilities_contratos").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    onClose(); onSaved();
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNovo ? "Novo contrato" : "Editar contrato"}</DialogTitle>
          <DialogDescription>Serviço recorrente com valor mensal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Fornecedor</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: NetVix Telecom" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Internet dedicada 500 Mb — escritório" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valor mensal</Label>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0" inputMode="decimal" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="renovar">Renovar</SelectItem>
                  <SelectItem value="encerrado">Encerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vencimento</Label>
              <Input type="date" value={venceEm} onChange={(e) => setVenceEm(e.target.value)} disabled={semPrazo} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={semPrazo} onChange={(e) => setSemPrazo(e.target.checked)} className="h-4 w-4" />
            Sem prazo (mensal, sem vencimento)
          </label>
        </div>
        <DialogFooter className="items-center">
          {c && <button onClick={excluir} className="mr-auto text-[12px] text-muted-foreground hover:text-primary">Excluir</button>}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
