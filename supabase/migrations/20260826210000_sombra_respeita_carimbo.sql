-- A sombra anti-duplicata para de barrar a SEGUNDA cobrança legítima do mês.
--
-- A guarda casa documento + valor + competência e existe para um caso real: OS
-- antiga, importada, sem vínculo com cobrança nenhuma, cuja nota já cobre aquele
-- serviço. Emitir por cima criaria a segunda nota do mesmo fato, e nota não se
-- apaga — cancela-se, com prazo e justificativa. Por isso ela é frouxa de
-- propósito.
--
-- SÓ QUE FROUXA DEMAIS. Ela não olhava o carimbo. Um cliente com DUAS cobranças
-- de R$ 350 no mesmo mês — plano mais recarga, duas lojas na mesma conta,
-- assinatura mais avulso — tinha a primeira emitida e a segunda barrada como se
-- fosse cópia dela. Medido em jun–ago/26: **35 a 50 cobranças por mês, R$ 11 a 15
-- mil**, e na fila automática isso é SILENCIOSO: a cobrança não entra no `where`,
-- então não vira linha no diário, não vira erro, não vira nada.
--
-- O carimbo desfaz a dúvida. `c_cod_int_os` guarda o id da cobrança que gerou a
-- OS: se a nota que faz sombra está carimbada com OUTRA cobrança, ela é a nota
-- daquela outra cobrança e não tem nada a dizer sobre esta. A guarda continua
-- inteira onde ela nasceu para valer — OS sem carimbo, de origem desconhecida.
--
-- Com o Omie virando o único emissor, isto deixa de ser detalhe: a defesa precisa
-- ser SÓ contra a segunda nota do MESMO fato, nunca contra a segunda venda.

create or replace function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table(id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date,
              email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, status_asaas text, estornado boolean)
language sql
stable
set search_path to 'public'
as $function$
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
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  where o.cancelada = false and o.c_cod_int_os = cob.id_asaas
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  and public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado) is null
  and (os.n_cod_os is null or os.faturada is not true)
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
      -- O CARIMBO. Nota de OUTRA cobrança não faz sombra sobre esta.
      and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  )
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and upper(coalesce(n.status,'')) = 'AUTHORIZED'
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

-- A mesma correção do lado manual — e aqui havia MAIS: a sombra das candidatas
-- nunca ganhou a competência (ver a migration que a acrescentou à fila). Sem
-- data, ela casa a cobrança de setembro com a nota de junho do mesmo valor: era
-- a diferença medida de 196 barradas contra 4. No caminho manual isso aparecia
-- como "já tem nota" na tela — o que é exatamente a resposta errada quando esse
-- caminho virou o conserto do que a rodada não conseguiu emitir.
create or replace function public.notas_fiscais_candidatas(p_ids text[])
returns table(id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date,
              email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, ja_tem_nota boolean,
              status_asaas text, estornado boolean, bloqueio text)
language sql
stable
set search_path to 'public'
as $function$
with cli as (
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
         c.status, c.dados,
         coalesce(c.data_pagamento, c.data_vencimento) as competencia,
         exists (select 1 from public.estornos_asaas e where e.id_pagamento = c.id_asaas) as estorno_registrado
  from public.asaas_cache c
  where c.tipo = 'payment' and c.id_asaas = any(p_ids)
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os,
       coalesce(os.nfse_status = '004', false) or coalesce(sombra.existe, false),
       cob.status,
       cob.estorno_registrado
         or (jsonb_typeof(cob.dados->'refunds') = 'array' and jsonb_array_length(cob.dados->'refunds') > 0),
       public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado)
from cob
left join cli on cli.id_asaas = cob.cus
left join omie_cli oc on oc.doc = cli.doc
left join lateral (
  select o.* from public.nf_os_omie o
  where o.cancelada = false
    and ( o.c_cod_int_os = cob.id_asaas
       or ( (o.c_cod_int_os is null or o.c_cod_int_os = '')
            and o.cnpj_cpf is not null and o.cnpj_cpf = cli.doc
            and o.valor = cob.valor
            and date_trunc('month', o.data_previsao)
                = date_trunc('month', coalesce(cob.data_vencimento, cob.data_pagamento)) ) )
  order by (o.c_cod_int_os = cob.id_asaas) desc, o.n_cod_os
  limit 1
) os on true
left join lateral (
  select true as existe from public.nf_os_omie o2
  where o2.cancelada = false and o2.nfse_status = '004'
    and o2.cnpj_cpf is not null and o2.cnpj_cpf = cli.doc
    and o2.valor = cob.valor
    -- competência (faltava) + carimbo (faltava)
    and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
    and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  limit 1
) sombra on true;
$function$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from anon;
revoke all on function public.notas_fiscais_candidatas(text[]) from anon;
