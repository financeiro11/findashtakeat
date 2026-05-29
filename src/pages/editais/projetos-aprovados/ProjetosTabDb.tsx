import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtBRL } from "../types";
import {
  Plus, ShoppingCart, Trash2, Zap, FileWarning, ChevronRight, ChevronDown,
  Wallet, FolderPlus, Pencil, FileText, Save, X,
} from "lucide-react";

type Projeto = {
  id: string; nome: string; orgao: string | null;
  valor_aprovado: number; valor_contrapartida: number;
  data_inicio: string | null; duracao_meses: number | null; prazo_final: string | null;
  status: string; observacao: string | null;
};
type Rubrica = {
  id: string; projeto_id: string; parent_id: string | null;
  categoria: string; valor_planejado: number; obrigatorio: boolean; ordem: number;
};
type Parcela = {
  id: string; projeto_id: string; numero: number; descricao: string | null;
  valor: number; recebido: boolean; data_prevista: string | null; data_recebimento: string | null;
};
type Compra = {
  id: string; projeto_id: string; rubrica_id: string; data: string;
  descricao: string; fornecedor: string | null; valor: number;
  nf_numero: string | null; nf_anexada: boolean; status: string; observacao: string | null;
};

const sb = supabase as any;

export default function ProjetosTabDb() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [rubricas, setRubricas] = useState<Rubrica[]>([]);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    const [p, r, pa, c] = await Promise.all([
      sb.from("projetos_aprovados").select("*").order("ordem"),
      sb.from("projetos_aprovados_rubricas").select("*").order("ordem"),
      sb.from("projetos_aprovados_parcelas").select("*").order("numero"),
      sb.from("projetos_aprovados_compras").select("*").order("data", { ascending: false }),
    ]);
    if (p.error || r.error || pa.error || c.error) {
      toast.error("Falha ao carregar projetos");
      setLoading(false); return;
    }
    setProjetos(p.data ?? []); setRubricas(r.data ?? []);
    setParcelas(pa.data ?? []); setCompras(c.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const gastoPorRubrica = useMemo(() => {
    const m = new Map<string, number>();
    compras.filter(c => c.status !== "Cancelada").forEach(c => {
      m.set(c.rubrica_id, (m.get(c.rubrica_id) ?? 0) + Number(c.valor || 0));
    });
    // soma filhos no pai
    rubricas.forEach(r => {
      if (r.parent_id) {
        m.set(r.parent_id, (m.get(r.parent_id) ?? 0) + (m.get(r.id) ?? 0));
      }
    });
    return m;
  }, [compras, rubricas]);

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">
          {projetos.length} projeto{projetos.length !== 1 ? "s" : ""} cadastrado{projetos.length !== 1 ? "s" : ""} · {compras.length} compra{compras.length !== 1 ? "s" : ""} lançada{compras.length !== 1 ? "s" : ""}
        </span>
        <ProjetoDialog onSaved={load} />
      </div>

      {projetos.map(p => (
        <ProjetoCard
          key={p.id}
          projeto={p}
          rubricas={rubricas.filter(r => r.projeto_id === p.id)}
          parcelas={parcelas.filter(pa => pa.projeto_id === p.id)}
          compras={compras.filter(c => c.projeto_id === p.id)}
          gastoPorRubrica={gastoPorRubrica}
          expanded={expanded}
          setExpanded={setExpanded}
          onChanged={load}
        />
      ))}

      {projetos.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum projeto cadastrado ainda. Clique em "Novo projeto" para começar.
        </Card>
      )}
    </div>
  );
}

/* ───────── Projeto card ───────── */

function ProjetoCard({
  projeto, rubricas, parcelas, compras, gastoPorRubrica, expanded, setExpanded, onChanged,
}: {
  projeto: Projeto; rubricas: Rubrica[]; parcelas: Parcela[]; compras: Compra[];
  gastoPorRubrica: Map<string, number>;
  expanded: Record<string, boolean>; setExpanded: (v: any) => void;
  onChanged: () => void;
}) {
  const roots = rubricas.filter(r => !r.parent_id).sort((a, b) => a.ordem - b.ordem);
  const childrenOf = (id: string) => rubricas.filter(r => r.parent_id === id).sort((a, b) => a.ordem - b.ordem);

  const totalPlanejado = roots.reduce((s, r) => s + Number(r.valor_planejado), 0);
  const totalGasto = roots.reduce((s, r) => s + (gastoPorRubrica.get(r.id) ?? 0), 0);
  const totalSaldo = totalPlanejado - totalGasto;
  const pctTotal = totalPlanejado > 0 ? (totalGasto / totalPlanejado) * 100 : 0;

  const toggle = (id: string) => setExpanded((e: any) => ({ ...e, [id]: !e[id] }));

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold tracking-tight">{projeto.nome}</h3>
          {projeto.orgao && <span className="text-[11px] text-muted-foreground">· {projeto.orgao}</span>}
          <Badge variant="outline" className="text-[10.5px] font-normal">{projeto.status}</Badge>
          {projeto.prazo_final && (
            <Badge variant="outline" className="text-[10.5px] font-normal bg-rose-500/5 text-rose-700 border-rose-500/20">
              prazo {new Date(projeto.prazo_final).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span>Aprovado: <b className="num text-foreground">{fmtBRL(Number(projeto.valor_aprovado))}</b></span>
            <span>Executado: <b className="num text-foreground">{fmtBRL(totalGasto)}</b></span>
            <span>Saldo: <b className={cn("num", totalSaldo < 0 ? "text-rose-600" : "text-emerald-700")}>{fmtBRL(totalSaldo)}</b></span>
          </div>
          <ProjetoDialog projeto={projeto} onSaved={onChanged} />
        </div>
      </div>

      {/* Resumo barra */}
      <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full",
              pctTotal > 100 ? "bg-rose-500" : pctTotal >= 85 ? "bg-orange-500" : pctTotal >= 60 ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${Math.min(100, pctTotal)}%` }}
          />
        </div>
        <span className="text-[11px] num text-muted-foreground w-14 text-right">{pctTotal.toFixed(1)}%</span>
      </div>

      {/* Rubricas */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground bg-muted/40">
              <th className="px-4 py-2 font-medium">Categoria de despesa</th>
              <th className="px-2 py-2 font-medium text-right">Planejado</th>
              <th className="px-2 py-2 font-medium text-right">Gasto</th>
              <th className="px-2 py-2 font-medium text-right">Saldo</th>
              <th className="px-2 py-2 font-medium w-[160px]">Execução</th>
              <th className="px-2 py-2 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {roots.map(r => (
              <RubricaRows
                key={r.id}
                rubrica={r}
                children={childrenOf(r.id)}
                gastoPorRubrica={gastoPorRubrica}
                compras={compras}
                expanded={expanded}
                toggle={toggle}
                projetoId={projeto.id}
                onChanged={onChanged}
              />
            ))}
            {roots.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">Nenhuma rubrica. Edite o projeto para adicionar.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Parcelas */}
      {parcelas.length > 0 && (
        <div className="px-4 py-3 border-t bg-muted/10">
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Parcelas do edital</div>
          <div className="flex flex-col gap-1.5">
            {parcelas.map(pa => (
              <div key={pa.id} className="flex items-center gap-2 text-[12px]">
                <Badge variant="outline" className={cn("text-[10px] font-normal", pa.recebido ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" : "bg-muted")}>
                  {pa.numero}ª {pa.recebido ? "recebida" : "pendente"}
                </Badge>
                <span className="text-muted-foreground flex-1">{pa.descricao}</span>
                <span className="num font-medium">{fmtBRL(Number(pa.valor))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ───────── Linha de rubrica + filhas + lista de compras (quando expandida) ───────── */

function RubricaRows({
  rubrica, children, gastoPorRubrica, compras, expanded, toggle, projetoId, onChanged,
}: {
  rubrica: Rubrica; children: Rubrica[]; gastoPorRubrica: Map<string, number>;
  compras: Compra[]; expanded: Record<string, boolean>; toggle: (id: string) => void;
  projetoId: string; onChanged: () => void;
}) {
  const gasto = gastoPorRubrica.get(rubrica.id) ?? 0;
  const saldo = Number(rubrica.valor_planejado) - gasto;
  const pct = Number(rubrica.valor_planejado) > 0 ? (gasto / Number(rubrica.valor_planejado)) * 100 : 0;
  const isOpen = !!expanded[rubrica.id];
  const hasChildren = children.length > 0;
  const comprasRubrica = compras.filter(c => c.rubrica_id === rubrica.id || children.some(ch => ch.id === c.rubrica_id));

  return (
    <>
      <tr className={cn("border-t border-border/50 hover:bg-muted/30", rubrica.obrigatorio && "bg-amber-500/[0.03]")}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => toggle(rubrica.id)} className="text-muted-foreground hover:text-foreground">
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <span className="font-medium">{rubrica.categoria}</span>
            {rubrica.obrigatorio && (
              <Badge variant="outline" className="text-[10px] font-normal bg-amber-500/10 text-amber-700 border-amber-500/40 gap-0.5">
                <Zap className="h-2.5 w-2.5" /> Obrigatório
              </Badge>
            )}
          </div>
        </td>
        <td className="px-2 py-2.5 text-right num">{fmtBRL(Number(rubrica.valor_planejado))}</td>
        <td className="px-2 py-2.5 text-right num">{fmtBRL(gasto)}</td>
        <td className={cn("px-2 py-2.5 text-right num font-semibold", saldo < 0 && "text-rose-600")}>{fmtBRL(saldo)}</td>
        <td className="px-2 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  pct > 100 ? "bg-rose-500" : pct >= 85 ? "bg-orange-500" : pct >= 60 ? "bg-amber-500" : "bg-emerald-500",
                )}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span className="num text-[11px] text-muted-foreground w-10 text-right">{pct.toFixed(0)}%</span>
          </div>
        </td>
        <td className="px-2 py-2.5 text-right">
          <CompraDialog projetoId={projetoId} rubricas={[rubrica, ...children]} rubricaIdPadrao={hasChildren ? children[0]?.id : rubrica.id} onSaved={onChanged}>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1">
              <Plus className="h-3 w-3" /> Compra
            </Button>
          </CompraDialog>
        </td>
      </tr>

      {/* Sub-rubricas */}
      {children.map(ch => {
        const g = gastoPorRubrica.get(ch.id) ?? 0;
        const s = Number(ch.valor_planejado) - g;
        const p = Number(ch.valor_planejado) > 0 ? (g / Number(ch.valor_planejado)) * 100 : 0;
        const chOpen = !!expanded[ch.id];
        const chCompras = compras.filter(c => c.rubrica_id === ch.id);
        return (
          <>
          <tr key={ch.id} className={cn("border-t border-border/30 bg-muted/10 hover:bg-muted/30", ch.obrigatorio && "bg-amber-500/[0.04]")}>
            <td className="px-4 py-2 pl-10 italic text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <button onClick={() => toggle(ch.id)} className="text-muted-foreground hover:text-foreground">
                  {chOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                {ch.categoria}
                {chCompras.length > 0 && (
                  <Badge variant="outline" className="text-[9.5px] font-normal h-4 px-1">{chCompras.length}</Badge>
                )}
                {ch.obrigatorio && <Zap className="h-2.5 w-2.5 text-amber-600" />}
              </div>
            </td>
            <td className="px-2 py-2 text-right num">{fmtBRL(Number(ch.valor_planejado))}</td>
            <td className="px-2 py-2 text-right num">{fmtBRL(g)}</td>
            <td className={cn("px-2 py-2 text-right num", s < 0 && "text-rose-600")}>{fmtBRL(s)}</td>
            <td className="px-2 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={cn("h-full", p > 100 ? "bg-rose-500" : p >= 85 ? "bg-orange-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, p)}%` }} />
                </div>
                <span className="num text-[10px] text-muted-foreground w-8 text-right">{p.toFixed(0)}%</span>
              </div>
            </td>
            <td className="px-2 py-2 text-right">
              <CompraDialog projetoId={projetoId} rubricas={[ch]} rubricaIdPadrao={ch.id} onSaved={onChanged}>
                <Button size="sm" variant="ghost" className="h-6 text-[10.5px] gap-1">
                  <Plus className="h-3 w-3" /> Compra
                </Button>
              </CompraDialog>
            </td>
          </tr>
          {chOpen && (
            <tr>
              <td colSpan={6} className="px-4 py-3 pl-14 bg-muted/5 border-t border-border/20">
                {chCompras.length === 0 ? (
                  <div className="text-[11.5px] text-muted-foreground italic">Nenhuma compra lançada nessa subcategoria.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Compras em {ch.categoria}</div>
                    {chCompras.map(c => <CompraRow key={c.id} compra={c} onChanged={onChanged} />)}
                  </div>
                )}
              </td>
            </tr>
          )}
          </>
        );
      })}

      {/* Lista de compras expandida */}
      {isOpen && (
        <tr>
          <td colSpan={6} className="px-4 py-3 bg-muted/5 border-t border-border/30">
            {comprasRubrica.length === 0 ? (
              <div className="text-[11.5px] text-muted-foreground italic">Nenhuma compra lançada nessa rubrica.</div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Compras lançadas</div>
                {comprasRubrica.map(c => (
                  <CompraRow key={c.id} compra={c} onChanged={onChanged} />
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CompraRow({ compra, onChanged }: { compra: Compra; onChanged: () => void }) {
  const remove = async () => {
    if (!confirm(`Excluir compra "${compra.descricao}"?`)) return;
    const { error } = await sb.from("projetos_aprovados_compras").delete().eq("id", compra.id);
    if (error) return toast.error(error.message);
    toast.success("Compra excluída");
    onChanged();
  };
  return (
    <div className="flex items-center gap-2 text-[11.5px] px-2 py-1.5 rounded hover:bg-muted/40">
      <span className="text-muted-foreground num w-20">{new Date(compra.data).toLocaleDateString("pt-BR")}</span>
      <span className="flex-1 truncate">{compra.descricao}</span>
      {compra.fornecedor && <span className="text-muted-foreground truncate max-w-[150px]">{compra.fornecedor}</span>}
      {compra.nf_numero ? (
        <Badge variant="outline" className="text-[9.5px] font-normal bg-emerald-500/10 text-emerald-700 border-emerald-500/30 gap-0.5">
          <FileText className="h-2.5 w-2.5" /> NF {compra.nf_numero}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[9.5px] font-normal bg-amber-500/10 text-amber-700 border-amber-500/30 gap-0.5">
          <FileWarning className="h-2.5 w-2.5" /> sem NF
        </Badge>
      )}
      <span className="num font-semibold w-24 text-right">{fmtBRL(Number(compra.valor))}</span>
      <button onClick={remove} className="text-muted-foreground hover:text-rose-600">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ───────── Dialog: nova compra ───────── */

function CompraDialog({
  projetoId, rubricas, rubricaIdPadrao, onSaved, children,
}: {
  projetoId: string; rubricas: Rubrica[]; rubricaIdPadrao?: string;
  onSaved: () => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [descricao, setDescricao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [valor, setValor] = useState("");
  const [rubricaId, setRubricaId] = useState(rubricaIdPadrao ?? rubricas[0]?.id ?? "");
  const [nfNumero, setNfNumero] = useState("");
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setRubricaId(rubricaIdPadrao ?? rubricas[0]?.id ?? ""); }, [open, rubricaIdPadrao, rubricas]);

  const save = async () => {
    if (!descricao.trim()) return toast.error("Descrição é obrigatória");
    if (!rubricaId) return toast.error("Selecione a rubrica");
    const v = Number(valor.replace(",", "."));
    if (!v || v <= 0) return toast.error("Informe o valor");
    setSaving(true);
    const { error } = await sb.from("projetos_aprovados_compras").insert({
      projeto_id: projetoId, rubrica_id: rubricaId, data, descricao: descricao.trim(),
      fornecedor: fornecedor.trim() || null, valor: v,
      nf_numero: nfNumero.trim() || null, nf_anexada: !!nfNumero.trim(),
      observacao: observacao.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Compra lançada — orçamento atualizado");
    setOpen(false);
    setDescricao(""); setFornecedor(""); setValor(""); setNfNumero(""); setObservacao("");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Nova compra</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Rubrica</Label>
            <Select value={rubricaId} onValueChange={setRubricaId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {rubricas.map(r => <SelectItem key={r.id} value={r.id}>{r.categoria}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Data</Label>
            <Input type="date" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valor (R$)</Label>
            <Input inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Descrição</Label>
            <Input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Notebook Dell para equipe" />
          </div>
          <div>
            <Label className="text-xs">Fornecedor</Label>
            <Input value={fornecedor} onChange={e => setFornecedor(e.target.value)} placeholder="Opcional" />
          </div>
          <div>
            <Label className="text-xs">Nota fiscal nº</Label>
            <Input value={nfNumero} onChange={e => setNfNumero(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Observação</Label>
            <Textarea rows={2} value={observacao} onChange={e => setObservacao(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : <><Save className="h-3 w-3 mr-1" /> Lançar compra</>}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Dialog: novo / editar projeto + rubricas + parcelas ───────── */

type RubricaDraft = { id?: string; categoria: string; valor_planejado: number; obrigatorio: boolean; parent_idx: number | null; ordem: number };
type ParcelaDraft = { id?: string; numero: number; descricao: string; valor: number; recebido: boolean };

function ProjetoDialog({ projeto, onSaved }: { projeto?: Projeto; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(projeto?.nome ?? "");
  const [orgao, setOrgao] = useState(projeto?.orgao ?? "");
  const [valorAprovado, setValorAprovado] = useState(String(projeto?.valor_aprovado ?? ""));
  const [contrapartida, setContrapartida] = useState(String(projeto?.valor_contrapartida ?? ""));
  const [dataInicio, setDataInicio] = useState(projeto?.data_inicio ?? "");
  const [duracao, setDuracao] = useState(String(projeto?.duracao_meses ?? ""));
  const [prazoFinal, setPrazoFinal] = useState(projeto?.prazo_final ?? "");
  const [status, setStatus] = useState(projeto?.status ?? "Em execução");
  const [observacao, setObservacao] = useState(projeto?.observacao ?? "");
  const [rubricas, setRubricas] = useState<RubricaDraft[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const isEdit = !!projeto;

  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      setRubricas([]); setParcelas([]); return;
    }
    (async () => {
      const [r, p] = await Promise.all([
        sb.from("projetos_aprovados_rubricas").select("*").eq("projeto_id", projeto!.id).order("ordem"),
        sb.from("projetos_aprovados_parcelas").select("*").eq("projeto_id", projeto!.id).order("numero"),
      ]);
      const rs: Rubrica[] = r.data ?? [];
      const rootIdx = new Map<string, number>();
      const roots = rs.filter(x => !x.parent_id);
      roots.forEach((x, i) => rootIdx.set(x.id, i));
      const ordered: RubricaDraft[] = [];
      roots.forEach((root, i) => {
        ordered.push({ id: root.id, categoria: root.categoria, valor_planejado: Number(root.valor_planejado), obrigatorio: root.obrigatorio, parent_idx: null, ordem: i });
        rs.filter(x => x.parent_id === root.id).forEach((child, j) => {
          ordered.push({ id: child.id, categoria: child.categoria, valor_planejado: Number(child.valor_planejado), obrigatorio: child.obrigatorio, parent_idx: ordered.findIndex(o => o.id === root.id), ordem: j });
        });
      });
      setRubricas(ordered);
      setParcelas((p.data ?? []).map((x: any) => ({ id: x.id, numero: x.numero, descricao: x.descricao ?? "", valor: Number(x.valor), recebido: x.recebido })));
    })();
  }, [open, isEdit, projeto]);

  const addRubrica = (parent_idx: number | null = null) => {
    setRubricas(rs => [...rs, { categoria: "", valor_planejado: 0, obrigatorio: false, parent_idx, ordem: rs.length }]);
  };
  const addParcela = () => {
    setParcelas(ps => [...ps, { numero: ps.length + 1, descricao: "", valor: 0, recebido: false }]);
  };

  const save = async () => {
    if (!nome.trim()) return toast.error("Nome é obrigatório");
    setSaving(true);
    try {
      let projetoId = projeto?.id;
      const payload = {
        nome: nome.trim(), orgao: orgao.trim() || null,
        valor_aprovado: Number(String(valorAprovado).replace(",", ".")) || 0,
        valor_contrapartida: Number(String(contrapartida).replace(",", ".")) || 0,
        data_inicio: dataInicio || null,
        duracao_meses: duracao ? Number(duracao) : null,
        prazo_final: prazoFinal || null,
        status, observacao: observacao.trim() || null,
      };
      if (isEdit) {
        const { error } = await sb.from("projetos_aprovados").update(payload).eq("id", projetoId);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("projetos_aprovados").insert(payload).select("id").single();
        if (error) throw error;
        projetoId = data.id;
      }

      // Persist rubricas — apaga e recria (simples e seguro pois compras só restringem deletes via FK RESTRICT)
      if (isEdit) {
        // Atualiza existentes; insere novas; remove as deletadas
        const { data: existing } = await sb.from("projetos_aprovados_rubricas").select("id").eq("projeto_id", projetoId);
        const keepIds = new Set(rubricas.filter(r => r.id).map(r => r.id));
        const toDelete = (existing ?? []).filter((e: any) => !keepIds.has(e.id)).map((e: any) => e.id);
        if (toDelete.length) {
          const { error } = await sb.from("projetos_aprovados_rubricas").delete().in("id", toDelete);
          if (error) throw new Error("Não é possível excluir rubrica com compras lançadas. Exclua as compras primeiro.");
        }
      }

      // 1ª passada: roots
      const idMap = new Map<number, string>(); // index -> id
      for (let i = 0; i < rubricas.length; i++) {
        const r = rubricas[i];
        if (r.parent_idx !== null) continue;
        const data = { projeto_id: projetoId, parent_id: null, categoria: r.categoria.trim() || "Sem nome", valor_planejado: Number(r.valor_planejado) || 0, obrigatorio: r.obrigatorio, ordem: i };
        if (r.id) {
          await sb.from("projetos_aprovados_rubricas").update(data).eq("id", r.id);
          idMap.set(i, r.id);
        } else {
          const { data: ins, error } = await sb.from("projetos_aprovados_rubricas").insert(data).select("id").single();
          if (error) throw error;
          idMap.set(i, ins.id);
        }
      }
      // 2ª passada: filhos
      for (let i = 0; i < rubricas.length; i++) {
        const r = rubricas[i];
        if (r.parent_idx === null) continue;
        const parentId = idMap.get(r.parent_idx);
        const data = { projeto_id: projetoId, parent_id: parentId, categoria: r.categoria.trim() || "Sem nome", valor_planejado: Number(r.valor_planejado) || 0, obrigatorio: r.obrigatorio, ordem: i };
        if (r.id) await sb.from("projetos_aprovados_rubricas").update(data).eq("id", r.id);
        else await sb.from("projetos_aprovados_rubricas").insert(data);
      }

      // Parcelas
      if (isEdit) {
        const { data: existingP } = await sb.from("projetos_aprovados_parcelas").select("id").eq("projeto_id", projetoId);
        const keepIds = new Set(parcelas.filter(p => p.id).map(p => p.id));
        const toDelete = (existingP ?? []).filter((e: any) => !keepIds.has(e.id)).map((e: any) => e.id);
        if (toDelete.length) await sb.from("projetos_aprovados_parcelas").delete().in("id", toDelete);
      }
      for (const p of parcelas) {
        const data = { projeto_id: projetoId, numero: p.numero, descricao: p.descricao || null, valor: Number(p.valor) || 0, recebido: p.recebido };
        if (p.id) await sb.from("projetos_aprovados_parcelas").update(data).eq("id", p.id);
        else await sb.from("projetos_aprovados_parcelas").insert(data);
      }

      toast.success(isEdit ? "Projeto atualizado" : "Projeto criado");
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!isEdit) return;
    if (!confirm(`Excluir projeto "${projeto!.nome}" e todas as compras lançadas?`)) return;
    // primeiro apaga compras (FK RESTRICT na rubrica)
    await sb.from("projetos_aprovados_compras").delete().eq("projeto_id", projeto!.id);
    const { error } = await sb.from("projetos_aprovados").delete().eq("id", projeto!.id);
    if (error) return toast.error(error.message);
    toast.success("Projeto excluído");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1">
            <Pencil className="h-3 w-3" /> Editar
          </Button>
        ) : (
          <Button size="sm" className="h-7 text-[11px] gap-1">
            <FolderPlus className="h-3 w-3" /> Novo projeto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar · ${projeto!.nome}` : "Novo projeto aprovado"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Nome do projeto</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Tecnova III" />
          </div>
          <div>
            <Label className="text-xs">Órgão / Fonte</Label>
            <Input value={orgao} onChange={e => setOrgao(e.target.value)} placeholder="Ex: FAPES / FINEP" />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Em execução">Em execução</SelectItem>
                <SelectItem value="Aguardando resultado">Aguardando resultado</SelectItem>
                <SelectItem value="Encerrado">Encerrado</SelectItem>
                <SelectItem value="Cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor aprovado (R$)</Label>
            <Input inputMode="decimal" value={valorAprovado} onChange={e => setValorAprovado(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Contrapartida (R$)</Label>
            <Input inputMode="decimal" value={contrapartida} onChange={e => setContrapartida(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Início</Label>
            <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Duração (meses)</Label>
            <Input type="number" value={duracao} onChange={e => setDuracao(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Prazo final</Label>
            <Input type="date" value={prazoFinal} onChange={e => setPrazoFinal(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Observação</Label>
            <Textarea rows={2} value={observacao} onChange={e => setObservacao(e.target.value)} />
          </div>
        </div>

        <Separator className="my-2" />

        {/* Rubricas */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">Categorias de despesa (rubricas)</Label>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addRubrica(null)}>
              <Plus className="h-3 w-3 mr-1" /> Rubrica
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {rubricas.map((r, i) => (
              <div key={i} className={cn("flex items-center gap-2", r.parent_idx !== null && "pl-6")}>
                <Input
                  className="h-8 text-[12px] flex-1"
                  placeholder="Categoria"
                  value={r.categoria}
                  onChange={e => setRubricas(rs => rs.map((x, idx) => idx === i ? { ...x, categoria: e.target.value } : x))}
                />
                <Input
                  className="h-8 text-[12px] w-32 num"
                  inputMode="decimal"
                  placeholder="Valor"
                  value={r.valor_planejado || ""}
                  onChange={e => setRubricas(rs => rs.map((x, idx) => idx === i ? { ...x, valor_planejado: Number(e.target.value.replace(",", ".")) || 0 } : x))}
                />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <input type="checkbox" checked={r.obrigatorio} onChange={e => setRubricas(rs => rs.map((x, idx) => idx === i ? { ...x, obrigatorio: e.target.checked } : x))} />
                  Obrigatório
                </label>
                {r.parent_idx === null && (
                  <Button size="sm" variant="ghost" className="h-7 text-[10.5px]" onClick={() => addRubrica(i)}>
                    + sub
                  </Button>
                )}
                <button
                  className="text-muted-foreground hover:text-rose-600"
                  onClick={() => setRubricas(rs => rs.filter((_, idx) => idx !== i && rs[idx].parent_idx !== i))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {rubricas.length === 0 && (
              <div className="text-[11px] text-muted-foreground italic">Nenhuma rubrica. Clique em "Rubrica" para adicionar.</div>
            )}
          </div>
        </div>

        <Separator className="my-2" />

        {/* Parcelas */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">Parcelas do edital</Label>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={addParcela}>
              <Plus className="h-3 w-3 mr-1" /> Parcela
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {parcelas.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input className="h-8 text-[12px] w-14 num" type="number" value={p.numero} onChange={e => setParcelas(ps => ps.map((x, idx) => idx === i ? { ...x, numero: Number(e.target.value) } : x))} />
                <Input className="h-8 text-[12px] flex-1" placeholder="Descrição" value={p.descricao} onChange={e => setParcelas(ps => ps.map((x, idx) => idx === i ? { ...x, descricao: e.target.value } : x))} />
                <Input className="h-8 text-[12px] w-32 num" inputMode="decimal" placeholder="Valor" value={p.valor || ""} onChange={e => setParcelas(ps => ps.map((x, idx) => idx === i ? { ...x, valor: Number(e.target.value.replace(",", ".")) || 0 } : x))} />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <input type="checkbox" checked={p.recebido} onChange={e => setParcelas(ps => ps.map((x, idx) => idx === i ? { ...x, recebido: e.target.checked } : x))} />
                  Recebida
                </label>
                <button className="text-muted-foreground hover:text-rose-600" onClick={() => setParcelas(ps => ps.filter((_, idx) => idx !== i))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="mt-4 flex justify-between">
          {isEdit ? (
            <Button variant="ghost" size="sm" onClick={remove} className="text-destructive">
              <Trash2 className="h-3 w-3 mr-1" /> Excluir projeto
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : <><Save className="h-3 w-3 mr-1" /> Salvar</>}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
