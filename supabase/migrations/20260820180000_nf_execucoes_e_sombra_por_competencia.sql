-- Duas correções que só apareceram quando a emissão virou processo automático.
--
-- 1) A SOMBRA PRECISA DE COMPETÊNCIA.
--
-- A guarda contra nota duplicada casa documento + valor SEM data, de propósito:
-- as 1.207 OS que o n8n importou têm `dDtPrevisao` = data do import, então mês
-- não significava nada nelas. No fluxo manual o custo disso é baixo — a linha
-- aparece na tela, alguém olha e decide.
--
-- No automático o custo muda de natureza. Assinatura recorrente cobra o MESMO
-- valor todo mês: a nota de junho de R$ 249 passa a esconder a cobrança de julho,
-- a de agosto e todas as seguintes, para sempre, sem ninguém ver. Medido em
-- agosto/26: **196 cobranças barradas pela sombra sem data, contra 4 pela sombra
-- da mesma competência** — ou seja, 192 notas que simplesmente nunca sairiam.
--
-- A data que vale é a do FATURAMENTO da nota (`data_faturamento`), que é real
-- mesmo nas OS importadas — não a `data_previsao`, que é a que não significa
-- nada. Nota de junho não cobre serviço de setembro.
--
-- 2) O DIÁRIO PRECISA DE UM NÍVEL ACIMA.
--
-- `nf_emissoes` responde "o que aconteceu com ESTA cobrança". Não responde "o que
-- o processo das 10h fez hoje" — quantas estavam na fila, quantas saíram, quantas
-- falharam, quantas foram seguradas e por quê. Sem isso, um dia em que a fila
-- veio vazia por defeito é indistinguível de um dia sem nada a emitir: os dois
-- não deixam nenhuma linha. `nf_execucoes` grava a rodada mesmo quando ela não
-- faz nada, que é justamente o dia que precisa ser explicável.

/* ------------------------------------------------------------------
 * 1) Sombra por competência, só na fila automática
 * ------------------------------------------------------------------
 * O painel continua com a guarda frouxa: lá ela produz uma DÚVIDA na tela, e
 * dúvida honesta não faz mal. Aqui ela produz uma AÇÃO (ou a ausência dela).
 */
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
    and c.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')
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

/* ------------------------------------------------------------------
 * 2) O diário aceita o ensaio
 * ------------------------------------------------------------------ */
alter table public.nf_emissoes drop constraint if exists nf_emissoes_acao_check;
alter table public.nf_emissoes
  add constraint nf_emissoes_acao_check
  check (acao in ('criar_os', 'faturar', 'criar_e_faturar', 'previa'));

comment on column public.nf_emissoes.acao is
  'criar_os / faturar / criar_e_faturar = escrita de verdade. previa = ensaio do modo automatico: registra o que TERIA sido emitido, sem tocar no Omie.';

/* ------------------------------------------------------------------
 * 3) A rodada
 * ------------------------------------------------------------------ */
create table if not exists public.nf_execucoes (
  id            uuid primary key default gen_random_uuid(),
  iniciada_em   timestamptz not null default now(),
  concluida_em  timestamptz,
  origem        text not null,                    -- 'cron' | 'tela' | 'manual'
  modo          text not null,                    -- 'off' | 'previa' | 'on'
  -- O que a rodada encontrou e o que fez com isso.
  fila          integer not null default 0,
  emitidas      integer not null default 0,
  falhas        integer not null default 0,
  -- `pulada` guarda o motivo de a rodada não ter feito nada: teto do dia batido,
  -- corredor de isolamento ocupado, lote anterior ainda em voo, fila vazia. É a
  -- coluna que faz um dia parado ser explicável em vez de silencioso.
  pulada        text,
  lote          bigint,
  detalhe       jsonb,
  erro          text
);

comment on table public.nf_execucoes is
  'Uma linha por rodada da emissao (automatica ou pela tela), inclusive quando nao emite nada. Responde "o que o processo fez hoje as 10h"; nf_emissoes responde "o que aconteceu com esta cobranca".';

create index if not exists nf_execucoes_iniciada_idx on public.nf_execucoes (iniciada_em desc);

alter table public.nf_execucoes enable row level security;

-- Leitura para quem está logado; escrita só pelo service_role (a Edge Function).
drop policy if exists nf_execucoes_leitura on public.nf_execucoes;
create policy nf_execucoes_leitura on public.nf_execucoes
  for select to authenticated using (true);

/* ------------------------------------------------------------------
 * 4) O log da tela, em uma chamada
 * ------------------------------------------------------------------
 * Junta a rodada com as linhas por cobrança e devolve pronto para exibir: hora,
 * o que era, o que deu, e o motivo quando não deu. O nome do cliente vem junto
 * porque `pay_...` não diz nada a ninguém.
 */
create or replace function public.notas_fiscais_log(p_dias integer default 14, p_limite integer default 300)
returns table (
  criado_em timestamptz, id_asaas text, cliente text, valor numeric,
  acao text, resultado text, nfse_numero text, motivo text, operador text, n_cod_os bigint
)
language sql stable security invoker set search_path = public as $$
select e.criado_em, e.id_asaas,
       coalesce(c.dados->>'name', c.dados->>'company', '—') as cliente,
       p.valor, e.acao, e.resultado, e.nfse_numero, e.erro, e.operador, e.n_cod_os
from public.nf_emissoes e
left join public.asaas_cache p on p.tipo = 'payment' and p.id_asaas = e.id_asaas
left join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
where e.criado_em >= now() - make_interval(days => greatest(p_dias, 1))
order by e.criado_em desc
limit greatest(p_limite, 1);
$$;

revoke all on function public.notas_fiscais_log(integer, integer) from public, anon;
grant execute on function public.notas_fiscais_log(integer, integer) to authenticated, service_role;
