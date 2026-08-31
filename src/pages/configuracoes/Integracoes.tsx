import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, Loader2, Plug, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { urlDaFuncao } from "@/lib/urlFuncao";

/* /configuracoes/integracoes — as portas do Hub para fora, e se cada uma abre.
 *
 * POR QUE ESTA TELA EXISTE, e o caso que a decidiu: em 29/08/2026 a planilha de
 * churn deixou de abrir porque alguém removeu o compartilhamento "qualquer
 * pessoa com o link". O Hub só soube porque um cron ficou vermelho — e a
 * mensagem dizia "Google [401]", não "a planilha fechou". Antes disso, o Gmail
 * precisou ser reconectado à mão, por um link montado fora do produto, porque
 * não existia tela nenhuma para isso.
 *
 * CREDENCIAL NÃO AVISA QUE MORREU. Ela para de funcionar e o sintoma aparece
 * três telas adiante, como um número que não anda. Aqui se pergunta antes de
 * precisar.
 *
 * TRÊS ESTADOS, NÃO DOIS. `null` é "não deu para checar" e tem ícone próprio,
 * cinza — é diferente de "quebrada". Pintar dúvida de vermelho ensina a ignorar
 * o vermelho, que é o oposto do que esta tela quer.
 *
 * NENHUM SEGREDO APARECE AQUI. Nem prefixo, nem tamanho. A função devolve
 * `conectado` e uma frase; uma tela de diagnóstico que vaza credencial é pior
 * que não ter tela.
 */

type Estado = {
  chave: string;
  nome: string;
  para_que: string;
  conectado: boolean | null;
  detalhe: string;
  conserto?: "gmail_oauth" | "painel_supabase" | "compartilhar_planilha" | "compartilhar_com_conta";
  extra?: Record<string, unknown>;
};

const AJUDA: Record<string, string> = {
  painel_supabase:
    "É uma chave de ambiente. Troque em Supabase › Edge Functions › Secrets e recheque aqui.",
  compartilhar_planilha:
    'Abra a planilha no Google Drive, em Compartilhar, e deixe "qualquer pessoa com o link" como leitor.',
  /* Este caminho NÃO pede link público — pede a planilha compartilhada com a
     conta Google que o Hub usa, que é a mesma das outras planilhas nativas. É a
     diferença entre abrir o arquivo para a internet e dar acesso a quem trabalha
     nele. */
  compartilhar_com_conta:
    "Abra a planilha em Compartilhar e dê acesso (leitor basta) à conta Google conectada ao Hub — a mesma " +
    "que já lê as outras planilhas. Não é preciso ligar o link público.",
};

async function chamar<T>(funcao: string, corpo: unknown): Promise<T> {
  const { data: sessao } = await supabase.auth.getSession();
  const token = sessao?.session?.access_token;
  if (!token) throw new Error("sessão expirada — recarregue a página");

  const r = await fetch(urlDaFuncao(funcao), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as T;
}

function Selo({ c }: { c: boolean | null }) {
  if (c === true) return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (c === false) return <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />;
  return <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export default function Integracoes() {
  const [itens, setItens] = useState<Estado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [conectando, setConectando] = useState(false);

  const ler = useCallback(async () => {
    setLendo(true);
    setErro(null);
    try {
      const j = await chamar<{ integracoes: Estado[] }>("integracoes-status", { action: "status" });
      setItens(j.integracoes ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setItens([]);
    } finally {
      setLendo(false);
    }
  }, []);

  useEffect(() => { ler(); }, [ler]);

  /* O CONSENTIMENTO ABRE EM ABA NOVA e a volta é uma página do Google, não
     nossa — então não dá para saber daqui quando terminou. Por isso o texto
     manda rechecar em vez de fingir que atualiza sozinho. */
  const conectarGmail = useCallback(async () => {
    setConectando(true);
    try {
      const j = await chamar<{ url: string }>("gmail-oauth", { action: "url" });
      window.open(j.url, "_blank", "noopener");
      toast.info("Autorize na aba que abriu e depois use 'Rechecar' aqui.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConectando(false);
    }
  }, []);

  const quebradas = (itens ?? []).filter((i) => i.conectado === false).length;

  return (
    <div className="space-y-3.5 px-5 pb-7 pt-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Plug className="h-5 w-5 text-muted-foreground" />
            Integrações
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            As portas do Hub para fora. Credencial não avisa que morreu — aqui se pergunta antes de precisar.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={ler} disabled={lendo}>
          {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Rechecar
        </Button>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/40 bg-card p-3 text-[12.5px] text-red-700 dark:text-red-400">
          Não consegui checar: {erro}
        </div>
      )}

      {!!quebradas && (
        <div className="rounded-lg border border-red-500/40 bg-card p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-red-700 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {quebradas} integração{quebradas > 1 ? "ões" : ""} precisando de atenção
          </p>
        </div>
      )}

      {itens === null ? (
        <p className="py-10 text-center text-[12.5px] text-muted-foreground">Checando…</p>
      ) : (
        <ul className="space-y-2">
          {itens.map((i) => (
            <li
              key={i.chave}
              className={cn(
                "rounded-lg border bg-card p-3",
                i.conectado === false ? "border-red-500/40" : "border-border",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5"><Selo c={i.conectado} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{i.nome}</p>
                  <p className="text-[11.5px] text-muted-foreground">{i.para_que}</p>
                  <p className={cn(
                    "mt-1 text-[12px]",
                    i.conectado === false ? "text-red-700 dark:text-red-400" : "text-muted-foreground",
                  )}>
                    {i.detalhe}
                  </p>

                  {/* A ajuda só aparece quando há problema — instrução ao lado de
                      algo que funciona é ruído que se aprende a pular. */}
                  {i.conectado === false && i.conserto && AJUDA[i.conserto] && (
                    <p className="mt-1 text-[11.5px] text-muted-foreground">{AJUDA[i.conserto]}</p>
                  )}
                </div>

                {i.conserto === "gmail_oauth" && (
                  <Button
                    size="sm"
                    variant={i.conectado === true ? "outline" : "default"}
                    className="h-7 shrink-0"
                    onClick={conectarGmail}
                    disabled={conectando}
                  >
                    {conectando
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <ExternalLink className="h-3.5 w-3.5" />}
                    {i.conectado === true ? "Reconectar" : "Conectar"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11.5px] text-muted-foreground">
        O consumo do Firecrawl (raspagem) tem painel próprio em Governança › Vigilância externa.
      </p>
    </div>
  );
}
