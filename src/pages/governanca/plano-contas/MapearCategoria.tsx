import { useEffect, useMemo, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { esquecerCategoriasOmie } from "@/components/demonstracoes/TrocarCategoria";
import { DFC_SCHEMA, DRE_SCHEMA, flattenLabels } from "@/lib/demonstracoes-schema";
import { runOmieSync } from "@/lib/omieSync";
import { chaveDescricao, rubricaDasIrmas, type CategoriaPlano } from "@/lib/planoContas";

/* ---------------------------------------------------------------------------
 * Em que linha da DRE e da DFC esta categoria cai — o DE-PARA de UMA categoria.
 *
 * O mesmo dado do painel DE-PARA das telas de DRE e DFC (`omie_dre_mapa`), só que
 * aberto a partir da categoria, que é onde se sabe de que ela é feita. A chave é a
 * DESCRIÇÃO: uma linha antiga com outra grafia do mesmo nome (caixa, espaço) é
 * substituída pela grafia atual, e não deixada ao lado.
 *
 * Ordem das escritas: primeiro grava a rubrica nova, depois apaga o que sobrou.
 * Ao contrário, uma falha no meio deixaria a categoria sem linha nenhuma.
 * ------------------------------------------------------------------------- */

type LinhaMapa = { id: string; codigo_categoria: string; rubrica: string; demonstrativo: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = () => supabase.from("omie_dre_mapa" as any) as any;

const ESQUEMA = { dre: new Set(flattenLabels(DRE_SCHEMA)), dfc: new Set(flattenLabels(DFC_SCHEMA)) };

export function MapearCategoria({ categoria, categorias, onFechar, onFeito }: {
  categoria: CategoriaPlano | null;
  categorias: CategoriaPlano[];
  onFechar: () => void;
  onFeito: () => void;
}) {
  const [dre, setDre] = useState("");
  const [dfc, setDfc] = useState("");
  const [linhas, setLinhas] = useState<LinhaMapa[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!categoria) return;
    setDre(categoria.rubrica_dre ?? rubricaDasIrmas(categorias, categoria.superior ?? "", "dre") ?? "");
    setDfc(categoria.rubrica_dfc ?? rubricaDasIrmas(categorias, categoria.superior ?? "", "dfc") ?? "");
    let vivo = true;
    tbl().select("id, codigo_categoria, rubrica, demonstrativo").then(({ data }: { data: LinhaMapa[] | null }) => {
      if (vivo) setLinhas(data ?? []);
    });
    return () => { vivo = false; };
  }, [categoria, categorias]);

  const conhecidas = useMemo(() => {
    const por = (d: "dre" | "dfc") => [...new Set([...ESQUEMA[d], ...linhas.filter((l) => l.demonstrativo === d || l.demonstrativo === "ambos").map((l) => l.rubrica)])].sort((a, b) => a.localeCompare(b));
    return { dre: por("dre"), dfc: por("dfc") };
  }, [linhas]);

  if (!categoria) return null;
  const sugeridaDre = !categoria.rubrica_dre && !!dre;
  const sugeridaDfc = !categoria.rubrica_dfc && !!dfc;

  async function salvar() {
    if (!categoria) return;
    setSalvando(true);
    const k = chaveDescricao(categoria.descricao);
    const minhas = linhas.filter((l) => chaveDescricao(l.codigo_categoria) === k);
    const manter = new Set<string>();
    const agora = new Date().toISOString();

    for (const [d, valor] of [["dre", dre.trim()], ["dfc", dfc.trim()]] as const) {
      if (!valor) continue;
      const { data, error } = await tbl()
        .upsert(
          { codigo_categoria: categoria.descricao, descricao_categoria: categoria.descricao, rubrica: valor, demonstrativo: d, ativo: true, updated_at: agora },
          { onConflict: "codigo_categoria,demonstrativo" },
        )
        .select("id")
        .single();
      if (error) { setSalvando(false); toast.error(`Não consegui gravar a linha da ${d.toUpperCase()}: ${error.message}`); return; }
      manter.add(String(data.id));
    }

    // O que sobrou: outra grafia do mesmo nome, "ambos" antigo, ou o demonstrativo que ficou em branco.
    const apagar = minhas.filter((l) => !manter.has(l.id)).map((l) => l.id);
    if (apagar.length) {
      const { error } = await tbl().delete().in("id", apagar);
      if (error) toast.warning(`A linha nova foi gravada, mas não consegui tirar a antiga: ${error.message}`);
    }

    setSalvando(false);
    esquecerCategoriasOmie();
    toast.success(`DE-PARA de ${categoria.descricao} salvo.`, {
      description: "A DRE e a DFC só mudam depois de recalcular (é local, sem gastar API do Omie).",
      duration: 12000,
      action: {
        label: "Recalcular agora",
        onClick: () => {
          toast.promise(runOmieSync({ forcar: false }), {
            loading: "Recalculando a DRE e a DFC com o cache do Omie…",
            success: (r) => (r.status === "ok" ? "DRE e DFC recalculadas." : r.status === "timeout" ? "O recálculo segue em segundo plano." : `Falhou: ${r.erro ?? "erro"}`),
            error: "Não consegui recalcular.",
          });
        },
      },
    });
    onFeito();
  }

  const aviso = (d: "dre" | "dfc", valor: string, sugerida: boolean) => {
    if (!valor.trim()) return <p className="text-[11px] text-warn">Em branco: a categoria fica fora da {d.toUpperCase()}.</p>;
    if (!conhecidas[d].includes(valor.trim())) return <p className="text-[11px] text-warn">Não é uma linha que a {d.toUpperCase()} conhece — não vai aparecer.</p>;
    if (sugerida) return <p className="text-[11px] text-muted-foreground">Sugerida pelas irmãs do grupo — confira.</p>;
    return null;
  };

  return (
    <Dialog open={!!categoria} onOpenChange={(a) => { if (!a && !salvando) onFechar(); }}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Linha na DRE e na DFC</DialogTitle>
          <DialogDescription>
            {categoria.descricao} <span className="font-mono text-[11px]">{categoria.codigo}</span> · o mesmo DE-PARA das telas de DRE e DFC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[12.5px]">
          <datalist id="mapear-dre">{conhecidas.dre.map((r) => <option key={r} value={r} />)}</datalist>
          <datalist id="mapear-dfc">{conhecidas.dfc.map((r) => <option key={r} value={r} />)}</datalist>
          <div className="space-y-1.5">
            <Label>DRE (competência)</Label>
            <Input list="mapear-dre" value={dre} onChange={(e) => setDre(e.target.value)} placeholder="Rubrica da DRE…" />
            {aviso("dre", dre, sugeridaDre)}
          </div>
          <div className="space-y-1.5">
            <Label>DFC (caixa)</Label>
            <Input list="mapear-dfc" value={dfc} onChange={(e) => setDfc(e.target.value)} placeholder="Rubrica da DFC…" />
            {aviso("dfc", dfc, sugeridaDfc)}
          </div>
          {categoria.folha && (
            <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Categoria de folha: o valor aparece na linha escolhida; os lançamentos seguem restritos a quem vê a Remuneração.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Salvar DE-PARA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
