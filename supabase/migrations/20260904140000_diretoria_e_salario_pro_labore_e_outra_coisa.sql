-- Diretoria é salário; pró-labore é outra coisa.
--
-- Quando "Diretores - Administrativo" entrou no painel, eu a joguei no bloco
-- `prolabore` junto com "Pro Labore" — e como a view somava os dois dentro de
-- `fixo`, o erro não aparecia em lugar nenhum.
--
-- Aparece agora que o pró-labore ganhou coluna própria: a ficha do Miguel
-- mostrava R$ 26.861 inteiros como pró-labore, quando R$ 22.500 são o salário
-- dele como CEO e R$ 4.361 é que são o pró-labore. Destacar o pró-labore sem
-- isto não destacaria nada — seria o mesmo balde com nome novo.
--
-- São coisas de natureza diferente: salário de diretor é remuneração do
-- trabalho, pró-labore é remuneração do sócio. Quem abre a ficha do CEO quer
-- ver os dois, separados.
--
-- Vale para os quatro de "Diretores - Administrativo" — Miguel Carvalho, Luiz
-- Paulo, Pedro Faro e Victor Brittes: todos passam a ter o valor como fixo.

drop view if exists public.vw_remuneracao_omie;

create view public.vw_remuneracao_omie
with (security_invoker = true) as
with mov as (
  select distinct on ((((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint))
    (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint)                         as cod_titulo,
    nullif((d.value -> 'detalhes') ->> 'cCodCateg', '')                          as categoria_codigo,
    ((d.value -> 'detalhes') ->> 'nValorTitulo')::numeric                        as valor,
    to_date(nullif((d.value -> 'detalhes') ->> 'dDtRegistro', ''), 'DD/MM/YYYY') as registro,
    to_date(nullif((d.value -> 'detalhes') ->> 'dDtVenc', ''), 'DD/MM/YYYY')     as vencimento,
    to_date(nullif((d.value -> 'detalhes') ->> 'dDtPagamento', ''), 'DD/MM/YYYY') as pagamento,
    regexp_replace(coalesce((d.value -> 'detalhes') ->> 'cCPFCNPJCliente', ''), '\D', '', 'g') as doc_mov,
    nullif((d.value -> 'detalhes') ->> 'nCodCliente', '')                        as cod_cliente
  from public.omie_cache, lateral jsonb_array_elements(omie_cache.dados) d
  where omie_cache.chave = 'movimentos'
    and ((d.value -> 'detalhes') ->> 'cGrupo') = 'CONTA_A_PAGAR'
  order by (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint)
),
cadastro as materialized (
  select c.value ->> 'codigo' as codigo,
         regexp_replace(coalesce(c.value ->> 'cnpj_cpf', ''), '\D', '', 'g') as doc,
         nullif(btrim(c.value ->> 'nome'), '') as nome
  from public.omie_cache, lateral jsonb_array_elements(omie_cache.dados) c
  where omie_cache.chave = 'clientes'
),
cadastro_doc as materialized (
  select doc, min(nome) as nome from cadastro where doc <> '' group by doc
),
ape_doc as materialized (
  select chave, min(apelido) as apelido from public.contraparte_apelido
  where via = 'doc' and apelido is not null group by chave
),
ape_nome as materialized (
  select chave, min(apelido) as apelido from public.contraparte_apelido
  where via = 'nome' and apelido is not null group by chave
),
base as (
  select m.cod_titulo, m.valor, m.registro, m.vencimento, m.pagamento, m.doc_mov,
         r.descricao as categoria,
         coalesce(nullif(btrim(t.favorecido), ''), cad.nome, cadd.nome) as nome_cru
  from mov m
    join public.omie_categoria_regra r on r.codigo = m.categoria_codigo
    left join cadastro cad       on cad.codigo = m.cod_cliente
    left join cadastro_doc cadd  on cadd.doc = nullif(m.doc_mov, '')
    left join public.omie_titulo_texto t on t.cod_titulo = m.cod_titulo
  where r.descricao ~* '(Pessoal|Premia[çc][ãa]o|Escala)\s*-'
     or r.descricao ~* 'Pro\s*Labore'
     or r.descricao ~* 'Diretores\s*-'
)
select
  b.cod_titulo,
  b.categoria,
  b.valor,
  b.vencimento,
  b.pagamento,
  date_trunc('month', b.registro)::date as competencia,

  -- Classificação pela PALAVRA da descrição, nunca pelo código.
  --
  -- "Diretores" é FIXO, não pró-labore: é o salário mensal de quem dirige a
  -- empresa. Pró-labore é a remuneração do SÓCIO, tem natureza distinta, e o
  -- Miguel recebe as duas — R$ 22.500 de diretoria e R$ 4.361 de pró-labore no
  -- mesmo mês. Somar os dois num balde só apagaria a distinção que a ficha dele
  -- existe para mostrar.
  case
    when b.categoria ~* 'Premia[çc][ãa]o' then 'premiacao'
    when b.categoria ~* 'Escala'          then 'escala'
    when b.categoria ~* 'Pro\s*Labore'    then 'prolabore'
    else 'fixo'
  end as bloco,

  coalesce(ad.apelido, an.apelido, b.nome_cru) as nome,
  b.nome_cru,
  b.registro,
  nullif(b.doc_mov, '') as doc

from base b
  left join ape_doc ad
    on nullif(b.doc_mov, '') is not null and ad.chave = b.doc_mov
  left join ape_nome an
    on length(public.contraparte_chave(coalesce(b.nome_cru, ''))) >= 4
   and an.chave = public.contraparte_chave(b.nome_cru)
where b.registro is not null
  and b.nome_cru is not null
  and b.valor >= 1;

comment on view public.vw_remuneracao_omie is
  'Movimentos do Omie nas categorias de pessoal, já com bloco, competência e nome da pessoa.';

revoke all on public.vw_remuneracao_omie from anon;

-- A carga reescreve o `bloco` de quem já está gravado (`on conflict do update`),
-- então uma passada põe os quatro diretores no lugar certo.
select public.remuneracao_carregar_omie();
