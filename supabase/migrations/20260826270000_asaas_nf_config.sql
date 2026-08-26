-- De quem é a nota: do Asaas ou do Hub. Para os dois emitirem em paralelo.
--
-- O PERÍODO DE PARALELO existe para ganhar confiança antes de desligar o Asaas:
-- ele segue emitindo o que sempre emitiu, o Hub emite o resto, e ninguém emite a
-- mesma nota duas vezes. O problema é que "ninguém emitiu ainda" NÃO é sinal de
-- "ninguém vai emitir": medido em 26/08/26, o Asaas cria a nota com até **29
-- dias** de atraso (mediana 0, p90 21 dias), e em julho — mês já assentado — só
-- 16 de 2.498 cobranças recebidas ficaram sem nota nenhuma. Emitir pelo Hub o
-- que "ainda não tem nota" produziria nota dupla em massa.
--
-- O SINAL QUE VALE. `GET /subscriptions/{id}/invoiceSettings` responde 200 com a
-- configuração quando o Asaas emite para aquela assinatura, e **404** quando não.
-- É definitivo e vem antes do fato. Sondado com controle em 26/08/26: assinatura
-- que já gerou nota autorizada devolve 200 (`invoiceCreationPeriod:
-- ON_PAYMENT_CONFIRMATION`); assinatura que nunca gerou devolve 404.
--
-- NÃO EXISTE EQUIVALENTE PARA COBRANÇA AVULSA. `/payments/{id}/invoiceSettings`
-- devolve 404 até para cobrança cuja nota o Asaas autorizou — sondado nas duas
-- pontas. Por isso o paralelo cobre só cobrança de ASSINATURA: nas avulsas a
-- única conferência possível é ao vivo, no instante da emissão, e isso é uma
-- corrida, não uma garantia. Elas voltam quando o Asaas for desligado de vez.

create table if not exists public.asaas_nf_config (
  assinatura   text primary key,
  -- true  = o Asaas emite (200). A nota é dele; o Hub não toca.
  -- false = 404. A nota é do Hub.
  -- null  = ainda não sondada. NÃO EMITE: no escuro, a resposta certa é não.
  tem_config   boolean,
  periodo      text,
  lido_em      timestamptz not null default now(),
  erro         text
);

create index if not exists asaas_nf_config_sem_config_idx
  on public.asaas_nf_config (tem_config) where tem_config = false;

alter table public.asaas_nf_config enable row level security;
create policy asaas_nf_config_leitura
  on public.asaas_nf_config for select to authenticated using (true);
revoke all on public.asaas_nf_config from anon;

/* As assinaturas que ainda faltam sondar, das que têm cobrança recente. Sondar
 * as 3.135 do cadastro seria gastar chamada com assinatura morta. */
create or replace function public.asaas_assinaturas_a_sondar(p_limite integer default 100)
returns table(assinatura text, cobrancas integer, ultima date)
language sql
stable
set search_path to 'public'
as $function$
  select p.dados->>'subscription' as assinatura,
         count(*)::int as cobrancas,
         max(coalesce(p.data_pagamento, p.data_vencimento)) as ultima
  from public.asaas_cache p
  where p.tipo = 'payment' and p.valor > 0
    and p.dados->>'subscription' is not null
    and coalesce(p.data_pagamento, p.data_vencimento) >= current_date - 90
    and not exists (
      select 1 from public.asaas_nf_config c
      where c.assinatura = p.dados->>'subscription' and c.tem_config is not null
    )
  group by 1
  order by max(coalesce(p.data_pagamento, p.data_vencimento)) desc
  limit greatest(p_limite, 0);
$function$;

revoke all on function public.asaas_assinaturas_a_sondar(integer) from anon;
