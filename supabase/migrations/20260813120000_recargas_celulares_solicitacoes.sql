-- Solicitações de recarga de celular vindas do TakeatOS.
--
-- Até aqui recarga se pedia por mensagem no WhatsApp: o Financeiro não tinha fila,
-- histórico por colaborador nem como saber quem já foi atendido. Agora o colaborador
-- clica em "Solicitar recarga" no TakeatOS e cai um card aqui.
--
-- recargas_celulares continua sendo o CADASTRO das linhas; esta tabela é a FILA de
-- pedidos. São coisas diferentes: uma linha existe o ano inteiro, um pedido nasce e
-- se conclui.

CREATE TABLE public.recargas_celulares_solicitacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Quem mandou. Hoje só o TakeatOS, mas nomear a origem evita ter de migrar a
  -- tabela quando entrar outro sistema.
  origem TEXT NOT NULL DEFAULT 'takeatos',
  -- Id da solicitação no sistema de origem. É a chave de idempotência: o TakeatOS
  -- reenvia o mesmo id quando a entrega falha, e o reenvio não pode virar 2º card.
  origem_id TEXT NOT NULL,

  -- Congelado no momento do pedido — a linha pode trocar de operadora depois, mas o
  -- card tem de mostrar o que foi pedido.
  colaborador TEXT NOT NULL,
  colaborador_email TEXT,
  -- Em geral é o próprio colaborador; difere quando o Financeiro pede por alguém.
  solicitante TEXT,
  numero TEXT,
  operadora TEXT,
  setor TEXT,
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,

  solicitado_em TIMESTAMPTZ NOT NULL,
  -- Só cabem ~40 recargas por dia. A posição vem calculada da origem e serve para o
  -- Financeiro atender por ordem de pedido.
  posicao_do_dia INTEGER,
  limite_diario INTEGER,

  status TEXT NOT NULL DEFAULT 'Pendente',
  concluido_em TIMESTAMPTZ,
  concluido_por UUID REFERENCES auth.users(id),

  -- Para onde avisar quando o pedido for concluído aqui (o TakeatOS manda a URL no
  -- payload, então não fica endereço chumbado no código).
  callback_url TEXT,
  callback_status TEXT,
  callback_erro TEXT,
  callback_em TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recargas_cel_solic_status_chk
    CHECK (status IN ('Pendente', 'Concluída', 'Cancelada'))
);

-- O par (origem, origem_id) é o que torna o reenvio inofensivo.
CREATE UNIQUE INDEX idx_rcs_origem
  ON public.recargas_celulares_solicitacoes (origem, origem_id);

-- A fila é sempre lida por status + ordem de chegada.
CREATE INDEX idx_rcs_status_solicitado
  ON public.recargas_celulares_solicitacoes (status, solicitado_em);

-- Histórico por colaborador — um dos motivos de existir desta tela.
CREATE INDEX idx_rcs_colaborador
  ON public.recargas_celulares_solicitacoes (colaborador, solicitado_em DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recargas_celulares_solicitacoes TO authenticated;
GRANT ALL ON public.recargas_celulares_solicitacoes TO service_role;

ALTER TABLE public.recargas_celulares_solicitacoes ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão das outras tabelas de recargas: o app inteiro é interno e já é gated
-- por login + cargo. Quem insere de fato é a Edge Function (service_role).
CREATE POLICY "Auth read rcs" ON public.recargas_celulares_solicitacoes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth update rcs" ON public.recargas_celulares_solicitacoes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete rcs" ON public.recargas_celulares_solicitacoes
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_rcs_updated_at
  BEFORE UPDATE ON public.recargas_celulares_solicitacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
