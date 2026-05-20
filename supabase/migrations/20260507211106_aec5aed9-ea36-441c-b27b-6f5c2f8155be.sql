
CREATE TABLE public.editais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  orgao text,
  modalidade text,
  numero text,
  objeto text,
  valor_estimado numeric DEFAULT 0,
  data_publicacao date,
  data_abertura date,
  prazo_envio date,
  status text NOT NULL DEFAULT 'Em análise',
  responsavel text,
  link text,
  pdf_path text,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.editais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all editais" ON public.editais
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER editais_updated_at
  BEFORE UPDATE ON public.editais
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public) VALUES ('editais-pdf', 'editais-pdf', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "auth read editais pdf" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'editais-pdf');
CREATE POLICY "auth insert editais pdf" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'editais-pdf');
CREATE POLICY "auth update editais pdf" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'editais-pdf');
CREATE POLICY "auth delete editais pdf" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'editais-pdf');
