/* ============================================================================
 * A FILA E O BOTÃO USAVAM SOMBRAS DIFERENTES — e a fila era a permissiva.
 *
 * COMO APARECEU. Teste real de 5 cobranças da faixa recém-aberta (28/08/2026):
 * 3 foram despachadas e **2 voltaram "já tem nota"**, pegas pela sombra da
 * `notas_fiscais_candidatas` — com OS antigas (5481187836, 5481187968) e notas
 * autorizadas (11126, 11127). Só que as duas tinham saído da FILA. Duas guardas
 * do mesmo módulo discordando sobre a mesma cobrança.
 *
 * A DIVERGÊNCIA, e ela é de UMA data:
 *
 *   fila       →  month(o.data_faturamento) = month(competência)
 *                 competência = coalesce(data_pagamento, data_vencimento)
 *
 *   candidatas →  month(o.data_previsao)    = month(vencimento)
 *                 vencimento  = coalesce(data_vencimento, data_pagamento)
 *
 * Uma olha para quando a NOTA saiu contra quando o DINHEIRO entrou; a outra,
 * para quando a OS foi PREVISTA contra quando a cobrança VENCEU. Para o
 * mensalista as duas coincidem e ninguém percebeu por meses. Para a parcelada de
 * cartão elas divergem sempre, porque o crédito cai ~30-45 dias depois do
 * vencimento — e foi essa faixa que a migration `20260827530000` acabou de abrir.
 *
 * O QUE ESTAVA EM JOGO. Medido: **97 das 1.001 da fila** (9,7%). O padrão é o
 * mesmo nas 97 — vencimento em junho, pagamento em agosto, e uma nota já emitida
 * em **02/06/2026** com o valor idêntico:
 *
 *   Aletto cafe            R$ 399     venc 22/06  pago 03/08  nota 11145 (02/06)
 *   Zi tereza Campo Belo   R$ 629     venc 19/06  pago 04/08  nota 11089 (02/06)
 *   Rodrigo Caldas         R$ 174,30  venc 30/06  pago 04/08  nota 11244 (02/06)
 *
 * Valores distintivos (174,30; 629; 630; 334) casando com CNPJ — não é
 * coincidência. Em 02/06 saiu uma leva de notas para as parcelas de junho; essas
 * cobranças só foram PAGAS em agosto, com atraso. A nota existe desde junho.
 *
 * A fila, olhando para a competência de agosto, não a via — e teria emitido 97
 * segundas notas na primeira rodada com a esteira ligada. Nota não se apaga:
 * cancela-se, com prazo e justificativa, 97 vezes.
 *
 * ---------------------------------------------------------------------------
 * A DECISÃO: a fila passa a carregar TAMBÉM a sombra da `candidatas`. As duas,
 * e não a "melhor" das duas — elas respondem a mesma pergunta por caminhos
 * diferentes, e cada uma pega o que a outra não pega. Guarda contra nota dupla
 * se soma, não se escolhe.
 *
 * POR QUE NÃO UNIFORMIZAR AS DUAS FUNÇÕES numa sombra só. Seria mexer na
 * `candidatas`, que é o caminho do botão e da seleção manual, para resolver um
 * problema que é da fila. A `candidatas` está CERTA — foi ela que pegou o caso.
 * Emparelhar por baixo é como se perde uma guarda.
 *
 * O CUSTO: 1.001 → 904 na fila. As 97 param de ser oferecidas, e é isso que se
 * quer: se alguma delas de fato precisar de nota, ela aparece na aba Auditoria
 * como cobrança sem nota, e quem decide é gente. Segurar é o erro barato.
 *
 * `o.c_cod_int_os` vazio é parte da regra, e não descuido: OS COM carimbo já é
 * tratada pelo casamento exato lá em cima (`o.c_cod_int_os = cob.id_asaas`).
 * Esta cláusula existe para o histórico que nasceu antes do carimbo — que é
 * justamente onde estão as 97.
 * ========================================================================== */

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
  /* Qualquer nota do Asaas para ESTA cobrança, em qualquer situação. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from public, anon;
grant execute on function public.notas_fiscais_fila_emissao(integer) to authenticated, service_role;
