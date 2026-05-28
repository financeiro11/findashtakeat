CREATE TABLE public.editais_blacklist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url text,
  titulo_norm text,
  hash_dedupe text,
  external_id text,
  motivo text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_editais_blacklist_url ON public.editais_blacklist (url);
CREATE INDEX idx_editais_blacklist_titulo_norm ON public.editais_blacklist (titulo_norm);
CREATE INDEX idx_editais_blacklist_hash ON public.editais_blacklist (hash_dedupe);
CREATE INDEX idx_editais_blacklist_external_id ON public.editais_blacklist (external_id);

GRANT SELECT, INSERT, DELETE ON public.editais_blacklist TO authenticated;
GRANT ALL ON public.editais_blacklist TO service_role;

ALTER TABLE public.editais_blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all editais_blacklist"
ON public.editais_blacklist
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

ALTER TABLE public.editais
  ADD COLUMN IF NOT EXISTS confidence_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'aberto';