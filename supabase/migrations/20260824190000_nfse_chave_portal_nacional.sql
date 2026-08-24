-- A chave de acesso da NFS-e já estava no banco. Faltava sair dele.
--
-- O ÚNICO link que a tela oferecia para uma nota era o do XML, e ele é uma URL
-- ASSINADA do CDN do Omie que EXPIRA em ~24h (`xmlAindaVale` no cliente existe só
-- para não mostrar link morto). Ou seja: passado um dia, a nota emitida não tinha
-- endereço nenhum no Hub — conferir uma NFS-e de junho obrigava a abrir o Omie,
-- achar a OS e a nota dentro dela.
--
-- O QUE ESTAVA GUARDADO SEM SER USADO. O `cCodVerif` que o Omie devolve no
-- `ListaRpsNfse` — gravado em `nf_os_omie.nfse_verificacao` — não é o código de
-- verificação curto do padrão ABRASF antigo: no padrão NACIONAL ele é a CHAVE DE
-- ACESSO de 50 dígitos da NFS-e. Nas 408 notas emitidas desde jun/2026 são 408
-- chaves de 50 dígitos, e elas se decodificam:
--
--   3205309  2  2  37511891000150  0000000016902  2608  794739071  0
--   município ambiente
--            tipo insc.  CNPJ         nº da NFS-e  AAMM  cód.num.  DV
--
--   3205309 = Vitória (ES), 37511891000150 = o nosso CNPJ, 16902 = o `nfse_numero`
--   da mesma linha, 2608 = a competência. Confere com o dado ao lado, dígito a
--   dígito — não é palpite.
--
-- COM A CHAVE, A NOTA TEM ENDEREÇO PERMANENTE: o Portal Nacional da NFS-e abre
-- qualquer nota por ela, e o link do DANFSe/QR Code é justamente
-- `nfse.gov.br/consultapublica/?tpc=1&chave=<50 dígitos>`. Quem monta a URL é o
-- cliente (`linkPortalNacional`); daqui sai só o dado.
--
-- POR QUE DROP E NÃO REPLACE: as três funções ganham UMA COLUNA no `returns
-- table`, e o Postgres não troca a assinatura de saída com `create or replace` —
-- recusa com "cannot change return type of existing function". Dropar as duas do
-- painel na ordem certa (a `_json` depende da outra) e recriar é o mesmo caminho
-- que a migration 20260820150000 já usou aqui.

drop function if exists public.notas_fiscais_painel_json(date, date);
drop function if exists public.notas_fiscais_painel(date, date);

create function public.notas_fiscais_painel(p_de date, p_ate date)
returns table (
  id_asaas text, descricao text, cliente_asaas text, cnpj_cpf text,
  valor numeric, data_vencimento date, data_pagamento date, status_asaas text,
  estornado boolean, nf_asaas_status text, nf_asaas_numero text,
  n_cod_os bigint, os_etapa text, os_faturada boolean,
  nfse_numero text, nfse_status text, nfse_xml text, nfse_chave text,
  nfse_mensagem text, situacao text
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
         regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '[^0-9]', '', 'g') as doc,
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
  select c_cod_int_os, n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml,
         nfse_verificacao, nfse_mensagem
  from public.nf_os_omie
  where cancelada = false and c_cod_int_os is not null and c_cod_int_os <> ''
),
os_heur as (
  select distinct on (cnpj_cpf, valor, date_trunc('month', data_previsao))
         cnpj_cpf, valor,
         date_trunc('month', data_previsao)::date as mes,
         n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml,
         nfse_verificacao, nfse_mensagem
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
       coalesce(oe.nfse_verificacao, oh.nfse_verificacao),
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

create function public.notas_fiscais_painel_json(p_de date, p_ate date)
returns jsonb
language sql stable security invoker set search_path = public as $$
select coalesce(jsonb_agg(to_jsonb(p) order by p.data_vencimento desc nulls last), '[]'::jsonb)
from public.notas_fiscais_painel(p_de, p_ate) p;
$$;

-- O rastro da emissão mostra "NFS-e 16902" e mandava procurar esse número à mão.
-- A chave vem da OS do evento, e SÓ quando o número da nota gravada na OS é o
-- mesmo que o evento registrou: o diário é append-only e uma OS refaturada teria
-- a chave da nota NOVA ao lado do número da VELHA — link certo apontando para a
-- nota errada é pior do que nenhum link.
drop function if exists public.notas_fiscais_log(integer, integer);

create function public.notas_fiscais_log(p_dias integer default 14, p_limite integer default 300)
returns table (
  criado_em timestamptz, id_asaas text, cliente text, valor numeric,
  acao text, resultado text, nfse_numero text, nfse_chave text,
  motivo text, operador text, n_cod_os bigint
)
language sql stable security invoker set search_path = public as $$
select e.criado_em, e.id_asaas,
       coalesce(c.dados->>'name', c.dados->>'company', '—') as cliente,
       p.valor, e.acao, e.resultado, e.nfse_numero,
       case when e.nfse_numero is not null and o.nfse_numero = e.nfse_numero
            then o.nfse_verificacao end,
       e.erro, e.operador, e.n_cod_os
from public.nf_emissoes e
left join public.asaas_cache p on p.tipo = 'payment' and p.id_asaas = e.id_asaas
left join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
left join public.nf_os_omie o on o.n_cod_os = e.n_cod_os
where e.criado_em >= now() - make_interval(days => greatest(p_dias, 1))
order by e.criado_em desc
limit greatest(p_limite, 1);
$$;

-- Função nova nasce chamável por `anon` no Supabase (o grant é automático), e
-- estas leem receita, cliente e CNPJ. O revoke vem uma a uma de propósito:
-- em bloco, um nome errado derruba a lista inteira em silêncio.
revoke all on function public.notas_fiscais_painel(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel(date, date) to authenticated, service_role;

revoke all on function public.notas_fiscais_painel_json(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel_json(date, date) to authenticated, service_role;

revoke all on function public.notas_fiscais_log(integer, integer) from public, anon;
grant execute on function public.notas_fiscais_log(integer, integer) to authenticated, service_role;
