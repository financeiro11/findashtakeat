import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, Search, Loader2, AlertTriangle, ArrowUpRight, Unlink, Lock, Archive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { baseDoTipo, linkPlanoContas } from "@/lib/linksPlanoContas";
import { resumirSaude, type SaudeDePara } from "@/lib/conferenciaDemonstracao";

type MapaRow = {
  id: string;
  codigo_categoria: string;
  descricao_categoria: string | null;
  rubrica: string;
  demonstrativo: string;
  ativo: boolean;
  arquivado_em?: string | null;
  arquivado_motivo?: string | null;
};

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = () => supabase.from("omie_dre_mapa" as any) as any;

/**
 * Painel de edição do DE_PARA (categoria do Omie → rubrica da demonstração).
 * Usado tanto pela DRE quanto pela DFC, filtrando por `demonstrativo`.
 * `rubricas` alimenta o autocomplete (datalist) e sinaliza rubricas que não
 * correspondem a nenhuma linha conhecida da demonstração.
 *
 * SÓ O FINANCEIRO EDITA (capacidade `conciliacao`, desde 15/09/2026). A trava de
 * verdade é a policy de `omie_dre_mapa`; aqui a tela só deixa de oferecer o que o
 * banco recusaria. Quem vê as Demonstrações continua lendo o mapa inteiro.
 *
 * O DE-PARA casa pela DESCRIÇÃO da categoria, e o Omie não avisa quando o nome
 * muda: em 15/09/2026, 53 linhas apontavam para nomes que não existem mais (o
 * Frete saiu da DRE por um ponto: "3.2.2" × "3.2.2."). Cada linha diz se o nome
 * ainda existe e, quando não, qual categoria parece ser a mesma. As órfãs sem
 * conserto foram ARQUIVADAS (`ativo = false`, com motivo) — ficam registradas,
 * escondidas atrás do botão "Arquivadas".
 */
export function OmieDeParaPanel({
  demonstrativo,
  rubricas,
}: {
  demonstrativo: "dre" | "dfc";
  rubricas: string[];
}) {
  const { acesso } = useAuth();
  const podeEditar = acesso.capacidades.has("conciliacao");
  const [rows, setRows] = useState<MapaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [novo, setNovo] = useState({ categoria: "", rubrica: "" });
  const [adding, setAdding] = useState(false);
  const [saude, setSaude] = useState<Map<string, SaudeDePara>>(new Map());
  const [soOrfas, setSoOrfas] = useState(false);
  const [verArquivadas, setVerArquivadas] = useState(false);

  const carregarSaude = async () => {
    const { data, error } = await supabase.rpc("plano_contas_de_para_saude" as never, { p_demonstrativo: demonstrativo } as never);
    // Acessório: sem o diagnóstico, o painel continua como sempre foi.
    if (error || !Array.isArray(data)) { setSaude(new Map()); return; }
    setSaude(new Map((data as SaudeDePara[]).map((s) => [s.id, s])));
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await tbl()
      .select("*")
      .eq("demonstrativo", demonstrativo)
      .order("codigo_categoria");
    if (error) toast.error(error.message);
    else setRows((data as MapaRow[]) || []);
    setLoading(false);
    void carregarSaude();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [demonstrativo]);

  const rubricasSet = useMemo(() => new Set(rubricas.map(norm)), [rubricas]);
  const resumo = useMemo(() => resumirSaude([...saude.values()], demonstrativo), [saude, demonstrativo]);
  const arquivadas = useMemo(() => rows.filter((r) => r.ativo === false).length, [rows]);

  // Sugestões do autocomplete: rubricas do schema + as já usadas no DE_PARA
  const sugestoes = useMemo(() => {
    const s = new Set<string>(rubricas);
    rows.forEach((r) => r.ativo !== false && r.rubrica && s.add(r.rubrica));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rubricas, rows]);

  const filtered = useMemo(() => {
    const n = norm(q);
    return rows.filter((r) => {
      if ((r.ativo === false) !== verArquivadas) return false;
      if (soOrfas && !(saude.get(r.id) && !saude.get(r.id)!.codigo)) return false;
      return !n || norm(r.codigo_categoria).includes(n) || norm(r.rubrica).includes(n);
    });
  }, [rows, q, soOrfas, saude, verArquivadas]);

  const setLocalRubrica = (id: string, rubrica: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rubrica } : r)));

  const saveRubrica = async (id: string, rubrica: string) => {
    setSavingId(id);
    const { error } = await tbl().update({ rubrica, updated_at: new Date().toISOString() }).eq("id", id);
    setSavingId(null);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    const alvo = rows.find((r) => r.id === id);
    if (!confirm(`Remover o mapeamento de "${alvo?.codigo_categoria}"?`)) return;
    const { error } = await tbl().delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  /* Apontar a linha órfã para o nome que a categoria tem hoje. É o conserto de
     quando o Omie renomeou a categoria por fora — a rubrica fica a mesma. */
  const apontar = async (r: MapaRow, s: SaudeDePara) => {
    if (!s.sugestao_descricao) return;
    setSavingId(r.id);
    const { error } = await tbl()
      .update({ codigo_categoria: s.sugestao_descricao, descricao_categoria: s.sugestao_descricao, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    setSavingId(null);
    if (error) return toast.error(error.message);
    toast.success(`"${r.codigo_categoria}" agora aponta para "${s.sugestao_descricao}".`, {
      description: `Use "Recalcular" no topo para a ${demonstrativo.toUpperCase()} refletir.`,
    });
    await load();
  };

  const add = async () => {
    const categoria = novo.categoria.trim();
    const rubrica = novo.rubrica.trim();
    if (!categoria || !rubrica) return toast.error("Preencha a categoria e a rubrica.");
    setAdding(true);
    const { data, error } = await tbl()
      .insert({ codigo_categoria: categoria, descricao_categoria: categoria, rubrica, demonstrativo })
      .select("*")
      .single();
    setAdding(false);
    if (error) return toast.error(error.message);
    setRows((rs) => [...rs, data as MapaRow].sort((a, b) => a.codigo_categoria.localeCompare(b.codigo_categoria)));
    setNovo({ categoria: "", rubrica: "" });
    toast.success("Mapeamento adicionado.");
    void carregarSaude();
  };

  const listId = `rubricas-${demonstrativo}`;
  const base = baseDoTipo(demonstrativo);
  const colunas = podeEditar && !verArquivadas ? 3 : 2;

  return (
    <div className="px-6 pb-8 pt-4">
      <datalist id={listId}>
        {sugestoes.map((r) => <option key={r} value={r} />)}
      </datalist>

      {!podeEditar && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Só o financeiro edita o DE-PARA. Aqui dá para ler o mapa inteiro e abrir cada categoria no Plano de contas.
        </div>
      )}

      {!verArquivadas && resumo.orfas.length > 0 && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <div className="flex items-start gap-2">
            <Unlink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>{resumo.orfas.length} linha(s) apontam para categorias que não existem mais no Omie</b> — o que cair nelas
              fica fora da {demonstrativo.toUpperCase()}.{" "}
              {resumo.apontaveis > 0 && <>{resumo.apontaveis} mudaram só a pontuação (conserto quase certo). </>}
              {resumo.duplicadas > 0 && <>{resumo.duplicadas} já têm a categoria atual mapeada. </>}
              {resumo.aConferir > 0 && <>{resumo.aConferir} têm o mesmo nome com outro número — confira. </>}
            </span>
          </div>
          <button
            onClick={() => setSoOrfas((v) => !v)}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-amber-100"
          >
            {soOrfas ? "Mostrar todas" : "Só as órfãs"}
          </button>
        </div>
      )}

      {/* Barra: busca + contador */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar por categoria do Omie ou rubrica…"
            className="h-9 pl-8 text-[13px]"
          />
        </div>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          {arquivadas > 0 && (
            <button
              onClick={() => { setVerArquivadas((v) => !v); setSoOrfas(false); }}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition",
                verArquivadas ? "border-foreground/25 bg-secondary text-foreground" : "border-border bg-card hover:bg-secondary",
              )}
              title="Linhas órfãs guardadas como registro — não entram em nada"
            >
              <Archive className="h-3 w-3" /> {verArquivadas ? "Voltar às ativas" : `Arquivadas (${arquivadas})`}
            </button>
          )}
          <span>
            {loading ? "Carregando…" : `${filtered.length} de ${rows.length - (verArquivadas ? rows.length - arquivadas : arquivadas)} ${verArquivadas ? "arquivada(s)" : "mapeamento(s)"} · ${demonstrativo.toUpperCase()}`}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 w-[45%]">Categoria no Omie</th>
              <th className="px-3 py-2">{verArquivadas ? "Rubrica que tinha · por que foi arquivada" : `Rubrica na ${demonstrativo.toUpperCase()}`}</th>
              {colunas === 3 && <th className="px-3 py-2 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {/* Linha de adição */}
            {podeEditar && !verArquivadas && (
              <tr className="border-b border-border bg-muted/20">
                <td className="px-3 py-2">
                  <Input
                    value={novo.categoria}
                    onChange={(e) => setNovo((n) => ({ ...n, categoria: e.target.value }))}
                    placeholder="Nova categoria do Omie…"
                    className="h-8 text-[13px]"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    list={listId}
                    value={novo.rubrica}
                    onChange={(e) => setNovo((n) => ({ ...n, rubrica: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && add()}
                    placeholder="Rubrica de destino…"
                    className="h-8 text-[13px]"
                  />
                </td>
                <td className="px-3 py-2">
                  <Button size="icon" className="h-8 w-8" onClick={add} disabled={adding} title="Adicionar">
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </td>
              </tr>
            )}

            {filtered.map((r) => {
              const desconhecida = r.rubrica && !rubricasSet.has(norm(r.rubrica));
              const s = saude.get(r.id);
              const orfa = !!s && !s.codigo;
              if (verArquivadas) {
                return (
                  <tr key={r.id} className="border-b border-border/60 text-muted-foreground last:border-0">
                    <td className="px-3 py-1.5 line-through decoration-muted-foreground/40">{r.codigo_categoria}</td>
                    <td className="px-3 py-1.5 text-[12px]">
                      <div>{r.rubrica}</div>
                      <div className="text-[11px]">{r.arquivado_motivo ?? "Desativada."}</div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={r.id} className={cn("border-b border-border/60 last:border-0 hover:bg-muted/20", orfa && "bg-amber-50/40")}>
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-foreground/90">{r.codigo_categoria}</div>
                    {s?.codigo && (
                      <Link
                        to={linkPlanoContas({ categoria: s.codigo, base })}
                        className="inline-flex items-center gap-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-foreground"
                        title="Abrir a categoria no Plano de contas"
                      >
                        {s.codigo}{s.inativa ? " · inativa no Omie" : ""} <ArrowUpRight className="h-2.5 w-2.5" />
                      </Link>
                    )}
                    {orfa && (
                      <div className="mt-0.5 space-y-0.5 text-[11px] text-amber-900">
                        <div className="flex items-center gap-1"><Unlink className="h-3 w-3" /> Este nome não existe mais no Omie.</div>
                        {s.sugestao_codigo && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>
                              {s.sugestao_motivo === "pontuacao" ? "Só a pontuação mudou:" : "Mesmo nome, outro número — confira:"}{" "}
                              <Link to={linkPlanoContas({ categoria: s.sugestao_codigo, base })} className="font-medium underline-offset-2 hover:underline">
                                {s.sugestao_descricao}
                              </Link>
                            </span>
                            {s.sugestao_ja_mapeada ? (
                              <span className="text-muted-foreground">· já tem linha própria</span>
                            ) : podeEditar && (
                              <button
                                onClick={() => apontar(r, s)}
                                disabled={savingId === r.id}
                                className="rounded border border-amber-300 bg-white px-1.5 py-px text-[10.5px] font-medium hover:bg-amber-100 disabled:opacity-50"
                              >
                                Apontar para ela
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {podeEditar ? (
                        <Input
                          list={listId}
                          value={r.rubrica}
                          onChange={(e) => setLocalRubrica(r.id, e.target.value)}
                          onBlur={(e) => saveRubrica(r.id, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          className={cn("h-8 text-[13px]", desconhecida && "border-amber-400")}
                        />
                      ) : (
                        <span className="text-[13px]">{r.rubrica}</span>
                      )}
                      {savingId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      {desconhecida && !savingId && (
                        <span title={`"${r.rubrica}" não é uma linha reconhecida da ${demonstrativo.toUpperCase()} — não aparecerá na demonstração até bater com uma rubrica existente.`}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  {colunas === 3 && (
                    <td className="px-3 py-1.5">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(r.id)} title="Remover">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={colunas} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "Nenhum mapeamento cadastrado ainda." : "Nenhum resultado para o filtro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {podeEditar && "Editar a rubrica salva automaticamente ao sair do campo. "}O triângulo âmbar indica rubricas
        que ainda não correspondem a uma linha da {demonstrativo.toUpperCase()}. O código embaixo do nome abre a
        categoria no Plano de contas.
      </p>
    </div>
  );
}
