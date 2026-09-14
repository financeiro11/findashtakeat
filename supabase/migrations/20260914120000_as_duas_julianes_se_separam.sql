-- As duas Julianes se separam.
--
-- A carga do Conta Azul (…20260909235500 e …20260909220000) casou "juliane
-- marketing" com a Juliane Nascimento do Nascimento, que é Dev RPA e entrou em
-- 09/03/2026 (Portal RH, COL-444952). São pessoas diferentes: a de Marketing
-- recebeu de mar/24 a jul/25 (R$ 1.000, com o acerto de R$ 688,17 no último mês),
-- sete meses de buraco, e a do RPA começa em mar/26 em "Pessoal - Automações".
-- Na tela a ficha do RPA mostrava dois anos de casa e um "reajuste" que era a
-- troca de uma pessoa pela outra.
--
-- Mesma régua das outras 105 que saíram antes de abril/2026: apelido + área entre
-- parênteses, sem código do RH. O que se move é só a categoria de Marketing do
-- Conta Azul — as linhas do Omie são da Juliane do RPA.

do $$
declare
  v_rpa  uuid := '7cfb8d55-a97f-45b4-b721-c6284878826f';
  v_mkt  uuid;
  v_n    int;
begin
  if not exists (select 1 from remuneracao_pessoa where id = v_rpa and codigo_rh = 'COL-444952') then
    raise exception 'Ficha da Juliane do RPA não encontrada como esperado';
  end if;

  select id into v_mkt from remuneracao_pessoa where chave = 'JULIANE MARKETING';
  if v_mkt is null then
    insert into remuneracao_pessoa (nome, chave, eh_pessoa, setor, observacao)
    values ('Juliane (Marketing)', 'JULIANE MARKETING', true, 'Marketing',
            'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto. '
            || 'Não é a Juliane Nascimento do RPA (entrou em mar/2026); separada em 14/09/2026.')
    returning id into v_mkt;
  end if;

  update remuneracao_lancamento
     set pessoa_id = v_mkt, atualizado_em = now()
   where pessoa_id = v_rpa
     and fonte = 'conta_azul'
     and categoria ilike '%Pessoal - Marketing%';
  get diagnostics v_n = row_count;

  -- Conferência: 18 linhas, R$ 17.139,78; e nada do Conta Azul sobra no RPA.
  if (select count(*) from remuneracao_lancamento where pessoa_id = v_mkt) <> 18
     or (select sum(valor) from remuneracao_lancamento where pessoa_id = v_mkt) <> 17139.78 then
    raise exception 'Juliane (Marketing): esperava 18 linhas e R$ 17.139,78 (movidas agora: %)', v_n;
  end if;
  if exists (select 1 from remuneracao_lancamento where pessoa_id = v_rpa and competencia < '2026-03-01') then
    raise exception 'A Juliane do RPA ainda tem lançamento antes de mar/2026';
  end if;
end $$;
