/* ---------------------------------------------------------------------------
 * "ESTÁ RODANDO?" — respondido no topo, em qualquer página.
 *
 * O Hub tem 46 automações e nenhuma tela dizia se elas rodaram. Quando alguém
 * afirma "a fila está drenando", não havia onde conferir — e um painel existe
 * justamente para dispensar a confiança em quem afirma.
 *
 * O QUE ESTA FAIXA MOSTRA, e por que é pouco de propósito: o próximo disparo
 * que importa, o tamanho da fila e um ponto de status. Três coisas cabem no
 * canto do olho; a quarta viraria ruído permanente numa moldura que acompanha
 * a pessoa por todas as páginas. O detalhe fica a um clique.
 *
 * O PONTO VERMELHO É O PONTO. Falha de automação não avisa sozinha — o cron
 * segue disparando, a função segue respondendo 500, e o número na tela para de
 * andar sem que nada acuse. Foi assim que `omie-cartao-nome` passou dias
 * respondendo "Não autenticado." com o painel do Supabase dizendo `succeeded`.
 *
 * A CONTAGEM ANDA NO CLIENTE. Um tick de segundo aqui e uma leitura do banco a
 * cada 60s: o relógio precisa ser vivo, o estado não muda tão rápido assim.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { desde, faltam, proximoDisparo } from "@/lib/cronProximo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Check, Loader2, RefreshCw, Timer } from "lucide-react";

const sb = supabase as any;

type Automacao = {
  jobname: string;
  schedule: string;
  ativo: boolean;
  alvo: string | null;
  chama_funcao: boolean;
  ultimo_em: string | null;
  status_http: number | null;
  resposta: string;
  aguardando: boolean;
  status_sql: string | null;
  erro_sql: string | null;
  falhas_24h: number;
  execucoes_24h: number;
};
type Fila = { chave: string; rotulo: string; quantos: number };
type Estado = { automacoes: Automacao[]; filas: Fila[]; gerado_em: string };

/**
 * Falhou? A resposta HTTP manda quando existe; o `job_run_details` só responde
 * por quem não chama função nenhuma.
 *
 * A ORDEM IMPORTA e é o miolo desta tela: `job_run_details` diz `succeeded`
 * quando o SQL do cron rodou, e o SQL de todo cron aqui é um `net.http_post`,
 * que "sucede" mesmo quando a função devolve 500. Perguntar ao SQL primeiro
 * pintaria de verde exatamente o que está quebrado.
 */
function falhou(a: Automacao): boolean {
  if (!a.ativo) return false;
  if (a.status_http != null) return a.status_http >= 300;
  if (a.chama_funcao) return false;              // ainda não colheu resposta
  return a.status_sql != null && a.status_sql !== "succeeded";
}

/** As da esteira de notas, que são as que a tela de Notas no ERP alimenta. */
const DA_ESTEIRA = new Set([
  "notas-acervo-casar", "auditoria-anexo-varredura", "omie-anexos-varredura",
  "nota-ler-arquivo", "nota-baixar-link", "gmail-nf-sync-horaria",
  "nota-propagar-varredura", "anexo-triagem-ia", "anexo-link-aquecer",
]);

export function FaixaEsteira() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => new Date());
  const [aberto, setAberto] = useState(false);
  const [lendo, setLendo] = useState(false);

  /**
   * O QUE VOLTOU DO BANCO PRECISA SER CONFERIDO ANTES DE SER LIDO — e isto não é
   * paranoia de tipo, é a moldura inteira do Hub.
   *
   * Esta faixa mora no header, dentro do `AppLayout`, acima de TODAS as páginas.
   * Um `estado.filas` ausente quebra o `useMemo`, o React derruba a árvore e o
   * usuário vê "Algo deu errado" em cima de qualquer tela que abrir — porque o
   * marcador de status falhou. Um painel de saúde que consegue matar o paciente
   * é pior do que não ter painel.
   *
   * E não é hipótese: pegou na primeira conferência no navegador. Basta a RPC
   * responder outra coisa — função ausente depois de uma migração, permissão
   * revogada, versão antiga sem `filas` — para `data` não ter o formato que o
   * tipo promete. `as Estado` é uma afirmação minha, não uma verificação.
   */
  const ler = useCallback(async () => {
    setLendo(true);
    const { data, error } = await sb.rpc("hub_automacoes");
    const d = data as Partial<Estado> | null;
    if (error) { setErro(error.message); setEstado(null); }
    else if (!d || Array.isArray(d) || !Array.isArray(d.automacoes)) {
      setErro("a resposta de hub_automacoes não tem o formato esperado");
      setEstado(null);
    } else {
      setEstado({
        automacoes: d.automacoes,
        filas: Array.isArray(d.filas) ? d.filas : [],
        gerado_em: d.gerado_em ?? "",
      });
      setErro(null);
    }
    setLendo(false);
  }, []);

  useEffect(() => { void ler(); }, [ler]);
  // O relógio anda de segundo; o estado, de minuto.
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    const r = setInterval(() => void ler(), 60_000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [ler]);

  const calc = useMemo(() => {
    const autos = (estado?.automacoes ?? []).filter((a) => a.ativo);
    const comProximo = autos
      .map((a) => ({ a, quando: proximoDisparo(a.schedule, agora) }))
      .filter((x) => x.quando)
      .sort((x, y) => x.quando!.getTime() - y.quando!.getTime());

    const daEsteira = comProximo.filter((x) => DA_ESTEIRA.has(x.a.jobname));
    const ruins = autos.filter(falhou);
    const filaOmie = (estado?.filas ?? []).find((f) => f.chave === "anexo_erp")?.quantos ?? 0;

    return {
      autos, comProximo,
      proximo: (daEsteira[0] ?? comProximo[0]) ?? null,
      ruins,
      filaOmie,
      totalFila: (estado?.filas ?? []).reduce((s, f) => s + f.quantos, 0),
    };
  }, [estado, agora]);

  if (!estado && !erro) {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }

  const temFalha = calc.ruins.length > 0 || !!erro;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 rounded border px-2 py-1 text-[12px] transition-colors",
            temFalha
              ? "border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-400"
              : "border-border text-muted-foreground hover:bg-muted/60",
          )}
          title="Como estão as automações do Hub"
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
              <Timer className="h-3.5 w-3.5" />
              <span className="tabular-nums">{faltam(calc.proximo?.quando ?? null, agora)}</span>
              {calc.filaOmie > 0 && (
                <span className="hidden sm:inline">· {calc.filaOmie} na fila</span>
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
          <button className="ghost-icone" onClick={() => void ler()} disabled={lendo} aria-label="Reler">
            {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
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
                title={`${a.schedule}${a.resposta ? ` · ${a.resposta}` : ""}`}
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
