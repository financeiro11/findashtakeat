-- Fatia 2: o que sobrou de Demonstrações, EBITDA e Apresentações.
--
-- A outra frente já embrulhou `demonstracoes_lancamentos`, `_busca`, `_multi` e
-- `demonstracoes_contrapartes` (migration …250000, "a folha para de vazar pela
-- DRE e pelo CAC"). Aqui vão as que ficaram: as que devolvem categoria, alerta de
-- reclassificação e os candidatos do EBITDA ajustado — todas com valor e
-- contraparte — mais as de Apresentações, que carregam o texto que vai ao
-- conselho.
--
-- Tudo em modo `aviso` (é o modo de `demonstracoes` e `apresentacoes`): nada muda
-- de comportamento hoje, só passa a registrar quem não deveria estar ali.
--
-- `apresentacao_salvar` TEM OVERLOAD — duas versões vivas, de 5 e 6 argumentos
-- (ver a nota de `migrations-nao-batem-com-o-banco`). `blindar_rpc` se recusa a
-- escolher por conta própria, e o relatório vai dizer isso. Fica para quando
-- alguém aposentar a de 5.

create temp table if not exists blindagem(resultado text);

do $$
declare
  v_nome text;
begin
  -- Demonstrações e EBITDA: rubrica, categoria, contraparte e valor.
  foreach v_nome in array array[
    'demonstracoes_categorias',
    'demonstracoes_reclassificacoes',
    'demonstracoes_reclassificacoes_celula',
    'demonstracoes_sem_de_para',
    'ebitda_ajuste_candidatos',
    'ebitda_ajuste_grupos'
  ] loop
    insert into blindagem values (public.blindar_rpc(v_nome, 'demonstracoes'));
  end loop;

  -- Apresentações: o material de conselho e investidores, e a decisão sobre cada
  -- justificativa da Revisão do Mês.
  foreach v_nome in array array[
    'revisao_decidir',
    'revisao_justificativas',
    'apresentacao_duplicar',
    'apresentacao_excluir',
    'apresentacao_publicar',
    'apresentacao_salvar'
  ] loop
    insert into blindagem values (public.blindar_rpc(v_nome, 'apresentacoes'));
  end loop;
end $$;

select resultado from blindagem order by resultado;
