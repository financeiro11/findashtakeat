-- "Cadeado" de mês fechado para DRE/DFC: uma vez importado o tracker (planilha fechada)
-- para um mês, aquele mês fica protegido — o omie-sync NUNCA mais sobrescreve os valores
-- daquela coluna, mesmo rodando de novo. Só um NOVO import (que é a fonte de verdade
-- manual) pode atualizar/re-travar um mês já travado. Compartilhado entre DRE e DFC
-- (mesma trava vale para as duas demonstrações, já que vêm da mesma planilha/mês).

CREATE TABLE IF NOT EXISTS public.demonstracoes_mes_trancado (
  col_key text PRIMARY KEY,             -- formato "Mon-YY" (ex.: "Apr-26"), igual ao DFC.tsx/DRE.tsx
  trancado_em timestamptz NOT NULL DEFAULT now(),
  origem text                            -- nome do arquivo importado, quando disponível
);

GRANT SELECT ON public.demonstracoes_mes_trancado TO authenticated;
GRANT ALL    ON public.demonstracoes_mes_trancado TO service_role;
ALTER TABLE public.demonstracoes_mes_trancado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_mes_trancado" ON public.demonstracoes_mes_trancado;
CREATE POLICY "auth_read_mes_trancado" ON public.demonstracoes_mes_trancado FOR SELECT TO authenticated USING (true);
-- Sem policy de escrita para authenticated: só a Edge Function (service_role) tranca um mês,
-- via o import do Excel. Evita que a trava seja burlada direto pelo cliente.
