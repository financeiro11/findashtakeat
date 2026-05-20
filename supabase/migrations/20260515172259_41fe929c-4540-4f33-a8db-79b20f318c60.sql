ALTER TABLE public.recargas_celulares DROP COLUMN IF EXISTS rpa;
UPDATE public.recargas_celulares SET setor = 'RPA' WHERE setor = 'Automações';