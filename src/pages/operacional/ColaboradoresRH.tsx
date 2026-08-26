import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Users, Columns3, Filter, FilterX, X,
  ChevronLeft, ChevronRight, Copy, Receipt, PanelRightOpen, Maximize2,
  UserPlus, UserMinus, CalendarClock, Building2, FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import CadastrarNoOmieDialog from "./CadastrarNoOmieDialog";
import PreviaFolhaDialog from "./PreviaFolhaDialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { tabelaFolha } from "@/lib/folha/db";
import {
  montarLote, type ColaboradorDaFolha, type ResolveDePara,
} from "../../../supabase/functions/_shared/folha-envio";

/* ─────────────────────────── Tipos ───────────────────────────
   Espelho somente-leitura da tabela `rh_colaboradores`, sincronizada
   automaticamente a partir do Portal RH. O que muda lá reflete aqui
   a cada ciclo de sincronização — nada nesta tela edita dados. */

type Colaborador = Record<string, string | number | boolean | null> & {
  id: string;
  synced_at: string;
};

/* ─────────────────────────── Formatadores ─────────────────────────── */

const BRL = (n: unknown) =>
  n === null || n === undefined || n === ""
    ? "—"
    : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtDate = (s: unknown) => {
  if (!s || typeof s !== "string") return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
};

const fmtDateTime = (s: unknown) =>
  !s || typeof s !== "string" ? "—" : new Date(s).toLocaleString("pt-BR");

const fmtCnpj = (c: unknown) => {
  if (!c || typeof c !== "string") return "—";
  const d = c.replace(/\D/g, "");
  if (d.length !== 14) return c;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const fmtCpf = (c: unknown) => {
  if (!c || typeof c !== "string") return "—";
  const d = c.replace(/\D/g, "").padStart(11, "0");
  if (d.length !== 11) return c;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const txt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const boolTxt = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "—");

/* ─────────────────────────── Cálculo proporcional ───────────────────────────
   Regra: mês comercial de 30 dias. Dias trabalhados no mês do desligamento =
   dia do desligamento (ou desde o início, se a pessoa entrou no mesmo mês).
   Proporcional = (valor mensal / 30) × dias. Soma-se a liberalidade, se houver. */

const parseISO = (s: unknown): Date | null => {
  if (!s || typeof s !== "string") return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

function tempoDeCasa(inicio: Date, fim: Date): string {
  let meses = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth());
  if (fim.getDate() < inicio.getDate()) meses -= 1;
  meses = Math.max(0, meses);
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anos === 0) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  return `${anos} ${anos === 1 ? "ano" : "anos"}${resto ? ` e ${resto} ${resto === 1 ? "mês" : "meses"}` : ""}`;
}

function calculoProporcional(c: Colaborador) {
  const inicio = parseISO(c.inicio);
  const desl = parseISO(c.datadesl);
  const valor = Number(c.valor) || 0;
  if (!desl || !valor) return null;
  const mesmoMes =
    inicio &&
    inicio.getFullYear() === desl.getFullYear() &&
    inicio.getMonth() === desl.getMonth();
  const dias = Math.min(30, Math.max(1, mesmoMes ? desl.getDate() - inicio!.getDate() + 1 : desl.getDate()));
  const proporcional = (valor / 30) * dias;
  const liberalidade = Number(c.valor_liberalidade) || 0;
  return { valor, dias, proporcional, liberalidade, total: proporcional + liberalidade };
}

/* ─────────────────────────── Catálogo de colunas ───────────────────────────
   Todas as colunas do espelho do RH, na ordem do painel de Dados PJ.
   `def: true` = visível por padrão; o resto fica disponível no seletor. */

type Col = {
  key: string;
  label: string;
  fmt?: (v: unknown) => string;
  def?: boolean;
  num?: boolean;
  /** Coluna sem funil no cabeçalho (não há o que filtrar — foto, por exemplo). */
  semFiltro?: boolean;
};

// As mesmas 54 colunas da tela "Dados PJs" do Portal RH, na mesma ordem.
const COLS: Col[] = [
  { key: "id", label: "ID" },
  { key: "codigo", label: "Código", def: true },
  { key: "foto_url", label: "Foto", def: true, semFiltro: true },
  { key: "nome", label: "Nome", def: true },
  { key: "cpf", label: "CPF", fmt: fmtCpf },
  { key: "rg", label: "RG" },
  { key: "nascimento", label: "Nascimento", fmt: fmtDate },
  { key: "estadocivil", label: "Estado civil" },
  { key: "genero", label: "Gênero" },
  { key: "naturalidade", label: "Naturalidade" },
  { key: "camisa", label: "Camisa" },
  { key: "emailcorp", label: "E-mail corporativo" },
  { key: "emailpessoal", label: "E-mail pessoal" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "whatsappcorp", label: "WhatsApp corporativo" },
  { key: "cep", label: "CEP" },
  { key: "logradouro", label: "Logradouro" },
  { key: "numero", label: "Número" },
  { key: "complemento", label: "Complemento" },
  { key: "bairro", label: "Bairro" },
  { key: "cidade", label: "Cidade" },
  { key: "estado", label: "Estado" },
  { key: "modalidade", label: "Modalidade", def: true },
  { key: "trabalho", label: "Trabalho" },
  { key: "setor", label: "Setor", def: true },
  { key: "cargo", label: "Cargo", def: true },
  { key: "razao", label: "Razão social", def: true },
  { key: "cnpj", label: "CNPJ", fmt: fmtCnpj, def: true },
  { key: "valor", label: "Valor", fmt: BRL, num: true, def: true },
  { key: "modelo_remuneracao", label: "Modelo remuneração" },
  { key: "descricao_funcao", label: "Descrição da função" },
  { key: "min_garantido_m1", label: "Mín. garantido 1º mês", fmt: BRL, num: true },
  { key: "min_garantido_m2", label: "Mín. garantido 2º mês", fmt: BRL, num: true },
  { key: "min_garantido_m3", label: "Mín. garantido 3º mês", fmt: BRL, num: true },
  { key: "inicio", label: "Início", fmt: fmtDate },
  { key: "vence", label: "Vencimento", fmt: fmtDate },
  { key: "obs", label: "Observações" },
  { key: "flash", label: "Flash", fmt: BRL, num: true },
  { key: "totalpass", label: "Totalpass" },
  { key: "banco", label: "Banco" },
  { key: "codbanco", label: "Cód. banco" },
  { key: "agencia", label: "Agência" },
  { key: "digito", label: "Dígito" },
  { key: "conta", label: "Conta" },
  { key: "pix", label: "PIX", def: true },
  { key: "tipodesl", label: "Tipo desligamento" },
  { key: "datadesl", label: "Data desligamento", fmt: fmtDate },
  { key: "motivodesl", label: "Motivo desligamento" },
  { key: "obsdesl", label: "Obs. desligamento" },
  { key: "valor_liberalidade", label: "Valor liberalidade", fmt: BRL, num: true },
  { key: "emergencia_nome", label: "Emergência — nome" },
  { key: "emergencia_parentesco", label: "Emergência — parentesco" },
  { key: "emergencia_whatsapp", label: "Emergência — WhatsApp" },
  { key: "contrato_enviado_em", label: "Contrato enviado em", fmt: fmtDateTime },
  // Campos extras do banco do RH (não aparecem na tela Dados PJs, mas existem lá):
  { key: "aditivo_novo_valor", label: "Aditivo — novo valor", fmt: BRL, num: true },
  { key: "aditivo_vigencia", label: "Aditivo — vigência", fmt: fmtDate },
  { key: "aditivo_alteracao_escopo", label: "Aditivo — muda escopo", fmt: boolTxt },
  { key: "aditivo_novo_cargo", label: "Aditivo — novo cargo" },
  { key: "aditivo_denominacao", label: "Aditivo — denominação" },
  { key: "aditivo_atividades", label: "Aditivo — atividades" },
  { key: "created_at", label: "Criado no RH em", fmt: fmtDateTime },
  { key: "updated_at", label: "Atualizado no RH em", fmt: fmtDateTime },
];

// Fotos: cópia privada no bucket `rh-fotos` deste projeto. Só usuários
// logados enxergam (links assinados por sessão) — nada é público.
const FOTOS_BUCKET = "rh-fotos";

const STORAGE_KEY = "colabrh:colunas-visiveis";
const FILTROS_KEY = "colabrh:filtros";
const DENSIDADE_KEY = "colabrh:densidade";
const DEFAULT_VISIVEIS = new Set(COLS.filter((c) => c.def).map((c) => c.key));

const ativo = (c: Colaborador) => !c.datadesl;

/* ─────────────────────────── Vocabulário visual ───────────────────────────
   Que forma cada coluna toma na tabela. Documento, data e conta saem em
   monoespaçada (o olho compara dígito com dígito); o que é categoria vira
   etiqueta. Dinheiro não entra aqui: `col.num` já resolve. */

const MONO_KEYS = new Set([
  "codigo", "cpf", "cnpj", "rg", "cep", "pix", "conta", "agencia", "digito", "codbanco",
  "whatsapp", "whatsappcorp", "nascimento", "inicio", "vence", "datadesl",
  "contrato_enviado_em", "created_at", "updated_at", "aditivo_vigencia",
]);

const PILL_KEYS = new Set([
  "modalidade", "setor", "trabalho", "estadocivil", "genero", "camisa",
  "tipodesl", "modelo_remuneracao", "totalpass",
]);

/* Paleta categórica só do avatar de quem não tem foto. A cor sai do nome,
   então a mesma pessoa é sempre da mesma cor — vira ponto de referência ao
   correr a lista com o olho. */
const CORES_AVATAR = [
  "hsl(0 72% 30%)", "hsl(0 65% 22%)", "hsl(0 78% 47%)", "hsl(212 80% 45%)",
  "hsl(152 60% 36%)", "hsl(38 92% 40%)", "hsl(220 12% 32%)", "hsl(0 78% 40%)",
];

const corDoNome = (nome: string) => {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return CORES_AVATAR[h % CORES_AVATAR.length];
};

const iniciaisDe = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";

/* ─────────────────────────── Mês de referência ───────────────────────────
   O espelho guarda o estado de hoje, não uma série histórica — por isso o mês
   escolhido não recorta a tabela inteira, só responde três perguntas: quem
   entrou, quem saiu e que contrato vence nele. */

const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

/** A data ISO cai no mês/ano de referência? */
const noMes = (iso: unknown, ano: number, mes: number) => {
  const d = parseISO(iso);
  return !!d && d.getFullYear() === ano && d.getMonth() === mes;
};

/* ─────────────────────────── Busca livre ───────────────────────────
   "pedro" tem de trazer o Pedro, não quem mora na Rua São Pedro. A busca varre
   primeiro o que identifica a pessoa (nome, código, documento, contato, cargo)
   e só abre para as outras colunas se isso não devolver ninguém — e aí a tela
   diz onde casou. Cada palavra digitada precisa bater, acento não conta e
   documento casa por dígito, então "57.765" acha o CNPJ escrito na tela. */

const CHAVES_PRINCIPAIS = [
  "nome", "codigo", "razao", "cargo", "setor", "modalidade", "trabalho",
  "cpf", "cnpj", "emailcorp", "emailpessoal", "whatsapp", "whatsappcorp", "pix",
];

// A busca ampliada pega o resto — menos o que só tem ruído (caminho da foto e id).
const SEM_BUSCA = new Set(["foto_url", "id"]);
const CHAVES_TODAS = COLS.map((c) => c.key).filter((k) => !SEM_BUSCA.has(k));

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const soDigitos = (s: string) => s.replace(/\D/g, "");

const termosDe = (q: string) => semAcento(q.trim()).split(/\s+/).filter(Boolean);

/** O termo começa uma palavra do valor? "faro" em "Mastelo Faro" sim, em "farofa" também. */
function inicioDePalavra(valor: string, termo: string) {
  for (let i = valor.indexOf(termo); i !== -1; i = valor.indexOf(termo, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(valor[i - 1])) return true;
  }
  return false;
}

/** Peso do termo nesta linha; 0 = não casou. Nome pesa mais que o resto. */
function pontuaTermo(c: Colaborador, termo: string, chaves: string[]): number {
  const digitos = soDigitos(termo);
  let melhor = 0;
  for (const key of chaves) {
    const cru = c[key];
    if (cru === null || cru === undefined || cru === "") continue;
    const valor = semAcento(String(cru));
    const peso = key === "nome" ? 6 : key === "codigo" || key === "razao" ? 4 : 2;
    if (valor.includes(termo)) {
      melhor = Math.max(
        melhor,
        peso + (inicioDePalavra(valor, termo) ? 2 : 0) + (valor.startsWith(termo) ? 1 : 0),
      );
    } else if (digitos.length >= 3 && soDigitos(valor).includes(digitos)) {
      melhor = Math.max(melhor, peso);
    }
  }
  return melhor;
}

/** Linhas em que TODOS os termos casaram, mais relevante primeiro. */
function buscarEm(base: Colaborador[], termos: string[], chaves: string[]) {
  const achados: { c: Colaborador; peso: number }[] = [];
  for (const c of base) {
    let peso = 0;
    for (const t of termos) {
      const p = pontuaTermo(c, t, chaves);
      if (!p) { peso = 0; break; }
      peso += p;
    }
    if (peso) achados.push({ c, peso });
  }
  achados.sort(
    (a, b) =>
      b.peso - a.peso ||
      String(a.c.nome ?? "").localeCompare(String(b.c.nome ?? ""), "pt-BR"),
  );
  return achados.map((a) => a.c);
}

/** Busca com rede: se o essencial não achar ninguém, abre para todas as colunas. */
function buscarComFallback(base: Colaborador[], termos: string[]) {
  if (!termos.length) return { linhas: base, ampliada: false, colunas: [] as string[] };

  const principal = buscarEm(base, termos, CHAVES_PRINCIPAIS);
  if (principal.length) return { linhas: principal, ampliada: false, colunas: [] as string[] };

  const amplo = buscarEm(base, termos, CHAVES_TODAS);
  const colunas = COLS.filter(
    (col) =>
      !SEM_BUSCA.has(col.key) &&
      amplo.some((c) => {
        const v = c[col.key];
        if (v === null || v === undefined || v === "") return false;
        const valor = semAcento(String(v));
        return termos.some((t) => valor.includes(t));
      }),
  ).map((col) => col.label);

  return { linhas: amplo, ampliada: amplo.length > 0, colunas };
}

/* ─────────────────────────── Filtros por coluna ───────────────────────────
   Cada coluna guarda a lista de valores escolhidos (conjunto vazio = coluna
   sem filtro, mostra tudo). Colunas de dinheiro ganham também uma faixa
   de/até. A chave de um valor é sempre o dado cru em texto — o rótulo na
   tela passa pelo formatador da coluna. */

type Faixa = { min: string; max: string };
type Filtros = Record<string, Set<string>>;
type FaixasMap = Record<string, Faixa>;

/** Valor cru da célula, em texto — vazio/nulo viram "" (a opção "(vazio)"). */
const chaveDe = (c: Colaborador, key: string) => {
  const v = c[key];
  return v === null || v === undefined || v === "" ? "" : String(v);
};

const rotuloDeChave = (col: Col, chave: string) => {
  if (chave === "") return "(vazio)";
  if (col.fmt === boolTxt) return chave === "true" ? "Sim" : "Não";
  return String((col.fmt ?? txt)(chave));
};

const faixaVazia = (f?: Faixa) => !f || (f.min.trim() === "" && f.max.trim() === "");

const resumoFaixa = (col: Col, f: Faixa) => {
  const fmtN = (s: string) => String((col.fmt ?? txt)(s));
  if (f.min.trim() !== "" && f.max.trim() !== "") return `${fmtN(f.min)} – ${fmtN(f.max)}`;
  return f.min.trim() !== "" ? `≥ ${fmtN(f.min)}` : `≤ ${fmtN(f.max)}`;
};

function lerFiltrosSalvos(): { filtros: Filtros; faixas: FaixasMap } {
  try {
    const raw = localStorage.getItem(FILTROS_KEY);
    if (!raw) return { filtros: {}, faixas: {} };
    const parsed = JSON.parse(raw) as {
      filtros?: Record<string, string[]>;
      faixas?: Record<string, Faixa>;
    };
    const filtros: Filtros = {};
    for (const [k, v] of Object.entries(parsed.filtros ?? {})) {
      if (Array.isArray(v) && v.length) filtros[k] = new Set(v);
    }
    const faixas: FaixasMap = {};
    for (const [k, v] of Object.entries(parsed.faixas ?? {})) {
      if (v && !faixaVazia(v)) faixas[k] = { min: String(v.min ?? ""), max: String(v.max ?? "") };
    }
    return { filtros, faixas };
  } catch {
    return { filtros: {}, faixas: {} };
  }
}

/* ─────────────────────────── Página ─────────────────────────── */

export default function ColaboradoresRH() {
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<"ativos" | "desligados" | "todos">("ativos");
  const [fotoAberta, setFotoAberta] = useState<{ url: string; nome: string } | null>(null);
  const [selecionado, setSelecionado] = useState<Colaborador | null>(null);
  const [fichaCheia, setFichaCheia] = useState(false);
  const [densidade, setDensidade] = useState<"compacta" | "confortavel">(
    () => (localStorage.getItem(DENSIDADE_KEY) === "compacta" ? "compacta" : "confortavel"),
  );
  const [mesRef, setMesRef] = useState(() => {
    const hoje = new Date();
    return { ano: hoje.getFullYear(), mes: hoje.getMonth() };
  });
  const [movFiltro, setMovFiltro] = useState<"entraram" | "sairam" | "vencendo" | null>(null);
  const [cadastrarOmie, setCadastrarOmie] = useState(false);
  const [previaFolha, setPreviaFolha] = useState(false);
  /* O de-para traz departamento e o salário corrigido. Sem ele a faixa somaria
     o espelho cru do RH — que é o número errado desde que existem ajustes. */
  const [dePara, setDePara] = useState<Map<string, {
    departamento: string; categoria: string;
    valorAjustado: number | null; documentoAjustado: string | null;
  }>>(new Map());
  const [visiveis, setVisiveis] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* usa o padrão */ }
    return new Set(DEFAULT_VISIVEIS);
  });
  const [filtros, setFiltros] = useState<Filtros>(() => lerFiltrosSalvos().filtros);
  const [faixas, setFaixas] = useState<FaixasMap>(() => lerFiltrosSalvos().faixas);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...visiveis]));
  }, [visiveis]);

  useEffect(() => {
    const f: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(filtros)) if (v.size) f[k] = [...v];
    const fx: Record<string, Faixa> = {};
    for (const [k, v] of Object.entries(faixas)) if (!faixaVazia(v)) fx[k] = v;
    localStorage.setItem(FILTROS_KEY, JSON.stringify({ filtros: f, faixas: fx }));
  }, [filtros, faixas]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["rh_colaboradores"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rh_colaboradores")
        .select("*")
        .order("nome", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Colaborador[];
    },
    // Mantém a aba viva: rebusca o espelho a cada minuto, alinhado ao pg_cron.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const todos = useMemo(() => data ?? [], [data]);

  // Links assinados das fotos (válidos por 1h, renovados sozinhos): gerados
  // em lote com a sessão do usuário — quem não está logado não obtém nada.
  const { data: fotoUrls } = useQuery({
    queryKey: ["rh_fotos", todos.length, todos[0]?.synced_at ?? ""],
    enabled: todos.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async () => {
      const paths = [...new Set(todos.map((c) => c.foto_url).filter(Boolean))] as string[];
      if (paths.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase.storage
        .from(FOTOS_BUCKET)
        .createSignedUrls(paths, 3600);
      if (error) return {} as Record<string, string>;
      const map: Record<string, string> = {};
      for (const d of data ?? []) {
        if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
      }
      return map;
    },
  });

  const ativos = useMemo(() => todos.filter(ativo), [todos]);
  const desligados = useMemo(() => todos.filter((c) => !ativo(c)), [todos]);

  useEffect(() => {
    localStorage.setItem(DENSIDADE_KEY, densidade);
  }, [densidade]);

  useEffect(() => {
    let vivo = true;
    tabelaFolha("folha_depara")
      .select("codigo_rh, departamento, categoria_descricao, valor_ajustado, documento_ajustado")
      .then(({ data }) => {
        if (!vivo) return;
        const m = new Map<string, {
          departamento: string; categoria: string;
          valorAjustado: number | null; documentoAjustado: string | null;
        }>();
        for (const d of (data ?? []) as Record<string, unknown>[]) {
          m.set(String(d.codigo_rh), {
            departamento: String(d.departamento ?? ""),
            categoria: String(d.categoria_descricao ?? ""),
            valorAjustado: d.valor_ajustado === null || d.valor_ajustado === undefined
              ? null : Number(d.valor_ajustado),
            documentoAjustado: (d.documento_ajustado as string) ?? null,
          });
        }
        setDePara(m);
      });
    return () => { vivo = false; };
  }, []);

  // Fechou a ficha lateral? A versão em tela cheia fecha junto.
  useEffect(() => {
    if (!selecionado) setFichaCheia(false);
  }, [selecionado]);

  /* ── Mês de referência ── */
  const moverMes = (delta: number) =>
    setMesRef(({ ano, mes }) => {
      const d = new Date(ano, mes + delta, 1);
      return { ano: d.getFullYear(), mes: d.getMonth() };
    });

  const rotuloMes = useMemo(
    () => new Date(mesRef.ano, mesRef.mes, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    [mesRef],
  );
  const mesCurto = MESES_CURTOS[mesRef.mes];
  const ehMesCorrente =
    mesRef.ano === new Date().getFullYear() && mesRef.mes === new Date().getMonth();

  /* O lote da competência escolhida, com a MESMA regra do provisionamento:
     salário corrigido quando existe, desligado fora, admissão rateada. Somar o
     espelho cru aqui daria um número que não bate com a prévia — e é a faixa
     que as pessoas olham de relance. */
  const lote = useMemo(() => {
    const pessoas: ColaboradorDaFolha[] = todos.map((c) => ({
      id: String(c.id),
      codigo: (c.codigo as string) ?? null,
      nome: String(c.nome ?? "").trim(),
      cnpj: (c.cnpj as string) ?? null,
      razao: (c.razao as string) ?? null,
      valor: Number(c.valor) || 0,
      inicio: (c.inicio as string) ?? null,
      datadesl: (c.datadesl as string) ?? null,
    }));
    const resolve: ResolveDePara = (codigo) => dePara.get(codigo) ?? null;
    return montarLote(pessoas, `${mesRef.ano}-${String(mesRef.mes + 1).padStart(2, "0")}`, resolve);
  }, [todos, dePara, mesRef]);

  /** O custo cheio do time hoje: salário integral de quem está no lote. */
  const folhaTotal = useMemo(
    () => lote.itens.reduce((s, i) => s + i.valorBase, 0),
    [lote],
  );

  /** Quanto vai por área, com quantas pessoas. Ordenado do maior para o menor. */
  const porArea = useMemo(() => {
    const m = new Map<string, { valor: number; n: number }>();
    for (const i of lote.itens) {
      const area = i.departamento || "(sem departamento)";
      const atual = m.get(area) ?? { valor: 0, n: 0 };
      m.set(area, { valor: atual.valor + i.valor, n: atual.n + 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].valor - a[1].valor);
  }, [lote]);

  const ajustados = useMemo(
    () => lote.itens.filter((i) => i.valorAjustado !== null).length,
    [lote],
  );

  /* O que o Hub corrigiu por cima do espelho, por pessoa.
   *
   * Aparece na linha, em vermelho, para virar recado ao DH: o Hub segue com a
   * folha, mas o cadastro de origem continua errado e vai voltar errado no
   * próximo sync. Sem isto, a correção do Hub esconde o problema em vez de
   * resolvê-lo — e ninguém nunca arruma a base de lá. */
  const divergencias = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of todos) {
      const d = dePara.get(String(c.codigo ?? ""));
      if (!d) continue;
      const avisos: string[] = [];
      if (d.valorAjustado !== null && Number(c.valor) !== d.valorAjustado) {
        avisos.push(`salário no RH ${BRL(Number(c.valor) || 0)}, correto ${BRL(d.valorAjustado)}`);
      }
      const docRh = String(c.cnpj ?? "").replace(/\D/g, "");
      if (d.documentoAjustado && docRh !== d.documentoAjustado) {
        avisos.push(`documento no RH ${docRh || "vazio"}, correto ${d.documentoAjustado}`);
      }
      if (avisos.length) m.set(String(c.id), avisos);
    }
    return m;
  }, [todos, dePara]);

  /** Quem entrou, quem saiu e que contrato vence no mês escolhido. */
  const mov = useMemo(() => {
    const entraram = new Set<string>();
    const sairam = new Set<string>();
    const vencendo = new Set<string>();
    for (const c of todos) {
      if (noMes(c.inicio, mesRef.ano, mesRef.mes)) entraram.add(c.id);
      if (noMes(c.datadesl, mesRef.ano, mesRef.mes)) sairam.add(c.id);
      if (ativo(c) && noMes(c.vence, mesRef.ano, mesRef.mes)) vencendo.add(c.id);
    }
    return { entraram, sairam, vencendo };
  }, [todos, mesRef]);

  const copiar = useCallback((valor: string, rotulo: string) => {
    if (!valor || valor === "—") {
      toast.error(`Sem ${rotulo} cadastrado`);
      return;
    }
    navigator.clipboard.writeText(valor).then(
      () => toast.success(`${rotulo} copiado`, { description: valor }),
      () => toast.error(`Não deu para copiar o ${rotulo}`),
    );
  }, []);

  const baseAba = useMemo(
    () => (aba === "ativos" ? ativos : aba === "desligados" ? desligados : todos),
    [aba, ativos, desligados, todos],
  );

  // Busca livre — os filtros de coluna entram depois dela.
  const termos = useMemo(() => termosDe(busca), [busca]);
  const { linhas: buscados, ampliada, colunas: colunasCasadas } = useMemo(
    () => buscarComFallback(baseAba, termos),
    [baseAba, termos],
  );

  /* Uma linha passa nos filtros de coluna. `exceto` deixa uma coluna de fora —
     é o que faz a lista de opções de um funil continuar mostrando as outras
     escolhas possíveis daquela coluna em vez de só as já marcadas. */
  const passaFiltros = useCallback(
    (c: Colaborador, exceto?: string) => {
      for (const [key, sel] of Object.entries(filtros)) {
        if (key === exceto || !sel.size) continue;
        if (!sel.has(chaveDe(c, key))) return false;
      }
      for (const [key, f] of Object.entries(faixas)) {
        if (key === exceto || faixaVazia(f)) continue;
        const n = Number(c[key]);
        if (f.min.trim() !== "" && (!Number.isFinite(n) || n < Number(f.min))) return false;
        if (f.max.trim() !== "" && (!Number.isFinite(n) || n > Number(f.max))) return false;
      }
      return true;
    },
    [filtros, faixas],
  );

  const filtrados = useMemo(
    () =>
      buscados.filter(
        (c) => passaFiltros(c) && (!movFiltro || mov[movFiltro].has(c.id)),
      ),
    [buscados, passaFiltros, movFiltro, mov],
  );

  /* Ligar "Saíram em ago" na aba Ativos não devolveria ninguém — o atalho
     abre a aba Todos junto, senão ele parece quebrado. */
  const alternarMov = (qual: "entraram" | "sairam" | "vencendo") => {
    const ligando = movFiltro !== qual;
    setMovFiltro(ligando ? qual : null);
    if (ligando && qual === "sairam") setAba("todos");
  };

  /* Quem a mesma busca acharia na outra aba. Sem isso, procurar alguém que já
     saiu enquanto a aba "Ativos" está aberta devolve nada e parece cadastro
     faltando — quando é só a aba errada. */
  const foraDaAba = useMemo(() => {
    if (!termos.length || aba === "todos") return 0;
    const naTela = new Set(filtrados.map((c) => c.id));
    return buscarComFallback(todos, termos).linhas.filter(
      (c) => !naTela.has(c.id) && passaFiltros(c),
    ).length;
  }, [termos, aba, todos, filtrados, passaFiltros]);

  const colunasAtivas = COLS.filter((c) => visiveis.has(c.key));

  // Etiquetas do que está filtrado — inclusive de coluna escondida, que de
  // outro modo tiraria linhas da tela sem nada explicando o porquê.
  const chips = useMemo(() => {
    const out: { id: string; label: string; resumo: string; limpar: () => void }[] = [];
    for (const col of COLS) {
      const sel = filtros[col.key];
      if (sel?.size) {
        out.push({
          id: `${col.key}:valores`,
          label: col.label,
          resumo: sel.size === 1 ? rotuloDeChave(col, [...sel][0]) : `${sel.size} valores`,
          limpar: () => setFiltros((p) => { const { [col.key]: _, ...resto } = p; return resto; }),
        });
      }
      const f = faixas[col.key];
      if (f && !faixaVazia(f)) {
        out.push({
          id: `${col.key}:faixa`,
          label: col.label,
          resumo: resumoFaixa(col, f),
          limpar: () => setFaixas((p) => { const { [col.key]: _, ...resto } = p; return resto; }),
        });
      }
    }
    return out;
  }, [filtros, faixas]);

  const temFiltro = chips.length > 0 || busca.trim() !== "" || movFiltro !== null;

  const limparTudo = () => {
    setFiltros({});
    setFaixas({});
    setBusca("");
    setMovFiltro(null);
  };

  const toggleColuna = (key: string) =>
    setVisiveis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleValor = (key: string, chave: string) =>
    setFiltros((prev) => {
      const next = new Set(prev[key] ?? []);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      if (!next.size) { const { [key]: _, ...resto } = prev; return resto; }
      return { ...prev, [key]: next };
    });


  const pad = densidade === "compacta" ? "py-1.5" : "py-[11px]";

  return (
    <div className="flex flex-col items-stretch gap-5 p-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">

        {/* ─── Cabeçalho: identidade da tela + mês de referência ─── */}
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-accent">
              <Users className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Colaboradores (Dados RH)</h1>
              <p className="text-[13.5px] text-muted-foreground">
                Espelho do painel Dados PJ do Portal RH — atualizado automaticamente; o que muda lá, muda aqui.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border bg-card">
              <button
                onClick={() => moverMes(-1)}
                title="Mês anterior"
                className="grid h-full w-8 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="flex h-full items-center gap-2 border-x px-3 text-[13.5px] font-semibold capitalize">
                {rotuloMes}
                {ehMesCorrente && (
                  <span className="rounded bg-pos/15 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-pos">
                    Mês corrente
                  </span>
                )}
              </span>
              <button
                onClick={() => moverMes(1)}
                title="Próximo mês"
                className="grid h-full w-8 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <span className="max-w-[200px] text-xs leading-snug text-muted-foreground">
              entradas, saídas e contratos vencendo seguem este mês
            </span>
          </div>
        </div>

        {/* ─── Faixa de resumo: o tamanho da folha e o movimento do mês ─── */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-4 rounded-xl border bg-card px-[18px] py-3.5">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Folha total mensal
            </p>
            <p
              className="num mt-1 text-[28px] font-medium leading-none"
              title={`Salário integral das ${lote.itens.length} pessoas da folha`
                + (ajustados ? `, com ${ajustados} valor(es) corrigido(s) no Hub` : "")}
            >
              {BRL(folhaTotal)}
            </p>
          </div>

          <div className="hidden h-11 w-px bg-border sm:block" />

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]">
            <Resumo rotulo="Ativos" valor={String(ativos.length)} />
            <Resumo rotulo={`Entraram em ${mesCurto}`} valor={`+${mov.entraram.size}`} tom={mov.entraram.size ? "pos" : undefined} />
            <Resumo rotulo={`Saíram em ${mesCurto}`} valor={`−${mov.sairam.size}`} tom={mov.sairam.size ? "neg" : undefined} />
            <HoverCard openDelay={120}>
              <HoverCardTrigger asChild>
                <div className="cursor-help">
                  <p className="text-muted-foreground underline decoration-dotted underline-offset-4">
                    Provisionar em {mesCurto}
                  </p>
                  <p className="num mt-0.5 font-semibold">{BRL(lote.total)}</p>
                </div>
              </HoverCardTrigger>
              <HoverCardContent align="start" className="w-80 p-0">
                <div className="flex items-baseline justify-between border-b px-3.5 py-2.5">
                  <span className="text-[12.5px] font-semibold">Folha por área</span>
                  <span className="text-[11px] text-muted-foreground">
                    competência {mesCurto}
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {porArea.map(([area, { valor, n }]) => (
                    <div key={area} className="flex items-baseline justify-between gap-3 px-3.5 py-1.5">
                      <span className="truncate text-[12.5px]">
                        {area}
                        <span className="ml-1.5 text-[11px] text-muted-foreground">{n}</span>
                      </span>
                      <span className="num flex-none text-[12.5px]">{BRL(valor)}</span>
                    </div>
                  ))}
                  {porArea.length === 0 && (
                    <p className="px-3.5 py-4 text-center text-xs text-muted-foreground">
                      Nada nesta competência.
                    </p>
                  )}
                </div>
                <div className="flex items-baseline justify-between border-t px-3.5 py-2">
                  <span className="text-[12.5px] font-semibold">Total</span>
                  <span className="num text-[13px] font-semibold">{BRL(lote.total)}</span>
                </div>
                {/* O total já desconta desligado e rateia admissão do meio do
                    mês, então ele é MENOR que o salário integral do time. */}
                {lote.total !== folhaTotal && (
                  <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
                    Menor que o salário integral porque quem entrou no meio do mês entra rateado
                    e quem saiu não entra — rescisão é paga à parte.
                  </p>
                )}
              </HoverCardContent>
            </HoverCard>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {todos.length > 0 && (
              <span className="text-xs text-muted-foreground">
                Sincronizado {fmtDateTime(todos[0].synced_at)}
              </span>
            )}
            <Button
              className="h-[38px] gap-2"
              onClick={() => setPreviaFolha(true)}
              title="Monta o lote da competência escolhida e mostra título a título. Nada é criado no Omie por esta tela."
            >
              <FileSpreadsheet className="size-4" />
              Provisionar folha
            </Button>
          </div>
        </div>

        {/* ─── O que o Hub corrige por cima do Portal RH ─── */}
        {divergencias.size > 0 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
            <p className="text-[12.5px] font-semibold text-destructive">
              {divergencias.size} cadastro(s) divergem do Portal RH
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A folha usa o valor corrigido aqui, então o pagamento sai certo. Mas a base do RH
              continua errada e volta assim no próximo sync — vale pedir ao DH para corrigir na
              origem. Cada linha mostra o que está diferente.
            </p>
            <button
              className="mt-1.5 text-xs text-primary hover:underline"
              onClick={() => {
                /* Texto pronto para colar numa mensagem. A lista existe para
                   sair daqui e chegar em quem edita a base, não para ficar
                   bonita na tela. */
                const linhas = todos
                  .filter((c) => divergencias.has(String(c.id)))
                  .map((c) => `• ${String(c.nome ?? "").trim()} (${txt(c.codigo)}): `
                    + divergencias.get(String(c.id))!.join("; "));
                const cabecalho =
                  `Divergências no cadastro do Portal RH (${new Date().toLocaleDateString("pt-BR")}):`;
                navigator.clipboard.writeText([cabecalho, "", ...linhas].join("\n")).then(
                  () => toast.success("Lista copiada — é só colar para o DH"),
                  () => toast.error("Não deu para copiar"),
                );
              }}
            >
              Copiar a lista para mandar ao DH
            </button>
          </div>
        )}

        {/* ─── Barra de ferramentas ─── */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Tabs value={aba} onValueChange={(v) => setAba(v as typeof aba)}>
            <TabsList>
              <TabsTrigger value="ativos">Ativos</TabsTrigger>
              <TabsTrigger value="desligados">Desligados</TabsTrigger>
              <TabsTrigger value="todos">Todos</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative w-[300px] min-w-[220px] max-w-full">
            <Search className="absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nome, código, documento…"
              title="Procura primeiro nos dados da pessoa (nome, código, cargo, documento, contato). Se não achar ninguém, amplia para todas as colunas e avisa onde casou."
              className="h-9 pl-9 text-[13.5px]"
            />
          </div>

          <PilulaMov
            ativa={movFiltro === "entraram"}
            tom="pos"
            icone={<UserPlus className="size-3.5" />}
            rotulo={`Entraram em ${mesCurto}`}
            n={mov.entraram.size}
            onClick={() => alternarMov("entraram")}
          />
          {todos.some((c) => mov.entraram.has(c.id) && ativo(c)) && (
            <Button
              variant="outline"
              size="sm"
              className="h-[30px] gap-1.5 rounded-full text-[12.5px]"
              onClick={() => setCadastrarOmie(true)}
              title={`Criar no Omie o fornecedor de quem entrou em ${mesCurto}, e gravar a chave PIX de quem estiver sem. Mostra a prévia antes de criar nada.`}
            >
              <Building2 className="size-3.5 text-muted-foreground" />
              Cadastrar no Omie
            </Button>
          )}

          <PilulaMov
            ativa={movFiltro === "sairam"}
            tom="neg"
            icone={<UserMinus className="size-3.5" />}
            rotulo={`Saíram em ${mesCurto}`}
            n={mov.sairam.size}
            onClick={() => alternarMov("sairam")}
          />
          <PilulaMov
            ativa={movFiltro === "vencendo"}
            tom="warn"
            icone={<CalendarClock className="size-3.5" />}
            rotulo="Contratos vencendo"
            n={mov.vencendo.size}
            onClick={() => alternarMov("vencendo")}
          />

          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
              {(["compacta", "confortavel"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDensidade(d)}
                  title={d === "compacta" ? "Mais linhas na tela" : "Linhas mais espaçadas"}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12.5px] transition-colors",
                    densidade === d
                      ? "bg-card font-medium text-foreground shadow-[var(--shadow-sm)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d === "compacta" ? "Compacta" : "Confortável"}
                </button>
              ))}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-[34px] gap-2">
                  <Columns3 className="size-[15px]" />
                  Colunas ({colunasAtivas.length}/{COLS.length})
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-0">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-sm font-medium">Mostrar colunas</span>
                  <div className="flex gap-2 text-xs">
                    <button className="text-primary hover:underline" onClick={() => setVisiveis(new Set(COLS.map((c) => c.key)))}>
                      Todas
                    </button>
                    <button className="text-primary hover:underline" onClick={() => setVisiveis(new Set(DEFAULT_VISIVEIS))}>
                      Padrão
                    </button>
                  </div>
                </div>
                <div className="grid max-h-80 grid-cols-1 gap-0.5 overflow-y-auto p-2">
                  {COLS.map((c) => (
                    <label
                      key={c.key}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                    >
                      <Checkbox checked={visiveis.has(c.key)} onCheckedChange={() => toggleColuna(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* ─── Contagem, etiquetas de filtro e avisos da busca ─── */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("tabular-nums", temFiltro ? "text-foreground" : "text-muted-foreground")}>
            <b className="text-foreground">{filtrados.length}</b>
            {temFiltro && <span className="text-muted-foreground"> de {baseAba.length}</span>}{" "}
            {filtrados.length === 1 ? "colaborador" : "colaboradores"}
            {chips.length > 0 && (
              <span className="text-muted-foreground"> · {chips.length} {chips.length === 1 ? "filtro" : "filtros"} de coluna</span>
            )}
          </span>

          {ampliada && (
            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
              <span>
                Nada nos dados da pessoa — casou em{" "}
                <span className="text-foreground">{colunasCasadas.slice(0, 3).join(", ")}</span>
                {colunasCasadas.length > 3 && ` +${colunasCasadas.length - 3}`}
              </span>
            </Badge>
          )}

          {foraDaAba > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setAba("todos")}
              title="Ver também quem está na outra aba"
            >
              +{foraDaAba} em {aba === "ativos" ? "Desligados" : "Ativos"}
            </Button>
          )}

          {chips.map((chip) => (
            <Badge key={chip.id} variant="secondary" className="gap-1 pr-1 font-normal">
              <span className="text-muted-foreground">{chip.label}:</span>
              <span className="max-w-[180px] truncate">{chip.resumo}</span>
              <button
                onClick={chip.limpar}
                title={`Remover o filtro de ${chip.label}`}
                className="rounded-sm p-0.5 hover:bg-background/70"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}

          {temFiltro ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={limparTudo}>
              <FilterX className="size-3.5" />
              Limpar filtros
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Clique no funil do cabeçalho para filtrar uma coluna.
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error instanceof Error ? error.message : "Erro ao carregar colaboradores"}
            <span className="mt-1 block text-xs">
              Se a tabela `rh_colaboradores` ainda não existe neste Supabase, rode o script de integração com o RH
              (findash-integracao-rh.sql) no SQL Editor.
            </span>
          </div>
        )}

        {/* ─── Tabela ─── */}
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary hover:bg-secondary">
                <TableHead className="sticky left-0 z-10 h-auto bg-secondary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Status
                </TableHead>
                {colunasAtivas.map((c) => (
                  <TableHead
                    key={c.key}
                    className={cn(
                      "h-auto whitespace-nowrap px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground",
                      c.num && "text-right",
                    )}
                  >
                    <div className={cn("flex items-center gap-0.5", c.num && "justify-end")}>
                      <span>{c.label}</span>
                      {!c.semFiltro && (
                        <FiltroColuna
                          col={c}
                          base={buscados}
                          passaFiltros={passaFiltros}
                          selecionados={filtros[c.key]}
                          faixa={faixas[c.key]}
                          onToggleValor={(chave) => toggleValor(c.key, chave)}
                          onSelecionar={(chaves) =>
                            setFiltros((p) =>
                              chaves.length ? { ...p, [c.key]: new Set(chaves) } : (() => { const { [c.key]: _, ...r } = p; return r; })(),
                            )
                          }
                          onFaixa={(f) =>
                            setFaixas((p) =>
                              faixaVazia(f) ? (() => { const { [c.key]: _, ...r } = p; return r; })() : { ...p, [c.key]: f },
                            )
                          }
                        />
                      )}
                    </div>
                  </TableHead>
                ))}
                <TableHead className="h-auto w-px whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={colunasAtivas.length + 2} className="py-10 text-center text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : filtrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colunasAtivas.length + 2} className="py-10 text-center text-muted-foreground">
                    {todos.length === 0
                      ? "Nenhum dado sincronizado ainda — rode o script de integração no Supabase."
                      : busca.trim()
                        ? `Ninguém encontrado para “${busca.trim()}” — nem nos dados da pessoa, nem nas outras colunas.`
                        : "Nenhum colaborador encontrado com esse filtro."}
                  </TableCell>
                </TableRow>
              ) : (
                filtrados.map((c) => {
                  const eAtivo = ativo(c);
                  const selo = mov.entraram.has(c.id) ? "NOVO" : mov.sairam.has(c.id) ? "SAIU" : null;
                  return (
                    <TableRow
                      key={c.id}
                      onClick={() => setSelecionado(c)}
                      data-selecionada={selecionado?.id === c.id ? "" : undefined}
                      className="group cursor-pointer border-b-border/60 data-[selecionada]:bg-accent/60"
                    >
                      <TableCell
                        className={cn(
                          "sticky left-0 z-10 bg-card px-4 group-hover:bg-muted group-data-[selecionada]:bg-accent/60",
                          pad,
                        )}
                      >
                        {eAtivo ? (
                          <span className="inline-flex h-[22px] items-center rounded-full bg-pos/15 px-2.5 text-[11.5px] font-semibold text-pos">
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex h-[22px] items-center rounded-full bg-destructive/15 px-2.5 text-[11.5px] font-semibold text-destructive">
                            Desligado
                          </span>
                        )}
                      </TableCell>

                      {colunasAtivas.map((col) => (
                        <TableCell
                          key={col.key}
                          className={cn(
                            "max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap px-3.5",
                            pad,
                            col.num && "text-right",
                          )}
                          title={col.key === "foto_url" ? undefined : String(c[col.key] ?? "")}
                        >
                          <Celula
                            col={col}
                            c={c}
                            fotoUrl={fotoUrls?.[String(c.foto_url)]}
                            selo={selo}
                            onFoto={setFotoAberta}
                            divergencias={divergencias.get(String(c.id))}
                          />
                        </TableCell>
                      ))}

                      <TableCell className={cn("px-4", pad)}>
                        <div className="flex justify-end gap-1.5">
                          <BotaoIcone
                            titulo="Copiar CNPJ"
                            onClick={(e) => { e.stopPropagation(); copiar(fmtCnpj(c.cnpj), "CNPJ"); }}
                          >
                            <Copy className="size-3.5" />
                          </BotaoIcone>
                          <BotaoIcone
                            titulo="Copiar PIX"
                            onClick={(e) => { e.stopPropagation(); copiar(txt(c.pix), "PIX"); }}
                          >
                            <Receipt className="size-3.5" />
                          </BotaoIcone>
                          <BotaoIcone
                            titulo="Abrir ficha completa"
                            onClick={(e) => { e.stopPropagation(); setSelecionado(c); }}
                          >
                            <PanelRightOpen className="size-3.5" />
                          </BotaoIcone>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ─── Ficha lateral: a mesma ficha de antes, agora sem tapar a tabela ─── */}
      {selecionado && (
        <aside className="w-full self-start overflow-hidden rounded-xl border bg-card lg:sticky lg:top-4 lg:w-[420px] lg:flex-none">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Ficha do colaborador
            </span>
            <div className="flex gap-1.5">
              <BotaoIcone titulo="Abrir em tela cheia" onClick={() => setFichaCheia(true)}>
                <Maximize2 className="size-3.5" />
              </BotaoIcone>
              <BotaoIcone titulo="Fechar" onClick={() => setSelecionado(null)}>
                <X className="size-3.5" />
              </BotaoIcone>
            </div>
          </div>
          <div className="max-h-[calc(100vh-7.5rem)] overflow-y-auto p-4">
            <FichaConteudo
              c={selecionado}
              fotoUrl={fotoUrls?.[String(selecionado.foto_url)]}
              onFoto={setFotoAberta}
              onCopiar={copiar}
            />
          </div>
        </aside>
      )}

      {/* A mesma ficha em tela cheia, para quem quer ler tudo de uma vez. */}
      <Dialog open={fichaCheia && !!selecionado} onOpenChange={(open) => !open && setFichaCheia(false)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>{String(selecionado?.nome ?? "Ficha do colaborador")}</DialogTitle>
          </DialogHeader>
          {selecionado && (
            <FichaConteudo
              c={selecionado}
              fotoUrl={fotoUrls?.[String(selecionado.foto_url)]}
              onFoto={setFotoAberta}
              onCopiar={copiar}
              duasColunas
            />
          )}
        </DialogContent>
      </Dialog>

      <PreviaFolhaDialog
        aberto={previaFolha}
        onFechar={() => setPreviaFolha(false)}
        competencia={`${mesRef.ano}-${String(mesRef.mes + 1).padStart(2, "0")}`}
      />

      <CadastrarNoOmieDialog
        aberto={cadastrarOmie}
        onFechar={() => setCadastrarOmie(false)}
        rotuloDoMes={rotuloMes}
        /* `todos`, e não `filtrados`: o botão diz "quem entrou no mês", e uma
           busca digitada na tela não pode encolher em silêncio o que vai ser
           cadastrado.

           Mas quem já saiu fica de fora: entrou e saiu no mesmo mês continua
           sendo "entrou em ago" na lista, e não faz sentido criar fornecedor
           para quem foi embora — rescisão é processo à parte. O servidor
           bloqueia de novo, por via das dúvidas. */
        codigos={todos
          .filter((c) => mov.entraram.has(c.id) && ativo(c))
          .map((c) => String(c.codigo ?? ""))
          .filter(Boolean)}
      />

      <Dialog open={!!fotoAberta} onOpenChange={(open) => !open && setFotoAberta(null)}>
        <DialogContent className="max-w-xs p-4" onClick={(e) => e.stopPropagation()}>
          {fotoAberta && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">{fotoAberta.nome}</DialogTitle>
              </DialogHeader>
              <img
                src={fotoAberta.url}
                alt={fotoAberta.nome}
                className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────── Funil de uma coluna ───────────────────────────
   Lista os valores que a coluna realmente tem, com quantas linhas cada um
   responde. As opções saem das linhas que já passaram nos filtros das OUTRAS
   colunas — assim escolher "Setor: Field Sales" reduz os cargos oferecidos,
   e nunca sobra uma opção que levaria a zero linha. A lista só é montada
   quando o funil abre (são 62 colunas). */

function FiltroColuna({
  col,
  base,
  passaFiltros,
  selecionados,
  faixa,
  onToggleValor,
  onSelecionar,
  onFaixa,
}: {
  col: Col;
  base: Colaborador[];
  passaFiltros: (c: Colaborador, exceto?: string) => boolean;
  selecionados?: Set<string>;
  faixa?: Faixa;
  onToggleValor: (chave: string) => void;
  onSelecionar: (chaves: string[]) => void;
  onFaixa: (f: Faixa) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");

  const marcados = selecionados?.size ?? 0;
  const temFiltro = marcados > 0 || !faixaVazia(faixa);

  const opcoes = useMemo(() => {
    if (!aberto) return [] as { chave: string; rotulo: string; n: number }[];
    const contagem = new Map<string, number>();
    for (const c of base) {
      if (!passaFiltros(c, col.key)) continue;
      const chave = chaveDe(c, col.key);
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    // Valor já marcado que sumiu por causa de outro filtro continua na lista
    // (com zero) — senão não haveria como desmarcá-lo daqui.
    for (const chave of selecionados ?? []) if (!contagem.has(chave)) contagem.set(chave, 0);
    return [...contagem]
      .map(([chave, n]) => ({ chave, n, rotulo: rotuloDeChave(col, chave) }))
      .sort((a, b) => {
        if (a.chave === "") return 1;
        if (b.chave === "") return -1;
        if (col.num) return Number(a.chave) - Number(b.chave);
        // Data: ordena pelo dado cru (ISO) — o rótulo dd/mm/aaaa ordenaria pelo dia.
        if (col.fmt === fmtDate || col.fmt === fmtDateTime) return a.chave.localeCompare(b.chave);
        return a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true });
      });
  }, [aberto, base, passaFiltros, col, selecionados]);

  const busca = q.trim().toLowerCase();
  const visiveis = busca ? opcoes.filter((o) => o.rotulo.toLowerCase().includes(busca)) : opcoes;

  return (
    <Popover open={aberto} onOpenChange={(o) => { setAberto(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title={temFiltro ? `Filtrando por ${col.label}` : `Filtrar por ${col.label}`}
          className={cn(
            "size-6 p-0 shrink-0",
            temFiltro ? "text-primary opacity-100" : "text-muted-foreground opacity-50 hover:opacity-100",
          )}
        >
          <Filter className={cn("size-3.5", temFiltro && "fill-current")} />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <span className="text-sm font-medium truncate">{col.label}</span>
          {temFiltro && (
            <button
              className="text-xs text-primary hover:underline shrink-0"
              onClick={() => { onSelecionar([]); onFaixa({ min: "", max: "" }); }}
            >
              Limpar
            </button>
          )}
        </div>

        {col.num && (
          <div className="px-3 py-2 border-b space-y-1.5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Faixa</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                placeholder="mínimo"
                value={faixa?.min ?? ""}
                onChange={(e) => onFaixa({ min: e.target.value, max: faixa?.max ?? "" })}
                className="h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="máximo"
                value={faixa?.max ?? ""}
                onChange={(e) => onFaixa({ min: faixa?.min ?? "", max: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}

        <div className="p-2 space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar valor…"
            className="h-8 text-xs"
          />
          <div className="flex items-center justify-between text-xs">
            <div className="flex gap-2">
              <button
                className="text-primary hover:underline"
                onClick={() => onSelecionar(visiveis.map((o) => o.chave))}
              >
                Selecionar {busca ? "os encontrados" : "todos"}
              </button>
              <span className="text-muted-foreground">·</span>
              <button className="text-primary hover:underline" onClick={() => onSelecionar([])}>
                Nenhum
              </button>
            </div>
            <span className="text-muted-foreground tabular-nums">
              {marcados > 0 ? `${marcados} marcado${marcados === 1 ? "" : "s"}` : `${opcoes.length} valores`}
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto rounded border p-1 space-y-0.5">
            {visiveis.length === 0 ? (
              <p className="px-2 py-3 text-xs text-center text-muted-foreground">Nenhum valor.</p>
            ) : (
              visiveis.slice(0, 500).map((o) => (
                <label
                  key={o.chave}
                  className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent cursor-pointer text-xs"
                >
                  <Checkbox
                    checked={selecionados?.has(o.chave) ?? false}
                    onCheckedChange={() => onToggleValor(o.chave)}
                  />
                  <span className={cn("truncate flex-1", o.chave === "" && "italic text-muted-foreground")}>
                    {o.rotulo}
                  </span>
                  <span className="tabular-nums text-muted-foreground shrink-0">{o.n}</span>
                </label>
              ))
            )}
            {visiveis.length > 500 && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                Mostrando os 500 primeiros de {visiveis.length} — use a busca acima.
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─────────────────────────── Peças visuais ─────────────────────────── */

const TOM = {
  pos: {
    texto: "text-pos",
    pilula: "border-pos/25 bg-pos/10 text-pos",
  },
  neg: {
    texto: "text-destructive",
    pilula: "border-destructive/25 bg-destructive/10 text-destructive",
  },
  warn: {
    texto: "text-amber-700 dark:text-amber-400",
    pilula: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
} satisfies Record<string, { texto: string; pilula: string }>;

type Tom = keyof typeof TOM;

/** Número da faixa de resumo: rótulo apagado em cima, valor firme embaixo. */
function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: Tom }) {
  return (
    <div>
      <p className="text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-0.5 font-semibold tabular-nums", tom ? TOM[tom].texto : "text-foreground")}>
        {valor}
      </p>
    </div>
  );
}

/** Atalho de filtro do mês. Sem ninguém no grupo, a pílula fica inerte. */
function PilulaMov({
  ativa, tom, icone, rotulo, n, onClick,
}: {
  ativa: boolean;
  tom: Tom;
  icone: React.ReactNode;
  rotulo: string;
  n: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={n === 0}
      title={n === 0 ? "Ninguém neste grupo no mês escolhido" : `Mostrar só: ${rotulo}`}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
        n === 0 && "cursor-default opacity-45",
        ativa
          ? cn("font-semibold", TOM[tom].pilula)
          : "border-border bg-card font-medium text-foreground hover:bg-muted",
      )}
    >
      <span className={cn(ativa ? "" : "text-muted-foreground")}>{icone}</span>
      {rotulo} · <span className="tabular-nums">{n}</span>
    </button>
  );
}

/** Botãozinho quadrado de ação — o mesmo em toda a tela. */
function BotaoIcone({
  titulo, onClick, children,
}: {
  titulo: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** Foto do colaborador; sem foto, as iniciais num círculo de cor fixa. */
function Avatar({
  nome, url, tamanho = 34, onClick,
}: {
  nome: string;
  url?: string;
  tamanho?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const estilo = { width: tamanho, height: tamanho } as React.CSSProperties;

  if (url) {
    return (
      <img
        src={url}
        alt={nome}
        loading="lazy"
        title="Clique para ver a foto"
        style={estilo}
        onClick={onClick}
        className={cn(
          "flex-none rounded-full bg-muted object-cover",
          onClick && "cursor-pointer transition-shadow hover:ring-2 hover:ring-primary",
        )}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  return (
    <span
      style={{ ...estilo, background: corDoNome(nome) }}
      className="grid flex-none place-items-center rounded-full font-semibold text-white"
      aria-hidden
    >
      <span style={{ fontSize: tamanho * 0.34 }}>{iniciaisDe(nome)}</span>
    </span>
  );
}

/* ─────────────────────────── Célula da tabela ───────────────────────────
   Cada coluna ganha a forma que o dado pede: foto vira avatar, documento e
   data saem em monoespaçada, dinheiro alinha à direita em tabular, e o que
   é categoria (setor, modalidade) vira etiqueta. O conteúdo é o mesmo de
   sempre — só a apresentação muda. */

function Celula({
  col, c, fotoUrl, selo, onFoto, divergencias,
}: {
  col: Col;
  c: Colaborador;
  fotoUrl?: string;
  selo: string | null;
  onFoto: (f: { url: string; nome: string } | null) => void;
  /** O que o Hub corrigiu por cima deste cadastro. Vira recado ao DH. */
  divergencias?: string[];
}) {
  const nome = String(c.nome ?? "");
  const cru = c[col.key];
  const vazio = cru === null || cru === undefined || cru === "";

  if (col.key === "foto_url") {
    return (
      <Avatar
        nome={nome}
        url={fotoUrl}
        onClick={fotoUrl ? (e) => { e.stopPropagation(); onFoto({ url: fotoUrl, nome }); } : undefined}
      />
    );
  }

  if (col.key === "nome") {
    return (
      <span className="block leading-tight">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium">{txt(cru)}</span>
          {selo && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em]",
                selo === "NOVO" ? "bg-pos/15 text-pos" : "bg-destructive/15 text-destructive",
              )}
            >
              {selo}
            </span>
          )}
        </span>
        {/* O recado para o DH. Fica embaixo do nome, na linha da pessoa, porque
            é assim que quem varre a lista consegue anotar o que pedir. */}
        {divergencias?.map((d) => (
          <span key={d} className="block whitespace-normal text-[11px] leading-snug text-destructive">
            ⚠ {d}
          </span>
        ))}
      </span>
    );
  }

  if (vazio) return <span className="text-[13.5px] text-muted-foreground">—</span>;

  // Início e desligamento carregam o tempo de casa embaixo — informação que
  // já existe nos dados e que ninguém quer calcular de cabeça.
  if (col.key === "inicio" || col.key === "datadesl") {
    const inicio = parseISO(c.inicio);
    const fim = parseISO(c.datadesl) ?? new Date();
    return (
      <span className="block leading-tight">
        <span className="mono text-[12.5px]">{fmtDate(cru)}</span>
        {inicio && (
          <span className="block text-xs text-muted-foreground">{tempoDeCasa(inicio, fim)}</span>
        )}
      </span>
    );
  }

  if (PILL_KEYS.has(col.key)) {
    return (
      <span className="inline-flex h-6 items-center rounded-full border bg-muted px-2.5 text-xs text-secondary-foreground">
        {String((col.fmt ?? txt)(cru))}
      </span>
    );
  }

  if (col.num) {
    return <span className="num text-[13.5px]">{String((col.fmt ?? txt)(cru))}</span>;
  }

  if (MONO_KEYS.has(col.key)) {
    return <span className="mono text-[12.5px]">{String((col.fmt ?? txt)(cru))}</span>;
  }

  return <span className="text-[13.5px]">{String((col.fmt ?? txt)(cru))}</span>;
}

/* ─────────────────────────── Ficha do colaborador ─────────────────────────── */

/** Cartão de um assunto da ficha: título e uma lista de rótulo → valor. */
function Bloco({ titulo, campos }: { titulo: string; campos: { k: string; v: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b px-3.5 py-2.5 text-[12.5px] font-semibold">{titulo}</div>
      <div className="px-3.5 pb-2.5 pt-1">
        {campos.map((campo) => (
          <div
            key={campo.k}
            className="flex items-baseline justify-between gap-4 border-b border-border/60 py-[7px] last:border-0"
          >
            <span className="flex-none text-[12.5px] text-muted-foreground">{campo.k}</span>
            <span className="break-words text-right text-[13px]">{campo.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Número em destaque no topo da ficha. */
function Ladrilho({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: Tom }) {
  return (
    <div className={cn("rounded-[10px] border px-3 py-2.5", tom === "neg" && "border-destructive/30 bg-destructive/5")}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 text-base font-medium", tom ? TOM[tom].texto : "")}>{valor}</p>
    </div>
  );
}

function FichaConteudo({
  c, fotoUrl, onFoto, onCopiar, duasColunas,
}: {
  c: Colaborador;
  fotoUrl?: string;
  onFoto: (f: { url: string; nome: string } | null) => void;
  onCopiar: (valor: string, rotulo: string) => void;
  duasColunas?: boolean;
}) {
  const nome = String(c.nome ?? "—");
  const eAtivo = ativo(c);
  const inicio = parseISO(c.inicio);
  const desl = parseISO(c.datadesl);
  const calc = !eAtivo ? calculoProporcional(c) : null;
  const fimRef = desl ?? new Date();

  return (
    <div className="flex flex-col gap-4">
      {/* Quem é */}
      <div className="flex items-center gap-3.5">
        <Avatar
          nome={nome}
          url={fotoUrl}
          tamanho={56}
          onClick={fotoUrl ? () => onFoto({ url: fotoUrl, nome }) : undefined}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-semibold">{nome}</h3>
            {eAtivo ? (
              <span className="inline-flex h-[21px] items-center rounded-full bg-pos/15 px-2.5 text-[11.5px] font-semibold text-pos">
                Ativo
              </span>
            ) : (
              <span className="inline-flex h-[21px] items-center rounded-full bg-destructive/15 px-2.5 text-[11.5px] font-semibold text-destructive">
                Desligado
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {txt(c.codigo)} · {txt(c.cargo)} · {txt(c.setor)}
          </p>
        </div>
      </div>

      {/* Os três números que se olha primeiro */}
      <div className="grid grid-cols-2 gap-2.5">
        <Ladrilho rotulo="Valor mensal" valor={BRL(c.valor)} />
        <Ladrilho rotulo="Tempo de casa" valor={inicio ? tempoDeCasa(inicio, fimRef) : "—"} />
        <Ladrilho rotulo="Início" valor={fmtDate(c.inicio)} />
        {!eAtivo && <Ladrilho rotulo="Desligamento" valor={fmtDate(c.datadesl)} tom="neg" />}
      </div>

      {/* O que se copia para pagar */}
      <div className="flex gap-2">
        <button
          onClick={() => onCopiar(fmtCnpj(c.cnpj), "CNPJ")}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border bg-card text-[12.5px] transition-colors hover:bg-muted"
        >
          <Copy className="size-3.5 text-muted-foreground" />
          CNPJ
        </button>
        <button
          onClick={() => onCopiar(txt(c.pix), "PIX")}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border bg-card text-[12.5px] transition-colors hover:bg-muted"
        >
          <Copy className="size-3.5 text-muted-foreground" />
          PIX
        </button>
        <button
          onClick={() => onCopiar(txt(c.emailcorp), "e-mail")}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border bg-card text-[12.5px] transition-colors hover:bg-muted"
        >
          <Copy className="size-3.5 text-muted-foreground" />
          E-mail
        </button>
      </div>

      {calc && (
        <div className="space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Pagamento proporcional do desligamento
          </p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor mensal do contrato</span>
              <span className="tabular-nums">{BRL(calc.valor)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dias trabalhados no mês do desligamento</span>
              <span className="tabular-nums">{calc.dias} {calc.dias === 1 ? "dia" : "dias"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">
                Proporcional ({BRL(calc.valor)} ÷ 30 × {calc.dias})
              </span>
              <span className="whitespace-nowrap font-medium tabular-nums">{BRL(calc.proporcional)}</span>
            </div>
            {calc.liberalidade > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Liberalidade</span>
                <span className="font-medium tabular-nums">{BRL(calc.liberalidade)}</span>
              </div>
            )}
            <div className="mt-1.5 flex justify-between border-t pt-1.5">
              <span className="font-semibold">Total a receber</span>
              <span className="text-base font-bold tabular-nums">{BRL(calc.total)}</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Estimativa em base comercial (mês de 30 dias) — confira antes de pagar.
          </p>
        </div>
      )}

      <div className={cn("flex flex-col gap-3", duasColunas && "sm:grid sm:grid-cols-2 sm:items-start")}>
        <Bloco
          titulo="Contrato PJ"
          campos={[
            { k: "Razão social", v: txt(c.razao) },
            { k: "CNPJ", v: fmtCnpj(c.cnpj) },
            { k: "Modalidade", v: txt(c.modalidade) },
            { k: "Modelo de remuneração", v: txt(c.modelo_remuneracao) },
            { k: "Flash", v: BRL(c.flash) },
            { k: "Vencimento do contrato", v: fmtDate(c.vence) },
          ]}
        />
        <Bloco
          titulo="Dados bancários"
          campos={[
            { k: "Banco", v: `${txt(c.banco)} (${txt(c.codbanco)})` },
            { k: "Agência", v: txt(c.agencia) },
            { k: "Conta", v: `${txt(c.conta)}${c.digito ? `-${c.digito}` : ""}` },
            { k: "PIX", v: txt(c.pix) },
          ]}
        />
        <Bloco
          titulo="Dados pessoais"
          campos={[
            { k: "CPF", v: fmtCpf(c.cpf) },
            { k: "Nascimento", v: fmtDate(c.nascimento) },
            { k: "E-mail corporativo", v: txt(c.emailcorp) },
            { k: "E-mail pessoal", v: txt(c.emailpessoal) },
            { k: "WhatsApp", v: txt(c.whatsapp) },
            { k: "WhatsApp corporativo", v: txt(c.whatsappcorp) },
          ]}
        />
        <Bloco
          titulo="Endereço"
          campos={[
            {
              k: "Endereço",
              v: [c.logradouro, c.numero, c.complemento, c.bairro].filter(Boolean).join(", ") || "—",
            },
            { k: "Cidade/UF", v: c.cidade ? `${c.cidade}/${txt(c.estado)}` : "—" },
            { k: "CEP", v: txt(c.cep) },
          ]}
        />
        {!eAtivo && (
          <Bloco
            titulo="Desligamento"
            campos={[
              { k: "Tipo", v: txt(c.tipodesl) },
              { k: "Motivo", v: txt(c.motivodesl) },
              { k: "Observações", v: txt(c.obsdesl) },
            ]}
          />
        )}
      </div>
    </div>
  );
}
