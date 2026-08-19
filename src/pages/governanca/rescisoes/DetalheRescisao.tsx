/* O espelho da rescisão — é aqui que "de que esses R$ 38 mil são feitos?" tem
 * resposta.
 *
 * A tabela de verbas segue a ordem em que se lê um espelho de verdade
 * (proventos → descontos → FGTS → informativo) e mostra REFERÊNCIA e FÓRMULA ao
 * lado do valor: sem elas, "Férias proporcionais 4.812,50" não dá para conferir
 * nem para explicar em reunião — que é justamente o que a skill sabe fazer e
 * ninguém conseguia guardar.
 *
 * FGTS e informativo aparecem separados de propósito. A multa de 40% vai para a
 * conta do FGTS, não para o bolso de quem saiu: somada como provento, estouraria
 * o líquido em 40%.
 */

import { Fragment, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, AlertTriangle, Check, ChevronDown, CalendarClock, Wallet, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import {
  MOTIVOS, SITUACOES, AVISOS, TIPOS_VERBA,
  agruparVerbas, alertasDe, brlStr, conferir, custoDe, encargosDe, fmtData,
  fontesDe, prazo, rotuloPrazo, rotuloRemuneracao, tempoDeCasa,
  type Rescisao, type Verba,
} from "@/lib/rescisoes";

const brl = (n: number | null | undefined) => comValorExato(n, brlStr(n));

/** Hoje em 'YYYY-MM-DD' local — o `toISOString` daria o dia anterior à noite. */
function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DetalheRescisao({ r, verbas, onFechar, onSituacao }: {
  r: Rescisao | null;
  verbas: Verba[];
  onFechar: () => void;
  onSituacao: (r: Rescisao, situacao: string, dataPagamento?: string | null) => Promise<void>;
}) {
  const [salvando, setSalvando] = useState<string | null>(null);
  const [dataPg, setDataPg] = useState(hojeISO());
  const [memoriaAberta, setMemoriaAberta] = useState(false);
  const [respostaAberta, setRespostaAberta] = useState(false);

  /* Por `id` e pela data, não pelo objeto: a lista recarrega depois de cada
     mudança de situação e uma dependência no objeto fecharia a memória de
     cálculo que a pessoa acabou de abrir. */
  useEffect(() => {
    if (!r) return;
    setDataPg(r.data_pagamento ?? hojeISO());
    setMemoriaAberta(false);
    setRespostaAberta(false);
  }, [r?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!r) return null;

  const conf = conferir(r, verbas);
  const grupos = agruparVerbas(verbas);
  const casa = tempoDeCasa(r.admissao, r.desligamento);
  const p = prazo(r);
  const fgtsCaixa = encargosDe(r);
  const fontes = fontesDe(r);
  const alertas = alertasDe(r);

  /* A ficha é montada e só depois filtrada: uma rescisão PJ não tem aviso prévio
     e uma CLT não tem dias de férias tirados. Campo vazio em grade fixa vira
     "—" espalhado pela tela e faz parecer que falta dado. */
  const ficha: { rotulo: string; valor: string }[] = [
    { rotulo: "Admissão", valor: fmtData(r.admissao) },
    { rotulo: "Desligamento", valor: fmtData(r.desligamento) },
    { rotulo: "Tempo de casa", valor: casa ? casa.texto : "" },
    {
      rotulo: rotuloRemuneracao(r.vinculo),
      valor: r.salario_base != null
        ? `${brlStr(r.salario_base)}${r.fonte_remuneracao ? ` (${r.fonte_remuneracao})` : ""}`
        : "",
    },
    { rotulo: "Vínculo", valor: (r.vinculo ?? "").toUpperCase() },
    { rotulo: "Iniciativa", valor: MOTIVOS[r.motivo]?.label ?? r.motivo },
    { rotulo: "Meses para férias", valor: r.meses_trabalhados != null ? `${r.meses_trabalhados} meses` : "" },
    { rotulo: "Férias já tiradas", valor: r.dias_ferias_tirados != null ? `${r.dias_ferias_tirados} dias` : "" },
    {
      rotulo: "Dias no mês de saída",
      valor: r.dias_trabalhados_mes != null && r.dias_mes_saida != null
        ? `${r.dias_trabalhados_mes} de ${r.dias_mes_saida}`
        : "",
    },
    {
      rotulo: "Aviso prévio",
      valor: r.aviso_previo
        ? `${AVISOS[r.aviso_previo] ?? r.aviso_previo}${r.aviso_dias ? ` · ${r.aviso_dias} dias` : ""}`
        : "",
    },
    { rotulo: "Aviso comunicado em", valor: r.aviso_em ? fmtData(r.aviso_em) : "" },
  ].filter((c) => c.valor.trim() !== "");

  async function acao(situacao: string, data?: string | null) {
    setSalvando(situacao);
    try { await onSituacao(r!, situacao, data); }
    finally { setSalvando(null); }
  }

  return (
    <Dialog open={!!r} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {r.colaborador}
            <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">
              {[r.cargo, r.departamento ?? r.centro_custo].filter(Boolean).join(" · ")}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* ---------- a ficha ---------- */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/20 px-3 py-2.5 text-[12px] sm:grid-cols-4">
            {ficha.map((c) => <Campo key={c.rotulo} rotulo={c.rotulo} valor={c.valor} />)}
          </div>

          {/* O motivo escrito pelo gestor no e-mail: é ele que explica a saída —
              a etiqueta só diz de quem partiu a iniciativa. */}
          {r.motivo_texto && (
            <p className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">Motivo do desligamento:</span> “{r.motivo_texto}”
            </p>
          )}

          {/* ---------- os totais ---------- */}
          <div className={cn("grid grid-cols-2 gap-2", fgtsCaixa ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            <Total rotulo="Proventos" valor={Number(r.total_proventos)} />
            <Total rotulo="(−) Descontos" valor={Number(r.total_descontos)} />
            <Total rotulo="= Total a receber" valor={Number(r.liquido)} destaque />
            {/* Em PJ o custo da empresa É o total a receber — repetir o número
                em dois cartões só faria duvidar de qual é o certo. */}
            {fgtsCaixa > 0 && (
              <Total
                rotulo="Custo da empresa"
                valor={custoDe(r)}
                forte
                nota={`com FGTS e encargos de ${brlStr(fgtsCaixa)}`}
              />
            )}
          </div>

          {/* ---------- ressalvas da skill ----------
              "Variável não informado no e-mail", "tirou mais férias do que tinha
              direito": é o que ninguém lembra um mês depois e o que muda a
              leitura do número. */}
          {alertas.length > 0 && (
            <div className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12px]">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-warn">
                <AlertTriangle className="h-3.5 w-3.5" />
                {alertas.length === 1 ? "Ressalva do cálculo" : "Ressalvas do cálculo"}
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {alertas.map((a) => <li key={a}>• {a}</li>)}
              </ul>
            </div>
          )}

          {/* ---------- conferência ----------
              O total é da skill; a soma é das verbas. Quando discordam, mostra-se
              a diferença em vez de escolher um dos dois em silêncio. */}
          {conf.semVerbas ? (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
              A skill gravou só os totais desta rescisão — sem as verbas não há detalhamento para conferir.
            </div>
          ) : conf.fecha ? (
            <div className="flex items-center gap-1.5 rounded-md border border-pos/30 bg-pos-soft px-3 py-2 text-[12px] text-pos">
              <Check className="h-3.5 w-3.5" />
              As {verbas.length} verbas somam exatamente o total calculado.
            </div>
          ) : (
            <div className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12px]">
              <p className="flex items-center gap-1.5 font-medium text-warn">
                <AlertTriangle className="h-3.5 w-3.5" />
                A soma das verbas não fecha com o total calculado
              </p>
              <p className="mt-1 text-muted-foreground">
                Verbas: proventos {brlStr(conf.proventos)} − descontos {brlStr(conf.descontos)} ={" "}
                <b>{brlStr(conf.liquido)}</b>. Total gravado pela skill: <b>{brlStr(r.liquido)}</b>{" "}
                (diferença de {brlStr(Math.abs(conf.difLiquido))}). O cálculo precisa ser corrigido na
                origem — a tela não soma por cima.
              </p>
            </div>
          )}

          {/* ---------- o detalhamento ---------- */}
          {grupos.length > 0 && (
            <div className="max-h-[42vh] overflow-y-auto rounded-md border border-border">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-semibold">Verba</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Referência</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Base</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <Fragment key={g.tipo}>
                      <tr className="border-t border-border bg-muted/30">
                        <td colSpan={3} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {TIPOS_VERBA[g.tipo].label}
                          <span className="ml-1.5 font-normal normal-case tracking-normal">
                            · {TIPOS_VERBA[g.tipo].nota}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-right num text-[11.5px] font-semibold">
                          {g.tipo === "informativo" ? "" : brlStr(g.total)}
                        </td>
                      </tr>
                      {g.itens.map((v) => (
                        <tr key={v.id} className="border-t border-border/50">
                          <td className="px-3 py-1.5">
                            <div>{v.rubrica}</div>
                            {(v.formula || v.fundamento || v.incide_inss != null) && (
                              <div className="text-[10.5px] text-muted-foreground">
                                {v.formula}
                                {v.formula && (v.fundamento || v.incide_inss != null) ? " · " : ""}
                                {v.fundamento}
                                {incidencias(v) && (
                                  <>
                                    {(v.formula || v.fundamento) ? " · " : ""}
                                    incide {incidencias(v)}
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{v.referencia ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right num text-muted-foreground">
                            {v.base != null ? brlStr(v.base) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-1.5 text-right num",
                              v.tipo === "desconto" && "text-neg",
                              v.tipo === "informativo" && "text-muted-foreground",
                            )}
                            title={valorExato(v.valor)}
                          >
                            {v.tipo === "desconto" ? "− " : ""}{brlStr(v.valor)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ---------- memória de cálculo ---------- */}
          {r.memoria_md && (
            <div className="rounded-md border border-border">
              <button
                onClick={() => setMemoriaAberta((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-[12.5px] font-medium hover:bg-muted/30"
              >
                Memória de cálculo da skill
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", memoriaAberta && "rotate-180")} />
              </button>
              {memoriaAberta && (
                <div className="border-t border-border px-3 py-2">
                  <div className="prose prose-sm max-w-none text-[12.5px] prose-p:my-1 prose-ul:my-1 prose-headings:my-1.5 prose-headings:text-[13px] dark:prose-invert">
                    <ReactMarkdown>{r.memoria_md}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---------- a resposta como a skill imprimiu ----------
              Os números da tela saem das colunas, não daqui — mas o bloco pronto
              é o que se reenvia no WhatsApp sem ter de redigitar. */}
          {r.texto_resposta && (
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  onClick={() => setRespostaAberta((v) => !v)}
                  className="flex flex-1 items-center justify-between text-left text-[12.5px] font-medium"
                >
                  Resposta da skill
                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", respostaAberta && "rotate-180")} />
                </button>
                <button
                  className="chip ml-2"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(r!.texto_resposta!); toast.success("Texto copiado."); }
                    catch { toast.error("Não consegui copiar."); }
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copiar
                </button>
              </div>
              {respostaAberta && (
                <pre className="max-h-[36vh] overflow-auto border-t border-border px-3 py-2 text-[11.5px] leading-relaxed">
                  {r.texto_resposta}
                </pre>
              )}
            </div>
          )}

          {/* ---------- fontes ----------
              A skill sempre lista de onde tirou cada dado (planilha de RH, e-mail
              do gestor, política de multa). Sem isso, conferir o cálculo obriga a
              refazê-lo. */}
          {fontes.length > 0 && (
            <div className="rounded-md border border-border px-3 py-2 text-[11.5px]">
              <p className="mb-1 font-medium">Fontes consultadas</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {fontes.map((f) => (
                  <li key={f.texto}>
                    {f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {f.texto} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <>• {f.texto}</>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---------- pagamento ----------
              Quem grava a data aqui é o Hub, não a skill: regravar o cálculo não
              pode apagar "paga em 20/08". */}
          <div className="rounded-md border border-border px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  {SITUACOES[r.situacao]?.label ?? r.situacao}
                </span>
                <span className={cn(
                  "ml-2",
                  p.estado === "atrasado" && "font-semibold text-neg",
                  p.estado === "hoje" && "font-semibold text-warn",
                  p.estado === "pago" && "text-pos",
                  (p.estado === "no_prazo" || p.estado === "sem_prazo" || p.estado === "cancelada") && "text-muted-foreground",
                )}>
                  {p.texto}
                </span>
                {p.estado !== "pago" && r.data_pagamento_prevista && (
                  <span className="ml-2 text-muted-foreground" title={rotuloPrazo(r).explicacao}>
                    {rotuloPrazo(r).curto}: {fmtData(r.data_pagamento_prevista)}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {r.situacao !== "cancelada" && (
                  <>
                    {r.situacao === "calculada" && (
                      <button className="chip" onClick={() => acao("conferida")} disabled={!!salvando}>
                        {salvando === "conferida" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Marcar conferida
                      </button>
                    )}
                    {r.situacao !== "paga" && (
                      <>
                        <input
                          type="date"
                          value={dataPg}
                          onChange={(e) => setDataPg(e.target.value)}
                          className="h-[26px] rounded-md border border-border bg-background px-2 text-[12px]"
                        />
                        <button className="chip" onClick={() => acao("paga", dataPg)} disabled={!!salvando}>
                          {salvando === "paga" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                          Marcar paga
                        </button>
                      </>
                    )}
                    {r.situacao === "paga" && (
                      <button className="chip" onClick={() => acao("conferida")} disabled={!!salvando}>
                        {salvando === "conferida" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Desfazer pagamento
                      </button>
                    )}
                  </>
                )}
                <button
                  className="chip"
                  onClick={() => acao(r.situacao === "cancelada" ? "calculada" : "cancelada")}
                  disabled={!!salvando}
                  title={
                    r.situacao === "cancelada"
                      ? "Volta a contar nas somas do período"
                      : "Sai das somas e fica riscada na lista — para cálculo que não virou desligamento"
                  }
                >
                  {salvando === "cancelada" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {r.situacao === "cancelada" ? "Reativar" : "Cancelar"}
                </button>
              </div>
            </div>

            {r.observacao && <p className="mt-2 text-[11.5px] text-muted-foreground">{r.observacao}</p>}
          </div>

          {/* ---------- carimbo ---------- */}
          <p className="text-[11px] text-muted-foreground">
            {r.fonte ? `calculado por ${r.fonte}` : "origem não informada"}
            {r.skill_versao ? ` v${r.skill_versao}` : ""}
            {r.calculado_em ? ` em ${new Date(r.calculado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
            {" · gravado no Hub "}
            {new Date(r.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
            {r.arquivo ? ` · origem: ${r.arquivo}` : ""}
            {r.cpf ? ` · CPF ${r.cpf}` : ""}
            {r.matricula ? ` · matrícula ${r.matricula}` : ""}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "incide INSS, FGTS" — explica por que a base do desconto não é o total. */
function incidencias(v: Verba): string {
  const l: string[] = [];
  if (v.incide_inss) l.push("INSS");
  if (v.incide_irrf) l.push("IRRF");
  if (v.incide_fgts) l.push("FGTS");
  return l.join(", ");
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className="num text-[12.5px]">{valor}</div>
    </div>
  );
}

function Total({ rotulo, valor, forte, destaque, nota }: {
  rotulo: string; valor: number; forte?: boolean; destaque?: boolean; nota?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border px-3 py-2", destaque && "border-primary/40 bg-primary/5")}>
      <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={cn("num text-[14px]", (forte || destaque) && "font-semibold", destaque && "text-primary")}>
        {brl(valor)}
      </p>
      {nota && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{nota}</p>}
    </div>
  );
}
