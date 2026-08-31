// Quem tem acesso ao Hub.
//
// MUDOU EM 30/08/2026, junto com a tela de login. Esta página criava toda conta
// com a senha "123456" e ANUNCIAVA isso em dois lugares ("Senha padrão: 123456",
// "A senha inicial será 123456"). Como senha que funciona quase nunca é trocada,
// o Hub inteiro ficou aberto por seis dígitos previsíveis — e foi por aí que
// entraram.
//
// Agora a senha inicial é SORTEADA pelo servidor (`_shared/senha.ts`) e mostrada
// UMA única vez, aqui, para ser entregue à pessoa. Ela não fica gravada em lugar
// nenhum além do Auth do Supabase: se a janela fechar sem copiar, o caminho é
// redefinir — que é o botão da chave, ao lado de cada linha.
//
// O botão de redefinir existe porque o atalho antigo morreu junto com o buraco:
// a tela de login tinha um código de 4 dígitos que trocava a senha de qualquer
// um. O poder de redefinir a senha de outra pessoa continua existindo — mas
// agora mora aqui dentro, atrás de login, e não no bundle público.

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Pencil, KeyRound, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { BarraDeForca } from "@/components/RedefinirSenha";
import { MIN_SENHA, gerarSenhaForte, motivoSenhaRuim } from "@/lib/senha";
import { toast } from "sonner";

type Profile = {
  id: string; user_id: string; nome: string; cargo: string | null; email: string;
};

const empty = { nome: "", cargo: "", email: "" };

/** A senha recém-criada, na tela, uma vez só. */
function SenhaParaEntregar({
  dados, onClose,
}: {
  dados: { email: string; senha: string }; onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(dados.senha);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não consegui copiar — selecione o texto e copie à mão.");
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Senha temporária criada</DialogTitle>
          <DialogDescription>
            Entregue esta senha a <strong>{dados.email}</strong> e peça que ela seja trocada no
            primeiro acesso. Ela aparece <strong>uma única vez</strong> — depois de fechar, não há
            como vê-la de novo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <code className="flex-1 select-all break-all font-mono text-sm">{dados.senha}</code>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={copiar}>
            {copiado ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <p className="text-[11.5px] text-muted-foreground">
          Prefira mandar por um canal que a pessoa já usa e que você confia. Se ela perder, use o
          botão da chave nesta tela — ou peça que clique em “Esqueci a senha” no login.
        </p>

        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Usuarios() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState(empty);

  const [senhaNova, setSenhaNova] = useState<{ email: string; senha: string } | null>(null);
  const [redefinindo, setRedefinindo] = useState<Profile | null>(null);
  const [senhaRedef, setSenhaRedef] = useState("");
  const [redefBusy, setRedefBusy] = useState(false);

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
      // Sem `password`: quem sorteia é o servidor, e devolve em `senhaTemporaria`.
      const { data, error } = await supabase.functions.invoke("create-user", { body: { ...form } });
      setBusy(false);
      if (error || (data as any)?.error) {
        return toast.error((data as any)?.error || error?.message || "Erro");
      }
      const senha = (data as any)?.senhaTemporaria;
      if (senha) setSenhaNova({ email: form.email, senha });
      else toast.success("Usuário criado");
    }
    setForm(empty); setEditing(null); setOpen(false); load();
  };

  const abrirRedefinir = (p: Profile) => {
    setRedefinindo(p);
    setSenhaRedef(gerarSenhaForte());
  };

  const confirmarRedefinir = async () => {
    if (!redefinindo) return;
    const ruim = motivoSenhaRuim(senhaRedef, redefinindo.email);
    if (ruim) return toast.error(ruim);

    setRedefBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { email: redefinindo.email, password: senhaRedef },
    });
    setRedefBusy(false);
    if (error || (data as any)?.error) {
      return toast.error((data as any)?.error || error?.message || "Erro ao redefinir");
    }
    const alvo = redefinindo.email;
    setRedefinindo(null);
    setSenhaNova({ email: alvo, senha: senhaRedef });
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
        <p className="text-sm text-muted-foreground">
          Gerencie quem tem acesso ao Hub. Cada conta nova recebe uma senha sorteada, mostrada uma
          única vez na hora da criação.
        </p>
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
                {!editing && (
                  <p className="text-xs text-muted-foreground">
                    Uma senha forte será sorteada e mostrada a você uma única vez, para entregar à pessoa.
                  </p>
                )}
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
                <TableHead className="w-36 text-right">Ações</TableHead>
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
                    <Button
                      variant="ghost" size="icon" title="Redefinir senha"
                      onClick={() => abrirRedefinir(u)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(u)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Excluir" onClick={() => remove(u)} disabled={busy}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!redefinindo} onOpenChange={(v) => { if (!v) setRedefinindo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir a senha de {redefinindo?.nome}</DialogTitle>
            <DialogDescription>
              Isso troca a senha de <strong>{redefinindo?.email}</strong> e <strong>encerra todas as
              sessões abertas</strong> dessa conta — em qualquer aparelho.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between">
              <Label>Nova senha</Label>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => setSenhaRedef(gerarSenhaForte())}
              >
                Sortear outra
              </button>
            </div>
            <Input
              value={senhaRedef}
              onChange={(e) => setSenhaRedef(e.target.value)}
              className="font-mono"
              autoComplete="new-password"
            />
            <BarraDeForca senha={senhaRedef} />
            <p className="text-[11px] text-muted-foreground">
              Mínimo de {MIN_SENHA} caracteres. Você verá a senha na tela seguinte para copiar.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRedefinindo(null)} disabled={redefBusy}>
              Cancelar
            </Button>
            <Button onClick={confirmarRedefinir} disabled={redefBusy}>
              {redefBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Redefinir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {senhaNova && <SenhaParaEntregar dados={senhaNova} onClose={() => setSenhaNova(null)} />}
    </div>
  );
}
