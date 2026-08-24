import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { contarNaoLidos, hojeBRT, ultimoDiaComItem, type DiaNovidades } from "@/lib/novidades";

const sb = supabase as any;

/**
 * As Novidades do Hub — o que mudou na ferramenta, por dia, e até onde esta
 * pessoa já leu.
 *
 * A LEITURA É POR PESSOA (`hub_novidades_leitura`, uma linha por usuário com
 * RLS): o selo "3 novas" tem que dizer coisas diferentes para o Henrique e para
 * a Júlia. Guardar isso no localStorage zeraria a cada navegador novo e mentiria
 * quando um dos dois abrisse o Hub no notebook e no desktop.
 *
 * A tela só LÊ. Quem escreve o conteúdo é a Edge Function `hub-novidades-sync`
 * (cron das 08:35, antes do briefing) — `atualizar()` é a mesma função chamada à
 * mão, para quando alguém acaba de publicar e quer ver na hora.
 */
export function useNovidades(limiteDias = 30) {
  const { user } = useAuth();
  const [dias, setDias] = useState<DiaNovidades[]>([]);
  const [vistoAte, setVistoAte] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - limiteDias * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const [novidades, leitura] = await Promise.all([
      sb.from("hub_novidades").select("*").gte("dia", desde).order("dia", { ascending: false }),
      user ? sb.from("hub_novidades_leitura").select("visto_ate").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (novidades.error) setErro(novidades.error.message);
    else setErro(null);
    setDias(((novidades.data as any[]) ?? []).map((d) => ({
      ...d,
      itens: Array.isArray(d.itens) ? d.itens : [],
      commits: Array.isArray(d.commits) ? d.commits : [],
    })) as DiaNovidades[]);
    setVistoAte((leitura as any)?.data?.visto_ate ?? null);
    setLoading(false);
  }, [user, limiteDias]);

  useEffect(() => { carregar(); }, [carregar]);

  /** Repuxa do GitHub agora (o cron já fez isso de manhã) e recarrega a tela. */
  const atualizar = useCallback(async (dias_ = 2) => {
    setAtualizando(true);
    const { data, error } = await sb.functions.invoke("hub-novidades-sync", { body: { dias: dias_ } });
    setAtualizando(false);
    if (error || data?.ok === false) {
      const msg = data?.erro ?? error?.message ?? "erro desconhecido";
      setErro(msg);
      return { ok: false as const, erro: msg };
    }
    await carregar();
    return { ok: true as const, dias: data?.dias ?? [] };
  }, [carregar]);

  /** "Já vi tudo": marca até o último dia que tem alguma novidade. */
  const marcarLido = useCallback(async () => {
    if (!user) return;
    const ate = ultimoDiaComItem(dias) ?? hojeBRT();
    setVistoAte(ate);
    await sb.from("hub_novidades_leitura")
      .upsert({ user_id: user.id, visto_ate: ate, atualizado_em: new Date().toISOString() }, { onConflict: "user_id" });
  }, [user, dias]);

  return {
    dias, vistoAte, loading, atualizando, erro,
    naoLidos: contarNaoLidos(dias, vistoAte),
    carregar, atualizar, marcarLido,
  };
}
