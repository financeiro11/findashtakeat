-- ===========================================================================
-- PAINEL CAC: AJUSTES QUE SÓ APARECERAM CONFERINDO CONTRA O OFICIAL.
--
-- Depois de `20260913150000` (regras da skill custos-cac-mensal), a matriz foi
-- comparada linha a linha com CAC_Jun26.xlsx — a tabela oficial, preenchida com
-- a skill — em abr, mai e jun/26. Dois ajustes de dado saíram daí.
--
-- 1. FRANQUIA É SÓ O DEPARTAMENTO "Franquia".
--    A linha apontava para "Franquia" e "Franquias" desde o seed. O código da
--    skill só reconhece "Franquia"; quem a planilha marca "Franquias" fica fora
--    de todas as linhas. O oficial confirma: mai e jun/26 = R$ 27.500,00, que é
--    só o Thayrone. Com os dois departamentos o Hub dava 32.950 e 33.000.
--
-- 2. JOÃO PEDRO LAUER E MATHEUS VICTOR SÃO INSIDE SALES.
--    Não estão na planilha Dados Pessoal nem no `ESPECIAIS` da skill, então caíam
--    no fallback de "Pessoal - Comercial" → Field Sales. A memória de cálculo
--    oficial de abril/26 os põe em Inside Sales, e em jun/26 é isso que fecha:
--    sem os R$ 8.645 deles, Field Sales dá 68.228,33 contra 68.328,33 oficiais.
-- ===========================================================================

update public.cac_linhas
   set departamentos = '{Franquia}', atualizado_em = now()
 where grupo = 'Equipes' and rotulo = 'Franquia';

insert into public.cac_pessoas (cnpj, nome, departamento, observacao, ativo)
values
  ('63895942000103', 'João Pedro Mendes Lauer',          'Inside Sales', 'Memória de cálculo oficial de abril/26. Fora da planilha Dados Pessoal.', false),
  ('64922381000149', 'Matheus Victor Valerio Rodrigues', 'Inside Sales', 'Memória de cálculo oficial de abril/26. Fora da planilha Dados Pessoal.', false)
on conflict (cnpj) do nothing;

-- ─────────────────────── As notas, com o que foi medido ───────────────────────

/* A nota decide o selo: sem "CONFERIR" a linha aparece como CONFERIDO. Antes
   daqui, 13 linhas diziam conferido sem nunca terem sido batidas por
   competência. Critério: bate (até R$ 1) em mai E jun/26 → conferido; qualquer
   um dos dois divergindo mais de 1% → CONFERIR com os números.
   Abril pesa menos: o oficial de abril saiu de uma memória de cálculo com
   overrides do diretor que a skill não tem. */
update public.cac_linhas c
   set regra_nota = v.nota, atualizado_em = now()
  from (values
    ('Equipes', 'Branding e Conteúdo', 'Bate com o oficial em jun/26 (R$ 22.548,55); mai fica 0,3% acima.'),
    ('Equipes', 'Performance',         'Bate com o oficial em abr, mai e jun/26.'),
    ('Equipes', 'Comunidade',          'Bate com o oficial em abr, mai e jun/26.'),
    ('Equipes', 'Franquia',            'Só o departamento "Franquia", como na skill ("Franquias" fica fora). Bate em mai e jun/26 (R$ 27.500,00); o abr oficial somou o Lucas Caldas, que não tem CNPJ no Omie.'),
    ('Equipes', 'Canais Indiretos',    'Bate com o oficial em mai e jun/26.'),
    ('Equipes', 'Eventos',             'CONFERIR: o TIME de Eventos. Bate em jun/26 (R$ 19.591,98), mas mai dá 19.732,98 contra 13.350,00 do oficial.'),
    ('Equipes', 'MGM',                 'CONFERIR: o oficial de abr e mai/26 (3.640 e 2.800) é a Nathalia Marques, que a planilha põe em Sucesso — override do diretor que a skill não tem.'),
    ('Equipes', 'Inside Sales',        'CONFERIR: bate em abr/26 (67.148,10 × 67.147,51), mas mai fica 8,6% acima e jun 7% abaixo (77.924,17 × 83.824,17).'),
    ('Equipes', 'Field Sales',         'CONFERIR: bate em jun/26 (68.228,33 × 68.328,33); abr e mai ficam 23% e 10% abaixo — o oficial de abril pôs aqui gente que a skill manda para outras linhas.'),
    ('Equipes', 'Onboarding e Setup',  'CONFERIR: mai/26 1,4% acima e jun 3,8% acima do oficial (76.358,43 × 73.533,43).'),
    ('Equipes', 'Sucesso',             'CONFERIR: jun/26 dá 26.696,67 contra 29.296,67 do oficial (−9%); mai fica 0,8% acima.'),
    ('Equipes', 'Suporte',             'CONFERIR: jun/26 dá 44.833,33 contra 36.708,33 do oficial. R$ 2.980 são de gente de Onboarding paga em 3.2.7.2, que a skill conta inteira em Suporte.'),
    ('Equipes', 'Liderança OPS',       'Bate com o oficial em abr, mai e jun/26.'),
    ('Investimentos', 'Eventos',       'CONFERIR: a verba de feira — 3.1.3.8 Eventos e Feiras + 3.1.3.4 Transportes e Viagens, como na skill. Jun/26 fica 4,6% abaixo (177.024,38 × 185.579,39) e mai 2% abaixo; só entra título pago.'),
    ('Investimentos', 'Influenciadores','3.1.3.10 Influencer Fixo. Bate com o oficial em mai e jun/26.'),
    ('Comissões', 'Consultores',       'CONFERIR: 3.1.3.11 Consultor / Parceiro Variável bate exato em jun/26 (R$ 7.399,40), mas mai dá 34,90 contra 6.531,69.')
  ) as v(grupo, rotulo, nota)
 where c.grupo = v.grupo and c.rotulo = v.rotulo;
