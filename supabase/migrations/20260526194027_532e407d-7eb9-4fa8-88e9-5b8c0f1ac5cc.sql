CREATE TABLE public.parceiros_recorrencias (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  id_negocio text,
  id_campanha text,
  nome_campanha text,
  indicador text,
  email_indicador text,
  responsavel_takeat text,
  nome_negocio text,
  mrr numeric,
  recorrencia_valor numeric,
  data_indicacao date,
  data_venda date,
  ativo boolean NOT NULL DEFAULT true,
  hubspot_url text,
  asaas_url text,
  observacoes text,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parceiros_recorrencias TO authenticated;
GRANT ALL ON public.parceiros_recorrencias TO service_role;

ALTER TABLE public.parceiros_recorrencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read parceiros_recorrencias" ON public.parceiros_recorrencias FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert parceiros_recorrencias" ON public.parceiros_recorrencias FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update parceiros_recorrencias" ON public.parceiros_recorrencias FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete parceiros_recorrencias" ON public.parceiros_recorrencias FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_parceiros_recorrencias_updated_at
BEFORE UPDATE ON public.parceiros_recorrencias
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();