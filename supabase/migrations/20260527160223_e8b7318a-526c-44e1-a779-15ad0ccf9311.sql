
CREATE TABLE public.parceiros_campanha_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registro_tabela TEXT NOT NULL,
  registro_id UUID NOT NULL,
  id_negocio TEXT,
  nome_negocio TEXT,
  indicador TEXT,
  campanha_anterior TEXT,
  campanha_nova TEXT,
  user_id UUID,
  user_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcl_registro ON public.parceiros_campanha_logs (registro_tabela, registro_id, created_at DESC);

-- Apenas leitura para usuários autenticados. Inserts vêm da trigger (SECURITY DEFINER, role postgres).
GRANT SELECT ON public.parceiros_campanha_logs TO authenticated;
GRANT ALL  ON public.parceiros_campanha_logs TO service_role;

ALTER TABLE public.parceiros_campanha_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read pcl"
ON public.parceiros_campanha_logs
FOR SELECT TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.log_parceiros_campanha_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_uid   UUID := auth.uid();
BEGIN
  IF NEW.nome_campanha IS DISTINCT FROM OLD.nome_campanha THEN
    BEGIN
      SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN
      v_email := NULL;
    END;

    INSERT INTO public.parceiros_campanha_logs (
      registro_tabela, registro_id, id_negocio, nome_negocio, indicador,
      campanha_anterior, campanha_nova, user_id, user_email
    ) VALUES (
      TG_TABLE_NAME, NEW.id, NEW.id_negocio, NEW.nome_negocio, NEW.indicador,
      OLD.nome_campanha, NEW.nome_campanha, v_uid, v_email
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_campanha_indicacoes
AFTER UPDATE OF nome_campanha ON public.parceiros_indicacoes
FOR EACH ROW EXECUTE FUNCTION public.log_parceiros_campanha_change();

CREATE TRIGGER trg_log_campanha_recorrencias
AFTER UPDATE OF nome_campanha ON public.parceiros_recorrencias
FOR EACH ROW EXECUTE FUNCTION public.log_parceiros_campanha_change();
