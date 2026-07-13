-- Bug: o "Atualizado em" das notas do Workspace vinha replicado entre várias notas.
-- Causa: o trigger genérico update_updated_at_column() bumpa updated_at em QUALQUER
-- UPDATE, e o reordenar (reorderSibling) reescreve `position` de TODOS os irmãos de
-- uma vez → todos ganham updated_at no mesmo segundo. Favoritar/arquivar/ocultar
-- também bumpavam sem serem edição de conteúdo.
--
-- Correção: trigger específico que só atualiza updated_at quando o CONTEÚDO muda
-- (title/content/icon/cover_url/tags). Reorder/favoritar/arquivar/ocultar preservam.
-- Também repara os clusters históricos (reorder) para o created_at de cada nota — hora
-- real e distinta —, feito enquanto o trigger está removido para os valores colarem.

CREATE OR REPLACE FUNCTION public.workspace_pages_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.title     IS DISTINCT FROM OLD.title
   OR NEW.content   IS DISTINCT FROM OLD.content
   OR NEW.icon      IS DISTINCT FROM OLD.icon
   OR NEW.cover_url IS DISTINCT FROM OLD.cover_url
   OR NEW.tags      IS DISTINCT FROM OLD.tags) THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workspace_pages_updated_at ON public.workspace_pages;

-- Reparo histórico: notas cujo updated_at caiu no mesmo SEGUNDO de outras (assinatura
-- de reorder) voltam ao seu created_at. Sem trigger ativo aqui, o valor cola.
WITH clusters AS (
  SELECT date_trunc('second', updated_at) AS sec
  FROM public.workspace_pages
  GROUP BY date_trunc('second', updated_at)
  HAVING count(*) > 1
)
UPDATE public.workspace_pages p
SET updated_at = created_at
FROM clusters c
WHERE date_trunc('second', p.updated_at) = c.sec
  AND p.created_at < p.updated_at;

CREATE TRIGGER workspace_pages_updated_at
  BEFORE UPDATE ON public.workspace_pages
  FOR EACH ROW EXECUTE FUNCTION public.workspace_pages_touch_updated_at();
