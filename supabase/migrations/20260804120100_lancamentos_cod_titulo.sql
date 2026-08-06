-- Devolve o `nCodTitulo` junto com o lançamento.
--
-- É a chave que o alerta de reclassificação (migration 20260804120000) usa para
-- apontar QUAL linha da lista está fora do padrão. Sem ela, o painel teria de
-- casar alerta e lançamento por nome + valor + data, que é frágil justamente
-- onde precisa ser exato. O campo existe em 100% dos movimentos do Omie e é
-- único por título — conferido no cache: 5.176 títulos em 5.176 linhas.
--
-- O resto do corpo é idêntico ao da migration 20260803210000. Precisa de
-- DROP porque mudar a lista de colunas de retorno não passa em CREATE OR REPLACE.

drop function if exists public.demonstracoes_lancamentos(text, text, text);

create function public.demonstracoes_lancamentos(
  p_tipo    text,
  p_rubrica text,
  p_mes     text
)
returns table (
  data                date,
  vencimento          date,
  titulo              text,
  documento           text,
  contraparte         text,
  cnpj_cpf            text,
  categoria_codigo    text,
  categoria_descricao text,
  grupo               text,
  status              text,
  valor               numeric,
  cod_titulo          text
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
  -- Materializado como CTE (e não lateral por linha) porque são ~6.700 cadastros.
  -- distinct on: código repetido multiplicaria o lançamento no join e quebraria
  -- o fechamento com a célula, que é o que dá valor à auditoria.
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
  base as (
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
  )
  select
    b.dt as data,
    to_date(nullif(b.det->>'dDtVenc',''),'DD/MM/YYYY') as vencimento,
    nullif(b.det->>'cNumTitulo','') as titulo,
    nullif(b.det->>'cNumDocFiscal','') as documento,
    coalesce(nullif(btrim(cli.nome), ''), f.nome) as contraparte,
    nullif(b.det->>'cCPFCNPJCliente','') as cnpj_cpf,
    b.codigo as categoria_codigo,
    coalesce(c.descricao, b.codigo) as categoria_descricao,
    nullif(b.det->>'cGrupo','') as grupo,
    nullif(b.det->>'cStatus','') as status,
    b.sinal * abs(b.bruto) as valor,
    b.det->>'nCodTitulo' as cod_titulo
  from base b
  left join cat c on c.codigo = b.codigo
  left join cli on cli.codigo = b.det->>'nCodCliente'
  left join lib_fornecedores f
    on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
       regexp_replace(coalesce(b.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
   and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
  join omie_dre_mapa dp
    on dp.ativo is not false
   and dp.demonstrativo in (p_tipo, 'ambos')
   and dp.rubrica = p_rubrica
   and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
     = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, b.codigo)), '\s+', ' ', 'g')))
  where b.dt is not null
    -- Registros sem `nValorTitulo` são movimentos de conta corrente, a perna
    -- bancária do mesmo título. Valem zero no demonstrativo.
    and b.bruto is not null
    and b.dt >= (date_trunc('year', current_date) - interval '1 year')::date
    and b.dt <= current_date
    and (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
          [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY') = p_mes
  order by b.dt, abs(b.bruto) desc;
$$;

revoke all on function public.demonstracoes_lancamentos(text, text, text) from public;
grant execute on function public.demonstracoes_lancamentos(text, text, text) to authenticated;
