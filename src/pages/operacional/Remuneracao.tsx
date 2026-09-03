import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp, Search, Download, Loader2, Lock, AlertTriangle, ArrowUpRight,
  ArrowDownRight, Minus, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { moduleAccess } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkline } from "@/components/ui/sparkline";
import { KpiCard } from "@/components/ui/kpi-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import { mesesDeCasa, parseISO } from "@/lib/rescisao";
import {
  degrausDoFixo, filtrarPessoas, matrizParaPlanilha, resumoDaPessoa, rotuloMes,
  totaisDoMes, ultimaCompetenciaFechada,
  type Filtros, type PainelRemuneracao, type PessoaRemuneracao, type ResumoPessoa,
} from "@/lib/remuneracao";

/**
 * Remuneração — a linha do tempo de quanto cada pessoa ganha.
 *
 * O OMIE É A VOZ DA VERDADE. Todo número desta tela é pagamento que saiu do
 * ERP; o espelho do Portal RH entra só para dizer o cargo, o setor e a data de
 * entrada — e para ser CONFERIDO contra o pagamento, nunca o contrário. Quando
 * a ficha do RH discorda do que foi pago, é a ficha que está atrasada, e a tela
 * marca isso como pendência do RH.
 *
 * Os dados vêm de `remuneracao_painel()` num bloco só. A tentação era ler
 * `vw_remuneracao_mensal` direto, mas o PostgREST corta em 1.000 linhas SEM
 * avisar e a view já tem ~1.020 — a tela mostraria uma folha menor que a real e
 * pareceria certa.
 */

/* ─────────────────────────── Formatadores ───────────────────────────
   Convenção do repo: o formatador "normal" devolve ReactNode com o valor cheio
   no hover; a variante `…Str` devolve string pura, para template literal,
   `title=` e a planilha. */

const fmtBRLStr = (n: number | null | undefined) => {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", {
    style: "currency", currency: "BRL",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
};

const fmtBRL = (n: number | null | undefined) => comValorExato(n, fmtBRLStr(n));

const pctStr = (v: number) =>
  `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const fmtDataStr = (iso: string | null) => {
  const d = parseISO(iso);
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR");
};

/** "2 anos e 1 mês". Vazio quando a data de início não parseia. */
function tempoDeCasaStr(inicio: string | null): string {
  const d = parseISO(inicio);
  if (!d) return "—";
  const meses = mesesDeCasa(d, new Date());
  if (meses < 0) return "—";
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anos === 0) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  return `${anos} ${anos === 1 ? "ano" : "anos"}${resto ? ` e ${resto}m` : ""}`;
}

/* Data de início anterior a 2015 é quase certamente a data de NASCIMENTO
   digitada no campo errado no Portal RH — o André Rocon está com 02/12/1996 nos
   dois campos. Marcar em vez de mostrar "29 anos de casa" calado. */
const inicioSuspeito = (iso: string | null) => {
  const d = parseISO(iso);
  return !!d && d.getFullYear() < 2015;
};

/* ─────────────────────────── Filtros ─────────────────────────── */

const FILTROS_PADRAO: Filtros = {
  busca: "",
  incluirSaidas: false,
  incluirNaoPessoas: false,
  soComFichaRh: false,
  setor: null,
};

/* ─────────────────────────── Página ─────────────────────────── */

type Linha = { pessoa: PessoaRemuneracao; resumo: ResumoPessoa };

export default function Remuneracao() {
  const { profile } = useAuth();
  const podeVer = moduleAccess(profile?.cargo).remuneracao;

  const [painel, setPainel] = useState<PainelRemuneracao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO);
  const [mesFoco, setMesFoco] = useState<string | null>(null);
  const [aberta, setAberta] = useState<PessoaRemuneracao | null>(null);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("remuneracao_painel");
    if (error) {
      setErro(error.message);
      setPainel(null);
    } else {
      setPainel(data as unknown as PainelRemuneracao);
    }
    setCarregando(false);
  };

  useEffect(() => { if (podeVer) void carregar(); else setCarregando(false); }, [podeVer]);

  const meses = useMemo(
    () => [...(painel?.meses ?? [])].sort((a, b) => a.localeCompare(b)),
    [painel],
  );

  /* A referência é o último mês FECHADO, não o mais recente da base.
     O mês corrente tem uns poucos títulos avulsos já lançados, e usá-lo como
     referência dizia que todo mundo tinha saído: em 03/09/2026 era 1 lançamento
     de setembro contra 107 pessoas pagas em agosto, e as 107 sumiam da tela. */
  const referencia = useMemo(() => ultimaCompetenciaFechada(meses), [meses]);

  // O mês em foco começa no último fechado. `mesFoco` só é escrito pelo
  // seletor — assim recarregar não joga a pessoa de volta para o padrão.
  const mes = mesFoco ?? referencia;

  const setores = useMemo(() => {
    const s = new Set<string>();
    for (const p of painel?.pessoas ?? []) if (p.setor) s.add(p.setor);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [painel]);

  const pessoas = useMemo(
    () => filtrarPessoas(painel?.pessoas ?? [], filtros, referencia),
    [painel, filtros, referencia],
  );

  const linhas: Linha[] = useMemo(
    () => pessoas
      .map((pessoa) => ({ pessoa, resumo: resumoDaPessoa(pessoa) }))
      .sort((a, b) => (b.resumo.fixoAtual ?? 0) - (a.resumo.fixoAtual ?? 0)),
    [pessoas],
  );

  const totais = useMemo(
    () => (mes ? totaisDoMes(pessoas, mes) : null),
    [pessoas, mes],
  );

  /* Quantos têm a ficha do RH atrasada em relação ao que o Omie pagou. É a
     pendência que esta tela devolve para o RH. */
  const fichasAtrasadas = useMemo(
    () => linhas.filter((l) => Math.abs(l.resumo.divergenciaContrato ?? 0) >= 1).length,
    [linhas],
  );

  const exportar = () => {
    if (!painel) return;
    const aoa = matrizParaPlanilha(pessoas, meses);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Largura das colunas fixas; as de mês ficam no padrão, que já cabe.
    ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 10 },
                   { wch: 11 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 14 },
                   { wch: 11 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Remuneração");
    XLSX.writeFile(wb, `remuneracao-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`${pessoas.length} pessoas exportadas`);
  };

  /* ── Sem acesso ──
     A policy no Postgres já devolveria listas vazias, mas "nenhuma pessoa" é
     indistinguível de "sem permissão" para quem está olhando — e é o tipo de
     dúvida que vira chamado. */
  if (!podeVer) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">Remuneração é restrita</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Esta tela mostra quanto cada pessoa ganha. O acesso é dos cargos
          Diretoria, CEO e Financeiro. Fale com o financeiro se você precisa dela.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <TrendingUp className="h-5 w-5 text-primary" />
            Remuneração
          </h1>
          <p className="text-sm text-muted-foreground">
            Quanto cada pessoa ganha, mês a mês — fixo e comissão separados.
            Os valores são o que saiu do Omie.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", carregando && "animate-spin")} />
            Atualizar
          </Button>
          <Button size="sm" onClick={exportar} disabled={!painel || !pessoas.length}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar planilha
          </Button>
        </div>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-neg/30 bg-neg/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neg" />
          <div>
            <p className="font-medium">Não foi possível carregar o painel.</p>
            <p className="text-muted-foreground">{erro}</p>
          </div>
        </div>
      )}

      {carregando && !painel ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <>
          {/* ── KPIs do mês em foco ── */}
          {totais && mes && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label={`Custo de pessoas · ${rotuloMes(mes)}`}
                value={fmtBRL(totais.total)}
                stats={[
                  { label: "Fixo", value: fmtBRL(totais.fixo) },
                  { label: "Comissão", value: fmtBRL(totais.premiacao) },
                  { label: "Escala", value: fmtBRL(totais.escala) },
                ]}
              />
              <KpiCard
                label="Pessoas no mês"
                value={String(totais.gente)}
                subline={`${linhas.length} no recorte atual`}
              />
              <KpiCard
                label="Comissão sobre o total"
                value={totais.total ? `${Math.round((totais.premiacao / totais.total) * 100)}%` : "—"}
                subline={`${fmtBRLStr(totais.premiacao)} de ${fmtBRLStr(totais.total)}`}
              />
              <KpiCard
                label="Fichas do RH atrasadas"
                value={String(fichasAtrasadas)}
                valueTone={fichasAtrasadas > 0 ? "neg" : "neutral"}
                subline="contrato no RH ≠ pago no Omie"
                footnote="O Omie manda. A ficha é que precisa ser corrigida."
              />
            </div>
          )}

          {/* ── Filtros ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filtros.busca}
                onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                placeholder="Nome, cargo, setor ou código do RH…"
                className="h-9 pl-8"
              />
            </div>

            <Select value={mes ?? ""} onValueChange={setMesFoco}>
              <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="Mês" /></SelectTrigger>
              <SelectContent>
                {[...meses].reverse().map((m) => (
                  <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filtros.setor ?? "todos"}
              onValueChange={(v) => setFiltros((f) => ({ ...f, setor: v === "todos" ? null : v }))}
            >
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os setores</SelectItem>
                {setores.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            {([
              ["incluirSaidas", "Incluir quem saiu"],
              ["soComFichaRh", "Só com ficha no RH"],
              ["incluirNaoPessoas", "Incluir empresas"],
            ] as const).map(([chave, rotulo]) => (
              <label key={chave} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={filtros[chave]}
                  onCheckedChange={(v) => setFiltros((f) => ({ ...f, [chave]: v === true }))}
                />
                {rotulo}
              </label>
            ))}
          </div>

          {/* ── A lista ── */}
          <div className="card-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="hidden md:table-cell">Tempo de casa</TableHead>
                  <TableHead className="text-right">Fixo hoje</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Comissão média</TableHead>
                  <TableHead className="text-right">Último reajuste</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Sem reajuste</TableHead>
                  <TableHead className="hidden xl:table-cell w-[90px]">Evolução</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map(({ pessoa: p, resumo: r }) => {
                  const serie = p.meses.map((m) => Number(m.fixo) || 0);
                  const atrasada = Math.abs(r.divergenciaContrato ?? 0) >= 1;
                  return (
                    <TableRow
                      key={p.id}
                      onClick={() => setAberta(p)}
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <div className="font-medium leading-tight">{p.nome}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{p.cargo ?? "cargo não informado"}</span>
                          {p.setor && <span className="opacity-60">· {p.setor}</span>}
                          {!p.codigo_rh && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">sem ficha no RH</Badge>
                          )}
                          {p.datadesl && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">saiu {fmtDataStr(p.datadesl)}</Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {inicioSuspeito(p.inicio) ? (
                          <span
                            className="inline-flex items-center gap-1 text-warn"
                            title={`Início ${fmtDataStr(p.inicio)} no Portal RH — provavelmente a data de nascimento no campo errado.`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            data suspeita
                          </span>
                        ) : (
                          tempoDeCasaStr(p.inicio)
                        )}
                      </TableCell>

                      <TableCell className="num text-right font-medium">
                        {fmtBRL(r.fixoAtual)}
                        {atrasada && (
                          <div
                            className="text-[10px] font-normal text-warn"
                            title={`Ficha do RH: ${valorExato(p.valor_contrato)}. O Omie pagou ${valorExato(r.fixoAtual)}.`}
                          >
                            RH desatualizado
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="num hidden lg:table-cell text-right text-muted-foreground">
                        {r.mesesComPremiacao ? fmtBRL(r.premiacaoMedia) : "—"}
                      </TableCell>

                      <TableCell className="text-right">
                        {r.ultimoReajuste ? (
                          <div className="flex items-center justify-end gap-1">
                            {r.ultimoReajuste.variacao > 0
                              ? <ArrowUpRight className="h-3 w-3 text-pos" />
                              : <ArrowDownRight className="h-3 w-3 text-neg" />}
                            <span className={cn("num text-xs", r.ultimoReajuste.variacao > 0 ? "text-pos" : "text-neg")}>
                              {pctStr(r.ultimoReajuste.variacao)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {rotuloMes(r.ultimoReajuste.competencia)}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Minus className="h-3 w-3" /> nenhum
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="num hidden sm:table-cell text-right text-sm">
                        {r.mesesSemReajuste == null
                          ? <span className="text-muted-foreground">—</span>
                          : `${r.mesesSemReajuste}m`}
                      </TableCell>

                      <TableCell className="hidden xl:table-cell">
                        {serie.length > 1 && (
                          <Sparkline data={serie} color="hsl(var(--primary))" width={80} height={20} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {!linhas.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                      Ninguém no recorte atual.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            {linhas.length} pessoas · {meses.length ? `${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}` : "sem período"}
            {" · "}o histórico antes de {meses[0] ? rotuloMes(meses[0]) : "—"} ainda vai entrar pelo Conta Azul.
          </p>
        </>
      )}

      <FichaDaPessoa pessoa={aberta} onClose={() => setAberta(null)} />
    </div>
  );
}

/* ─────────────────────────── A ficha ───────────────────────────
   A linha do tempo mês a mês, que é o artefato que o diretor pediu: dá para
   apontar o dedo em cada degrau e dizer quando foi e de quanto. */

function FichaDaPessoa({ pessoa, onClose }: { pessoa: PessoaRemuneracao | null; onClose: () => void }) {
  if (!pessoa) return null;
  const r = resumoDaPessoa(pessoa);
  const degraus = degrausDoFixo(pessoa.meses);
  const porCompetencia = new Map(degraus.map((d) => [d.competencia, d]));
  const meses = [...pessoa.meses].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const tetoBarra = Math.max(1, ...meses.map((m) => Number(m.total) || 0));

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6 text-left leading-tight">{pessoa.nome}</SheetTitle>
        </SheetHeader>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {pessoa.cargo && <Badge variant="secondary" className="h-5">{pessoa.cargo}</Badge>}
          {pessoa.setor && <Badge variant="outline" className="h-5">{pessoa.setor}</Badge>}
          {pessoa.modalidade && <Badge variant="outline" className="h-5">{pessoa.modalidade}</Badge>}
        </div>

        {/* Resumo */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { r: "Fixo hoje", v: fmtBRL(r.fixoAtual) },
            { r: "Comissão média", v: r.mesesComPremiacao ? fmtBRL(r.premiacaoMedia) : "—" },
            { r: "Total no período", v: fmtBRL(r.totalPeriodo) },
            { r: "Tempo de casa", v: tempoDeCasaStr(pessoa.inicio) },
          ].map((x) => (
            <div key={x.r} className="rounded-lg border border-border/60 p-2.5">
              <div className="eyebrow text-[9.5px]">{x.r}</div>
              <div className="num mt-0.5 text-sm font-semibold">{x.v}</div>
            </div>
          ))}
        </div>

        {Math.abs(r.divergenciaContrato ?? 0) >= 1 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
            <div>
              <p className="font-medium">A ficha do Portal RH está desatualizada.</p>
              <p className="text-muted-foreground">
                Contrato lá: {valorExato(pessoa.valor_contrato)} · pago pelo Omie:{" "}
                {valorExato(r.fixoAtual)}. O Omie é a referência — o que precisa ser
                corrigido é a ficha.
              </p>
            </div>
          </div>
        )}

        {/* Linha do tempo */}
        <h3 className="mt-5 text-sm font-semibold">Mês a mês</h3>
        <div className="mt-2 space-y-1">
          {meses.map((m) => {
            const degrau = porCompetencia.get(m.competencia);
            const total = Number(m.total) || 0;
            const fixo = Number(m.fixo) || 0;
            const premiacao = Number(m.premiacao) || 0;
            const escala = Number(m.escala) || 0;
            return (
              <div key={m.competencia} className="rounded-lg px-2 py-1.5 hover:bg-secondary/50">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="w-14 shrink-0 text-muted-foreground">{rotuloMes(m.competencia)}</span>
                  <span className="num font-medium">{fmtBRL(total)}</span>
                </div>
                {/* Barra empilhada: fixo, comissão, escala. Largura relativa ao
                    maior mês da própria pessoa — comparar com o time inteiro
                    achataria a barra de quem ganha menos até virar um risco. */}
                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div style={{ width: `${(fixo / tetoBarra) * 100}%` }} className="bg-primary" />
                  <div style={{ width: `${(premiacao / tetoBarra) * 100}%` }} className="bg-pos" />
                  <div style={{ width: `${(escala / tetoBarra) * 100}%` }} className="bg-warn" />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
                  <span>fixo {fmtBRLStr(fixo)}</span>
                  {premiacao > 0 && <span className="text-pos">comissão {fmtBRLStr(premiacao)}</span>}
                  {escala > 0 && <span className="text-warn">escala {fmtBRLStr(escala)}</span>}
                  {degrau && (
                    <span className={cn("font-medium", degrau.variacao > 0 ? "text-pos" : "text-neg")}>
                      {degrau.variacao > 0 ? "▲" : "▼"} reajuste {pctStr(degrau.variacao)}
                      {" "}({fmtBRLStr(degrau.de)} → {fmtBRLStr(degrau.para)})
                    </span>
                  )}
                  {m.fontes && m.fontes !== "omie" && (
                    <span className="opacity-70">fontes: {m.fontes}</span>
                  )}
                </div>
              </div>
            );
          })}
          {!meses.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum pagamento registrado no período carregado.
            </p>
          )}
        </div>

        <dl className="mt-5 space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {[
            ["Código no RH", pessoa.codigo_rh ?? "sem ficha no Portal RH"],
            ["CNPJ/CPF", pessoa.doc ?? "—"],
            ["Início", inicioSuspeito(pessoa.inicio)
              ? `${fmtDataStr(pessoa.inicio)} — data suspeita, provavelmente o nascimento no campo errado`
              : fmtDataStr(pessoa.inicio)],
            ["Desligamento", pessoa.datadesl ? fmtDataStr(pessoa.datadesl) : "—"],
            ["Reajustes no período", String(degraus.length)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt>{k}</dt>
              <dd className="text-right text-foreground/80">{v}</dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  );
}
