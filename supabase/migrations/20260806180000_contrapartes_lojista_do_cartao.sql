/* ============================================================================
 * Quem move a rubrica, quando quem move é o CARTÃO.
 *
 * `demonstracoes_contrapartes` alimenta as justificativas de variação. Todo gasto
 * pago no cartão chega dela com a mesma contraparte — "Lancamento Fatura Cartao",
 * o balde da fatura no ERP —, então uma rubrica inteira podia ser explicada por
 * uma linha que não diz nada. Foi o que aconteceu com Servidor em Jul/26:
 *
 *   Ingram   -81.194,42 → -79.450,54   (caiu 1,7k)
 *   Cartão   -23.882,84 → -60.552,90   (subiu 36,7k)  ← toda a variação
 *
 * O cartão subiu porque o DATADOG entrou: 49.443,10 em seis compras, contra zero
 * no mês anterior. Esse nome nunca esteve no Omie, mas está no banco desde o
 * import do OFX, em `cartao_lancamentos`.
 *
 * O casamento é por VALOR EXATO dentro de uma janela de data — mesmo critério do
 * `_shared/match-cartao.ts`, que já liga fatura e ERP para categorizar e anexar
 * comprovante. Aqui ele é deliberadamente mais covarde: só troca o nome quando o
 * valor aponta para UM lojista. Valor repetido (IOF, Uber, corrida de R$ 12) fica
 * com o balde mesmo — nome errado num comentário que vai para o tracker é pior do
 * que nome genérico.
 *
 * A janela é assimétrica porque a compra SEMPRE vem antes do título: a fatura
 * fecha no fim do mês e o Omie registra o lançamento no fechamento (DRE) ou no
 * pagamento, já no mês seguinte (DFC).
 * ========================================================================== */

-- O casamento é por valor arredondado; sem o índice de expressão cada título de
-- cartão varre a fatura inteira.
create index if not exists cartao_lancamentos_valor2_idx
  on public.cartao_lancamentos (round(valor, 2));

create or replace function public.demonstracoes_contrapartes(
  p_tipo  text,
  p_meses text[]
)
returns table (
  rubrica     text,
  mes         text,
  contraparte text,
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
  -- Mesma limpeza de nome do drill-down: MEI e autônomo vêm da Receita com o
  -- documento embutido na razão social.
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
  ),
  -- Chave de mês montada à mão (e não com to_char(dt,'Mon')) para não depender
  -- do locale do servidor — mesma razão do drill-down.
  datado as (
    select
      b.*,
      (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
        [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY') as mes_key
    from base b
    where b.dt is not null
      -- Sem `nValorTitulo` é a perna bancária do mesmo título: vale zero aqui.
      and b.bruto is not null
  ),
  linhas_base as (
    select
      dp.rubrica                                        as rubrica,
      d.mes_key                                         as mes,
      coalesce(
        nullif(btrim(cli.nome), ''),
        f.nome,
        -- Quando é lançamento de cartão (cli=null, f=null, sem documento),
        -- usa a descrição do Omie em vez de "Lancamento Fatura Cartao"
        case when cli.nome is null and f.nome is null and nullif(d.det->>'cCPFCNPJCliente','') is null
          then nullif(btrim(d.det->>'cDescricao'), '')
          else null
        end,
        nullif(d.det->>'cCPFCNPJCliente',''),
        'Sem contraparte'
      )                                                 as contraparte,
      coalesce(c.descricao, d.codigo)                   as categoria,
      d.sinal * abs(d.bruto)                            as valor,
      loja.lojista                                      as lojista
    from datado d
    left join cat c on c.codigo = d.codigo
    left join cli on cli.codigo = d.det->>'nCodCliente'
    left join lib_fornecedores f
      on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
         regexp_replace(coalesce(d.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
    -- O lojista por trás do balde da fatura. `count(distinct)=1` é o que impede
    -- o chute: dois lojistas com o mesmo valor na janela, ninguém é nomeado.
    --
    -- A primeira condição não olha `cl`: é o portão. Sem ela a fatura seria
    -- varrida uma vez por movimento do mês inteiro — 7,9s por chamada, contra
    -- 1,4s procurando só onde o nome é o balde do cartão.
    left join lateral (
      select case when count(distinct cl.estabelecimento) = 1
                  then min(cl.estabelecimento) end as lojista
      from cartao_lancamentos cl
      where lower(unaccent(coalesce(nullif(btrim(cli.nome), ''), d.det->>'cDescricao', ''))) like '%cartao%'
        and round(cl.valor, 2) = round(abs(d.bruto), 2)
        and cl.data between d.dt - interval '75 days' and d.dt + interval '10 days'
    ) loja on true
    join omie_dre_mapa dp
      on dp.ativo is not false
     and dp.demonstrativo in (p_tipo, 'ambos')
     and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, d.codigo)), '\s+', ' ', 'g')))
    where d.mes_key = any(p_meses)
  ),
  linhas as (
    select
      lb.rubrica,
      lb.mes,
      -- Só o balde da fatura é substituído. Fornecedor com nome próprio no Omie
      -- continua com o nome do Omie, mesmo que por acaso bata de valor.
      case
        when lower(unaccent(lb.contraparte)) like '%cartao%'
         and (lower(unaccent(lb.contraparte)) like '%lancamento%'
           or lower(unaccent(lb.contraparte)) like '%fatura%')
        -- Sem lojista, o balde é nomeado pelo que ele é. O nome cru do cadastro
        -- ("Lancamento Fatura Cartao") virava, no comentário, o nome da CATEGORIA
        -- — e a nota dizia que "3.4.1. Marketing - Campanhas" subiu 30k, como se
        -- a rubrica fosse fornecedora de si mesma.
        then coalesce(lb.lojista, 'Cartão (lojista não identificado)')
        else lb.contraparte
      end as contraparte,
      lb.categoria,
      lb.valor
    from linhas_base lb
  )
  select
    l.rubrica,
    l.mes,
    l.contraparte,
    -- Uma contraparte pode aparecer em mais de uma categoria dentro da mesma
    -- rubrica; mostra a que mais pesou, que é a que explica o número.
    (array_agg(l.categoria order by abs(l.valor) desc))[1] as categoria,
    sum(l.valor)::numeric                                  as valor,
    count(*)::integer                                      as lancamentos
  from linhas l
  group by l.rubrica, l.mes, l.contraparte
  order by l.rubrica, l.mes, abs(sum(l.valor)) desc;
$$;

revoke all on function public.demonstracoes_contrapartes(text, text[]) from public;
revoke all on function public.demonstracoes_contrapartes(text, text[]) from anon;
grant execute on function public.demonstracoes_contrapartes(text, text[]) to authenticated;
grant execute on function public.demonstracoes_contrapartes(text, text[]) to service_role;

-- `cartao_lancamentos` tem RLS; a função é `security definer` e só devolve o NOME
-- do lojista agregado, nunca a linha da fatura.
