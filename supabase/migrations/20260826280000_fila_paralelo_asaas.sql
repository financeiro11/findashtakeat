-- O período de paralelo: o Asaas emite o que é dele, o Hub emite o que é dele.
--
-- Enquanto os dois emitem, a fila do Hub tem de excluir tudo que o Asaas pretende
-- emitir — e "pretende" é a palavra difícil, porque o objeto `invoice` do Asaas
-- nasce com até 29 dias de atraso (medido; p90 de 21 dias). Ausência de nota não
-- prova nada: em julho, mês assentado, só 16 de 2.498 cobranças recebidas ficaram
-- sem nota nenhuma.
--
-- O sinal que prova é `asaas_nf_config.tem_config`, lido de
-- `GET /subscriptions/{id}/invoiceSettings`: 200 = o Asaas emite, 404 = não emite.
-- Sondadas 2.040 assinaturas em 26/08/26: **1.880 do Asaas, 160 do Hub**.
--
-- SÓ COBRANÇA DE ASSINATURA ENTRA. Para avulsa não existe sinal equivalente
-- (`/payments/{id}/invoiceSettings` dá 404 até em cobrança que o Asaas emitiu), e
-- medir resolveu a dúvida: **99,5% das avulsas de jun–jul receberam nota do
-- Asaas**. Incluí-las seria quase pura duplicação.
--
-- ISTO É TEMPORÁRIO E TEM INTERRUPTOR. `nf_config.paralelo_asaas` desliga a regra
-- inteira no dia em que o Asaas parar de emitir — sem ele, esta restrição viraria
-- lei silenciosa e o Hub deixaria de emitir 95% do que deveria, para sempre.

alter table public.nf_config
  add column if not exists paralelo_asaas boolean not null default true;

comment on column public.nf_config.paralelo_asaas is
  'true = Asaas e Hub emitindo juntos: a fila só aceita assinatura sem configuração de NF no Asaas. Desligar quando o Asaas for desligado.';

create or replace function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table(id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date,
              email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, status_asaas text, estornado boolean)
language sql
stable
set search_path to 'public'
as $function$
with cfg as (select data_corte, paralelo_asaas from public.nf_config where id = 1),
cli as (
  select id_asaas,
         regexp_replace(coalesce(dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
),
omie_cli as (
  select regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') as doc,
         min((c->>'codigo')::bigint) as codigo
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
    and regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') <> ''
  group by 1
),
cob as (
  select c.id_asaas,
         c.dados->>'description'  as descricao,
         c.dados->>'customer'     as cus,
         c.dados->>'subscription' as assinatura,
         c.valor, c.data_vencimento, c.data_pagamento,
         c.status, c.dados,
         coalesce(c.data_pagamento, c.data_vencimento) as competencia,
         exists (select 1 from public.estornos_asaas e where e.id_pagamento = c.id_asaas) as estorno_registrado
  from public.asaas_cache c
  where c.tipo = 'payment'
    and c.valor > 0
    and coalesce(c.data_pagamento, c.data_vencimento) >= (select data_corte from cfg)
    and coalesce(c.data_pagamento, c.data_vencimento) <= current_date
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os,
       cob.status,
       cob.estorno_registrado
         or (jsonb_typeof(cob.dados->'refunds') = 'array' and jsonb_array_length(cob.dados->'refunds') > 0)
from cob
join cli on cli.id_asaas = cob.cus
join omie_cli oc on oc.doc = cli.doc
left join public.asaas_nf_config nfc on nfc.assinatura = cob.assinatura
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  where o.cancelada = false and o.c_cod_int_os = cob.id_asaas
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  and public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado) is null
  and (os.n_cod_os is null or os.faturada is not true)
  /* O PARALELO. Enquanto ligado, só entra cobrança de assinatura que o Asaas
   * declarou não emitir. `tem_config is null` (não sondada) NÃO entra: no escuro
   * a resposta certa é não emitir, porque o erro caro é a nota dupla. */
  and (
    not (select paralelo_asaas from cfg)
    or (cob.assinatura is not null and nfc.tem_config is false)
  )
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
      and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  )
  /* Qualquer nota do Asaas para ESTA cobrança — em qualquer situação, não só
   * autorizada. SCHEDULED é o Asaas dizendo "vou emitir", e ERROR é "tentei";
   * nos dois casos a cobrança é dele, e a decisão de assumir os erros dele é
   * humana, não da fila. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from anon;
