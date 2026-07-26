-- Herança entre anos: cada cargo tem uma LINHAGEM (`chave`) compartilhada entre as
-- cópias anuais. `desacoplado` = a cópia daquele ano foi personalizada e parou de
-- herdar do ano anterior. Mudanças em 2026 fluem para 2027/2028 nas cópias ainda
-- não desacopladas. Aqui também espelhamos a estrutura atual de 2026 → 2027 e 2028.

ALTER TABLE public.time_cargos ADD COLUMN IF NOT EXISTS chave uuid;
UPDATE public.time_cargos SET chave = gen_random_uuid() WHERE chave IS NULL;
ALTER TABLE public.time_cargos ALTER COLUMN chave SET DEFAULT gen_random_uuid();
ALTER TABLE public.time_cargos ALTER COLUMN chave SET NOT NULL;
ALTER TABLE public.time_cargos ADD COLUMN IF NOT EXISTS desacoplado boolean NOT NULL DEFAULT false;

-- Espelha 2026 → 2027 e 2028 (mesma chave, novos ids, hierarquia remapeada) se ainda não existirem.
WITH gen AS (
  SELECT c.*, y.ano AS tano, gen_random_uuid() AS nid
  FROM public.time_cargos c
  CROSS JOIN (VALUES (2027), (2028)) AS y(ano)
  WHERE c.ano = 2026
    AND NOT EXISTS (SELECT 1 FROM public.time_cargos d WHERE d.chave = c.chave AND d.ano = y.ano)
)
INSERT INTO public.time_cargos
  (id, titulo, pessoa, senioridade, status, acumulo, prioridade, custo_mensal, alvo, parent_id, atribuicoes, ordem, ano, chave, desacoplado)
SELECT g.nid, g.titulo, g.pessoa, g.senioridade, g.status, g.acumulo, g.prioridade, g.custo_mensal, g.alvo,
  (SELECT g2.nid FROM gen g2
     WHERE g2.tano = g.tano
       AND g2.chave = (SELECT p.chave FROM public.time_cargos p WHERE p.id = g.parent_id)),
  g.atribuicoes, g.ordem, g.tano, g.chave, false
FROM gen g;
