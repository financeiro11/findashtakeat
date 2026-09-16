/* ---------------------------------------------------------------------------
 * FICHA DO CLIENTE — o que cada sistema diz, num lugar só (16/09/2026).
 *
 * O PEDIDO: "eu conserto uma coisa e descubro outra". A AEVO saiu com o endereço
 * velho porque o Omie não tinha sido corrigido; a EMME saiu para a Vespera
 * porque a OS antiga apontava para outro cadastro. Nos dois casos a informação
 * existia — espalhada entre Asaas, Omie e Receita, e ninguém a via junta.
 *
 * A REGRA DA TELA: a coluna do OMIE é a que vai para a nota, e está marcada
 * assim. Linha que diverge do Asaas ou da Receita fica em âmbar. OS de cobrança
 * deste cliente que aponta para OUTRO cadastro do Omie fica em vermelho.
 *
 * Um painel e não uma página: abre por um clique no nome do cliente, busca
 * qualquer outro por nome/CNPJ/id, e tem endereço próprio (`?cliente=`).
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Loader2, Search, TriangleAlert, CheckCircle2, ExternalLink, Link2, ChevronDown } from "lucide-react";
import { formatarDoc, linkPortalNacional, statusAsaas } from "@/lib/notasFiscais";
import { EditarCadastroCliente } from "./EditarCadastroCliente";
import { toast } from "sonner";

const sb = supabase as any;

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const data = (s: string | null | undefined) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");
const dataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

async function mensagemDe(error: any, dados: any): Promise<string> {
  if (dados?.erro) return String(dados.erro);
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.erro) return String(corpo.erro);
  } catch { /* sem corpo legível */ }
  return error?.message ?? "Erro sem mensagem.";
}

interface Linha {
  campo: string; rotulo: string;
  asaas: string | null; omie: string | null; receita: string | null;
  difere_asaas: boolean; difere_receita: boolean;
}
interface Ficha {
  doc: string; doc_formatado: string; nome: string;
  id_customer: string | null; n_cod_cli: number | null; codigos_omie: number[];
  asaas_ao_vivo: boolean; erro_leitura_omie: string | null;
  comparacao: Linha[];
  omie: Record<string, string> | null;
  asaas: Record<string, string | null>;
  receita: { razao_social: string | null; situacao: string | null; data_situacao: string | null; atividade: string | null; abertura: string | null } | null;
  conferencia: Array<{ id_customer: string; resultado: string; detalhe: string | null; tentativas: number; sincronizado_em: string }>;
  antes_do_pagamento: Array<{ tipo: string; ativo: boolean; motivo: string; criado_por: string | null; criado_em: string }>;
  cobrancas: Array<{ id_asaas: string; valor: number; status: string; vencimento: string | null; pagamento: string | null; descricao: string | null; forma: string | null; link: string | null }>;
  notas: Array<{
    n_cod_os: number; c_num_os: string | null; c_cod_int_os: string | null; n_cod_cli: number | null;
    valor: number; nfse_numero: string | null; nfse_status: string | null; nfse_mensagem: string | null;
    nfse_verificacao: string | null; faturada: boolean; cancelada: boolean; data_faturamento: string | null;
    outro_cliente: boolean;
  }>;
  notas_sem_cobranca: Array<{ id: string; valor: number; descricao: string; vencimento: string; criado_em: string }>;
  correcoes: Array<{ origem: string; fonte: string | null; operador: string | null; quando: string; ok: boolean | null; escrito: any; motivo: string | null }>;
  brutos: { asaas: any[]; omie: any; receita: any };
}

const ORIGEM: Record<string, string> = {
  manual: "correção pela tela", automatico: "rodada automática", preventivo: "pré-voo",
  emissao: "conferência antes de emitir", edicao: "edição à mão", edicao_falhou: "edição sem efeito",
};

export function FichaCliente({
  busca, onFechar,
}: {
  /** O que abrir: documento, nome, `pay_…` ou `cus_…`. `null` fecha; "" abre vazio. */
  busca: string | null;
  onFechar: () => void;
}) {
  const [termo, setTermo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [candidatos, setCandidatos] = useState<Array<{ doc: string; nome: string; fonte: string }> | null>(null);
  const [verBrutos, setVerBrutos] = useState(false);

  const carregar = useCallback(async (q: string) => {
    const t = q.trim();
    if (!t) return;
    setCarregando(true);
    setCandidatos(null);
    try {
      const { data: d, error } = await sb.functions.invoke("omie-clientes-criar", {
        body: { action: "ficha_cliente", busca: t },
      });
      if (error || d?.status !== "ok") throw new Error(await mensagemDe(error, d));
      if (Array.isArray(d.candidatos)) {
        setFicha(null);
        setCandidatos(d.candidatos);
        if (!d.candidatos.length) toast.info("Nenhum cliente com esse nome no Asaas nem no Omie.");
        return;
      }
      setFicha(d as Ficha);
      setTermo(d.doc_formatado);
      // O endereço da tela passa a apontar para este cliente — é o link que se manda.
      const url = new URL(window.location.href);
      url.searchParams.set("cliente", d.doc);
      window.history.replaceState(null, "", url.toString());
    } catch (e: any) {
      toast.error("Não deu para abrir a ficha.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (busca === null) return;
    setFicha(null); setCandidatos(null); setVerBrutos(false);
    setTermo(busca);
    if (busca.trim()) void carregar(busca);
  }, [busca, carregar]);

  const fechar = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("cliente");
    window.history.replaceState(null, "", url.toString());
    onFechar();
  };

  const diverge = ficha?.comparacao.filter((l) => l.difere_asaas) ?? [];
  const outroCliente = ficha?.notas.filter((n) => n.outro_cliente && !n.cancelada) ?? [];

  return (
    <Sheet open={busca !== null} onOpenChange={(v) => !v && fechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="text-base">Ficha do cliente</SheetTitle>
          <SheetDescription className="text-xs">
            Asaas, Omie e Receita lado a lado. A nota fiscal sai com o que está no <strong>Omie</strong>.
          </SheetDescription>
        </SheetHeader>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); void carregar(termo); }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome, CNPJ/CPF, pay_… ou cus_…"
              className="h-8 pl-7 text-xs"
              autoFocus={!busca}
            />
          </div>
          <button
            type="submit"
            disabled={carregando || termo.trim().length < 3}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"
          >
            {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Abrir
          </button>
        </form>

        {candidatos && candidatos.length > 0 && (
          <div className="mt-3 divide-y divide-border rounded-md border border-border text-xs">
            {candidatos.map((c) => (
              <button
                key={c.doc}
                onClick={() => void carregar(c.doc)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
              >
                <span className="truncate font-medium">{c.nome || "—"}</span>
                <span className="num shrink-0 text-muted-foreground">{formatarDoc(c.doc)} · {c.fonte}</span>
              </button>
            ))}
          </div>
        )}

        {carregando && !ficha && (
          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lendo o Asaas, o Omie e a Receita…
          </p>
        )}

        {ficha && (
          <div className={cn("mt-4 space-y-4 text-xs", carregando && "opacity-60")}>
            {/* ---------------- cabeçalho ---------------- */}
            <section>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{ficha.nome}</p>
                  <p className="num text-[11px] text-muted-foreground">
                    {ficha.doc_formatado}
                    {ficha.id_customer ? ` · Asaas ${ficha.id_customer}` : " · sem cliente no Asaas"}
                    {ficha.codigos_omie.length
                      ? ` · Omie ${ficha.codigos_omie.join(", ")}`
                      : " · sem cadastro no Omie"}
                  </p>
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(window.location.href);
                    toast.success("Link da ficha copiado.");
                  }}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  <Link2 className="h-3 w-3" /> Copiar link
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ficha.receita?.situacao && (
                  <span className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    ficha.receita.situacao.toUpperCase() === "ATIVA"
                      ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                      : "border-destructive/40 text-destructive",
                  )}>
                    Receita: {ficha.receita.situacao}
                  </span>
                )}
                {ficha.codigos_omie.length > 1 && (
                  <span
                    className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
                    title="A nota usa o cadastro de MENOR código. Os outros são duplicados."
                  >
                    {ficha.codigos_omie.length} cadastros no Omie — a nota usa o {ficha.codigos_omie[0]}
                  </span>
                )}
                {ficha.antes_do_pagamento.filter((x) => x.ativo).map((x) => (
                  <span key={x.criado_em} className="rounded border border-sky-500/40 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-400" title={x.motivo}>
                    Nota antes do pagamento ({x.tipo})
                  </span>
                ))}
                {ficha.conferencia.map((c) => (
                  <span
                    key={c.id_customer}
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px]",
                      c.resultado === "falhou"
                        ? "border-destructive/40 text-destructive"
                        : "border-border text-muted-foreground",
                    )}
                    title={c.detalhe ?? undefined}
                  >
                    Endereço conferido {dataHora(c.sincronizado_em)} ({c.resultado}{c.tentativas ? `, ${c.tentativas} falha(s)` : ""})
                  </span>
                ))}
                {!ficha.asaas_ao_vivo && (
                  <span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                    Asaas não respondeu — mostrando o espelho
                  </span>
                )}
              </div>
            </section>

            {/* ---------------- os alertas ---------------- */}
            {outroCliente.length > 0 && (
              <p className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {outroCliente.length} OS de cobrança deste cliente aponta{outroCliente.length > 1 ? "m" : ""} para{" "}
                  <strong>outro cadastro do Omie</strong> ({outroCliente.map((n) => n.c_num_os ?? n.n_cod_os).join(", ")}).
                  Nota que sair dela vai para a empresa errada.
                </span>
              </p>
            )}
            {ficha.erro_leitura_omie && (
              <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                O Omie não respondeu a leitura do cadastro ({ficha.erro_leitura_omie}). Abra de novo em alguns segundos.
              </p>
            )}
            {diverge.length > 0 && (
              <p className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-amber-800 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  O Omie diverge do Asaas em: <strong>{diverge.map((l) => l.rotulo.toLowerCase()).join(", ")}</strong>.
                  Antes de emitir, o Hub atualiza o endereço do Omie com o do Asaas; nome e razão social se corrigem em
                  "Editar cadastro à mão", abaixo.
                </span>
              </p>
            )}

            {/* ---------------- a comparação ---------------- */}
            <section className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Campo</th>
                    <th className="p-2 font-medium">Asaas</th>
                    <th className="p-2 font-medium text-foreground">Omie · vai na nota</th>
                    <th className="p-2 font-medium">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {ficha.comparacao.map((l) => (
                    <tr key={l.campo} className={cn("border-t border-border", l.difere_asaas && "bg-amber-500/10")}>
                      <td className="p-2 text-muted-foreground">{l.rotulo}</td>
                      <td className="p-2">{l.asaas ?? <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="p-2 font-medium text-foreground">
                        {l.omie ?? <span className="font-normal italic text-muted-foreground/60">vazio</span>}
                      </td>
                      <td className={cn("p-2", l.difere_receita && "text-amber-700 dark:text-amber-400")}>
                        {l.receita ?? <span className="text-muted-foreground/50">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {ficha.cobrancas.length > 0 && !ficha.erro_leitura_omie ? (
              <EditarCadastroCliente
                cliente={{
                  doc: ficha.doc, nome: ficha.nome, n_cod_cli: ficha.n_cod_cli,
                  id_customer: ficha.id_customer ?? "", omie: ficha.omie, asaas: ficha.asaas,
                }}
                ids={ficha.cobrancas.map((c) => c.id_asaas)}
                onGravado={() => void carregar(ficha.doc)}
              />
            ) : (
              <p className="text-[11px] text-muted-foreground">
                A edição à mão precisa de pelo menos uma cobrança deste cliente no Asaas.
              </p>
            )}

            {/* ---------------- notas / OS ---------------- */}
            <section>
              <p className="mb-1.5 font-semibold text-foreground">Notas e ordens de serviço no Omie</p>
              {ficha.notas.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma OS deste cliente no espelho.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {ficha.notas.map((n) => {
                        const link = linkPortalNacional(n.nfse_verificacao);
                        const situacao = n.cancelada
                          ? (n.nfse_numero ? "cancelada" : "aposentada")
                          : n.faturada
                          ? (n.nfse_status === "004" ? "autorizada" : n.nfse_status === "003" ? "recusada" : "no forno")
                          : "OS aberta";
                        return (
                          <tr key={n.n_cod_os} className={cn("border-t border-border first:border-0", n.outro_cliente && !n.cancelada && "bg-destructive/10")}>
                            <td className="p-2">
                              {n.nfse_numero ? (
                                link ? (
                                  <a href={link} target="_blank" rel="noreferrer" className={cn("num font-medium text-primary hover:underline", n.cancelada && "line-through")}>
                                    NFS-e {n.nfse_numero}
                                  </a>
                                ) : <span className={cn("num font-medium", n.cancelada && "line-through")}>NFS-e {n.nfse_numero}</span>
                              ) : <span className="num text-muted-foreground">OS {n.c_num_os ?? n.n_cod_os}</span>}
                            </td>
                            <td className="num p-2 text-right">{brl(Number(n.valor))}</td>
                            <td className="p-2">{data(n.data_faturamento)}</td>
                            <td className="p-2" title={n.nfse_mensagem ?? undefined}>{situacao}</td>
                            <td className="num p-2 text-muted-foreground">{n.c_cod_int_os ?? "—"}</td>
                            <td className="p-2">
                              {n.outro_cliente && (
                                <span className="text-destructive" title={`A OS aponta para o cadastro ${n.n_cod_cli} do Omie, que não é deste documento.`}>
                                  outro cliente ({n.n_cod_cli})
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ---------------- cobranças ---------------- */}
            <section>
              <p className="mb-1.5 font-semibold text-foreground">Cobranças recentes no Asaas</p>
              {ficha.cobrancas.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma cobrança deste cliente no espelho.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {ficha.cobrancas.map((c) => (
                        <tr key={c.id_asaas} className="border-t border-border first:border-0">
                          <td className="num p-2 text-muted-foreground">{c.id_asaas}</td>
                          <td className="num p-2 text-right">{brl(c.valor)}</td>
                          <td className="p-2">venc. {data(c.vencimento)}</td>
                          <td className="p-2">{statusAsaas(c.status).rotulo}</td>
                          <td className="max-w-[220px] truncate p-2 text-muted-foreground" title={c.descricao ?? undefined}>{c.descricao ?? "—"}</td>
                          <td className="p-2">
                            {c.link && (
                              <a href={c.link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" title="Abrir a fatura no Asaas">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ficha.notas_sem_cobranca.length > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Notas sem cobrança pedidas: {ficha.notas_sem_cobranca.map((n) => `${brl(Number(n.valor))} em ${dataHora(n.criado_em)}`).join(" · ")}
                </p>
              )}
            </section>

            {/* ---------------- histórico ---------------- */}
            {ficha.correcoes.length > 0 && (
              <section>
                <p className="mb-1.5 font-semibold text-foreground">Mudanças no cadastro feitas pelo Hub</p>
                <ul className="space-y-1">
                  {ficha.correcoes.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px]">
                      {c.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> : <span className="mt-0.5 h-3 w-3 shrink-0" />}
                      <span>
                        <span className="text-muted-foreground">{dataHora(c.quando)}</span> · {ORIGEM[c.origem] ?? c.origem}
                        {c.operador ? ` · ${c.operador}` : ""}
                        {c.ok && c.escrito
                          ? ` — gravou ${Object.keys(c.escrito).filter((k) => k !== "codigo_cliente_omie").join(", ")}`
                          : c.motivo ? ` — ${c.motivo}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ---------------- tudo ---------------- */}
            <section>
              <button
                onClick={() => setVerBrutos((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", verBrutos && "rotate-180")} />
                Todos os campos, como cada sistema devolve
              </button>
              {verBrutos && (
                <div className="mt-2 grid gap-2 lg:grid-cols-3">
                  {(["asaas", "omie", "receita"] as const).map((k) => (
                    <div key={k} className="min-w-0">
                      <p className="mb-1 text-[11px] font-medium capitalize">{k}</p>
                      <pre className="max-h-80 overflow-auto rounded border border-border bg-muted/40 p-2 text-[10px] leading-snug">
                        {JSON.stringify(ficha.brutos[k], null, 2) ?? "—"}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
