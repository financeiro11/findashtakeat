-- ===========================================================================
-- PAINEL CAC PASSA A SEGUIR A SKILL `custos-cac-mensal`.
--
-- A skill é como a tabela oficial de CAC foi preenchida (CAC_Jun26.xlsx). O Hub
-- tinha nascido com regras parecidas, mas não iguais, e a diferença que mais
-- pesava nem era de regra: era de MÊS.
--
-- 1. REGIME: COMPETÊNCIA, NÃO DATA DE PAGAMENTO.
--    A skill lê o "DRE VPX por competência" do Omie. O abril oficial foi montado
--    com os pagamentos feitos de 05 a 08/05 — a folha de abril paga em maio. O
--    Hub somava pela data do pagamento e ficava UM MÊS ADIANTADO: o "julho" do
--    Hub era o junho oficial. Medido em 13/09/2026, por `dDtRegistro`:
--      Performance  abr 13.364,02 · mai 12.200,00 · jun 14.030,00
--      oficial      abr 13.364,00 · mai 12.200,00 · jun 14.030,00
--      Consultores  jun 7.399,40 (oficial 7.399,40; por pagamento dava 7.434,30)
--    Continua valendo só título PAGO — o que muda é em qual mês ele cai.
--
-- 2. QUEM NÃO ESTÁ NO CADASTRO TAMBÉM CONTA.
--    A skill resolve o departamento em cascata: CNPJ → raiz do CNPJ → nome
--    conhecido → categoria. O Hub parava no CNPJ, e em 2026 ficavam de fora
--    ~R$ 530 mil de folha comercial/OPS paga a quem saiu ou nunca foi
--    cadastrado. Aqui a cascata vira:
--      • CNPJ exato em `cac_pessoas`, SEM exigir `ativo` ("desligado que aparece
--        no CAP soma normalmente", diz a skill);
--      • raiz de 8 dígitos, para a filial /0002 do mesmo PJ;
--      • `cac_pessoas.codigos_omie`, para o cadastro do Omie SEM documento
--        (o caio e a Julia têm um de cada);
--      • `cac_linhas.categorias_sem_cadastro`: o `FALLBACK_CAT` da skill —
--        "Pessoal - Comercial" de quem não está no cadastro vai para Field Sales.
--    Os nomes do `ESPECIAIS` da skill que não estavam no cadastro entram abaixo
--    pelo CNPJ que o Omie tem para eles, como inativos (não estão na planilha).
--
-- 3. `categorias_inteiras`: 3.2.7.2 Pessoal - Suporte é SEMPRE Suporte, seja
--    quem for que recebeu (a skill não olha o CNPJ nessa categoria). Por isso
--    ela sai da lista de folha das outras linhas — senão contaria duas vezes.
--
-- 4. O QUE SAI DAS EQUIPES: Pro Labore, INSS, Benefícios e Diretores (3.2.22).
--    Diretores estava na lista; não pesava porque os quatro diretores são de
--    departamentos fora do CAC, mas bastava um mudar de time.
--    O QUE ENTRA: 3.2.7.4 Escala - Suporte e 3.2.7.5 Escala - Onboarding.
--
-- 5. LINHAS MANUAIS: Agência de Marketing, Contadores e Comissão de MGM são
--    digitadas todo mês. As regras apontadas "por semelhança" davam, em
--    Contadores, R$ 13 mil/mês (a Contabilidade) contra R$ 700 do oficial.
--
-- UM DESVIO CONSCIENTE DA SKILL: 2.01.94 e 2.01.95 (as cópias de "Premiação -
-- Sucesso/Suporte" que o Omie pôs no grupo Despesas Diretas) continuam. A skill
-- filtra por nome de grupo e as perde; a memória de cálculo oficial de abril
-- conta premiação de Suporte, e em 2026 são R$ 62 mil.
-- ===========================================================================

-- ─────────────────────── 1. Colunas novas ───────────────────────

alter table public.cac_linhas
  add column if not exists categorias_inteiras     text[]  not null default '{}',
  add column if not exists categorias_sem_cadastro text[]  not null default '{}',
  add column if not exists manual                  boolean not null default false;

comment on column public.cac_linhas.categorias_inteiras is
  'Categorias que entram INTEIRAS nesta linha, seja quem for que recebeu. Não podem aparecer em nenhuma outra linha.';
comment on column public.cac_linhas.categorias_sem_cadastro is
  'Categorias que caem aqui quando quem recebeu NÃO está em cac_pessoas (FALLBACK_CAT da skill). Cada categoria em no máximo uma linha.';
comment on column public.cac_linhas.manual is
  'Linha digitada todo mês (cac_valores_manuais). Não soma nada do Omie.';

alter table public.cac_pessoas
  add column if not exists codigos_omie bigint[] not null default '{}';

comment on column public.cac_pessoas.codigos_omie is
  'Códigos de cliente do Omie SEM documento que também são esta pessoa. O pagamento feito a eles casa como se tivesse o CNPJ.';

-- ─────────────────────── 2. A base: um título pago, uma linha ───────────────────────

/* Continua sendo DEFINER de propósito (ver a nota do advisor em
   armadilhas-postgres-supabase): `omie_cache` não tem policy.

   `group by` em vez de `distinct on`: a data de registro só vem na origem MANP e
   a de pagamento só na BAXP. Pegar uma linha ao acaso por título perdia uma das
   duas. O valor continua sem somar — as duas origens carregam o valor cheio.

   `cnpj` passa a ser a CHAVE DA PESSOA: o CNPJ dela quando o título casa por
   documento, raiz ou código do Omie; senão, o documento cru. `cnpj_omie` guarda
   o que o Omie escreveu. */
create or replace view public.cac_pagamentos as
  with t as (
    select (e->'detalhes'->>'nCodTitulo')::bigint                                            as cod_titulo,
           max(regexp_replace(coalesce(e->'detalhes'->>'cCPFCNPJCliente',''),'[^0-9]','','g')) as doc,
           max(e->'detalhes'->>'cCodCateg')                                                  as categoria,
           max(to_date(e->'detalhes'->>'dDtPagamento','DD/MM/YYYY'))                         as data_pagamento,
           max(to_date(e->'detalhes'->>'dDtVenc','DD/MM/YYYY'))                              as vencimento,
           max(to_date(e->'detalhes'->>'dDtRegistro','DD/MM/YYYY'))                          as registro,
           max((e->'resumo'->>'nValPago')::numeric)                                          as valor,
           max(e->'detalhes'->>'nCodCliente')                                                as cod_cliente
      from public.omie_cache, lateral jsonb_array_elements(dados) e
     where chave = 'movimentos'
       and e->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
     group by 1
  )
  select t.cod_titulo,
         coalesce(
           (select p.cnpj from public.cac_pessoas p where p.cnpj = t.doc),
           (select p.cnpj from public.cac_pessoas p
             where length(t.doc) = 14 and length(p.cnpj) = 14
               and left(p.cnpj, 8) = left(t.doc, 8)
             order by p.ativo desc limit 1),
           (select p.cnpj from public.cac_pessoas p
             where t.cod_cliente ~ '^[0-9]+$' and t.cod_cliente::bigint = any(p.codigos_omie)
             limit 1),
           t.doc
         )                                        as cnpj,
         t.categoria,
         t.data_pagamento,
         t.vencimento,
         t.valor,
         coalesce(t.registro, t.data_pagamento)   as competencia,
         t.doc                                    as cnpj_omie,
         t.cod_cliente
    from t
   where t.data_pagamento is not null;

comment on view public.cac_pagamentos is
  'Titulos PAGOS do Omie, um por cod_titulo. competencia = dDtRegistro (regime da skill custos-cac-mensal). cnpj = chave da pessoa em cac_pessoas quando casa; cnpj_omie = documento cru.';

-- ─────────────────────── 3. Casa um pagamento com uma linha ───────────────────────

create or replace function public.cac_linha_casa(
  p_linha public.cac_linhas, p_cnpj text, p_categoria text
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    -- Linha digitada não soma nada do Omie.
    when p_linha.manual then false
    -- A categoria entra inteira, seja quem for.
    when p_categoria = any(p_linha.categorias_inteiras) then true
    else
      -- Quem está no cadastro: departamento E categoria. REGRA VAZIA NÃO CASA
      -- COM NADA — sem essa guarda uma linha em branco somava o CAP inteiro.
      (
        (cardinality(p_linha.departamentos) > 0 or cardinality(p_linha.categorias) > 0)
        and (cardinality(p_linha.categorias) = 0 or p_categoria = any(p_linha.categorias))
        and (cardinality(p_linha.departamentos) = 0 or exists (
              select 1 from public.cac_pessoas p
               where p.cnpj = p_cnpj and p.departamento = any(p_linha.departamentos)))
      )
      -- Quem NÃO está no cadastro cai pela categoria.
      or (
        p_categoria = any(p_linha.categorias_sem_cadastro)
        and not exists (select 1 from public.cac_pessoas p where p.cnpj = p_cnpj)
      )
  end
$function$;

revoke all on function public.cac_linha_casa(public.cac_linhas, text, text) from public;
revoke all on function public.cac_linha_casa(public.cac_linhas, text, text) from anon;
grant execute on function public.cac_linha_casa(public.cac_linhas, text, text) to authenticated, service_role;

-- ─────────────────────── 4. A matriz, por competência ───────────────────────

create or replace function public.cac_painel(p_ano integer)
returns table (
  linha_id uuid, grupo text, rotulo text, ordem integer, regra_nota text,
  mes integer, valor numeric, origem text
)
language sql
stable
as $function$
  with meses as (select generate_series(1,12) as mes),
  pg as materialized (
    select cnpj, categoria, valor, extract(month from competencia)::int as mes
      from public.cac_pagamentos
     where competencia >= make_date(p_ano, 1, 1)
       and competencia <  make_date(p_ano + 1, 1, 1)
  ),
  calc as (
    select l.id as linha_id, m.mes,
           coalesce(sum(pg.valor) filter (
             where public.cac_linha_casa(l, pg.cnpj, pg.categoria)
           ), 0) as valor
      from public.cac_linhas l
      cross join meses m
      left join pg on pg.mes = m.mes
     where l.ativo
     group by l.id, m.mes
  )
  select l.id, l.grupo, l.rotulo, l.ordem, l.regra_nota,
         c.mes,
         coalesce(vm.valor, c.valor) as valor,
         case when vm.valor is not null then 'manual' else 'omie' end as origem
    from calc c
    join public.cac_linhas l on l.id = c.linha_id
    left join public.cac_valores_manuais vm
      on vm.linha_id = c.linha_id and vm.ano = p_ano and vm.mes = c.mes
   order by l.ordem, c.mes;
$function$;

-- ─────────────────────── 5. O que compõe uma célula ───────────────────────

/* Mesma assinatura e mesmas colunas: `cac_celula` embrulha esta com `select *`,
   que acopla por POSIÇÃO. `data_pagamento` continua sendo a data do pagamento —
   é o que se procura no Omie —, mas o filtro do mês é a competência. */
create or replace function public.cac_celula_completo(p_ano integer, p_mes integer, p_linha_id uuid)
returns table (
  tipo text, cod_titulo bigint, data_pagamento date, cnpj text, pessoa text,
  favorecido text, departamento text, categoria text, categoria_descricao text,
  natureza text, valor numeric
)
language sql
stable
as $function$
  with cat as (
    select e->>'codigo' as codigo, e->>'descricao' as descricao
      from public.omie_cache, lateral jsonb_array_elements(dados) e
     where chave = 'categorias'
  ),
  -- O favorecido pelo CÓDIGO do cliente, não pelo documento: o pagamento sem
  -- CNPJ ("Lucas Caldas") também tem nome.
  cli as (
    select e->>'codigo' as codigo, e->>'nome' as nome
      from public.omie_cache, lateral jsonb_array_elements(dados) e
     where chave = 'clientes'
  ),
  pagos as (
    select pg.cod_titulo, pg.data_pagamento, pg.cnpj, pg.categoria, pg.valor, pg.cod_cliente,
           p.nome as pessoa, p.departamento
      from public.cac_pagamentos pg
      join public.cac_linhas l on l.id = p_linha_id
      left join public.cac_pessoas p on p.cnpj = pg.cnpj
     where pg.competencia >= make_date(p_ano, p_mes, 1)
       and pg.competencia <  (make_date(p_ano, p_mes, 1) + interval '1 month')::date
       and public.cac_linha_casa(l, pg.cnpj, pg.categoria)
  )
  select 'lancamento'::text, pagos.cod_titulo, pagos.data_pagamento, pagos.cnpj,
         pagos.pessoa, cli.nome, pagos.departamento,
         pagos.categoria, cat.descricao,
         case when cat.descricao ~* 'premia' then 'comissão' else 'folha' end,
         pagos.valor
    from pagos
    left join cat on cat.codigo = pagos.categoria
    left join cli on cli.codigo = pagos.cod_cliente

  union all

  -- Quem deveria ter recebido e não recebeu. Aqui `ativo` vale: é a lista de
  -- quem está no time HOJE.
  select 'sem_pagamento'::text, null::bigint, null::date, p.cnpj,
         p.nome, null::text, p.departamento, null::text, null::text, null::text, p.remuneracao
    from public.cac_pessoas p
    join public.cac_linhas l on l.id = p_linha_id
   where p.ativo
     and not l.manual
     and cardinality(l.departamentos) > 0
     and p.departamento = any(l.departamentos)
     and not exists (select 1 from pagos where pagos.cnpj = p.cnpj)

   order by 1, 11 desc nulls last;
$function$;

-- A assinatura antiga não tem mais quem a chame.
drop function if exists public.cac_linha_casa(text[], text[], text, text);

-- ─────────────────────── 6. As regras da skill ───────────────────────

/* A folha das Equipes: todo o grupo "Despesas com Pessoal" (2.03) menos Pro
   Labore (2.03.02), INSS (2.03.06) e Benefícios (2.03.14); mais as 3.2.7.x menos
   a 3.2.7.2, que é inteira de Suporte; mais as duas premiações duplicadas em
   Despesas Diretas (2.01.94 e 2.01.95 — o desvio explicado no topo). */
update public.cac_linhas
   set categorias = '{2.03.01,2.03.03,2.03.04,2.03.05,2.03.07,2.03.08,2.03.09,2.03.10,2.03.11,2.03.12,2.03.13,2.03.95,2.03.96,2.03.97,2.03.98,2.03.99,2.02.92,2.01.90,2.01.94,2.01.95,2.01.96,2.01.97}',
       categorias_inteiras = '{}',
       categorias_sem_cadastro = '{}',
       manual = false,
       atualizado_em = now()
 where grupo = 'Equipes';

-- FALLBACK_CAT da skill, traduzido para código.
update public.cac_linhas set categorias_sem_cadastro = '{2.03.11,2.03.99}'
 where grupo = 'Equipes' and rotulo = 'Field Sales';          -- Pessoal/Premiação - Comercial
update public.cac_linhas set categorias_sem_cadastro = '{2.03.12,2.03.97}'
 where grupo = 'Equipes' and rotulo = 'Branding e Conteúdo';  -- Pessoal/Premiação - Marketing
update public.cac_linhas set categorias_sem_cadastro = '{2.02.92,2.03.98,2.01.90}'
 where grupo = 'Equipes' and rotulo = 'Onboarding e Setup';   -- Pessoal/Premiação/Escala - Onboarding
update public.cac_linhas set categorias_sem_cadastro = '{2.03.03,2.01.94,2.01.97}'
 where grupo = 'Equipes' and rotulo = 'Sucesso';              -- Pessoal/Premiação - Sucesso
update public.cac_linhas set categorias_sem_cadastro = '{2.03.08,2.03.07}'
 where grupo = 'Equipes' and rotulo = 'Canais Indiretos';     -- Pessoal/Premiação - Novos Canais
update public.cac_linhas
   set categorias = array_remove(categorias, '2.01.98'),
       categorias_inteiras = '{2.01.98}',                     -- 3.2.7.2 Pessoal - Suporte: sempre Suporte
       categorias_sem_cadastro = '{2.03.01,2.01.95,2.01.96}'  -- Premiação/Escala - Suporte
 where grupo = 'Equipes' and rotulo = 'Suporte';

-- Investimentos › Eventos = 3.1.3.8 Eventos e Feiras + 3.1.3.4 Transportes e Viagens.
update public.cac_linhas set categorias = '{2.02.94,2.02.98}', departamentos = '{}'
 where grupo = 'Investimentos' and rotulo = 'Eventos';
update public.cac_linhas set categorias = '{2.02.01}', departamentos = '{}'
 where grupo = 'Investimentos' and rotulo = 'Influenciadores';
update public.cac_linhas set categorias = '{2.02.02}', departamentos = '{}'
 where grupo = 'Comissões' and rotulo = 'Consultores';

-- As três que a skill manda digitar.
update public.cac_linhas
   set manual = true, departamentos = '{}', categorias = '{}',
       categorias_inteiras = '{}', categorias_sem_cadastro = '{}',
       regra_nota = 'Digitada todo mês — a skill custos-cac-mensal não calcula esta linha.',
       atualizado_em = now()
 where grupo = 'Comissões' and rotulo in ('Agência de Marketing', 'Contadores', 'Comissão de MGM');

-- ─────────────────────── 7. O de-para de nomes da skill ───────────────────────

/* `ESPECIAIS` da skill que não estavam no cadastro. Entram pelo CNPJ que o Omie
   tem para cada um, e INATIVOS: não estão na planilha Dados Pessoal, então não
   devem aparecer como "sem pagamento" no mês. O que receberam soma igual.
   Os outros nomes da lista já estavam no cadastro com o mesmo departamento. */
insert into public.cac_pessoas (cnpj, nome, departamento, observacao, ativo)
values
  ('65160247000110', 'Gabriela Paganini Trindade',              'Liderança OPS',       'De-para da skill custos-cac-mensal (123ACTION, NFS-e da Gabriela). Fora da planilha Dados Pessoal.', false),
  ('50850621000132', 'Carla Regina Anunciação da Silva Nascimento','Branding e Conteúdo','De-para da skill custos-cac-mensal. Fora da planilha Dados Pessoal.', false),
  ('57648488000185', 'Ingra Piffano de Resende Faetti',          'Canais Indiretos',    'De-para da skill custos-cac-mensal. Fora da planilha Dados Pessoal.', false),
  ('13530463701',    'Laura Romaneli dos Anjos',                 'Branding e Conteúdo', 'De-para da skill custos-cac-mensal. Fora da planilha Dados Pessoal.', false),
  ('46148025000138', 'Michael Cardoso Thome',                    'Inside Sales',        'De-para da skill custos-cac-mensal. A memória de cálculo de abril/26 o pôs em Field Sales.', false),
  ('65650353000182', 'Priscila de Souza Braga',                  'Field Sales',         'De-para da skill custos-cac-mensal. Fora da planilha Dados Pessoal.', false),
  ('60663286000117', 'Rhuan Moura da Silva',                     'Inside Sales',        'De-para da skill custos-cac-mensal (R M DA SILVA CONSULTORIA COMERCIAL). Fora da planilha Dados Pessoal.', false)
on conflict (cnpj) do nothing;

-- Cadastros do Omie sem documento que são gente do cadastro.
update public.cac_pessoas
   set codigos_omie = array(select distinct unnest(codigos_omie || '{5478966648}'::bigint[]))
 where cnpj = '66804297000156';   -- "caio augusto marinho caiado"
update public.cac_pessoas
   set codigos_omie = array(select distinct unnest(codigos_omie || '{5462256765}'::bigint[]))
 where cnpj = '59955289000145';   -- "59.955.289 JULIA SCHAIDER ALEXANDRE"

-- ─────────────────────── 8. Conferência ───────────────────────

do $$
declare
  v text;
begin
  -- Nenhuma categoria cai "sem cadastro" em duas linhas.
  select string_agg(c, ', ') into v from (
    select c from public.cac_linhas, unnest(categorias_sem_cadastro) c
     where ativo and not manual group by c having count(*) > 1) x;
  if v is not null then raise exception 'categoria sem cadastro em duas linhas: %', v; end if;

  -- Categoria inteira não aparece em nenhuma outra linha.
  select string_agg(distinct c, ', ') into v
    from public.cac_linhas a, unnest(a.categorias_inteiras) c, public.cac_linhas b
   where a.ativo and b.ativo and not b.manual and b.id <> a.id
     and c = any(b.categorias || b.categorias_inteiras || b.categorias_sem_cadastro);
  if v is not null then raise exception 'categoria inteira contada também noutra linha: %', v; end if;

  -- Pro Labore, INSS, Benefícios e Diretores não entram em linha nenhuma.
  select string_agg(distinct c, ', ') into v
    from public.cac_linhas, unnest(categorias || categorias_inteiras || categorias_sem_cadastro) c
   where c in ('2.03.02', '2.03.06', '2.03.14', '2.04.95');
  if v is not null then raise exception 'categoria excluída pela skill voltou: %', v; end if;

  -- A competência veio do registro, e não do fallback, em quase tudo.
  if (select count(*) filter (where competencia <> data_pagamento)::numeric / nullif(count(*), 0)
        from public.cac_pagamentos where data_pagamento >= '2026-04-01') < 0.3 then
    raise exception 'dDtRegistro não está chegando na view — a competência caiu na data de pagamento';
  end if;

  -- Corpo de função SQL só falha na chamada.
  perform count(*) from public.cac_painel(2026);
  perform count(*) from public.cac_celula_completo(2026, 6,
    (select id from public.cac_linhas where grupo = 'Equipes' and rotulo = 'Suporte'));
end $$;
