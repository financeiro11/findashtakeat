/**
 * O e-mail de desligamento, buscado sozinho quando a ficha do desligado abre.
 *
 * O painel de rescisão precisa de coisas que a ficha do RH não guarda — dias de
 * férias já tirados, comissão a receber e o tipo de saída, que decide a multa
 * de uma remuneração inteira. Todas estão no e-mail que o gestor mandou, e a
 * `rescisao-email` vai ler: as conversas de desligamento em volta da data de
 * saída, inteiras, porque a resposta corrige o formulário.
 *
 * CACHE EM NÍVEL DE MÓDULO. Cada busca lê a caixa e passa por IA, e a ficha do
 * mesmo desligado se abre várias vezes numa conferência. Guardar por
 * colaborador na vida da aba evita repetir; `reler` força, para quando o gestor
 * corrige o e-mail depois.
 *
 * O QUE VOLTA É SUGESTÃO. Preenche campos que continuam editáveis e diz de
 * quais mensagens veio — sem essa linha, quem confere não tem como auditar.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDaFuncao } from "@/lib/erroEdge";
import type { Classificacao } from "@/lib/rescisao";

export type EmailDeDesligamento = {
  /** Id da CONVERSA (thread) — é o que se devolve para escolher. */
  id: string;
  assunto: string;
  data: string | null;
  remetente: string;
  /** "Nome no e-mail: …", quando a escolha depende de alguém olhar. */
  trecho?: string | null;
};

export type CamposDoEmail = {
  nomeNoEmail: string | null;
  ultimoDia: string | null;
  remuneracao: number | null;
  variavel: number | null;
  variavelTexto: string | null;
  diasDeFeriasTirados: number | null;
  feriasTexto: string | null;
  tipo: string | null;
  motivo: string | null;
};

export type RespostaDoEmail = {
  achou: boolean;
  /** A mensagem mais nova entre as lidas. */
  email?: EmailDeDesligamento;
  /** Todas as mensagens lidas, em ordem de chegada. */
  fontes?: EmailDeDesligamento[];
  campos?: CamposDoEmail;
  classificacao?: Classificacao | null;
  avisos?: string[];
  /** Por que não achou — nenhum, ou só o primeiro nome bateu. */
  motivo?: string;
  ambiguos?: EmailDeDesligamento[];
};

export type EstadoDoEmail = {
  carregando: boolean;
  resposta: RespostaDoEmail | null;
  erro: string | null;
};

/* A vida da aba basta: a caixa não muda no meio de uma conferência, e um
   refresh já é o "esquece o que você leu". */
const cache = new Map<string, RespostaDoEmail>();

export function useEmailDesligamento(
  colaboradorId: string,
  nome: string,
  /** A data de saída da ficha: é em volta dela que se procura. */
  datadesl: string | null,
  automatico = true,
) {
  const [estado, setEstado] = useState<EstadoDoEmail>({
    carregando: false,
    resposta: cache.get(colaboradorId) ?? null,
    erro: null,
  });

  const buscar = useCallback(
    async (opts: { threadId?: string; reler?: boolean } = {}) => {
      if (!opts.reler && !opts.threadId && cache.has(colaboradorId)) {
        setEstado({ carregando: false, resposta: cache.get(colaboradorId)!, erro: null });
        return;
      }
      setEstado((e) => ({ ...e, carregando: true, erro: null }));
      const { data, error } = await supabase.functions.invoke("rescisao-email", {
        body: { nome, datadesl, threadId: opts.threadId },
      });
      if (error) {
        setEstado({ carregando: false, resposta: null, erro: await mensagemDaFuncao(error) });
        return;
      }
      const resposta = data as RespostaDoEmail;
      // A conversa escolhida passa a ser a resposta deste colaborador.
      cache.set(colaboradorId, resposta);
      setEstado({ carregando: false, resposta, erro: null });
    },
    [colaboradorId, nome, datadesl],
  );

  useEffect(() => {
    if (!automatico || !nome) return;
    if (cache.has(colaboradorId)) return;
    void buscar();
  }, [automatico, buscar, colaboradorId, nome]);

  return { ...estado, buscar };
}
