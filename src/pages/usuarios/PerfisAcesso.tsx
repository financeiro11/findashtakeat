// A matriz de acesso, editável.
//
// Até 10/09/2026 mudar o que a liderança enxerga era editar TypeScript, buildar
// e publicar. Agora é esta tela: linhas são capacidades (conjuntos de telas que
// andam juntas), colunas são os perfis, e cada marca é uma decisão.
//
// O QUE ESTA TELA MUDA, E O QUE NÃO MUDA. Ela muda o que aparece no menu, no ⌘K
// e o que a rota digitada deixa abrir. Ela NÃO muda o que o banco entrega: das
// 222 tabelas, ~206 respondem a qualquer pessoa autenticada que chame o
// PostgREST direto. As duas exceções — "Pessoas e folha" e "Assistente" — têm
// trava de verdade no Postgres e leem a MESMA linha que esta tela escreve, então
// nelas desmarcar significa mesmo fechar. O selo na tabela diz quais são.
//
// A COLUNA DO ADMIN NÃO ABRE. Se desse para tirar "Administração" do admin, esta
// própria tela ficaria inalcançável e o conserto passaria a exigir SQL direto no
// banco. A trava é dupla: aqui os checkboxes vêm desabilitados, e no Postgres o
// trigger `acesso_perfil_guarda` reescreve a linha do admin cheia, aconteça o
// que acontecer com o PATCH.

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, ShieldCheck, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  CAPACIDADES, CAPACIDADES_ORDEM, PERFIS,
  matrizDeLinhas, type Capacidade, type PerfilId,
} from "@/lib/modules";
import { telasDaCapacidade } from "@/lib/navegacao";
import {
  COLUNAS, clonar, paraGravar, paraLinhas, perfisAlterados, alternar as alternarCelula,
  restaurarPadrao as restaurarColuna, type Linhas,
} from "./matriz";
import { toast } from "sonner";

/**
 * As capacidades cuja trava vale também no banco.
 *
 * `pode_ver_remuneracao()` e `pode_usar_assistente()` leem `acesso_perfil` — a
 * mesma linha que esta tela grava. Todo o resto é só vista, e dizer isso na
 * própria tela evita a leitura errada de que desmarcar protege o dado.
 */
const COM_TRAVA_REAL = new Set<Capacidade>(["remuneracao", "assistente"]);


export default function PerfisAcesso() {
  const { user, recarregarMatriz } = useAuth();
  const [salvo, setSalvo] = useState<Linhas | null>(null);
  const [rascunho, setRascunho] = useState<Linhas | null>(null);
  const [pessoas, setPessoas] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    const [{ data: linhas }, { data: perfis }] = await Promise.all([
      supabase.from("acesso_perfil").select("perfil, capacidades"),
      supabase.from("profiles").select("perfil"),
    ]);
    const m = paraLinhas(matrizDeLinhas(linhas as { perfil: string; capacidades: string[] | null }[]));
    setSalvo(m);
    setRascunho(clonar(m));
    const contagem: Record<string, number> = {};
    for (const p of (perfis ?? []) as { perfil: string | null }[]) {
      const k = p.perfil ?? "restrito";
      contagem[k] = (contagem[k] ?? 0) + 1;
    }
    setPessoas(contagem);
    setCarregando(false);
  };

  useEffect(() => { void carregar(); }, []);

  /* Quais perfis mudaram — é o que o botão salva, e é o que o rodapé conta.
     Gravar só o que mudou mantém `atualizado_em` honesto: a data diz quando
     aquele perfil mudou, não quando alguém abriu a tela e clicou em salvar. */
  const alterados = useMemo<PerfilId[]>(
    () => (salvo && rascunho ? perfisAlterados(salvo, rascunho) : []),
    [salvo, rascunho],
  );

  const alternar = (perfil: PerfilId, cap: Capacidade) =>
    setRascunho((r) => (r ? alternarCelula(r, perfil, cap) : r));

  const restaurarPadrao = (perfil: PerfilId) =>
    setRascunho((r) => (r ? restaurarColuna(r, perfil) : r));

  const salvar = async () => {
    if (!rascunho || alterados.length === 0) return;
    setSalvando(true);
    const { error } = await supabase
      .from("acesso_perfil")
      .upsert(paraGravar(rascunho, alterados, user?.id ?? null), { onConflict: "perfil" });
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success(
      alterados.length === 1
        ? `Acesso de ${PERFIS[alterados[0]].label} atualizado.`
        : `${alterados.length} perfis atualizados.`,
    );
    // A matriz do contexto tem de reler ANTES da tela: é ela que monta o menu de
    // quem está logado, e quem acabou de editar pode ter mexido no próprio.
    await recarregarMatriz();
    await carregar();
  };

  if (carregando || !rascunho || !salvo) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando a matriz…
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">O que cada perfil enxerga</h3>
        <p className="max-w-4xl text-sm text-muted-foreground">
          Cada linha é um conjunto de telas que andam juntas. Marcar libera o item no menu, na busca
          (⌘K) e na rota digitada. Perfil que você não tocar segue o padrão escrito no código.
        </p>
      </div>

      <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-200">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong className="font-semibold">Esconder não é proteger.</strong> Desmarcar tira a tela da
          frente da pessoa, mas a maior parte das tabelas ainda responde a quem chamar a API direto.
          As duas linhas marcadas com <Badge variant="outline" className="mx-0.5 px-1 py-0 text-[10px] align-middle">trava real</Badge>
          são a exceção: nelas o próprio banco recusa, porque a regra lê esta mesma matriz.
        </p>
      </div>

      <Card className="border-border shadow-[var(--shadow-card)]">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/40 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Capacidade
                </th>
                {COLUNAS.map((p) => (
                  <th key={p.id} className="px-2 py-2 text-center align-bottom" title={p.resumo}>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {p.label.replace(" (consultoria)", "")}
                    </div>
                    <div className="mt-0.5 text-[10.5px] font-normal normal-case tracking-normal text-muted-foreground/70">
                      {p.id === "admin"
                        ? "fixo"
                        : `${pessoas[p.id] ?? 0} ${(pessoas[p.id] ?? 0) === 1 ? "pessoa" : "pessoas"}`}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPACIDADES_ORDEM.map((cap) => {
                const telas = telasDaCapacidade(cap);
                return (
                  <tr key={cap} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="sticky left-0 z-10 max-w-[340px] bg-card px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{CAPACIDADES[cap].label}</span>
                        {COM_TRAVA_REAL.has(cap) && (
                          <Badge
                            variant="outline"
                            className="px-1 py-0 text-[10px]"
                            title="O banco também recusa — a policy lê esta mesma matriz."
                          >
                            trava real
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11.5px] leading-snug text-muted-foreground">
                        {CAPACIDADES[cap].descricao}
                      </div>
                      {telas.length > 0 && (
                        <div className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
                          {telas.join(" · ")}
                        </div>
                      )}
                    </td>
                    {COLUNAS.map((p) => {
                      const marcado = rascunho[p.id].has(cap);
                      const mudou = marcado !== salvo[p.id].has(cap);
                      return (
                        <td key={p.id} className="px-2 py-2.5 text-center">
                          <Checkbox
                            checked={marcado}
                            disabled={p.id === "admin"}
                            onCheckedChange={() => alternar(p.id, cap)}
                            className={mudou ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}
                            aria-label={`${CAPACIDADES[cap].label} para ${p.label}`}
                            title={p.id === "admin"
                              ? "O admin tem tudo, sempre — é quem conserta o acesso dos outros."
                              : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20">
                <td className="sticky left-0 z-10 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
                  Voltar ao padrão do código
                </td>
                {COLUNAS.map((p) => (
                  <td key={p.id} className="px-2 py-2 text-center">
                    {p.id !== "admin" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ghost-icone h-7 w-7"
                        title={`Restaurar o padrão de ${p.label}`}
                        onClick={() => restaurarPadrao(p.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* A barra só aparece com mudança pendente — e diz QUAIS perfis mudaram,
          porque numa matriz de 17×8 é fácil marcar a célula errada e não notar. */}
      {alterados.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <p className="text-[12.5px] text-muted-foreground">
              Alterações não salvas em{" "}
              <strong className="font-medium text-foreground">
                {alterados.map((id) => PERFIS[id].label).join(", ")}
              </strong>
              .
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRascunho(clonar(salvo))}>
                Desfazer
              </Button>
              <Button size="sm" onClick={salvar} disabled={salvando}>
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
