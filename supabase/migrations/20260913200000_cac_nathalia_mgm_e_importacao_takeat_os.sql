-- ===========================================================================
-- PAINEL CAC: NATHALIA MARQUES É MGM, E O QUE O OMIE NÃO TEM VEM DO TAKEAT OS.
--
-- Da análise de 13/09/2026 contra Custos_2026 exportado do Takeat OS no mesmo
-- dia. Duas mudanças, aprovadas pelo usuário:
--
-- 1. A LINHA "Equipes › MGM" DA PLANILHA É A NATHALIA MARQUES. Abril 3.640
--    (2.800,01 + 840), maio 2.800 e junho 5.336,67 batem ao centavo com os
--    títulos dela. Ela não está na planilha Dados Pessoal, então caía no fallback
--    de "Pessoal - Sucesso" e inflava Sucesso. Entra inativa: não é do time hoje,
--    e não deve aparecer na lista "sem pagamento".
--
-- 2. VALORES DIGITADOS, que vencem o cálculo da célula:
--    • jan–mar/26 de TODAS as linhas — o cache do Omie não alcança esses meses
--      (jan e fev davam zero, mar vinha pela metade);
--    • as três linhas que a skill manda digitar (Agência de Marketing,
--      Contadores, Comissão de MGM), em todos os meses preenchidos.
--    Fica de fora de propósito "Consultores" de jun/26 (49.560,00): é linha
--    calculada, e o valor tem cara de 4.956 com um zero a mais.
-- ===========================================================================

insert into public.cac_pessoas (cnpj, nome, departamento, observacao, ativo)
values ('64939027000127', 'Nathalia Marques Martins', 'MGM',
        'MGM, como na planilha do Takeat OS: abr, mai e jun/26 batem ao centavo com os títulos dela. Fora da planilha Dados Pessoal.',
        false)
on conflict (cnpj) do update
  set departamento = excluded.departamento, observacao = excluded.observacao, atualizado_em = now();

update public.cac_linhas
   set regra_nota = 'A Nathalia Marques, como na planilha do Takeat OS — abr, mai e jun/26 batem ao centavo com os títulos dela.',
       atualizado_em = now()
 where grupo = 'Equipes' and rotulo = 'MGM';

-- Sem a Nathalia, Sucesso de jun/26 dá 21.360,00 contra 23.960,00 da planilha.
-- Os R$ 2.600,00 são o Vitor Coelho: pago em "Pessoal - Sucesso", mas a planilha
-- Dados Pessoal o põe em Suporte. Fica CONFERIR até alguém decidir o time dele.
update public.cac_linhas
   set regra_nota = 'CONFERIR: jul/26 bate com o Takeat OS (38.140); abr, mai e jun ficam abaixo (jun 21.360,00 × 23.960,00). Em jun a diferença é o Vitor Coelho (R$ 2.600, pago em Pessoal - Sucesso), que o cadastro põe em Suporte.',
       atualizado_em = now()
 where grupo = 'Equipes' and rotulo = 'Sucesso';

with v(grupo, rotulo, mes, valor) as (values
  -- jan–mar/26, todas as linhas
  ('Equipes','Branding e Conteúdo',1,28445.96),('Equipes','Branding e Conteúdo',2,30913.06),('Equipes','Branding e Conteúdo',3,25579.67),
  ('Equipes','Performance',1,15788.39),('Equipes','Performance',2,18080.00),('Equipes','Performance',3,18462.67),
  ('Equipes','Comunidade',1,0),('Equipes','Comunidade',2,2414.29),('Equipes','Comunidade',3,3250.00),
  ('Equipes','Franquia',1,19370.00),('Equipes','Franquia',2,11820.00),('Equipes','Franquia',3,11005.00),
  ('Equipes','Canais Indiretos',1,3240.00),('Equipes','Canais Indiretos',2,3240.00),('Equipes','Canais Indiretos',3,17756.13),
  ('Equipes','Eventos',1,7800.00),('Equipes','Eventos',2,7800.00),('Equipes','Eventos',3,9742.96),
  ('Equipes','MGM',1,0),('Equipes','MGM',2,2571.43),('Equipes','MGM',3,2800.00),
  ('Equipes','Inside Sales',1,43993.94),('Equipes','Inside Sales',2,66565.94),('Equipes','Inside Sales',3,74405.38),
  ('Equipes','Field Sales',1,47301.60),('Equipes','Field Sales',2,46674.29),('Equipes','Field Sales',3,64292.07),
  ('Equipes','Onboarding e Setup',1,45911.29),('Equipes','Onboarding e Setup',2,56515.71),('Equipes','Onboarding e Setup',3,59366.00),
  ('Equipes','Sucesso',1,26600.00),('Equipes','Sucesso',2,34847.14),('Equipes','Sucesso',3,42080.00),
  ('Equipes','Suporte',1,35904.26),('Equipes','Suporte',2,40118.00),('Equipes','Suporte',3,48583.00),
  ('Equipes','Liderança OPS',1,12000.00),('Equipes','Liderança OPS',2,17357.14),('Equipes','Liderança OPS',3,27000.00),
  ('Investimentos','Eventos',1,57910.43),('Investimentos','Eventos',2,111742.35),('Investimentos','Eventos',3,164645.73),
  ('Investimentos','Influenciadores',1,5000.00),('Investimentos','Influenciadores',2,5000.00),('Investimentos','Influenciadores',3,5000.00),
  ('Comissões','Consultores',1,12192.35),('Comissões','Consultores',2,14281.08),('Comissões','Consultores',3,10310.76),
  -- as três linhas digitadas, todos os meses preenchidos
  ('Comissões','Agência de Marketing',1,604.70),('Comissões','Agência de Marketing',2,1566.90),('Comissões','Agência de Marketing',3,5675.10),
  ('Comissões','Agência de Marketing',4,1048.00),('Comissões','Agência de Marketing',5,700.00),('Comissões','Agência de Marketing',6,495.60),
  ('Comissões','Agência de Marketing',7,4000.00),
  ('Comissões','Contadores',1,0),('Comissões','Contadores',2,270.00),('Comissões','Contadores',3,0),
  ('Comissões','Contadores',4,1893.00),('Comissões','Contadores',5,700.00),('Comissões','Contadores',6,1982.40),
  ('Comissões','Contadores',7,3500.00),
  ('Comissões','Comissão de MGM',1,1400.00),('Comissões','Comissão de MGM',2,1200.00),('Comissões','Comissão de MGM',3,800.00),
  ('Comissões','Comissão de MGM',4,3600.00),('Comissões','Comissão de MGM',5,2800.00),('Comissões','Comissão de MGM',6,4000.00),
  ('Comissões','Comissão de MGM',7,5400.00),('Comissões','Comissão de MGM',8,5400.00)
)
insert into public.cac_valores_manuais (ano, mes, linha_id, valor, nota, autor_nome, atualizado_em)
select 2026, v.mes, l.id, v.valor,
       'Importado do Takeat OS (Custos_2026 exportado em 13/09/2026).',
       'importação Takeat OS', now()
  from v
  join public.cac_linhas l on l.grupo = v.grupo and l.rotulo = v.rotulo
on conflict (ano, mes, linha_id) do update
  set valor = excluded.valor, nota = excluded.nota, autor_nome = excluded.autor_nome, atualizado_em = now();

-- ─────────────────────── Conferência ───────────────────────

do $$
declare
  v_n   integer;
  v_mgm numeric[];
  v_chk record;
begin
  select count(*) into v_n
    from public.cac_valores_manuais
   where ano = 2026 and nota like 'Importado do Takeat OS (Custos_2026%';
  if v_n <> 70 then
    raise exception 'esperava 70 células importadas do Takeat OS, vieram % (algum rótulo não casou)', v_n;
  end if;

  -- MGM de abr a jun é a Nathalia, calculada — não digitada.
  select array_agg(valor order by mes) into v_mgm
    from public.cac_painel(2026)
   where grupo = 'Equipes' and rotulo = 'MGM' and mes between 4 and 6;
  if abs(v_mgm[1] - 3640.01) > 0.01 or abs(v_mgm[2] - 2800) > 0.01 or abs(v_mgm[3] - 5336.67) > 0.01 then
    raise exception 'MGM abr–jun não bateu com a planilha: %', v_mgm;
  end if;

  -- A matriz devolve o digitado onde ele existe.
  for v_chk in
    select rotulo, grupo, mes, valor, origem from public.cac_painel(2026)
     where (grupo, rotulo, mes) in (('Investimentos','Eventos',1), ('Comissões','Comissão de MGM',8), ('Equipes','Inside Sales',3))
  loop
    if v_chk.origem <> 'manual' then
      raise exception '% › % mês % não saiu como manual', v_chk.grupo, v_chk.rotulo, v_chk.mes;
    end if;
  end loop;
end $$;
