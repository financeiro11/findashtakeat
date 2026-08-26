import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Search, Pencil, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { seloDaLinha, type Linha, type Pessoa } from "@/lib/cac";
import { SeloRegra } from "./SeloRegra";

const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

function brl(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compacto no KPI; o valor cheio fica no hover, como no resto do Hub. */
function milStr(n: number) {
  return "R$ " + (n / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mil";
}

/** Só dígitos — a mesma normalização que a coluna `cnpj` exige no banco. */
const soDigitos = (s: string) => String(s ?? "").replace(/[^0-9]/g, "");

function fmtCNPJ(d: string) {
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}

export function CadastroCAC({ onMudou, totaisPorLinha }: {
  onMudou: () => void;
  /** Total do ano por linha, vindo da matriz — é o que separa "zero" de "ok". */
  totaisPorLinha?: Map<string, number>;
}) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [categorias, setCategorias] = useState<{ codigo: string; descricao: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [editandoPessoa, setEditandoPessoa] = useState<Pessoa | null>(null);
  const [editandoLinha, setEditandoLinha] = useState<Linha | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [p, l, c] = await Promise.all([
      db.from("cac_pessoas").select("*").order("nome"),
      db.from("cac_linhas").select("*").order("ordem"),
      db.rpc("omie_categorias_disponiveis"),
    ]);
    if (p.error) toast.error("Não consegui carregar as pessoas", { description: p.error.message });
    if (l.error) toast.error("Não consegui carregar as linhas", { description: l.error.message });
    setPessoas((p.data ?? []) as Pessoa[]);
    setLinhas((l.data ?? []) as Linha[]);
    setCategorias(c.error ? [] : ((c.data ?? []) as { codigo: string; descricao: string }[]));
    setLoading(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const recarregar = () => { void carregar(); onMudou(); };

  /* Em qual célula da matriz cada departamento cai. É a pergunta que a aba
     inteira existe para responder: a pessoa está cadastrada, mas o número dela
     aparece ONDE? Sem essa coluna, descobrir isso é ler regra por regra. */
  const linhaDoDepto = useMemo(() => {
    const m = new Map<string, Linha>();
    for (const l of linhas) for (const d of l.departamentos ?? []) if (!m.has(d)) m.set(d, l);
    return m;
  }, [linhas]);

  /* Departamentos que NENHUMA linha do painel aponta. Uma pessoa aí não some da
     tela nem entra em nenhuma célula — fica invisível no total, que é o tipo de
     buraco que só aparece quando o número não fecha e ninguém sabe por quê. */
  const orfaos = useMemo(() => {
    const conta = new Map<string, number>();
    for (const p of pessoas) {
      if (!p.ativo || linhaDoDepto.has(p.departamento)) continue;
      conta.set(p.departamento, (conta.get(p.departamento) ?? 0) + 1);
    }
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [pessoas, linhaDoDepto]);

  const dentro = useMemo(
    () => pessoas.filter((p) => linhaDoDepto.has(p.departamento)),
    [pessoas, linhaDoDepto],
  );
  const folhaDentro = useMemo(
    () => dentro.reduce((a, p) => a + (Number(p.remuneracao) || 0), 0),
    [dentro],
  );

  const selos = useMemo(() => {
    const m = new Map<string, ReturnType<typeof seloDaLinha>>();
    for (const l of linhas) {
      m.set(l.id, seloDaLinha(
        l.regra_nota,
        !!(l.departamentos?.length || l.categorias?.length),
        totaisPorLinha?.get(l.id) ?? 1,
      ));
    }
    return m;
  }, [linhas, totaisPorLinha]);

  const aConferir = useMemo(
    () => [...selos.values()].filter((s) => s !== "ok").length,
    [selos],
  );

  const porDepto = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pessoas) if (p.ativo) m.set(p.departamento, (m.get(p.departamento) ?? 0) + 1);
    return m;
  }, [pessoas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pessoas;
    return pessoas.filter((p) => {
      const l = linhaDoDepto.get(p.departamento);
      /* A busca varre também o rótulo da linha: quem procura "Franquia" está
         atrás de quem cai naquela célula, e a pessoa marcada como "Franquias"
         sumiria do filtro pelo nome que está escrito na linha dela. */
      return [
        p.nome, p.cnpj, p.departamento, p.categoria_omie ?? "", p.planilha_comissao ?? "",
        l ? `${l.grupo} ${l.rotulo}` : "fora do painel",
      ].join(" ").toLowerCase().includes(q);
    });
  }, [pessoas, busca, linhaDoDepto]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          rotulo="Pessoas na planilha"
          valor={String(pessoas.length)}
          sub={`${dentro.length} entram em alguma célula`}
        />
        <Kpi
          rotulo="Folha dentro do painel"
          valor={comValorExato(folhaDentro, milStr(folhaDentro))}
          sub="remuneração cadastrada · base do confronto com o Omie"
        />
        <Kpi
          rotulo="Regras a conferir"
          valor={String(aConferir)}
          sub={`de ${linhas.length} linhas do painel`}
        />
      </div>

      {orfaos.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[12px]">
          <p className="flex items-center gap-1.5 font-medium text-warn">
            <AlertTriangle className="h-3.5 w-3.5" />
            Departamentos fora do painel
          </p>
          <p className="mt-1 text-muted-foreground">
            Estas pessoas não entram em nenhuma célula:{" "}
            {orfaos.map(([d, n]) => `${d} (${n})`).join(" · ")}.
            {" "}É esperado para Tecnologia, Produto e Backoffice, que não são custo de aquisição.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
          <div className="relative max-w-[340px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, CNPJ, departamento…" className="h-8 pl-8 text-[12.5px]" />
          </div>
          <span className="text-[11.5px] text-muted-foreground">
            Coluna “Linha do painel” diz em qual célula cada pessoa cai
          </span>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr>
                <th className="px-3.5 py-2 text-left font-semibold">Pessoa</th>
                <th className="px-3 py-2 text-left font-semibold">Departamento</th>
                <th className="px-3 py-2 text-left font-semibold">Linha do painel</th>
                <th className="px-3 py-2 text-left font-semibold">Planilha</th>
                <th className="w-[130px] px-3.5 py-2 text-right font-semibold">Remuneração</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtradas.map((p) => {
                const l = linhaDoDepto.get(p.departamento);
                return (
                  <tr key={p.id} className={cn("border-t border-border hover:bg-muted/20", !p.ativo && "opacity-50")}>
                    <td className="px-3.5 py-1.5">
                      <span className="block">{p.nome}</span>
                      <span className="num block text-[11px] text-muted-foreground">{fmtCNPJ(p.cnpj)}</span>
                    </td>
                    <td className="px-3 py-1.5">{p.departamento}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                        l ? "bg-muted text-foreground" : "bg-warn-soft text-warn",
                      )}>
                        {l ? `${l.grupo} › ${l.rotulo}` : "fora do painel"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{p.planilha_comissao ?? "—"}</td>
                    <td className="num px-3.5 py-1.5 text-right">{comValorExato(p.remuneracao, brl(p.remuneracao))}</td>
                    <td className="px-1 py-1.5">
                      <Button size="icon" variant="ghost" className="ghost-icone h-6 w-6" onClick={() => setEditandoPessoa(p)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!filtradas.length && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Nada encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-3.5 py-2.5">
          <p className="text-[13px] font-semibold">Regras das linhas</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            O selo é o mesmo que aparece na matriz — conferido, a conferir ou sem regra
          </p>
        </div>

        <table className="w-full text-[12.5px]">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3.5 py-2 text-left font-semibold">Linha</th>
              <th className="px-3 py-2 text-left font-semibold">Departamentos</th>
              <th className="px-3 py-2 text-left font-semibold">Categorias</th>
              <th className="px-3 py-2 text-left font-semibold">Nota da regra</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const selo = selos.get(l.id) ?? "ok";
              const conferir = (l.regra_nota ?? "").startsWith("CONFERIR");
              const cats = l.categorias ?? [];
              return (
                <tr key={l.id} className="border-t border-border align-top hover:bg-muted/20">
                  <td className="px-3.5 py-2">
                    <span className="flex items-center gap-1.5">
                      <span>{l.grupo} › {l.rotulo}</span>
                      <SeloRegra selo={selo} longo />
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {l.departamentos?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {l.departamentos.map((d) => (
                          <Badge key={d} variant="outline" className="text-[10.5px]"
                            title={`${porDepto.get(d) ?? 0} pessoa(s) ativa(s)`}>
                            {d}
                            {!porDepto.get(d) && <span className="ml-1 text-warn">·0</span>}
                          </Badge>
                        ))}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  {/* Até duas categorias cabem por extenso, e o código é o que
                      se procura no Omie. Acima disso vira contagem. */}
                  <td className="num px-3 py-2 text-[11.5px] text-muted-foreground">
                    {!cats.length ? "—" : cats.length <= 2 ? cats.join(" · ") : `${cats.length} cats`}
                  </td>
                  <td className={cn("px-3 py-2 text-[11.5px] leading-relaxed", conferir ? "text-warn" : "text-muted-foreground")}>
                    {l.regra_nota ?? "—"}
                  </td>
                  <td className="px-1 py-2">
                    <Button size="icon" variant="ghost" className="ghost-icone h-6 w-6" onClick={() => setEditandoLinha(l)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <PessoaDialog
        pessoa={editandoPessoa}
        onClose={() => setEditandoPessoa(null)}
        onSalvou={() => { setEditandoPessoa(null); recarregar(); }}
      />

      <LinhaDialog
        linha={editandoLinha}
        departamentos={[...porDepto.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"))}
        categorias={categorias}
        onClose={() => setEditandoLinha(null)}
        onSalvou={() => { setEditandoLinha(null); recarregar(); }}
      />
    </div>
  );
}

function Kpi({ rotulo, valor, sub }: { rotulo: string; valor: React.ReactNode; sub: string }) {
  return (
    <Card className="flex flex-col gap-1 px-3.5 py-3">
      <span className="eyebrow">{rotulo}</span>
      <span className="num text-[20px] font-semibold tracking-tight">{valor}</span>
      <span className="text-[11.5px] text-muted-foreground">{sub}</span>
    </Card>
  );
}

/* ==========================================================================
 * Pessoa
 * ======================================================================== */

function PessoaDialog({ pessoa, onClose, onSalvou }: {
  pessoa: Pessoa | null; onClose: () => void; onSalvou: () => void;
}) {
  const [form, setForm] = useState<Partial<Pessoa>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setForm(pessoa ?? {}); }, [pessoa]);

  async function salvar() {
    if (!pessoa) return;
    const cnpj = soDigitos(String(form.cnpj ?? ""));
    if (cnpj.length < 11 || cnpj.length > 14) {
      toast.error("CNPJ/CPF inválido", { description: "Precisa ter entre 11 e 14 dígitos." });
      return;
    }
    setSalvando(true);
    const { error } = await db.from("cac_pessoas").update({
      nome: String(form.nome ?? "").trim(),
      cnpj,
      departamento: String(form.departamento ?? "").trim(),
      categoria_omie: form.categoria_omie || null,
      remuneracao: form.remuneracao == null || form.remuneracao === ("" as unknown) ? null : Number(form.remuneracao),
      planilha_comissao: form.planilha_comissao || null,
      observacao: form.observacao || null,
      ativo: form.ativo ?? true,
      atualizado_em: new Date().toISOString(),
    }).eq("id", pessoa.id);
    setSalvando(false);

    if (error) toast.error("Não consegui salvar", { description: error.message });
    else { toast.success("Pessoa atualizada"); onSalvou(); }
  }

  return (
    <Dialog open={!!pessoa} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-[15px]">{pessoa?.nome}</DialogTitle></DialogHeader>
        <div className="space-y-2.5">
          <Campo rotulo="Nome">
            <Input value={String(form.nome ?? "")} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="h-8 text-[12.5px]" />
          </Campo>
          <Campo rotulo="CNPJ / CPF" ajuda="É a chave que casa com o pagamento no Omie.">
            <Input value={String(form.cnpj ?? "")} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} className="h-8 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Departamento" ajuda="Escreva igual à regra da linha do painel.">
            <Input value={String(form.departamento ?? "")} onChange={(e) => setForm({ ...form, departamento: e.target.value })} className="h-8 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Remuneração">
            <Input type="number" step="0.01" value={form.remuneracao == null ? "" : String(form.remuneracao)}
              onChange={(e) => setForm({ ...form, remuneracao: e.target.value === "" ? null : Number(e.target.value) })}
              className="h-8 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Planilha de comissão">
            <Input value={String(form.planilha_comissao ?? "")} onChange={(e) => setForm({ ...form, planilha_comissao: e.target.value })} className="h-8 text-[12.5px]" />
          </Campo>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
            Ativo — desmarcar tira a pessoa das somas dos próximos meses
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ==========================================================================
 * Regra da linha
 * ======================================================================== */

function LinhaDialog({ linha, departamentos, categorias, onClose, onSalvou }: {
  linha: Linha | null;
  departamentos: string[];
  categorias: { codigo: string; descricao: string }[];
  onClose: () => void;
  onSalvou: () => void;
}) {
  const [deps, setDeps] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [nota, setNota] = useState("");
  const [buscaCat, setBuscaCat] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setDeps(linha?.departamentos ?? []);
    setCats(linha?.categorias ?? []);
    setNota(linha?.regra_nota ?? "");
    setBuscaCat("");
  }, [linha]);

  const catsFiltradas = useMemo(() => {
    const q = buscaCat.trim().toLowerCase();
    const base = q
      ? categorias.filter((c) => `${c.codigo} ${c.descricao}`.toLowerCase().includes(q))
      : categorias;
    // As já escolhidas sobem, para não sumirem no meio de 177 opções.
    return [...base].sort((a, b) => Number(cats.includes(b.codigo)) - Number(cats.includes(a.codigo)));
  }, [categorias, buscaCat, cats]);

  const alterna = (lista: string[], v: string) =>
    lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];

  async function salvar() {
    if (!linha) return;
    setSalvando(true);
    const { error } = await db.from("cac_linhas").update({
      departamentos: deps,
      categorias: cats,
      regra_nota: nota.trim() || null,
      atualizado_em: new Date().toISOString(),
    }).eq("id", linha.id);
    setSalvando(false);
    if (error) toast.error("Não consegui salvar", { description: error.message });
    else { toast.success("Regra atualizada"); onSalvou(); }
  }

  const vazia = !deps.length && !cats.length;

  return (
    <Dialog open={!!linha} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{linha?.grupo} › {linha?.rotulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Quando os dois filtros estão preenchidos eles se combinam com <strong>E</strong>: pagamento
            a alguém <em>daquele departamento</em> <em>e</em> numa <em>daquelas categorias</em>.
          </p>

          {vazia && (
            <p className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[12px] text-warn">
              Sem nenhum filtro, esta linha vale zero — ela não soma tudo.
            </p>
          )}

          <div>
            <p className="mb-1.5 text-[12px] font-medium">Departamentos</p>
            <div className="flex flex-wrap gap-1.5">
              {departamentos.map((d) => (
                <button key={d} type="button" onClick={() => setDeps(alterna(deps, d))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                    deps.includes(d)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}>
                  {deps.includes(d) ? <Check className="mr-1 inline h-3 w-3" /> : null}{d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[12px] font-medium">Categorias do Omie ({cats.length})</p>
              <Input value={buscaCat} onChange={(e) => setBuscaCat(e.target.value)}
                placeholder="Filtrar…" className="h-7 w-48 text-[12px]" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              {catsFiltradas.map((c) => (
                <label key={c.codigo}
                  className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-2.5 py-1.5 text-[12px] last:border-0 hover:bg-muted/30">
                  <input type="checkbox" checked={cats.includes(c.codigo)}
                    onChange={() => setCats(alterna(cats, c.codigo))} />
                  <span className="text-muted-foreground">{c.codigo}</span>
                  <span>{c.descricao}</span>
                </label>
              ))}
              {!catsFiltradas.length && (
                <p className="px-2.5 py-6 text-center text-[12px] text-muted-foreground">Nada encontrado.</p>
              )}
            </div>
          </div>

          <Campo rotulo="Nota" ajuda="Aparece no hover do selo, na coluna “Nota da regra” e dentro do drill-down. Começar com “CONFERIR” marca a linha como não validada.">
            <Input value={nota} onChange={(e) => setNota(e.target.value)} className="h-8 text-[12.5px]" />
          </Campo>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium">{rotulo}</p>
      {children}
      {ajuda && <p className="mt-0.5 text-[11px] text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
