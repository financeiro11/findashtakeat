/**
 * O e-mail de desligamento, buscado sozinho quando a ficha do desligado abre.
 *
 * O painel de rescisão precisa de três coisas que a ficha do RH não guarda —
 * dias de férias já tirados, variável do mês e o motivo, que decide a multa de
 * uma remuneração inteira. Todas estão no e-mail que o gestor mandou. Antes
 * disso, alguém abria o Gmail numa aba, procurava o e-mail e digitava na tela
 * na outra; agora o Hub vai ler.
 *
 * CACHE EM NÍVEL DE MÓDULO. Cada busca é uma ida ao Gmail mais uma leitura de
 * IA, e a ficha do mesmo desligado se abre várias vezes numa conferência —
 * clicando de um nome para o outro e voltando. Guardar por colaborador na vida
 * da aba evita repetir a conta; `reler` força a ida de novo, para quando o
 * gestor corrige o e-mail depois de mandar.
 *
 * O QUE VOLTA É SUGESTÃO. Nada disto grava no RH nem fecha o cálculo sozinho:
 * preenche os campos da tela, que continuam editáveis, e diz de qual e-mail
 * veio — sem essa linha, quem confere não tem como auditar o número.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDaFuncao } from "@/lib/erroEdge";
import type { Classificacao } from "@/lib/rescisao";

export type EmailDeDesligamento = {
  id: string;
  assunto: string;
  data: string | null;
  remetente: string;
};

export type CamposDoEmail = {
  ultimoDia: string | null;
  remuneracao: number | null;
  variavel: number | null;
  diasDeFeriasTirados: number | null;
  motivo: string | null;
};

export type RespostaDoEmail = {
  achou: boolean;
  email?: EmailDeDesligamento;
  campos?: CamposDoEmail;
  classificacao?: Classificacao | null;
  avisos?: string[];
  /** Por que não achou — some ou é ambíguo. */
  motivo?: string;
  ambiguos?: EmailDeDesligamento[];
};

export type EstadoDoEmail = {
  carregando: boolean;
  resposta: RespostaDoEmail | null;
  erro: string | null;
};

/* A vida da aba basta: a caixa não muda no meio de uma conferência, e um
   refresh já é o botão de "esquece o que você leu". */
const cache = new Map<string, RespostaDoEmail>();

const chave = (id: string, emailId?: string) => (emailId ? `${id}:${emailId}` : id);

export function useEmailDesligamento(
  colaboradorId: string,
  nome: string,
  /** `false` deixa a busca só no botão — útil enquanto o Gmail não está ligado. */
  automatico = true,
) {
  const [estado, setEstado] = useState<EstadoDoEmail>({
    carregando: false,
    resposta: cache.get(chave(colaboradorId)) ?? null,
    erro: null,
  });

  const buscar = useCallback(
    async (opts: { emailId?: string; reler?: boolean } = {}) => {
      const k = chave(colaboradorId, opts.emailId);
      if (!opts.reler && cache.has(k)) {
        setEstado({ carregando: false, resposta: cache.get(k)!, erro: null });
        return;
      }
      setEstado((e) => ({ ...e, carregando: true, erro: null }));
      const { data, error } = await supabase.functions.invoke("rescisao-email", {
        body: { nome, emailId: opts.emailId },
      });
      if (error) {
        setEstado({ carregando: false, resposta: null, erro: await mensagemDaFuncao(error) });
        return;
      }
      const resposta = data as RespostaDoEmail;
      cache.set(k, resposta);
      // A escolha do homônimo passa a valer como a resposta do colaborador.
      if (opts.emailId) cache.set(chave(colaboradorId), resposta);
      setEstado({ carregando: false, resposta, erro: null });
    },
    [colaboradorId, nome],
  );

  useEffect(() => {
    if (!automatico || !nome) return;
    if (cache.has(chave(colaboradorId))) return;
    void buscar();
  }, [automatico, buscar, colaboradorId, nome]);

  return { ...estado, buscar };
}
