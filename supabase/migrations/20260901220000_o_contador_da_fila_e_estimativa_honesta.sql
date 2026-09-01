-- O CONTADOR DA FILA VIRA ESTIMATIVA, E DIZ QUE É.
--
-- A versão anterior (`20260901210000`) tirou a conta do clique e a pôs no cron.
-- Não bastou: o cron TAMBÉM tem `statement_timeout` (120s) e a primeira execução
-- falhou nele. A fila completa simplesmente não é computável nesta janela.
--
-- POR QUE, medido no plano. O custo não é por linha ENCONTRADA, é por linha
-- VARRIDA: `nfse_bloqueio_emissao(status, dados, …)` roda sobre as 20.560
-- cobranças da janela recebendo o `dados` jsonb inteiro, e o heap do
-- `asaas_cache` é gordo (jsonb inline). Dá ~0,2s por linha de saída na fila
-- ordenada — 20 linhas em 5,2s, 100 em 20,5s. VACUUM ANALYZE não muda nada,
-- porque não é falta de índice nem de visibilidade: é o volume de jsonb lido.
--
-- Por isso o número da tela passa a ser uma ESTIMATIVA barata (10,2s medidos):
-- as mesmas guardas de dinheiro, cadastro e nota do Asaas, SEM as três sombras
-- anti-duplicata. Ela ERRA PARA MAIS — conta cobrança que a sombra excluiria
-- (o acervo do lote manual de junho, sobretudo).
--
-- E ISSO É ACEITÁVEL PORQUE O NÚMERO NÃO DECIDE NADA. Ele diz à pessoa se vale
-- abrir a tela; quem decide o que sai é `notas_fiscais_fila_emissao`, com as
-- sombras todas, uma leva por vez. Um contador que erra para mais faz alguém
-- olhar; um que erra para menos faz alguém não olhar — e é por isso que a
-- direção do erro foi escolhida, não tolerada.
--
-- `estimado` viaja junto para a tela poder dizer "~1.500" em vez de "1.500".
--
-- O CAMINHO CERTO, quando alguém voltar a isto: `nfse_bloqueio_emissao` não
-- precisa do `dados` inteiro — ela lê `status`, `refunds` e pouco mais. Uma
-- coluna gerada com o essencial (ou o refunds já extraído) tiraria o jsonb do
-- caminho e provavelmente devolveria a conta exata ao alcance do cron.

alter table public.nf_fila_resumo_cache
  add column if not exists estimado boolean not null default true;

create or replace function public.nfse_fila_resumo_recalcular()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.nf_fila_resumo_cache c
  set cobrancas = t.n, valor = t.v, calculado_em = now(), estimado = true
  from (
    select count(*)::integer as n, coalesce(sum(p.valor), 0) as v
    from public.asaas_cache p
    join public.asaas_cache cu on cu.tipo = 'customer' and cu.id_asaas = p.dados->>'customer'
    where p.tipo = 'payment' and p.valor > 0
      and coalesce(p.data_pagamento, p.data_vencimento) >= (select data_corte from public.nf_config where id = 1)
      and coalesce(p.data_pagamento, p.data_vencimento) <= current_date
      and public.nfse_bloqueio_emissao(p.status, p.dados, false) is null
      /* Nota viva do Asaas encerra o assunto — mesma régua da porta ao vivo. */
      and not exists (
        select 1 from public.asaas_cache n
        where n.tipo = 'invoice' and n.pagamento_ref = p.id_asaas
          and n.status not in ('ERROR', 'CANCELED', 'CANCELLED')
      )
      /* OS nossa já faturada também. As SOMBRAS ficam de fora — são elas que
         custam, e a estimativa assume esse erro para mais. */
      and not exists (
        select 1 from public.nf_os_omie o
        where o.cancelada = false and o.c_cod_int_os = p.id_asaas and o.faturada is true
      )
  ) t
  where c.id = 1;
$function$;

drop function if exists public.notas_fiscais_fila_resumo();

create function public.notas_fiscais_fila_resumo()
returns table(cobrancas integer, valor numeric, calculado_em timestamptz, estimado boolean)
language sql
stable
set search_path to 'public'
as $function$
  select c.cobrancas, c.valor, c.calculado_em, c.estimado
  from public.nf_fila_resumo_cache c where c.id = 1;
$function$;

-- De 15 em 15 minutos era folgado para uma conta de 2min que falhava; para uma
-- de 10s, é confortável. Mantido.
