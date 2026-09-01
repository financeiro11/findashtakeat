-- A FILA VOLTA A ENXERGAR A NOTA DO ASAAS — e agora pela régua certa.
--
-- DUAS COISAS AQUI: um conserto de regressão e uma decisão que estava pendente.
--
-- A REGRESSÃO, que é minha. A migration `20260901010000` (SOMBRA 3) reescreveu
-- esta função inteira e, no caminho, DEIXOU CAIR a cláusula final que existia:
--
--     and not exists (select 1 from asaas_cache n
--                     where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas)
--
-- Efeito medido em 01/09/2026, na primeira rodada com a emissão ligada: a fila
-- saltou para 1.765 cobranças e as 20 servidas voltaram TODAS barradas com "O
-- Asaas já tem nota para esta cobrança (AUTHORIZED), lido agora". Não houve
-- duplicidade porque a porta ao vivo (`conferirNoAsaas`) segurou as 20 — mas a
-- esteira gastaria 88 rodadas e uma leitura por cobrança para descobrir de 20 em
-- 20 o que o Postgres já sabia.
--
-- Isso é a prova de que as duas guardas não são redundantes: a da fila evita o
-- TRABALHO, a da porta evita o ERRO. Perder a primeira não quebra nada e custa
-- caro; perder a segunda emitiria nota em duplicidade.
--
-- A DECISÃO. A cláusula não volta como era. A original excluía nota do Asaas em
-- QUALQUER situação, e `ERROR` é uma situação — foi essa a "trava 1" que manteve
-- 1.694 cobranças órfãs (o Asaas tentou, falhou, e nós não podíamos entrar), e
-- que obrigou a emissão de hoje a ir por lista de `ids` em vez de pela fila.
--
-- A porta ao vivo resolveu isso em 28/08 ignorando `ERROR`/`CANCELLED`: notas
-- nesses estados NÃO EXISTEM no portal nacional, então não há segunda nota a
-- criar. A fila passa a usar exatamente a mesma régua — as duas guardas
-- respondendo à mesma pergunta é o que impede uma oferecer o que a outra barra.
--
-- Com o Asaas desligado (01/09, ver `20260901120000`), o que sobra desta
-- cláusula é o histórico: cobrança que ele já emitiu antes do corte continua
-- fora, para sempre, que é o certo.

create or replace function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table(
  id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date,
  email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, status_asaas text, estornado boolean
)
language sql
stable
set search_path to 'public'
as $function$
with cfg as (
  select data_corte, paralelo_asaas, avulsa_sem_asaas_desde
  from public.nf_config where id = 1
),
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
passo as (
  select distinct on (id_asaas)
         id_asaas, resultado, criado_em, coalesce(erro, '') as erro
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and criado_em > now() - interval '30 days'
  order by id_asaas, criado_em desc
),
tentativas as (
  select id_asaas, count(*)::int as n
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and resultado = 'erro'
    and criado_em > now() - interval '7 days'
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
         coalesce(c.data_vencimento, c.data_pagamento) as previsao,
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
left join passo p on p.id_asaas = cob.id_asaas
left join tentativas t on t.id_asaas = cob.id_asaas
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  where o.cancelada = false and o.c_cod_int_os = cob.id_asaas
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  and public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado) is null
  and (os.n_cod_os is null or os.faturada is not true)
  /* NO FORNO NÃO VOLTA. */
  and not coalesce(p.resultado = 'em_processamento'
                   and p.criado_em > now() - interval '12 hours', false)
  /* CARÊNCIA DEPOIS DO ERRO. */
  and not coalesce(p.resultado = 'erro'
                   and p.criado_em > now() - public.nfse_carencia(p.erro, coalesce(t.n, 0)), false)
  /* O PARALELO. */
  and (
    not (select paralelo_asaas from cfg)
    or (cob.assinatura is not null and nfc.tem_config is false)
    or (cob.assinatura is null
        and (select avulsa_sem_asaas_desde from cfg) is not null
        and cob.competencia >= (select avulsa_sem_asaas_desde from cfg))
  )
  /* SOMBRA 1 — pela COMPETÊNCIA. */
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
      and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  )
  /* SOMBRA 2 — pela PREVISÃO (a parcelada de cartão). */
  and not exists (
    select 1 from public.nf_os_omie o3
    where o3.cancelada = false and o3.nfse_status = '004'
      and coalesce(o3.c_cod_int_os, '') = ''
      and o3.cnpj_cpf = cli.doc and o3.valor = cob.valor
      and date_trunc('month', o3.data_previsao) = date_trunc('month', cob.previsao)
  )
  /* SOMBRA 3 — a OS SEM CARIMBO JÁ FATURADA, com qualquer desfecho.
     A pergunta é "esta OS ainda pode ser faturada?" (`faturada`), não "já existe
     nota?" (`nfse_status`) — faturada com RECUSA era o caso que escapava e
     produzia o laço de 323 tentativas em 19 cobranças. */
  and not exists (
    select 1 from public.nf_os_omie o4
    where o4.cancelada = false and o4.faturada = true
      and coalesce(o4.c_cod_int_os, '') = ''
      and o4.cnpj_cpf = cli.doc and o4.valor = cob.valor
      and date_trunc('month', o4.data_previsao) = date_trunc('month', cob.previsao)
  )
  /* A NOTA DO ASAAS — restaurada, e agora com a MESMA régua da porta ao vivo.
     `ERROR` e `CANCELED` não existem no portal nacional: não há segunda nota a
     criar, e por isso não barram. Todo o resto (AUTHORIZED, SCHEDULED,
     SYNCHRONIZED, PENDING, PROCESSING_CANCELLATION) barra. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and n.status not in ('ERROR', 'CANCELED', 'CANCELLED')
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;
