-- Briefing Diário (aba Início do Hub) — alinha os grants da tabela ao mesmo
-- padrão de defesa-em-profundidade das demais tabelas do Hub (ex.: omie_caixa_*):
-- só o service_role escreve; authenticated apenas lê; anon não acessa nada.
--
-- A tabela public.briefing_diario já existia (criada fora do versionamento) com
-- RLS habilitada e a policy de leitura `auth_read`. Faltava remover os GRANTs
-- amplos herdados de anon/authenticated (INSERT/UPDATE/DELETE) — a RLS já bloqueia
-- por falta de policy de escrita, mas retiramos o privilégio para não depender só dela.
-- A skill de briefing (scheduled task) escreve via service_role por delete+insert.

REVOKE ALL ON public.briefing_diario FROM anon, authenticated;
GRANT  SELECT ON public.briefing_diario TO authenticated;
GRANT  ALL    ON public.briefing_diario TO service_role;

ALTER TABLE public.briefing_diario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read" ON public.briefing_diario;
CREATE POLICY "auth_read"
  ON public.briefing_diario FOR SELECT TO authenticated USING (true);
