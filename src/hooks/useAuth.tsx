import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Profile = { id: string; user_id: string; nome: string; cargo: string | null; email: string };

type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
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

  const loadProfile = async (uid: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    setProfile((data as Profile) ?? null);
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
      if (s?.user) setTimeout(() => loadProfile(s.user.id), 0);
      else setProfile(null);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadProfile(s.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
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

  return (
    <Ctx.Provider value={{
      session, user, profile, loading, recuperacao,
      signIn, signOut, definirNovaSenha, refreshProfile,
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
