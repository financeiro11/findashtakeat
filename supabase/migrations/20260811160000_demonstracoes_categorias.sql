/* ============================================================================
 * De que categorias do Omie esta linha da DRE/DFC é feita — mês a mês.
 *
 * O drill-down já mostra a composição do mês em foco: as categorias saem dos
 * próprios lançamentos que ele lista (`demonstracoes_lancamentos`), somadas no
 * cliente. Isso responde "do que essa linha é feita AGORA" e nada mais. A
 * pergunta que se faz olhando para a composição, porém, é a mesma que se faz
 * olhando para os fornecedores: "isso já estava aqui mês passado?", "que
 * categoria puxou a linha?", "sumiu alguma?".
 *
 * POR QUE NÃO REAPROVEITAR `demonstracoes_contrapartes`. Ela devolve uma linha
 * por (rubrica, mês, contraparte) e, na coluna `categoria`, apenas a categoria
 * QUE MAIS PESOU naquela contraparte. Somar aquilo por categoria daria o total
 * errado sempre que um fornecedor aparecesse em duas categorias da mesma
 * rubrica no mesmo mês — o valor inteiro dele iria para a dominante. Num painel
 * cujo propósito é conferir, "quase certo" é pior do que não ter.
 *
 * A regra de atribuição é a mesma das outras três (sinal pela natureza, data de
 * registro na DRE e de pagamento na DFC, DE-PARA por descrição de categoria).
 * O que não está aqui é o que só interessa a quem lista fornecedor: o nome limpo
 * do cadastro, o casamento do lojista do cartão e a observação do título. Sem
 * eles a varredura fica bem mais barata, e a soma por categoria não muda.
 * ========================================================================== */

create or replace function public.demonstracoes_categorias(
  p_tipo    text,
  p_meses   text[],
  p_rubrica text default null   -- null = todas as rubricas
)
returns table (
  rubrica     text,
  mes         text,
  categoria   text,
  valor       numeric,
  lancamentos integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  base as (
    select
      case when upper(coalesce(det->>'cNatureza','R')) similar to '(P|D)%' then -1 else 1 end as sinal,
      case when p_tipo = 'dre'
        then to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'),''),'DD/MM/YYYY')
        else to_date(nullif(coalesce(det->>'dDtPagamento', det->>'dDtCredito', det->>'dDtConcilia'),''),'DD/MM/YYYY')
      end as dt,
      det->>'cCodCateg' as codigo,
      (det->>'nValorTitulo')::numeric as bruto
    from mov
  )
  select
    dp.rubrica                                                        as rubrica,
    -- Chave de mês montada à mão (e não com to_char(dt,'Mon')) para não depender
    -- do locale do servidor — mesma razão do drill-down.
    (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
      [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY')     as mes,
    -- A MESMA expressão que `demonstracoes_lancamentos` devolve em
    -- `categoria_descricao`. Precisa ser idêntica: é por ela que o painel casa
    -- o mês em foco (que vem de lá) com o histórico (que vem daqui).
    coalesce(c.descricao, b.codigo)                                    as categoria,
    sum(b.sinal * abs(b.bruto))::numeric                               as valor,
    count(*)::integer                                                  as lancamentos
  from base b
  left join cat c on c.codigo = b.codigo
  join omie_dre_mapa dp
    on dp.ativo is not false
   and dp.demonstrativo in (p_tipo, 'ambos')
   -- O corte por rubrica entra no join, antes de agrupar: o painel abre UMA
   -- rubrica e pede treze meses.
   and (p_rubrica is null or dp.rubrica = p_rubrica)
   and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
     = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, b.codigo)), '\s+', ' ', 'g')))
  where b.dt is not null
    -- Sem `nValorTitulo` é a perna bancária do mesmo título: vale zero aqui.
    and b.bruto is not null
    -- As mesmas bordas do drill-down: o cache guarda do 1º de janeiro do ano
    -- passado, e lançamento com data futura não conta no mês corrente. Sem
    -- isto o histórico incluiria o que a lista do mês em foco não mostra, e a
    -- categoria apareceria como "nova" num mês em que ela nem devia contar.
    and b.dt >= (date_trunc('year', current_date) - interval '1 year')::date
    and b.dt <= current_date
    and (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
          [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY') = any(p_meses)
  group by dp.rubrica, 2, 3
  order by dp.rubrica, 2, abs(sum(b.sinal * abs(b.bruto))) desc;
$$;

-- Função nova em `public` nasce chamável por `anon`: sem o revoke abaixo, a
-- composição das rubricas da empresa responderia a quem só tem a chave pública.
revoke all on function public.demonstracoes_categorias(text, text[], text) from public;
revoke all on function public.demonstracoes_categorias(text, text[], text) from anon;
grant execute on function public.demonstracoes_categorias(text, text[], text) to authenticated;
grant execute on function public.demonstracoes_categorias(text, text[], text) to service_role;

notify pgrst, 'reload schema';
