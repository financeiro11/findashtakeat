/* ============================================================================
 * O ASAAS PAROU DE EMITIR A PARCELADA — e a fila não tinha como saber.
 *
 * O QUE ESTAVA ACONTECENDO. Desde o corte (01/08/2026) o Hub emitiu 20 notas e
 * a fila oferecia 74 cobranças, enquanto 931 cobranças recebidas — R$ 336.326 —
 * não saíam por lugar nenhum. Não era vazão nem cadastro: era UMA cláusula.
 *
 * A guarda do paralelo exige `cob.assinatura is not null`. A prova de que o
 * Asaas não emite uma nota vem de `GET /subscriptions/{id}/invoiceSettings`
 * (200 = dele, 404 = nosso), e esse endereço **só existe para assinatura**.
 * Cobrança parcelada e cobrança avulsa não têm assinatura nenhuma — não há onde
 * perguntar. E como a regra do módulo é "no escuro não se emite", elas ficavam
 * de fora POR FALTA DE PERGUNTA, não por resposta. Para sempre.
 *
 * Isso estava CERTO enquanto o Asaas emitia essas notas, e ele emitia: 1.144 em
 * junho, 1.144 em julho, 99,3% de cobertura. Medido em 26/08 e registrado: "99,5%
 * das avulsas de jun–jul receberam nota do Asaas; incluí-las seria quase pura
 * duplicação". A decisão era correta com o dado da época.
 *
 * O QUE MUDOU, medido em 27/08/2026:
 *
 *   invoices do Asaas para cobrança SEM assinatura, por mês da cobrança:
 *     junho 1.144  ·  julho 1.144  ·  AGOSTO 9
 *
 *   dia a dia na virada:  31/07 → 44 de 44   ·   03/08 → 1 de 158
 *
 * E não é o atraso conhecido dele (p50 11 dias, p90 27, máximo 29): as cobranças
 * de 01–07/08, que já têm 20–27 dias, estão em 0,7% de cobertura, enquanto a
 * mesma coorte de julho fechou em 99,3%. Um atraso teria gradiente — velho alto,
 * novo baixo. Isto é um DEGRAU na data de corte.
 *
 * A confirmação independente: em agosto o Asaas criou 1.706 invoices para
 * cobrança de assinatura, das quais 450 `SCHEDULED` — ele está vivo e agendando
 * trabalho futuro. Para cobrança sem assinatura, `SCHEDULED` em agosto: ZERO.
 * Ele não está atrasado nessa faixa; ele saiu dela.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM INTERRUPTOR COM DATA, E NÃO UM `or cob.assinatura is null`.
 *
 * A cláusula solta abriria a faixa inteira desde sempre — inclusive junho e
 * julho, onde o Asaas COMPROVADAMENTE emitiu, e onde a segunda nota seria
 * duplicata em cima de 2.288 cobranças. A data diz exatamente o que se descobriu:
 * "a partir desta competência o Asaas não emite mais para quem não tem
 * assinatura". Nada antes dela se mexe.
 *
 * `null` é o estado fechado, e é o default da coluna: quem não souber a data não
 * abre a faixa. Se o Asaas voltar a emitir parcelada, o conserto é uma linha —
 * `update nf_config set avulsa_sem_asaas_desde = null` — e a fila fecha na
 * rodada seguinte, sem deploy.
 *
 * ---------------------------------------------------------------------------
 * O QUE **NÃO** CEDE AQUI, e é o que torna isto seguro mesmo se o diagnóstico
 * acima estiver errado. Duas travas independentes continuam por cobrança:
 *
 *   1. A cobrança que já tem invoice do Asaas em QUALQUER situação continua
 *      fora (o `not exists` sobre `asaas_cache tipo='invoice'`, mais abaixo).
 *      `SCHEDULED` é o Asaas dizendo "vou emitir" e barra igual.
 *   2. A porta relê `/invoices?payment=` NO ASAAS, ao vivo, no instante da
 *      emissão (`conferirNoAsaas`, na edge function). O espelho é de 12h15 e a
 *      emissão roda às 13h; essa releitura é o que fecha a janela.
 *
 * Nenhuma das duas depende de a data estar certa. O que a data faz é decidir se
 * a cobrança chega a ser PERGUNTADA — e as duas travas decidem se ela sai.
 *
 * A sombra (nota do mesmo CNPJ, mesmo valor, mesma competência no Omie) também
 * continua igual, e ela é a guarda contra a duplicata do NOSSO lado.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) A data em que o Asaas saiu da faixa
 * ------------------------------------------------------------------
 * Em `nf_config` e não numa constante do SQL porque é um FATO SOBRE O MUNDO que
 * mudou uma vez e pode mudar de novo — e porque desligar precisa ser um update,
 * não um deploy. Mesma família de `data_corte` e `paralelo_asaas`.
 */
alter table public.nf_config
  add column if not exists avulsa_sem_asaas_desde date;

comment on column public.nf_config.avulsa_sem_asaas_desde is
  'Competencia a partir da qual o Asaas NAO emite mais NFS-e para cobranca sem assinatura (parcelada/avulsa), e portanto a nota e do Hub. NULL = faixa fechada (comportamento anterior: cobranca sem assinatura nunca entra na fila automatica). Medido em 27/08/2026: invoices do Asaas para essa faixa cairam de 1.144/mes (jun e jul) para 9 em agosto, com degrau em 01/08 (31/07 = 44 de 44; 03/08 = 1 de 158) e zero SCHEDULED. Desligar = voltar para NULL; a fila fecha na rodada seguinte, sem deploy.';

update public.nf_config
   set avulsa_sem_asaas_desde = date '2026-08-01'
 where id = 1
   and avulsa_sem_asaas_desde is null;


/* ------------------------------------------------------------------
 * 2) A fila enxerga a faixa aberta
 * ------------------------------------------------------------------
 * `create or replace` e não `drop`+`create`: a assinatura não muda (um
 * `integer` com default), então não há risco do overload duplicado que obrigou o
 * `drop` na migration da avulsa. O corpo é cópia fiel do que está no banco hoje
 * — conferido com `pg_get_functiondef` antes de escrever — com UMA cláusula
 * acrescentada no bloco do paralelo. Copiar de memória uma função que decide o
 * que vai ao Omie é como se perde uma guarda sem perceber.
 */
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
/* O ÚLTIMO PASSO DE FATURAMENTO DE CADA COBRANÇA, e só ele.
 *
 * `criar_os` é passo anterior e `email` é posterior à nota: nenhum dos dois
 * responde "esta emissão terminou". É a mesma escolha que o `fecharRecusadas`
 * faz do lado do Deno, pelo mesmo motivo. */
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
  /* NO FORNO NÃO VOLTA. O espelho do Omie pode atrasar horas; esta leitura é do
   * nosso próprio diário e responde na hora.
   *
   * O `coalesce` é o que faz a guarda ser guarda. A cobrança que nunca foi
   * tentada não tem linha em `passo`, e `not (null = 'em_processamento')` é
   * NULL — que reprova a linha exatamente como um `false`. Sem ele, a fila
   * inteira zera: medido, 74 viraram 0. */
  and not coalesce(p.resultado = 'em_processamento'
                   and p.criado_em > now() - interval '12 hours', false)
  /* CARÊNCIA DEPOIS DO ERRO. */
  and not coalesce(p.resultado = 'erro'
                   and p.criado_em > now() - public.nfse_carencia(p.erro, coalesce(t.n, 0)), false)
  /* O PARALELO, agora com DUAS portas em vez de uma.
   *
   * Porta 1 (a de sempre) — cobrança DE ASSINATURA que o Asaas declarou não
   * emitir. `tem_config is null` (não sondada) continua fora: no escuro a
   * resposta certa é não emitir, porque o erro caro é a nota dupla.
   *
   * Porta 2 (nova) — cobrança SEM assinatura, a partir da competência em que o
   * Asaas parou de emitir para essa faixa. Ela existe porque a porta 1 é
   * impossível de atravessar aqui: `/subscriptions/{id}/invoiceSettings` é o
   * único sinal que prova, e não há assinatura para consultar. Sem esta porta,
   * parcelada e avulsa ficam fora para sempre por falta de pergunta — que foi
   * exatamente o que prendeu 931 cobranças e R$ 336 mil em agosto.
   *
   * A data é o que impede a porta 2 de virar "abre geral": junho e julho, onde
   * o Asaas emitiu 1.144 notas por mês nessa faixa, continuam fechados. */
  and (
    not (select paralelo_asaas from cfg)
    or (cob.assinatura is not null and nfc.tem_config is false)
    or (cob.assinatura is null
        and (select avulsa_sem_asaas_desde from cfg) is not null
        and cob.competencia >= (select avulsa_sem_asaas_desde from cfg))
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
   * humana, não da fila.
   *
   * É esta cláusula que faz a porta 2 ser segura mesmo se a data estiver errada:
   * a parcelada para a qual o Asaas emitiu (ou agendou) não entra, ponto. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from public, anon;
grant execute on function public.notas_fiscais_fila_emissao(integer) to authenticated, service_role;
