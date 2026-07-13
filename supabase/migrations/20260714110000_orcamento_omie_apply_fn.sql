-- Aplica o realizado do Omie no orçamento em lote (chamada pela Edge Function
-- omie-orcamento-sync com service_role). Zera o realizado_omie do ano e re-grava
-- só as linhas do payload (linhas mapeadas; meses sem gasto entram 0). Assim,
-- linhas que deixaram de ser mapeadas revertem automaticamente ao tracker.
CREATE OR REPLACE FUNCTION public.apply_orcamento_realizado_omie(p_ano int, p_dados jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE public.orcamento_area_linha
     SET realizado_omie = NULL, omie_sincronizado_em = NULL
   WHERE ano = p_ano AND realizado_omie IS NOT NULL;

  UPDATE public.orcamento_area_linha t
     SET realizado_omie = x.valor,
         omie_sincronizado_em = now()
    FROM jsonb_to_recordset(p_dados) AS x(area text, subcategoria text, mes int, valor numeric)
   WHERE t.ano = p_ano AND t.area = x.area AND t.subcategoria = x.subcategoria AND t.mes = x.mes;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.apply_orcamento_realizado_omie(int, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_orcamento_realizado_omie(int, jsonb) TO service_role;
