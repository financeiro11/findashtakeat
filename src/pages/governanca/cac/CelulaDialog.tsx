import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronRight, AlertTriangle, Search, TriangleAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { comValorExato } from "@/components/ValorExato";
import { useApelidos } from "@/hooks/useApelidos";
import { useAuth } from "@/hooks/useAuth";
import { nomeExibido } from "@/lib/apelidos";
import {
  MESES, agruparPorPessoa, resumirCelula, desvioVsMedia,
  colunaDoMes, mesAnteriorDe, lancamentosParaPonte,
  type Lancamento, type LinhaMatriz, type SuspeitaDepartamento,
} from "@/lib/cac";
import { montarPonte } from "@/lib/ponteVariacao";
import { PonteVariacao } from "@/components/demonstracoes/PonteVariacao";

const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

function brl(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function brlSemCentavos(n: number) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const pctStr = (v: number) =>
  (v > 0 ? "+" : "") + (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

export function CelulaDialog({
  ano, linha, mes, manual = false, suspeitas = [], onClose, onMudou,
}: {
  ano: number;
  linha: LinhaMatriz | null;
  mes: number | null;
  /** Linha digitada: a célula abre o campo de valor em vez dos lançamentos. */
  manual?: boolean;
  /** Os casos de departamento fora do padrão que marcam ESTA célula. */
  suspeitas?: SuspeitaDepartamento[];
  onClose: () => void;
  /** Chamado depois de gravar ou apagar um valor digitado. */
  onMudou?: () => void;
}) {
  /* Por título: é a chave que casa a lista da célula com o quadro abaixo da matriz. */
  const suspeitaPorTitulo = useMemo(
    () => new Map(suspeitas.filter((s) => !s.decisao_id).map((s) => [s.cod_titulo, s])),
    [suspeitas],
  );
  const [lancs, setLancs] = useState<Lancamento[]>([]);
  const [lancsAnt, setLancsAnt] = useState<Lancamento[]>([]);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const apelidos = useApelidos();
  /* A célula é a folha de um time. Sem a folha inteira, o valor abre e a lista
     de pessoas não — ver o aviso mais abaixo. */
  const vejoAFolha = useAuth().acesso.folha.tipo === "tudo";

  const aberto = !!linha && mes != null;

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setLoading(true);
    setBusca("");
    setAberta(null);

    /* A célula do CAC É a folha de um time: nome e valor, pessoa a pessoa. Sem a
       folha inteira não se abre — nem a do próprio time. A RPC já recusa
       (devolve zero linhas); parar aqui evita a ida ao banco e, principalmente,
       evita que a tela mostre "0 pessoa(s) na regra", que faria quem lê achar
       que a regra está desconfigurada. */
    if (!vejoAFolha || manual) { setLancs([]); setLancsAnt([]); setLoading(false); return; }

    /* O mês anterior vem junto: a ponte precisa dos dois, e com um lado vazio
       ela diria que todo mundo entrou. */
    const ant = mesAnteriorDe(ano, mes!);
    void (async () => {
      const [atual, anterior] = await Promise.all([
        db.rpc("cac_celula", { p_ano: ano, p_mes: mes, p_linha_id: linha!.linha_id }),
        db.rpc("cac_celula", { p_ano: ant.ano, p_mes: ant.mes, p_linha_id: linha!.linha_id }),
      ]);
      if (cancelado) return;
      if (atual.error) {
        toast.error("Não consegui abrir a célula", { description: atual.error.message });
        setLancs([]);
      } else {
        setLancs((atual.data ?? []) as Lancamento[]);
      }
      setLancsAnt(anterior.error ? [] : ((anterior.data ?? []) as Lancamento[]));
      setLoading(false);
    })();

    return () => { cancelado = true; };
  }, [aberto, ano, mes, linha, vejoAFolha, manual]);

  const resumo = useMemo(() => resumirCelula(lancs), [lancs]);
  const pessoas = useMemo(() => agruparPorPessoa(lancs), [lancs]);

  /* A mesma ponte da DRE/DFC: quem entrou, saiu, aumentou ou reduziu contra o
     mês anterior, somando no centavo a variação da célula. */
  const ponte = useMemo(() => {
    if (!linha || mes == null) return null;
    const ant = mesAnteriorDe(ano, mes);
    return montarPonte(lancamentosParaPonte(lancs), lancamentosParaPonte(lancsAnt), {
      mes: colunaDoMes(ano, mes),
      mesAnterior: colunaDoMes(ant.ano, ant.mes),
      nomeDe: (l) => l.contraparte ?? "",
    });
  }, [linha, mes, ano, lancs, lancsAnt]);

  /* O mesmo desvio que pinta a célula na matriz. Quem clicou clicou POR CAUSA
     da cor — a explicação tem de estar aqui dentro, não só no hover que ficou
     para trás. */
  const dv = useMemo(
    () => (linha && mes ? desvioVsMedia(linha.meses, mes - 1) : null),
    [linha, mes],
  );

  /* A busca varre o apelido junto com o nome cru e o CNPJ. Se varresse só o
     que o Omie escreveu, procurar pelo nome que está ESCRITO na linha não
     acharia nada — a lição da Parametrização. */
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pessoas;
    return pessoas.filter((p) => {
      const alvo = [
        p.pessoa,
        p.cnpj,
        ...p.lancamentos.map((l) => l.favorecido ?? ""),
        ...p.lancamentos.map((l) => nomeExibido(apelidos, l.favorecido, l.cnpj)),
        ...p.lancamentos.map((l) => l.categoria_descricao ?? ""),
      ].join(" ").toLowerCase();
      return alvo.includes(q);
    });
  }, [pessoas, busca, apelidos]);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {linha?.rotulo} · {mes ? MESES[mes - 1] : ""}/{String(ano).slice(2)}
          </DialogTitle>
          <p className="text-[11.5px] text-muted-foreground">
            {linha?.grupo}
            {" · "}
            {dv ? `${pctStr(dv.desvio)} vs média 3m (${brl(dv.media)})` : "sem base de comparação"}
            {!loading && vejoAFolha && !manual && ` · ${pessoas.length} pessoa(s) na regra`}
          </p>
        </DialogHeader>

        {manual && linha && mes ? (
          <EditorManual ano={ano} mes={mes} linha={linha} onMudou={onMudou} />
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !vejoAFolha ? (
          <div className="space-y-3 py-2">
            {/* O que a célula VALE continua na matriz atrás deste diálogo; o que
                não abre é de quem ela é feita. */}
            <div className="rounded-md border border-border bg-muted/40 px-4 py-6 text-center">
              <Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-[12.5px] font-medium">Esta célula é folha de pagamento.</p>
              <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
                O valor e o desvio acima continuam valendo — o que não abre é quem recebeu e
                quanto. Para o seu time, o histórico por pessoa está em{" "}
                <strong>Operacional › Remuneração</strong>.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Folha × comissão: em Inside Sales mais da metade da célula é
                variável, e sem separar isso o número não conta a história. */}
            <div className="grid grid-cols-4 gap-2">
              <Resumo rotulo="Folha" valor={resumo.folha} total={resumo.total} />
              <Resumo rotulo="Comissão" valor={resumo.comissao} total={resumo.total} />
              <Resumo rotulo="Total" valor={resumo.total} total={resumo.total} destaque />
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Desvio 3m</p>
                <p className={cn("num text-[14px] font-semibold", dv && (dv.desvio > 0 ? "text-neg" : "text-pos"))}>
                  {dv ? pctStr(dv.desvio) : "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {dv ? `média ${brl(dv.media)}` : "sem base"}
                </p>
              </div>
            </div>

            {/* O sinal é o da DRE: custo negativo, e o grupo diz o que ele
                significa. A grade do CAC mostra o custo positivo, por isso a
                célula entra aqui com o sinal trocado. */}
            {ponte && linha && mes != null && (
              <PonteVariacao
                ponte={ponte}
                comp={null}
                carregando={false}
                celula={-linha.meses[mes - 1]}
                celulaAnterior={mes > 1 ? -linha.meses[mes - 2] : undefined}
                travado={false}
                travadoAnterior={false}
                moeda={brl}
                moedaSemCentavos={brlSemCentavos}
                obsDe={() => null}
                rubrica={`${linha.grupo} › ${linha.rotulo}`}
                mesLabel={`${MESES[mes - 1]}/${String(ano).slice(2)}`}
                entidade={{ um: "pessoa", varios: "pessoas" }}
                className="max-h-[340px] rounded-md border"
              />
            )}

            {suspeitaPorTitulo.size > 0 && (
              <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {suspeitaPorTitulo.size === 1 ? "1 lançamento" : `${suspeitaPorTitulo.size} lançamentos`} na categoria de outro departamento
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {[...new Set([...suspeitaPorTitulo.values()].map((s) =>
                    `${s.pessoa} (${s.departamento}) pago em ${s.familia}${s.linha_id ? "" : ", fora desta célula"}`,
                  ))].join(" · ")}
                  . O porquê e o botão de ignorar ficam no quadro “Departamento fora do padrão”, abaixo da matriz.
                </p>
              </div>
            )}

            {resumo.semPagamento.length > 0 && (
              <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {resumo.semPagamento.length} sem pagamento neste mês
                  <span className="font-normal text-muted-foreground">
                    · {comValorExato(resumo.semPagamentoEsperado, brl(resumo.semPagamentoEsperado))} de remuneração cadastrada
                  </span>
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {resumo.semPagamento.map((l) => l.pessoa).join(" · ")}
                </p>
              </div>
            )}

            {pessoas.length > 4 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar pessoa, CNPJ ou categoria…"
                  className="h-8 pl-8 text-[12.5px]"
                />
              </div>
            )}

            <div className="max-h-[36vh] overflow-y-auto rounded-md border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-semibold">Pessoa</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Folha</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Comissão</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((p) => (
                    <PessoaLinha
                      key={p.chave}
                      p={p}
                      aberta={aberta === p.chave}
                      onToggle={() => setAberta(aberta === p.chave ? null : p.chave)}
                      apelidos={apelidos}
                      suspeitaPorTitulo={suspeitaPorTitulo}
                    />
                  ))}
                  {!filtradas.length && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      {busca ? "Nada encontrado." : "Sem lançamentos neste mês."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {linha?.regra_nota && (
              <p className={cn(
                "text-[11.5px] leading-relaxed",
                linha.regra_nota.startsWith("CONFERIR") ? "text-warn" : "text-muted-foreground",
              )}>
                {linha.regra_nota}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* Agência de Marketing, Contadores e Comissão de MGM não saem do Omie — a skill
   manda digitar. O valor gravado aqui é o mesmo `cac_valores_manuais` que a
   importação usa, e vence o cálculo daquela célula. */
function EditorManual({ ano, mes, linha, onMudou }: {
  ano: number;
  mes: number;
  linha: LinhaMatriz;
  onMudou?: () => void;
}) {
  const atual = linha.origens[mes - 1] === "manual" ? linha.meses[mes - 1] : null;
  const [valor, setValor] = useState(atual == null ? "" : String(atual));
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setValor(atual == null ? "" : String(atual));
    setNota("");
  }, [atual, linha.linha_id, mes]);

  async function salvar() {
    const n = Number(valor);
    if (valor.trim() === "" || !isFinite(n)) {
      toast.error("Digite um valor", { description: "Use ponto para os centavos: 1234.56" });
      return;
    }
    setSalvando(true);
    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await db.from("cac_valores_manuais").upsert({
      ano, mes, linha_id: linha.linha_id, valor: n,
      nota: nota.trim() || "Digitado no painel",
      autor: sessao?.user?.id ?? null,
      autor_nome: sessao?.user?.email ?? null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "ano,mes,linha_id" });
    setSalvando(false);
    if (error) toast.error("Não consegui gravar", { description: error.message });
    else { toast.success("Valor gravado"); onMudou?.(); }
  }

  async function apagar() {
    setSalvando(true);
    const { error } = await db.from("cac_valores_manuais").delete()
      .eq("ano", ano).eq("mes", mes).eq("linha_id", linha.linha_id);
    setSalvando(false);
    if (error) toast.error("Não consegui apagar", { description: error.message });
    else { toast.success("Valor apagado"); onMudou?.(); }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Linha digitada todo mês — não há lançamento do Omie por trás dela.
      </p>
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)}
          placeholder="0.00" className="num h-8 text-[12.5px]" autoFocus />
        <Input value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="De onde veio o número (opcional)" className="h-8 text-[12.5px]" />
      </div>
      <div className="flex justify-end gap-2">
        {atual != null && (
          <Button variant="outline" size="sm" onClick={apagar} disabled={salvando}>Apagar</Button>
        )}
        <Button size="sm" onClick={salvar} disabled={salvando}>
          {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Gravar
        </Button>
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor, total, destaque }: {
  rotulo: string; valor: number; total: number; destaque?: boolean;
}) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div className={cn("rounded-md border border-border px-3 py-2", destaque && "bg-muted/40")}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="num text-[14px] font-semibold" title={valorExato(valor)}>{brl(valor)}</p>
      {!destaque && total > 0 && (
        <p className="text-[11px] text-muted-foreground">{pct.toFixed(0)}% da célula</p>
      )}
    </div>
  );
}

function PessoaLinha({ p, aberta, onToggle, apelidos, suspeitaPorTitulo }: {
  p: ReturnType<typeof agruparPorPessoa>[number];
  aberta: boolean;
  onToggle: () => void;
  apelidos: ReturnType<typeof useApelidos>;
  suspeitaPorTitulo: Map<number, SuspeitaDepartamento>;
}) {
  /* A marca sobe para a pessoa: com a linha fechada, o lançamento suspeito não
     aparece, e a lista de uma célula de Suporte tem trinta nomes. */
  const suspeitos = p.lancamentos.filter((l) => l.cod_titulo != null && suspeitaPorTitulo.has(l.cod_titulo)).length;

  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={onToggle}>
        <td className="px-3 py-1.5">
          <span className="inline-flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", aberta && "rotate-90")} />
            {p.pessoa}
            {suspeitos > 0 && (
              <span title={`${suspeitos} lançamento(s) na categoria de outro departamento`}>
                <TriangleAlert strokeWidth={2.2} className="h-3.5 w-3.5 fill-warn/30 text-warn" />
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-1.5 text-right num text-muted-foreground">{p.folha ? comValorExato(p.folha, brl(p.folha)) : "—"}</td>
        <td className="px-3 py-1.5 text-right num text-muted-foreground">{p.comissao ? comValorExato(p.comissao, brl(p.comissao)) : "—"}</td>
        <td className="px-3 py-1.5 text-right num font-medium">{comValorExato(p.total, brl(p.total))}</td>
      </tr>

      {aberta && p.lancamentos.map((l) => {
        /* Apelido em cima, nome cru embaixo — é o nome cru que se procura no
           Omie, então ele não pode sumir da tela. */
        const cru = l.favorecido ?? "";
        const exibido = nomeExibido(apelidos, cru, l.cnpj);
        const suspeita = l.cod_titulo != null ? suspeitaPorTitulo.get(l.cod_titulo) : undefined;
        return (
          <tr key={l.cod_titulo ?? `${l.cnpj}-${l.categoria}`} className="border-t border-border/50 bg-muted/10">
            <td className="px-3 py-1.5 pl-9">
              <span className="block text-[12px]">
                {/* O CAC é por competência: título lançado e ainda não pago
                    entra na célula, como na DRE. */}
                {l.data_pagamento ? new Date(`${l.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR") : "a vencer"}
                {" · "}
                <span
                  className={suspeita ? "font-medium text-warn" : "text-muted-foreground"}
                  title={suspeita
                    ? `${suspeita.pessoa} está no cadastro em ${suspeita.departamento}; esta categoria é de ${suspeita.familia}`
                    : undefined}
                >
                  {l.categoria_descricao ?? l.categoria ?? "—"}
                </span>
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {exibido !== cru ? `${exibido} · ${cru}` : cru}
                {l.cod_titulo ? ` · título ${l.cod_titulo}` : ""}
              </span>
            </td>
            <td colSpan={2} className="px-3 py-1.5 text-right">
              <Badge variant="outline" className="text-[10.5px]">{l.natureza ?? "—"}</Badge>
            </td>
            <td className="px-3 py-1.5 text-right num">{comValorExato(l.valor, brl(l.valor))}</td>
          </tr>
        );
      })}
    </>
  );
}
