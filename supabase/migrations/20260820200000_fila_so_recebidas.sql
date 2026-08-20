-- A emissão automática só emite o que foi RECEBIDO.
--
-- `CONFIRMED` no Asaas é cartão autorizado cuja liquidação ainda não caiu na
-- conta; `RECEIVED` é o dinheiro já disponível. A tela sempre tratou as duas como
-- emitíveis — o fato gerador do ISS é a prestação do serviço, não a liquidação —
-- e essa continua sendo uma escolha defensável para quem está olhando a linha e
-- decidindo.
--
-- No processo automático a escolha é outra, e é da diretoria: só nota do que
-- entrou. A razão prática é o risco assimétrico — uma autorização de cartão pode
-- não liquidar (chargeback, cancelamento, falha na captura), e a nota emitida
-- sobre ela vira imposto sobre receita que nunca existiu, com cancelamento de
-- prazo e justificativa para desfazer. Esperar a liquidação custa alguns dias;
-- errar custa uma nota que não se apaga.
--
-- NADA SE PERDE, SÓ ATRASA. A fila é remontada a cada rodada: quando a cobrança
-- CONFIRMED liquidar e virar RECEIVED, ela entra na fila daquele dia sozinha.
-- Medido em ago/26 na janela do mês: 1.547 recebidas contra 797 confirmadas —
-- ou seja, cerca de um terço do volume apenas espera mais alguns dias.
--
-- `RECEIVED_IN_CASH` fica: é recebimento em dinheiro, fora do Asaas. O dinheiro
-- entrou; o que não passou foi a maquininha.
--
-- A emissão MANUAL não muda: quem está na tela vê o status "Confirmada" com tom
-- próprio e decide. A assimetria é deliberada — automático é conservador, gente
-- pode julgar o caso.

create or replace function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table (
  id_asaas text, descricao text, valor numeric,
  data_vencimento date, data_pagamento date, email text,
  cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint
)
language sql stable security invoker set search_path = public as $$
with cfg as (select data_corte from public.nf_config where id = 1),
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
         c.dados->>'description' as descricao,
         c.dados->>'customer'    as cus,
         c.valor, c.data_vencimento, c.data_pagamento,
         coalesce(c.data_pagamento, c.data_vencimento) as competencia
  from public.asaas_cache c
  where c.tipo = 'payment'
    -- Só o que entrou. CONFIRMED (autorizado, não liquidado) fica de fora e
    -- volta sozinho à fila no dia em que liquidar.
    and c.status in ('RECEIVED', 'RECEIVED_IN_CASH')
    and not (jsonb_typeof(c.dados->'refunds') = 'array' and jsonb_array_length(c.dados->'refunds') > 0)
    and c.valor > 0
    and coalesce(c.data_pagamento, c.data_vencimento) >= (select data_corte from cfg)
    and coalesce(c.data_pagamento, c.data_vencimento) <= current_date
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os
from cob
join cli on cli.id_asaas = cob.cus
join omie_cli oc on oc.doc = cli.doc
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  where o.cancelada = false and o.c_cod_int_os = cob.id_asaas
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  and (os.n_cod_os is null or os.faturada is not true)
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
  )
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and upper(coalesce(n.status,'')) = 'AUTHORIZED'
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from public, anon;
grant execute on function public.notas_fiscais_fila_emissao(integer) to authenticated, service_role;
