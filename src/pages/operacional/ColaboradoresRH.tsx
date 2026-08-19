import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, Columns3 } from "lucide-react";
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

/* ─────────────────────────── Catálogo de colunas ───────────────────────────
   Todas as colunas do espelho do RH, na ordem do painel de Dados PJ.
   `def: true` = visível por padrão; o resto fica disponível no seletor. */

type Col = { key: string; label: string; fmt?: (v: unknown) => string; def?: boolean; num?: boolean };

// As mesmas 54 colunas da tela "Dados PJs" do Portal RH, na mesma ordem.
const COLS: Col[] = [
  { key: "id", label: "ID" },
  { key: "codigo", label: "Código", def: true },
  { key: "foto_url", label: "Foto", def: true },
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
const DEFAULT_VISIVEIS = new Set(COLS.filter((c) => c.def).map((c) => c.key));

const ativo = (c: Colaborador) => !c.datadesl;

/* ─────────────────────────── Página ─────────────────────────── */

export default function ColaboradoresRH() {
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<"ativos" | "desligados" | "todos">("ativos");
  const [fotoAberta, setFotoAberta] = useState<{ url: string; nome: string } | null>(null);
  const [visiveis, setVisiveis] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* usa o padrão */ }
    return new Set(DEFAULT_VISIVEIS);
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...visiveis]));
  }, [visiveis]);

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

  const filtrados = useMemo(() => {
    const base = aba === "ativos" ? ativos : aba === "desligados" ? desligados : todos;
    const q = busca.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c) =>
      COLS.some(({ key }) => String(c[key] ?? "").toLowerCase().includes(q)),
    );
  }, [aba, busca, ativos, desligados, todos]);

  const colunasAtivas = COLS.filter((c) => visiveis.has(c.key));

  const toggleColuna = (key: string) =>
    setVisiveis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
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
                  {c.label}
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
                <TableRow key={c.id}>
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
                            onClick={() =>
                              setFotoAberta({
                                url: fotoUrls[String(c.foto_url)],
                                nome: String(c.nome ?? ""),
                              })
                            }
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

      <Dialog open={!!fotoAberta} onOpenChange={(open) => !open && setFotoAberta(null)}>
        <DialogContent className="max-w-xs p-4">
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
