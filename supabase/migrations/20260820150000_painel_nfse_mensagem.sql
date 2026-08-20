-- O painel passa a carregar o MOTIVO da recusa junto com o status.
--
-- Antes, "NFS-e rejeitada" na tela era um beco: a pessoa via que a prefeitura
-- recusou e não tinha como saber o que consertar sem abrir o Omie e procurar OS
-- por OS. O motivo já estava sendo lido do `StatusOS` e agora fica gravado em
-- `nf_os_omie.nfse_mensagem` — falta entregá-lo à tela.
--
-- Nas 277 presas, o motivo é quase sempre acionável e quase nunca fiscal:
--   158  E0240 - CEP do tomador nao existe / nao pertence ao municipio
--    34  403 Forbidden do webservice da prefeitura
--    24  E0921/E0922 - codigo do municipio do tomador
--
-- `create or replace` NÃO serve aqui: mudar a lista de colunas de um RETURNS
-- TABLE é mudar o tipo de retorno, e o Postgres recusa. Por isso o drop explícito
-- das duas (a de JSONB depende da outra) e a recriação inteira — e, com ela, a
-- repetição dos grants: função recriada em `public` volta a nascer chamável pelo
-- anon, e este painel é de usuário logado.

drop function if exists public.notas_fiscais_painel_json(date, date);
drop function if exists public.notas_fiscais_painel(date, date);

create function public.notas_fiscais_painel(p_de date, p_ate date)
returns table (
  id_asaas text, descricao text, cliente_asaas text, cnpj_cpf text,
  valor numeric, data_vencimento date, data_pagamento date, status_asaas text,
  estornado boolean, nf_asaas_status text, nf_asaas_numero text,
  n_cod_os bigint, os_etapa text, os_faturada boolean,
  nfse_numero text, nfse_status text, nfse_xml text, nfse_mensagem text, situacao text
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
  select c_cod_int_os, n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml, nfse_mensagem
  from public.nf_os_omie
  where cancelada = false and c_cod_int_os is not null and c_cod_int_os <> ''
),
os_heur as (
  select distinct on (cnpj_cpf, valor, date_trunc('month', data_previsao))
         cnpj_cpf, valor,
         date_trunc('month', data_previsao)::date as mes,
         n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml, nfse_mensagem
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
       coalesce(oe.nfse_mensagem, oh.nfse_mensagem),
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

create function public.notas_fiscais_painel_json(p_de date, p_ate date)
returns jsonb
language sql stable security invoker set search_path = public as $$
select coalesce(jsonb_agg(to_jsonb(p) order by p.data_vencimento desc nulls last), '[]'::jsonb)
from public.notas_fiscais_painel(p_de, p_ate) p;
$$;

revoke all on function public.notas_fiscais_painel(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel(date, date) to authenticated, service_role;

revoke all on function public.notas_fiscais_painel_json(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel_json(date, date) to authenticated, service_role;
