import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Profile = {
  id: string; user_id: string; nome: string; cargo: string | null; email: string;
};

const empty = { nome: "", cargo: "", email: "" };

export default function Usuarios() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    const { data, error } = await supabase.from("profiles").select("*").order("nome");
    if (error) toast.error(error.message);
    else setUsers((data as Profile[]) || []);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (p: Profile) => {
    setEditing(p);
    setForm({ nome: p.nome, cargo: p.cargo || "", email: p.email });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.nome || !form.email) return toast.error("Nome e email obrigatórios");
    setBusy(true);
    if (editing) {
      const { error } = await supabase
        .from("profiles")
        .update({ nome: form.nome, cargo: form.cargo, email: form.email })
        .eq("id", editing.id);
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Usuário atualizado");
    } else {
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: { ...form, password: "123456" },
      });
      setBusy(false);
      if (error || (data as any)?.error) {
        return toast.error((data as any)?.error || error?.message || "Erro");
      }
      toast.success("Usuário criado (senha padrão: 123456)");
    }
    setForm(empty); setEditing(null); setOpen(false); load();
  };

  const remove = async (p: Profile) => {
    if (!confirm(`Excluir ${p.nome}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("delete-user", {
      body: { user_id: p.user_id, email: p.email },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Erro ao excluir");
    } else {
      toast.success("Removido");
      setUsers((current) => current.filter((user) => user.id !== p.id && user.user_id !== p.user_id));
      await load();
    }
  };

  return (
    <div className="space-y-6 p-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Usuários</h2>
        <p className="text-sm text-muted-foreground">Gerencie quem tem acesso ao FinOps. Senha padrão: 123456.</p>
      </div>

      <Card className="border-border shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <span className="text-sm text-muted-foreground">{users.length} usuário(s)</span>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Novo usuário</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{editing ? "Editar usuário" : "Novo usuário"}</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5"><Label>Nome</Label>
                  <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Cargo</Label>
                  <Input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                {!editing && <p className="text-xs text-muted-foreground">A senha inicial será <strong>123456</strong>.</p>}
                {editing && <p className="text-xs text-muted-foreground">Alterar email aqui só atualiza o cadastro local.</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={submit} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Salvar" : "Criar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-28 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">Nenhum usuário cadastrado.</TableCell></TableRow>
              ) : users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell>{u.cargo || "—"}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(u)} disabled={busy}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
