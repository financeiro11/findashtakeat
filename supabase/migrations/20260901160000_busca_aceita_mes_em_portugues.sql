/* ============================================================================
 * A busca passa a aceitar o mês escrito em português.
 *
 * POR QUE, com data e nome: em 01/09/2026, conferindo a busca recém-criada, uma
 * consulta com `array['Jul-26','Ago-26']` devolveu só os quatro lançamentos de
 * julho e nenhum de agosto — e a conclusão foi "não existe lançamento da Paytime
 * em agosto". Existia: R$ 18.047,00 em 21/08, título 5512919743, achado à mão no
 * Omie em dez segundos.
 *
 * A chave de mês é montada em INGLÊS (`'Aug-26'`), porque é a chave de coluna do
 * blob da demonstração; `'Ago'` é só o rótulo de exibição, traduzido na tela.
 * Passar o rótulo devolve zero linhas, sem erro nenhum.
 *
 * E O QUE FEZ O ENGANO PASSAR: **`Jul` é igual nas duas línguas**. A metade da
 * consulta que "funcionou" era a metade que não distinguia as duas convenções, e
 * ela deu confiança para acreditar no vazio da outra metade.
 *
 * O aplicativo nunca esteve errado — a tela e a Edge Function sempre passaram a
 * chave crua. O problema é o FORMATO DA FALHA: uma função cujo trabalho é dizer
 * "procurei e não achei" não pode ter um jeito silencioso de não procurar. Quem
 * lê o vazio, seja pessoa ou modelo, conclui ausência.
 *
 * Por isso a normalização mora AQUI dentro, e não em quem chama: quem chama é que
 * varia (a Edge Function, uma conferência à mão, o SQL de um diagnóstico daqui a
 * um ano), e é sempre o mesmo engano.
 * ========================================================================== */

create or replace function public.demonstracoes_lancamentos_busca(
  p_tipo   text,
  p_meses  text[],
  p_busca  text[],
  p_limite int default 300
)
returns table (
  rubrica     text,
  mes         text,
  data        date,
  contraparte text,
  documento   text,
  categoria   text,
  codigo      text,
  grupo       text,
  valor       numeric,
  cod_titulo  text,
  observacao  text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  /* 'Ago-26' -> 'Aug-26'. Sete meses diferem entre as duas convenções (Fev, Abr,
     Mai, Ago, Set, Out, Dez); os outros cinco são iguais, e são justamente os que
     mascaram o erro quando ele acontece. A caixa também é normalizada: 'ago-26'
     de um SQL escrito à mão vale tanto quanto 'Aug-26'. */
  meses as (
    select distinct
      case initcap(lower(substr(btrim(m), 1, 3)))
        when 'Fev' then 'Feb'
        when 'Abr' then 'Apr'
        when 'Mai' then 'May'
        when 'Ago' then 'Aug'
        when 'Set' then 'Sep'
        when 'Out' then 'Oct'
        when 'Dez' then 'Dec'
        else initcap(lower(substr(btrim(m), 1, 3)))
      end || substr(btrim(m), 4) as m
    from unnest(coalesce(p_meses, array[]::text[])) as m
    where length(btrim(m)) >= 5
  ),
  -- Termo de 1 ou 2 letras casa dentro de qualquer palavra e traria o mês inteiro
  -- de volta. O mesmo piso do casamento de nomes (`MIN_CHAVE`).
  termos as (
    select distinct lower(unaccent(btrim(t))) as t
    from unnest(coalesce(p_busca, array[]::text[])) as t
    where length(btrim(t)) >= 3
  ),
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  cli as (
    select distinct on (c->>'codigo')
      c->>'codigo' as codigo,
      coalesce(
        nullif(btrim(regexp_replace(
          regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
          '\s+\d{11}$', '')), ''),
        c->>'nome'
      ) as nome
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  /* `materialized` de propósito: sem ele o planejador embute este bloco em cada
     referência abaixo e a varredura do blob acontece mais de uma vez. */
  base as materialized (
    select *
    from (
      select
        det,
        case when upper(coalesce(det->>'cNatureza','R')) similar to '(P|D)%' then -1 else 1 end as sinal,
        case when p_tipo = 'dre'
          then to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'),''),'DD/MM/YYYY')
          else to_date(nullif(coalesce(det->>'dDtPagamento', det->>'dDtCredito', det->>'dDtConcilia'),''),'DD/MM/YYYY')
        end as dt,
        det->>'cCodCateg' as codigo,
        (det->>'nValorTitulo')::numeric as bruto
      from mov
    ) x
    where x.dt is not null
      -- Sem `nValorTitulo` é a perna bancária do mesmo título: vale zero aqui.
      and x.bruto is not null
      and x.dt >= (date_trunc('year', current_date) - interval '1 year')::date
      and x.dt <= current_date
      and (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
            [extract(month from x.dt)::int] || '-' || to_char(x.dt,'YY') in (select m from meses)
  ),
  /* Uma categoria pode estar mapeada para mais de uma rubrica (a mesma conta
     servindo DRE e 'ambos'): sem o `distinct on`, o join devolveria o mesmo
     título duas vezes e a proposta de correção contaria o valor em dobro.
     `rubrica nulls last` faz a linha mapeada ganhar da órfã. */
  achados as (
    select distinct on (b.det->>'nCodTitulo', b.dt, b.bruto)
      dp.rubrica                                            as rubrica,
      (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
        [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY')  as mes,
      b.dt                                                  as data,
      coalesce(nullif(btrim(cli.nome), ''), f.nome)         as contraparte,
      nullif(b.det->>'cCPFCNPJCliente', '')                 as documento,
      coalesce(c.descricao, b.codigo)                       as categoria,
      b.codigo                                              as codigo,
      b.det->>'cGrupo'                                      as grupo,
      b.sinal * abs(b.bruto)                                as valor,
      b.det->>'nCodTitulo'                                  as cod_titulo,
      t.observacao                                          as observacao,
      lower(unaccent(
        coalesce(nullif(btrim(cli.nome), ''), f.nome, '') || ' ' ||
        coalesce(c.descricao, b.codigo, '')                || ' ' ||
        coalesce(t.observacao, '')                         || ' ' ||
        coalesce(dp.rubrica, '')
      ))                                                    as busca_txt
    from base b
    left join cat c on c.codigo = b.codigo
    left join cli on cli.codigo = b.det->>'nCodCliente'
    left join lib_fornecedores f
      on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
         regexp_replace(coalesce(b.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
    left join omie_titulo_texto t
      on t.cod_titulo = nullif(b.det->>'nCodTitulo','')::bigint
    left join omie_dre_mapa dp
      on dp.ativo is not false
     and dp.demonstrativo in (p_tipo, 'ambos')
     and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, b.codigo)), '\s+', ' ', 'g')))
    order by b.det->>'nCodTitulo', b.dt, b.bruto, dp.rubrica nulls last
  )
  select
    a.rubrica, a.mes, a.data, a.contraparte, a.documento,
    a.categoria, a.codigo, a.grupo, a.valor, a.cod_titulo, a.observacao
  from achados a
  where exists (select 1 from termos x where a.busca_txt like '%' || x.t || '%')
  -- Pelo tamanho: o que se procura numa correção é o valor que move a célula.
  order by abs(a.valor) desc
  limit greatest(1, least(coalesce(p_limite, 300), 500));
$$;

comment on function public.demonstracoes_lancamentos_busca(text, text[], text[], int) is
  'Lançamentos do Omie de um ou mais meses que casam com algum termo (contraparte, categoria, observação ou rubrica), em QUALQUER rubrica e inclusive fora do DE-PARA. Aceita a chave de mês em inglês (Aug-26, a do blob) ou em português (Ago-26, o rótulo da tela). Insumo da correção pelo chat da célula da DRE/DFC.';

notify pgrst, 'reload schema';
