// A tela de login do Hub.
//
// ===========================================================================
// REESCRITA EM 30/08/2026, DEPOIS DE UMA INVASÃO
//
// Alguém de fora entrou e avisou pelo Instagram. Esta tela era a porta, e ela
// tinha três defeitos que se somavam:
//
//   1. A SENHA VINHA PREENCHIDA. `useState("123456")` — a senha padrão de todo
//      mundo, já digitada no campo. Bastava escolher um nome e clicar em Entrar.
//   2. A LISTA DE USUÁRIOS ERA PÚBLICA. Um seletor carregado por `list-users`
//      entregava nome, cargo e e-mail do time inteiro a QUALQUER visitante, sem
//      login. Era o cardápio de alvos.
//   3. HAVIA UM CÓDIGO MESTRE NO BUNDLE. `SECRET_CODE = "2122"`, em texto puro
//      neste arquivo, redefinia a senha de qualquer e-mail. Segredo que o
//      navegador precisa saber não é segredo: está no JavaScript que qualquer
//      pessoa baixa.
//
// E, de brinde, a faixa da esquerda publicava RECEITA e CASHBURN ao vivo para
// quem nem tinha conta.
//
// ---------------------------------------------------------------------------
// O QUE ENTROU NO LUGAR, e por quê
//
// • CAMPO DE E-MAIL DIGITADO, não lista. Quem lembra o e-mail é o gerenciador de
//   senhas do navegador (`autoComplete="username"`), que preenche os dois campos
//   de uma vez — mesma conveniência de antes, sem contar a ninguém quem trabalha
//   aqui. O último e-mail usado fica NESTE aparelho, e só nele.
// • RECUSA SEMPRE IGUAL. "E-mail ou senha incorretos", nunca "usuário não
//   existe". A diferença entre as duas mensagens é o que transforma a tela num
//   verificador de quem tem conta.
// • FREIO QUE CRESCE a cada erro (ver `lib/loginTentativas.ts`).
// • NÃO HÁ "ESQUECI A SENHA" NA TELA. O código mestre saiu por ser um segredo que
//   o navegador precisava saber; o link por e-mail que o substituiu foi retirado
//   em 01/09/2026 a pedido do financeiro: quem esquece a senha pede a redefinição
//   internamente, e ela é feita no modo admin (Configurações › Usuários) ou pelo
//   painel do Supabase. É uma porta a menos exposta a quem não tem conta, ao
//   custo de depender de alguém de dentro para reabrir o acesso.
// • A CAIXA "LEMBRAR DE MIM" PASSOU A FUNCIONAR (ver `lib/authStorage.ts`).
// • NENHUM NÚMERO DA EMPRESA nesta tela.

import { useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, Lock, ArrowRight, Mail, ShieldCheck, LineChart, Radar, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { destinoSeguro, guardarDestino } from "@/lib/destinoLogin";
import { lembraNesteDispositivo, lembrarNesteDispositivo } from "@/lib/authStorage";
import {
  esperaRestanteMs, formatarEspera, limparTentativas, registrarErro,
} from "@/lib/loginTentativas";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import takeatLogo from "@/assets/takeat-logo-white.png";
import financeBg from "@/assets/finance-bg-dashboard.jpg";

/** O último e-mail usado, NESTE aparelho. Conveniência local; não sai daqui. */
const CHAVE_ULTIMO_EMAIL = "hub:ultimo-email";

function lerUltimoEmail(): string {
  try { return localStorage.getItem(CHAVE_ULTIMO_EMAIL) ?? ""; } catch { return ""; }
}
function gravarUltimoEmail(email: string): void {
  try { localStorage.setItem(CHAVE_ULTIMO_EMAIL, email); } catch { /* sem armazenamento */ }
}

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();

  const [email, setEmail] = useState(lerUltimoEmail);
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(lembraNesteDispositivo);
  const [busy, setBusy] = useState(false);
  const [linkEnviado, setLinkEnviado] = useState(false);
  const [esperaMs, setEsperaMs] = useState(() => esperaRestanteMs());

  useEffect(() => {
    document.title = "Login · Takeat Hub Financeiro";
  }, []);

  /* O relógio do freio. Só corre enquanto há espera — sem intervalo pendurado
     na tela parada. */
  useEffect(() => {
    if (esperaMs <= 0) return;
    const t = setInterval(() => setEsperaMs(esperaRestanteMs()), 1000);
    return () => clearInterval(t);
  }, [esperaMs > 0]);

  if (loading) return null;
  // Volta para onde a pessoa queria ir — o link de uma anotação, por exemplo. Este é o
  // caminho da senha, em que o `state` da rota sobrevive; a volta do magic link não passa
  // por aqui (o Supabase devolve na raiz) e quem cuida dela é o `useVoltarAoDestino` dos
  // layouts. Só caminho de dentro do Hub passa no filtro — ver lib/destinoLogin.
  if (user) return <Navigate to={destinoSeguro((location.state as any)?.destino)} replace />;

  const travado = esperaMs > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (travado) return;

    const alvo = email.trim().toLowerCase();
    if (!alvo || !password) return toast.error("Preencha e-mail e senha.");

    // A escolha da caixa precisa valer ANTES de a sessão ser gravada.
    lembrarNesteDispositivo(remember);

    setBusy(true);
    const { error } = await signIn(alvo, password);
    setBusy(false);

    if (error) {
      const espera = registrarErro();
      setEsperaMs(espera);
      setPassword("");
      // Mensagem única de propósito. O erro cru do Supabase distingue e-mail
      // inexistente de senha errada — e é essa distinção que entrega a lista de
      // quem tem conta a quem está testando endereços.
      return toast.error(
        espera > 0
          ? `E-mail ou senha incorretos. Aguarde ${formatarEspera(espera)} antes de tentar de novo.`
          : "E-mail ou senha incorretos.",
      );
    }

    limparTentativas();
    gravarUltimoEmail(alvo);
  };

  /**
   * Magic link — só no celular. Digitar senha no teclado do telefone é o atrito que faz a
   * pessoa desistir de abrir o app; o link chega no mesmo e-mail e abre a sessão.
   *
   * `shouldCreateUser: false` é obrigatório: sem isso um e-mail digitado errado CRIA um
   * usuário novo no Auth, fora da tabela `profiles` e fora do controle de cargo.
   */
  const enviarMagicLink = async () => {
    const alvo = email.trim().toLowerCase();
    if (!alvo) return toast.error("Digite seu e-mail.");
    guardarDestino((location.state as any)?.destino);

    // O link do e-mail costuma abrir numa ABA NOVA, e `sessionStorage` não
    // atravessa abas: com "lembrar" desmarcado a sessão chegaria e se perderia.
    // Neste caminho a persistência é sempre local.
    lembrarNesteDispositivo(true);

    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: alvo,
      // `emailRedirectTo` continua sendo a RAIZ de propósito: qualquer outro endereço
      // precisa estar na allow-list de redirecionamento do projeto no Supabase, e um
      // caminho novo ali derrubaria o login por magic link inteiro. Quem leva o destino
      // até o outro lado é o `guardarDestino` acima — ver lib/destinoLogin.
      options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: false },
    });
    setBusy(false);

    // Mesma resposta em qualquer caso, pelo mesmo motivo da recusa de login:
    // "esse e-mail não existe" é um verificador de contas de graça.
    if (error && !/not found|no user|signups? not allowed/i.test(error.message)) {
      return toast.error(error.message);
    }
    gravarUltimoEmail(alvo);
    setLinkEnviado(true);
    toast.success("Se houver uma conta com esse e-mail, o link acabou de sair.");
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

            {/*
              Aqui ficavam RECEITA BRUTA, CASHBURN e EDITAIS ATIVOS, ao vivo, para
              quem ainda não tinha entrado. Um painel público não distingue cliente
              curioso de concorrente. O que a empresa faz pode ser dito sem número.
            */}
            <div className="mt-10 grid grid-cols-1 gap-5 border-t border-white/10 pt-6 sm:grid-cols-3 md:max-w-lg">
              <Recurso icone={LineChart} titulo="DRE e DFC" texto="Fechamento com rastro até o lançamento." />
              <Recurso icone={Radar} titulo="Radar de editais" texto="Oportunidades garimpadas todo dia." />
              <Recurso icone={Bot} titulo="Automações" texto="O trabalho repetitivo roda sozinho." />
            </div>
          </div>

          {/* Right: login card */}
          <div className="w-full justify-self-center lg:justify-self-end">
            <div className="w-full rounded-2xl bg-white p-6 text-foreground shadow-2xl md:p-7">
              <h2 className="text-xl font-semibold">Entrar</h2>
              <p className="mt-1 text-sm text-muted-foreground">Acesso restrito ao time da Takeat.</p>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium text-foreground/80">E-mail</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                    autoFocus={!email}
                    placeholder="voce@takeat.app"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium text-foreground/80">Senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPwd ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      autoFocus={!!email}
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

                <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-foreground/80">
                  <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
                  Lembrar de mim neste dispositivo
                </label>

                {travado && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                    Tentativas demais. Você poderá tentar de novo em {formatarEspera(esperaMs)}.
                  </p>
                )}

                <Button
                  type="submit"
                  className="h-11 w-full text-sm font-semibold"
                  disabled={busy || travado}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Entrar
                  {!busy && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>

                {isMobile && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-3">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-[11px] text-muted-foreground">ou</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full text-sm"
                      onClick={enviarMagicLink}
                      disabled={busy || linkEnviado}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      {linkEnviado ? "Link enviado — confira o e-mail" : "Receber link por e-mail"}
                    </Button>
                  </div>
                )}
              </form>

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Lock className="h-3 w-3" /> Conexão segura via SSL · LGPD
                </span>
                <span>v3.3.0</span>
              </div>
            </div>

            <p className="mt-4 flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-white/50">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
              Precisa de acesso? Peça ao time financeiro. Contas são criadas apenas
              internamente — esta tela não faz cadastro.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}

function Recurso({
  icone: Icone, titulo, texto,
}: {
  icone: typeof LineChart; titulo: string; texto: string;
}) {
  return (
    <div>
      <Icone className="h-4 w-4 text-white/55" aria-hidden />
      <div className="mt-2 text-[13px] font-semibold text-white/90">{titulo}</div>
      <div className="mt-0.5 text-[11.5px] leading-relaxed text-white/55">{texto}</div>
    </div>
  );
}
