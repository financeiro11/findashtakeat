-- Horário configurável da sincronização automática diária (por ora, só Orçamento).
-- Mudar o horário só entra em vigor a partir do DIA SEGUINTE (BRT) — nunca no mesmo
-- dia — para não haver ambiguidade sobre se o sync de hoje já rodou no horário
-- antigo ou no novo. O usuário grava um "hora_pendente" com "vigente_a_partir" =
-- amanhã; um cron diário de promoção aplica o horário pendente assim que a data
-- de vigência chega (00:10 BRT, bem antes de qualquer horário de sync configurável).

CREATE TABLE IF NOT EXISTS public.sync_agendamento (
  job_name         text PRIMARY KEY,        -- nome do job em cron.job (ex.: 'omie-orcamento-sync-diario')
  hora_atual       smallint NOT NULL CHECK (hora_atual BETWEEN 0 AND 23),   -- hora BRT em vigor
  hora_pendente    smallint CHECK (hora_pendente BETWEEN 0 AND 23),         -- hora BRT solicitada (ainda não vigente)
  vigente_a_partir date,                    -- data (BRT) em que hora_pendente passa a valer
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sync_agendamento (job_name, hora_atual) VALUES ('omie-orcamento-sync-diario', 8)
  ON CONFLICT (job_name) DO NOTHING;

GRANT SELECT ON public.sync_agendamento TO authenticated;
GRANT ALL    ON public.sync_agendamento TO service_role;
ALTER TABLE public.sync_agendamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_sync_agendamento" ON public.sync_agendamento;
CREATE POLICY "auth_read_sync_agendamento" ON public.sync_agendamento FOR SELECT TO authenticated USING (true);
-- Sem policy de escrita: só a Edge Function (service_role) grava hora_pendente/vigente_a_partir,
-- e só a função de promoção abaixo (SECURITY DEFINER) grava hora_atual.

-- Promove os agendamentos cuja data de vigência já chegou: aplica a nova hora no
-- cron.job correspondente (BRT -> UTC; sa-east-1 é UTC-3 fixo, sem horário de verão)
-- e limpa o pendente. SECURITY DEFINER porque cron.job só é alterável pelo dono do
-- job (o mesmo papel que rodou as migrations); chamada só pelo pg_cron abaixo.
CREATE OR REPLACE FUNCTION public.promover_agendamentos_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  r record;
  hora_utc int;
  v_jobid bigint;
BEGIN
  FOR r IN
    SELECT * FROM public.sync_agendamento
     WHERE hora_pendente IS NOT NULL
       AND vigente_a_partir <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
  LOOP
    hora_utc := (r.hora_pendente + 3) % 24;
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = r.job_name;
    IF v_jobid IS NOT NULL THEN
      PERFORM cron.alter_job(job_id := v_jobid, schedule := format('0 %s * * *', hora_utc));
    END IF;

    UPDATE public.sync_agendamento
       SET hora_atual = r.hora_pendente, hora_pendente = NULL, vigente_a_partir = NULL, atualizado_em = now()
     WHERE job_name = r.job_name;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.promover_agendamentos_sync() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promover_agendamentos_sync() TO service_role;

SELECT cron.unschedule('promover-agendamentos-sync') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'promover-agendamentos-sync'
);
SELECT cron.schedule(
  'promover-agendamentos-sync',
  '10 3 * * *',
  $$ SELECT public.promover_agendamentos_sync(); $$
);
