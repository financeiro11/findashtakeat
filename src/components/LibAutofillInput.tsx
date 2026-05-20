import { useEffect, useMemo, useRef, useState } from "react";
import { UserPlus, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------
 * Biblioteca cache (módulo) – evita refetch a cada input renderizado.
 * ----------------------------------------------------------- */
type Colab = {
  id: string; nome: string; email: string | null;
  cargo: string | null; setor: string | null;
  centro_custo: string | null;
};
type Forn = {
  id: string; nome: string; documento: string | null;
  categoria: string | null;
};

let _colabs: Colab[] | null = null;
let _forns: Forn[] | null = null;
const _listeners = new Set<() => void>();
const _notify = () => _listeners.forEach((l) => l());

async function fetchColabs() {
  const { data } = await supabase
    .from("lib_colaboradores")
    .select("id,nome,email,cargo:lib_cargos(nome),departamento:lib_departamentos(nome),centro:lib_centros_custo(nome)")
    .order("nome");
  _colabs = ((data || []) as any[]).map((r) => ({
    id: r.id, nome: r.nome, email: r.email,
    cargo: r.cargo?.nome || null,
    setor: r.departamento?.nome || null,
    centro_custo: r.centro?.nome || null,
  }));
  _notify();
}
async function fetchForns() {
  const { data } = await supabase
    .from("lib_fornecedores")
    .select("id,nome,documento,categoria")
    .order("nome");
  _forns = ((data || []) as Forn[]);
  _notify();
}

function useLib(kind: "colaborador" | "fornecedor") {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    _listeners.add(l);
    if (kind === "colaborador" && !_colabs) fetchColabs();
    if (kind === "fornecedor" && !_forns) fetchForns();
    return () => { _listeners.delete(l); };
  }, [kind]);
  return kind === "colaborador" ? (_colabs || []) : (_forns || []);
}

const norm = (s: string) =>
  (s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export type LibMatch = Colab | Forn;

interface Props {
  kind?: "colaborador" | "fornecedor";
  value: string;
  onChange: (v: string) => void;
  onMatch?: (m: LibMatch | null) => void;
  onCommit?: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  allowAdd?: boolean;
  /** Quando true, mostra ícone discreto à direita ao invés do botão "Cadastrar" largo */
  compact?: boolean;
}

/**
 * Input com autocomplete vindo da Biblioteca.
 * - Mostra sugestões via <datalist> (nativo, leve).
 * - Quando o texto bate exato com um item, dispara onMatch(item).
 * - Quando não bate e o usuário sai do campo, oferece "Cadastrar na Biblioteca".
 */
export function LibAutofillInput({
  kind = "colaborador",
  value, onChange, onMatch, onCommit,
  placeholder, className, inputClassName, autoFocus,
  allowAdd = true, compact = false,
}: Props) {
  const items = useLib(kind);
  const listId = useRef(`lib-${kind}-${Math.random().toString(36).slice(2, 9)}`).current;
  const initial = useRef(value);

  const match = useMemo(() => {
    const n = norm(value);
    if (!n) return null;
    return items.find((i) => norm(i.nome) === n) || null;
  }, [items, value]);

  const [touched, setTouched] = useState(false);
  const [dlgOpen, setDlgOpen] = useState(false);

  // dispara onMatch quando muda
  useEffect(() => { onMatch?.(match); /* eslint-disable-next-line */ }, [match?.id]);

  const showAdd = allowAdd && touched && value.trim().length >= 2 && !match;

  return (
    <div className={cn("relative", className)}>
      <div className="flex items-center gap-1">
        <Input
          list={listId}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder || (kind === "colaborador" ? "Nome do colaborador…" : "Nome do fornecedor…")}
          onChange={(e) => { onChange(e.target.value); setTouched(true); }}
          onBlur={() => { setTouched(true); if (onCommit && value !== initial.current) { onCommit(value); initial.current = value; } }}
          className={cn(inputClassName)}
        />
        {match && (
          <Check className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-500 pointer-events-none" />
        )}
        {showAdd && compact && (
          <button
            type="button"
            title={`Cadastrar "${value}" na Biblioteca`}
            onClick={() => setDlgOpen(true)}
            className="shrink-0 rounded-md border border-dashed border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/40"
          >
            <UserPlus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <datalist id={listId}>
        {items.map((i) => (
          <option key={i.id} value={i.nome}>
            {kind === "colaborador"
              ? [(i as Colab).setor, (i as Colab).cargo].filter(Boolean).join(" · ")
              : [(i as Forn).categoria, (i as Forn).documento].filter(Boolean).join(" · ")}
          </option>
        ))}
      </datalist>

      {showAdd && !compact && (
        <button
          type="button"
          onClick={() => setDlgOpen(true)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          <UserPlus className="h-3 w-3" />
          Cadastrar "{value}" na Biblioteca
        </button>
      )}

      <QuickAddDialog
        open={dlgOpen}
        onOpenChange={setDlgOpen}
        kind={kind}
        initialNome={value}
        onCreated={(novo) => {
          onChange(novo.nome);
          onMatch?.(novo);
        }}
      />
    </div>
  );
}

/* ---------------- Quick add dialog ---------------- */

function QuickAddDialog({
  open, onOpenChange, kind, initialNome, onCreated,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  kind: "colaborador" | "fornecedor";
  initialNome: string;
  onCreated: (m: LibMatch) => void;
}) {
  const [nome, setNome] = useState(initialNome);
  const [email, setEmail] = useState("");
  const [departamentoId, setDepartamentoId] = useState<string>("");
  const [cargoId, setCargoId] = useState<string>("");
  const [centroId, setCentroId] = useState<string>("");
  const [categoria, setCategoria] = useState("");
  const [documento, setDocumento] = useState("");
  const [saving, setSaving] = useState(false);

  const [deps, setDeps] = useState<{ id: string; nome: string }[]>([]);
  const [cargos, setCargos] = useState<{ id: string; nome: string }[]>([]);
  const [centros, setCentros] = useState<{ id: string; nome: string }[]>([]);

  useEffect(() => {
    setNome(initialNome);
    if (!open) return;
    if (kind === "colaborador") {
      supabase.from("lib_departamentos").select("id,nome").order("nome").then(({ data }) => setDeps((data as any) || []));
      supabase.from("lib_cargos").select("id,nome").order("nome").then(({ data }) => setCargos((data as any) || []));
      supabase.from("lib_centros_custo").select("id,nome").order("nome").then(({ data }) => setCentros((data as any) || []));
    }
  }, [open, kind, initialNome]);

  const save = async () => {
    if (!nome.trim()) { toast.error("Nome obrigatório"); return; }
    setSaving(true);
    try {
      if (kind === "colaborador") {
        const { data, error } = await supabase
          .from("lib_colaboradores")
          .insert({
            nome: nome.trim(),
            email: email.trim() || null,
            departamento_id: departamentoId || null,
            cargo_id: cargoId || null,
            centro_custo_id: centroId || null,
          })
          .select("id,nome,email,cargo:lib_cargos(nome),departamento:lib_departamentos(nome),centro:lib_centros_custo(nome)")
          .single();
        if (error) throw error;
        const novo: Colab = {
          id: (data as any).id, nome: (data as any).nome, email: (data as any).email,
          cargo: (data as any).cargo?.nome || null,
          setor: (data as any).departamento?.nome || null,
          centro_custo: (data as any).centro?.nome || null,
        };
        _colabs = [...(_colabs || []), novo].sort((a, b) => a.nome.localeCompare(b.nome));
        _notify();
        onCreated(novo);
      } else {
        const { data, error } = await supabase
          .from("lib_fornecedores")
          .insert({
            nome: nome.trim(),
            categoria: categoria.trim() || null,
            documento: documento.trim() || null,
          })
          .select("id,nome,documento,categoria")
          .single();
        if (error) throw error;
        const novo = data as Forn;
        _forns = [...(_forns || []), novo].sort((a, b) => a.nome.localeCompare(b.nome));
        _notify();
        onCreated(novo);
      }
      toast.success("Adicionado à Biblioteca");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === "colaborador" ? "Novo colaborador na Biblioteca" : "Novo fornecedor na Biblioteca"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </div>

          {kind === "colaborador" ? (
            <>
              <div>
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Departamento</Label>
                  <Select value={departamentoId} onValueChange={setDepartamentoId}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {deps.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cargo</Label>
                  <Select value={cargoId} onValueChange={setCargoId}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {cargos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Centro de custo</Label>
                <Select value={centroId} onValueChange={setCentroId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {centros.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Categoria</Label>
                  <Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="opcional" />
                </div>
                <div>
                  <Label>CNPJ/CPF</Label>
                  <Input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="opcional" />
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Helper: força re-fetch (use após mudanças externas na Biblioteca). */
export function refreshLibCache(kind?: "colaborador" | "fornecedor") {
  if (!kind || kind === "colaborador") { _colabs = null; fetchColabs(); }
  if (!kind || kind === "fornecedor") { _forns = null; fetchForns(); }
}
