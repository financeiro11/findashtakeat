import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, Columns3, Filter, FilterX, X } from "lucide-react";
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
const DEFAULT_VISIVEIS = new Set(COLS.filter((c) => c.def).map((c) => c.key));

const ativo = (c: Colaborador) => !c.datadesl;

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

  const todos = data ?? [];

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

  const baseAba = useMemo(
    () => (aba === "ativos" ? ativos : aba === "desligados" ? desligados : todos),
    [aba, ativos, desligados, todos],
  );

  // Busca livre (todas as colunas) — os filtros de coluna entram depois dela.
  const buscados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return baseAba;
    return baseAba.filter((c) =>
      COLS.some(({ key }) => String(c[key] ?? "").toLowerCase().includes(q)),
    );
  }, [baseAba, busca]);

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

  const filtrados = useMemo(() => buscados.filter((c) => passaFiltros(c)), [buscados, passaFiltros]);

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

  const temFiltro = chips.length > 0 || busca.trim() !== "";

  const limparTudo = () => {
    setFiltros({});
    setFaixas({});
    setBusca("");
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-primary/10 grid place-items-center">
            <Users className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Colaboradores (Dados RH)</h1>
            <p className="text-sm text-muted-foreground">
              Espelho do painel Dados PJ do Portal RH — atualizado automaticamente; o que muda lá, muda aqui.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <b className="text-foreground">{ativos.length}</b> ativos ·{" "}
            <b className="text-foreground">{desligados.length}</b> desligados
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={aba} onValueChange={(v) => setAba(v as typeof aba)}>
          <TabsList>
            <TabsTrigger value="ativos">Ativos</TabsTrigger>
            <TabsTrigger value="desligados">Desligados</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar em qualquer coluna…"
            className="pl-9"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Columns3 className="size-4" />
              Colunas ({colunasAtivas.length}/{COLS.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <div className="flex items-center justify-between px-3 py-2 border-b">
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
            <div className="max-h-80 overflow-y-auto p-2 grid grid-cols-1 gap-0.5">
              {COLS.map((c) => (
                <label
                  key={c.key}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer text-sm"
                >
                  <Checkbox checked={visiveis.has(c.key)} onCheckedChange={() => toggleColuna(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className={cn("tabular-nums", temFiltro ? "text-foreground" : "text-muted-foreground")}>
          <b className="text-foreground">{filtrados.length}</b>
          {temFiltro && <span className="text-muted-foreground"> de {baseAba.length}</span>}{" "}
          {filtrados.length === 1 ? "colaborador" : "colaboradores"}
          {temFiltro && <span className="text-muted-foreground"> · {chips.length} {chips.length === 1 ? "filtro" : "filtros"} de coluna</span>}
        </span>

        {chips.map((chip) => (
          <Badge key={chip.id} variant="secondary" className="gap-1 font-normal pr-1">
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
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error instanceof Error ? error.message : "Erro ao carregar colaboradores"}
          <span className="block text-xs mt-1">
            Se a tabela `rh_colaboradores` ainda não existe neste Supabase, rode o script de integração com o RH
            (findash-integracao-rh.sql) no SQL Editor.
          </span>
        </div>
      )}

      <div className="border rounded-xl overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card z-10">Status</TableHead>
              {colunasAtivas.map((c) => (
                <TableHead key={c.key} className={cn("whitespace-nowrap", c.num && "text-right")}>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={colunasAtivas.length + 1} className="text-center text-muted-foreground py-8">
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colunasAtivas.length + 1} className="text-center text-muted-foreground py-8">
                  {todos.length === 0
                    ? "Nenhum dado sincronizado ainda — rode o script de integração no Supabase."
                    : "Nenhum colaborador encontrado com esse filtro."}
                </TableCell>
              </TableRow>
            ) : (
              filtrados.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => setSelecionado(c)}
                >
                  <TableCell className="sticky left-0 bg-card z-10">
                    {ativo(c) ? (
                      <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-600/15">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="bg-destructive/15 text-destructive hover:bg-destructive/15">
                        Desligado
                      </Badge>
                    )}
                  </TableCell>
                  {colunasAtivas.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        "whitespace-nowrap max-w-[320px] overflow-hidden text-ellipsis",
                        col.num && "text-right tabular-nums",
                      )}
                      title={String(c[col.key] ?? "")}
                    >
                      {col.key === "foto_url" ? (
                        c.foto_url && fotoUrls?.[String(c.foto_url)] ? (
                          <img
                            src={fotoUrls[String(c.foto_url)]}
                            alt={String(c.nome ?? "")}
                            loading="lazy"
                            title="Clique para ver a foto"
                            className="size-8 rounded-full object-cover bg-muted cursor-pointer hover:ring-2 hover:ring-primary transition-shadow"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFotoAberta({
                                url: fotoUrls[String(c.foto_url)],
                                nome: String(c.nome ?? ""),
                              });
                            }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          "—"
                        )
                      ) : (
                        (col.fmt ?? txt)(c[col.key])
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selecionado} onOpenChange={(open) => !open && setSelecionado(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selecionado && (() => {
            const c = selecionado;
            const eAtivo = ativo(c);
            const inicio = parseISO(c.inicio);
            const desl = parseISO(c.datadesl);
            const calc = !eAtivo ? calculoProporcional(c) : null;
            const fimRef = desl ?? new Date();
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-4">
                    {c.foto_url && fotoUrls?.[String(c.foto_url)] ? (
                      <img
                        src={fotoUrls[String(c.foto_url)]}
                        alt={String(c.nome ?? "")}
                        title="Clique para ampliar"
                        className="size-16 rounded-full object-cover bg-muted cursor-pointer hover:ring-2 hover:ring-primary transition-shadow"
                        onClick={() =>
                          setFotoAberta({
                            url: fotoUrls[String(c.foto_url)],
                            nome: String(c.nome ?? ""),
                          })
                        }
                      />
                    ) : (
                      <div className="size-16 rounded-full bg-muted grid place-items-center">
                        <Users className="size-6 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <DialogTitle className="flex items-center gap-2 flex-wrap">
                        {String(c.nome ?? "—")}
                        {eAtivo ? (
                          <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-600/15">Ativo</Badge>
                        ) : (
                          <Badge variant="destructive" className="bg-destructive/15 text-destructive hover:bg-destructive/15">Desligado</Badge>
                        )}
                      </DialogTitle>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {txt(c.codigo)} · {txt(c.cargo)} · {txt(c.setor)}
                      </p>
                    </div>
                  </div>
                </DialogHeader>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border bg-muted/40 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Início</p>
                    <p className="text-sm font-semibold">{fmtDate(c.inicio)}</p>
                  </div>
                  {!eAtivo && (
                    <div className="rounded-lg border bg-destructive/5 border-destructive/30 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Desligamento</p>
                      <p className="text-sm font-semibold">{fmtDate(c.datadesl)}</p>
                    </div>
                  )}
                  {inicio && (
                    <div className="rounded-lg border bg-muted/40 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Tempo de casa</p>
                      <p className="text-sm font-semibold">{tempoDeCasa(inicio, fimRef)}</p>
                    </div>
                  )}
                </div>

                {calc && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      Pagamento proporcional do desligamento
                    </p>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Valor mensal do contrato</span>
                        <span className="tabular-nums">{BRL(calc.valor)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Dias trabalhados no mês do desligamento
                        </span>
                        <span className="tabular-nums">{calc.dias} {calc.dias === 1 ? "dia" : "dias"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Proporcional ({BRL(calc.valor)} ÷ 30 × {calc.dias})
                        </span>
                        <span className="tabular-nums font-medium">{BRL(calc.proporcional)}</span>
                      </div>
                      {calc.liberalidade > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Liberalidade</span>
                          <span className="tabular-nums font-medium">{BRL(calc.liberalidade)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-1.5 mt-1.5">
                        <span className="font-semibold">Total a receber</span>
                        <span className="tabular-nums font-bold text-base">{BRL(calc.total)}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Estimativa em base comercial (mês de 30 dias) — confira antes de pagar.
                    </p>
                  </div>
                )}

                <Secao titulo="Contrato PJ">
                  <Campo k="Razão social" v={txt(c.razao)} />
                  <Campo k="CNPJ" v={fmtCnpj(c.cnpj)} />
                  <Campo k="Modalidade" v={txt(c.modalidade)} />
                  <Campo k="Modelo de remuneração" v={txt(c.modelo_remuneracao)} />
                  <Campo k="Valor" v={BRL(c.valor)} />
                  <Campo k="Flash" v={BRL(c.flash)} />
                  <Campo k="Vencimento do contrato" v={fmtDate(c.vence)} />
                </Secao>

                <Secao titulo="Dados bancários">
                  <Campo k="Banco" v={`${txt(c.banco)} (${txt(c.codbanco)})`} />
                  <Campo k="Agência" v={txt(c.agencia)} />
                  <Campo k="Conta" v={`${txt(c.conta)}${c.digito ? `-${c.digito}` : ""}`} />
                  <Campo k="PIX" v={txt(c.pix)} />
                </Secao>

                <Secao titulo="Dados pessoais">
                  <Campo k="CPF" v={fmtCpf(c.cpf)} />
                  <Campo k="Nascimento" v={fmtDate(c.nascimento)} />
                  <Campo k="E-mail corporativo" v={txt(c.emailcorp)} />
                  <Campo k="E-mail pessoal" v={txt(c.emailpessoal)} />
                  <Campo k="WhatsApp" v={txt(c.whatsapp)} />
                  <Campo k="WhatsApp corporativo" v={txt(c.whatsappcorp)} />
                </Secao>

                <Secao titulo="Endereço">
                  <Campo
                    k="Endereço"
                    v={[c.logradouro, c.numero, c.complemento, c.bairro]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  />
                  <Campo k="Cidade/UF" v={c.cidade ? `${c.cidade}/${txt(c.estado)}` : "—"} />
                  <Campo k="CEP" v={txt(c.cep)} />
                </Secao>

                {!eAtivo && (
                  <Secao titulo="Desligamento">
                    <Campo k="Tipo" v={txt(c.tipodesl)} />
                    <Campo k="Motivo" v={txt(c.motivodesl)} />
                    <Campo k="Observações" v={txt(c.obsdesl)} />
                  </Secao>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

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
                className="w-full max-h-[60vh] rounded-lg object-contain bg-muted"
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

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{titulo}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">{children}</div>
    </div>
  );
}

function Campo({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{k}: </span>
      <span className="font-medium break-words">{v}</span>
    </div>
  );
}
