/* ---------------------------------------------------------------------------
 * "ESTÁ RODANDO?" — respondido no topo, em qualquer página.
 *
 * O Hub tem 46 automações e nenhuma tela dizia se elas rodaram. Quando alguém
 * afirma "a fila está drenando", não havia onde conferir — e um painel existe
 * justamente para dispensar a confiança em quem afirma.
 *
 * ELA PRECISA DIZER O NOME DELA. A primeira versão mostrava só um cronômetro e
 * um pontinho: informação certa que ninguém sabia ser sobre o quê — a pessoa que
 * pediu a faixa não a achou na tela. Um marcador de status que não se apresenta
 * não é discreto, é invisível. Agora a palavra "Automações" vem junto, e o
 * detalhe continua a um clique — com caminho para o painel inteiro
 * (`/automacoes/painel`), que é onde a esteira das notas se lê etapa a etapa.
 *
 * O PONTO VERMELHO É O PONTO. Falha de automação não avisa sozinha — o cron
 * segue disparando, a função segue respondendo 500, e o número na tela para de
 * andar sem que nada acuse. Foi assim que `omie-cartao-nome` passou dias
 * respondendo "Não autenticado." com o painel do Supabase dizendo `succeeded`.
 * ------------------------------------------------------------------------- */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { desde, faltam, proximoDisparo } from "@/lib/cronProximo";
import { useAutomacoes } from "@/hooks/useAutomacoes";
import { DA_ESTEIRA, FILA_DESTAQUE, O_QUE_FAZ, falhou } from "@/lib/automacoes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, ArrowUpRight, Check, Loader2, RefreshCw, Zap } from "lucide-react";

export function FaixaEsteira() {
  const { estado, erro, agora, lendo, ler } = useAutomacoes();
  const [aberto, setAberto] = useState(false);

  const calc = useMemo(() => {
    const autos = (estado?.automacoes ?? []).filter((a) => a.ativo);
    const comProximo = autos
      .map((a) => ({ a, quando: proximoDisparo(a.schedule, agora) }))
      .filter((x) => x.quando)
      .sort((x, y) => x.quando!.getTime() - y.quando!.getTime());

    const daEsteira = comProximo.filter((x) => DA_ESTEIRA.has(x.a.jobname));
    const ruins = autos.filter(falhou);
    const filaOmie = (estado?.filas ?? []).find((f) => f.chave === FILA_DESTAQUE)?.quantos ?? 0;

    return {
      autos, comProximo,
      proximo: (daEsteira[0] ?? comProximo[0]) ?? null,
      ruins,
      filaOmie,
    };
  }, [estado, agora]);

  if (!estado && !erro) {
    return (
      <span className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden md:inline">Automações</span>
      </span>
    );
  }

  const temFalha = calc.ruins.length > 0 || !!erro;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded border px-2 py-1 text-[12px] transition-colors",
            temFalha
              ? "border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-400"
              : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          title="Como estão as automações do Hub — o que já rodou, o que vem a seguir e o tamanho das filas"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              temFalha ? "bg-red-500" : "bg-emerald-500",
            )}
          />
          {/* NÃO CONSEGUIR LER É DIFERENTE DE NADA ESTAR QUEBRADO, e a faixa
              chegou a dizer "0 automação falhando" — em vermelho — quando o que
              tinha falhado era a própria leitura. Frase que se contradiz sozinha
              é o jeito mais rápido de um painel perder o crédito. */}
          {erro ? (
            <span className="font-medium">não deu para ler as automações</span>
          ) : temFalha ? (
            <span className="font-medium">
              {calc.ruins.length} automação{calc.ruins.length > 1 ? "ões" : ""} falhando
            </span>
          ) : (
            <>
              <Zap className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground/80">Automações</span>
              <span className="tabular-nums">{faltam(calc.proximo?.quando ?? null, agora)}</span>
              {calc.filaOmie > 0 && (
                <span className="hidden lg:inline">· {calc.filaOmie} na fila do Omie</span>
              )}
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(30rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-start justify-between gap-2 border-b border-border p-3">
          <div>
            <p className="text-[13px] font-semibold">Automações do Hub</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {calc.autos.length} ativas · lido {desde(estado?.gerado_em ?? null, agora)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link
              to="/automacoes/painel"
              onClick={() => setAberto(false)}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              Abrir o painel <ArrowUpRight className="h-3 w-3" />
            </Link>
            <button className="ghost-icone" onClick={ler} disabled={lendo} aria-label="Reler">
              {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {erro && (
          <p className="border-b border-border bg-red-500/10 p-3 text-[12.5px] text-red-700 dark:text-red-400">
            Não deu para ler o estado: {erro}
          </p>
        )}

        {/* O QUE ESTÁ QUEBRADO VEM PRIMEIRO. Quem abre este painel com algo
            vermelho na faixa veio por causa dele. */}
        {!!calc.ruins.length && (
          <div className="border-b border-border p-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Falhando
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {calc.ruins.map((a) => (
                <li key={a.jobname} className="text-[12px]">
                  <span className="font-medium">{a.jobname}</span>
                  <span className="text-muted-foreground"> · {a.schedule} · {desde(a.ultimo_em, agora)}</span>
                  <p className="truncate text-[11.5px] text-red-700/80 dark:text-red-400/80">
                    {a.status_http ? `HTTP ${a.status_http} · ` : ""}
                    {a.erro_sql || a.resposta || "sem detalhe"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AS FILAS: um cron pode estar rodando lindamente e a fila crescendo. */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border p-3 text-[12px]">
          {(estado?.filas ?? []).map((f) => (
            <div key={f.chave} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-muted-foreground">{f.rotulo}</span>
              <span className={cn("shrink-0 tabular-nums", f.quantos > 0 && "font-medium")}>
                {f.quantos}
              </span>
            </div>
          ))}
        </div>

        <div className="max-h-[19rem] overflow-auto p-1">
          {calc.comProximo.map(({ a, quando }) => {
            const ruim = falhou(a);
            return (
              <div
                key={a.jobname}
                className="flex items-baseline justify-between gap-2 rounded px-2 py-1 text-[12px] hover:bg-muted/50"
                title={`${a.schedule}${O_QUE_FAZ[a.jobname] ? ` · ${O_QUE_FAZ[a.jobname]}` : ""}${a.resposta ? ` · ${a.resposta}` : ""}`}
              >
                <span className="flex min-w-0 items-baseline gap-1.5">
                  {ruim
                    ? <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" />
                    : <Check className="h-3 w-3 shrink-0 text-emerald-500/70" />}
                  <span className="truncate">{a.jobname}</span>
                  {DA_ESTEIRA.has(a.jobname) && (
                    <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
                      notas
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {faltam(quando, agora)}
                </span>
              </div>
            );
          })}
        </div>

        <p className="border-t border-border p-2 text-[11px] text-muted-foreground">
          Horários em UTC no banco; a contagem já está no seu fuso. Verde é a
          função ter respondido 2xx — não só o cron ter disparado.
        </p>
      </PopoverContent>
    </Popover>
  );
}
