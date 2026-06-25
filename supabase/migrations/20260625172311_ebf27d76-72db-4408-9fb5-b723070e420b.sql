
ALTER TABLE public.parceiros_campanha_logs
  ADD COLUMN IF NOT EXISTS campo TEXT,
  ADD COLUMN IF NOT EXISTS valor_anterior TEXT,
  ADD COLUMN IF NOT EXISTS valor_novo TEXT;

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
  BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;

  IF NEW.nome_campanha IS DISTINCT FROM OLD.nome_campanha THEN
    INSERT INTO public.parceiros_campanha_logs (
      registro_tabela, registro_id, id_negocio, nome_negocio, indicador,
      campanha_anterior, campanha_nova, user_id, user_email,
      campo, valor_anterior, valor_novo
    ) VALUES (
      TG_TABLE_NAME, NEW.id, NEW.id_negocio, NEW.nome_negocio, NEW.indicador,
      OLD.nome_campanha, NEW.nome_campanha, v_uid, v_email,
      'nome_campanha', OLD.nome_campanha, NEW.nome_campanha
    );
  END IF;

  IF NEW.data_indicacao IS DISTINCT FROM OLD.data_indicacao THEN
    INSERT INTO public.parceiros_campanha_logs (
      registro_tabela, registro_id, id_negocio, nome_negocio, indicador,
      user_id, user_email,
      campo, valor_anterior, valor_novo
    ) VALUES (
      TG_TABLE_NAME, NEW.id, NEW.id_negocio, NEW.nome_negocio, NEW.indicador,
      v_uid, v_email,
      'data_indicacao',
      CASE WHEN OLD.data_indicacao IS NULL THEN NULL ELSE OLD.data_indicacao::text END,
      CASE WHEN NEW.data_indicacao IS NULL THEN NULL ELSE NEW.data_indicacao::text END
    );
  END IF;

  IF TG_TABLE_NAME = 'parceiros_indicacoes' AND NEW.data_venda IS DISTINCT FROM OLD.data_venda THEN
    INSERT INTO public.parceiros_campanha_logs (
      registro_tabela, registro_id, id_negocio, nome_negocio, indicador,
      user_id, user_email,
      campo, valor_anterior, valor_novo
    ) VALUES (
      TG_TABLE_NAME, NEW.id, NEW.id_negocio, NEW.nome_negocio, NEW.indicador,
      v_uid, v_email,
      'data_venda',
      CASE WHEN OLD.data_venda IS NULL THEN NULL ELSE OLD.data_venda::text END,
      CASE WHEN NEW.data_venda IS NULL THEN NULL ELSE NEW.data_venda::text END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_campanha_indicacoes ON public.parceiros_indicacoes;
DROP TRIGGER IF EXISTS trg_log_campanha_recorrencias ON public.parceiros_recorrencias;

CREATE TRIGGER trg_log_campanha_indicacoes
AFTER UPDATE ON public.parceiros_indicacoes
FOR EACH ROW EXECUTE FUNCTION public.log_parceiros_campanha_change();

CREATE TRIGGER trg_log_campanha_recorrencias
AFTER UPDATE ON public.parceiros_recorrencias
FOR EACH ROW EXECUTE FUNCTION public.log_parceiros_campanha_change();
