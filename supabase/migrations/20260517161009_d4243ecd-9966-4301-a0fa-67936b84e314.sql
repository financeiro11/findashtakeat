
-- 1) Decodifica HTML entities mais comuns nos títulos da FAPES
UPDATE public.editais SET titulo = regexp_replace(
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    titulo,
    '&#234;','ê'),'&#231;','ç'),'&#227;','ã'),'&#233;','é'),'&#225;','á'),'&#237;','í'),'&#243;','ó'),'&#250;','ú'),'&#241;','ñ'),'&#224;','à'),'&#226;','â'),'&#244;','ô'),'&#245;','õ'),'&#186;','º'),'&#170;','ª'),
  '&amp;','&','g')
WHERE fonte='FAPES' AND titulo ~ '&#';

-- 2) Remove duplicatas FAPES: mantém o registro com link mais específico (não /noticias)
WITH ranked AS (
  SELECT id, hash_dedupe,
    ROW_NUMBER() OVER (
      PARTITION BY hash_dedupe
      ORDER BY CASE WHEN link ~* '/noticias/?$' THEN 1 ELSE 0 END, created_at DESC
    ) AS rn
  FROM public.editais
  WHERE fonte='FAPES' AND hash_dedupe IS NOT NULL
)
DELETE FROM public.editais WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3) Para registros FAPES que ficaram com link genérico /noticias, marca como ocultos
UPDATE public.editais
SET visibility_status='oculto', exclusion_reason='Link genérico (página de listagem)'
WHERE fonte='FAPES' AND link ~* '/noticias/?$';
