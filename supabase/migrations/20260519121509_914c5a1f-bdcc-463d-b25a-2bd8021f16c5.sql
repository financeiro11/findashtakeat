
CREATE TABLE IF NOT EXISTS public.viagens_eventos_excluidos (
  evento_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.viagens_eventos_excluidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read viagens_eventos_excluidos"
  ON public.viagens_eventos_excluidos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert viagens_eventos_excluidos"
  ON public.viagens_eventos_excluidos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth delete viagens_eventos_excluidos"
  ON public.viagens_eventos_excluidos FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.registrar_evento_viagem_excluido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h text;
BEGIN
  IF OLD.observacao IS NULL THEN RETURN OLD; END IF;
  h := substring(OLD.observacao from '\[evento:([a-f0-9]+)\]');
  IF h IS NOT NULL THEN
    INSERT INTO public.viagens_eventos_excluidos (evento_hash)
    VALUES (h)
    ON CONFLICT (evento_hash) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_evento_viagem_excluido ON public.tarefas;
CREATE TRIGGER trg_registrar_evento_viagem_excluido
  BEFORE DELETE ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_evento_viagem_excluido();
