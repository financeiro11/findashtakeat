/* ============================================================================
 * A FILA PASSA A PEGAR O QUE O ASAAS DEIXOU CAIR — e, por ora, SÓ isso.
 *
 * O QUE ACONTECEU EM 28/08/2026. O fluxo de emissão do Asaas foi rodado para a
 * competência inteira de agosto enquanto o Hub emitia pelo Omie, e 99 cobranças
 * receberam nota dos dois lados (34 já autorizadas nos dois). A emissão do Hub
 * foi desligada às 12:25 — cron e botão da tela.
 *
 * A decisão de religar é estreita de propósito: **o Hub volta a emitir apenas as
 * cobranças em que o Asaas TENTOU e FALHOU.** É a faixa em que não existe risco
 * de encontrá-lo pelo caminho, porque o desfecho dele já foi dado e foi `ERROR`.
 *
 * O TAMANHO DA FAIXA, medido hoje: 464 cobranças recebidas desde o corte, R$
 * 224.680, com nota do Asaas em `ERROR` e nenhuma nota boa dele. E o motivo do
 * erro é o que torna isto valer a pena — a maioria esmagadora é problema DO
 * EMISSOR ASAAS, que não existe no nosso caminho pelo Omie:
 *
 *     série da DPS fora da faixa (GW1992) ... 269 cobranças · R$ 128.523
 *     credenciais do Asaas ................. 135 cobranças · R$  71.177
 *     CEP do tomador (E0240) ...............  29 cobranças · R$  10.766  ← nos derruba também
 *     competência retroativa ...............  20 cobranças · R$  11.386
 *
 * ---------------------------------------------------------------------------
 * AS DUAS TRAVAS QUE PRECISAM CAIR JUNTAS, E POR QUÊ.
 *
 * 1. A CLÁUSULA DA NOTA DO ASAAS. Ela excluía cobrança com nota dele "em
 *    qualquer situação", e `ERROR` é uma situação. Passa a excluir só o que não
 *    for `ERROR`/`CANCELLED`: nota que falhou não existe no portal nacional, e
 *    portanto não há segunda nota a criar.
 *
 * 2. A GUARDA DO PARALELO. Ela exclui assinatura cuja configuração diz "o Asaas
 *    emite" — e 455 das 456 cobranças desta faixa são exatamente isso. A
 *    configuração dizia que a nota era dele; **o desfecho dele desmentiu a
 *    configuração**. Onde há `ERROR`, o que vale é o desfecho.
 *
 * Se só a primeira caísse, a fila continuaria vazia (a segunda barraria tudo).
 * Se só a segunda caísse, idem. Daí as duas na mesma migration.
 *
 * ---------------------------------------------------------------------------
 * `so_faixa_erro` — O ESTREITAMENTO, E POR QUE ELE É COLUNA E NÃO CÓDIGO.
 *
 * Ligado, a fila oferece SOMENTE cobrança com nota do Asaas em `ERROR`. Nada
 * mais entra: nem a avulsa da faixa aberta em `avulsa_sem_asaas_desde`, nem a
 * assinatura que é comprovadamente nossa (`tem_config = false`). Isso é mais
 * estreito do que o comportamento anterior ao incidente, e é o pedido: religar
 * "por enquanto apenas aquelas que deram erro no Asaas".
 *
 * É coluna porque alargar de volta tem de ser um `update`, com a decisão de
 * quem emite tomada, e não um deploy meu. Mesma família de `data_corte`,
 * `paralelo_asaas` e `avulsa_sem_asaas_desde`.
 *
 * ---------------------------------------------------------------------------
 * O QUE **NÃO** CEDE, e é o que segura a corrida com o fluxo dela.
 *
 * A porta ao vivo (`conferirNoAsaas`, na edge function) relê `/invoices?payment=`
 * NO ASAAS no instante da emissão. Ela passa a deixar passar `ERROR`, mas
 * continua barrando qualquer outro status. Então se ela reprocessar uma dessas
 * e a nota dele sair enquanto a nossa rodada corre, a leitura ao vivo vê
 * `SYNCHRONIZED`/`AUTHORIZED` e barra. O espelho local é de horas atrás; a porta
 * é de agora, e é ela que decide.
 *
 * As sombras contra a NOSSA duplicata (mesmo CNPJ + valor, por competência e por
 * previsão) continuam exatamente como estavam.
 *
 * O corpo abaixo é cópia fiel de `pg_get_functiondef` lido no banco antes de
 * escrever (6.171 bytes, md5 f06d8b2d502924bd2ffb2f18e6bcc7b6), com as três
 * alterações marcadas com `-- [28/08]`. Copiar de memória uma função que decide
 * o que vai ao Omie é como se perde uma guarda sem perceber.
 * ========================================================================== */

alter table public.nf_config
  add column if not exists so_faixa_erro boolean not null default false;

comment on column public.nf_config.so_faixa_erro is
  'Ligado, notas_fiscais_fila_emissao oferece SOMENTE cobranca com nota do Asaas em ERROR - a faixa que ele tentou e deixou cair. Nasceu ligado em 28/08/2026, ao religar a emissao depois do incidente de duplicidade com o Asaas (99 cobrancas com nota dos dois lados). Desligar = voltar a fila normal, e exige a decisao de quem emite estar tomada.';

update public.nf_config set so_faixa_erro = true where id = 1;


create or replace function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table (
  id_asaas text, descricao text, valor numeric,
  data_vencimento date, data_pagamento date, email text,
  cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint,
  status_asaas text, estornado boolean
)
language sql
stable
set search_path to 'public'
as $function$
with cfg as (
  -- [28/08] `so_faixa_erro` entra aqui.
  select data_corte, paralelo_asaas, avulsa_sem_asaas_desde, so_faixa_erro
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
/* O ÚLTIMO PASSO DE FATURAMENTO DE CADA COBRANÇA, e só ele. */
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
         /* A data pela qual a OS ANTIGA foi prevista. É `data_vencimento`
            primeiro — o espelho da regra que a `candidatas` usa, e a única que
            enxerga a nota emitida na data do vencimento por um processo que não
            carimbava nada. */
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
  /* NO FORNO NÃO VOLTA — e o `coalesce` é o que faz a guarda ser guarda:
     sem ele a fila inteira zera (medido: 74 viraram 0). */
  and not coalesce(p.resultado = 'em_processamento'
                   and p.criado_em > now() - interval '12 hours', false)
  /* CARÊNCIA DEPOIS DO ERRO. */
  and not coalesce(p.resultado = 'erro'
                   and p.criado_em > now() - public.nfse_carencia(p.erro, coalesce(t.n, 0)), false)
  /* O PARALELO, com duas portas: assinatura que o Asaas declarou não emitir, e
     cobrança sem assinatura a partir da competência em que ele saiu da faixa
     (ver `20260827530000`). `tem_config is null` continua fora: no escuro não
     se emite. */
  and (
    not (select paralelo_asaas from cfg)
    or (cob.assinatura is not null and nfc.tem_config is false)
    or (cob.assinatura is null
        and (select avulsa_sem_asaas_desde from cfg) is not null
        and cob.competencia >= (select avulsa_sem_asaas_desde from cfg))
    /* [28/08] TERCEIRA PORTA: o Asaas tentou e falhou.
       A configuração da assinatura dizia "a nota é dele" — e o desfecho DELE
       desmentiu a configuração. Onde existe `ERROR`, o que vale é o desfecho,
       não a intenção declarada. Sem esta linha a faixa inteira continuaria
       fora, porque 455 das 456 são assinatura com `tem_config = true`. */
    or exists (
      select 1 from public.asaas_cache ne
      where ne.tipo = 'invoice' and ne.pagamento_ref = cob.id_asaas
        and ne.status = 'ERROR'
    )
  )
  /* SOMBRA 1 — pela COMPETÊNCIA (quando a nota saiu × quando o dinheiro entrou).
     Pega a nota emitida no mesmo mês do pagamento. */
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
      and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  )
  /* SOMBRA 2 — pela PREVISÃO (quando a OS foi prevista × quando a cobrança
     venceu). É a sombra da `notas_fiscais_candidatas`, trazida para cá em
     28/08/2026 porque as duas discordavam e a fila era a permissiva.

     Ela pega o que a sombra 1 não pega: a parcelada de cartão, cujo crédito cai
     ~30-45 dias depois do vencimento. A nota saiu em junho (na data do
     vencimento), o dinheiro entrou em agosto, e pela competência de agosto a
     sombra 1 não enxerga junho. Eram 97 segundas notas prontas para sair.

     Só OS SEM carimbo: a que tem carimbo já foi resolvida pelo casamento exato
     acima, e é no histórico pré-carimbo que mora o problema. */
  and not exists (
    select 1 from public.nf_os_omie o3
    where o3.cancelada = false and o3.nfse_status = '004'
      and coalesce(o3.c_cod_int_os, '') = ''
      and o3.cnpj_cpf = cli.doc and o3.valor = cob.valor
      and date_trunc('month', o3.data_previsao) = date_trunc('month', cob.previsao)
  )
  /* [28/08] A NOTA DO ASAAS BARRA — MENOS QUANDO ELE FALHOU.
     Era "em qualquer situação". `ERROR` e `CANCELLED` deixam de barrar: nota que
     falhou não existe no portal nacional, então não há segunda nota a criar.
     Qualquer outro status (SCHEDULED, SYNCHRONIZED, AUTHORIZED, PENDING) barra
     como antes — inclusive os que ele criar daqui a pouco. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and n.status not in ('ERROR', 'CANCELLED', 'CANCELED')
  )
  /* [28/08] O ESTREITAMENTO. Ligado, SÓ a faixa de erro entra — nem a avulsa,
     nem a assinatura comprovadamente nossa. É mais estreito que o pré-incidente,
     e é temporário por construção: alargar é um `update` em `nf_config`. */
  and (
    not (select so_faixa_erro from cfg)
    or exists (
      select 1 from public.asaas_cache nf
      where nf.tipo = 'invoice' and nf.pagamento_ref = cob.id_asaas
        and nf.status = 'ERROR'
    )
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from public, anon;
grant execute on function public.notas_fiscais_fila_emissao(integer) to authenticated, service_role;
