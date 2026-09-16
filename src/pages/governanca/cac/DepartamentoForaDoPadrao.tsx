import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowRightLeft, ChevronRight, Lock, MoreHorizontal, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import {
  MESES, agruparSuspeitas, leituraDoGrupo,
  type EscopoDecisao, type GrupoSuspeita, type SeveridadeDepartamento, type SuspeitaDepartamento,
} from "@/lib/cac";

/* `types.ts` ainda não conhece as RPCs desta migration; o mesmo atalho do
   PainelCAC, só que sem `any` — aqui só se lê o erro. */
const db = supabase as unknown as {
  rpc: (n: string, a?: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
};

function brl(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* O rótulo diz o que o caso faz com o CAC, não o grau de certeza — é a pergunta
   de quem está nesta tela. */
const SELO: Record<SeveridadeDepartamento, { rotulo: string; titulo: string; classe: string }> = {
  alta: {
    rotulo: "muda o CAC",
    titulo: "O dinheiro está contando noutra linha do painel — ou entrando nele, ou saindo dele.",
    classe: "bg-warn-soft text-warn ring-1 ring-inset ring-warn/40",
  },
  media: {
    rotulo: "fora do hábito",
    titulo: "A pessoa vinha sendo paga na categoria do próprio departamento, e este lançamento destoa.",
    classe: "bg-warn/10 text-warn",
  },
  baixa: {
    rotulo: "recorrente",
    titulo: "Vem sendo pago assim. O CAC não muda (a linha conta a pessoa pelo cadastro); a DRE, que separa as equipes pela categoria, sai torta.",
    classe: "bg-muted text-muted-foreground",
  },
};

const ALCANCE: Record<EscopoDecisao, string> = {
  lancamento: "só este lançamento",
  pessoa: "a pessoa nesta família",
  departamento: "o departamento nesta família",
};

type ArgsIgnorar = {
  p_escopo: EscopoDecisao;
  p_familia: string;
  p_cnpj?: string;
  p_departamento?: string;
  p_cod_titulo?: number;
};

/* ---------------------------------------------------------------------------
 * "Esta pessoa está sendo paga no departamento certo?"
 *
 * O primo do alerta de reclassificação da DRE. Lá a régua é o histórico do
 * fornecedor; aqui é o departamento do cadastro, porque o erro que mais pesa no
 * CAC se repete todo mês e o histórico o daria por certo (ver a migration
 * 20260914200000). A lógica mora em `src/lib/cac.ts`, testada.
 *
 * Duas saídas para cada caso: IGNORAR (está certo assim) ou CORRIGIR NO OMIE
 * (`onCorrigir` abre a prévia de → para; quem escreve no ERP é a mesma função da
 * DRE). O caso corrigido some sozinho: a categoria nova é da família certa.
 * ------------------------------------------------------------------------- */
export function DepartamentoForaDoPadrao({ ano, suspeitas, onMudou, onCorrigir }: {
  ano: number;
  suspeitas: SuspeitaDepartamento[];
  onMudou: () => void;
  onCorrigir: (lancamentos: SuspeitaDepartamento[]) => void;
}) {
  const [verIgnoradas, setVerIgnoradas] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const abertas = useMemo(() => agruparSuspeitas(suspeitas), [suspeitas]);
  const ignoradas = useMemo(() => agruparSuspeitas(suspeitas, true), [suspeitas]);
  const grupos = verIgnoradas ? ignoradas : abertas;

  const nAbertas = useMemo(() => suspeitas.filter((s) => !s.decisao_id).length, [suspeitas]);
  const nIgnoradas = suspeitas.length - nAbertas;

  /* O que interessa em uma frase: quanto dinheiro está numa linha que não é a dele. */
  const naLinhaErrada = useMemo(
    () => suspeitas
      .filter((s) => !s.decisao_id && s.linha_id !== s.linha_propria_id)
      .reduce((a, s) => a + (Number(s.valor) || 0), 0),
    [suspeitas],
  );

  const aa = String(ano).slice(2);

  if (!suspeitas.length) return null;

  async function ignorar(args: ArgsIgnorar, mensagem: string) {
    setOcupado(true);
    const { error } = await db.rpc("cac_departamento_ignorar", args);
    setOcupado(false);
    if (error) {
      toast.error("Não consegui registrar a decisão", { description: error.message });
      return;
    }
    toast.success(mensagem, { description: "O caso continua na aba “Ignorados”, com o botão de reabrir." });
    onMudou();
  }

  async function reabrir(l: SuspeitaDepartamento) {
    if (!l.decisao_id) return;
    setOcupado(true);
    const { error } = await db.rpc("cac_departamento_reabrir", { p_id: l.decisao_id });
    setOcupado(false);
    if (error) {
      toast.error("Não consegui reabrir", { description: error.message });
      return;
    }
    toast.success("Reaberto", {
      description: l.decisao_escopo === "lancamento"
        ? "O lançamento voltou para os abertos."
        : `Voltou tudo o que a decisão calava: ${ALCANCE[l.decisao_escopo ?? "lancamento"]}.`,
    });
    onMudou();
  }

  return (
    <Card id="departamento-fora-do-padrao" className="mt-3.5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <TriangleAlert strokeWidth={2.2} className="h-3.5 w-3.5 fill-warn/30 text-warn" />
            Departamento fora do padrão
          </p>
          <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-muted-foreground">
            O título do Omie não guarda departamento: ele está no nome da categoria (“Pessoal - Suporte”).
            Aqui aparece quem está no cadastro e foi pago na categoria de outro departamento.
            Clique na pessoa para ver os lançamentos; o menu de cada caso ignora ou corrige no Omie.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!verIgnoradas && naLinhaErrada > 0 && (
            <span className="text-[11.5px] font-medium text-warn">
              {comValorExato(naLinhaErrada, brl(naLinhaErrada))} contando na linha errada
            </span>
          )}
          <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-card p-[3px]">
            {[false, true].map((ig) => (
              <button
                key={String(ig)}
                type="button"
                onClick={() => { setVerIgnoradas(ig); setAberto(null); }}
                className={cn(
                  "h-6 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors",
                  verIgnoradas === ig ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ig ? `Ignorados (${nIgnoradas})` : `Abertos (${nAbertas})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[12.5px]">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Pessoa</th>
              <th className="px-3 py-2 text-left font-semibold">Pago em</th>
              <th className="px-3 py-2 text-left font-semibold">Competência</th>
              <th className="px-3 py-2 text-left font-semibold">Leitura</th>
              <th className="px-3 py-2 text-right font-semibold">Valor</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <GrupoTR
                key={g.chave}
                g={g}
                aa={aa}
                aberto={aberto === g.chave}
                onToggle={() => setAberto(aberto === g.chave ? null : g.chave)}
                verIgnoradas={verIgnoradas}
                ocupado={ocupado}
                onIgnorar={ignorar}
                onReabrir={reabrir}
                onCorrigir={onCorrigir}
              />
            ))}
            {!grupos.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  {verIgnoradas ? "Nada ignorado." : "Nenhum lançamento aberto fora do padrão."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        A régua é o departamento do cadastro, e o que cada departamento pode receber mora em
        <span className="num"> cac_departamento_familia</span>. A marca na matriz fica na linha onde o dinheiro caiu.
        Mês com cadeado está travado na DRE — a correção no Omie pode exigir reabrir o período lá.
      </p>
    </Card>
  );
}

function GrupoTR({ g, aa, aberto, onToggle, verIgnoradas, ocupado, onIgnorar, onReabrir, onCorrigir }: {
  g: GrupoSuspeita;
  aa: string;
  aberto: boolean;
  onToggle: () => void;
  verIgnoradas: boolean;
  ocupado: boolean;
  onIgnorar: (args: ArgsIgnorar, mensagem: string) => void;
  onReabrir: (l: SuspeitaDepartamento) => void;
  onCorrigir: (lancamentos: SuspeitaDepartamento[]) => void;
}) {
  const selo = SELO[g.severidade];
  const primeiroNome = g.pessoa.split(" ")[0];
  const leitura = useMemo(() => (aberto ? leituraDoGrupo(g) : []), [aberto, g]);

  /* No lado dos ignorados, uma decisão que cala o grupo inteiro se reabre daqui;
     decisões misturadas (um lançamento aqui, a pessoa ali) só por linha. */
  const decisoes = [...new Set(g.lancamentos.map((l) => l.decisao_id).filter(Boolean))];
  const decisaoUnica = decisoes.length === 1 ? g.lancamentos[0] : null;

  return (
    <>
      <tr className="cursor-pointer border-t border-border align-top hover:bg-muted/30" onClick={onToggle}>
        <td className="px-4 py-2">
          <span className="flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
            <span>{g.pessoa}</span>
          </span>
          <span className="block pl-4 text-[11px] text-muted-foreground">
            cadastro: {g.departamento}
            {g.departamento_rh && g.departamento_rh !== g.departamento && (
              <span className={g.rhConcorda ? "text-warn" : undefined}> · RH: {g.departamento_rh}</span>
            )}
          </span>
        </td>
        <td className="px-3 py-2">
          <span className="font-medium">{g.familia}</span>
          <span className="block text-[11px] text-muted-foreground">
            esperado: {g.familias_esperadas.join(" ou ")}
          </span>
        </td>
        <td className="num px-3 py-2 text-muted-foreground">
          {g.meses.map((m) => MESES[m - 1]).join(" · ")}/{aa}
        </td>
        <td className="px-3 py-2">
          <span title={selo.titulo} className={cn("inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-semibold", selo.classe)}>
            {selo.rotulo}
          </span>
          {verIgnoradas && decisaoUnica?.decisao_escopo && (
            <span className="block text-[11px] text-muted-foreground">
              ignorado: {ALCANCE[decisaoUnica.decisao_escopo]}
            </span>
          )}
        </td>
        <td className="num px-3 py-2 text-right font-medium">{comValorExato(g.valor, brl(g.valor))}</td>
        <td className="px-1 py-2" onClick={(e) => e.stopPropagation()}>
          {verIgnoradas ? (
            decisaoUnica && (
              <Button
                size="icon" variant="ghost" className="ghost-icone h-6 w-6"
                disabled={ocupado}
                title={`Reabrir — ${ALCANCE[decisaoUnica.decisao_escopo ?? "lancamento"]}`}
                onClick={() => onReabrir(decisaoUnica)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="ghost-icone h-6 w-6" disabled={ocupado} title="Corrigir ou ignorar">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="text-[11.5px] text-muted-foreground">Está errado</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onCorrigir(g.lancamentos)}>
                  <span className="flex items-start gap-2">
                    <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="flex flex-col">
                      <span className="text-[12.5px]">
                        Corrigir no Omie ({g.lancamentos.length} {g.lancamentos.length === 1 ? "título" : "títulos"})
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Leva a categoria para {g.familias_esperadas.join(" ou ")} — mostra de → para antes de trocar
                      </span>
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11.5px] text-muted-foreground">Está certo assim</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => onIgnorar(
                    { p_escopo: "pessoa", p_familia: g.familia, p_cnpj: g.cnpj },
                    `${primeiroNome} em ${g.familia} ignorado`,
                  )}
                >
                  <span className="flex flex-col">
                    <span className="text-[12.5px]">É normal para {primeiroNome}</span>
                    <span className="text-[11px] text-muted-foreground">
                      Cala {g.familia} para esta pessoa, hoje e nos próximos meses
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onIgnorar(
                    { p_escopo: "departamento", p_familia: g.familia, p_departamento: g.departamento },
                    `${g.departamento} em ${g.familia} ignorado`,
                  )}
                >
                  <span className="flex flex-col">
                    <span className="text-[12.5px]">É normal para todo {g.departamento}</span>
                    <span className="text-[11px] text-muted-foreground">
                      Cala {g.familia} para qualquer pessoa do departamento
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </td>
      </tr>

      {aberto && (
        <tr className="bg-muted/10">
          <td colSpan={6} className="px-4 pb-3 pt-1">
            <ul className="mb-2 ml-8 list-disc space-y-0.5 text-[12px] leading-relaxed">
              {leitura.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <table className="ml-4 w-[calc(100%-1rem)] text-[12px]">
              <tbody>
                {g.lancamentos.map((l) => {
                  const muda = l.linha_id !== l.linha_propria_id;
                  return (
                    <tr key={l.cod_titulo} className="border-t border-border/50">
                      <td className="num w-[92px] px-2 py-1.5 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          {MESES[l.mes - 1]}/{aa}
                          {l.mes_travado && (
                            <span title="Mês travado na DRE — corrigir no Omie pode exigir reabrir o período lá.">
                              <Lock className="h-3 w-3" />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block">{l.categoria_descricao ?? l.categoria}</span>
                        <span className="num block text-[11px] text-muted-foreground">título {l.cod_titulo}</span>
                      </td>
                      <td className={cn("px-2 py-1.5 text-[11.5px]", muda ? "text-warn" : "text-muted-foreground")}>
                        {muda
                          ? `${l.linha_propria_rotulo ?? "fora do CAC"} → ${l.linha_rotulo ?? "fora do CAC"}`
                          : `conta em ${l.linha_rotulo ?? "—"}`}
                      </td>
                      <td className="num px-2 py-1.5 text-right">{comValorExato(l.valor, brl(l.valor))}</td>
                      <td className="w-[128px] px-1 py-1.5 text-right">
                        {verIgnoradas ? (
                          <Button
                            size="icon" variant="ghost" className="ghost-icone h-6 w-6"
                            disabled={ocupado}
                            title={`Reabrir — ${ALCANCE[l.decisao_escopo ?? "lancamento"]}`}
                            onClick={() => onReabrir(l)}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        ) : (
                          <span className="inline-flex items-center gap-0.5">
                            <Button
                              size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]"
                              disabled={ocupado}
                              title="Trocar a categoria deste título no Omie"
                              onClick={() => onCorrigir([l])}
                            >
                              corrigir
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-muted-foreground"
                              disabled={ocupado}
                              title="Cala só este lançamento"
                              onClick={() => onIgnorar(
                                { p_escopo: "lancamento", p_familia: l.familia, p_cnpj: l.cnpj, p_cod_titulo: l.cod_titulo },
                                "Lançamento ignorado",
                              )}
                            >
                              ignorar
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
