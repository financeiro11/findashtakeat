import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, X, ChevronRight, Check, ExternalLink, Search, Send, RefreshCw, Loader2, Paperclip, Copy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ComprovanteLink } from "@/components/ComprovanteLink";
import { podeAbrirComprovante } from "@/lib/comprovante";
import { brl, brlAbbr, fmtDateBR, fmtDateTimeBR, fmtTrilha, compLabel, MESES_PT_LONG } from "./utils";
import AjusteSolicitadoModal from "./AjusteSolicitadoModal";
import SolicitarJustificativasModal from "./SolicitarJustificativasModal";
import { enviarProntos, enviarUnitario } from "@/lib/omieAnexos";

type Severidade = "Crítico" | "Alto" | "Médio" | "Baixo";
type Status = "Pendente" | "Em análise" | "Aprovado" | "Reprovado" | "Ajuste solicitado";
type Categoria = "COM NF" | "SEM NF" | "FORA DE ESCOPO" | "A CONFERIR";
type TrilhaEvento = {
  em?: string; por?: string; de?: string; para?: string; comentario?: string;
  ator?: string; tipo?: string; texto?: string; quando?: string;
};
type Row = {
  id: number;
  id_unico: string;
  competencia: string;
  titulo: string;
  area: string;
  severidade: Severidade;
  valor: number;
  responsavel: string;
  data_lancamento: string;
  descricao: string;
  regra: string;
  origem: string;
  id_transacao: string | null;
  status: Status;
  trilha: TrilhaEvento[] | null;
  categoria: Categoria | string | null;
  link_comprovante: string | null;
  /** descrição da categoria do Omie casada (via lançamento de origem no cartão). */
  omie_categoria?: string | null;
  /** confiança do casamento com o Omie ("alta" | "media" | "baixa"). */
  omie_match_confianca?: string | null;
  /** id do título do Omie que casou (nCodTitulo). Preenchido = categoria veio de um
   *  movimento REAL do Omie; vazio = ainda não casado / não confirmado. */
  omie_cod_titulo?: string | null;
  /** carimbo de quando o comprovante foi enviado ao Omie; !null = já enviado (esconde o botão). */
  omie_anexo_enviado_em?: string | null;
  /** true = aprovado automaticamente (bate com a nota); vem da base do cartão, não da
   *  tabela `auditoria`, portanto é somente leitura (sem mudança de status). */
  _ro?: boolean;
};
type Filtro = "todas" | Status;
type FiltroCat = "todas" | Categoria;

const ALL_CATEGORIAS: Categoria[] = ["COM NF", "SEM NF", "FORA DE ESCOPO", "A CONFERIR"];

// Deriva a categoria de um achado quando o n8n não a preencheu, a partir dos sinais
// reais da auditoria: a `regra` do achado + o status de NF/escopo da origem no cartão.
// Prioridade (linhas são mutuamente exclusivas): fora de escopo > a conferir > com nf > sem nf.
function deriveCategoria(regra?: string | null, statusNf?: string | null, statusEscopo?: string | null): Categoria | null {
  const rg = (regra || "").toUpperCase();
  const nf = (statusNf || "").toUpperCase();
  const esc = (statusEscopo || "").toUpperCase();
  if (esc.includes("FORA") || rg.includes("FORA")) return "FORA DE ESCOPO";
  if (nf.includes("CONFERIR") || rg.includes("CONFERIR")) return "A CONFERIR";
  if (nf === "OK") return "COM NF";
  if (nf.includes("SEM") || rg.includes("SEM NF")) return "SEM NF";
  return null;
}
function catStyle(c: string | null | undefined) {
  switch (c) {
    case "COM NF": return "bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]";
    case "SEM NF": return "bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)]";
    case "FORA DE ESCOPO": return "bg-[hsl(22_92%_95%)] text-[hsl(22_85%_38%)] border-[hsl(22_92%_85%)]";
    case "A CONFERIR": return "bg-[hsl(48_96%_92%)] text-[hsl(38_80%_32%)] border-[hsl(48_92%_80%)]";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

type CartaoLanc = {
  id_unico: string; referencia: string; competencia: string; origem: string;
  gestor: string | null; time: string | null; card_final: string | null;
  data: string | null; estabelecimento: string | null; descricao_original: string | null;
  categoria: string | null; parcela: string | null; valor: number;
  status_nf: string; arquivo_comprovante: string | null; link_comprovante: string | null;
  status_escopo: string | null; observacao: string | null;
  omie_categoria_codigo: string | null; omie_categoria_descricao: string | null;
  omie_match_confianca: string | null;
};

const ALL_STATUS: Status[] = ["Pendente","Em análise","Aprovado","Reprovado","Ajuste solicitado"];
const NEXT_STATUS: Record<Status, Status[]> = {
  "Pendente": ["Em análise","Aprovado","Reprovado","Ajuste solicitado"],
  "Em análise": ["Aprovado","Reprovado","Ajuste solicitado"],
  "Aprovado": [],
  "Reprovado": [],
  "Ajuste solicitado": ["Em análise","Aprovado","Reprovado"],
};

function sevBadge(s: Severidade) {
  if (s === "Crítico") return "bg-red-700 text-white border-red-700";
  if (s === "Alto") return "bg-red-600 text-white border-red-600";
  if (s === "Médio") return "bg-amber-500 text-white border-amber-500";
  if (s === "Baixo") return "bg-blue-500 text-white border-blue-500";
  return "bg-muted text-muted-foreground border-border";
}
function statusStyle(s: Status) {
  switch (s) {
    case "Pendente": return { dot: "bg-[hsl(38_92%_50%)]", pill: "bg-[hsl(38_92%_95%)] text-[hsl(30_80%_35%)] border-[hsl(38_92%_85%)]" };
    case "Em análise": return { dot: "bg-[hsl(212_80%_50%)]", pill: "bg-[hsl(212_80%_96%)] text-[hsl(212_80%_35%)] border-[hsl(212_80%_88%)]" };
    case "Aprovado": return { dot: "bg-[hsl(152_60%_40%)]", pill: "bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]" };
    case "Reprovado": return { dot: "bg-[hsl(0_72%_50%)]", pill: "bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)]" };
    case "Ajuste solicitado": return { dot: "bg-[hsl(22_92%_52%)]", pill: "bg-[hsl(22_92%_95%)] text-[hsl(22_85%_38%)] border-[hsl(22_92%_85%)]" };
  }
}

export default function Achados() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [competencia, setCompetencia] = useState<string>("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [fSev, setFSev] = useState<string>("todas");
  const [fArea, setFArea] = useState<string>("todas");
  const [fRegra, setFRegra] = useState<string>("todas");
  const [fCat, setFCat] = useState<FiltroCat>("todas");
  const [fResp, setFResp] = useState<string>("todas");
  const [fAnexo, setFAnexo] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [origemCart, setOrigemCart] = useState<CartaoLanc | null>(null);
  const [confirm, setConfirm] = useState<{ novo: Status } | null>(null);
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);
  const [ajusteOpen, setAjusteOpen] = useState(false);
  const [sheetHidden, setSheetHidden] = useState(false);
  const [consolidadoOpen, setConsolidadoOpen] = useState(false);
  const [cruzando, setCruzando] = useState(false);
  const [enviandoUm, setEnviandoUm] = useState(false);
  const [enviandoMassa, setEnviandoMassa] = useState(false);

  // Garante que o modal de "Ajuste solicitado" NUNCA venha aberto ao abrir/trocar de lançamento
  useEffect(() => { setAjusteOpen(false); }, [selected?.id]);

  const load = async () => {
    setLoading(true);
    const [audRes, cartRes] = await Promise.all([
      supabase
        .from("auditoria")
        .select("id,id_unico,competencia,titulo,area,severidade,valor,responsavel,data_lancamento,descricao,regra,origem,id_transacao,status,trilha,categoria,link_comprovante,omie_categoria_descricao,omie_match_confianca,omie_cod_titulo,omie_anexo_enviado_em")
        .order("data_lancamento", { ascending: false }),
      // Base do cartão: usada para (a) trazer as "aprovadas direto" (status_nf = "OK") e
      // (b) derivar a categoria dos achados que o n8n não classificou (via status_nf/escopo).
      supabase
        .from("auditoria_cartao_lancamentos")
        .select("id_unico,competencia,referencia,origem,gestor,time,data,estabelecimento,descricao_original,valor,status_nf,status_escopo,arquivo_comprovante,link_comprovante,omie_categoria_descricao,omie_match_confianca,omie_cod_titulo,omie_anexo_enviado_em")
        .order("data", { ascending: false })
        .limit(5000),
    ]);

    if (audRes.error) { toast.error("Erro ao carregar auditoria"); setRows([]); setLoading(false); return; }
    const cartRows = (cartRes.data ?? []) as any[];
    const cardByUnico = new Map<string, any>(cartRows.map((c) => [c.id_unico, c]));

    // Achados reais — deriva a categoria quando ela vem vazia do n8n, e anexa a
    // categoria do Omie casada (via o lançamento de origem no cartão).
    const audRows: Row[] = (audRes.data ?? []).map((r: any): Row => {
      const orig = r.id_transacao ? cardByUnico.get(r.id_transacao) : null;
      // Prioriza a categoria casada na base do cartão (junho); se o achado não tem
      // vínculo (id_transacao nulo, ex.: julho), usa a que foi casada direto no achado.
      const omie_categoria = orig?.omie_categoria_descricao ?? r.omie_categoria_descricao ?? null;
      const omie_match_confianca = orig?.omie_match_confianca ?? r.omie_match_confianca ?? null;
      const omie_cod_titulo = orig?.omie_cod_titulo ?? r.omie_cod_titulo ?? null;
      const categoria = r.categoria || deriveCategoria(r.regra, orig?.status_nf, orig?.status_escopo);
      return { ...r, categoria, omie_categoria, omie_match_confianca, omie_cod_titulo } as Row;
    });

    // Evita duplicar caso um achado já referencie o mesmo lançamento do cartão.
    const jaNaAuditoria = new Set(audRows.map(r => r.id_transacao).filter(Boolean) as string[]);
    const aprovadasDireto: Row[] = cartRows
      .filter((c: any) => c.status_nf === "OK" && c.id_unico && !jaNaAuditoria.has(c.id_unico))
      .map((c: any, i: number): Row => ({
        id: -(i + 1), // id negativo/sintético — nunca é gravado
        id_unico: c.id_unico,
        competencia: c.competencia || c.referencia || "",
        titulo: c.estabelecimento || c.descricao_original || "Lançamento com nota",
        area: c.time || "—",
        severidade: "Baixo",
        valor: Number(c.valor || 0),
        responsavel: c.gestor || "",
        data_lancamento: c.data || "",
        descricao: c.descricao_original || "",
        regra: "Bate com a nota",
        origem: c.origem || "Cartão",
        id_transacao: c.id_unico,
        status: "Aprovado",
        trilha: null,
        categoria: "COM NF",
        // `arquivo_comprovante` é só o NOME do arquivo — não abre nada. A URL de verdade
        // (Drive) mora em `link_comprovante`, que a página não estava nem buscando.
        link_comprovante: c.link_comprovante || c.arquivo_comprovante,
        omie_categoria: c.omie_categoria_descricao ?? null,
        omie_match_confianca: c.omie_match_confianca ?? null,
        // Sem isto, as linhas "COM NF" (vindas do cartão) nunca exibiam o ID do Omie,
        // mesmo com o nCodTitulo gravado na base do cartão.
        omie_cod_titulo: c.omie_cod_titulo ?? null,
        omie_anexo_enviado_em: c.omie_anexo_enviado_em ?? null,
        _ro: true,
      }));

    setRows([...audRows, ...aprovadasDireto]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const competencias = useMemo(() => {
    const set = new Set(rows.map(r => r.competencia));
    return Array.from(set).sort().reverse();
  }, [rows]);

  useEffect(() => {
    if (!competencia && competencias.length) setCompetencia(competencias[0]);
  }, [competencias, competencia]);

  const periodRows = useMemo(
    () => competencia ? rows.filter(r => r.competencia === competencia) : [],
    [rows, competencia]
  );

  const areas = useMemo(() => Array.from(new Set(periodRows.map(r => r.area).filter(Boolean))).sort(), [periodRows]);
  const regras = useMemo(() => Array.from(new Set(periodRows.map(r => r.regra).filter(Boolean))).sort(), [periodRows]);
  const responsaveisPendentes = useMemo(
    () => Array.from(new Set(rows.filter(r => r.status === "Pendente" && r.responsavel).map(r => r.responsavel))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rows]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { todas: periodRows.length };
    ALL_STATUS.forEach(s => c[s] = 0);
    periodRows.forEach(r => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [periodRows]);

  const catCounts = useMemo(() => {
    // Categoria counts respect current status/sev/area/regra filters (but not fCat itself)
    const base = periodRows.filter(r => {
      if (filtro !== "todas" && r.status !== filtro) return false;
      if (fSev !== "todas" && r.severidade !== fSev) return false;
      if (fArea !== "todas" && r.area !== fArea) return false;
      if (fRegra !== "todas" && r.regra !== fRegra) return false;
      return true;
    });
    const c: Record<string, number> = { todas: base.length };
    ALL_CATEGORIAS.forEach(k => c[k] = 0);
    base.forEach(r => { if (r.categoria) c[r.categoria] = (c[r.categoria] ?? 0) + 1; });
    return c;
  }, [periodRows, filtro, fSev, fArea, fRegra]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return periodRows.filter(r => {
      if (filtro !== "todas" && r.status !== filtro) return false;
      if (fSev !== "todas" && r.severidade !== fSev) return false;
      if (fArea !== "todas" && r.area !== fArea) return false;
      if (fRegra !== "todas" && r.regra !== fRegra) return false;
      if (fCat !== "todas" && r.categoria !== fCat) return false;
      if (fResp !== "todas" && r.responsavel !== fResp) return false;
      if (fAnexo === "Anexado" && !r.omie_anexo_enviado_em) return false;
      if (fAnexo === "Não anexado" && r.omie_anexo_enviado_em) return false;
      if (q && !(r.titulo || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [periodRows, filtro, fSev, fArea, fRegra, fCat, fResp, fAnexo, busca]);

  // Envio em massa via webhook do n8n: manda TODOS os pendentes (base do cartão + achados)
  // do responsável selecionado — junho + julho, independente da fatura na tela (intencional).
  const enviarMassaOmie = async () => {
    const responsavel = fResp === "todas" ? undefined : fResp;
    setEnviandoMassa(true);
    try {
      const resumo = await enviarProntos(responsavel);
      if (resumo.total === 0) {
        toast.message(
          responsavel
            ? `Nenhum lançamento pendente de ${responsavel} (com comprovante + título do Omie).`
            : "Nenhum lançamento pendente para enviar (com comprovante + título do Omie).",
        );
      } else {
        toast.success(`${resumo.enviados} enviados · ${resumo.jaEnviados} já enviados · ${resumo.erros} erros`);
      }
      await load();
    } catch (e: any) {
      toast.error("Falha ao enviar ao Omie: " + (e?.message ?? String(e)), { duration: 10000 });
    } finally {
      setEnviandoMassa(false);
    }
  };

  // Envio individual pelo drawer: manda só o anexo deste lançamento para o título do Omie.
  const enviarUmOmie = async (row: Row) => {
    if (!row.link_comprovante || !row.omie_cod_titulo) {
      toast.error("Lançamento sem comprovante ou sem título do Omie.");
      return;
    }
    setEnviandoUm(true);
    try {
      const resumo = await enviarUnitario({
        id_unico: row.id_unico,
        omie_cod_titulo: row.omie_cod_titulo,
        link_comprovante: row.link_comprovante,
      });
      toast.success(`${resumo.enviados} enviados · ${resumo.jaEnviados} já enviados · ${resumo.erros} erros`);
      // Reflete localmente para o botão sumir sem esperar o reload (omie_anexo_enviado_em passa a ter valor).
      if (resumo.enviados + resumo.jaEnviados > 0) {
        const agora = new Date().toISOString();
        setSelected(s => s && s.id === row.id ? { ...s, omie_anexo_enviado_em: agora } : s);
      }
      await load();
    } catch (e: any) {
      toast.error("Falha ao enviar ao Omie: " + (e?.message ?? String(e)), { duration: 10000 });
    } finally {
      setEnviandoUm(false);
    }
  };

  const kpis = useMemo(() => {
    const pend = periodRows.filter(r => r.status === "Pendente");
    const emAn = periodRows.filter(r => r.status === "Em análise");
    const sob = [...pend, ...emAn];
    const valorSob = sob.reduce((s, r) => s + Number(r.valor || 0), 0);
    const aprov = periodRows.filter(r => r.status === "Aprovado");
    const repr = periodRows.filter(r => r.status === "Reprovado").length;
    const catCount = (arr: Row[], c: Categoria) => arr.filter(r => r.categoria === c).length;
    const catSum = (arr: Row[], c: Categoria) => arr.filter(r => r.categoria === c).reduce((s, r) => s + Number(r.valor || 0), 0);
    return {
      pend: pend.length, emAn: emAn.length, valorSob, qtdSob: sob.length,
      resolv: aprov.length + repr, aprov: aprov.length, repr,
      pendSemNf: catCount(pend, "SEM NF"),
      pendAConf: catCount(pend, "A CONFERIR"),
      pendFora: catCount(pend, "FORA DE ESCOPO"),
      sobComNf: catSum(sob, "COM NF"),
      sobSemNf: catSum(sob, "SEM NF"),
      sobFora: catSum(sob, "FORA DE ESCOPO"),
      sobAConf: catSum(sob, "A CONFERIR"),
      aprovComNf: catCount(aprov, "COM NF"),
    };
  }, [periodRows]);

  useEffect(() => {
    if (!selected) { setOrigemCart(null); return; }
    if (selected.id_transacao && selected.id_transacao.startsWith("CART-")) {
      supabase.from("auditoria_cartao_lancamentos")
        .select("*")
        .eq("id_unico", selected.id_transacao)
        .maybeSingle()
        .then(({ data }) => setOrigemCart(data as any));
    } else {
      setOrigemCart(null);
    }
  }, [selected]);

  // Cruza os lançamentos do cartão com os movimentos do Omie (categoria contábil).
  // O sync do Omie leva ~1–2 min, então disparamos e acompanhamos o omie_matched_em
  // (evita o timeout de rede do functions.invoke).
  const cruzarOmie = async () => {
    setCruzando(true);
    toast.message("Cruzando com o Omie… pode levar ~1–2 min. As categorias aparecem ao concluir.");
    // maior omie_matched_em entre as duas tabelas (cartão para junho; achados p/ julho).
    const maxMatched = async (): Promise<string | null> => {
      const [a, b] = await Promise.all([
        supabase.from("auditoria_cartao_lancamentos").select("omie_matched_em").order("omie_matched_em", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
        supabase.from("auditoria").select("omie_matched_em").order("omie_matched_em", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      ]);
      const ts = [(a.data as any)?.omie_matched_em, (b.data as any)?.omie_matched_em].filter(Boolean) as string[];
      return ts.sort().pop() ?? null;
    };
    const prevMatched = await maxMatched(); // baseline

    // Dispara o cruzamento. Captura erro/resumo (não engole mais em silêncio).
    // Passa a competência selecionada p/ casar os achados daquela fatura direto com o Omie.
    let invokeErr: string | null = null;
    let resumo: any = null;
    const invokePromise = supabase.functions
      .invoke("omie-match-cartao", { body: { action: "match", competencia } })
      .then(({ data, error }) => {
        if (error) invokeErr = error.message;
        else if ((data as any)?.error) invokeErr = (data as any).error;
        else resumo = data;
      })
      .catch((e) => { invokeErr = e?.message || String(e); });

    // Acompanha por omie_matched_em (o sync leva ~1–2 min e o invoke pode estourar timeout de rede).
    const deadline = Date.now() + 180000;
    let done = false;
    while (Date.now() < deadline && !done) {
      await new Promise((r) => setTimeout(r, 4000));
      if (invokeErr) break;                 // erro do backend → para na hora
      if (resumo) { done = true; break; }   // invoke retornou o resumo
      const latest = await maxMatched();
      if (latest && latest !== prevMatched) done = true;
    }
    await invokePromise.catch(() => {});

    if (invokeErr) {
      toast.error(
        String(invokeErr).includes("Function not found") || String(invokeErr).includes("404")
          ? "A função omie-match-cartao ainda não foi publicada no Supabase (aguarde o deploy do Lovable)."
          : "Falha ao cruzar com o Omie: " + invokeErr,
      );
    } else if (done) {
      if (resumo && typeof resumo.casados === "number") {
        const extra = resumo.casados_achados ? ` · ${resumo.casados_achados} achado(s) casado(s) direto` : "";
        toast.success(`Cruzamento concluído · ${resumo.casados} casados (${resumo.alta}/${resumo.media}/${resumo.baixa}) · ${resumo.sem_match} sem match${extra}`);
      } else {
        toast.success("Cruzamento com o Omie concluído.");
      }
      await load();
    } else {
      toast.message("Ainda cruzando em segundo plano. Recarregue em instantes.");
      await load();
    }
    setCruzando(false);
  };

  const exportCsv = () => {
    const header = ["Título","Área","Severidade","Regra","Origem","Valor","Responsável","Data","Status"];
    const lines = filtered.map(r => [
      r.titulo, r.area, r.severidade, r.regra, r.origem,
      brl(Number(r.valor || 0)), r.responsavel ?? "",
      fmtDateBR(r.data_lancamento), r.status,
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"));
    const csv = "\uFEFF" + [header.join(";"), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `auditoria_${competencia}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const mudarStatus = async (novo: Status, coment: string) => {
    if (!selected) return;
    if (selected._ro) { toast.message("Aprovado automaticamente (bate com a nota) — somente leitura."); return; }
    const evento: TrilhaEvento = {
      em: new Date().toISOString(),
      por: user?.email ?? "desconhecido",
      de: selected.status,
      para: novo,
      comentario: coment || undefined,
    };
    const novaTrilha = [...(Array.isArray(selected.trilha) ? selected.trilha : []), evento];
    setSaving(true);
    const { error } = await supabase
      .from("auditoria")
      .update({ status: novo, trilha: novaTrilha as any })
      .eq("id", selected.id);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(`Status alterado para ${novo}`);
    setConfirm(null); setComentario("");
    // reflect locally
    setSelected({ ...selected, status: novo, trilha: novaTrilha });
    setRows(rs => rs.map(r => r.id === selected.id ? { ...r, status: novo, trilha: novaTrilha } : r));
  };

  const mudarStatusInline = async (row: Row, novo: Status) => {
    if (row._ro) { toast.message("Aprovado automaticamente (bate com a nota) — somente leitura."); return; }
    const evento: TrilhaEvento = {
      em: new Date().toISOString(),
      por: user?.email ?? "desconhecido",
      de: row.status, para: novo,
    };
    const novaTrilha = [...(Array.isArray(row.trilha) ? row.trilha : []), evento];
    const { error } = await supabase.from("auditoria")
      .update({ status: novo, trilha: novaTrilha as any })
      .eq("id", row.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(`→ ${novo}`);
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: novo, trilha: novaTrilha } : r));
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 pt-3 pb-6 space-y-5">
      {/* Header row */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Hub Financeiro · Governança</div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">Auditoria</h1>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={() => setConsolidadoOpen(true)}
                      disabled={fResp === "todas"}
                      className="h-9 text-white disabled:opacity-50"
                      style={{ backgroundColor: "#0F6E56" }}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {fResp === "todas" ? "Solicitar Justificativas" : `Solicitar Justificativas (${fResp})`}
                    </Button>
                  </span>
                </TooltipTrigger>
                {fResp === "todas" && (
                  <TooltipContent>Selecione um responsável para solicitar justificativas em lote</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            <Button
              onClick={enviarMassaOmie}
              disabled={enviandoMassa}
              className="h-9 text-white hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: "#1D63C7" }}
              title="Envia ao Omie os comprovantes pendentes (base do cartão + achados) do responsável selecionado — todas as faturas"
            >
              {enviandoMassa
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando…</>
                : <><Paperclip className="h-4 w-4 mr-2" /> {fResp === "todas" ? "Enviar comprovantes ao Omie" : `Enviar comprovantes ao Omie (${fResp})`}</>}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Achados financeiros com workflow de análise e aprovação.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar lançamento..."
              className="h-9 w-64 rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-foreground/10"
            />
          </div>
          <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Fatura</span>
            <select
              value={competencia}
              onChange={e => setCompetencia(e.target.value)}
              className="text-sm font-medium bg-transparent outline-none capitalize"
            >
              {competencias.map(c => <option key={c} value={c} className="capitalize">{compLabel(c)}</option>)}
              {competencias.length === 0 && <option value="">—</option>}
            </select>
          </label>
          <Button variant="outline" onClick={cruzarOmie} disabled={cruzando} className="h-9" title="Casa cada lançamento do cartão com o movimento do Omie (categoria contábil)">
            {cruzando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />} Cruzar com Omie
          </Button>
          <Button onClick={exportCsv} className="bg-foreground text-background hover:bg-foreground/90 h-9">
            <Download className="h-4 w-4 mr-2" /> Exportar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />) : (
          <>
            <KpiCard
              label="Pendentes"
              value={String(kpis.pend)}
              legend="aguardando ação"
              breakdown={
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <MiniChip cls={catStyle("SEM NF")} text={`SEM NF ${kpis.pendSemNf}`} />
                  <MiniChip cls={catStyle("A CONFERIR")} text={`A CONFERIR ${kpis.pendAConf}`} />
                  <MiniChip cls={catStyle("FORA DE ESCOPO")} text={`FORA ${kpis.pendFora}`} />
                </div>
              }
            />
            <KpiCard label="Em análise" value={String(kpis.emAn)} legend="em verificação" valueClass="text-[hsl(212_80%_45%)]" />
            <KpiCard
              label="Valor sob auditoria"
              value={brlAbbr(kpis.valorSob)}
              legend={`em ${kpis.qtdSob} lançamento${kpis.qtdSob === 1 ? "" : "s"}`}
              breakdown={
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {kpis.sobComNf > 0 && <MiniChip cls={catStyle("COM NF")} text={`COM NF ${brlAbbr(kpis.sobComNf)}`} />}
                  {kpis.sobSemNf > 0 && <MiniChip cls={catStyle("SEM NF")} text={`SEM NF ${brlAbbr(kpis.sobSemNf)}`} />}
                  {kpis.sobFora > 0 && <MiniChip cls={catStyle("FORA DE ESCOPO")} text={`FORA ${brlAbbr(kpis.sobFora)}`} />}
                  {kpis.sobAConf > 0 && <MiniChip cls={catStyle("A CONFERIR")} text={`A CONF. ${brlAbbr(kpis.sobAConf)}`} />}
                </div>
              }
            />
            <KpiCard
              label="Resolvidas"
              value={String(kpis.resolv)}
              legend={`${kpis.aprov} aprovadas · ${kpis.repr} reprovadas`}
              valueClass="text-[hsl(152_60%_36%)]"
              breakdown={
                kpis.aprovComNf > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <MiniChip cls={catStyle("COM NF")} text={`COM NF ${kpis.aprovComNf} aprovadas`} />
                  </div>
                ) : null
              }
            />
          </>
        )}
      </div>


      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { k: "todas" as Filtro, label: `Todas (${counts.todas})` },
          ...ALL_STATUS.map(s => ({ k: s as Filtro, label: `${s} (${counts[s] ?? 0})` })),
        ]).map(f => (
          <button
            key={f.k}
            onClick={() => setFiltro(f.k)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-medium border transition",
              filtro === f.k ? "bg-foreground text-background border-foreground" : "bg-card text-foreground border-border hover:bg-accent"
            )}
          >{f.label}</button>
        ))}
      </div>

      {/* Categoria chips */}
      <div className="flex flex-wrap gap-2">
        {([
          { k: "todas" as FiltroCat, label: `Todas (${catCounts.todas})`, cls: "" },
          ...ALL_CATEGORIAS.map(c => ({ k: c as FiltroCat, label: `${c} (${catCounts[c] ?? 0})`, cls: catStyle(c) })),
        ]).map(f => {
          const count = f.k === "todas" ? catCounts.todas : (catCounts[f.k] ?? 0);
          const disabled = f.k !== "todas" && count === 0;
          const active = fCat === f.k;
          return (
            <button
              key={f.k}
              onClick={() => !disabled && setFCat(f.k)}
              disabled={disabled}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-medium border transition",
                active
                  ? (f.k === "todas" ? "bg-foreground text-background border-foreground" : cn(f.cls, "ring-2 ring-offset-1 ring-foreground/40"))
                  : (f.k === "todas" ? "bg-card text-foreground border-border hover:bg-accent" : cn(f.cls, "opacity-90 hover:opacity-100")),
                disabled && "opacity-40 cursor-not-allowed hover:opacity-40"
              )}
            >{f.label}</button>
          );
        })}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect label="Severidade" value={fSev} onChange={setFSev} options={["Crítico","Alto","Médio","Baixo"]} />
        <FilterSelect label="Área" value={fArea} onChange={setFArea} options={areas} />
        <FilterSelect label="Regra" value={fRegra} onChange={setFRegra} options={regras} />
        <FilterSelect label="Responsável" value={fResp} onChange={setFResp} options={responsaveisPendentes} />
        <FilterSelect label="Anexo Omie" value={fAnexo} onChange={setFAnexo} options={["Anexado", "Não anexado"]} />
        {(fSev !== "todas" || fArea !== "todas" || fRegra !== "todas" || fResp !== "todas" || fAnexo !== "todas") && (
          <button onClick={() => { setFSev("todas"); setFArea("todas"); setFRegra("todas"); setFResp("todas"); setFAnexo("todas"); }} className="text-xs text-muted-foreground hover:text-foreground underline">
            limpar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[minmax(240px,1.8fr)_210px_100px_120px_130px_130px_140px_40px] gap-3 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
          <div>Lançamento</div>
          <div>Categoria Omie</div>
          <div>Origem</div>
          <div className="text-right">Valor</div>
          <div>Área</div>
          <div>Data</div>
          <div>Status</div>
          <div></div>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Nenhum lançamento em auditoria neste período</div>
        ) : filtered.map(r => {
          return (
            <div
              key={r.id}
              className="grid grid-cols-[minmax(240px,1.8fr)_210px_100px_120px_130px_130px_140px_40px] gap-3 px-4 py-3 items-center border-b border-border last:border-0 hover:bg-accent/40 transition"
            >
              <div className="text-left min-w-0 flex items-start gap-1.5">
                <button onClick={() => setSelected(r)} className="text-left min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{r.titulo}</div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground truncate">{r.responsavel || "—"}</span>
                    {r.categoria && (
                      <span className={cn("inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border", catStyle(r.categoria))}>{r.categoria}</span>
                    )}
                    <span className={cn("inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border", sevBadge(r.severidade))}>
                      {r.severidade}
                    </span>
                    {r.omie_anexo_enviado_em && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]"
                        title={`Anexado ao Omie em ${fmtDateTimeBR(r.omie_anexo_enviado_em)}`}
                      >
                        <Paperclip className="h-2.5 w-2.5" /> Anexado ao Omie
                      </span>
                    )}
                  </div>
                </button>
                {podeAbrirComprovante(r.link_comprovante) && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ComprovanteLink
                          valor={r.link_comprovante}
                          className="text-muted-foreground hover:text-primary transition-colors shrink-0 mt-0.5"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </ComprovanteLink>
                      </TooltipTrigger>
                      <TooltipContent>Ver comprovante</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="min-w-0" title={r.omie_categoria || ""}>
                <div className="text-xs text-muted-foreground truncate">{r.omie_categoria || "—"}</div>
                {r.omie_cod_titulo && (
                  <div className="font-mono text-[10px] text-foreground/45 truncate">Omie {r.omie_cod_titulo}</div>
                )}
              </div>
              <div className="text-xs text-foreground/70 truncate">{r.origem}</div>
              <div className="text-right num text-sm font-medium">{brl(Number(r.valor || 0))}</div>
              <div className="text-sm text-foreground/80 truncate">{r.area}</div>
              <div className="text-sm text-muted-foreground">{fmtDateBR(r.data_lancamento)}</div>
              <div>
                <StatusMenu status={r.status} onChange={(n) => mudarStatusInline(r, n)} />
              </div>
              <button onClick={() => setSelected(r)} className="flex justify-end">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          );
        })}
      </div>


      {/* Drawer */}
      <Sheet open={!!selected && !ajusteOpen && !sheetHidden} onOpenChange={(o) => { if (!o && !ajusteOpen && !sheetHidden) setSelected(null); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[620px] p-0 flex flex-col"
          onPointerDownOutside={(e) => { if (ajusteOpen) e.preventDefault(); }}
          onInteractOutside={(e) => { if (ajusteOpen) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (ajusteOpen) e.preventDefault(); }}
        >
          {selected && (
            <>
              <div className="flex items-start justify-between px-6 pt-6 pb-4">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{selected.area} · {selected.regra}</div>
                  <h2 className="text-xl font-bold mt-1">{selected.titulo}</h2>
                </div>
                <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
                <div className="flex flex-wrap gap-2">
                  <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", statusStyle(selected.status).pill)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusStyle(selected.status).dot)} />
                    {selected.status}
                  </span>
                  <span className={cn("inline-flex px-2.5 py-1 rounded-full text-xs font-medium border", sevBadge(selected.severidade))}>
                    Severidade {selected.severidade}
                  </span>
                  <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-muted border border-border">
                    Origem {selected.origem}
                  </span>
                  {selected.categoria && (
                    <span className={cn("inline-flex px-2.5 py-1 rounded-full text-xs font-medium border", catStyle(selected.categoria))}>
                      {selected.categoria}
                    </span>
                  )}
                </div>

                <div className="num text-3xl font-bold">{brl(Number(selected.valor || 0))}</div>

                {selected.descricao && <p className="text-sm text-foreground/80 leading-relaxed">{selected.descricao}</p>}

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <MetaItem label="Responsável" value={selected.responsavel} />
                  <MetaItem label="Área" value={selected.area} />
                  <MetaItem label="Data do gasto" value={fmtDateBR(selected.data_lancamento)} />
                  <MetaItem label="Competência" value={compLabel(selected.competencia)} />
                  <MetaItem label="Regra" value={selected.regra} full />
                  <MetaItem label="ID transação (cartão)" value={selected.id_transacao || "—"} />

                  {/* ID do lançamento no Omie (nCodTitulo) — número que a automação usa.
                      Dedicado e copiável; antes só aparecia em texto cinza na linha da categoria. */}
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">ID Omie (nCodTitulo)</div>
                    {selected.omie_cod_titulo ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(selected.omie_cod_titulo!);
                            toast.success("ID do Omie copiado");
                          } catch {
                            toast.error("Não foi possível copiar");
                          }
                        }}
                        className="mt-1 inline-flex items-center gap-1.5 font-mono text-sm text-foreground hover:text-primary transition"
                        title="Clique para copiar o ID do Omie"
                      >
                        {selected.omie_cod_titulo}
                        <Copy className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    ) : (
                      <div className="text-sm mt-1 text-muted-foreground" title="Ainda sem título casado no Omie — rode 'Cruzar com Omie'.">—</div>
                    )}
                  </div>

                  {/* Vínculo com o Omie: a categoria só é "de verdade" quando há um título
                      casado (omie_cod_titulo). Sem id, é apenas a categoria que casaria. */}
                  <div className="col-span-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Categoria Omie</div>
                    <div className="text-sm mt-1">
                      {selected.omie_categoria ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{selected.omie_categoria}</span>
                          {selected.omie_match_confianca && (
                            <span className={cn(
                              "inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
                              selected.omie_match_confianca === "alta" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : selected.omie_match_confianca === "media" ? "border-amber-200 bg-amber-50 text-amber-700"
                                  : "border-red-200 bg-red-50 text-red-700",
                            )}>
                              confiança {selected.omie_match_confianca}
                            </span>
                          )}
                          {/* O número do título vive no campo dedicado "ID Omie" acima; aqui só
                              sinalizamos se a categoria está ou não confirmada num título real. */}
                          {!selected.omie_cod_titulo && (
                            <span className="text-[11px] text-amber-600" title="A categoria mostrada é a que casaria por valor/data, mas ainda não foi confirmada num título do Omie. Rode 'Cruzar com Omie'.">
                              · sem título casado (não confirmado)
                            </span>
                          )}
                        </div>
                      ) : "—"}
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Comprovante</div>
                    <div className="text-sm mt-1">
                      {(() => {
                        // Comprovante do achado (caminho no bucket privado) e, se vazio, o do
                        // lançamento de origem no cartão (URL do Drive). `arquivo_comprovante`
                        // é só o nome do arquivo — serve para EXIBIR, nunca para abrir.
                        const comp = selected.link_comprovante || origemCart?.link_comprovante || null;
                        if (podeAbrirComprovante(comp)) {
                          return (
                            <ComprovanteLink
                              valor={comp}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-sm font-medium transition"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Abrir comprovante / NF
                            </ComprovanteLink>
                          );
                        }
                        // Sem link abrível: mostra o nome do arquivo, se houver, em vez de sumir.
                        const nome = origemCart?.arquivo_comprovante || selected.link_comprovante;
                        return nome
                          ? <span className="text-muted-foreground" title="Arquivo registrado, mas sem link para abrir.">{nome}</span>
                          : "—";
                      })()}
                    </div>
                    {/* Envio individual: manda SÓ o anexo deste lançamento para o título do Omie.
                        Só aparece com comprovante + título do Omie e enquanto não foi enviado. */}
                    {selected.link_comprovante && selected.omie_cod_titulo && !selected.omie_anexo_enviado_em && (
                      <Button
                        size="sm"
                        onClick={() => enviarUmOmie(selected)}
                        disabled={enviandoUm}
                        className="mt-2 h-8 text-[12px] text-white"
                        style={{ backgroundColor: "#1D63C7" }}
                      >
                        {enviandoUm
                          ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Enviando…</>
                          : <><Paperclip className="mr-1.5 h-3.5 w-3.5" /> Enviar ao Omie</>}
                      </Button>
                    )}
                  </div>

                  <div className="col-span-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Anexo Omie</div>
                    <div className="text-sm mt-1">
                      {selected.omie_anexo_enviado_em ? `Anexado em ${fmtDateTimeBR(selected.omie_anexo_enviado_em)}` : "—"}
                    </div>
                  </div>
                </div>

                {origemCart && (
                  <div className="rounded-xl border border-border p-4 bg-muted/30 space-y-3">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Lançamento de origem (Cartão)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <MetaItem label="Data" value={fmtDateBR(origemCart.data)} />
                      <MetaItem label="Estabelecimento" value={origemCart.estabelecimento || "—"} />
                      <MetaItem label="Descrição" value={origemCart.descricao_original || "—"} full />
                      <MetaItem
                        label="Categoria Omie"
                        full
                        value={origemCart.omie_categoria_descricao
                          ? `${origemCart.omie_categoria_descricao}${origemCart.omie_match_confianca ? ` (confiança: ${origemCart.omie_match_confianca})` : ""}`
                          : "— (rode \"Cruzar com Omie\")"}
                      />
                      <MetaItem label="Categoria (cartão)" value={origemCart.categoria || "—"} />
                      <MetaItem label="Parcela" value={origemCart.parcela || "—"} />
                      <MetaItem label="Cartão final" value={origemCart.card_final || "—"} />
                      <MetaItem label="Gestor" value={origemCart.gestor || "—"} />
                      <MetaItem label="Time" value={origemCart.time || "—"} />
                      <MetaItem label="Status NF" value={origemCart.status_nf || "—"} />
                      <MetaItem label="Status escopo" value={origemCart.status_escopo || "—"} />
                      {origemCart.observacao && <MetaItem label="Observação" value={origemCart.observacao} full />}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Trilha de auditoria</div>
                  <ol className="space-y-4">
                    {(selected.trilha ?? []).slice().sort((a, b) => (a.em ?? a.quando ?? "").localeCompare(b.em ?? b.quando ?? "")).map((ev, i) => {
                      const quando = ev.em ?? ev.quando ?? "";
                      const por = ev.por ?? ev.ator ?? "sistema";
                      const texto = ev.texto ?? [ev.de && ev.para ? `${ev.de} → ${ev.para}` : null, ev.comentario].filter(Boolean).join(" · ");
                      return (
                        <li key={i} className="flex gap-3">
                          <div className="flex flex-col items-center pt-1">
                            <span className="h-2 w-2 rounded-full bg-[hsl(0_78%_47%)]" />
                            <span className="w-px flex-1 bg-border mt-1" />
                          </div>
                          <div className="pb-2 min-w-0">
                            <div className="text-sm font-semibold">{por}</div>
                            <div className="text-sm text-foreground/70">{texto || "—"}</div>
                            {quando && <div className="text-[11px] text-muted-foreground mt-0.5">{fmtTrilha(quando)}</div>}
                          </div>
                        </li>
                      );
                    })}
                    {(!selected.trilha || selected.trilha.length === 0) && (
                      <li className="text-xs text-muted-foreground">Sem eventos registrados.</li>
                    )}
                  </ol>
                </div>
              </div>

              <div className="border-t border-border px-6 py-4 flex flex-wrap gap-2 bg-card">
                {NEXT_STATUS[selected.status].length === 0 ? (
                  <div className="text-xs text-muted-foreground">Lançamento finalizado.</div>
                ) : NEXT_STATUS[selected.status].map(s => (
                  <Button
                    key={s}
                    variant={s === "Aprovado" ? "default" : "outline"}
                    className={cn(s === "Aprovado" && "bg-[hsl(152_60%_36%)] hover:bg-[hsl(152_60%_30%)] text-white")}
                    onClick={() => {
                      if (s === "Ajuste solicitado") {
                        // Fecha slide-over antes de abrir modal para evitar conflito de eventos
                        setSheetHidden(true);
                        setTimeout(() => setAjusteOpen(true), 200);
                      }
                      else setConfirm({ novo: s });
                    }}
                  >
                    {s === "Aprovado" && <Check className="h-4 w-4 mr-1.5" />}
                    {s === "Ajuste solicitado" ? "Solicitar ajuste" : s}
                  </Button>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {selected && (
        <AjusteSolicitadoModal
          open={ajusteOpen}
          onClose={() => {
            setAjusteOpen(false);
            setSelected(null);
            setSheetHidden(false);
          }}
          onSent={() => {
            setAjusteOpen(false);
            setSelected(null);
            setSheetHidden(false);
            load();
          }}
          idUnico={selected.id_unico}
          valor={selected.valor}
          regra={selected.regra}
          competencia={selected.competencia}
        />
      )}

      {consolidadoOpen && fResp !== "todas" && (
        <SolicitarJustificativasModal
          open={consolidadoOpen}
          onClose={() => setConsolidadoOpen(false)}
          onSent={() => { setConsolidadoOpen(false); load(); }}
          responsavel={fResp}
        />
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) { setConfirm(null); setComentario(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Alterar para "{confirm?.novo}"</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Comentário (opcional)</label>
            <Textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={4} placeholder="Justifique ou detalhe sua decisão…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirm(null); setComentario(""); }} disabled={saving}>Cancelar</Button>
            <Button onClick={() => confirm && mudarStatus(confirm.novo, comentario.trim())} disabled={saving}
              className={cn(confirm?.novo === "Aprovado" && "bg-[hsl(152_60%_36%)] hover:bg-[hsl(152_60%_30%)] text-white")}>
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ label, value, legend, valueClass, breakdown }: { label: string; value: string; legend: string; valueClass?: string; breakdown?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-3xl font-bold num tracking-tight", valueClass)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{legend}</div>
      {breakdown}
    </div>
  );
}

function MiniChip({ cls, text }: { cls: string; text: string }) {
  return <span className={cn("inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-medium border", cls)}>{text}</span>;
}

function MetaItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={cn(full && "col-span-2")}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="text-sm mt-1 break-words">{value || "—"}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="text-sm bg-transparent outline-none">
        <option value="todas">todas</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function StatusMenu({ status, onChange }: { status: Status; onChange: (n: Status) => void }) {
  const ss = statusStyle(status);
  const nexts = NEXT_STATUS[status];
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", ss.pill, nexts.length && "cursor-pointer")}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", ss.dot)} />
        {status}
      </button>
      {open && nexts.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-44 rounded-lg border border-border bg-popover shadow-lg py-1">
            {nexts.map(n => (
              <button
                key={n}
                onClick={(e) => { e.stopPropagation(); setOpen(false); onChange(n); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
              >→ {n}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
