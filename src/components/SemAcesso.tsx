import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

/**
 * A conta existe, o acesso ainda não.
 *
 * Antes de 10/09/2026 esta tela não precisava existir: quem entrasse com um
 * cargo que o Hub não reconhecia ganhava o Hub inteiro. Agora o padrão é o
 * mínimo, e o mínimo precisa de um lugar para pousar — senão a pessoa cai num
 * menu vazio e conclui que o sistema quebrou.
 *
 * O texto diz o que fazer, não pede desculpa: quem lê isto precisa saber a quem
 * pedir, e o pedido é de uma linha ("me põe no perfil X").
 */
export function SemAcesso() {
  const { profile, signOut } = useAuth();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
        <div className="rounded-full bg-muted p-3">
          <ShieldQuestion className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-foreground">
            Seu acesso ainda não foi definido
          </h1>
          <p className="text-sm text-muted-foreground">
            A conta de <strong className="font-medium text-foreground">{profile?.nome || "—"}</strong> está
            criada, mas ninguém escolheu ainda o que ela enxerga no Hub.
          </p>
        </div>
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Peça ao time financeiro que abra <strong className="font-medium text-foreground">Configurações ›
          Usuários</strong> e escolha o seu perfil de acesso. Leva um minuto.
        </p>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sair
        </Button>
      </div>
    </div>
  );
}

export default SemAcesso;
