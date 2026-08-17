-- ---------------------------------------------------------------------------
-- Seed das linhas do painel CAC e a regra de cada uma.
--
-- A lista de categorias de folha se repete em TODA linha de Equipes, e é
-- intencional: a separação entre times vem do DEPARTAMENTO da pessoa, nunca da
-- rubrica. Inside Sales e Field Sales são ambos "Pessoal - Comercial" no Omie;
-- o que os separa é a planilha "dados pessoais".
--
-- A lista inclui os DOIS códigos de "Premiação - Suporte" (2.03.01 e 2.01.95) e
-- os DOIS de "Premiação - Sucesso" (2.01.94 e 2.03.03). O Omie tem a mesma
-- descrição em código diferente, e ficar com um só perderia metade da comissão
-- sem erro nenhum.
--
-- As notas que começam com "CONFERIR" viram um alerta na tela (ícone âmbar na
-- linha e faixa no drill-down). São as regras que ainda não fecharam contra o
-- painel antigo — ver o comentário de cada uma.
-- ---------------------------------------------------------------------------

with folha as (
  select '{2.03.10,2.03.08,2.03.01,2.01.95,2.01.94,2.03.03,2.03.05,2.03.07,2.03.09,2.03.11,2.03.12,2.03.13,2.03.99,2.03.98,2.03.97,2.04.95,2.02.92,2.01.98,2.01.97}'::text[] as cats
)
insert into public.cac_linhas (grupo, rotulo, ordem, departamentos, categorias, regra_nota)
select v.grupo, v.rotulo, v.ordem, v.deps, coalesce(v.cats, folha.cats), v.nota
from folha, (values
  ('Equipes','Branding e Conteúdo', 10, '{"Branding e Conteúdo"}'::text[], null::text[], 'Folha e premiação de quem está em Branding e Conteúdo.'),
  ('Equipes','Performance',         20, '{"Performance"}'::text[], null::text[], 'Folha e premiação de quem está em Performance.'),
  ('Equipes','Comunidade',          30, '{"Comunidade"}'::text[], null::text[], 'Folha e premiação de quem está em Comunidade.'),
  ('Equipes','Franquia',            40, '{"Franquia","Franquias"}'::text[], null::text[], 'Aponta para os DOIS departamentos: a planilha grafa "Franquia" e "Franquias". Fecha exato em R$ 35.000,00 em Jul/26.'),
  ('Equipes','Canais Indiretos',    50, '{"Canais Indiretos"}'::text[], null::text[], 'Folha e premiação de quem está em Canais Indiretos.'),
  ('Equipes','Eventos',             60, '{"Eventos"}'::text[], null::text[], 'O TIME de Eventos. Não confundir com Investimentos › Eventos, que é a verba de feira.'),
  ('Equipes','MGM',                 70, '{"MGM"}'::text[], null::text[], 'Ninguém da planilha está em MGM hoje — a linha devolve zero até alguém ser marcada assim ou a regra apontar para uma categoria.'),
  ('Equipes','Inside Sales',        80, '{"Inside Sales"}'::text[], null::text[], 'Conferido em Jul/26: R$ 71.612,50 contra R$ 71.651,00 do painel antigo (0,05%).'),
  ('Equipes','Field Sales',         90, '{"Field Sales"}'::text[], null::text[], 'Folha e premiação de quem está em Field Sales.'),
  ('Equipes','Onboarding e Setup', 100, '{"Onboarding e Setup"}'::text[], null::text[], 'Folha e premiação de quem está em Onboarding e Setup.'),
  ('Equipes','Sucesso',            110, '{"Sucesso"}'::text[], null::text[], 'Folha e premiação de quem está em Sucesso.'),
  ('Equipes','Suporte',            120, '{"Suporte"}'::text[], null::text[], 'Folha e premiação de quem está em Suporte.'),
  ('Equipes','Liderança OPS',      130, '{"Liderança OPS"}'::text[], null::text[], 'Departamento próprio na planilha, ainda que a categoria no Omie seja Pessoal - Sucesso.'),

  -- Investimentos: rubricas inteiras do Omie, sem filtro de pessoa.
  ('Investimentos','Eventos',        200, '{}'::text[], '{2.02.94}'::text[], 'CONFERIR: 3.1.3.8 Eventos e Feiras - Marketing deu R$ 135.203,18 em Jul/26 contra R$ 170.760,89 do painel antigo. Falta apontar de onde vêm os ~R$ 35 mil.'),
  ('Investimentos','Influenciadores',210, '{}'::text[], '{2.02.01}'::text[], '3.1.3.10 Influencer Fixo. Fecha EXATO nos quatro meses conferidos (abr a jul/26).'),

  -- Comissões: as regras aqui são as menos certas. Ver a nota de cada linha.
  ('Comissões','Agência de Marketing',300,'{}'::text[], '{2.02.99}'::text[], 'CONFERIR: apontado para 3.1.3.3 Consultorias e Agências - Marketing por semelhança de nome, sem validação contra o painel antigo.'),
  ('Comissões','Contadores',        310, '{}'::text[], '{2.04.09}'::text[], 'CONFERIR: apontado para 3.1.2.3 Consultorias - Administrativo por semelhança, sem validação contra o painel antigo.'),
  ('Comissões','Consultores',       320, '{}'::text[], '{2.02.02}'::text[], 'CONFERIR: 3.1.3.11 Consultor / Parceiro Variável fecha EXATO em Jul/26 (R$ 6.222,18) mas diverge em abr, mai e jun.'),
  ('Comissões','Comissão de MGM',   330, '{}'::text[], '{}'::text[], 'CONFERIR: nenhuma categoria do Omie identificada ainda. Devolve zero até a regra ser preenchida.')
) as v(grupo, rotulo, ordem, deps, cats, nota)
on conflict (grupo, rotulo) do nothing;
