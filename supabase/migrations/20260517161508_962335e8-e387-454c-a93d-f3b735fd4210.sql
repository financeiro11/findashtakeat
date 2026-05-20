
UPDATE public.editais
SET valor_estimado = (
  WITH m AS (
    SELECT regexp_matches(coalesce(titulo,'') || ' ' || coalesce(objeto,''),
      'R\$\s*([\d.,]+)\s*(bilh[õo]es?|bi|milh[õo]es?|mi|mil)?', 'i') AS parts
  )
  SELECT CASE
    WHEN parts[2] ~* 'bilh|^bi$' THEN replace(replace(parts[1], '.', ''), ',', '.')::numeric * 1000000000
    WHEN parts[2] ~* 'milh|^mi$' THEN replace(replace(parts[1], '.', ''), ',', '.')::numeric * 1000000
    WHEN parts[2] ~* '^mil$'    THEN replace(replace(parts[1], '.', ''), ',', '.')::numeric * 1000
    ELSE replace(replace(parts[1], '.', ''), ',', '.')::numeric
  END FROM m
)
WHERE coalesce(valor_estimado,0) = 0
  AND (coalesce(titulo,'') || ' ' || coalesce(objeto,'')) ~* 'R\$\s*[\d.,]+';
