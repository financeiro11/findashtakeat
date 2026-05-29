
DO $$
DECLARE
  v_projeto_id uuid;
BEGIN
  INSERT INTO public.projetos_aprovados (nome, orgao, valor_aprovado, valor_contrapartida, status, ordem)
  VALUES ('Breta', 'FUNDAÇÃO / SUBVENÇÃO', 37500.00, 0, 'Em execução', 2)
  RETURNING id INTO v_projeto_id;

  INSERT INTO public.projetos_aprovados_rubricas (projeto_id, categoria, valor_planejado, ordem) VALUES
    (v_projeto_id, 'Material de Consumo', 8452.50, 1),
    (v_projeto_id, 'Outros Serviços de Terceiros', 1600.00, 2),
    (v_projeto_id, 'Diárias', 14647.50, 3),
    (v_projeto_id, 'Equipamentos e Material Permanente', 10400.00, 4),
    (v_projeto_id, 'Passagens', 2400.00, 5);

  INSERT INTO public.projetos_aprovados_parcelas (projeto_id, numero, descricao, valor, recebido, data_recebimento)
  VALUES (v_projeto_id, 1, '1ª Parcela do edital (FUNDAÇÃO / SUBVENÇÃO)', 37500.00, true, CURRENT_DATE);
END $$;
