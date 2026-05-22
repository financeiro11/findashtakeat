CREATE TABLE IF NOT EXISTS public.recargas_viagens_status (
  viagem_hash text PRIMARY KEY,
  status text NOT NULL DEFAULT 'Pendente',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recargas_viagens_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read rvs" ON public.recargas_viagens_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert rvs" ON public.recargas_viagens_status FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update rvs" ON public.recargas_viagens_status FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete rvs" ON public.recargas_viagens_status FOR DELETE TO authenticated USING (true);
CREATE TRIGGER trg_rvs_updated_at BEFORE UPDATE ON public.recargas_viagens_status
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();