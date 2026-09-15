import { useEffect, useMemo, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { esquecerCategoriasOmie } from "@/components/demonstracoes/TrocarCategoria";
import { intStr } from "@/pages/cartao/fmt";
import {
  LIMITE_DESCRICAO, dataCurta, ehFolha, ehPosicaoLivre, rubricaDasIrmas, validarDescricao,
  type CategoriaCadastro, type CategoriaPlano,
} from "@/lib/planoContas";

/* ---------------------------------------------------------------------------
 * Criar e renomear uma categoria — NO OMIE.
 *
 * Quem escreve é a Edge Function `omie-plano-contas`; esta tela só monta o pedido
 * e avisa, antes de enviar, o que a função recusaria (nome repetido, longo demais,
 * grupo inativo) e o que a pessoa talvez não saiba (renomear leva o nome novo ao
 * DE-PARA, ao Orçamento e à folha; um nome de folha muda quem vê salário).
 *
 * Desativar e reativar NÃO estão aqui: o Omie aceita o pedido pela API, responde
 * "sucesso" e não muda nada (medido em 15/09/2026). Isso se faz no próprio Omie.
 * ------------------------------------------------------------------------- */

export type Operacao =
  | { tipo: "criar"; superior?: string }
  | { tipo: "renomear"; categoria: CategoriaPlano };

type Resposta = {
  status: "ok" | "erro";
  erro?: string;
  codigo?: string;
  descricao?: string;
  para?: string;
  de_para?: Record<string, string>;
  referencias?: Record<string, number> | null;
  erro_cache?: string | null;
  erro_de_para?: string | null;
  erro_referencias?: string | null;
};

const ROTULO_REFERENCIA: Record<string, string> = {
  dre_mapa: "DE-PARA", orcamento: "Orçamento", folha: "folha", cartao: "Cartão", regra_nota: "regra de nota",
};

export function EditarCategoria({ operacao, categorias, vejoAFolha, onFechar, onFeito }: {
  operacao: Operacao | null;
  categorias: CategoriaPlano[];
  vejoAFolha: boolean;
  onFechar: () => void;
  onFeito: (codigo: string | null) => void;
}) {
  const [superior, setSuperior] = useState("");
  const [descricao, setDescricao] = useState("");
  const [rubricaDre, setRubricaDre] = useState("");
  const [rubricaDfc, setRubricaDfc] = useState("");
  const [tocouRubrica, setTocouRubrica] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [rubricas, setRubricas] = useState<{ dre: string[]; dfc: string[] }>({ dre: [], dfc: [] });

  const cat = operacao?.tipo === "renomear" ? operacao.categoria : null;
  // Nome sem DE-PARA pede rubrica: categoria criada, ou categoria que nunca foi mapeada.
  const pedeRubrica = operacao?.tipo === "criar" || (!!cat && !cat.rubrica_dre && !cat.rubrica_dfc);

  useEffect(() => {
    if (!operacao) return;
    setEnviando(false);
    setMotivo("");
    setTocouRubrica(false);
    setSuperior(operacao.tipo === "criar" ? operacao.superior ?? "" : operacao.categoria.superior ?? "");
    setDescricao(operacao.tipo === "criar" ? "" : operacao.categoria.descricao);
  }, [operacao]);

  // O palpite de rubrica acompanha o grupo até a pessoa escrever uma.
  useEffect(() => {
    if (!pedeRubrica || tocouRubrica || !superior) return;
    setRubricaDre(rubricaDasIrmas(categorias, superior, "dre") ?? "");
    setRubricaDfc(rubricaDasIrmas(categorias, superior, "dfc") ?? "");
  }, [superior, pedeRubrica, tocouRubrica, categorias]);

  useEffect(() => {
    if (!pedeRubrica) return;
    let vivo = true;
    (supabase.from("omie_dre_mapa" as never) as unknown as {
      select: (c: string) => PromiseLike<{ data: { rubrica: string; demonstrativo: string }[] | null }>;
    }).select("rubrica, demonstrativo").then(({ data }) => {
      if (!vivo) return;
      const por = (d: string) => [...new Set((data ?? []).filter((r) => r.demonstrativo === d || r.demonstrativo === "ambos").map((r) => r.rubrica))].sort((a, b) => a.localeCompare(b));
      setRubricas({ dre: por("dre"), dfc: por("dfc") });
    });
    return () => { vivo = false; };
  }, [pedeRubrica]);

  const cadastro: CategoriaCadastro[] = useMemo(
    () => categorias.map((c) => ({ codigo: c.codigo, descricao: c.descricao, superior: c.superior, totalizadora: c.totalizadora, inativa: c.inativa })),
    [categorias],
  );
  const grupos = useMemo(() => categorias.filter((c) => c.totalizadora && !c.inativa), [categorias]);
  const irmas = useMemo(
    () => categorias.filter((c) => c.superior === superior && !c.totalizadora && !c.inativa && !ehPosicaoLivre(c.descricao)),
    [categorias, superior],
  );

  const validacao = operacao ? validarDescricao(descricao, cadastro, cat?.codigo) : null;
  const nomeIgual = !!cat && descricao.trim() === cat.descricao;
  const mudaFolha = !!cat && ehFolha(cat.descricao) !== ehFolha(descricao);

  const podeEnviar = !!operacao && !enviando && !!validacao?.ok && (
    operacao.tipo === "criar" ? !!superior : !nomeIgual && !(mudaFolha && !vejoAFolha)
  );

  async function enviar() {
    if (!operacao || !podeEnviar) return;
    setEnviando(true);
    const body: Record<string, unknown> = { action: operacao.tipo, descricao, motivo: motivo.trim() || undefined };
    if (operacao.tipo === "criar") body.superior = superior;
    else body.codigo = operacao.categoria.codigo;
    if (pedeRubrica) Object.assign(body, { rubrica_dre: rubricaDre.trim() || undefined, rubrica_dfc: rubricaDfc.trim() || undefined });

    const { data, error } = await supabase.functions.invoke("omie-plano-contas", { body });
    setEnviando(false);
    const r = data as Resposta | null;
    if (error || r?.status !== "ok") {
      toast.error(r?.erro ?? `Não consegui falar com o Omie. ${error?.message ?? ""}`, { duration: 12000 });
      return;
    }

    esquecerCategoriasOmie();
    if (operacao.tipo === "criar") {
      const mapa = Object.entries(r.de_para ?? {}).map(([d, rub]) => `${d.toUpperCase()} → ${rub}`).join(" · ");
      toast.success(`Criada no Omie: ${r.codigo} · ${r.descricao}`, {
        description: `${mapa || "Sem rubrica: ela não aparece na DRE/DFC até alguém mapear."} · A conta contábil fica em branco no Omie — avise a contabilidade.`,
        duration: 10000,
      });
    } else {
      const refs = Object.entries(r.referencias ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${ROTULO_REFERENCIA[k] ?? k} (${n})`).join(", ");
      toast.success(`Renomeada no Omie: ${r.para}`, {
        description: `${refs ? `O nome novo foi levado a: ${refs}.` : "Nenhuma tabela do Hub usava o nome antigo."} O Omie pode mostrar o nome antigo por um ou dois minutos.`,
        duration: 10000,
      });
    }
    const avisos = [r.erro_cache, r.erro_de_para, r.erro_referencias].filter(Boolean);
    if (avisos.length) {
      toast.warning("O Omie mudou, mas o Hub não acompanhou tudo — a sincronização diária conserta.", { description: avisos.join(" · "), duration: 12000 });
    }
    onFeito(r.codigo ?? (operacao.tipo === "criar" ? null : operacao.categoria.codigo));
  }

  if (!operacao) return null;

  return (
    <Dialog open={!!operacao} onOpenChange={(aberto) => { if (!aberto && !enviando) onFechar(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{operacao.tipo === "criar" ? "Nova categoria no Omie" : "Renomear categoria"}</DialogTitle>
          <DialogDescription>
            A mudança é feita no Omie agora e o Hub acompanha. Desativar e reativar continuam sendo feitos no Omie.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 text-[12.5px]">
          {cat && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="font-medium text-foreground">{cat.descricao} <span className="font-mono text-[11px] text-muted-foreground">{cat.codigo}</span></div>
              <div className="text-[11.5px] text-muted-foreground">
                {cat.usos ? `${intStr(cat.usos)} lançamento(s) no cache do Omie · último em ${dataCurta(cat.ultimo_uso)}` : "Nenhum lançamento no cache do Omie"}
                {cat.inativa && " · desativada no Omie"}
              </div>
            </div>
          )}

          {operacao.tipo === "criar" && (
            <div className="space-y-1.5">
              <Label htmlFor="pc-grupo">Grupo</Label>
              <select
                id="pc-grupo"
                value={superior}
                onChange={(e) => setSuperior(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
              >
                <option value="">Escolha o grupo…</option>
                {grupos.map((g) => <option key={g.codigo} value={g.codigo}>{g.codigo} · {g.descricao}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="pc-nome">{operacao.tipo === "criar" ? "Nome" : "Nome novo"}</Label>
              <span className={descricao.trim().length > LIMITE_DESCRICAO ? "text-[11px] text-neg" : "text-[11px] text-muted-foreground"}>
                {descricao.trim().length}/{LIMITE_DESCRICAO}
              </span>
            </div>
            <Input id="pc-nome" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: 3.1.2.22 Seguros - Administrativo" autoFocus />
            {descricao.trim() && validacao && "erro" in validacao && <p className="text-[11.5px] text-neg">{validacao.erro}</p>}
            {nomeIgual && <p className="text-[11.5px] text-muted-foreground">É o nome atual.</p>}
            {irmas.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                No grupo hoje: {irmas.slice(0, 5).map((c) => c.descricao).join(" · ")}{irmas.length > 5 ? ` · +${irmas.length - 5}` : ""}.
                O número no começo do nome é a convenção da casa; é por ele que a DRE casa a categoria.
              </p>
            )}
          </div>

          {operacao.tipo === "criar" ? (
            <div className="rounded-md border border-border px-3 py-2 text-[11.5px] text-muted-foreground">
              No Omie, a categoria criada pela API nasce <b>sem conta contábil</b> e sem a DRE interna do Omie — a API não
              permite preencher a conta contábil. Avise a contabilidade para completar no Omie; a DRE do Hub não depende disso.
            </div>
          ) : (
            <div className="rounded-md border border-border px-3 py-2 text-[11.5px] text-muted-foreground">
              O DE-PARA da DRE/DFC, o Orçamento, a folha e o Cartão casam categoria pelo <b>nome</b>. O Hub leva o nome novo
              a essas tabelas junto — sem isso a categoria sairia da DRE no próximo sync.
            </div>
          )}

          {mudaFolha && (
            <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[11.5px] text-warn">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {ehFolha(cat!.descricao)
                  ? "Este nome tira a categoria da folha: os salários lançados nela passam a aparecer para quem não vê a Remuneração."
                  : "Este nome põe a categoria na folha: os lançamentos dela somem para quem não vê a Remuneração."}
                {!vejoAFolha && " Só quem tem acesso à Remuneração pode fazer esta troca."}
              </span>
            </div>
          )}

          {pedeRubrica && (
            <div className="grid gap-3 sm:grid-cols-2">
              <datalist id="pc-rub-dre">{rubricas.dre.map((r) => <option key={r} value={r} />)}</datalist>
              <datalist id="pc-rub-dfc">{rubricas.dfc.map((r) => <option key={r} value={r} />)}</datalist>
              {([["DRE", rubricaDre, setRubricaDre, "pc-rub-dre", rubricas.dre], ["DFC", rubricaDfc, setRubricaDfc, "pc-rub-dfc", rubricas.dfc]] as const).map(([rot, val, set, lista, conhecidas]) => (
                <div key={rot} className="space-y-1.5">
                  <Label>Linha na {rot}</Label>
                  <Input list={lista} value={val} onChange={(e) => { setTocouRubrica(true); set(e.target.value); }} placeholder="Rubrica…" />
                  {!val.trim()
                    ? <p className="text-[11px] text-warn">Sem rubrica, não aparece na {rot}.</p>
                    : conhecidas.length > 0 && !conhecidas.includes(val.trim())
                      ? <p className="text-[11px] text-warn">Rubrica que o DE-PARA ainda não usa.</p>
                      : <p className="text-[11px] text-muted-foreground">Sugerida pelas irmãs do grupo — confira.</p>}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pc-motivo">Motivo <span className="font-normal text-muted-foreground">(opcional, fica na trilha)</span></Label>
            <Textarea id="pc-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className="text-[12.5px]" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={!podeEnviar}>
            {enviando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {enviando ? "Alterando no Omie…" : operacao.tipo === "criar" ? "Criar no Omie" : "Renomear no Omie"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
