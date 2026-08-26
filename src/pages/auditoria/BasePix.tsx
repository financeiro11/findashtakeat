import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { brl, brlAbbr, fmtDateBR } from "./utils";
import { comValorExato } from "@/components/ValorExato";
import { Search, RefreshCw, Loader2, ExternalLink, FileWarning, FileCheck2, FileSearch, Upload, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useApelidos } from "@/hooks/useApelidos";
import { apelidoDe } from "@/lib/apelidos";
import { ComprovanteLink } from "@/components/ComprovanteLink";

type Lanc = {
  id: number;
  id_unico: string;
  referencia: string;
  data: string | null;
  valor: number;
  descricao: string | null;
  favorecido: string | null;
  cnpj_cpf: string | null;
  conta_corrente: string | null;
  categoria_codigo: string | null;
  categoria: string | null;
  tem_comprovante: boolean;
  comprovante_url: string | null;
  anexo_nome: string | null;
  status: string;
  observacao: string | null;
};

/* A nota que chegou de fora do ERP — das cinco planilhas de formulário ou das
   duas pastas de comprovante do Drive — já casada com este lançamento. */
type NotaExterna = {
  alvo_id_unico: string;
  nota_id: number;
  fonte: string;
  link: string;
  nome: string | null;
  o_que_e: string | null;
  detalhe: string | null;
  valor: number | null;
  enviado_em: string | null;
  competencia: string | null;
  casamento: string | null;
  confianca: "exata" | "alta" | "media" | null;
  conferencia: "confere" | "falta_anexar" | "promessa_falsa" | "ambiguo" | "sem_alvo" | null;
  diz_anexado: boolean;
  status_planilha: string | null;
  erp_anexos: number | null;
  fila_erp: boolean;
  enviado_erp_em: string | null;
  erro_erp: string | null;
  /** nota | boleto | recibo | extrato | outro — pelo nome do arquivo */
  tipo_documento: string | null;
  /** falso quando é boleto ou extrato: existe arquivo, mas não é documento fiscal */
  parece_nota: boolean;
  chave_fiscal: string | null;
  /** falso quando a origem só APONTOU a nota (e-mail com link, sem anexo) */
  tem_arquivo: boolean;
};

const FONTE_ROTULO: Record<string, string> = {
  compras: "Compras",
  reembolsos: "Reembolsos",
  nfs_colaboradores: "NFS-e colaboradores",
  eventos: "Eventos & Parcerias",
  parceiros: "Parceiros",
  drive_mercado_livre: "Drive · Mercado Livre",
  drive_whatsapp: "Drive · WhatsApp",
  // A pasta do Drive é o depósito de anexos feito por fora; `email` é o Hub
  // lendo a caixa. Nomes distintos porque, quando a de fora parar de novo, tem
  // de dar para ver na tela qual das duas trouxe a nota.
  drive_gmail: "E-mail (pasta)",
  email: "E-mail",
};

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece as RPCs desta
   migration — mesmo atalho do `useApelidos`, some quando os tipos forem
   regerados. */
const chamar = <T,>(nome: string, args?: Record<string, unknown>): PromiseLike<{ data: T | null; error: { message?: string } | null }> =>
  (supabase as unknown as { rpc: (n: string, a?: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { message?: string } | null }> })
    .rpc(nome, args);

const STATUS = ["Pendente", "Em análise", "Aprovado", "Reprovado"] as const;
const PAGE_SIZE = 50;

const referenciaLabel = (ref: string) => {
  const [y, m] = ref.split("-");
  if (!y || !m) return ref;
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${meses[Number(m) - 1] ?? m} / ${y}`;
};
const mesAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
function ultimosMeses(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() - 1); }
  return out;
}

export default function BasePix({ abas }: { abas?: React.ReactNode }) {
  const apelidos = useApelidos();
  const [rows, setRows] = useState<Lanc[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [referencia, setReferencia] = useState<string>(mesAtual());
  const [fCat, setFCat] = useState("todas");
  const [fCompr, setFCompr] = useState<"todos" | "com" | "sem">("todos");
  const [fNota, setFNota] = useState<"todas" | "com" | "sem" | "falta_anexar" | "promessa_falsa">("todas");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(1);
  const [notas, setNotas] = useState<Record<string, NotaExterna[]>>({});
  const [cruzando, setCruzando] = useState(false);
  const [enviandoErp, setEnviandoErp] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [askReplace, setAskReplace] = useState<{ row: Lanc; base64: string; nome: string; nomes: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRow = useRef<Lanc | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("auditoria_pix_lancamentos" as any)
      .select("*")
      .order("data", { ascending: false })
      .limit(5000);
    if (error) { toast.error("Erro ao carregar PIX"); setRows([]); }
    else setRows((data ?? []) as unknown as Lanc[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  /* As notas das planilhas e do Drive, agrupadas pelo lançamento que explicam.
     Uma leitura só para a tabela inteira — a lição do `useApelidos`: 50 linhas
     na tela viram 50 requisições idênticas se cada uma buscar a sua.

     ACESSÓRIO POR CONSTRUÇÃO: se a RPC falhar (migration ainda não aplicada, por
     exemplo), o mapa fica vazio e a tela mostra o que sempre mostrou. */
  const carregarNotas = useCallback(async () => {
    if (!referencia) return;
    /* Pelo MÊS, e não tudo de uma vez: o PostgREST devolve no máximo 1000 linhas
       e não avisa quando corta — a tela ficaria não incompleta, e sim errada,
       com lançamentos sem nota que na verdade têm uma. E é só do mês em foco
       que os KPIs e a tabela precisam. */
    const { data, error } = await chamar<NotaExterna[]>("notas_externas_por_alvo", {
      p_alvo_tipo: "pix", p_referencia: referencia,
    });
    if (error) { console.warn("[pix] sem as notas externas:", error); return; }
    const mapa: Record<string, NotaExterna[]> = {};
    for (const n of data ?? []) {
      if (!n.alvo_id_unico) continue;
      (mapa[n.alvo_id_unico] ??= []).push(n);
    }
    setNotas(mapa);
  }, [referencia]);
  useEffect(() => { carregarNotas(); }, [carregarNotas]);

  // Garante string legível de qualquer erro (objeto, PostgrestError, etc.).
  const comoTexto = (v: any): string => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return [v.message, v.details, v.hint].filter(Boolean).join(" — ") || (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
  };

  // Invoca a função e extrai o erro real do FunctionsHttpError (corpo em error.context).
  const invocar = async (payload: Record<string, unknown>, fn = "omie-pix-sync") => {
    const { data, error } = await supabase.functions.invoke(fn, { body: payload });
    if (error) {
      let detalhe = comoTexto(error.message) || "";
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx.text === "function") {
        try { const raw = await ctx.text(); const p = JSON.parse(raw); detalhe = comoTexto(p?.error) || raw || detalhe; } catch { /* keep */ }
      }
      // O nome da função entra no texto: desde que esta tela passou a chamar
      // três funções, "omie-pix-sync não publicada" mandaria conferir o deploy
      // errado.
      console.error(`[${fn}]`, detalhe, error);
      if (/not found|Failed to (send|fetch)/i.test(detalhe)) throw new Error(`A função ${fn} ainda não foi publicada no Supabase (deploy pendente).`);
      if (/OMIE_APP_KEY|OMIE_APP_SECRET|Credenciais do Omie/i.test(detalhe)) throw new Error("Faltam os secrets OMIE_APP_KEY / OMIE_APP_SECRET no Supabase.");
      if (/cod_cliente|cnpj_cpf|column .* does not exist/i.test(detalhe)) throw new Error("A migration nova (colunas cod_cliente/cnpj_cpf) ainda não foi aplicada no Supabase.");
      throw new Error(detalhe || "Erro no backend.");
    }
    if ((data as any)?.error) throw new Error(comoTexto((data as any).error));
    return data as any;
  };

  const sync = async () => {
    setSyncing(true);
    toast.message(`Sincronizando PIX de ${referenciaLabel(referencia)} com o Omie…`);
    try {
      // 1) Grava os lançamentos do mês (rápido, sem chamadas por título).
      const d = await invocar({ action: "sync", referencia });
      toast.success(`${d.pix_gravados} lançamentos gravados. Buscando fornecedores e comprovantes…`);
      await load();

      // 2) Enriquece (nome do fornecedor + comprovante) em lotes até zerar — evita o timeout.
      //    Retenta falhas transitórias (o passo é resumível) antes de desistir.
      let restantes = Number(d.anexos_pendentes ?? 0);
      let seguranca = 0, falhas = 0;
      while (restantes > 0 && seguranca < 300) {
        try {
          const a = await invocar({ action: "anexos", referencia, limite: 60 });
          restantes = Number(a.restantes ?? 0);
          falhas = 0;
          toast.message(`Fornecedores e comprovantes: ${restantes} restante(s)…`);
          await load();
        } catch (e) {
          if (++falhas >= 3) throw e; // desiste após 3 falhas seguidas
        }
        seguranca++;
      }
      await load();
      toast.success("PIX sincronizado.");
    } catch (e: any) {
      toast.error("Falha ao sincronizar PIX: " + e.message, { duration: 8000 });
    } finally { setSyncing(false); }
  };

  /* Puxa as cinco planilhas de formulário, casa com os lançamentos e confere
     contra o anexo do ERP. É a mesma NF que já foi enviada uma vez — o que
     mudou é que agora ela é procurada, em vez de esperada. */
  const cruzar = async () => {
    setCruzando(true);
    toast.message("Lendo as planilhas, as pastas do Drive e a caixa de e-mail…");
    try {
      /* A CAIXA PRIMEIRO, e o fracasso dela não derruba o resto: enquanto o
         consentimento do Google não estiver feito, a `gmail-nf-sync` responde
         erro — e as planilhas, que não dependem de nada disso, têm de continuar
         cruzando normalmente. */
      let doEmail = 0;
      let erroEmail: string | null = null;
      try {
        const g = await invocar({ action: "sync", dias: 30, limite: 12 }, "gmail-nf-sync");
        doEmail = Number(g?.notas ?? 0);
      } catch (e) {
        erroEmail = e instanceof Error ? e.message : String(e);
        console.warn("[pix] caixa de e-mail:", erroEmail);
      }

      const d = await invocar({ action: "sync" }, "planilhas-nf-sync");
      const r = d?.resumo ?? {};
      const conf = r.conferencia ?? {};
      await carregarNotas();
      toast.success(
        `${d.gravadas ?? 0} notas lidas · ${doEmail} do e-mail · ${r.em_pix ?? 0} casadas com PIX` +
        (conf.promessa_falsa ? ` · ${conf.promessa_falsa} dizem "anexado" e o ERP não tem` : ""),
        { duration: 9000 },
      );
      if (erroEmail) {
        toast.warning("A caixa de e-mail não respondeu: " + erroEmail, { duration: 9000 });
      }
    } catch (e) {
      toast.error("Falha ao cruzar as planilhas: " + (e instanceof Error ? e.message : String(e)), { duration: 8000 });
    } finally { setCruzando(false); }
  };

  /* Manda ao Omie as notas que faltam. Duas etapas de propósito: a fila é do
     Postgres (com a guarda de não reenviar o que o ERP já tem) e o envio é da
     varredura que já existe — a mesma que serve achado, cartão e Facilities. */
  const enviarAoErp = async (ids: number[]) => {
    if (!ids.length) return;
    setEnviandoErp(true);
    try {
      const { data: n, error } = await chamar<number>("notas_externas_enfileirar", { p_ids: ids });
      if (error) throw new Error(error.message ?? "não deu para enfileirar");
      if (!n) { toast.message("Nada a enviar: o ERP já tem essas notas."); return; }
      toast.message(`${n} nota(s) na fila. Subindo ao Omie…`);
      // Lote pequeno: o teto do worker é de CPU (zip + base64), e rodadas em
      // sequência dividem o mesmo orçamento.
      const d = await invocar({ action: "varredura", limite: 6 }, "omie-anexar-comprovante");
      await Promise.all([load(), carregarNotas()]);
      const restante = Math.max(0, n - Number(d.enviados ?? 0));
      toast.success(
        `${d.enviados ?? 0} anexo(s) no Omie` +
        (d.falhas ? ` · ${d.falhas} falha(s)` : "") +
        // A fila não se perde: o cron da varredura passa de 15 em 15 minutos.
        (restante ? ` · ${restante} na fila, o cron leva o resto` : ""),
        { duration: 8000 },
      );
    } catch (e) {
      toast.error("Falha ao enviar ao Omie: " + (e instanceof Error ? e.message : String(e)), { duration: 8000 });
    } finally { setEnviandoErp(false); }
  };

  // Opções de mês: últimos 18 + qualquer mês que já tenha dados (mesmo mais antigo).
  // Anexar comprovante: lê o arquivo, envia à função (que anexa no Omie) e recarrega.
  const abrirSeletor = (row: Lanc) => { pendingRow.current = row; fileRef.current?.click(); };
  const lerBase64 = (file: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); res(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => rej(r.error ?? new Error("Falha ao ler o arquivo"));
    r.readAsDataURL(file);
  });
  const onArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const row = pendingRow.current;
    pendingRow.current = null;
    if (!file || !row) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name) && !/^(application\/pdf|image\/(jpeg|png))$/.test(file.type)) {
      return toast.error("Formato inválido. Use PDF, JPG ou PNG.");
    }
    if (file.size > 6 * 1024 * 1024) return toast.error("Arquivo acima de 6 MB.");
    setUploadingId(row.id);
    toast.message(`Enviando comprovante de ${row.favorecido || row.cnpj_cpf || "lançamento"}…`);
    try {
      const base64 = await lerBase64(file);
      const resp = await invocar({ action: "upload", id: row.id, id_unico: row.id_unico, nome: file.name, base64 });
      if (resp?.ja_tem_anexo) {
        // Já existe anexo no Omie → pergunta substituir/acrescentar (guarda o base64).
        setAskReplace({ row, base64, nome: file.name, nomes: resp.nomes ?? [] });
      } else {
        toast.success("Comprovante anexado e enviado ao Omie.");
        await load();
      }
    } catch (err: any) {
      toast.error("Falha ao anexar: " + err.message, { duration: 8000 });
    } finally { setUploadingId(null); }
  };

  const confirmarModo = async (modo: "substituir" | "acrescentar") => {
    const a = askReplace;
    if (!a) return;
    setAskReplace(null);
    setUploadingId(a.row.id);
    toast.message(modo === "substituir" ? "Substituindo comprovante no Omie…" : "Acrescentando comprovante no Omie…");
    try {
      await invocar({ action: "upload", id: a.row.id, id_unico: a.row.id_unico, nome: a.nome, base64: a.base64, modo });
      toast.success(modo === "substituir" ? "Comprovante substituído no Omie." : "Comprovante acrescentado no Omie.");
      await load();
    } catch (err: any) {
      toast.error("Falha ao anexar: " + err.message, { duration: 8000 });
    } finally { setUploadingId(null); }
  };

  const referencias = useMemo(() => {
    const set = new Set<string>([...ultimosMeses(18), ...rows.map(r => r.referencia).filter(Boolean)]);
    return Array.from(set).sort().reverse();
  }, [rows]);

  const periodRows = useMemo(() => referencia ? rows.filter(r => r.referencia === referencia) : rows, [rows, referencia]);
  const categorias = useMemo(() => Array.from(new Set(periodRows.map(r => r.categoria).filter(Boolean) as string[])).sort(), [periodRows]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return periodRows.filter(r => {
      if (fCat !== "todas" && r.categoria !== fCat) return false;
      if (fCompr === "com" && !r.tem_comprovante) return false;
      if (fCompr === "sem" && r.tem_comprovante) return false;

      const doLancamento = notas[r.id_unico] ?? [];
      // "com nota" quer dizer documento FISCAL: um boleto anexado não responde
      // a pergunta que esta tela faz.
      const comNota = doLancamento.some(n => n.parece_nota);
      if (fNota === "com" && !comNota) return false;
      if (fNota === "sem" && comNota) return false;
      if ((fNota === "falta_anexar" || fNota === "promessa_falsa")
          && !doLancamento.some(n => n.conferencia === fNota)) return false;

      if (q) {
        // O apelido entra junto: procurar pelo nome que está na tela precisa
        // funcionar tanto quanto procurar pelo favorecido do extrato. A nota
        // encontrada entra pela MESMA razão — ela está escrita na linha.
        const ap = apelidoDe(apelidos, r.favorecido, r.cnpj_cpf);
        const daNota = doLancamento.map(n => `${n.nome ?? ""} ${n.o_que_e ?? ""} ${FONTE_ROTULO[n.fonte] ?? n.fonte}`).join(" ");
        const hay = `${r.favorecido ?? ""} ${ap?.apelido ?? ""} ${ap?.oQueE ?? ""} ${r.cnpj_cpf ?? ""} ${r.descricao ?? ""} ${r.categoria ?? ""} ${daNota}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [periodRows, fCat, fCompr, fNota, busca, apelidos, notas]);

  useEffect(() => { setPage(1); }, [referencia, fCat, fCompr, fNota, busca]);

  const kpis = useMemo(() => {
    const total = periodRows.length;
    const soma = periodRows.reduce((s, r) => s + Number(r.valor || 0), 0);
    const semCompr = periodRows.filter(r => !r.tem_comprovante).length;
    const comCompr = total - semCompr;
    const cobertura = total > 0 ? (comCompr / total) * 100 : 0;

    /* A nota que está fora do ERP. Conta-se por LANÇAMENTO e não por nota: dois
       arquivos do mesmo reembolso são uma linha só na tela.

       E só conta o que é DOCUMENTO FISCAL: metade do que chega por e-mail é
       boleto, e boleto não responde "cadê a nota". */
    const doPeriodo = periodRows.map(r => (notas[r.id_unico] ?? []).filter(n => n.parece_nota));
    const comNota = doPeriodo.filter(ns => ns.length).length;
    const falta = doPeriodo.filter(ns => ns.some(n => n.conferencia === "falta_anexar")).length;
    const promessa = doPeriodo.filter(ns => ns.some(n => n.conferencia === "promessa_falsa")).length;
    // O que a nota resolve: sem comprovante no ERP, mas com a NF já enviada.
    const resolviveis = periodRows.filter(
      (r, i) => !r.tem_comprovante && doPeriodo[i].some(n => n.conferencia === "falta_anexar" || n.conferencia === "promessa_falsa"),
    ).length;
    /* O envio em lote leva só nota COM ARQUIVO: boleto sobe um a um, com alguém
       decidindo, e a nota "por link" (o e-mail do Bling, que aponta a DANFE sem
       anexar nada) não tem o que subir. */
    const idsParaErp = doPeriodo.flat()
      .filter(n => n.tem_arquivo && !n.enviado_erp_em
        && (n.conferencia === "falta_anexar" || n.conferencia === "promessa_falsa"))
      .map(n => n.nota_id);

    return { total, soma, semCompr, comCompr, cobertura, comNota, falta, promessa, resolviveis, idsParaErp };
  }, [periodRows, notas]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 pt-3 pb-6 space-y-5">
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden onChange={onArquivo} />

      <Dialog open={!!askReplace} onOpenChange={(o) => { if (!o) setAskReplace(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Este lançamento já tem comprovante no Omie</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Já existe {askReplace?.nomes.length ?? 0} anexo(s) neste título{askReplace?.nomes.length ? `: ${askReplace.nomes.join(", ")}` : ""}.
            {" "}O que deseja fazer com <b>{askReplace?.nome}</b>?
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => confirmarModo("acrescentar")}>Acrescentar</Button>
            <Button onClick={() => confirmarModo("substituir")}>Substituir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Hub Financeiro · Governança</div>
          <h1 className="text-3xl font-bold tracking-tight mt-0.5">PIX · Sicoob</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Saídas já pagas da conta corrente Sicoob, puxadas do Omie · só títulos baixados (data de pagamento) · exceto transferências de saída · com categoria e comprovante.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {abas}
          {abas && <div className="h-6 w-px bg-border" />}
          <select
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium capitalize"
          >
            {referencias.map(r => <option key={r} value={r}>{referenciaLabel(r)}</option>)}
            {referencias.length === 0 && <option value="">—</option>}
          </select>
          <button
            onClick={cruzar}
            disabled={cruzando}
            title="Lê as cinco planilhas de NF e as pastas do Drive, casa com os lançamentos e confere contra o anexo do Omie"
            className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            {cruzando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />} Cruzar notas
          </button>
          <button
            onClick={sync}
            disabled={syncing}
            className="inline-flex items-center gap-2 h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : (
          <>
            <Kpi label="Lançamentos PIX" value={String(kpis.total)} />
            <Kpi label="Valor total" value={comValorExato(kpis.soma, brlAbbr(kpis.soma))} />
            <Kpi label="Sem anexo no Omie" value={String(kpis.semCompr)} valueClass="text-[hsl(0_72%_45%)]" />
            <Kpi label="Com anexo no Omie" value={String(kpis.comCompr)} valueClass="text-[hsl(152_60%_36%)]" />
            <Kpi label="Cobertura" value={`${kpis.cobertura.toFixed(1)}%`} valueClass="text-[hsl(152_60%_36%)]" />
          </>
        )}
      </div>

      {/* O DOUBLE CHECK, numa faixa só. Só aparece depois de cruzar — antes
          disso não há o que dizer, e uma faixa vazia é ruído. */}
      {!loading && kpis.comNota > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-5 py-3 text-sm">
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Notas encontradas fora do ERP</span>
            <b className="num">{kpis.comNota}</b>
          </div>
          {kpis.promessa > 0 && (
            <div className="flex items-center gap-2" title='A planilha registra "Anexado!" mas o título não tem anexo nenhum no Omie'>
              <FileWarning className="h-4 w-4 text-[hsl(0_72%_45%)]" />
              <span className="text-muted-foreground">A planilha diz que anexou, o Omie não tem</span>
              <b className="num text-[hsl(0_72%_45%)]">{kpis.promessa}</b>
            </div>
          )}
          {kpis.falta > 0 && (
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-[hsl(35_92%_40%)]" />
              <span className="text-muted-foreground">Nota achada, falta anexar</span>
              <b className="num text-[hsl(35_92%_40%)]">{kpis.falta}</b>
            </div>
          )}
          {kpis.idsParaErp.length > 0 && (
            <button
              onClick={() => enviarAoErp(kpis.idsParaErp)}
              disabled={enviandoErp}
              className="ml-auto inline-flex items-center gap-2 h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {enviandoErp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Anexar {kpis.idsParaErp.length} no Omie
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect label="Categoria" value={fCat} onChange={setFCat} options={categorias} allLabel="todas" />
        <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Anexo no Omie</span>
          <select value={fCompr} onChange={e => setFCompr(e.target.value as any)} className="text-sm bg-transparent outline-none">
            <option value="todos">todos</option>
            <option value="com">com anexo</option>
            <option value="sem">sem anexo</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Nota fora do ERP</span>
          <select value={fNota} onChange={e => setFNota(e.target.value as typeof fNota)} className="text-sm bg-transparent outline-none">
            <option value="todas">todas</option>
            <option value="com">com nota achada</option>
            <option value="sem">sem nota achada</option>
            <option value="falta_anexar">falta anexar</option>
            <option value="promessa_falsa">diz que anexou</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3 min-w-[240px] flex-1 max-w-[360px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Favorecido, descrição ou categoria…"
            className="flex-1 text-sm bg-transparent outline-none"
          />
        </label>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[100px_1.5fr_1.1fr_130px_1.3fr_150px] gap-3 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
          <div>Data</div>
          <div>Favorecido / Descrição</div>
          <div>Categoria Omie</div>
          <div className="text-right">Valor</div>
          {/* As duas verdades, lado a lado e sem se misturarem: onde a nota
              está e o que o ERP tem de fato. */}
          <div>Nota fora do ERP</div>
          <div>Anexo no Omie</div>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nenhum PIX carregado ainda. Clique em <b>Sincronizar</b> para puxar do Omie.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Nenhum lançamento com esses filtros.</div>
        ) : (
          <>
            {paged.map(r => (
              <PixRow
                key={r.id} r={r} onAnexar={abrirSeletor} uploading={uploadingId === r.id}
                notas={notas[r.id_unico] ?? []}
                onEnviarErp={enviarAoErp} enviandoErp={enviandoErp}
              />
            ))}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground border-t border-border">
                <div>Página {page} de {totalPages} · {filtered.length} lançamentos</div>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-2.5 py-1 rounded border border-border hover:bg-accent disabled:opacity-40">Anterior</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-2.5 py-1 rounded border border-border hover:bg-accent disabled:opacity-40">Próxima</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PixRow({ r, onAnexar, uploading, notas, onEnviarErp, enviandoErp }: {
  r: Lanc; onAnexar: (r: Lanc) => void; uploading: boolean;
  notas: NotaExterna[]; onEnviarErp: (ids: number[]) => void; enviandoErp: boolean;
}) {
  const ap = apelidoDe(useApelidos(), r.favorecido, r.cnpj_cpf);
  /* O vermelho é de COBRANÇA, e cobrar nota que já apareceu numa planilha é
     justamente o que esta esteira veio acabar. Sem anexo e sem nota segue
     vermelho; sem anexo mas com nota achada vira âmbar — é trabalho a fazer,
     não documento a caçar. Boleto não tira do vermelho: ele não é a nota. */
  const bg = r.tem_comprovante ? ""
    : notas.some(n => n.parece_nota) ? "bg-[hsl(35_92%_97%)]"
    : "bg-[hsl(0_80%_97%)]";
  return (
    <div className={cn("grid grid-cols-[100px_1.5fr_1.1fr_130px_1.3fr_150px] gap-3 px-4 py-2.5 items-center border-b border-border last:border-0 text-sm", bg)}>
      <div className="text-muted-foreground">{fmtDateBR(r.data)}</div>
      <div className="min-w-0">
        {/* Apelido em cima (Configurações › Parametrização), favorecido do
            extrato embaixo — é ele que se procura no banco e no Omie. */}
        <div className="font-medium truncate" title={ap?.oQueE ?? undefined}>
          {ap?.apelido ?? r.favorecido ?? r.cnpj_cpf ?? r.descricao ?? "—"}
        </div>
        {ap && r.favorecido && (
          <div className="text-xs text-muted-foreground truncate">{r.favorecido}</div>
        )}
        {r.descricao && r.descricao !== r.favorecido && (
          <div className="text-xs text-muted-foreground truncate">{r.descricao}</div>
        )}
      </div>
      <div className="text-xs truncate" title={r.categoria || ""}>{r.categoria || "—"}</div>
      <div className="text-right num font-medium">{brl(Number(r.valor || 0))}</div>

      <NotaCelula notas={notas} onEnviarErp={onEnviarErp} enviando={enviandoErp} />

      <div>
        {r.tem_comprovante ? (
          <div className="flex items-center gap-1.5">
            {r.comprovante_url ? (
              <a href={r.comprovante_url} target="_blank" rel="noreferrer"
                title={r.anexo_nome || "Comprovante anexado no Omie · abrir"}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-[hsl(152_55%_92%)] text-[hsl(152_65%_26%)] border-[hsl(152_55%_78%)] hover:brightness-95">
                <CheckCircle2 className="h-3 w-3" /> anexado <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : (
              <span
                title={r.anexo_nome || "Comprovante anexado no Omie"}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-[hsl(152_55%_92%)] text-[hsl(152_65%_26%)] border-[hsl(152_55%_78%)]">
                <CheckCircle2 className="h-3 w-3" /> anexado
              </span>
            )}
            <button
              onClick={() => onAnexar(r)}
              disabled={uploading}
              title="Anexar outro / substituir"
              className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-border text-muted-foreground hover:bg-accent disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            </button>
          </div>
        ) : (
          <button
            onClick={() => onAnexar(r)}
            disabled={uploading}
            title="Anexar comprovante (envia ao Omie)"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)] hover:bg-[hsl(0_80%_92%)] disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {uploading ? "enviando…" : "anexar"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A nota que existe fora do ERP, e em que pé ela está.
 *
 * Uma linha pode ter mais de uma (dois arquivos no mesmo reembolso). Mostra-se a
 * primeira e o resto vira "+N", porque é a existência que importa na varredura
 * visual — o detalhe está no hover.
 */
function NotaCelula({ notas, onEnviarErp, enviando }: {
  notas: NotaExterna[]; onEnviarErp: (ids: number[]) => void; enviando: boolean;
}) {
  if (!notas.length) return <div className="text-xs text-muted-foreground">—</div>;

  /* Duas ordens, nesta ordem: a NOTA vem antes do boleto (é ela que a auditoria
     cobra) e, entre notas, a pior notícia primeiro — uma promessa falsa não
     pode ficar escondida atrás de uma nota irmã que já conferiu. */
  const ordem = { promessa_falsa: 0, falta_anexar: 1, confere: 2 } as Record<string, number>;
  const [n, ...resto] = [...notas].sort(
    (a, b) => Number(b.parece_nota) - Number(a.parece_nota)
      || (ordem[a.conferencia ?? ""] ?? 9) - (ordem[b.conferencia ?? ""] ?? 9),
  );
  const pendentes = notas.filter(x => !x.enviado_erp_em
    && (x.conferencia === "falta_anexar" || x.conferencia === "promessa_falsa"));

  const selo =
    n.conferencia === "promessa_falsa"
      ? { txt: "diz que anexou", cls: "bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)]",
          dica: `A planilha registra "${n.status_planilha ?? "anexado"}" — o título não tem anexo no Omie.` }
    : n.conferencia === "falta_anexar"
      ? { txt: "falta anexar", cls: "bg-[hsl(35_92%_95%)] text-[hsl(35_92%_32%)] border-[hsl(35_92%_82%)]",
          dica: "A nota existe na origem e o título do Omie está sem anexo." }
    : { txt: "confere", cls: "bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]",
        dica: "A nota existe na origem e o ERP tem o anexo." };

  const comoCasou = `${n.casamento ?? "—"} · confiança ${n.confianca ?? "—"}`;

  const rotulo = FONTE_ROTULO[n.fonte] ?? n.fonte;
  const dica = [rotulo, n.o_que_e, n.detalhe, comoCasou].filter(Boolean).join(" · ");

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        {/* O link tanto pode ser URL (Drive, Gmail) quanto caminho no bucket
            privado, que precisa de signed URL — `ComprovanteLink` sabe os dois.
            Um <a href> cru abriria "email/2026-08/…" como caminho do site. */}
        <ComprovanteLink
          valor={n.link}
          title={dica}
          className="text-xs font-medium truncate hover:underline"
        >
          {rotulo}
        </ComprovanteLink>
        <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
        {/* Boleto e extrato ficam com o nome à mostra: existe arquivo, mas ele
            não é o documento fiscal que a auditoria está cobrando. */}
        {!n.parece_nota && n.tipo_documento && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0"
            title="Existe arquivo, mas não é documento fiscal">
            {n.tipo_documento}
          </span>
        )}
        {/* O contrário: é nota, mas ninguém mandou o arquivo — o e-mail só
            apontou. O link abre a mensagem; baixar de lá continua sendo gesto
            de gente, e por isso ela não entra na fila do ERP. */}
        {!n.tem_arquivo && (
          <span className="text-[10px] uppercase tracking-wide text-[hsl(35_92%_38%)] shrink-0"
            title="O e-mail informa a nota mas não anexou o arquivo — abra para baixar">
            só link
          </span>
        )}
        {resto.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0" title={`${resto.length} arquivo(s) a mais nesta nota`}>
            +{resto.length}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span title={selo.dica}
          className={cn("inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-semibold border", selo.cls)}>
          {selo.txt}
        </span>
        {n.enviado_erp_em && (
          <span className="text-[10px] text-muted-foreground" title={`Enviado ao Omie em ${fmtDateBR(n.enviado_erp_em.slice(0, 10))}`}>
            enviado
          </span>
        )}
        {n.erro_erp && (
          <span className="text-[10px] text-[hsl(0_72%_45%)] truncate" title={n.erro_erp}>falhou</span>
        )}
        {pendentes.some(x => x.tem_arquivo) && !n.erro_erp && (
          <button
            onClick={() => onEnviarErp(pendentes.filter(x => x.tem_arquivo).map(x => x.nota_id))}
            disabled={enviando}
            title="Subir esta nota para o título no Omie"
            className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-border text-muted-foreground hover:bg-accent disabled:opacity-60"
          >
            {enviando ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Upload className="h-2.5 w-2.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-2xl font-bold num tracking-tight", valueClass)}>{value}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: string[]; allLabel: string }) {
  return (
    <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="text-sm bg-transparent outline-none max-w-[180px]">
        <option value={allLabel}>{allLabel}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
