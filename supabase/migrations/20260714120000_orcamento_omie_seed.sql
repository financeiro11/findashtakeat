-- Semeia o de-para categoria Omie -> linha do orçamento (área/subcategoria).
-- Regra: rubrica DRE (do omie_dre_mapa) -> linha do orçamento; depois um override
-- para premiações operacionais que caem sob a rubrica genérica "Premiações".
-- Categorias sem correspondência (receitas, impostos, financeiras, CAPEX, CMV,
-- meios de pagamento, encargos) ficam com area/subcategoria NULL = fora do orçamento.
-- 'auto' marca as linhas semeadas; ajustes do time devem usar origem='manual'.

INSERT INTO public.orcamento_omie_map (descricao_categoria, rubrica, area, subcategoria, origem)
SELECT d.descricao_categoria, d.rubrica, r.area, r.subcategoria, 'auto'
FROM (
  SELECT DISTINCT ON (descricao_categoria) descricao_categoria, rubrica
  FROM public.omie_dre_mapa
  WHERE ativo IS NOT FALSE
  ORDER BY descricao_categoria, (demonstrativo = 'dre') DESC
) d
LEFT JOIN (VALUES
  ('Comissões Consultores / Parceiros','Comercial','Comissões'),
  ('Equipe Comercial','Comercial','Equipe Comercial'),
  ('Assessorias & Consultorias','Corporativo/Adm','Assessorias & Consultorias'),
  ('Benefícios','Corporativo/Adm','Benefícios'),
  ('Equipe Administrativa','Corporativo/Adm','Equipe Administrativa'),
  ('Ocupação & Escritório','Corporativo/Adm','Ocupação & Escritório'),
  ('Outras despesas Adm','Corporativo/Adm','Outras despesas'),
  ('Outras Despesas Adm','Corporativo/Adm','Outras despesas'),
  ('Outros Custos','Corporativo/Adm','Outros Custos'),
  ('Softwares Administrativos','Corporativo/Adm','Softwares Administrativos'),
  ('Viagens & Transportes Adm','Corporativo/Adm','Viagens & Transportes Adm'),
  ('Agências & Consultorias','Marketing','Agências & Consultorias'),
  ('Equipe Marketing','Marketing','Equipe Marketing'),
  ('MGM','Marketing','MGM'),
  ('Campanhas de Mídia Paga','Marketing','Mídia paga / Inbound'),
  ('Campanhas de Outros Canais','Marketing','Outros canais'),
  ('Outras despesas Mkt','Marketing','Outras M&V'),
  ('Outras Despesas Mkt','Marketing','Outras M&V'),
  ('Premiações','Marketing','Premiações'),
  ('Softwares Marketing & Vendas','Marketing','Softwares / Sistemas M&V'),
  ('Viagens & Transportes Mkt','Marketing','Viagens Mkt'),
  ('Eventos e Feiras','Novos Canais','Eventos e Feiras'),
  ('Equipe Onboarding','Operações','Equipe Onboarding'),
  ('Equipe Operacional','Operações','Equipe Operacional'),
  ('Premiações Operacionais','Operações','Premiação Operacional'),
  ('Equipe Tecnologia','Tecnologia','Equipe Tecnologia'),
  ('Servidor','Tecnologia','Infraestrutura / Servidor'),
  ('Softwares Operacionais','Tecnologia','Softwares Operacionais')
) AS r(rubrica, area, subcategoria) ON r.rubrica = d.rubrica
ON CONFLICT (descricao_categoria) DO NOTHING;

UPDATE public.orcamento_omie_map
SET area='Operações', subcategoria='Premiação Operacional'
WHERE rubrica='Premiações'
  AND (descricao_categoria ILIKE '%opera%' OR descricao_categoria ILIKE '%onboarding%'
       OR descricao_categoria ILIKE '%suporte%' OR descricao_categoria ILIKE '%sucesso%');
