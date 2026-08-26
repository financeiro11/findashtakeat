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

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarClock, Loader2, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  bloqueioDaFolha, montarLote, pendenciasDoLote, previsaoDe, recusaDaFolha,
  registroDa, resolvedorDeCategoria, soDigitos, vencimentoDa,
  type ColaboradorDaFolha, type ItemDaFolha, type ResolveDePara,
} from "../../../supabase/functions/_shared/folha-envio";

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
  rescisao: "saiu no mês",
  admissao_e_rescisao: "entrou e saiu no mês",
};

/* As tabelas do RH e da folha não estão no `types.ts` gerado, então o cliente
   tipado do Supabase não as conhece. Em vez de espalhar `any` por cada
   consulta, o formato de cada linha é declarado aqui e a fuga de tipo fica
   num ponto só (`tabela`). */
type LinhaRh = {
  id: string; codigo: string | null; nome: string | null; cnpj: string | null;
  razao: string | null; valor: number | null; inicio: string | null;
  datadesl: string | null; valor_liberalidade: number | null;
};
type LinhaDePara = {
  codigo_rh: string; departamento: string | null;
  categoria_descricao: string | null; valor_referencia: number | string | null;
};
type LinhaEnvio = { estado: string | null };
type ClienteCache = { codigo: string | number; cnpj_cpf?: string | null };

/** Uma consulta a tabela fora do `types.ts`. A fuga de tipo mora só aqui. */
const tabela = (nome: string) =>
  (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> & {
        eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
      };
    };
  }).from(nome);

type Linha = ItemDaFolha & {
  codigoFornecedor: number | null;
  codigoCategoria: string | null;
  codigoDepartamento: string | null;
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
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [fora, setFora] = useState<{ nome: string; motivo: string }[]>([]);
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true); setErro(null);

    (async () => {
      // Espelho do RH, de-para e catálogo do Omie: três leituras, nenhuma escrita.
      const [rh, dep, cache, envio] = await Promise.all([
        tabela("rh_colaboradores")
          .select("id, codigo, nome, cnpj, razao, valor, inicio, datadesl, valor_liberalidade"),
        tabela("folha_depara")
          .select("codigo_rh, departamento, categoria_descricao, valor_referencia"),
        supabase.from("omie_cache").select("dados").eq("chave", "folha_cadastros").maybeSingle(),
        tabela("folha_envios_omie")
          .select("estado").eq("competencia", `${competencia}-01`).maybeSingle(),
      ]);

      if (!vivo) return;
      if (rh.error) { setErro(rh.error.message); setCarregando(false); return; }

      const cadastros = (cache.data?.dados ?? {}) as {
        categorias?: { codigo: string; descricao: string; conta_inativa?: boolean }[];
        departamentos?: { codigo: string; descricao: string }[];
      };
      const codCategoria = resolvedorDeCategoria(cadastros.categorias ?? []);
      const codDepartamento = new Map(
        (cadastros.departamentos ?? []).map((d) => [d.descricao, d.codigo]),
      );

      const porCodigo = new Map(
        ((dep.data ?? []) as LinhaDePara[]).map((d) => [String(d.codigo_rh), d]),
      );
      const deParaDe: ResolveDePara = (codigo) => {
        const d = porCodigo.get(codigo);
        return d
          ? {
            departamento: d.departamento ?? "",
            categoria: d.categoria_descricao ?? "",
            valorReferencia: d.valor_referencia === null ? null : Number(d.valor_referencia),
          }
          : null;
      };

      const pessoas: ColaboradorDaFolha[] = ((rh.data ?? []) as LinhaRh[]).map((c) => ({
        id: String(c.id), codigo: c.codigo ?? null, nome: String(c.nome ?? "").trim(),
        cnpj: c.cnpj ?? null, razao: c.razao ?? null, valor: c.valor,
        inicio: c.inicio ?? null, datadesl: c.datadesl ?? null,
        valor_liberalidade: c.valor_liberalidade ?? null,
      }));

      // O fornecedor sai do cache de clientes, casado pelo CNPJ.
      const clientes = await supabase.from("omie_cache").select("dados").eq("chave", "clientes").maybeSingle();
      const porCnpj = new Map<string, number>();
      for (const c of (clientes.data?.dados ?? []) as ClienteCache[]) {
        const k = soDigitos(c?.cnpj_cpf);
        if (k && !porCnpj.has(k)) porCnpj.set(k, Number(c.codigo));
      }

      const lote = montarLote(pessoas, competencia, deParaDe);
      if (!vivo) return;

      setLinhas(lote.itens.map((i) => ({
        ...i,
        codigoFornecedor: porCnpj.get(i.cnpj) ?? null,
        codigoCategoria: i.categoria ? codCategoria(i.categoria) : null,
        codigoDepartamento: i.departamento ? codDepartamento.get(i.departamento) ?? null : null,
      })));
      setFora(lote.fora.map((f) => ({ nome: f.nome, motivo: f.motivo })));
      setEstado((envio.data as LinhaEnvio | null)?.estado ?? null);
      setCarregando(false);
    })().catch((e) => {
      if (vivo) { setErro(e instanceof Error ? e.message : String(e)); setCarregando(false); }
    });

    return () => { vivo = false; };
  }, [aberto, competencia]);

  const registro = registroDa(competencia);
  const vencimento = vencimentoDa(competencia);
  const previsao = previsaoDe(vencimento);
  const total = linhas.reduce((s, l) => s + l.valor, 0);

  const marcadas = linhas.filter((l) => l.chamaAtencao);
  const rateadas = linhas.filter((l) => l.motivo !== "cheio");
  /* Quem saiu no mês entra no lote pela regra combinada (proporcional dos dias
     trabalhados). Mas a rescisão dessas pessoas é calculada e paga em
     /governanca/rescisoes, parcela a parcela — e se aquele cálculo já incluir
     os dias do mês, provisionar aqui paga a mesma coisa duas vezes. A tela não
     decide por ninguém: mostra quem são e o quanto é. */
  const desligados = linhas.filter(
    (l) => l.motivo === "rescisao" || l.motivo === "admissao_e_rescisao",
  );
  const totalDesligados = desligados.reduce((s, l) => s + l.valor, 0);

  const pendencia = useMemo(
    () => pendenciasDoLote(linhas.map((l) => ({
      cnpj: l.cnpj, codigoFornecedor: l.codigoFornecedor, codigoCategoria: l.codigoCategoria,
    }))),
    [linhas],
  );

  const recusa = useMemo(
    () => recusaDaFolha({
      competencia,
      estado: (estado as Parameters<typeof recusaDaFolha>[0]["estado"]) ?? null,
      itens: linhas.map((l) => ({
        cnpj: l.cnpj, codigoFornecedor: l.codigoFornecedor, codigoCategoria: l.codigoCategoria,
      })),
    }),
    [competencia, estado, linhas],
  );

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prévia da folha · competência {competencia}</DialogTitle>
          <DialogDescription>
            Registro {dataBR(registro)} · vencimento {dataBR(vencimento)}
            {previsao !== vencimento && <> · previsão {dataBR(previsao)} (o dia 5 caiu no fim de semana)</>}
          </DialogDescription>
        </DialogHeader>

        {carregando && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Montando o lote…
          </div>
        )}

        {erro && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </div>
        )}

        {!carregando && !erro && (
          <>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4 rounded-xl border bg-card px-[18px] py-3.5">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Total a provisionar
                </p>
                <p className="num mt-1 text-[26px] font-medium leading-none">{BRL(total)}</p>
              </div>
              <div className="hidden h-11 w-px bg-border sm:block" />
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]">
                <Numero rotulo="Títulos" valor={String(linhas.length)} icone={Users} />
                <Numero rotulo="Rateados" valor={String(rateadas.length)} icone={CalendarClock} />
                <Numero
                  rotulo="Valor mudou"
                  valor={String(marcadas.length)}
                  icone={AlertTriangle}
                  tom={marcadas.length ? "atencao" : undefined}
                />
                <Numero
                  rotulo="Fora do lote"
                  valor={String(fora.length)}
                  tom={fora.length ? "atencao" : undefined}
                />
              </div>
            </div>

            {marcadas.length > 0 && (
              <Aviso tom="atencao" titulo={`${marcadas.length} salário(s) mudaram desde a última folha`}>
                Aumento é rotina; dígito a mais também. Confira antes de enviar — o total da folha
                pode empatar mesmo com erros dentro, porque eles se cancelam.
              </Aviso>
            )}

            {desligados.length > 0 && (
              <Aviso
                tom="atencao"
                titulo={`${desligados.length} desligado(s) no lote · ${BRL(totalDesligados)}`}
              >
                Rescisão tem processo próprio em Governança › Rescisões, que calcula as
                parcelas e controla o pagamento. Se o cálculo de lá já cobrir os dias
                trabalhados no mês, provisionar aqui paga duas vezes. Confira antes de enviar:
                {" "}{desligados.map((d) => d.nome).join(", ")}.
              </Aviso>
            )}

            {pendencia && <Aviso tom="erro" titulo="Pendência que impede o envio">{pendencia}</Aviso>}

            {bloqueioDaFolha() && (
              <Aviso tom="neutro" titulo="Envio desligado no código">{bloqueioDaFolha()}</Aviso>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-secondary text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="px-3.5 py-2.5 text-left font-semibold">Colaborador</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Departamento</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Categoria</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Dias</th>
                    <th className="px-3.5 py-2.5 text-right font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.codigo} className="border-b border-border/60 hover:bg-muted/40">
                      <td className="px-3.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{l.nome}</span>
                          {l.motivo !== "cheio" && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                              {RATEIO[l.motivo]}
                            </span>
                          )}
                          {!l.codigoFornecedor && (
                            <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-destructive">
                              sem fornecedor
                            </span>
                          )}
                        </div>
                        <span className="mono text-[11px] text-muted-foreground">{l.codigo}</span>
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
                        <span className="num text-[13.5px]">{BRL(l.valor)}</span>
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
                        {l.liberalidade > 0 && (
                          <span className="block text-[11px] text-muted-foreground">
                            inclui {BRL(l.liberalidade)} de liberalidade
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

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="max-w-[60%] text-xs text-muted-foreground">
                {recusa ?? "Lote em ordem. Nada foi criado no Omie por esta tela."}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onFechar}>Fechar</Button>
                <Button disabled title={recusa ?? undefined}>
                  Provisionar {linhas.length} no Omie
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
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
