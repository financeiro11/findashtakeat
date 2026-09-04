-- "Meios de Pagamento" passa a ser o somatório das taxas do Asaas do mês.
--
-- O DIAGNÓSTICO. O de-para do Omie aponta três categorias para essa rubrica —
-- 2.01.03 "3.2.3. Meios de Pagamento", 2.01.92 "3.1.2.17 Cobrança Clientes" e
-- 2.01.93 "3.1.2.16 Emissão NF", esta última descrita no próprio Omie como "Taxa
-- pela emissão de Notas Fiscais pelo Asaas". Nenhuma das três tem UM movimento
-- no ERP, e nunca terá: a taxa do Asaas é descontada na liquidação, então ela
-- não vira conta a pagar. O número da linha vinha inteiro do tracker, digitado
-- à mão. Em agosto/26 ninguém digitou e a célula ficou vazia — sem erro, sem
-- aviso, com o Custo Operacional do mês R$ 21 mil mais barato do que foi.
--
-- A fonte de verdade é `asaas_extrato`, onde cada taxa é uma linha própria.
--
-- POR QUE A CLASSIFICAÇÃO É ANCORADA NO COMEÇO DA FRASE (`like 'TAXA%'`, não
-- `like '%TAXA%'`): é a mesma regra de src/lib/extratoAsaas.ts, e o motivo está
-- documentado lá com os dois erros que ela evita — "Transação via Pix com chave
-- para TAKEAT" (a varrida de saldo, R$ 781 mil) entrando como taxa do Pix, e
-- "Confeitaria" casando com "nf". Quem mexer numa das duas pontas mexe na outra.

/* ------------------------------------------------------------------ */
/* 1. A célula sabe dizer de onde veio                                 */
/* ------------------------------------------------------------------ */

-- `demonstracoes_valor_manual` era o único jeito de um número sobreviver ao
-- omie-sync e ao import de tracker, e por isso é onde este valor mora. Mas a
-- tela dizia "digitado à mão" para todas as células dela — mentira para um
-- número que ninguém digitou. `origem` separa as duas coisas: a marca, o texto
-- do hover e o resumo mudam, e a rotina do Asaas passa a saber que NÃO pode
-- reescrever a célula em que uma pessoa fixou um valor.
alter table public.demonstracoes_valor_manual
  add column if not exists origem  text not null default 'manual',
  add column if not exists detalhe jsonb;

alter table public.demonstracoes_valor_manual
  drop constraint if exists demonstracoes_valor_manual_origem_check;
alter table public.demonstracoes_valor_manual
  add constraint demonstracoes_valor_manual_origem_check
  check (origem in ('manual', 'asaas'));

comment on column public.demonstracoes_valor_manual.origem is
  'manual = alguém digitou (e a automação respeita); asaas = a rotina de taxas escreveu.';
comment on column public.demonstracoes_valor_manual.detalhe is
  'Prestação de contas de quem escreveu sozinho: quebra por tipo de taxa, nº de lançamentos, cobertura do mês.';

/* ------------------------------------------------------------------ */
/* 2. A soma das taxas, mês a mês                                      */
/* ------------------------------------------------------------------ */

create or replace function public.asaas_taxas_mes(
  p_de  date default null,
  p_ate date default null
)
returns table (
  mes         text,
  inicio      date,
  fim         date,
  total       numeric,
  lancamentos integer,
  detalhe     jsonb,
  cobertura_de  date,
  cobertura_ate date,
  coberto     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with limites as (
    -- Menor data do espelho INTEIRO (sem o recorte de p_de/p_ate): é ela que
    -- diz se um mês começa dentro ou fora do que o extrato conhece.
    select min(data_movimento) as primeiro from public.asaas_extrato
  ),
  linhas as (
    select
      date_trunc('month', e.data_movimento)::date as inicio,
      e.data_movimento,
      lower(e.tipo) like 'cred%' as credito,
      upper(public.unaccent(btrim(coalesce(e.historico, '')))) as h,
      abs(e.valor) as valor
    from public.asaas_extrato e
    where e.data_movimento is not null
      -- O recorte é por MÊS INTEIRO: cortar no meio devolveria um total parcial
      -- com cara de total fechado.
      and (p_de  is null or e.data_movimento >= date_trunc('month', p_de)::date)
      and (p_ate is null or e.data_movimento <= (date_trunc('month', p_ate) + interval '1 month - 1 day')::date)
  ),
  prep as (
    select
      inicio, data_movimento, valor,
      -- Débito com frase de taxa SOMA. Crédito de "Estorno da taxa …" ABATE a
      -- taxa que o gerou. Todo o resto (cobrança recebida, transferência de
      -- saldo, chargeback) fica de fora: sinal 0.
      case when credito and h like 'ESTORNO DA TAXA%' then -1
           when not credito                          then  1
           else 0 end as sinal,
      -- Só no crédito o "Estorno da " é removido para reclassificar. Num DÉBITO
      -- que começa por "Estorno" o lançamento É um estorno, não uma taxa — tirar
      -- o prefixo faria dele uma despesa que nunca existiu.
      case when credito and h like 'ESTORNO DA TAXA%' then substr(h, 12) else h end as frase
    from linhas
  ),
  classificadas as (
    select
      inicio, valor, sinal,
      case
        when frase like 'TAXA DE MENSAGERIA%'                                                        then 'mensageria'
        when frase like 'TAXA DO PIX%'    or frase like 'TAXA DE PIX%'                               then 'pix'
        when frase like 'TAXA DE CARTAO%' or frase like 'TAXA DO CARTAO%'                            then 'cartao'
        when frase like 'TAXA DE BOLETO%' or frase like 'TAXA DO BOLETO%'                            then 'boleto'
        when frase like 'TAXA DE EMISSAO DA NOTA FISCAL%'   or frase like 'TAXA DE EMISSAO DE NOTA FISCAL%'   then 'nf'
        when frase like 'TAXA DE NOTIFICACAO POR WHATSAPP%' or frase like 'TAXA DE NOTIFICACAO VIA WHATSAPP%' then 'whatsapp'
        -- O "TAXA" solto por último é de propósito: um tipo de taxa novo do
        -- Asaas cai em "outras" e continua somando, em vez de sumir da conta.
        when frase like 'TAXA%'                                                                      then 'taxa'
      end as categoria
    from prep
    where sinal <> 0
  ),
  por_cat as (
    select inicio, categoria,
           round(sum(sinal * valor), 2) as v,
           count(*) filter (where sinal = 1) as n
    from classificadas
    where categoria is not null
    group by inicio, categoria
  ),
  -- Cobertura vem de TODAS as linhas do mês, não só das taxas: um mês pode ter
  -- movimento no dia 1 e a primeira taxa só no dia 2.
  cobertura as (
    select inicio, min(data_movimento) as de, max(data_movimento) as ate
    from linhas group by inicio
  )
  select
    to_char(c.inicio, 'YYYY-MM'),
    c.inicio,
    (c.inicio + interval '1 month - 1 day')::date,
    coalesce(round(sum(p.v), 2), 0),
    coalesce(sum(p.n), 0)::integer,
    coalesce(jsonb_object_agg(p.categoria, p.v) filter (where p.categoria is not null), '{}'::jsonb),
    c.de,
    c.ate,
    (select primeiro from limites) <= c.inicio
  from cobertura c
  left join por_cat p on p.inicio = c.inicio
  group by c.inicio, c.de, c.ate
  order by c.inicio;
$$;

comment on function public.asaas_taxas_mes(date, date) is
  'Taxas do Asaas somadas por mês a partir de asaas_extrato (débito "Taxa …" menos crédito "Estorno da taxa …"), com a cobertura do espelho em cada mês. Espelha src/lib/extratoAsaas.ts.';

-- `security definer` porque a rotina e o painel leem o extrato sem depender da
-- RLS de asaas_extrato. `anon` não entra: o grant para anon é automático neste
-- projeto e precisa ser revogado à mão.
revoke all on function public.asaas_taxas_mes(date, date) from public, anon;
grant execute on function public.asaas_taxas_mes(date, date) to authenticated, service_role;

/* ------------------------------------------------------------------ */
/* 3. A rotina                                                         */
/* ------------------------------------------------------------------ */

insert into public.internal_cron_tokens (name, token)
values ('demonstracoes-meios-pagamento', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

create extension if not exists pg_cron;

-- 11:15 UTC = 08:15 BRT, DEPOIS do `asaas-extrato-sync-diario-1` das 10:45 UTC:
-- a rotina só sabe somar o que o espelho já trouxe. Uma vez ao dia basta — o
-- mês corrente cresce devagar e a coluna dele é parcial de qualquer jeito.
--
-- `p_token_nome` PREENCHIDO: sem o NOME do token a função responde
-- "Não autenticado." e o cron.job_run_details diz "succeeded" assim mesmo.
select cron.unschedule('demonstracoes-meios-pagamento-diario')
where exists (select 1 from cron.job where jobname = 'demonstracoes-meios-pagamento-diario');

select cron.schedule(
  'demonstracoes-meios-pagamento-diario',
  '15 11 * * *',
  $cron$
  select public.disparar_automacao(
    'demonstracoes-meios-pagamento-diario',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/demonstracoes-meios-pagamento',
    '{"action":"aplicar","trigger":"cron"}'::jsonb,
    'demonstracoes-meios-pagamento',
    '{}'::jsonb,
    150000
  );
  $cron$
);
