/* ============================================================================
 * Notas Fiscais — o painel cabendo no tempo.
 *
 * A tela abria com "canceling statement due to statement timeout". A primeira
 * versão do `notas_fiscais_painel` levava 23 s num mês de 3.465 cobranças.
 * Foram TRÊS gargalos empilhados, e vale registrar os três porque só o último
 * era óbvio depois de medido:
 *
 * 1. O LATERAL CORRELACIONADO. Para cada cobrança do mês ele varria nf_os_omie
 *    comparando `date_trunc('month', data_previsao)`. date_trunc sobre a coluna
 *    não usa índice, então eram ~3.500 varreduras completas. Virou hash join
 *    contra uma tabela de chave (documento, valor, mês) montada UMA vez.
 *
 * 2. O RECORTE DO MÊS. `coalesce(data_pagamento, data_vencimento) between …` é
 *    expressão, e expressão não casa com índice de coluna — o filtro lia as
 *    ~50.000 cobranças abrindo o jsonb de cada uma. Índice sobre a MESMA
 *    expressão resolveu (23 s → 14 s).
 *
 * 3. O QUE SOBROU, e era o maior: ligar nota a cobrança por `dados->>'payment'`
 *    obrigava a PRODUZIR essa expressão para as 61.000 notas, e produzir
 *    significa ler o jsonb inteiro (1,4 KB por linha). 9,1 s num nó só. Aqui o
 *    índice sobre expressão NÃO ajuda — ele serve para procurar um valor
 *    conhecido, não para calcular o de todas as linhas num join. O que resolve é
 *    materializar a chave numa coluna estreita.
 *
 * Resultado: 23 s → ~0,2 s, com os mesmos números (conferido mês a mês de
 * jun/23 a ago/26).
 *
 * ARMADILHA DE MEDIÇÃO, para quem for repetir: logo depois de adicionar a coluna
 * gerada o tempo SUBIU para 22 s, porque a reescrita da tabela deixou as
 * estatísticas velhas e o planejador escolheu errado. `analyze` antes de
 * concluir que a mudança piorou.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) A chave da nota, materializada
 * ------------------------------------------------------------------
 * Coluna GERADA e não preenchida pelas syncs de propósito: assim vale para as
 * linhas que já existem e para as que `asaas-sync` e `asaas-carga-historica`
 * escreverem depois, sem que nenhuma das duas precise saber que ela existe.
 */
alter table public.asaas_cache
  add column if not exists pagamento_ref text
  generated always as (dados->>'payment') stored;

create index if not exists asaas_cache_pagamento_ref_idx
  on public.asaas_cache (pagamento_ref) where tipo = 'invoice';


/* ------------------------------------------------------------------
 * 2) Os índices dos recortes que o painel faz
 * ------------------------------------------------------------------ */
create index if not exists asaas_cache_payment_competencia_idx
  on public.asaas_cache ((coalesce(data_pagamento, data_vencimento)))
  where tipo = 'payment';

create index if not exists asaas_cache_payment_customer_idx
  on public.asaas_cache ((dados->>'customer')) where tipo = 'payment';

create index if not exists nf_os_omie_heuristica_idx
  on public.nf_os_omie (cnpj_cpf, valor, data_previsao) where cancelada = false;


/* ------------------------------------------------------------------
 * 3) O painel, sem o lateral correlacionado
 * ------------------------------------------------------------------
 * Substitui a definição de 20260818170000_notas_fiscais.sql. A regra de
 * classificação é a MESMA — só o caminho até ela mudou.
 *
 * O `distinct on` de `os_heur` faz dois trabalhos: reduz o custo e evita o
 * fan-out. Sem ele, duas OS iguais do mesmo cliente duplicariam a linha da
 * cobrança na tela.
 */
create or replace function public.notas_fiscais_painel(p_de date, p_ate date)
returns table (
  id_asaas text, descricao text, cliente_asaas text, cnpj_cpf text,
  valor numeric, data_vencimento date, data_pagamento date, status_asaas text,
  estornado boolean, nf_asaas_status text, nf_asaas_numero text,
  n_cod_os bigint, os_etapa text, os_faturada boolean,
  nfse_numero text, nfse_status text, nfse_xml text, situacao text
)
language sql stable security invoker set search_path = public as $$
with cfg as (select data_corte from public.nf_config where id = 1),
cob as (
  select c.id_asaas,
         c.dados->>'description' as descricao,
         c.dados->>'customer'    as cus,
         c.valor, c.data_vencimento, c.data_pagamento, c.status,
         (c.status in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS')
          or (jsonb_typeof(c.dados->'refunds') = 'array'
              and jsonb_array_length(c.dados->'refunds') > 0)) as estornado,
         (c.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) as recebida,
         date_trunc('month', coalesce(c.data_vencimento, c.data_pagamento))::date as mes
  from public.asaas_cache c
  where c.tipo = 'payment'
    and coalesce(c.data_pagamento, c.data_vencimento) between p_de and p_ate
),
-- Só os clientes citados pelas cobranças do mês, e não os 6.247.
cli as (
  select c.id_asaas,
         regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         coalesce(c.dados->>'name', c.dados->>'company') as nome
  from public.asaas_cache c
  where c.tipo = 'customer'
    and c.id_asaas in (select cus from cob where cus is not null)
),
nfa as (
  select distinct on (n.pagamento_ref)
         n.pagamento_ref as pay, n.status, n.dados->>'number' as numero
  from public.asaas_cache n
  where n.tipo = 'invoice'
    and n.pagamento_ref in (select id_asaas from cob)
  -- Uma cobrança pode ter nota cancelada e nota autorizada; vale a autorizada.
  order by n.pagamento_ref,
           case upper(n.status) when 'AUTHORIZED' then 0 when 'ERROR' then 1 else 2 end,
           n.data_efetiva desc nulls last
),
os_exato as (
  select c_cod_int_os, n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml
  from public.nf_os_omie
  where cancelada = false and c_cod_int_os is not null and c_cod_int_os <> ''
),
os_heur as (
  select distinct on (cnpj_cpf, valor, date_trunc('month', data_previsao))
         cnpj_cpf, valor,
         date_trunc('month', data_previsao)::date as mes,
         n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml
  from public.nf_os_omie
  where cancelada = false
    and (c_cod_int_os is null or c_cod_int_os = '')
    and cnpj_cpf is not null and data_previsao is not null
  order by cnpj_cpf, valor, date_trunc('month', data_previsao), n_cod_os
)
select cob.id_asaas, cob.descricao, cli.nome, cli.doc, cob.valor,
       cob.data_vencimento, cob.data_pagamento, cob.status, cob.estornado,
       nfa.status, nfa.numero,
       coalesce(oe.n_cod_os, oh.n_cod_os),
       coalesce(oe.etapa, oh.etapa),
       coalesce(oe.faturada, oh.faturada),
       coalesce(oe.nfse_numero, oh.nfse_numero),
       coalesce(oe.nfse_status, oh.nfse_status),
       coalesce(oe.nfse_xml, oh.nfse_xml),
       case
         when not cob.recebida and not cob.estornado then 'nao_exige'
         when cob.estornado and (coalesce(oe.nfse_status, oh.nfse_status) = '004'
              or upper(coalesce(nfa.status,'')) = 'AUTHORIZED') then 'nota_a_cancelar'
         when not cob.recebida then 'nao_exige'
         when coalesce(oe.nfse_status, oh.nfse_status) = '004' then 'emitida_omie'
         when coalesce(oe.faturada, oh.faturada) then 'em_processamento'
         when upper(coalesce(nfa.status,'')) = 'AUTHORIZED'
          and coalesce(cob.data_pagamento, cob.data_vencimento) < (select data_corte from cfg)
              then 'emitida_asaas'
         else 'falta'
       end
from cob
left join cli on cli.id_asaas = cob.cus
left join nfa on nfa.pay = cob.id_asaas
left join os_exato oe on oe.c_cod_int_os = cob.id_asaas
left join os_heur  oh on oe.n_cod_os is null
                     and oh.cnpj_cpf = cli.doc
                     and oh.valor = cob.valor
                     and oh.mes = cob.mes;
$$;


/* ------------------------------------------------------------------
 * 4) O painel em JSONB — uma execução por abertura de tela
 * ------------------------------------------------------------------
 * A tela lia o painel em páginas de 1.000 por causa do teto do PostgREST, e
 * cada página REEXECUTAVA a função inteira: quatro vezes o mesmo trabalho para
 * o mesmo mês. Um jsonb é um valor único — não sofre o teto e roda uma vez.
 */
create or replace function public.notas_fiscais_painel_json(p_de date, p_ate date)
returns jsonb
language sql stable security invoker set search_path = public as $$
select coalesce(jsonb_agg(to_jsonb(p) order by p.data_vencimento desc nulls last), '[]'::jsonb)
from public.notas_fiscais_painel(p_de, p_ate) p;
$$;

revoke all on function public.notas_fiscais_painel(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel(date, date) to authenticated, service_role;

revoke all on function public.notas_fiscais_painel_json(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel_json(date, date) to authenticated, service_role;
