import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { conferirSessao } from "@/lib/sessaoViva";
import { acessoDe, matrizDeLinhas, type Acesso, type MatrizAcesso, type PerfilId } from "@/lib/modules";

/**
 * `cargo` é o que a pessoa É (texto livre, aparece na tela). `perfil` é o que ela
 * VÊ (lista fechada, ver lib/modules.ts). São campos diferentes de propósito
 * desde 10/09/2026 — "Head de Produto" e "Head de Operações" são cargos
 * distintos com o mesmo acesso.
 *
 * `perfil` opcional, e não `| null` apenas: `undefined` significa que a coluna
 * ainda não existe no banco, e é o que `perfilDe` usa para decidir se cai no
 * de-para por cargo ou tranca a conta.
 */
type Profile = {
  id: string; user_id: string; nome: string; cargo: string | null; email: string;
  perfil?: PerfilId | null;
  /**
   * Os times que esta conta enxerga na folha (nome do setor no Portal RH).
   * Só vale para quem tem a capacidade `remuneracao_time` — o líder. Vazio não
   * abre ninguém. Ver `Acesso.folha` em lib/modules.ts.
   */
  setores_folha?: string[] | null;
};

type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /**
   * O que esta pessoa vê — perfil + matriz do banco, já resolvidos.
   *
   * Vem daqui e não de `acessoDe(profile)` espalhado pelas telas porque a matriz
   * agora é DADO (tabela `acesso_perfil`, editável em Usuários): cada chamada
   * solta refaria a leitura ou usaria o padrão do código sem saber. Ver
   * `useAcesso()`.
   */
  acesso: Acesso;
  /**
   * A matriz crua, para quem precisa calcular o acesso de OUTRO perfil — a tela
   * de Usuários, que decide se o perfil escolhido no seletor pede o campo de
   * times da folha. `null` = ainda não carregou, ou a leitura falhou.
   */
  matriz: MatrizAcesso | null;
  /** Relê a matriz do banco — a tela de Perfis de acesso chama após salvar. */
  recarregarMatriz: () => Promise<void>;
  /**
   * Verdadeiro quando a pessoa chegou pelo link de "esqueci a senha". Ela TEM
   * sessão (o link autentica), mas ainda não escolheu senha nova — e enquanto
   * não escolher, o Hub não abre. Ver `components/RedefinirSenha.tsx`.
   */
  recuperacao: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  definirNovaSenha: (senha: string) => Promise<{ error?: string }>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recuperacao, setRecuperacao] = useState(false);
  const [matriz, setMatriz] = useState<MatrizAcesso | null>(null);

  const loadProfile = async (uid: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    setProfile((data as Profile) ?? null);
  };

  /* A matriz de acesso, da tabela `acesso_perfil`.
     Falha de leitura deixa `matriz` em null DE PROPÓSITO, e null faz `acessoDe`
     usar o padrão escrito em `PERFIS` — a matriz revisada do repositório. Um
     objeto vazio aqui trancaria todo mundo fora do Hub por causa de uma queda de
     rede; o padrão do código é o único fallback que se audita lendo um arquivo. */
  const loadMatriz = async () => {
    const { data, error } = await supabase.from("acesso_perfil").select("perfil, capacidades");
    if (error || !data?.length) return;
    setMatriz(matrizDeLinhas(data as { perfil: string; capacidades: string[] | null }[]));
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      // O link de recuperação abre uma sessão de verdade. Sem marcar isto, a
      // pessoa cairia direto no Hub logada e NUNCA trocaria a senha — que é o
      // único motivo pelo qual ela clicou no link.
      if (evento === "PASSWORD_RECOVERY") setRecuperacao(true);
      if (evento === "SIGNED_OUT") setRecuperacao(false);

      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) setTimeout(() => { void loadProfile(s.user.id); void loadMatriz(); }, 0);
      else setProfile(null);
    });
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      /* ESPERA as duas antes de soltar `loading`. Sem o await, o Hub monta com
         `matriz` ainda null, calcula o acesso pelo padrão do código e desenha um
         menu que a matriz do banco pode ter encolhido — a pessoa vê por um
         instante o item que não é dela, e o clique cai no redirecionamento. */
      if (s?.user) await Promise.all([loadProfile(s.user.id), loadMatriz()]);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* Sessão zumbi (ver lib/sessaoViva.ts): o token continua válido e a página
     inteira segue funcionando, mas as Edge Functions recusam tudo com "Não
     autenticado.". Conferir ao VOLTAR para a aba é o momento certo — a sessão
     morre enquanto a pessoa está noutra aba (saiu, trocou de conta), e é ao
     voltar que ela vai clicar em algo. O relógio cobre quem nunca sai da tela,
     caso de quem teve a senha redefinida por um admin. */
  useEffect(() => {
    const conferir = () => {
      if (document.visibilityState === "visible") void conferirSessao();
    };
    document.addEventListener("visibilitychange", conferir);
    window.addEventListener("focus", conferir);
    const relogio = window.setInterval(conferir, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", conferir);
      window.removeEventListener("focus", conferir);
      window.clearInterval(relogio);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  };
  const signOut = async () => { setRecuperacao(false); await supabase.auth.signOut(); };

  const definirNovaSenha = async (senha: string) => {
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) return { error: error.message };
    setRecuperacao(false);
    return {};
  };

  const refreshProfile = async () => { if (user) await loadProfile(user.id); };

  const acesso = useMemo(() => acessoDe(profile, matriz), [profile, matriz]);

  return (
    <Ctx.Provider value={{
      session, user, profile, loading, recuperacao, acesso, matriz,
      signIn, signOut, definirNovaSenha, refreshProfile,
      recarregarMatriz: loadMatriz,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
};

/**
 * O acesso desta pessoa — perfil e matriz do banco já resolvidos.
 *
 * Use SEMPRE isto, nunca `acessoDe(profile)` direto numa tela: a matriz é dado
 * agora, e quem a carrega é o AuthProvider. Uma chamada solta usaria o padrão do
 * código e mostraria um menu que a edição em Usuários já tinha encolhido.
 */
export const useAcesso = (): Acesso => useAuth().acesso;
