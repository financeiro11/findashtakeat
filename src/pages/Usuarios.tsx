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
//
// ---------------------------------------------------------------------------
// A REGRA DAS DUAS TELAS (04/09/2026)
//
// SENHA NA TELA SÓ DEPOIS DO SERVIDOR CONFIRMAR. Nunca antes.
//
// O diálogo de redefinir sorteava a senha ao ABRIR e a escrevia num campo
// visível, antes de o servidor saber de coisa alguma. Quem abria copiava dali,
// mandava para a pessoa e fechava a janela — e nada tinha acontecido. A senha
// existiu só na conversa: o Auth continuava com a antiga, a pessoa continuava
// sem entrar, e não havia erro nenhum para explicar por quê.
//
// Aconteceu em 04/09/2026 com o acesso do Renan, e custou o dia dele. Os logs
// contam a história inteira: zero chamadas a `admin-reset-password`, e duas
// tentativas de login recusadas com a senha que ninguém nunca gravou.
//
// Por isso a redefinição virou confirmação, sem campo: `gerarSenhaForte()` roda
// DENTRO de `confirmarRedefinir`, o valor vai direto para a Edge Function e só
// chega aos olhos de alguém em `SenhaParaEntregar` — a mesma tela da criação,
// que já só abre depois do 2xx. Enquanto o diálogo estiver aberto, a verdade é
// que nada mudou, e ele diz isso com todas as letras.
//
// Escrever a senha à mão saiu junto. Era o que exigia o campo, e o campo era a
// armadilha; quem precisa de uma senha específica redefine e pede a troca no
// primeiro acesso.

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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { gerarSenhaForte } from "@/lib/senha";
import { PERFIS, PERFIS_ESCOLHIVEIS, type PerfilId } from "@/lib/modules";
import { toast } from "sonner";

type Profile = {
  id: string; user_id: string; nome: string; cargo: string | null; email: string;
  perfil?: PerfilId | null;
};

const empty = { nome: "", cargo: "", email: "", perfil: "" as PerfilId | "" };

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
    setForm({ nome: p.nome, cargo: p.cargo || "", email: p.email, perfil: p.perfil ?? "" });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.nome || !form.email) return toast.error("Nome e email obrigatórios");
    setBusy(true);
    if (editing) {
      /* `.select()` no fim NÃO é enfeite: até 10/09/2026 a policy de UPDATE de
         `profiles` era `auth.uid() = user_id`, então este update casava ZERO
         linhas para qualquer pessoa que não fosse quem estava logado — e o
         PostgREST devolvia 200 sem erro, com a tela dizendo "Usuário
         atualizado". A policy foi corrigida, mas quem confere é isto: se voltar
         a não gravar, a tela diz. */
      const { data, error } = await supabase
        .from("profiles")
        .update({
          nome: form.nome, cargo: form.cargo, email: form.email,
          perfil: form.perfil || null,
        })
        .eq("id", editing.id)
        .select("id");
      setBusy(false);
      if (error) return toast.error(error.message);
      if (!data?.length) {
        return toast.error("Nada foi salvo — seu acesso não permite editar esta ficha.");
      }
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

  // Abrir o diálogo não sorteia nada — ver "A REGRA DAS DUAS TELAS" no topo.
  const abrirRedefinir = (p: Profile) => setRedefinindo(p);

  const confirmarRedefinir = async () => {
    if (!redefinindo) return;

    // A senha nasce AQUI, no clique, e não numa variável de estado que a tela
    // pudesse desenhar. Entre este sorteio e a resposta do servidor ela não
    // existe para ninguém — nem para quem está olhando a página.
    const senha = gerarSenhaForte();

    setRedefBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { email: redefinindo.email, password: senha },
    });
    setRedefBusy(false);
    // Recusa do servidor (senha fraca, quem chamou não pode, conta sumida): a
    // senha sorteada morre aqui, sem nunca ter aparecido. Tentar de novo sorteia
    // outra — não há nada a recuperar.
    if (error || (data as any)?.error) {
      return toast.error((data as any)?.error || error?.message || "Erro ao redefinir");
    }
    const alvo = redefinindo.email;
    setRedefinindo(null);
    setSenhaNova({ email: alvo, senha });
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
        <p className="max-w-3xl text-sm text-muted-foreground">
          Quem entra no Hub e o que cada um enxerga. O <strong className="font-medium text-foreground">cargo</strong> é
          só o rótulo na tela; quem decide o acesso é o <strong className="font-medium text-foreground">perfil</strong>,
          escolhido numa lista fechada. Conta sem perfil entra e não abre nada — é o padrão, e é de
          propósito. Cada conta nova recebe uma senha sorteada, mostrada uma única vez.
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
                <div className="space-y-1.5">
                  <Label>Cargo</Label>
                  <Input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
                  <p className="text-[11px] text-muted-foreground">
                    Só o rótulo que aparece na tela. Quem decide o que a pessoa enxerga é o perfil abaixo.
                  </p>
                </div>
                <div className="space-y-1.5"><Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>

                {/* O PERFIL DE ACESSO — lista fechada, nunca campo livre.
                    Cargo é texto digitado à mão, e "Head de RH" nunca ia bater com
                    nenhuma trava escrita em código. Ver lib/modules.ts. */}
                <div className="space-y-1.5">
                  <Label>Perfil de acesso</Label>
                  <Select
                    value={form.perfil || "__nenhum"}
                    onValueChange={(v) => setForm({ ...form, perfil: v === "__nenhum" ? "" : (v as PerfilId) })}
                  >
                    <SelectTrigger><SelectValue placeholder="Escolha o perfil" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum">Sem acesso (não abre nenhuma tela)</SelectItem>
                      {PERFIS_ESCOLHIVEIS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="min-h-[32px] text-[11px] leading-relaxed text-muted-foreground">
                    {form.perfil
                      ? PERFIS[form.perfil].resumo
                      : "A conta é criada, entra no Hub e vê um aviso pedindo que alguém defina o acesso."}
                  </p>
                </div>

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
                <TableHead>Acesso</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-36 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">Nenhum usuário cadastrado.</TableCell></TableRow>
              ) : users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{u.cargo || "—"}</TableCell>
                  <TableCell>
                    {/* Conta sem perfil fica em vermelho: não é um estado neutro,
                        é alguém que entra no Hub e não consegue abrir nada. */}
                    {u.perfil
                      ? <Badge variant="secondary" title={PERFIS[u.perfil]?.resumo}>{PERFIS[u.perfil]?.label ?? u.perfil}</Badge>
                      : <Badge variant="destructive">Sem acesso</Badge>}
                  </TableCell>
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
              Uma senha nova será sorteada para <strong>{redefinindo?.email}</strong> e mostrada na
              tela seguinte, uma única vez, para você copiar e entregar. Isso <strong>encerra todas
              as sessões abertas</strong> dessa conta — em qualquer aparelho.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Enquanto esta janela estiver aberta, <strong className="font-medium text-foreground">nada
            mudou</strong>: a senha só passa a existir quando você confirmar, e {redefinindo?.nome} continua
            entrando com a antiga até lá.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRedefinindo(null)} disabled={redefBusy}>
              Cancelar
            </Button>
            <Button onClick={confirmarRedefinir} disabled={redefBusy}>
              {redefBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sortear e redefinir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {senhaNova && <SenhaParaEntregar dados={senhaNova} onClose={() => setSenhaNova(null)} />}
    </div>
  );
}
