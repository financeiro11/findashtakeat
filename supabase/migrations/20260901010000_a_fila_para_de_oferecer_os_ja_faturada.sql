-- A FILA PARA DE OFERECER COBRANÇA CUJA OS JÁ FOI FATURADA.
--
-- O sintoma, medido: em 27/08/2026 o cron gastou 323 tentativas em 19 cobranças
-- — dezessete voltas por cobrança, no mesmo dia, todas morrendo no mesmo erro:
--
--     "Não é possível trocar a etapa dessa Ordem de Serviço.
--      Essa Ordem de Serviço pode ser alterado apenas para as etapas: 60"
--
-- OS faturada não muda de etapa, e sem mudar de etapa não entra no corredor de
-- isolamento — então a emissão é impossível, hoje e sempre. A cobrança volta na
-- rodada seguinte porque nada a tirou da fila, e o laço não tem fim: cada volta
-- ocupa uma vaga da leva, gasta uma chamada do Omie e escreve uma linha de erro
-- no diário. Em 01/09/2026 eram 53 cobranças nesse estado (R$ 27.940).
--
-- A CAUSA É UMA ASSIMETRIA entre quem oferece e quem executa:
--
--   • `notas_fiscais_fila_emissao` procura a OS da cobrança SÓ PELO CARIMBO
--     (`c_cod_int_os = pay_...`), e sua sombra exige `nfse_status = '004'`;
--   • `notas_fiscais_candidatas` (que a emissão usa) casa TAMBÉM SEM CARIMBO,
--     por CNPJ + valor + mês da previsão — o acervo do lote manual de junho.
--
-- Resultado: uma OS faturada, sem carimbo e com RECUSA (`003`) é invisível para
-- a fila e visível para a emissão. A fila oferece, a emissão encontra, o Omie
-- recusa. Dos 53 casos, 32 apontam para OS em `003` e 21 para OS em `004`.
--
-- O CONSERTO é ensinar a fila a enxergar pela MESMA regra que a emissão usa, e
-- olhar `faturada` em vez de `nfse_status`. `faturada` é o que decide se a OS
-- ainda pode ser faturada — o desfecho da prefeitura (autorizada, recusada, ou
-- resposta nenhuma) é outra pergunta, e é justamente por perguntar a errada que
-- as 32 recusadas escapavam.
--
-- Isto NÃO fecha o assunto dessas cobranças: elas seguem sem nota, e a nota
-- delas depende do "Reenviar NFS-e" na tela do Omie (não há reenvio pela API).
-- O que muda é que a esteira para de tentar o impossível todo dia.

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
  /* SOMBRA 3 — A OS SEM CARIMBO QUE JÁ FOI FATURADA, com QUALQUER desfecho.
     É esta que faltava, e é a que produzia o laço de 01/09/2026.

     As sombras 1 e 2 perguntam "já existe NOTA?" (`nfse_status = '004'`). A
     pergunta que a esteira precisa fazer antes de tentar é outra: "esta OS ainda
     pode ser faturada?". OS faturada não troca de etapa — o Omie só aceita a 60
     para ela — e sem trocar de etapa não há emissão possível. Faturada com
     RECUSA (`003`) é o caso que escapava das duas sombras e voltava todo dia.

     Mesmo casamento que a `notas_fiscais_candidatas` usa (CNPJ + valor + mês da
     previsão, só sem carimbo), para que a fila enxergue exatamente a OS que a
     emissão vai encontrar. */
  and not exists (
    select 1 from public.nf_os_omie o4
    where o4.cancelada = false and o4.faturada = true
      and coalesce(o4.c_cod_int_os, '') = ''
      and o4.cnpj_cpf = cli.doc and o4.valor = cob.valor
      and date_trunc('month', o4.data_previsao) = date_trunc('month', cob.previsao)
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;
