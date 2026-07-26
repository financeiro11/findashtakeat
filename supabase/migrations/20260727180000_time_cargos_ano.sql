-- Organograma por ano: cada cargo pertence a um ano-snapshot (2026/2027/2028).
-- Trocar de ano na tela mostra uma estrutura independente (cargos, atribuições,
-- hierarquia). Cargos existentes ficam em 2026 (default).

ALTER TABLE public.time_cargos ADD COLUMN IF NOT EXISTS ano int NOT NULL DEFAULT 2026;
CREATE INDEX IF NOT EXISTS time_cargos_ano_idx ON public.time_cargos (ano);
