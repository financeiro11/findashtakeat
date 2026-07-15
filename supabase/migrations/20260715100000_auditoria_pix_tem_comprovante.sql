-- Bug: auditoria PIX marcava vários títulos que TÊM NF/anexo no Omie como "sem
-- comprovante". Causa: o omie-pix-sync gravava tem_comprovante = !!anexo.url, mas o
-- geral/anexo/ListarAnexo do Omie devolve o anexo (nome/id) SEM link de download
-- (o link exige ObterAnexo). Logo, título com anexo mas sem URL → tem_comprovante=false.
--
-- Correção robusta (independe de redeploy e sobrevive a re-syncs): um trigger que força
-- tem_comprovante = true sempre que houver anexo_nome ou comprovante_url. Quando o anexo
-- é de fato removido, o sync zera anexo_nome/url e o trigger NÃO força (fica false).

CREATE OR REPLACE FUNCTION public.auditoria_pix_fix_tem_comprovante()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.anexo_nome IS NOT NULL OR NEW.comprovante_url IS NOT NULL THEN
    NEW.tem_comprovante := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS auditoria_pix_tem_comprovante ON public.auditoria_pix_lancamentos;
CREATE TRIGGER auditoria_pix_tem_comprovante
  BEFORE INSERT OR UPDATE ON public.auditoria_pix_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_pix_fix_tem_comprovante();

-- Backfill das linhas já gravadas.
UPDATE public.auditoria_pix_lancamentos
SET tem_comprovante = true, updated_at = now()
WHERE NOT tem_comprovante AND (anexo_nome IS NOT NULL OR comprovante_url IS NOT NULL);
