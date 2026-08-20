-- "NFS-e rejeitada" existia em todo lugar, menos onde é decidido.
--
-- A tela tem o tipo, o rótulo, a ajuda, o card de KPI, o filtro, a regra que
-- bloqueia a emissão e até um teste para a situação `nota_rejeitada` — e o SQL
-- NUNCA a produzia. Faltando o ramo, toda OS faturada sem número de nota caía em
-- `em_processamento`, cuja ajuda na tela promete: "o próximo 'Atualizar do Omie'
-- resolve sozinho". Para as 277 recusadas pela prefeitura desde junho, isso é
-- falso — e é falso do jeito mais caro: são R$ 97 mil de receita faturada sem
-- nota válida, escondidos atrás de um rótulo que pede paciência. O card de
-- rejeitadas, enquanto isso, mostrava zero.
--
-- O QUE SEPARA UMA DA OUTRA. Não a idade, que seria um palpite: a MENSAGEM da
-- prefeitura, que agora é gravada em `nf_os_omie.nfse_mensagem`. Recusa escrita é
-- prova de recusa; sem mensagem, o RPS pode mesmo estar a caminho e continua em
-- processamento. Fica de fora, de propósito, a faixa cinzenta das 60 OS que estão
-- presas há meses sem mensagem nenhuma — para essas, dizer "rejeitada" seria
-- inventar um motivo que o Omie não deu.

create or replace function public.notas_fiscais_painel(p_de date, p_ate date)
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
         -- Faturada, sem nota, e com a recusa escrita pela prefeitura: rejeitada.
         when coalesce(oe.faturada, oh.faturada)
          and coalesce(oe.nfse_mensagem, oh.nfse_mensagem) is not null then 'nota_rejeitada'
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
