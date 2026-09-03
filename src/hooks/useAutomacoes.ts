/* ---------------------------------------------------------------------------
 * O ESTADO DAS AUTOMAÇÕES, lido uma vez e servido a quem precisar.
 *
 * Duas telas leem a mesma coisa: a faixa do topo (que acompanha a pessoa em toda
 * página) e o painel `/monitoramento/automacoes`. Se cada uma fizesse a sua leitura,
 * abrir o painel custaria duas chamadas por minuto para o mesmo dado — e, pior,
 * a tela abriria em branco esperando um `hub_automacoes` que a faixa já tinha
 * acabado de trazer. O cache em nível de módulo resolve as duas coisas: quem
 * monta depois pinta na hora, com o que já está aqui.
 *
 * O RELÓGIO ANDA NO CLIENTE. Um tick de segundo para a contagem regressiva e uma
 * releitura de minuto para o estado: o cronômetro precisa ser vivo, o banco não
 * precisa ser lido uma vez por segundo (ver `cronProximo.ts`).
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EstadoHub } from "@/lib/automacoes";

const sb = supabase as any;

const RELEITURA_MS = 60_000;
/** Duas telas montando juntas não devem virar duas leituras. */
const FRESCO_MS = 15_000;

let cache: EstadoHub | null = null;
let erroCache: string | null = null;
let lidoEm = 0;
let voando: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const f of ouvintes) f();
}

/**
 * O QUE VOLTOU DO BANCO PRECISA SER CONFERIDO ANTES DE SER LIDO — e isto não é
 * paranoia de tipo, é a moldura inteira do Hub.
 *
 * A faixa mora no header, acima de TODAS as páginas. Um `estado.filas` ausente
 * quebra o `useMemo`, o React derruba a árvore e a pessoa vê "Algo deu errado"
 * em cima de qualquer tela que abrir — porque o marcador de status falhou. Um
 * painel de saúde que consegue matar o paciente é pior do que não ter painel.
 *
 * E não é hipótese: pegou na primeira conferência no navegador. Basta a RPC
 * responder outra coisa — função ausente depois de uma migração, permissão
 * revogada, versão antiga sem `filas` — para o dado não ter o formato que o tipo
 * promete. `as EstadoHub` é uma afirmação, não uma verificação.
 */
function guardar(data: unknown, error: { message: string } | null) {
  lidoEm = Date.now();
  if (error) {
    erroCache = error.message;
    cache = null;
    return;
  }
  const d = data as Partial<EstadoHub> | null;
  if (!d || Array.isArray(d) || !Array.isArray(d.automacoes)) {
    erroCache = "a resposta de hub_automacoes não tem o formato esperado";
    cache = null;
    return;
  }
  cache = {
    automacoes: d.automacoes,
    filas: Array.isArray(d.filas) ? d.filas : [],
    gerado_em: d.gerado_em ?? "",
  };
  erroCache = null;
}

async function lerDoBanco(forcar: boolean): Promise<void> {
  if (voando) return voando;
  if (!forcar && Date.now() - lidoEm < FRESCO_MS) return;
  voando = (async () => {
    try {
      const { data, error } = await sb.rpc("hub_automacoes");
      guardar(data, error);
    } catch (e: any) {
      guardar(null, { message: e?.message ?? String(e) });
    } finally {
      voando = null;
      avisar();
    }
  })();
  avisar(); // para o "lendo" acender
  return voando;
}

export type LeituraAutomacoes = {
  estado: EstadoHub | null;
  erro: string | null;
  /** O agora do relógio, que anda de segundo em segundo. */
  agora: Date;
  lendo: boolean;
  ler: () => void;
};

export function useAutomacoes(): LeituraAutomacoes {
  const [, repintar] = useState(0);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const f = () => repintar((n) => n + 1);
    ouvintes.add(f);
    void lerDoBanco(false);
    const releitura = setInterval(() => void lerDoBanco(false), RELEITURA_MS);
    const tick = setInterval(() => setAgora(new Date()), 1000);
    return () => {
      ouvintes.delete(f);
      clearInterval(releitura);
      clearInterval(tick);
    };
  }, []);

  const ler = useCallback(() => void lerDoBanco(true), []);

  return { estado: cache, erro: erroCache, agora, lendo: !!voando, ler };
}
