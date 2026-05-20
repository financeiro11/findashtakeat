import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil, Save, X, Upload, FileSpreadsheet, BookOpen, Building2, Database, Search, Brain, ChevronRight, Maximize2 } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LibEntidades from "./biblioteca/LibEntidades";

type Doc = { id: string; titulo: string; conteudo: string; tipo: string; updated_at?: string; created_at?: string };

const TIPOS_NOTA = [
  { value: "empresa", label: "Sobre a empresa", desc: "Missão, visão, modelo de negócio", hue: 268 },
  { value: "estrategia", label: "Estratégia", desc: "OKRs, metas, prioridades", hue: 230 },
  { value: "processo", label: "Processo interno", desc: "Como algo é feito na empresa", hue: 210 },
  { value: "premissa", label: "Premissa", desc: "Suposições usadas em projeções", hue: 188 },
  { value: "produto", label: "Produto", desc: "Funcionalidades, posicionamento", hue: 152 },
  { value: "mercado", label: "Mercado / Cliente", desc: "ICP, concorrência, segmentos", hue: 32 },
  { value: "contrato", label: "Contrato / Termo", desc: "Acordos relevantes", hue: 18 },
  { value: "politica", label: "Política", desc: "Regras e diretrizes internas", hue: 48 },
  { value: "nota", label: "Nota geral", desc: "Outras informações livres", hue: 220 },
];

function tipoHue(v: string) {
  return TIPOS_NOTA.find((t) => t.value === v)?.hue ?? 220;
}

function tempoRelativo(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const dias = Math.floor(h / 24);
  if (dias < 7) return `há ${dias} dia${dias > 1 ? "s" : ""}`;
  const sem = Math.floor(dias / 7);
  if (sem < 4) return `há ${sem} semana${sem > 1 ? "s" : ""}`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} mês${meses > 1 ? "es" : ""}`;
}

export default function BaseConhecimento() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [novo, setNovo] = useState({ titulo: "", conteudo: "", tipo: "empresa" });
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<Doc | null>(null);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [colabCount, setColabCount] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Análise · Biblioteca";
    load();
    supabase.from("lib_colaboradores" as any).select("*", { count: "exact", head: true })
      .then(({ count }) => setColabCount(count || 0));
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("base_conhecimento" as any).select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message); else setDocs((data as any) || []);
    setLoading(false);
  };

  const adicionar = async () => {
    if (!novo.titulo || !novo.conteudo) return toast.error("Preencha título e conteúdo");
    const { error } = await supabase.from("base_conhecimento" as any).insert(novo);
    if (error) toast.error(error.message); else { setNovo({ titulo: "", conteudo: "", tipo: "empresa" }); load(); toast.success("Adicionado à Base de Conhecimento"); }
  };

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const importarPdf = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setPdfBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name}: máximo 20MB`); continue; }
        const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const up = await supabase.storage.from("base-conhecimento-pdf").upload(path, file, { contentType: "application/pdf" });
        if (up.error) { toast.error(`${file.name}: ${up.error.message}`); continue; }
        toast.info(`Lendo ${file.name}…`);
        const { data, error } = await supabase.functions.invoke("parse-base-conhecimento-pdf", {
          body: { path, filename: file.name, prefer_tipo: novo.tipo },
        });
        if (error) { toast.error(`${file.name}: ${error.message}`); continue; }
        toast.success(`${file.name}: ${(data as any)?.count || 0} nota(s) criadas`);
      }
      await load();
    } finally {
      setPdfBusy(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const remover = async (id: string) => {
    if (!confirm("Excluir este conhecimento?")) return;
    const { error } = await supabase.from("base_conhecimento" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const salvar = async () => {
    if (!editVal) return;
    const { error } = await supabase.from("base_conhecimento" as any).update({
      titulo: editVal.titulo, conteudo: editVal.conteudo, tipo: editVal.tipo,
    }).eq("id", editVal.id);
    if (error) toast.error(error.message); else { setEditId(null); setEditVal(null); load(); toast.success("Atualizado"); }
  };

  // separa notas de planilhas importadas
  const isPlanilha = (d: Doc) => /hist[oó]ric|dre|planilha|excel|vendas/i.test(d.tipo) || d.conteudo.startsWith("Origem: planilha");
  const notas = docs.filter((d) => !isPlanilha(d));
  const planilhas = docs.filter(isPlanilha);

  const notasFiltradas = notas.filter((d) => {
    const matchBusca = !busca || d.titulo.toLowerCase().includes(busca.toLowerCase()) || d.conteudo.toLowerCase().includes(busca.toLowerCase());
    const matchTipo = filtroTipo === "todos" || d.tipo === filtroTipo;
    return matchBusca && matchTipo;
  });

  const tipoLabel = (v: string) => TIPOS_NOTA.find((t) => t.value === v)?.label || v;

  return (
    <div className="space-y-6 p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2"><Brain className="h-6 w-6 text-primary" /></div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Biblioteca</h2>
            <Badge className="bg-violet-100 text-[10px] font-semibold uppercase tracking-wider text-violet-700 hover:bg-violet-100 dark:bg-violet-500/15 dark:text-violet-300">
              Cérebro da IA
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Tudo o que você adicionar aqui é lido pela IA em todo o Hub — chat, análises, classificações e dashboards.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><b className="text-foreground">{colabCount ?? "…"}</b> colaboradores</span>
            <span className="opacity-40">·</span>
            <span><b className="text-foreground">{docs.filter(d => !isPlanilha(d)).length}</b> documentos</span>
            <span className="opacity-40">·</span>
            <span><b className="text-foreground">{docs.filter(isPlanilha).length}</b> planilhas históricas</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="entidades" className="space-y-4">
        <TabsList>
          <TabsTrigger value="entidades">
            <Building2 className="mr-2 h-4 w-4" /> Estrutura
            {colabCount != null && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{colabCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="conhecimento">
            <BookOpen className="mr-2 h-4 w-4" /> Base de Conhecimento
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{docs.filter(d => !isPlanilha(d)).length}</span>
          </TabsTrigger>
          <TabsTrigger value="historico">
            <Database className="mr-2 h-4 w-4" /> Histórico (Excel)
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{docs.filter(isPlanilha).length}</span>
          </TabsTrigger>
        </TabsList>

        {/* ESTRUTURA — entidades organizacionais */}
        <TabsContent value="entidades" className="space-y-4">
          <LibEntidades />
        </TabsContent>

        {/* BASE DE CONHECIMENTO — notas livres sobre a empresa */}
        <TabsContent value="conhecimento" className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="space-y-3 p-5">
              <div>
                <div className="font-semibold">Adicionar conhecimento</div>
                <p className="text-xs text-muted-foreground">
                  Registre tudo que descreve a empresa — missão, modelo, processos, premissas. A IA passa a "saber" disso.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
                <Input
                  placeholder="Título (ex: Modelo de negócio da Takeat)"
                  value={novo.titulo}
                  onChange={(e) => setNovo({ ...novo, titulo: e.target.value })}
                />
                <Select value={novo.tipo} onValueChange={(v) => setNovo({ ...novo, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS_NOTA.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <div className="flex flex-col">
                          <span>{t.label}</span>
                          <span className="text-xs text-muted-foreground">{t.desc}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button onClick={adicionar} className="flex-1"><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pdfBusy}
                    onClick={() => pdfInputRef.current?.click()}
                    title="Enviar PDF — a IA lê e cria notas automaticamente"
                  >
                    <Upload className="mr-2 h-4 w-4" /> {pdfBusy ? "Lendo…" : "Importar PDF"}
                  </Button>
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => importarPdf(e.target.files)}
                  />
                </div>
              </div>
              <Textarea
                placeholder="Conteúdo… ex: 'A Takeat é um SaaS B2B para restaurantes que oferece menu digital, comanda eletrônica e relatórios financeiros. ICP: redes com 5+ unidades. Modelo de cobrança: mensalidade por loja…'"
                rows={5}
                value={novo.conteudo}
                onChange={(e) => setNovo({ ...novo, conteudo: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                💡 Dica: o "Importar PDF" envia o arquivo (até 20MB), extrai o texto e a IA gera 1 a 8 notas estruturadas automaticamente — você revisa depois.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar nos documentos…" className="h-9 pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {TIPOS_NOTA.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
              {notasFiltradas.length} de {notas.length}
            </span>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando...</div>
          ) : !notasFiltradas.length ? (
            <Card><CardContent className="flex flex-col items-center justify-center gap-2 p-10 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {notas.length ? "Nenhum conhecimento corresponde ao filtro." : "Ainda não há conhecimentos cadastrados. Comece com 'Sobre a empresa'."}
              </p>
            </CardContent></Card>
          ) : (
            <div className="grid gap-2.5">
              {notasFiltradas.map((d) => {
                const hue = tipoHue(d.tipo);
                const isEditing = editId === d.id && editVal;
                return (
                  <Card
                    key={d.id}
                    className="group relative overflow-hidden border-border/60 transition-shadow hover:shadow-sm"
                    style={{ borderLeft: `3px solid hsl(${hue} 70% 55%)` }}
                  >
                    <CardContent className="p-4">
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Input value={editVal!.titulo} onChange={(e) => setEditVal({ ...editVal!, titulo: e.target.value })} />
                            <Select value={editVal!.tipo} onValueChange={(v) => setEditVal({ ...editVal!, tipo: v })}>
                              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {TIPOS_NOTA.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button size="icon" variant="outline" onClick={salvar}><Save className="h-4 w-4" /></Button>
                            <Button size="icon" variant="outline" onClick={() => { setEditId(null); setEditVal(null); }}><X className="h-4 w-4" /></Button>
                          </div>
                          <Textarea rows={6} value={editVal!.conteudo} onChange={(e) => setEditVal({ ...editVal!, conteudo: e.target.value })} />
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold">{d.titulo}</h3>
                              <span
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  background: `hsl(${hue} 80% 95%)`,
                                  color: `hsl(${hue} 65% 32%)`,
                                }}
                              >
                                <span className="h-1 w-1 rounded-full" style={{ background: `hsl(${hue} 70% 50%)` }} />
                                {tipoLabel(d.tipo)}
                              </span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{d.conteudo}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                              <span>Atualizado {tempoRelativo(d.updated_at || d.created_at) || "—"}</span>
                              <span className="opacity-40">·</span>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                                Indexado pela IA
                              </span>
                              <button
                                type="button"
                                onClick={() => setViewing(d)}
                                className="ml-auto inline-flex items-center gap-1 rounded text-[10px] font-semibold uppercase tracking-wide text-primary hover:underline"
                              >
                                Ler mais <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewing(d)} title="Ler completo">
                              <Maximize2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(d.id); setEditVal(d); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remover(d.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* HISTÓRICO — planilhas Excel */}
        <TabsContent value="historico" className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-rose-500/10 p-2">
                  <Database className="h-5 w-5 text-rose-600" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold">Importar planilhas históricas</div>
                  <p className="text-xs text-muted-foreground">
                    Envie <code className="rounded bg-muted px-1">.xlsx</code>, <code className="rounded bg-muted px-1">.xls</code> ou <code className="rounded bg-muted px-1">.csv</code> com dados históricos (DRE, vendas, etc). Cada aba vira um documento lido pela IA.
                    Quando o layout for <b>métricas × meses</b>, os valores alimentam o dashboard <b>Histórico Multianual</b>.
                  </p>
                </div>
              </div>
              <ExcelUploader onImported={load} />
            </CardContent>
          </Card>

          <div className="flex items-baseline gap-2 px-1">
            <h3 className="text-sm font-semibold">Planilhas importadas</h3>
            <span className="text-xs text-muted-foreground">
              {(() => {
                const files = new Set(planilhas.map((d) => (d.conteudo.match(/Origem: planilha ([^·\n]+)/)?.[1] || d.titulo).trim()));
                return `${files.size} arquivo${files.size === 1 ? "" : "s"}`;
              })()}
            </span>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando...</div>
          ) : !planilhas.length ? (
            <Card><CardContent className="flex flex-col items-center justify-center gap-2 p-10 text-center">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhuma planilha importada ainda.</p>
            </CardContent></Card>
          ) : (
            <PlanilhasList planilhas={planilhas} onRemove={remover} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-base">{viewing?.titulo}</DialogTitle>
              {viewing && (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    background: `hsl(${tipoHue(viewing.tipo)} 80% 95%)`,
                    color: `hsl(${tipoHue(viewing.tipo)} 65% 32%)`,
                  }}
                >
                  <span className="h-1 w-1 rounded-full" style={{ background: `hsl(${tipoHue(viewing.tipo)} 70% 50%)` }} />
                  {tipoLabel(viewing.tipo)}
                </span>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Atualizado {tempoRelativo(viewing?.updated_at || viewing?.created_at) || "—"}
            </div>
          </DialogHeader>
          <div className="overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {viewing?.conteudo}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => { if (viewing) { setEditId(viewing.id); setEditVal(viewing); setViewing(null); } }}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
            </Button>
            <Button size="sm" onClick={() => setViewing(null)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Helpers de importação Excel (mantidos)
// ============================================================

function parsePeriodHeader(v: any): { ano: number; mes: number } | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return { ano: v.getFullYear(), mes: v.getMonth() + 1 };
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return { ano: d.y, mes: d.m };
  }
  const s = String(v).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) {
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  }
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m1) return { ano: +m1[2], mes: +m1[1] };
  const meses = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const m2 = s.toLowerCase().match(/^([a-zà-ú]{3,})[\/\s\-]+(\d{2,4})$/);
  if (m2) {
    const idx = meses.findIndex((mm) => m2[1].startsWith(mm));
    if (idx >= 0) return { ano: m2[2].length === 2 ? 2000 + +m2[2] : +m2[2], mes: idx + 1 };
  }
  return null;
}

function parseValor(v: any): number | null {
  if (v == null || v === "" || v === "-") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[R$\s]/g, "");
  const neg = /^\(.+\)$/.test(s);
  if (neg) s = s.slice(1, -1);
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

type ParsedHistorico = { metrica: string; ano: number; mes: number; valor: number; origem: string }[];

function parseHistoricoSheet(rows: any[][], origem: string): ParsedHistorico {
  if (!rows.length) return [];
  let headerIdx = 0, bestCount = 0, bestMap: Record<number, { ano: number; mes: number }> = {};
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const map: Record<number, { ano: number; mes: number }> = {};
    let count = 0;
    for (let c = 0; c < rows[i].length; c++) {
      const p = parsePeriodHeader(rows[i][c]);
      if (p) { map[c] = p; count++; }
    }
    if (count > bestCount) { bestCount = count; bestMap = map; headerIdx = i; }
  }
  if (bestCount < 2) return [];
  const out: ParsedHistorico = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row?.length) continue;
    const metrica = String(row[0] ?? "").trim();
    if (!metrica) continue;
    if (/^-+$/.test(metrica)) continue;
    for (const cStr of Object.keys(bestMap)) {
      const c = +cStr;
      const valor = parseValor(row[c]);
      if (valor == null) continue;
      const { ano, mes } = bestMap[c];
      out.push({ metrica, ano, mes, valor, origem });
    }
  }
  return out;
}

function sheetToMarkdown(rows: any[][], maxRows = 500): string {
  if (!rows.length) return "";
  const limited = rows.slice(0, maxRows);
  const width = Math.max(...limited.map((r) => r.length));
  const norm = limited.map((r, ri) => {
    const arr = [...r];
    while (arr.length < width) arr.push("");
    return arr.map((c, ci) => {
      if (c == null) return "";
      if (ri < 5 && ci > 0) {
        const p = parsePeriodHeader(c);
        if (p) return `${p.ano}-${String(p.mes).padStart(2, "0")}`;
      }
      return String(c).replace(/\|/g, "\\|").replace(/\n/g, " ");
    });
  });
  const header = norm[0];
  const sep = header.map(() => "---");
  const body = norm.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  if (rows.length > maxRows) lines.push(`\n_(${rows.length - maxRows} linhas adicionais omitidas)_`);
  return lines.join("\n");
}

function ExcelUploader({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tipo, setTipo] = useState("histórico");
  const [prefixo, setPrefixo] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0, fail = 0, totalDataPoints = 0;
    try {
      for (const file of Array.from(files)) {
        try {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array", cellDates: true });
          const baseName = file.name.replace(/\.[^.]+$/, "");
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false }) as any[][];
            if (!rows.length) continue;
            const origem = `${file.name} · ${sheetName}`;
            const md = sheetToMarkdown(rows);
            const titulo = `${prefixo ? prefixo + " · " : ""}${baseName}${wb.SheetNames.length > 1 ? ` · ${sheetName}` : ""}`;
            const conteudo = `Origem: planilha ${file.name} · aba "${sheetName}"\nTamanho: ${file.size} bytes\nLinhas: ${rows.length} · Colunas: ${rows[0]?.length ?? 0}\n\n${md}`;
            const { error } = await supabase.from("base_conhecimento" as any).insert({ titulo, conteudo, tipo });
            if (error) { fail++; toast.error(`base_conhecimento: ${error.message}`); console.error(error); continue; }
            ok++;

            let dataPoints: ParsedHistorico = [];
            try { dataPoints = parseHistoricoSheet(rows, origem); }
            catch (e: any) { toast.error(`parser histórico (${sheetName}): ${e.message}`); console.error(e); }

            if (dataPoints.length) {
              const { error: delErr } = await supabase.from("historico_financeiro" as any).delete().eq("origem", origem);
              if (delErr) { toast.error(`limpar histórico: ${delErr.message}`); console.error(delErr); }
              for (let i = 0; i < dataPoints.length; i += 500) {
                const chunk = dataPoints.slice(i, i + 500);
                const { error: insErr } = await supabase.from("historico_financeiro" as any).insert(chunk);
                if (insErr) { toast.error(`historico_financeiro: ${insErr.message}`); console.error("hist insert", insErr, chunk[0]); }
                else totalDataPoints += chunk.length;
              }
            }
          }
        } catch (e: any) { fail++; toast.error(`Erro em ${file.name}: ${e.message}`); console.error(e); }
      }
      if (ok) toast.success(`${ok} aba(s) importada(s) · ${totalDataPoints} pontos no histórico`);
      if (fail) toast.error(`${fail} falha(s)`);
      onImported();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Prefixo do título (padrão)
          </label>
          <Input
            placeholder="histórico"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Prefixo da pasta (opcional, ex: 2023)
          </label>
          <Input
            placeholder=""
            value={prefixo}
            onChange={(e) => setPrefixo(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed p-4 transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-background p-2 shadow-sm">
            <Upload className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium">
              {busy ? "Importando…" : "Arraste arquivos aqui ou clique para selecionar"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Até 25 MB por arquivo · múltiplas planilhas suportadas
            </div>
          </div>
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Importando…" : "Selecionar planilhas"}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 *  Lista agrupada de planilhas importadas
 * ============================================================ */
function fmtBytes(n: number) {
  if (!n || isNaN(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDateTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${d.getDate().toString().padStart(2, "0")} ${meses[d.getMonth()]} ${d.getFullYear()} · ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function PlanilhasList({ planilhas, onRemove }: { planilhas: Doc[]; onRemove: (id: string) => void }) {
  // agrupa por nome de arquivo
  const groups = new Map<string, { fileName: string; docs: Doc[]; size: number; createdAt: string; tipo: string }>();
  for (const d of planilhas) {
    const m = d.conteudo.match(/Origem: planilha ([^·\n]+)/);
    const fileName = (m?.[1] || d.titulo).trim();
    const sizeMatch = d.conteudo.match(/Tamanho:\s*(\d+)/);
    const size = sizeMatch ? +sizeMatch[1] : 0;
    const prev = groups.get(fileName);
    if (prev) {
      prev.docs.push(d);
      if (d.created_at && d.created_at > prev.createdAt) prev.createdAt = d.created_at;
    } else {
      groups.set(fileName, { fileName, docs: [d], size, createdAt: d.created_at || "", tipo: d.tipo });
    }
  }
  const list = Array.from(groups.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="grid gap-2">
      {list.map((g) => (
        <Card key={g.fileName} className="border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-emerald-500/10 p-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{g.fileName}</span>
                  <Badge variant="outline" className="text-[10px]">{g.tipo}</Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {g.docs.length} aba{g.docs.length === 1 ? "" : "s"}
                  {g.size ? ` · ${fmtBytes(g.size)}` : ""}
                  {g.createdAt ? ` · Enviado em ${fmtDateTime(g.createdAt)}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => setOpen(open === g.fileName ? null : g.fileName)}
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open === g.fileName ? "rotate-90" : ""}`} />
                Ver conteúdo
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => g.docs.forEach((d) => onRemove(d.id))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {open === g.fileName && (
              <div className="mt-3 space-y-2 border-t pt-3">
                {g.docs.map((d) => (
                  <div key={d.id} className="rounded-md border bg-muted/30 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{d.titulo}</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemove(d.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px] text-muted-foreground">
                      {d.conteudo}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
