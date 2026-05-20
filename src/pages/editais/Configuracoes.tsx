import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Bell, Database, RefreshCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EditaisFilterSettings, SETTINGS_DEFAULTS, loadFilterSettings, saveFilterSettings } from "./useEditaisConfig";
import { OPPORTUNITY_TYPES } from "./types";

const splitList = (s: string) => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const joinList = (a: string[]) => (a ?? []).join(", ");

export default function Configuracoes() {
  const [cfg, setCfg] = useState<EditaisFilterSettings>(SETTINGS_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  useEffect(() => {
    document.title = "Editais · Configurações";
    loadFilterSettings().then(s => { setCfg(s); setLoading(false); });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveFilterSettings(cfg);
      toast.success("Configurações salvas e aplicadas em Radar, Pipeline e Dashboard");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const reprocess = async () => {
    setReprocessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("editais-sync", { body: { reprocess: true } });
      if (error) throw error;
      toast.success(data?.mensagem ?? "Reprocessamento concluído");
    } catch (e: any) {
      toast.error(`Falha: ${e.message ?? e}`);
    } finally { setReprocessing(false); }
  };

  const set = <K extends keyof EditaisFilterSettings>(k: K, v: EditaisFilterSettings[K]) =>
    setCfg(c => ({ ...c, [k]: v }));

  const toggleType = (t: string) => {
    const has = cfg.opportunity_types.includes(t);
    set("opportunity_types", has ? cfg.opportunity_types.filter(x => x !== t) : [...cfg.opportunity_types, t]);
  };

  if (loading) return <div className="text-sm text-muted-foreground">Carregando configurações...</div>;

  return (
    <div className="grid gap-4 max-w-4xl">
      {/* Score & comportamento */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Score e curadoria</div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Score mínimo geral (%)</Label>
            <Input type="number" min={0} max={100} value={cfg.min_match_score}
              onChange={e => set("min_match_score", Number(e.target.value))} className="w-32" />
            <p className="text-[11px] text-muted-foreground mt-1">Editais abaixo disso ficam ocultos.</p>
          </div>
          <div>
            <Label className="text-xs">Score mínimo PNCP (%)</Label>
            <Input type="number" min={0} max={100} value={cfg.pncp_min_match_score}
              onChange={e => set("pncp_min_match_score", Number(e.target.value))} className="w-32" />
            <p className="text-[11px] text-muted-foreground mt-1">Compras públicas só aparecem se forem altíssima aderência.</p>
          </div>
          <div>
            <Label className="text-xs">Boost FAPES</Label>
            <Input type="number" value={cfg.fapes_priority_boost}
              onChange={e => set("fapes_priority_boost", Number(e.target.value))} className="w-32" />
          </div>
          <div>
            <Label className="text-xs">Boost Startup</Label>
            <Input type="number" value={cfg.startup_priority_boost}
              onChange={e => set("startup_priority_boost", Number(e.target.value))} className="w-32" />
          </div>
          <div>
            <Label className="text-xs">Boost Inovação</Label>
            <Input type="number" value={cfg.innovation_priority_boost}
              onChange={e => set("innovation_priority_boost", Number(e.target.value))} className="w-32" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Mostrar editais ocultos no Radar</div>
                <div className="text-[11px] text-muted-foreground">Pula filtro de relevância na listagem</div>
              </div>
              <Switch checked={cfg.show_low_relevance} onCheckedChange={v => set("show_low_relevance", v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Capturar PNCP</div>
                <div className="text-[11px] text-muted-foreground">Desligue para parar de exibir contratações públicas</div>
              </div>
              <Switch checked={cfg.show_pncp_results} onCheckedChange={v => set("show_pncp_results", v)} />
            </div>
          </div>
        </div>
      </Card>

      {/* Tipos de oportunidade */}
      <Card className="p-5">
        <div className="text-sm font-semibold mb-3">Tipos de oportunidade exibidos no Radar</div>
        <div className="flex flex-wrap gap-2">
          {OPPORTUNITY_TYPES.map(t => {
            const active = cfg.opportunity_types.includes(t.value);
            return (
              <Badge
                key={t.value}
                variant={active ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleType(t.value)}
              >
                {t.label}
              </Badge>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Tipos não selecionados ficam ocultos (exceto PNCP com altíssimo score).
        </p>
      </Card>

      {/* Palavras-chave */}
      <Card className="p-5">
        <div className="text-sm font-semibold mb-3">Palavras-chave</div>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Preferidas (positivas) — separadas por vírgula</Label>
            <Textarea rows={3} value={joinList(cfg.preferred_keywords)}
              onChange={e => set("preferred_keywords", splitList(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Excluídas (negativas) — qualquer match penaliza fortemente</Label>
            <Textarea rows={3} value={joinList(cfg.excluded_keywords)}
              onChange={e => set("excluded_keywords", splitList(e.target.value))} />
          </div>
        </div>
      </Card>

      {/* Fontes & regiões */}
      <Card className="p-5">
        <div className="text-sm font-semibold mb-3">Fontes e regiões</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Fontes preferidas (slug, ex: fapes, finep)</Label>
            <Input value={joinList(cfg.preferred_sources)}
              onChange={e => set("preferred_sources", splitList(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Fontes excluídas</Label>
            <Input value={joinList(cfg.excluded_sources)}
              onChange={e => set("excluded_sources", splitList(e.target.value))} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Regiões preferidas (UF / cidade / "Nacional")</Label>
            <Input value={joinList(cfg.preferred_regions)}
              onChange={e => set("preferred_regions", splitList(e.target.value))} />
          </div>
        </div>
      </Card>

      {/* Perfil */}
      <Card className="p-5">
        <div className="text-sm font-semibold mb-3">Perfil da empresa</div>
        <Textarea rows={4} value={cfg.perfil_empresa}
          onChange={e => set("perfil_empresa", e.target.value)}
          placeholder="Startup SaaS de tecnologia para food service..." />
      </Card>

      {/* Notificações */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3"><Bell className="h-4 w-4 text-primary" /><div className="text-sm font-semibold">Notificações</div></div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div><div className="text-sm">Alertas de prazo próximo</div><div className="text-xs text-muted-foreground">Avisar quando faltar 7 dias</div></div>
            <Switch checked={cfg.notif_prazo} onCheckedChange={v => set("notif_prazo", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-sm">Resumo diário</div><div className="text-xs text-muted-foreground">Resumo de novos editais capturados</div></div>
            <Switch checked={cfg.notif_diarias} onCheckedChange={v => set("notif_diarias", v)} />
          </div>
        </div>
      </Card>

      <Card className="p-5 bg-muted/30">
        <div className="flex items-center gap-2 mb-2"><Database className="h-4 w-4 text-muted-foreground" /><div className="text-sm font-semibold">Reprocessar editais existentes</div></div>
        <p className="text-xs text-muted-foreground mb-3">
          Recalcula score e visibilidade de todos os editais já capturados usando estas configurações. Útil após mudar palavras-chave ou thresholds.
        </p>
        <Button onClick={reprocess} disabled={reprocessing} variant="outline" size="sm">
          <RefreshCcw className={`h-4 w-4 mr-2 ${reprocessing ? "animate-spin" : ""}`} />
          {reprocessing ? "Reprocessando..." : "Reprocessar relevância agora"}
        </Button>
      </Card>

      <div className="flex justify-end sticky bottom-0 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>
    </div>
  );
}
