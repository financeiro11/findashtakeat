-- Parametrização, parte 5: a fila ganha janela de tempo.
--
-- "Um fornecedor sem nome de março já não importa tanto; julho, que acabamos de
-- fechar, importa." Está certo — e a consequência não é só filtrar a LISTA.
--
-- Se a janela cortasse apenas quais contrapartes aparecem, `lancamentos` e
-- `total` continuariam sendo os de sempre, e a barra de cobertura diria "43% do
-- valor" somando dinheiro de fora da janela. Seria o mesmo erro do denominador
-- inflado pelas transferências (migration 20260812210000), de novo.
--
-- Por isso a data entra no WHERE de cada lado, ANTES do group by: dentro da
-- janela, `total` é o valor da janela e a cobertura fala do que está sendo
-- perguntado agora.
--
-- Sem argumento a função se comporta exatamente como antes (janela aberta dos
-- dois lados), então a Edge Function do sync, que chama sem parâmetro, não muda.

-- `create or replace` com assinatura nova deixaria a versão de 0 argumentos viva
-- ao lado, e aí a chamada sem parâmetro fica ambígua.
drop function if exists public.parametrizacao_contrapartes();

create or replace function public.parametrizacao_contrapartes(
  p_de  date default null,
  p_ate date default null
)
returns table (
  origem     text,
  nome       text,
  documento  text,
  categoria  text,
  cidade     text,
  lancamentos bigint,
  total      numeric,
  primeira   date,
  ultima     date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  cartao as (
    select
      'cartao'::text as origem,
      cl.estabelecimento as nome,
      null::text as documento,
      mode() within group (order by cl.categoria) as categoria,
      mode() within group (order by cl.cidade) as cidade,
      count(*)::bigint as lancamentos,
      round(sum(abs(cl.valor)), 2) as total,
      min(cl.data) as primeira,
      max(cl.data) as ultima
    from public.cartao_lancamentos cl
    where coalesce(btrim(cl.estabelecimento), '') <> ''
      and coalesce(cl.categoria, '') not in ('Pagamento da fatura', 'Tarifas e impostos do cartão')
      and upper(btrim(cl.estabelecimento)) not in ('PAGAMENTO DE FATURA', 'IOF')
      and (p_de  is null or cl.data >= p_de)
      and (p_ate is null or cl.data <= p_ate)
    group by cl.estabelecimento
  ),
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from public.omie_cache, lateral jsonb_array_elements(dados) c
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
    from public.omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det,
           to_date(nullif(coalesce(m->'detalhes'->>'dDtRegistro', m->'detalhes'->>'dDtEmissao'), ''), 'DD/MM/YYYY') as dt
    from public.omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  omie as (
    select
      'omie'::text as origem,
      coalesce(nullif(btrim(cli.nome), ''), f.nome) as nome,
      mode() within group (order by nullif(det->>'cCPFCNPJCliente', '')) as documento,
      mode() within group (order by coalesce(c.descricao, det->>'cCodCateg')) as categoria,
      null::text as cidade,
      count(*)::bigint as lancamentos,
      round(sum(abs((det->>'nValorTitulo')::numeric)), 2) as total,
      min(dt) as primeira,
      max(dt) as ultima
    from mov
    left join cli on cli.codigo = det->>'nCodCliente'
    left join cat c on c.codigo = det->>'cCodCateg'
    left join public.lib_fornecedores f
      on regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') =
         regexp_replace(coalesce(det->>'cCPFCNPJCliente', ''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> ''
    where upper(coalesce(det->>'cNatureza', 'R')) similar to '(P|D)%'
      and coalesce(c.descricao, '') not ilike 'transfer%'
      and not (
        lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%cart%o%'
        and (lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%lancamento%'
          or lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%lançamento%'
          or lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%fatura%')
      )
      and coalesce(nullif(btrim(cli.nome), ''), f.nome) is not null
      -- Título sem data legível fica de fora quando há janela, e dentro quando
      -- não há: numa fila "de julho" ele não tem como provar que é de julho.
      and (p_de  is null or (dt is not null and dt >= p_de))
      and (p_ate is null or (dt is not null and dt <= p_ate))
    group by 2
  ),
  tudo as (
    select * from cartao
    union all
    select * from omie
  )
  select t.* from tudo t
  where not exists (
    select 1 from public.lib_fornecedores f
     where f.status = 'ignorado'
       and (upper(btrim(f.nome)) = upper(btrim(t.nome))
         or exists (
              select 1 from public.contrapartes_alias a
               where a.fornecedor_id = f.id
                 and upper(btrim(a.alias)) = upper(btrim(t.nome))
            ))
  );
$$;

comment on function public.parametrizacao_contrapartes(date, date) is
  'Candidatos a apelido dentro de uma janela de datas. Sem argumento = tudo. O corte entra ANTES do group by, então `total` é o valor DA JANELA e a barra de cobertura fala do período escolhido.';

revoke all on function public.parametrizacao_contrapartes(date, date) from public, anon;
grant execute on function public.parametrizacao_contrapartes(date, date) to authenticated, service_role;
