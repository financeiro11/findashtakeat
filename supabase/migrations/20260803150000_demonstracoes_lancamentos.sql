-- Drill-down de auditoria: os lançamentos do Omie que compõem uma célula da
-- DRE/DFC (rubrica × mês).
--
-- POR QUE UMA FUNÇÃO NO BANCO, E NÃO UMA EDGE FUNCTION:
-- a atribuição lançamento → rubrica hoje mora dentro do laço do `omie-sync`.
-- Reproduzi-la aqui foi conferido contra os dados reais: em Jul-26 (mês de Omie
-- puro, sem tracker por cima) TODA rubrica mapeada fecha no centavo com o valor
-- gravado em `demonstracoes_contabeis`. As únicas divergências são "Fluxo de
-- Caixa Operacional", "Fluxo Livre" e "Cashburn 12M", que são totais calculados
-- e não vêm de lançamento nenhum. Isso permite entregar a auditoria sem
-- redeployar o omie-sync, que é o job diário e pesado.
--
-- SECURITY DEFINER de propósito: `omie_cache` tem RLS ligado e nenhuma policy —
-- o dump bruto do Omie (443 kB, a empresa inteira) não é exposto ao cliente.
-- Esta função devolve só a fatia de uma rubrica num mês, que é exatamente o que
-- a tela já mostra somado. `search_path` fixo para o definer não ser sequestrado.
--
-- ATENÇÃO A QUEM FOR MEXER: se a regra de atribuição do omie-sync mudar (campos
-- de data, sinal por natureza, chave do DE_PARA), esta função precisa mudar
-- junto ou o drill-down passa a mentir. O painel soma os lançamentos e compara
-- com a célula justamente para essa divergência aparecer em vez de passar batido.

create or replace function public.demonstracoes_lancamentos(
  p_tipo    text,   -- 'dre' (competência) | 'dfc' (caixa)
  p_rubrica text,
  p_mes     text    -- chave de coluna, ex.: 'Jul-26'
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
  valor               numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  -- Mesmo `norm` do omie-sync: sem acento, espaços colapsados, minúsculo.
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
      det,
      -- Natureza "P" (pagar) ou "D" vira saída; o resto é entrada.
      case when upper(coalesce(det->>'cNatureza','R')) similar to '(P|D)%' then -1 else 1 end as sinal,
      -- DRE é competência, DFC é caixa: cadeia de fallback igual à do omie-sync.
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
    f.nome as contraparte,
    nullif(b.det->>'cCPFCNPJCliente','') as cnpj_cpf,
    b.codigo as categoria_codigo,
    coalesce(c.descricao, b.codigo) as categoria_descricao,
    nullif(b.det->>'cGrupo','') as grupo,
    nullif(b.det->>'cStatus','') as status,
    b.sinal * abs(b.bruto) as valor
  from base b
  left join cat c on c.codigo = b.codigo
  -- Nome da contraparte não vem no movimento (só código e CPF/CNPJ); quando o
  -- fornecedor está na Biblioteca, casa pelo documento só com os dígitos.
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
    -- 42% dos registros do cache (3.748 de 8.924) não têm `nValorTitulo`: são
    -- movimentos de conta corrente (têm `nCodMovCC`), a perna bancária do mesmo
    -- título que já aparece na lista. O omie-sync lê só `nValorTitulo`, então
    -- eles valem ZERO no demonstrativo — listá-los encheria a auditoria de
    -- linhas de R$ 0,00 duplicando o título de cima. Como valem zero, tirá-los
    -- não mexe na soma, e o confronto com a célula continua fechando.
    and b.bruto is not null
    -- Mesma janela padrão do omie-sync: 1º de janeiro do ano passado até hoje.
    and b.dt >= (date_trunc('year', current_date) - interval '1 year')::date
    and b.dt <= current_date
    -- Chave de mês montada na mão: `to_char(d,'Mon')` depende de lc_time e
    -- quebraria a comparação se o locale do banco mudasse.
    and (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
          [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY') = p_mes
  order by b.dt, abs(b.bruto) desc;
$$;

revoke all on function public.demonstracoes_lancamentos(text, text, text) from public;
grant execute on function public.demonstracoes_lancamentos(text, text, text) to authenticated;
