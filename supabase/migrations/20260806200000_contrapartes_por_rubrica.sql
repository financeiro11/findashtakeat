/* ============================================================================
 * O fornecedor é novo? Gastou mais ou menos que no mês passado?
 *
 * O drill-down da DRE/DFC lista lançamento a lançamento, e é aí que se olha o
 * fornecedor — mas a lista sozinha não responde a única pergunta que se faz
 * olhando para ela: "isso já estava aqui mês passado?". Responder exige o mesmo
 * corte do mês anterior, e quem já sabe fazer esse corte é
 * `demonstracoes_contrapartes` (rubrica × mês × contraparte), que hoje alimenta
 * as justificativas de variação.
 *
 * Em vez de escrever uma segunda função para o painel, esta migration ENSINA A
 * QUE JÁ EXISTE a fazer as duas coisas. Duplicá-la seria duplicar também a
 * regra de atribuição do omie-sync, o nome limpo do cadastro e o casamento do
 * lojista do cartão — três regras que já moram em dois lugares e que, quando
 * discordam, fazem a tela e o comentário do tracker falarem números diferentes
 * sobre o mesmo fornecedor.
 *
 * Duas mudanças, ambas aditivas:
 *
 *   p_rubrica (opcional) — o painel abre UMA rubrica e pede vários meses; sem o
 *     filtro ele receberia a empresa inteira (2.396 linhas em 7 meses) para usar
 *     4. Com o filtro o corte acontece no `join` do DE-PARA, antes de agrupar.
 *     Nulo = comportamento de hoje, que é como `demonstracoes-justificar` chama.
 *
 *   cods — os `nCodTitulo` que compõem aquela contraparte naquele mês. É o que
 *     liga cada linha do drill-down ao seu fornecedor SEM casar por nome. Casar
 *     por nome quebraria justamente no cartão: ali o drill-down mostra o lojista
 *     lido da observação do título (`omie_titulo_texto`, buscada no Omie depois
 *     que o painel abre) e esta função mostra o lojista casado por valor contra
 *     a fatura — mesmo nome quando os dois resolvem, mas a observação chega
 *     segundos depois e "Lancamento Fatura Cartao" não casa com "DATADOG".
 *     Pelo código do título o vínculo é exato e vale desde o primeiro frame.
 * ========================================================================== */

-- Mudou a lista de colunas de retorno e a assinatura: CREATE OR REPLACE não
-- passa. O DROP é seguro porque não há view nem função dependente — os dois
-- consumidores (edge `demonstracoes-justificar` e o painel) chamam por RPC.
drop function if exists public.demonstracoes_contrapartes(text, text[]);

create function public.demonstracoes_contrapartes(
  p_tipo    text,
  p_meses   text[],
  p_rubrica text default null   -- null = todas as rubricas (uso das justificativas)
)
returns table (
  rubrica     text,
  mes         text,
  contraparte text,
  categoria   text,
  valor       numeric,
  lancamentos integer,
  cods        text[]
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
  -- Nome limpo do cadastro: MEI e autônomo vêm da Receita com o documento
  -- embutido na razão social.
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
        case when cli.nome is null and f.nome is null and nullif(d.det->>'cCPFCNPJCliente','') is null
          then nullif(btrim(d.det->>'cDescricao'), '')
          else null
        end,
        nullif(d.det->>'cCPFCNPJCliente',''),
        'Sem contraparte'
      )                                                 as contraparte,
      coalesce(c.descricao, d.codigo)                   as categoria,
      d.sinal * abs(d.bruto)                            as valor,
      d.det->>'nCodTitulo'                              as cod_titulo,
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
    -- varrida uma vez por movimento do mês inteiro.
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
     -- O corte por rubrica entra AQUI, no join, e não num filtro depois do
     -- group by: é o que evita agrupar a empresa inteira para devolver quatro
     -- fornecedores.
     and (p_rubrica is null or dp.rubrica = p_rubrica)
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
        then coalesce(lb.lojista, 'Cartão (lojista não identificado)')
        else lb.contraparte
      end as contraparte,
      lb.categoria,
      lb.valor,
      lb.cod_titulo
    from linhas_base lb
  )
  select
    l.rubrica,
    l.mes,
    l.contraparte,
    -- Uma contraparte pode aparecer em mais de uma categoria dentro da mesma
    -- rubrica; mostra a que mais pesou, que é a que explica o número.
    (array_agg(l.categoria order by abs(l.valor) desc))[1]     as categoria,
    sum(l.valor)::numeric                                      as valor,
    count(*)::integer                                          as lancamentos,
    -- `filter` porque um título sem código viraria um NULL dentro do array e o
    -- cliente casaria "nenhum" com "todos".
    array_agg(l.cod_titulo) filter (where l.cod_titulo is not null) as cods
  from linhas l
  group by l.rubrica, l.mes, l.contraparte
  order by l.rubrica, l.mes, abs(sum(l.valor)) desc;
$$;

revoke all on function public.demonstracoes_contrapartes(text, text[], text) from public;
revoke all on function public.demonstracoes_contrapartes(text, text[], text) from anon;
grant execute on function public.demonstracoes_contrapartes(text, text[], text) to authenticated;
grant execute on function public.demonstracoes_contrapartes(text, text[], text) to service_role;

-- A assinatura mudou: sem o reload o PostgREST continua anunciando a de dois
-- argumentos e o painel leva 404 até o cache expirar sozinho.
notify pgrst, 'reload schema';
