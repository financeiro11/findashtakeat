import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import takeatLogo from "@/assets/takeat-logo-white.png";
import financeBg from "@/assets/finance-bg-dashboard.jpg";

type UserOpt = { nome: string; email: string; cargo?: string | null };

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("123456");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [seedShown, setSeedShown] = useState(false);

  // Forgot-password flow (código interno)
  const SECRET_CODE = "2122";
  const [forgotOpen, setForgotOpen] = useState(false);
  const [step, setStep] = useState<"code" | "password">("code");
  const [fpEmail, setFpEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");
  const [fpBusy, setFpBusy] = useState(false);

  useEffect(() => {
    document.title = "Login · Takeat Hub Financeiro";
    supabase.functions.invoke("list-users").then(({ data }) => {
      const list = ((data as any)?.users ?? []) as UserOpt[];
      setUsers(list);
      setSeedShown(list.length === 0);
      if (list.length && !email) setEmail(list[0].email);
    });
  }, []);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const selected = users.find((u) => u.email === email);
  const initials = (selected?.nome || email || "??")
    .split(/[ @.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error("Selecione um usuário");
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
  };

  const seedFirst = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: { nome: "Henrique Moura", cargo: "Financeiro", email: "henrique@finops.com", password: "123456" },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Erro");
    } else {
      toast.success("Usuário criado: henrique@finops.com / 123456");
      setUsers([{ nome: "Henrique Moura", email: "henrique@finops.com", cargo: "Financeiro" }]);
      setEmail("henrique@finops.com");
      setSeedShown(false);
    }
  };

  const openForgot = () => {
    setFpEmail(email || "");
    setCode("");
    setNewPwd("");
    setNewPwd2("");
    setStep("code");
    setForgotOpen(true);
  };

  const verifyCode = () => {
    if (code.trim() !== SECRET_CODE) return toast.error("Código incorreto");
    setStep("password");
  };

  const setNewPassword = async () => {
    if (!fpEmail) return toast.error("Selecione um usuário antes");
    if (newPwd.length < 6) return toast.error("Senha deve ter ao menos 6 caracteres");
    if (newPwd !== newPwd2) return toast.error("As senhas não coincidem");
    setFpBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { email: fpEmail, secret: code.trim(), password: newPwd },
    });
    setFpBusy(false);
    if (error || (data as any)?.error) {
      return toast.error((data as any)?.error || error?.message || "Erro ao redefinir senha");
    }
    toast.success("Senha redefinida com sucesso");
    setForgotOpen(false);
    setEmail(fpEmail);
    setPassword(newPwd);
  };

  return (
    <div className="min-h-screen w-full bg-muted/40 p-4 md:p-6 lg:p-8">
      <div
        className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1400px] overflow-hidden rounded-2xl text-white shadow-2xl md:min-h-[calc(100vh-3rem)] lg:min-h-[calc(100vh-4rem)]"
        style={{ backgroundColor: "hsl(0 80% 10%)" }}
      >
        {/* Finance analysis background photo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-40"
          style={{ backgroundImage: `url(${financeBg})` }}
        />
        {/* Dark red gradient overlay for legibility */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, hsl(0 75% 14% / 0.75) 0%, hsl(0 78% 10% / 0.7) 55%, hsl(0 80% 7% / 0.8) 100%)",
          }}
        />
        {/* Subtle dot texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)",
            backgroundSize: "60px 60px, 90px 90px",
          }}
        />

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 md:px-10">
          <div className="flex items-center gap-3">
            <img src={takeatLogo} alt="Takeat" className="h-9 w-9 object-contain md:h-10 md:w-10" />
            <span className="text-sm font-medium tracking-wide text-white/80">Hub Financeiro</span>
          </div>
        </div>

        {/* Content grid */}
        <div className="relative z-[1] grid w-full grid-cols-1 items-center gap-8 px-6 pb-10 pt-24 md:px-10 lg:grid-cols-[1.2fr_minmax(380px,440px)] lg:gap-12 lg:px-16 lg:pt-32">
          {/* Left: hero copy */}
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl lg:text-6xl">
              Tudo do financeiro,
              <br />
              <span className="text-white/55">em um único lugar.</span>
            </h1>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-white/70 md:text-base">
              Conciliação automática, DRE em tempo real e radar de editais com IA. Tudo isso enquanto você dorme.
            </p>

            <LiveStats />
          </div>

          {/* Right: login card */}
          <div className="w-full justify-self-center lg:justify-self-end">
            <div className="w-full rounded-2xl bg-white p-6 text-foreground shadow-2xl md:p-7">
              <h2 className="text-xl font-semibold">Entrar</h2>
              <p className="mt-1 text-sm text-muted-foreground">Escolha seu usuário e digite sua senha.</p>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground/80">Usuário</Label>
                  {users.length > 0 ? (
                    <Select value={email} onValueChange={setEmail}>
                      <SelectTrigger className="h-12">
                        <SelectValue placeholder="Selecione…">
                          {selected && (
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
                                {initials}
                              </span>
                              <span className="flex flex-col items-start leading-tight">
                                <span className="text-sm font-medium">{selected.nome}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {selected.cargo || "Usuário"}
                                </span>
                              </span>
                            </div>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.email} value={u.email}>
                            {u.nome} — {u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input type="email" placeholder="email@finops.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium text-foreground/80">Senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPwd ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pr-20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {showPwd ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
                    <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
                    Lembrar de mim neste dispositivo
                  </label>
                  <button
                    type="button"
                    onClick={openForgot}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Esqueci a senha
                  </button>
                </div>

                <Button type="submit" className="h-11 w-full text-sm font-semibold" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Entrar
                  {!busy && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>

                {seedShown && (
                  <Button type="button" variant="outline" className="w-full" onClick={seedFirst} disabled={busy}>
                    Criar primeiro usuário (Henrique Moura)
                  </Button>
                )}
              </form>

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Lock className="h-3 w-3" /> Conexão segura via SSL · LGPD
                </span>
                <span>v3.2.1</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              {step === "code" && "Digite o código interno de 4 dígitos para liberar a redefinição de senha."}
              {step === "password" && `Defina a nova senha para ${fpEmail}.`}
            </DialogDescription>
          </DialogHeader>

          {step === "code" && (
            <div className="space-y-2 py-2">
              <Label>Código interno</Label>
              <Input
                inputMode="numeric"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="0000"
                className="tracking-[0.5em] text-center text-lg"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") verifyCode(); }}
              />
            </div>
          )}

          {step === "password" && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Usuário</Label>
                {users.length > 0 ? (
                  <Select value={fpEmail} onValueChange={setFpEmail}>
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.email} value={u.email}>
                          {u.nome} — {u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type="email" value={fpEmail} onChange={(e) => setFpEmail(e.target.value)} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Nova senha</Label>
                <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Confirmar senha</Label>
                <Input type="password" value={newPwd2} onChange={(e) => setNewPwd2(e.target.value)} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setForgotOpen(false)} disabled={fpBusy}>
              Cancelar
            </Button>
            {step === "code" && (
              <Button onClick={verifyCode} disabled={fpBusy || code.length < 4}>
                Verificar
              </Button>
            )}
            {step === "password" && (
              <Button onClick={setNewPassword} disabled={fpBusy}>
                {fpBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Redefinir senha
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, pulse }: { label: string; value: string; pulse?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        <div className="text-[10px] font-semibold tracking-[0.15em] text-white/55">{label}</div>
      </div>
      <div
        key={value}
        className={`mt-1 text-xl font-bold tracking-tight tabular-nums md:text-2xl animate-fade-in ${
          pulse ? "text-white" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function fmtBRLCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000)
    return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}M`;
  if (abs >= 1_000)
    return `R$ ${(n / 1_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 0,
    })}k`;
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function LiveStats() {
  const [stats, setStats] = useState<{
    receita: number;
    cashburn: number;
    editaisAtivos: number;
  } | null>(null);

  const refetch = async () => {
    const { data } = await supabase.functions.invoke("login-stats");
    if (data && typeof data.receita === "number") {
      setStats({
        receita: data.receita,
        cashburn: data.cashburn,
        editaisAtivos: data.editaisAtivos,
      });
    }
  };

  useEffect(() => {
    refetch();
    const t = setInterval(refetch, 15000);

    // Realtime: refresh whenever underlying data changes
    const channel = supabase
      .channel("login-stats-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "demonstracoes_contabeis" },
        () => refetch()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "editais" },
        () => refetch()
      )
      .subscribe();

    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, []);

  const receitaFmt = stats ? fmtBRLCompact(stats.receita) : "—";
  const cashburnFmt = stats ? fmtBRLCompact(stats.cashburn) : "—";
  const editaisFmt = stats ? String(stats.editaisAtivos) : "—";

  return (
    <div className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 md:max-w-lg">
      <Stat label="RECEITA BRUTA" value={receitaFmt} />
      <Stat label="EDITAIS ATIVOS" value={editaisFmt} />
      <Stat label="CASHBURN" value={cashburnFmt} />
    </div>
  );
}

