-- A fila da emissão diária, e os freios dela.
--
-- Até aqui emitir era sempre um ato manual: a tela mandava uma lista de ids
-- escolhida por uma pessoa. A partir do corte (01/09/26) são ~100 notas por dia,
-- e escolher 100 ids à mão todo dia não é um processo, é um cargo. Esta função é
-- quem responde "o que precisa de nota hoje" sem ninguém apontar.
--
-- AS GUARDAS SÃO AS MESMAS DA EMISSÃO MANUAL, e uma a mais.
-- Reaproveita a busca-sombra de `notas_fiscais_candidatas` (documento + valor, SEM
-- data) que segura cobrança já notada; e acrescenta a que só faz sentido no modo
-- automático: **a OS tem de ser nossa**.
--
-- Por que isso importa. A etapa "Faturar" do Omie guarda 522 OS antigas, de abril
-- a junho, sem carimbo de origem. O casamento por semelhança (documento + valor +
-- mês) pode ligar uma cobrança a uma dessas — e no modo manual isso é só um aviso
-- na tela, mas no automático seria faturar uma OS que ninguém mandou faturar. Por
-- isso a fila só aceita cobrança SEM OS ou com OS que o próprio Hub criou
-- (`c_cod_int_os` = id da cobrança). Retentativa de OS alheia continua sendo
-- decisão de gente.

alter table public.nf_config
  add column if not exists emissao_automatica text not null default 'previa',
  add column if not exists teto_dia integer not null default 120,
  add column if not exists teto_rodada integer not null default 20;

alter table public.nf_config drop constraint if exists nf_config_emissao_automatica_check;
alter table public.nf_config
  add constraint nf_config_emissao_automatica_check
  check (emissao_automatica in ('off', 'previa', 'on'));

comment on column public.nf_config.emissao_automatica is
  'off = o cron nao emite nada; previa = o cron monta a fila e ESCREVE NO DIARIO o que faria, sem tocar no Omie; on = emite. Nasce em previa de proposito: um dia de ensaio com o log na mao antes de virar a chave.';
comment on column public.nf_config.teto_dia is
  'Teto de notas que a emissao automatica pode emitir por dia. Freio contra defeito que vire enxurrada fiscal.';
comment on column public.nf_config.teto_rodada is
  'Quantas cobrancas por chamada. Existe por causa do teto de 150s da Edge Function: cada cobranca custa IncluirOS + TrocarEtapaOS, e o lote inteiro tem de caber na janela.';

/* ------------------------------------------------------------------
 * A fila
 * ------------------------------------------------------------------ */
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
  -- `min` resolve cadastro duplicado no Omie: dois códigos para o mesmo CNPJ
  -- existem, e sem ele a cobrança viraria duas linhas — duas notas.
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
         c.valor, c.data_vencimento, c.data_pagamento
  from public.asaas_cache c
  where c.tipo = 'payment'
    and c.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')
    -- Estorno: emitir nota de receita devolvida cria imposto sobre dinheiro que voltou.
    and not (jsonb_typeof(c.dados->'refunds') = 'array' and jsonb_array_length(c.dados->'refunds') > 0)
    and c.valor > 0
    -- Só do corte em diante. Antes disso quem emitiu foi o Asaas.
    and coalesce(c.data_pagamento, c.data_vencimento) >= (select data_corte from cfg)
    and coalesce(c.data_pagamento, c.data_vencimento) <= current_date
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os
from cob
join cli on cli.id_asaas = cob.cus
-- `join`, não `left join`: sem documento não há como achar o cadastro no Omie, e
-- sem cadastro no Omie a emissão falharia de todo jeito. Fica de fora da fila em
-- vez de entrar para falhar — e aparece na tela como "sem nota", que é verdade.
join omie_cli oc on oc.doc = cli.doc
left join lateral (
  select o.n_cod_os, o.faturada, o.c_cod_int_os
  from public.nf_os_omie o
  where o.cancelada = false and o.c_cod_int_os = cob.id_asaas
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  -- OS alheia não entra (ver cabeçalho): ou não há OS, ou a que há é nossa e
  -- ainda não faturou — retentativa legítima do que este mesmo processo criou.
  and (os.n_cod_os is null or os.faturada is not true)
  -- A busca-sombra: documento + valor, sem data. Assimetria deliberada — falso
  -- positivo segura emissão legítima (reversível); falso negativo emite a
  -- segunda nota do mesmo serviço (não se apaga, cancela-se).
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
  )
  -- Nota do Asaas autorizada para a mesma cobrança.
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and upper(coalesce(n.status,'')) = 'AUTHORIZED'
  )
-- Mais antiga primeiro: a fila drena em ordem, e o que está esperando há mais
-- tempo é o que mais corre risco de virar competência de outro mês.
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from public, anon;
grant execute on function public.notas_fiscais_fila_emissao(integer) to authenticated, service_role;

/* ------------------------------------------------------------------
 * Quantas o processo automático já emitiu hoje
 * ------------------------------------------------------------------
 * O teto diário precisa de um contador, e o contador é o próprio diário —
 * append-only, com hora, que é a mesma fonte que a tela mostra. Conta a linha
 * de desfecho: 'ok' (nasceu) e 'em_processamento' (foi mandada e vai nascer).
 * Contar só as 'ok' deixaria o teto furado pelas que ainda estão a caminho.
 */
create or replace function public.notas_fiscais_emitidas_hoje()
returns integer
language sql stable security invoker set search_path = public as $$
select count(distinct id_asaas)::integer
from public.nf_emissoes
where acao in ('faturar', 'criar_e_faturar')
  and resultado in ('ok', 'em_processamento')
  and (criado_em at time zone 'America/Sao_Paulo')::date
      = (now() at time zone 'America/Sao_Paulo')::date;
$$;

revoke all on function public.notas_fiscais_emitidas_hoje() from public, anon;
grant execute on function public.notas_fiscais_emitidas_hoje() to authenticated, service_role;
