/**
 * Prévia da folha antes de provisionar no Omie.
 *
 * A tela existe para uma coisa: dar a alguém a chance de ver 102 títulos ANTES
 * de eles existirem no ERP. Por isso ela não resume — mostra linha a linha, com
 * o rateio de quem entrou ou saiu no meio do mês, quem está bloqueado e o que
 * mudou de valor desde a última folha.
 *
 * Tudo aqui é leitura. O botão de envio só aparece quando
 * `ENVIO_FOLHA_LIBERADO` estiver ligado no módulo compartilhado, e a mesma
 * função de recusa que desabilita o botão recusa o request no servidor.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle, CalendarClock, Check, Loader2, PencilLine, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { tabelaFolha } from "@/lib/folha/db";
import { toast } from "sonner";
import AjustarSalarioDialog, { type AlvoDoAjuste } from "./AjustarSalarioDialog";
import EnviarFolhaOmie from "./EnviarFolhaOmie";
import { cn } from "@/lib/utils";
import { bloqueioDaFolha, type ItemDaFolha } from "../../../supabase/functions/_shared/folha-envio";

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const dataBR = (iso: string) => {
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return d ? `${d}/${m}/${a}` : iso;
};

const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;

const RATEIO: Record<string, string> = {
  cheio: "",
  admissao: "entrou no mês",
};

/* A montagem inteira mora na Edge Function `folha-previa`, e NÃO aqui.
 *
 * O motivo é concreto: `omie_cache` tem RLS ligada e nenhuma policy, então o
 * usuário autenticado não lê nada dela. A primeira versão desta tela montava
 * tudo no navegador e saía com "sem fornecedor" e "categoria não achada" em
 * todas as linhas — as consultas voltavam vazias e o código lia isso como
 * "não existe". Ler cache que o chamador não enxerga é erro que não dá erro.
 *
 * De quebra, o servidor consegue conferir no Omie, por CNPJ, quem o cache não
 * tem — coisa que o navegador não pode fazer (a credencial é secreta).
 */

type Linha = ItemDaFolha & {
  codigoFornecedor: number | null;
  fornecedorConferidoNoOmie: boolean;
  codigoCategoria: string | null;
  codigoDepartamento: string | null;
  ajusteMotivo: string | null;
  ajustadoEm: string | null;
  cargo: string | null;
  /** A chave que o título vai levar — a do cadastro do fornecedor, literal. */
  chavePix: string | null;
  /** Por que a chave do cadastro não serve; `null` = serve. */
  chavePixBloqueio: string | null;
  /** A varredura de chaves cobriu esta pessoa? */
  chavePixConferida: boolean;
  /** Já existe no Omie? É o que separa "falta criar" de "já está lá". */
  noOmie: boolean;
  /** O Nº Documento como o ERP guardou. Vazio nos títulos criados até 27/08. */
  numeroDocumento: string;
};

/** Uma pessoa que não entrou no Omie, como está gravada em `folha_recusas`. */
type Recusa = {
  codigo_rh: string;
  nome: string;
  integracao: string;
  origem: "preparo" | "omie" | "bloqueio" | "tempo";
  motivo: string;
  tentativas: number;
  tentado_em: string;
};

/* O que fazer em cada caso. A origem existe porque a AÇÃO é diferente: cadastro
   errado não se resolve reenviando, e bloqueio do Omie não se resolve mexendo
   em cadastro nenhum. */
const O_QUE_FAZER: Record<Recusa["origem"], string> = {
  preparo: "Corrija o cadastro (Omie ou RH) — reenviar sem isso repete o mesmo.",
  omie: "O ERP recusou o título. O motivo está escrito ao lado.",
  bloqueio: "O Omie trancou a API por consumo. Espere o tempo pedido e reenvie.",
  tempo: "O lote parou no teto de tempo antes de chegar aqui. É só reenviar.",
};

type Previa = {
  status: string;
  erro?: string;
  registro: string;
  vencimento: string;
  previsao: string;
  previsaoRegra: string;
  previsaoExcepcional: boolean;
  linhas: Linha[];
  fora: { nome: string; motivo: string }[];
  total: number;
  pendencia: string | null;
  recusa: string | null;
  cache: {
    clientes_em: string | null;
    consultas_diretas: number;
    nao_conferidos: number;
    chaves_pix_em: string | null;
    chaves_pix_nao_conferidas: number;
    /** A consulta ao ERP respondeu? `false` = a tela não sabe o que já entrou. */
    conferido_no_omie: boolean;
  };
};

export default function PreviaFolhaDialog({
  aberto, onFechar, competencia,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** 'AAAA-MM' — o mês TRABALHADO. */
  competencia: string;
}) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ajustando, setAjustando] = useState<AlvoDoAjuste | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [recusas, setRecusas] = useState<Recusa[]>([]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    /* NÃO limpa `previa` ao recarregar. Limpar desmontava o rodapé inteiro, e
       com ele a lista de títulos recusados — que era justamente o que a pessoa
       precisava ler depois de um envio parcial. O conteúdo antigo fica na tela
       enquanto o novo carrega. */
    setCarregando(true); setErro(null);

    invocar<Previa>(supabase.functions.invoke("folha-previa", { body: { competencia } }))
      .then((r) => { if (vivo) setPrevia(r); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setCarregando(false); });

    return () => { vivo = false; };
  }, [aberto, competencia, recarga]);

  /* As recusas GRAVADAS, e não as da sessão.
   *
   * Sem isto, quem não entrou no Omie sumia ao recarregar a página — e em
   * 27/08/2026 a única forma de descobrir quem faltava foi ler o log da Edge
   * Function pelo painel do Supabase, que não é coisa que o financeiro faça. */
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    tabelaFolha("folha_recusas")
      .select("codigo_rh, nome, integracao, origem, motivo, tentativas, tentado_em")
      .eq("competencia", `${competencia}-01`)
      .is("resolvido_em", null)
      .order("nome", { ascending: true })
      .then(({ data }) => {
        if (vivo) setRecusas((data ?? []) as unknown as Recusa[]);
      });
    return () => { vivo = false; };
  }, [aberto, competencia, recarga]);

  const linhas = previa?.linhas ?? [];
  const fora = previa?.fora ?? [];
  const total = previa?.total ?? 0;
  const registro = previa?.registro ?? "";
  const vencimento = previa?.vencimento ?? "";
  const previsao = previa?.previsao ?? "";
  const pendencia = previa?.pendencia ?? null;
  const recusa = previa?.recusa ?? null;

  /* O estado REAL da competência, que é o que faz esta tela servir todo mês:
     quem já está no ERP, quem falta criar e quem está travado. */
  const noOmie = linhas.filter((l) => l.noOmie);
  const aCriar = linhas.filter((l) => !l.noOmie && !l.chavePixBloqueio);
  const travadas = linhas.filter((l) => !l.noOmie && l.chavePixBloqueio);
  /* Títulos antigos, criados antes de o Nº Documento existir: são eles que não
     aparecem quando se procura "FOLHA" na tela do Omie. */
  const semNumeroDoc = noOmie.filter((l) => !l.numeroDocumento);
  const conferido = previa?.cache.conferido_no_omie ?? false;

  const marcadas = linhas.filter((l) => l.chamaAtencao);
  const ajustadas = linhas.filter((l) => l.valorAjustado !== null && !l.ajusteRedundante);
  const redundantes = linhas.filter((l) => l.ajusteRedundante);
  /* Ajuste que PAGA MENOS do que o espelho do RH é o que merece um segundo
     olhar: se o RH estiver certo (um aumento recente que a referência não
     tem), a pessoa recebe a menos — e quem recebe a menos reclama, enquanto
     quem recebe a mais fica quieto. */
  const ajustesQuePagamMenos = ajustadas.filter((l) => (l.valorAjustado ?? 0) < l.valorRh);
  const rateadas = linhas.filter((l) => l.motivo !== "cheio");
  /* Desligado não aparece aqui: `montarLote` o manda para `fora`, com o motivo,
     porque rescisão é paga em /governanca/rescisoes. A lista de fora do lote,
     mais abaixo, é onde ele fica visível. */
  const foraPorRescisao = fora.filter((f) => /rescis/i.test(f.motivo));

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prévia da folha · competência {competencia}</DialogTitle>
          <DialogDescription>
            Registro {dataBR(registro)} · vencimento {dataBR(vencimento)}
            {previsao !== vencimento && <> · previsão {dataBR(previsao)}</>}
            {previa?.previsaoExcepcional
              ? <> — <b>exceção deste mês</b>; a regra daria {dataBR(previa.previsaoRegra)}</>
              : previsao !== vencimento && <> (o dia 5 caiu no fim de semana)</>}
          </DialogDescription>
        </DialogHeader>

        {carregando && !previa && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Montando o lote…
          </div>
        )}
        {carregando && previa && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Atualizando…
          </p>
        )}

        {erro && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </div>
        )}

        {previa && !erro && (
          <>
            {/* ─── Onde a competência está ───
                Primeiro do que tudo, e de propósito: a pergunta que se abre
                esta tela para responder é "esta folha já foi?". Até 27/08/2026
                a resposta só existia lendo log de Edge Function no painel do
                Supabase. */}
            <div className="rounded-xl border bg-card px-[18px] py-4">
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Total a provisionar
                  </p>
                  <p className="num mt-1 text-[28px] font-medium leading-none">{BRL(total)}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {linhas.length} título(s)
                    {rateadas.length > 0 && <> · {rateadas.length} rateado(s)</>}
                    {fora.length > 0 && <> · {fora.length} fora do lote</>}
                  </p>
                </div>

                <div className="min-w-[240px] flex-1">
                  {conferido ? (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                          No Omie
                        </p>
                        <p className="text-[13px] tabular-nums">
                          <span className={cn(
                            "font-semibold",
                            noOmie.length === linhas.length ? "text-pos" : "text-foreground",
                          )}>
                            {noOmie.length}
                          </span>
                          <span className="text-muted-foreground"> de {linhas.length}</span>
                        </p>
                      </div>
                      {/* Barra e não só o número: "101 de 102" e "36 de 102" lidos
                          de relance são a mesma frase; a barra não deixa. */}
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            noOmie.length === linhas.length ? "bg-pos" : "bg-primary",
                          )}
                          style={{
                            width: `${linhas.length ? (noOmie.length / linhas.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                        {aCriar.length > 0 && (
                          <span className="text-muted-foreground">
                            <b className="text-foreground tabular-nums">{aCriar.length}</b> a criar
                          </span>
                        )}
                        {travadas.length > 0 && (
                          <span className="text-destructive">
                            <b className="tabular-nums">{travadas.length}</b> travado(s) no cadastro
                          </span>
                        )}
                        {semNumeroDoc.length > 0 && (
                          <span className="text-amber-700 dark:text-amber-400">
                            <b className="tabular-nums">{semNumeroDoc.length}</b> sem Nº Documento
                          </span>
                        )}
                        {noOmie.length === linhas.length && !semNumeroDoc.length && (
                          <span className="text-pos">Folha completa no ERP.</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Não deu para conferir o que já está no Omie agora. Os números abaixo são o
                      que o Hub pretende mandar, não o que o ERP tem.
                    </p>
                  )}
                </div>
              </div>

              {(marcadas.length > 0 || ajustadas.length > 0) && (
                <div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-[13.5px]">
                  <Numero
                    rotulo="Valor mudou"
                    valor={String(marcadas.length)}
                    icone={AlertTriangle}
                    tom={marcadas.length ? "atencao" : undefined}
                  />
                  <Numero rotulo="Ajustados" valor={String(ajustadas.length)} icone={PencilLine} />
                  <Numero rotulo="Rateados" valor={String(rateadas.length)} icone={CalendarClock} />
                  <Numero rotulo="Títulos" valor={String(linhas.length)} icone={Users} />
                </div>
              )}
            </div>

            {marcadas.length > 0 && (
              <Aviso tom="atencao" titulo={`${marcadas.length} salário(s) mudaram desde a última folha`}>
                Aumento é rotina; dígito a mais também. Confira antes de enviar — o total da folha
                pode empatar mesmo com erros dentro, porque eles se cancelam.
              </Aviso>
            )}

            {ajustadas.length > 0 && (
              <Aviso
                tom={ajustesQuePagamMenos.length > 0 ? "atencao" : "neutro"}
                titulo={`${ajustadas.length} salário(s) corrigidos no Hub`}
              >
                O espelho do RH está desatualizado nessas linhas; a folha usa o valor corrigido.
                Cada uma mostra ao lado o que o RH diz.
                {ajustesQuePagamMenos.length > 0 && (
                  <>
                    {" "}<b>{ajustesQuePagamMenos.length} paga(m) MENOS que o RH</b> —
                    se o RH estiver certo, essas pessoas recebem a menos:{" "}
                    {ajustesQuePagamMenos.map((l) => l.nome).join(", ")}.
                  </>
                )}
              </Aviso>
            )}

            {redundantes.length > 0 && (
              <Aviso tom="neutro" titulo={`${redundantes.length} ajuste(s) já batem com o RH`}>
                O Portal RH se corrigiu nessas linhas. Dá para remover a correção — clique no
                valor e deixe o campo vazio. Manter não muda o pagamento, só carrega um número
                fixo que ninguém vai lembrar por que existe.
              </Aviso>
            )}

            {foraPorRescisao.length > 0 && (
              <Aviso tom="neutro" titulo={`${foraPorRescisao.length} desligado(s) fora da folha`}>
                Rescisão é paga pelo processo próprio, em Governança › Rescisões — provisionar
                aqui pagaria os mesmos dias duas vezes. Eles aparecem na lista "Fora do lote",
                abaixo, com a data de saída.
              </Aviso>
            )}

            {pendencia && <Aviso tom="erro" titulo="Pendência que impede o envio">{pendencia}</Aviso>}

            {/* ─── O que NÃO entrou no Omie ─── */}
            {recusas.length > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
                <p className="text-[12.5px] font-semibold text-destructive">
                  {recusas.length} pessoa(s) não entraram no Omie nesta competência
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Fica gravado até o título entrar — recarregar a página não apaga. Quem já
                  entrou some daqui sozinho no próximo envio.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {recusas.map((r) => (
                    <li key={r.codigo_rh} className="text-xs leading-snug">
                      <span className="font-medium">{r.nome}</span>
                      <span className="mono ml-1.5 text-[11px] text-muted-foreground">{r.integracao}</span>
                      {r.tentativas > 1 && (
                        <span className="ml-1.5 rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-destructive">
                          {r.tentativas}ª tentativa
                        </span>
                      )}
                      <span className="mt-0.5 block break-words text-muted-foreground">{r.motivo}</span>
                      <span className="block text-[11px] text-muted-foreground/80">
                        {O_QUE_FAZER[r.origem]}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  className="mt-2 text-xs text-primary hover:underline"
                  onClick={() => {
                    const linhas = recusas.map((r) => `• ${r.nome}: ${r.motivo}`);
                    const cabecalho = `Folha ${competencia} — não entraram no Omie `
                      + `(${new Date().toLocaleDateString("pt-BR")}):`;
                    navigator.clipboard.writeText([cabecalho, "", ...linhas].join("\n")).then(
                      () => toast.success("Lista copiada"),
                      () => toast.error("Não deu para copiar"),
                    );
                  }}
                >
                  Copiar a lista
                </button>
              </div>
            )}

            {bloqueioDaFolha() && (
              <Aviso tom="neutro" titulo="Envio desligado no código">{bloqueioDaFolha()}</Aviso>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-secondary text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="w-[86px] px-3.5 py-2.5 text-left font-semibold">Situação</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold">Colaborador</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Departamento</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Categoria</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Dias</th>
                    <th className="px-3.5 py-2.5 text-right font-semibold" title="Clique num valor para corrigir">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.codigo} className="border-b border-border/60 hover:bg-muted/40">
                      {/* A situação de CADA UM, e não só o total da faixa: numa
                          lista de cem, saber que faltam seis não diz quais. */}
                      <td className="px-3.5 py-2 align-top">
                        {!conferido ? (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        ) : l.noOmie ? (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-pos/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-pos"
                            title={l.numeroDocumento
                              ? `No Omie como "${l.numeroDocumento}"`
                              : "No Omie, mas sem Nº Documento — não aparece ao procurar FOLHA na tela do ERP."}
                          >
                            <Check className="size-3" />
                            {l.numeroDocumento ? "no Omie" : "sem nº"}
                          </span>
                        ) : l.chavePixBloqueio ? (
                          <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-destructive">
                            travado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                            a criar
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{l.nome}</span>
                          {l.motivo !== "cheio" && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                              {RATEIO[l.motivo]}
                            </span>
                          )}
                          {!l.codigoFornecedor && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10.5px] font-semibold",
                                l.fornecedorConferidoNoOmie
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-muted text-muted-foreground",
                              )}
                              title={l.fornecedorConferidoNoOmie
                                ? "Conferido no Omie por CNPJ: não existe cadastro."
                                : "Não deu para conferir agora — não é o mesmo que não existir."}
                            >
                              {l.fornecedorConferidoNoOmie ? "sem fornecedor" : "não conferido"}
                            </span>
                          )}
                        </div>
                        <span className="mono text-[11px] text-muted-foreground">{l.codigo}</span>
                        {/* A chave sai do cadastro do fornecedor, e é o cadastro
                            que se corrige quando ela não serve — trocar por
                            outra aqui é o que trava o pagamento em lote. */}
                        {l.chavePixBloqueio ? (
                          <span className="block whitespace-normal text-[11px] leading-snug text-destructive">
                            ✖ {l.chavePixBloqueio}
                          </span>
                        ) : l.chavePix ? (
                          <span
                            className="mono block truncate text-[11px] text-muted-foreground"
                            title={`Chave PIX do cadastro no Omie — é ela que vai no título: ${l.chavePix}`}
                          >
                            PIX {l.chavePix}
                          </span>
                        ) : !l.chavePixConferida && (
                          <span className="block text-[11px] text-muted-foreground">
                            chave PIX não conferida
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[13px]">
                        {l.departamento || <span className="text-destructive">—</span>}
                        {l.codigoDepartamento && (
                          <span className="mono block text-[11px] text-muted-foreground">{l.codigoDepartamento}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[13px]">
                        {l.codigoCategoria
                          ? <span className="mono">{l.codigoCategoria}</span>
                          : <span className="text-destructive">não achada</span>}
                        <span className="block max-w-[220px] truncate text-[11px] text-muted-foreground">
                          {l.categoria}
                        </span>
                      </td>
                      <td className="num px-3 py-2 text-right text-[13px]">
                        {l.dias < 30 ? `${l.dias}/30` : "—"}
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        <button
                          onClick={() => setAjustando({
                            codigo: l.codigo, nome: l.nome, cargo: l.cargo ?? null,
                            valorRh: l.valorRh, valorAjustado: l.valorAjustado,
                            documentoRh: l.documentoRh, documentoAjustado: l.documentoAjustado,
                          })}
                          title={l.valorAjustado !== null
                            ? `Corrigido no Hub. No espelho do RH: ${BRL(l.valorRh)}${l.ajusteMotivo ? ` · ${l.ajusteMotivo}` : ""}`
                            : "Clique para corrigir o salário desta pessoa"}
                          className={cn(
                            "num rounded px-1.5 py-0.5 text-[13.5px] transition-colors hover:bg-muted",
                            l.valorAjustado !== null && "underline decoration-dotted underline-offset-4",
                          )}
                        >
                          {BRL(l.valor)}
                        </button>
                        {l.valorAjustado !== null && (
                          <span
                            className={cn(
                              "block text-[11px]",
                              l.ajusteRedundante ? "text-muted-foreground" : "text-[hsl(var(--info))]",
                            )}
                          >
                            {l.ajusteRedundante
                              ? "ajuste já bate com o RH"
                              : <>corrigido · RH diz <span className="num">{BRL(l.valorRh)}</span></>}
                          </span>
                        )}
                        {l.chamaAtencao && l.variacao !== null && (
                          <span
                            className={cn(
                              "mt-0.5 flex items-center justify-end gap-1 text-[11px] font-semibold",
                              l.variacao > 0 ? "text-destructive" : "text-amber-700 dark:text-amber-400",
                            )}
                            title={`Na folha de referência era ${BRL(l.valorReferencia ?? 0)}`}
                          >
                            {l.variacao > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                            {pct(l.variacao)} vs {BRL(l.valorReferencia ?? 0)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {fora.length > 0 && (
              <div className="rounded-xl border">
                <p className="border-b px-3.5 py-2.5 text-[12.5px] font-semibold">
                  Fora do lote · {fora.length}
                </p>
                <ul className="divide-y">
                  {fora.map((f) => (
                    <li key={f.nome} className="flex items-baseline justify-between gap-4 px-3.5 py-2 text-[13px]">
                      <span>{f.nome}</span>
                      <span className="text-right text-xs text-muted-foreground">{f.motivo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(previa?.cache.nao_conferidos ?? 0) > 0 && (
              <Aviso tom="atencao" titulo={`${previa?.cache.nao_conferidos} não conferidos no Omie`}>
                A consulta direta tem teto por abertura, para a tela não travar. Rode o sync de
                clientes (`omie-clientes-sync`) e reabra — o cache resolve todos de uma vez.
              </Aviso>
            )}

            {(previa?.cache.chaves_pix_nao_conferidas ?? 0) > 0 && (
              <Aviso
                tom="atencao"
                titulo={`${previa?.cache.chaves_pix_nao_conferidas} sem a chave PIX do Omie conferida`}
              >
                A chave de cada título sai do cadastro do fornecedor no Omie, e a última varredura
                {previa?.cache.chaves_pix_em
                  ? ` (${new Date(previa.cache.chaves_pix_em).toLocaleString("pt-BR")})`
                  : ""} não cobriu essas pessoas. O envio relê do Omie ao vivo e decide — mas para
                ver aqui antes, use “Reconsultar o Omie” na tela de Colaboradores.
              </Aviso>
            )}

            <EnviarFolhaOmie
              competencia={competencia}
              totalDoLote={total}
              recusa={recusa}
              candidatos={linhas.map((l) => ({
                codigo: l.codigo,
                nome: l.nome,
                valor: l.valor,
                cnpj: l.cnpj,
                /* "Pronto" é ter o que o payload REALMENTE usa: fornecedor,
                   categoria e a chave PIX do cadastro. Departamento ficou de
                   fora porque o Omie recusa o campo — exigi-lo aqui tiraria
                   gente do envio por causa de um dado que nem é mandado.
                   A chave entra porque sem ela o título é recusado um a um, e
                   com a chave errada ele trava o pagamento do lote inteiro. */
                pronto: !!l.codigoFornecedor && !!l.codigoCategoria && !l.chavePixBloqueio,
                /* Quem já está no ERP não é candidato a criar — é candidato a
                   corrigir. Sem esta separação o botão "provisionar" reenviava
                   cem títulos para colher cem recusas por duplicidade. */
                noOmie: l.noOmie,
              }))}
              onEnviado={() => setRecarga((n) => n + 1)}
            />
          </>
        )}
      </DialogContent>

      <AjustarSalarioDialog
        alvo={ajustando}
        onFechar={() => setAjustando(null)}
        onSalvo={() => setRecarga((n) => n + 1)}
      />
    </Dialog>
  );
}

function Numero({
  rotulo, valor, icone: Icone, tom,
}: {
  rotulo: string;
  valor: string;
  icone?: typeof Users;
  tom?: "atencao";
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-muted-foreground">
        {Icone && <Icone className="size-3.5" />}
        {rotulo}
      </p>
      <p className={cn(
        "mt-0.5 font-semibold tabular-nums",
        tom === "atencao" ? "text-amber-700 dark:text-amber-400" : "text-foreground",
      )}>
        {valor}
      </p>
    </div>
  );
}

function Aviso({
  tom, titulo, children,
}: {
  tom: "atencao" | "erro" | "neutro";
  titulo: string;
  children: React.ReactNode;
}) {
  const classe = {
    atencao: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    erro: "border-destructive/30 bg-destructive/10 text-destructive",
    neutro: "border-border bg-muted/50 text-muted-foreground",
  }[tom];
  return (
    <div className={cn("rounded-xl border px-3.5 py-2.5", classe)}>
      <p className="text-[12.5px] font-semibold">{titulo}</p>
      <p className="mt-0.5 text-xs opacity-90">{children}</p>
    </div>
  );
}
