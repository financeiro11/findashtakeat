import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload, Plus, Pencil, Trash2, Search, Filter, Settings2, Check, X,
  Smartphone, Calendar as CalIcon, Clock, RefreshCw, CheckCircle2, Check as CheckIcon, Undo2,
  ScrollText,
  LayoutGrid, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarDateFuture,
  type PeriodoValor,
  type PresetPeriodo,
} from "@/components/ui/calendar-date-future";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalize } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import HistoricoChip from "@/pages/recargas/HistoricoChip";
import { InputMoeda } from "@/components/ui/input-moeda";
import { Badge } from "@/components/ui/badge";
import { LibAutofillInput } from "@/components/LibAutofillInput";

type Row = {
  id: string;
  proprietario: string;
  numero: string | null;
  situacao: string | null;
  setor: string | null;
  ultima_recarga: string | null;
  proxima_recarga: string | null;
  valor: number | null;
  verificado: string | null;
  solicitado_em?: string | null;
  // Presentes só quando a linha É uma solicitação vinda do TakeatOS. A fila e o
  // cadastro convivem na mesma lista, e estes campos distinguem uma da outra.
  solicitacao_id?: string;
  posicao_do_dia?: number | null;
};

// Situação é do CHIP (a linha está ativa na operadora?). O andamento da recarga
// é outra coisa e vive em STATUS_RECARGA — misturar os dois numa lista só fazia
// "Pendente" competir com "Ativo", que não são alternativas entre si.
const SITUACAO_OPTS = ["Ativo", "Inativo", "Suspenso"];

const STATUS_RECARGA = ["Pendente", "Feito"] as const;
// Rotulos herdados do banco que dizem respeito à RECARGA, não ao chip. Ficam fora
// da lista de situação para não duplicarem o status do pedido.
const ROTULOS_DE_RECARGA = ["Pendente", "Feito", "A fazer", "Feita", "Concluída"];
type StatusRecarga = (typeof STATUS_RECARGA)[number];

const STATUS_RECARGA_CLS: Record<StatusRecarga, string> = {
  Pendente: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  Feito: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
};
const SETOR_OPTS = ["Financeiro", "Comercial", "RPA", "TI", "Diretoria", "RH", "Marketing"];
const VERIFICADO_OPTS = ["Sim", "Não"];

// Cores da situação — mesma paleta de status da aba Viagens.
const SITUACAO_CLS: Record<string, string> = {
  Ativo: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  Suspenso: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
  Inativo: "bg-muted text-muted-foreground border-border",
};

const AVATAR_COLORS = [
  "bg-rose-500", "bg-violet-500", "bg-emerald-500", "bg-sky-500",
  "bg-amber-500", "bg-fuchsia-500", "bg-teal-500", "bg-orange-500",
];
// Hash do nome → cor estável: o mesmo colaborador mantém a cor entre sessões.
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "").join("") || "—";

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDataBR = (iso: string | null) =>
  iso ? new Date(iso + "T00:00").toLocaleDateString("pt-BR") : "—";
const fmtDataHoraBR = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
      })
    : "—";

// Dias até a próxima recarga. Negativo = atrasada, e o card marca em vermelho.
const diasAte = (iso: string | null) => {
  if (!iso) return null;
  const alvo = new Date(iso + "T00:00");
  if (isNaN(alvo.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
};

// A data da solicitação é sempre passada, então os presets padrão do campo
// (Amanhã, Semana que vem…) não filtrariam nada aqui. Estes olham para trás.
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fimDia = (d: Date) => {
  const x = inicioDia(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const PRESETS_SOLICITACAO: PresetPeriodo[] = [
  { id: "hoje", label: "Hoje", resolver: () => ({ from: inicioDia(new Date()), to: fimDia(new Date()) }) },
  {
    id: "ontem",
    label: "Ontem",
    resolver: () => {
      const o = new Date();
      o.setDate(o.getDate() - 1);
      return { from: inicioDia(o), to: fimDia(o) };
    },
  },
  {
    id: "7d",
    label: "Últimos 7 dias",
    resolver: () => {
      const f = new Date();
      f.setDate(f.getDate() - 6);
      return { from: inicioDia(f), to: fimDia(new Date()) };
    },
  },
  {
    id: "mes",
    label: "Esse mês",
    resolver: () => {
      const h = new Date();
      return { from: new Date(h.getFullYear(), h.getMonth(), 1), to: fimDia(new Date()) };
    },
  },
  {
    id: "mes_ant",
    label: "Mês passado",
    resolver: () => {
      const h = new Date();
      return {
        from: new Date(h.getFullYear(), h.getMonth() - 1, 1),
        to: fimDia(new Date(h.getFullYear(), h.getMonth(), 0)),
      };
    },
  },
  {
    id: "ano",
    label: "Esse ano",
    resolver: () => {
      const h = new Date();
      return { from: new Date(h.getFullYear(), 0, 1), to: fimDia(new Date()) };
    },
  },
];

// Derivado das duas datas do card, em vez de uma coluna nova: marcar como feita
// preenche `ultima_recarga`, e é exatamente isso que faz o status virar "Feito".
// Guardar o status à parte abriria espaço para ele discordar das datas.
function statusRecarga(r: {
  solicitado_em?: string | null;
  ultima_recarga: string | null;
  proxima_recarga?: string | null;
}): StatusRecarga {
  // Nunca recarregada.
  if (!r.ultima_recarga) return "Pendente";

  // Recarga feita ANTES do pedido não atende aquele pedido.
  if (r.solicitado_em && new Date(`${r.ultima_recarga}T23:59:59`) < new Date(r.solicitado_em)) {
    return "Pendente";
  }

  // Vencimento reabre o ciclo: já ter sido recarregada em março não deixa a linha
  // "feita" se a próxima venceu em abril. É por isso que uma data vermelha em
  // "Próxima" nunca pode conviver com o selo Feito.
  if (r.proxima_recarga) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (new Date(`${r.proxima_recarga}T00:00`) <= hoje) return "Pendente";
  }

  return "Feito";
}

// A situação do chip guarda rótulos de RECARGA em 52 das 67 linhas (herança de quando
// o campo era um só). Exibir "Feito" na coluna Situação repetiria o status da recarga
// e não diria nada sobre o chip — então esses valores caem no padrão até a migração
// de dados acertar a origem.
// Busca e período valem igual para o cadastro e para a fila — extraídos para os dois
// filtrarem pela mesma regra, em vez de duas cópias que divergem com o tempo.
function termoBate(r: { proprietario?: string | null; numero?: string | null }, termo: string) {
  const q = termo.trim().toLowerCase();
  if (!q) return true;
  return (
    (r.proprietario || "").toLowerCase().includes(q) ||
    (r.numero || "").toLowerCase().includes(q)
  );
}

function noPeriodo(
  r: { solicitado_em?: string | null; ultima_recarga?: string | null },
  periodo: PeriodoValor,
) {
  if (!periodo.from && !periodo.to) return true;
  const base = r.solicitado_em || (r.ultima_recarga ? `${r.ultima_recarga}T12:00:00` : null);
  if (!base) return false;
  const d = new Date(base);
  if (isNaN(d.getTime())) return false;
  if (periodo.from && d < periodo.from) return false;
  if (periodo.to && d > periodo.to) return false;
  return true;
}

function situacaoChip(situacao: string | null): string {
  if (!situacao || ROTULOS_DE_RECARGA.includes(situacao)) return "Ativo";
  return situacao;
}

const DAYS_KEY = "celulares_dias_proxima_recarga";
const VISAO_KEY = "celulares_visao";
// Vazio com contexto: numa aba filtrada, "sem registros" não diz se a busca
// não achou nada ou se simplesmente não há pendencia.
const VAZIO: Record<"pendentes" | "feitas" | "todas", string> = {
  pendentes: "Nenhuma recarga pendente.",
  feitas: "Nenhuma recarga feita neste recorte.",
  todas: "Nenhuma linha cadastrada.",
};
// A escolha entre card e lista é preferencia de quem usa, não do sistema:
// sobrevive a recarregar a página.
const getVisao = (): "cards" | "lista" =>
  (localStorage.getItem(VISAO_KEY) as "cards" | "lista") || "cards";
const getDays = () => Number(localStorage.getItem(DAYS_KEY)) || 45;
const addDays = (iso: string | null, days: number) => {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const empty = {
  proprietario: "", numero: "", situacao: "Ativo", setor: "",
  ultima_recarga: "", valor: "", verificado: "Não",
};

export default function RecargasCelulares() {
  const [rows, setRows] = useState<Row[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [days, setDays] = useState<number>(getDays());
  const [search, setSearch] = useState("");
  const [filtSit, setFiltSit] = useState<string>("__all");
  const [filtSetor, setFiltSetor] = useState<string>("__all");
  const [filtVer, setFiltVer] = useState<string>("__all");
  // As abas SAO o filtro de status da recarga — ter também um select em Filtros
  // criaria dois controles para a mesma coisa, livres para discordar.
  const [aba, setAba] = useState<"pendentes" | "feitas" | "todas">("pendentes");
  const [visao, setVisao] = useState<"cards" | "lista">(getVisao);
  const [historico, setHistorico] = useState<Row | null>(null);
  const [periodo, setPeriodo] = useState<PeriodoValor>({});

  useEffect(() => { document.title = "Recargas · Celulares"; load(); }, []);

  const load = async () => {
    // A fila e o cadastro vêm juntos: o Financeiro trabalha a aba Pendentes, e o que
    // chegou do TakeatOS tem de aparecer ali, não numa tela separada.
    const [linhas, fila] = await Promise.all([
      supabase.from("recargas_celulares").select("*").order("proprietario"),
      supabase
        .from("recargas_celulares_solicitacoes")
        .select(
          "id, colaborador, numero, operadora, setor, valor, solicitado_em, posicao_do_dia, status, concluido_em",
        )
        // Concluídas entram junto: sem elas a aba Feitas nunca mostraria um pedido
        // atendido, e o card sumiria da tela ao ser concluído.
        .in("status", ["Pendente", "Concluída"])
        .order("solicitado_em", { ascending: true }),
    ]);

    if (linhas.error) return toast.error(linhas.error.message);
    setRows((linhas.data as Row[]) || []);

    // A tabela pode não existir ainda em bancos onde a migration não rodou — nesse
    // caso a tela segue funcionando só com o cadastro.
    if (fila.error) {
      if (fila.error.code !== "42P01" && fila.error.code !== "PGRST205") {
        console.warn("[recargas] fila indisponível:", fila.error.message);
      }
      setSolicitacoes([]);
      return;
    }
    setSolicitacoes(
      (fila.data || []).map((f) => ({
        id: `solic-${f.id}`,
        solicitacao_id: f.id,
        proprietario: f.colaborador,
        numero: f.numero,
        situacao: "Ativo",
        setor: f.setor,
        // O status vem da data, igual a qualquer linha: sem data de recarga o
        // statusRecarga() devolve "Pendente"; com ela, "Feito". Assim o card
        // concluído aparece na aba Feitas em vez de sumir.
        ultima_recarga: f.concluido_em ? String(f.concluido_em).slice(0, 10) : null,
        proxima_recarga: null,
        valor: f.valor,
        verificado: null,
        solicitado_em: f.solicitado_em,
        posicao_do_dia: f.posicao_do_dia,
      })),
    );
  };

  const setores = useMemo(() => {
    const s = new Set<string>(SETOR_OPTS);
    rows.forEach((r) => r.setor && s.add(r.setor));
    return Array.from(s).sort();
  }, [rows]);
  const situacoes = useMemo(() => {
    const s = new Set<string>(SITUACAO_OPTS);
    // Valores herdados do banco entram na lista, MENOS os que descrevem a recarga:
    // "Pendente"/"Feito" são status do pedido, não do chip.
    rows.forEach((r) => {
      if (r.situacao && !ROTULOS_DE_RECARGA.includes(r.situacao)) s.add(r.situacao);
    });
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filtSit !== "__all" && situacaoChip(r.situacao) !== filtSit) return false;
      if (filtSetor !== "__all" && (r.setor || "") !== filtSetor) return false;
      if (filtVer !== "__all" && (r.verificado || "Não") !== filtVer) return false;
      if (!noPeriodo(r, periodo)) return false;
      return termoBate(r, search);
    });
  }, [rows, search, filtSit, filtSetor, filtVer, periodo]);

  const salvarVisao = (v: "cards" | "lista") => {
    setVisao(v);
    localStorage.setItem(VISAO_KEY, v);
  };

  // `filtered` já aplicou busca, setor, verificação e período. As abas recortam
  // por cima disso, e os contadores mostram o resultado do MESMO recorte — senão o
  // número na aba não bate com a lista que ela abre.
  const porAba = useMemo(() => {
    // A fila entra na FRENTE de Pendentes, na ordem em que foi pedida — é a ordem em
    // que o Financeiro atende. Só cabem ~40 por dia, então a sequência é o produto.
    const daFila = solicitacoes.filter((s) => {
      if (!termoBate(s, search)) return false;
      if (filtSetor !== "__all" && (s.setor || "") !== filtSetor) return false;
      return noPeriodo(s, periodo);
    });

    // A linha do mesmo número não se repete embaixo: o card da solicitação já a
    // representa, e com mais informação (horário do pedido e posição na fila).
    const naFila = new Set(
      daFila.map((s) => String(s.numero || "").replace(/\D/g, "").slice(-8)).filter(Boolean),
    );
    const semDuplicar = (r: Row) =>
      !naFila.has(String(r.numero || "").replace(/\D/g, "").slice(-8));

    // A fila tambem se divide por status: concluida vai para Feitas, igual a uma linha.
    // Antes `daFila` entrava inteira em Pendentes, entao um pedido concluido continuava
    // aparecendo la e nunca chegava em Feitas.
    const filaPendente = daFila.filter((x) => statusRecarga(x) === "Pendente");
    const filaFeita = daFila.filter((x) => statusRecarga(x) === "Feito");

    const pendentes = [
      ...filaPendente,
      ...filtered.filter((r) => statusRecarga(r) === "Pendente" && semDuplicar(r)),
    ];
    const feitas = [
      ...filaFeita,
      ...filtered.filter((r) => statusRecarga(r) === "Feito" && semDuplicar(r)),
    ];
    return { pendentes, feitas, todas: [...daFila, ...filtered.filter(semDuplicar)] };
  }, [filtered, solicitacoes, search, filtSetor, periodo]);

  const visiveis = porAba[aba];


  const saveDays = (n: number) => {
    setDays(n);
    localStorage.setItem(DAYS_KEY, String(n));
  };

  const salvar = async () => {
    if (!form.proprietario.trim()) return toast.error("Proprietário obrigatório");
    const ultima = form.ultima_recarga || null;
    const payload = {
      proprietario: form.proprietario,
      numero: form.numero || null,
      situacao: form.situacao || null,
      setor: form.setor || null,
      ultima_recarga: ultima,
      proxima_recarga: addDays(ultima, days),
      valor: form.valor ? Number(form.valor) : 0,
      verificado: form.verificado || "Não",
    };
    // proxima_recarga é sempre derivada de ultima_recarga + dias — nunca digitada.
    const { error } = editingId
      ? await supabase.from("recargas_celulares").update(payload).eq("id", editingId)
      : await supabase.from("recargas_celulares").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editingId ? "Atualizado" : "Criado");
    setOpen(false);
    setEditingId(null);
    setForm({ ...empty });
    load();
  };

  // Em card não cabe edição inline: o lápis abre o mesmo diálogo do "Novo",
  // já preenchido.
  const abrirEdicao = (r: Row) => {
    setEditingId(r.id);
    setForm({
      proprietario: r.proprietario || "",
      numero: r.numero || "",
      situacao: r.situacao || "Ativo",
      setor: r.setor || "",
      ultima_recarga: r.ultima_recarga || "",
      valor: r.valor != null ? String(r.valor) : "",
      verificado: r.verificado || "Não",
    });
    setOpen(true);
  };

  // Troca só a situação, direto no card — ação frequente que não justifica diálogo.
  // Atualização otimista para o select não "pular" enquanto o banco responde.
  const mudarSituacao = async (r: Row, situacao: string) => {
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, situacao } : x)));
    const { error } = await supabase
      .from("recargas_celulares")
      .update({ situacao })
      .eq("id", r.id);
    if (error) {
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, situacao: r.situacao } : x)));
      toast.error(error.message);
    }
  };

  // Alterna entre pendente e feita. Marcar preenche a data de hoje; desmarcar a
  // remove, porque é a data que define o status — deixar as duas coisas discordarem
  // seria pior. Para o caso de erro de clique, o valor anterior fica guardado e volta
  // no desfazer, então um histórico legítimo não se perde.
  const anteriores = useRef<Record<string, { ultima: string | null; proxima: string | null }>>({});

  // Card que veio da fila: concluir NAO e mexer na linha, e fechar o pedido — o que
  // inclui avisar o TakeatOS. Por isso vai pela Edge Function, que guarda o segredo.
  const alternarSolicitacao = async (r: Row) => {
    const feita = statusRecarga(r) === "Feito";
    const novo = feita ? "Pendente" : "Concluída";

    const { data, error } = await supabase.functions.invoke("recargas-concluir", {
      body: { solicitacao_id: r.solicitacao_id, status: novo },
    });
    if (error) return toast.error("Não consegui alterar: " + error.message);

    // Não removemos da lista: o `load()` abaixo a traz de volta com o status novo.
    // Sumir da tela faria parecer que o registro se perdeu.
    // Só afirmamos que o TakeatOS soube quando ele de fato respondeu.
    const aviso = data?.avisado ? " O TakeatOS foi avisado." : " (não consegui avisar o TakeatOS ainda)";
    toast.success(
      (feita
        ? `Recarga de ${r.proprietario} voltou para pendente.`
        : `Recarga de ${r.proprietario} concluída.`) + aviso,
    );
    load();
  };

  // Cancelar tira o pedido da fila sem apagar a linha do cadastro — são coisas
  // diferentes, e apagar a linha por causa de um pedido seria destrutivo demais.
  const cancelarSolicitacao = async (r: Row) => {
    const { error } = await supabase
      .from("recargas_celulares_solicitacoes")
      .update({ status: "Cancelada" })
      .eq("id", r.solicitacao_id!);
    if (error) return toast.error(error.message);
    toast.success(`Solicitação de ${r.proprietario} cancelada.`);
    load();
  };

  // O lápis num card da fila edita a LINHA correspondente, não o pedido: um pedido
  // é um fato registrado, o cadastro é que se corrige. Casa pelos dígitos do número.
  const editarLinhaDaSolicitacao = (r: Row) => {
    const digitos = String(r.numero || "").replace(/\D/g, "").slice(-8);
    const linha = rows.find(
      (x) => digitos && String(x.numero || "").replace(/\D/g, "").endsWith(digitos),
    );
    if (!linha) {
      return toast.error("Esse número não tem linha cadastrada aqui. Cadastre em Nova linha.");
    }
    abrirEdicao(linha);
  };

  const alternarFeita = async (r: Row) => {
    const feita = statusRecarga(r) === "Feito";
    let patch: { ultima_recarga: string | null; proxima_recarga: string | null };

    if (feita) {
      const guardado = anteriores.current[r.id];
      // A próxima recarga é preservada de propósito: o prazo no topo do card continua
      // valendo mesmo com a recarga pendente — some-lo seria perder a informação de
      // quando ela é esperada, que é justamente o que importa enquanto não foi feita.
      patch = {
        ultima_recarga: guardado ? guardado.ultima : null,
        proxima_recarga: guardado?.proxima ?? r.proxima_recarga,
      };
      delete anteriores.current[r.id];
    } else {
      anteriores.current[r.id] = { ultima: r.ultima_recarga, proxima: r.proxima_recarga };
      const hojeISO = new Date().toISOString().slice(0, 10);
      patch = { ultima_recarga: hojeISO, proxima_recarga: addDays(hojeISO, days) };
    }

    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("recargas_celulares").update(patch).eq("id", r.id);
    if (error) {
      setRows((prev) => prev.map((x) => (x.id === r.id ? r : x)));
      return toast.error(error.message);
    }

    // O histórico é o registro permanente; `ultima_recarga` guarda só a última e é
    // sobrescrita. Congela o titular do momento — daqui a um ano o chip pode ser de
    // outra pessoa, e o gasto continua tendo que apontar para quem recebeu.
    if (feita) {
      await supabase
        .from("recargas_celulares_historico")
        .delete()
        .eq("linha_id", r.id)
        .eq("recarregado_em", r.ultima_recarga || "");
    } else {
      await supabase.from("recargas_celulares_historico").insert({
        linha_id: r.id,
        colaborador: r.proprietario,
        numero: r.numero,
        valor: Number(r.valor || 0),
        recarregado_em: patch.ultima_recarga,
      });
    }
    // Fecha o ciclo no TakeatOS. Sem isso, o pedido do colaborador ficaria "Pendente"
    // lá para sempre mesmo depois de atendido aqui. Vai por Edge Function porque o
    // segredo do callback não pode viver no navegador.
    const { data: aviso } = await supabase.functions.invoke("recargas-concluir", {
      body: { linha_id: r.id, status: feita ? "Pendente" : "Concluída" },
    });

    const base = feita
      ? `Recarga de ${r.proprietario} voltou para pendente.`
      : `Recarga de ${r.proprietario} registrada em ${fmtDataBR(patch.ultima_recarga)}.`;
    // Só dizemos que o TakeatOS soube quando ele de fato respondeu.
    const sufixo =
      aviso?.avisado === true
        ? " O TakeatOS foi avisado."
        : aviso?.motivo === "sem_solicitacao_aberta"
          ? ""
          : " (não consegui avisar o TakeatOS ainda)";
    toast.success(base + sufixo);
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir registro?")) return;
    const { error } = await supabase.from("recargas_celulares").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Excluído"); load(); }
  };

  const recomputeAll = async () => {
    if (!confirm(`Recalcular Próxima Recarga de todos os registros (+${days} dias)?`)) return;
    const updates = rows.filter(r => r.ultima_recarga).map(r =>
      supabase.from("recargas_celulares")
        .update({ proxima_recarga: addDays(r.ultima_recarga, days) })
        .eq("id", r.id)
    );
    await Promise.all(updates);
    toast.success("Atualizado");
    load();
  };

  const importExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!json.length) return toast.error("Planilha vazia");

      const map: Record<string, string> = {};
      Object.keys(json[0]).forEach((k) => { map[normalize(k)] = k; });
      const get = (row: any, ...keys: string[]) => {
        for (const k of keys) {
          const real = map[normalize(k)];
          if (real != null) return row[real];
        }
        return "";
      };
      const toDate = (v: any) => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };
      const toNum = (v: any) => {
        if (v === "" || v == null) return 0;
        if (typeof v === "number") return v;
        return Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
      };

      const payload = json.map((r) => {
        const ultima = toDate(get(r, "Última Recarga", "Ultima Recarga"));
        return {
          proprietario: String(get(r, "Proprietário", "Proprietario", "Nome") || "").trim(),
          numero: String(get(r, "Número", "Numero", "Telefone") || "").trim() || null,
          situacao: String(get(r, "Situação", "Situacao", "Status") || "").trim() || null,
          setor: String(get(r, "Setor", "Departamento") || "").trim() || null,
          ultima_recarga: ultima,
          proxima_recarga: addDays(ultima, days) || toDate(get(r, "Próxima Recarga", "Proxima Recarga")),
          valor: toNum(get(r, "Valor")),
          verificado: (() => { const v = String(get(r, "Verificado") || "").trim().toLowerCase(); return v === "sim" || v === "yes" || v === "true" ? "Sim" : "Não"; })(),
        };
      }).filter((r) => r.proprietario);

      if (!payload.length) return toast.error("Nenhuma linha válida");
      const { error } = await supabase.from("recargas_celulares").insert(payload);
      if (error) throw error;
      toast.success(`${payload.length} linhas importadas`);
      load();
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-6 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Recargas <span className="text-muted-foreground">·</span> Celulares
          </h2>
          <p className="text-sm text-muted-foreground">
            Fila de solicitações dos colaboradores, por ordem de pedido
          </p>
        </div>
        {/* Cadastro de linha continua acessível aqui — a tela é uma só, sem abas. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setEditingId(null); setForm({ ...empty }); setOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Nova linha
          </Button>
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <Upload className="mr-1.5 h-4 w-4" /> Importar Excel
              <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={importExcel} />
            </label>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="mr-1.5 h-4 w-4" /> Próxima: {days}d
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <Label>Dias para próxima recarga</Label>
              <Input
                type="number"
                min={1}
                value={days}
                onChange={(e) => saveDays(Math.max(1, Number(e.target.value) || 1))}
              />
              <Button size="sm" className="w-full" onClick={recomputeAll}>
                Recalcular para todos
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Linhas cadastradas — o parque de celulares. Continua na mesma tela, abaixo
          da fila: é consulta frequente e sumiria se virasse outra aba. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {/* As abas são o eixo principal do trabalho do Financeiro: começa em
              Pendentes, que é a fila do dia. */}
          <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
            {(
              [
                ["pendentes", "Pendentes", porAba.pendentes.length],
                ["feitas", "Feitas", porAba.feitas.length],
                ["todas", "Todas", porAba.todas.length],
              ] as const
            ).map(([id, rotulo, n]) => (
              <button
                key={id}
                onClick={() => setAba(id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  aba === id
                    ? id === "pendentes"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : id === "feitas"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {rotulo} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou número…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              {(
                [
                  ["cards", LayoutGrid, "Ver em cards"],
                  ["lista", List, "Ver em lista"],
                ] as const
              ).map(([v, Icone, titulo]) => (
                <button
                  key={v}
                  onClick={() => salvarVisao(v)}
                  title={titulo}
                  className={cn(
                    "rounded p-1.5 transition",
                    visao === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icone className="h-4 w-4" />
                </button>
              ))}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 h-4 w-4" /> Filtros
                  {(filtSit !== "__all" || filtSetor !== "__all" || filtVer !== "__all" || periodo.from || periodo.to) && (
                    <span className="ml-1 rounded bg-primary/10 px-1.5 text-xs text-primary">on</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3">
                <div>
                  <Label>Situação do chip</Label>
                  <Select value={filtSit} onValueChange={setFiltSit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Todas</SelectItem>
                      {situacoes.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Setor</Label>
                  <Select value={filtSetor} onValueChange={setFiltSetor}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Todos</SelectItem>
                      {setores.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Verificado</Label>
                  <Select value={filtVer} onValueChange={setFiltVer}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Todos</SelectItem>
                      {VERIFICADO_OPTS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* Período fica recolhido numa linha e só abre ao ser clicado. */}
                <div className="border-t pt-4">
                  <CalendarDateFuture
                    dateLabel="Período"
                    value={periodo}
                    onSelectDate={setPeriodo}
                    presets={PRESETS_SOLICITACAO}
                    placeholder="Solicitação ou recarga"
                  />
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setFiltSit("__all");
                    setFiltSetor("__all");
                    setFiltVer("__all");
                    setPeriodo({});
                  }}
                >
                  Limpar filtros
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {visao === "cards" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((r) => {
            const sit = situacaoChip(r.situacao);
            const stRecarga = statusRecarga(r);
            const dias = diasAte(r.proxima_recarga);
            const verificado = (r.verificado || "Não") === "Sim";
            return (
              <div
                key={r.id}
                className="rounded-lg border border-border bg-card p-3.5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
                        colorFor(r.proprietario || ""),
                      )}
                    >
                      {initials(r.proprietario || "")}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold leading-tight">
                        {r.proprietario || "—"}
                      </div>
                      <div className="truncate text-[10.5px] text-muted-foreground">
                        {r.setor || "Colaborador"}
                      </div>
                    </div>
                  </div>
                  {/* Veio da fila do TakeatOS: mostra a posição em vez do prazo, porque
                      o que importa nesse card é a ordem de atendimento. */}
                  {r.solicitacao_id && (
                    <Badge
                      variant="outline"
                      className="h-5 shrink-0 gap-1 rounded-full border-rose-500/30 bg-rose-500/10 px-2 text-[10.5px] text-rose-600 dark:text-rose-400"
                      title="Solicitação vinda do TakeatOS"
                    >
                      {r.posicao_do_dia ? `${r.posicao_do_dia}º da fila` : "Solicitada"}
                    </Badge>
                  )}
                  {/* Atrasada em vermelho: é a linha que o Financeiro tem de puxar primeiro. */}
                  {!r.solicitacao_id && dias !== null && (
                    <Badge
                      variant="outline"
                      title={`Próxima recarga: ${fmtDataBR(r.proxima_recarga)}`}
                      className={cn(
                        "h-5 shrink-0 gap-1 rounded-full px-2 text-[10.5px]",
                        dias < 0 && "border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400",
                      )}
                    >
                      <Clock className="h-3 w-3" />
                      {dias < 0 ? `${Math.abs(dias)}d atrás` : `${dias}d`}
                    </Badge>
                  )}
                </div>

                <div className="mt-3 flex items-start gap-1.5">
                  <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12.5px] font-medium leading-tight">
                      {r.numero || "—"}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {verificado ? (
                        <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Verificado</>
                      ) : (
                        "Não verificado"
                      )}
                    </div>
                  </div>
                  {/* Situação do chip cola no número: é o estado daquela linha
                      telefônica, não do pedido de recarga. */}
                  <Select value={sit} onValueChange={(v) => mudarSituacao(r, v)}>
                    <SelectTrigger
                      className={cn(
                        "h-6 w-[104px] shrink-0 rounded-full border px-2.5 text-[10.5px]",
                        SITUACAO_CLS[sit] || SITUACAO_CLS.Ativo,
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {situacoes.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* As duas datas do card: quando pediram e quando a recarga foi feita.
                    A da esquerda chega junto com a solicitação; a da direita só existe
                    depois de marcada como feita. "Próxima recarga" vive no selo do topo. */}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <div className="flex-1 rounded-md border border-border bg-background px-2 py-1">
                    <div className="text-[9.5px] uppercase tracking-wide text-muted-foreground">
                      Solicitada
                    </div>
                    <div className="flex items-center gap-1 text-[11.5px]">
                      <CalIcon className="h-3 w-3 text-muted-foreground" />
                      {r.solicitado_em ? fmtDataBR(String(r.solicitado_em).slice(0, 10)) : "—"}
                    </div>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground">→</span>
                  <div className="flex-1 rounded-md border border-border bg-background px-2 py-1">
                    <div className="text-[9.5px] uppercase tracking-wide text-muted-foreground">
                      Feita
                    </div>
                    <div className="flex items-center gap-1 text-[11.5px]">
                      <CalIcon className="h-3 w-3 text-muted-foreground" />
                      {fmtDataBR(r.ultima_recarga)}
                    </div>
                  </div>
                </div>

                {r.solicitado_em && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <RefreshCw className="h-3 w-3" />
                    Solicitado em {fmtDataHoraBR(r.solicitado_em)}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                  <div>
                    <div className="text-base font-bold leading-none">{fmtBRL(Number(r.valor || 0))}</div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground">por recarga</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Status da recarga é consequência das datas, então é só leitura:
                        quem o move é o botão de marcar como feita. */}
                    <Badge
                      variant="outline"
                      className={cn("h-6 rounded-full px-2 text-[10.5px]", STATUS_RECARGA_CLS[stRecarga])}
                    >
                      {stRecarga}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn(
                        "h-7 w-7",
                        stRecarga === "Feito"
                          ? "text-muted-foreground hover:text-foreground"
                          : "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400",
                      )}
                      onClick={() => (r.solicitacao_id ? alternarSolicitacao(r) : alternarFeita(r))}
                      title={
                        stRecarga === "Feito"
                          ? "Desfazer — voltar para pendente"
                          : "Marcar recarga como feita hoje"
                      }
                    >
                      {stRecarga === "Feito" ? (
                        <Undo2 className="h-3.5 w-3.5" />
                      ) : (
                        <CheckIcon className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setHistorico(r)}
                      title="Histórico de recargas e titulares"
                    >
                      <ScrollText className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => (r.solicitacao_id ? editarLinhaDaSolicitacao(r) : abrirEdicao(r))}
                      title={r.solicitacao_id ? "Editar a linha deste número" : "Editar"}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => (r.solicitacao_id ? cancelarSolicitacao(r) : remove(r.id))}
                      title={r.solicitacao_id ? "Cancelar a solicitação" : "Excluir"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          {!visiveis.length && (
            <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
              {VAZIO[aba]}
            </p>
          )}
        </div>
        )}

        {visao === "lista" && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">Colaborador</th>
                  <th className="px-3 py-2 font-medium">Número</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Setor</th>
                  <th className="px-3 py-2 font-medium">Solicitada</th>
                  <th className="px-3 py-2 font-medium">Feita</th>
                  <th className="px-3 py-2 font-medium">Próxima</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-center font-medium">Recarga</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((r) => {
                  const st = statusRecarga(r);
                  const d = diasAte(r.proxima_recarga);
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{r.proprietario || "—"}</td>
                      <td className="px-3 py-2 font-mono text-[13px]">{r.numero || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn("rounded-full px-2 text-[10.5px]", SITUACAO_CLS[situacaoChip(r.situacao)] || SITUACAO_CLS.Ativo)}
                        >
                          {situacaoChip(r.situacao)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.setor || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.solicitado_em ? fmtDataBR(String(r.solicitado_em).slice(0, 10)) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDataBR(r.ultima_recarga)}</td>
                      {/* Atrasada em vermelho, mesma regra do selo no card. */}
                      <td className={cn("px-3 py-2", d !== null && d < 0 ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                        {fmtDataBR(r.proxima_recarga)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{fmtBRL(Number(r.valor || 0))}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className={cn("rounded-full px-2 text-[10.5px]", STATUS_RECARGA_CLS[st])}>
                          {st}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn("h-7 w-7", st === "Feito" ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400")}
                            onClick={() => (r.solicitacao_id ? alternarSolicitacao(r) : alternarFeita(r))}
                            title={
                              r.solicitacao_id
                                ? st === "Feito"
                                  ? "Voltar para pendente e avisar o TakeatOS"
                                  : "Concluir a solicitação e avisar o TakeatOS"
                                : st === "Feito"
                                  ? "Desfazer — voltar para pendente"
                                  : "Marcar recarga como feita hoje"
                            }
                          >
                            {st === "Feito" ? <Undo2 className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setHistorico(r)}
                            title="Histórico de recargas e titulares"
                          >
                            <ScrollText className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => (r.solicitacao_id ? editarLinhaDaSolicitacao(r) : abrirEdicao(r))}
                            title={r.solicitacao_id ? "Editar a linha deste número" : "Editar"}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => (r.solicitacao_id ? cancelarSolicitacao(r) : remove(r.id))}
                            title={r.solicitacao_id ? "Cancelar a solicitação" : "Excluir"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visiveis.length && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                      {VAZIO[aba]}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>



      <HistoricoChip
        linhaId={historico?.id ?? null}
        titulo={historico?.proprietario ?? undefined}
        numero={historico?.numero ?? undefined}
        onOpenChange={(v) => !v && setHistorico(null)}
      />

      <Dialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setEditingId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar celular" : "Novo celular"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Proprietário</Label>
              <LibAutofillInput
                value={form.proprietario}
                onChange={(v) => setForm({ ...form, proprietario: v })}
                onMatch={(m) => { if (m && (m as any).setor) setForm((f) => ({ ...f, setor: (m as any).setor })); }}
              />
            </div>
            <div><Label>Número</Label><Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
            <div>
              <Label>Situação</Label>
              <Select value={form.situacao} onValueChange={(v) => setForm({ ...form, situacao: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{situacoes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Setor</Label>
              <Select value={form.setor} onValueChange={(v) => setForm({ ...form, setor: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{setores.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Valor</Label><InputMoeda value={form.valor} onChange={(v) => setForm({ ...form, valor: v === "" ? "" : String(v) })} /></div>
            <div><Label>Última Recarga</Label><Input type="date" value={form.ultima_recarga} onChange={(e) => setForm({ ...form, ultima_recarga: e.target.value })} /></div>
            <div>
              <Label>Verificado</Label>
              <Select value={form.verificado} onValueChange={(v) => setForm({ ...form, verificado: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VERIFICADO_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 text-xs text-muted-foreground">
              Próxima recarga será calculada automaticamente: {addDays(form.ultima_recarga || null, days) || "—"} ({days} dias)
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditingId(null); }}>Cancelar</Button>
            <Button onClick={salvar}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
