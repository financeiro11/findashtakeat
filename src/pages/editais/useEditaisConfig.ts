import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EditaisFilterSettings {
  id?: string;
  min_match_score: number;
  preferred_keywords: string[];
  excluded_keywords: string[];
  preferred_sources: string[];
  excluded_sources: string[];
  preferred_regions: string[];
  opportunity_types: string[];
  show_low_relevance: boolean;
  show_pncp_results: boolean;
  pncp_min_match_score: number;
  fapes_priority_boost: number;
  startup_priority_boost: number;
  innovation_priority_boost: number;
  perfil_empresa: string;
  notif_prazo: boolean;
  notif_diarias: boolean;
}

export const SETTINGS_DEFAULTS: EditaisFilterSettings = {
  min_match_score: 60,
  preferred_keywords: [],
  excluded_keywords: [],
  preferred_sources: [],
  excluded_sources: [],
  preferred_regions: [],
  opportunity_types: ["fomento","subvencao","chamada_publica","programa_startup","aceleracao","premio"],
  show_low_relevance: false,
  show_pncp_results: true,
  pncp_min_match_score: 80,
  fapes_priority_boost: 30,
  startup_priority_boost: 20,
  innovation_priority_boost: 20,
  perfil_empresa: "",
  notif_prazo: true,
  notif_diarias: false,
};

const EVT = "editais-config-changed";

export async function loadFilterSettings(): Promise<EditaisFilterSettings> {
  const { data } = await supabase.from("edital_filter_settings" as any).select("*").limit(1).maybeSingle();
  if (!data) return SETTINGS_DEFAULTS;
  return { ...SETTINGS_DEFAULTS, ...(data as any) };
}

export async function saveFilterSettings(s: EditaisFilterSettings): Promise<void> {
  const { id, ...rest } = s;
  if (id) {
    await supabase.from("edital_filter_settings" as any).update(rest).eq("id", id);
  } else {
    // pega o singleton existente
    const { data } = await supabase.from("edital_filter_settings" as any).select("id").limit(1).maybeSingle();
    if ((data as any)?.id) {
      await supabase.from("edital_filter_settings" as any).update(rest).eq("id", (data as any).id);
    } else {
      await supabase.from("edital_filter_settings" as any).insert(rest);
    }
  }
  window.dispatchEvent(new Event(EVT));
}

export function useEditaisConfig() {
  const [cfg, setCfg] = useState<EditaisFilterSettings>(SETTINGS_DEFAULTS);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const s = await loadFilterSettings();
    setCfg(s);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const onCustom = () => reload();
    window.addEventListener(EVT, onCustom);
    return () => window.removeEventListener(EVT, onCustom);
  }, []);

  return { cfg, loading, reload };
}
