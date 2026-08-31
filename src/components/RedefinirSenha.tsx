// A tela que aparece quando a pessoa chega pelo link de "esqueci a senha".
//
// Ela já está autenticada aqui — o link do Supabase abre sessão. O que falta é
// escolher a senha, e é por isso que esta tela BLOQUEIA o Hub em vez de ser uma
// caixinha no canto: quem chegou pelo link chegou para trocar a senha, e deixar
// entrar sem trocar é a forma mais fácil de a senha velha (ou vazada) continuar
// valendo.
//
// A régua é a mesma dos dois lados — `lib/senha.ts` na tela, `_shared/senha.ts`
// no servidor. Ver o cabeçalho de qualquer um dos dois para o porquê de 12
// caracteres e da lista de proibidas.

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { MIN_SENHA, forcaDaSenha, motivoSenhaRuim } from "@/lib/senha";
import takeatLogo from "@/assets/takeat-logo-white.png";

export function BarraDeForca({ senha }: { senha: string }) {
  const { nivel, rotulo } = forcaDaSenha(senha);
  const cores = ["bg-muted", "bg-amber-500", "bg-lime-500", "bg-emerald-600"];
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= nivel ? cores[nivel] : "bg-muted"}`}
          />
        ))}
      </div>
      {senha && <p className="text-[11px] text-muted-foreground">Força: {rotulo}</p>}
    </div>
  );
}

export default function RedefinirSenha() {
  const { user, definirNovaSenha, signOut } = useAuth();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const email = user?.email ?? "";
  // Só reclama depois que a pessoa digitou algo — validar campo vazio de cara é
  // ralhar com quem ainda não fez nada.
  const problema = senha ? motivoSenhaRuim(senha, email) : null;
  const naoConfere = confirma.length > 0 && senha !== confirma;
  const podeSalvar = !problema && senha.length > 0 && senha === confirma && !ocupado;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const ruim = motivoSenhaRuim(senha, email);
    if (ruim) return toast.error(ruim);
    if (senha !== confirma) return toast.error("As senhas não coincidem.");

    setOcupado(true);
    const { error } = await definirNovaSenha(senha);
    setOcupado(false);
    if (error) return toast.error(error);
    toast.success("Senha redefinida. Bem-vindo de volta.");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: "hsl(0 80% 10%)" }}
          >
            <img src={takeatLogo} alt="Takeat" className="h-6 w-6 object-contain" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">Hub Financeiro</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-lg md:p-7">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Escolha uma nova senha</h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {email ? <>Você está redefinindo a senha de <strong>{email}</strong>.</> : "Defina a senha da sua conta."}{" "}
            Mínimo de {MIN_SENHA} caracteres.
          </p>

          <form onSubmit={salvar} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nova">Nova senha</Label>
              <div className="relative">
                <Input
                  id="nova"
                  type={mostrar ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  className="h-11 pr-20"
                />
                <button
                  type="button"
                  onClick={() => setMostrar((m) => !m)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {mostrar ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <BarraDeForca senha={senha} />
              {problema && <p className="text-[11.5px] text-destructive">{problema}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirma">Confirmar senha</Label>
              <Input
                id="confirma"
                type={mostrar ? "text" : "password"}
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
                autoComplete="new-password"
                className="h-11"
              />
              {naoConfere && <p className="text-[11.5px] text-destructive">As senhas não coincidem.</p>}
            </div>

            <Button type="submit" className="h-11 w-full text-sm font-semibold" disabled={!podeSalvar}>
              {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar e entrar
            </Button>
          </form>

          <button
            type="button"
            onClick={() => signOut()}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Cancelar e sair
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Uma dica: uma frase de quatro palavras que só você usaria é mais forte — e mais fácil de
          lembrar — do que trocar letras por símbolos.
        </p>
      </div>
    </div>
  );
}
