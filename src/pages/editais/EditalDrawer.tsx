import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Star, Send, Workflow, ExternalLink, Sparkles, FileText, AlertTriangle, Target, ListChecks, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { Edital, STATUS_LIST, PIPELINE_STAGES, PRIORIDADES, CATEGORIAS, REGIOES, fmtBRL, statusBadge, prioridadeBadge, matchColor, daysUntil } from "./types";

interface Props {
  edital: Edital | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

export default function EditalDrawer({ edital, open, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState<Partial<Edital>>({});
  const [generating, setGenerating] = useState(false);

  useEffect(() => { if (edital) setForm(edital); }, [edital]);

  if (!edital) return null;

  const set = <K extends keyof Edital>(k: K, v: Edital[K]) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    const payload: any = { ...form };
    delete payload.id; delete payload.created_at; delete payload.updated_at;
    payload.valor_estimado = Number(payload.valor_estimado || 0);
    payload.match_score = Number(payload.match_score || 0);
    const { error } = await supabase.from("editais" as any).update(payload).eq("id", edital.id);
    if (error) return toast.error(error.message);
    toast.success("Edital atualizado");
    onSaved();
  };

  const remove = async () => {
    if (!confirm("Excluir edital?")) return;
    const { error } = await supabase.from("editais" as any).delete().eq("id", edital.id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    onOpenChange(false);
    onSaved();
  };

  const togglePrioritario = async () => {
    const next = form.prioridade === "Alta" ? "Média" : "Alta";
    set("prioridade", next);
    await supabase.from("editais" as any).update({ prioridade: next }).eq("id", edital.id);
    onSaved();
  };

  const moverPipeline = async (stage: string) => {
    set("pipeline_stage", stage);
    await supabase.from("editais" as any).update({ pipeline_stage: stage }).eq("id", edital.id);
    toast.success(`Movido para ${stage}`);
    onSaved();
  };

  const enviarAnalise = async () => {
    set("status", "Em análise");
    await supabase.from("editais" as any).update({ status: "Em análise", pipeline_stage: "Em análise" }).eq("id", edital.id);
    toast.success("Enviado para análise");
    onSaved();
  };

  const gerarResumoIA = async () => {
    setGenerating(true);
    try {
      const prompt = `Você é analista de licitações. Gere em JSON com chaves "resumo", "criterios", "documentos" (array), "riscos", "proximos_passos", "match_score" (0-100). Edital: Título: ${form.titulo}. Órgão: ${form.orgao}. Modalidade: ${form.modalidade}. Objeto: ${form.objeto}. Valor: ${form.valor_estimado}. Prazo: ${form.prazo_envio}. Categoria: ${form.categoria}. Região: ${form.regiao}.`;
      const { data, error } = await supabase.functions.invoke("ai-chat", {
        body: { messages: [{ role: "user", content: prompt }], model: "google/gemini-2.5-flash" },
      });
      if (error) throw error;
      const text: string = data?.content ?? data?.message ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("IA não retornou JSON");
      const parsed = JSON.parse(match[0]);
      const updates: any = {
        resumo_ia: parsed.resumo ?? null,
        criterios_elegibilidade: parsed.criterios ?? null,
        documentos: Array.isArray(parsed.documentos) ? parsed.documentos : [],
        riscos: parsed.riscos ?? null,
        proximos_passos: parsed.proximos_passos ?? null,
        match_score: Number(parsed.match_score ?? 0),
      };
      setForm(f => ({ ...f, ...updates }));
      await supabase.from("editais" as any).update(updates).eq("id", edital.id);
      toast.success("Resumo IA gerado");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Falha na IA");
    } finally {
      setGenerating(false);
    }
  };

  const dias = daysUntil(form.prazo_envio ?? null);
  const score = Number(form.match_score ?? 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl w-full overflow-y-auto">
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={statusBadge(form.status ?? "")}>{form.status}</Badge>
            <Badge variant="outline" className={prioridadeBadge(form.prioridade ?? "")}>{form.prioridade}</Badge>
            {form.categoria && <Badge variant="outline">{form.categoria}</Badge>}
            {form.regiao && <Badge variant="outline">{form.regiao}</Badge>}
            <Badge variant="outline" className="ml-auto">
              <Target className={`h-3 w-3 mr-1 ${matchColor(score)}`} />
              <span className={matchColor(score)}>Match {score}%</span>
            </Badge>
          </div>
          <SheetTitle asChild>
            <Input
              value={form.titulo ?? ""}
              onChange={e => set("titulo", e.target.value)}
              placeholder="Título do edital"
              className="text-xl font-semibold h-auto py-1.5 px-2 -mx-2 border-transparent hover:border-input focus-visible:border-input bg-transparent"
            />
          </SheetTitle>
          <SheetDescription>{form.orgao} {form.numero && `· ${form.numero}`}</SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="rounded-lg border p-3 bg-card/50">
            <div className="text-[10px] uppercase text-muted-foreground">Valor potencial</div>
            <div className="text-sm font-semibold num">{fmtBRL(form.valor_estimado ?? 0)}</div>
          </div>
          <div className="rounded-lg border p-3 bg-card/50">
            <div className="text-[10px] uppercase text-muted-foreground">Prazo</div>
            <div className="text-sm font-semibold num">{form.prazo_envio ?? "—"}</div>
            {dias !== null && <div className={`text-[10px] ${dias < 0 ? "text-rose-600" : dias < 7 ? "text-amber-600" : "text-muted-foreground"}`}>{dias < 0 ? `${Math.abs(dias)}d atrás` : `${dias}d restantes`}</div>}
          </div>
          <div className="rounded-lg border p-3 bg-card/50">
            <div className="text-[10px] uppercase text-muted-foreground">Pipeline</div>
            <div className="text-sm font-semibold">{form.pipeline_stage}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <Button size="sm" variant={form.prioridade === "Alta" ? "default" : "outline"} onClick={togglePrioritario}>
            <Star className="h-3 w-3 mr-1" /> Prioritário
          </Button>
          <Button size="sm" variant="outline" onClick={enviarAnalise}><Send className="h-3 w-3 mr-1" /> Enviar para análise</Button>
          <Select value={form.pipeline_stage} onValueChange={moverPipeline}>
            <SelectTrigger className="h-9 w-[180px]"><Workflow className="h-3 w-3 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent>{PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          {form.link && (
            <Button size="sm" variant="outline" asChild>
              <a href={form.link} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Link oficial</a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={gerarResumoIA} disabled={generating}>
            <Sparkles className="h-3 w-3 mr-1" /> {generating ? "Gerando..." : "Resumo IA"}
          </Button>
        </div>

        <Tabs defaultValue="resumo" className="mt-5">
          <TabsList className="w-full">
            <TabsTrigger value="resumo" className="flex-1">Resumo</TabsTrigger>
            <TabsTrigger value="detalhes" className="flex-1">Detalhes</TabsTrigger>
            <TabsTrigger value="docs" className="flex-1">Documentos</TabsTrigger>
            <TabsTrigger value="risco" className="flex-1">Riscos</TabsTrigger>
          </TabsList>

          <TabsContent value="resumo" className="space-y-3 mt-4">
            <div>
              <Label className="text-xs flex items-center gap-1"><Sparkles className="h-3 w-3" /> Resumo executivo (IA)</Label>
              <Textarea rows={5} value={form.resumo_ia ?? ""} onChange={e => set("resumo_ia", e.target.value)} placeholder="Gere automaticamente com Resumo IA ou escreva manualmente..." />
            </div>
            <div>
              <Label className="text-xs">Descrição / Objeto</Label>
              <Textarea rows={4} value={form.objeto ?? ""} onChange={e => set("objeto", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs"><ListChecks className="h-3 w-3 inline mr-1" /> Próximos passos</Label>
              <Textarea rows={3} value={form.proximos_passos ?? ""} onChange={e => set("proximos_passos", e.target.value)} />
            </div>
          </TabsContent>

          <TabsContent value="detalhes" className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Título</Label><Input value={form.titulo ?? ""} onChange={e => set("titulo", e.target.value)} /></div>
              <div><Label className="text-xs">Número</Label><Input value={form.numero ?? ""} onChange={e => set("numero", e.target.value)} /></div>
              <div><Label className="text-xs">Órgão / Fonte</Label><Input value={form.orgao ?? ""} onChange={e => set("orgao", e.target.value)} /></div>
              <div><Label className="text-xs">Fonte (portal)</Label><Input value={form.fonte ?? ""} onChange={e => set("fonte", e.target.value)} /></div>
              <div><Label className="text-xs">Modalidade</Label><Input value={form.modalidade ?? ""} onChange={e => set("modalidade", e.target.value)} /></div>
              <div><Label className="text-xs">Responsável</Label><Input value={form.responsavel ?? ""} onChange={e => set("responsavel", e.target.value)} /></div>
              <div><Label className="text-xs">Categoria</Label>
                <Select value={form.categoria ?? ""} onValueChange={v => set("categoria", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Região</Label>
                <Select value={form.regiao ?? ""} onValueChange={v => set("regiao", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{REGIOES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Status</Label>
                <Select value={form.status ?? ""} onValueChange={v => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Prioridade</Label>
                <Select value={form.prioridade ?? ""} onValueChange={v => set("prioridade", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORIDADES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Valor estimado</Label><Input type="number" value={form.valor_estimado ?? 0} onChange={e => set("valor_estimado", Number(e.target.value))} /></div>
              <div><Label className="text-xs">Match Score (0-100)</Label><Input type="number" min={0} max={100} value={form.match_score ?? 0} onChange={e => set("match_score", Number(e.target.value))} /></div>
              <div><Label className="text-xs">Publicação</Label><Input type="date" value={form.data_publicacao ?? ""} onChange={e => set("data_publicacao", e.target.value || null)} /></div>
              <div><Label className="text-xs">Abertura</Label><Input type="date" value={form.data_abertura ?? ""} onChange={e => set("data_abertura", e.target.value || null)} /></div>
              <div><Label className="text-xs">Prazo de envio</Label><Input type="date" value={form.prazo_envio ?? ""} onChange={e => set("prazo_envio", e.target.value || null)} /></div>
              <div className="col-span-2"><Label className="text-xs">Link oficial</Label><Input value={form.link ?? ""} onChange={e => set("link", e.target.value)} /></div>
              <div className="col-span-2"><Label className="text-xs">Critérios de elegibilidade</Label><Textarea rows={3} value={form.criterios_elegibilidade ?? ""} onChange={e => set("criterios_elegibilidade", e.target.value)} /></div>
              <div className="col-span-2"><Label className="text-xs">Observação</Label><Textarea rows={2} value={form.observacao ?? ""} onChange={e => set("observacao", e.target.value)} /></div>
            </div>
          </TabsContent>

          <TabsContent value="docs" className="space-y-3 mt-4">
            <Label className="text-xs flex items-center gap-1"><FileText className="h-3 w-3" /> Documentos necessários (um por linha)</Label>
            <Textarea
              rows={8}
              value={(form.documentos ?? []).join("\n")}
              onChange={e => set("documentos", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
              placeholder="Atestado de capacidade técnica&#10;Certidão negativa&#10;..."
            />
          </TabsContent>

          <TabsContent value="risco" className="space-y-3 mt-4">
            <div>
              <Label className="text-xs flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Riscos identificados</Label>
              <Textarea rows={6} value={form.riscos ?? ""} onChange={e => set("riscos", e.target.value)} />
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={remove} className="text-destructive"><Trash2 className="h-3 w-3 mr-1" /> Excluir</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button size="sm" onClick={save}><Save className="h-3 w-3 mr-1" /> Salvar</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
