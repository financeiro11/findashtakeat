import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { db, fmtBRL } from "./lib";
import { CatDot } from "./components";
import { normalize } from "@/lib/normalize";

export interface KitRow {
  id: string;
  nome: string;
  descricao: string | null;
}

/** O alvo como esta caixa precisa vê-lo — vem do painel que a página já carregou. */
export interface AlvoEscolhivel {
  id: string;
  titulo: string;
  categoria: string | null;
  modo: string;
  preco_alvo: number;
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
  /** Null cria um kit novo. */
  kit: KitRow | null;
  /** Itens atuais do kit em edição: alvo_id → quantidade. */
  itensIniciais: Record<string, number>;
  alvos: AlvoEscolhivel[];
}

export function KitDialog({ aberto, onFechar, onSalvo, kit, itensIniciais, alvos }: Props) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [itens, setItens] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);

  /* Recarrega a cada abertura, e não só na montagem: a caixa fica montada entre
     um "Editar" e outro, e sem isto o segundo kit abriria com os dados do
     primeiro. */
  useEffect(() => {
    if (!aberto) return;
    setNome(kit?.nome ?? "");
    setDescricao(kit?.descricao ?? "");
    setItens({ ...itensIniciais });
    setBusca("");
  }, [aberto, kit, itensIniciais]);

  const filtrados = useMemo(() => {
    const q = normalize(busca.trim());
    const lista = q
      ? alvos.filter((a) => normalize(a.titulo).includes(q) || normalize(a.categoria ?? "").includes(q))
      : alvos;
    /* Escolhido primeiro: numa lista que vai crescer, o item já marcado não pode
       ficar fora da primeira tela — é ele que a pessoa veio conferir. */
    return [...lista].sort((a, b) => {
      const ma = itens[a.id] ? 0 : 1;
      const mb = itens[b.id] ? 0 : 1;
      return ma - mb || a.titulo.localeCompare(b.titulo, "pt-BR");
    });
  }, [alvos, busca, itens]);

  const total = useMemo(
    () => Object.entries(itens).reduce((s, [id, qtd]) => {
      const a = alvos.find((x) => x.id === id);
      return s + (a ? Number(a.preco_alvo) * qtd : 0);
    }, 0),
    [itens, alvos],
  );

  function alternar(id: string) {
    setItens((p) => {
      const novo = { ...p };
      if (novo[id]) delete novo[id];
      else novo[id] = 1;
      return novo;
    });
  }

  async function salvar() {
    const escolhidos = Object.entries(itens);
    if (!nome.trim()) { toast.error("Dê um nome ao kit."); return; }
    if (!escolhidos.length) { toast.error("Um kit sem item não soma nada — escolha ao menos um alvo."); return; }

    setSalvando(true);
    try {
      let kitId = kit?.id;
      if (kitId) {
        const { error } = await db.from("facilities_radar_kits")
          .update({ nome: nome.trim(), descricao: descricao.trim() || null }).eq("id", kitId);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("facilities_radar_kits")
          .insert({ nome: nome.trim(), descricao: descricao.trim() || null }).select("id").single();
        if (error) throw error;
        kitId = data.id as string;
      }

      /* Apaga e reinsere em vez de calcular a diferença. São poucos itens, a
         chave primária é (kit_id, alvo_id) e o estado da caixa É a verdade
         pretendida — um `upsert` sem o delete deixaria de fora justamente a
         remoção, que é a operação mais fácil de esquecer e a mais visível
         quando falha. */
      const { error: eDel } = await db.from("facilities_radar_kit_itens").delete().eq("kit_id", kitId);
      if (eDel) throw eDel;
      const { error: eIns } = await db.from("facilities_radar_kit_itens").insert(
        escolhidos.map(([alvo_id, quantidade]) => ({ kit_id: kitId, alvo_id, quantidade })),
      );
      if (eIns) throw eIns;

      toast.success(kit ? "Kit atualizado." : "Kit criado.");
      onSalvo();
      onFechar();
    } catch (e: any) {
      toast.error(`Não deu para salvar: ${e?.message ?? e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kit ? "Editar kit" : "Novo kit"}</DialogTitle>
          <DialogDescription>
            Um kit soma os alvos que se compram juntos. A quantidade é por unidade do kit — a estação
            com dois monitores leva o mesmo alvo com quantidade 2.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kit-nome">Nome</Label>
            <Input id="kit-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Kit onboarding" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-desc">Descrição <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="kit-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)}
              placeholder="A estação padrão de quem entra" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Itens</Label>
              <span className="text-[11.5px] text-muted-foreground">
                {Object.keys(itens).length} escolhido(s) · teto somado {fmtBRL(total)}
              </span>
            </div>
            {alvos.length > 8 && (
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-8 pl-7 text-[13px]" value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar alvos" />
              </div>
            )}
            <div className="max-h-[240px] space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {filtrados.length === 0 ? (
                <div className="p-3 text-center text-[12px] text-muted-foreground">Nenhum alvo com esse nome.</div>
              ) : filtrados.map((a) => {
                const escolhido = !!itens[a.id];
                return (
                  <div key={a.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50">
                    <Checkbox id={`kit-alvo-${a.id}`} checked={escolhido} onCheckedChange={() => alternar(a.id)} />
                    <label htmlFor={`kit-alvo-${a.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                      <CatDot cat={a.categoria} />
                      <span className="truncate text-[13px] text-foreground">{a.titulo}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">teto {fmtBRL(Number(a.preco_alvo))}</span>
                    </label>
                    {escolhido && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Input
                          type="number" min={1} value={itens[a.id]}
                          onChange={(e) => {
                            const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                            setItens((p) => ({ ...p, [a.id]: n }));
                          }}
                          className="num h-7 w-14 text-right text-[12px]"
                        />
                        <span className="text-[11px] text-muted-foreground">un</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {kit ? "Salvar" : "Criar kit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
