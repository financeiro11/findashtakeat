/* ============================================================================
 * A fila do texto de título: quem ainda não foi lido do Omie.
 *
 * POR QUE EXISTE: a observação do título é o que dá nome ao gasto de cartão no
 * drill-down da DRE/DFC, e o Omie só a entrega em `ConsultarContaPagar` — UMA
 * CHAMADA POR TÍTULO, e sequencial (com 4 em voo, 89 de 120 voltam "já existe
 * uma requisição desse método sendo executada"). Uma célula de julho tinha 236
 * gastos de cartão e 90 textos em cache: os outros 146 viravam minutos de espera
 * COM A PESSOA OLHANDO — e, com o teto de uma execução, nem terminavam.
 *
 * O conserto é tirar a leitura da frente da pessoa: um cron drena esta fila
 * enquanto ninguém espera, e o painel abre lendo só o cache. Esta função é a
 * fila — os títulos de cartão que ainda não têm texto, DO MAIS RECENTE PARA O
 * MAIS ANTIGO, que é a ordem em que as células são abertas.
 *
 * Só cartão, de propósito: no resto das linhas o nome do fornecedor já está na
 * tela e a chamada não se pagaria. O reconhecimento é o mesmo do cliente
 * (src/lib/observacaoTitulo.ts, `ehCartao`): a fatura entra no ERP com uma
 * contraparte-carimbo ("Lancamento Fatura Cartao", "Lancamento cartão itau") e
 * não existe campo no movimento dizendo "isto é cartão".
 * ========================================================================== */

create or replace function public.omie_titulos_sem_texto(
  p_limite    int     default 500,
  p_so_cartao boolean default true
)
returns table (cod_titulo bigint, dt date, contraparte text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with cli as (
    select distinct on (c->>'codigo')
      c->>'codigo' as codigo,
      c->>'nome'   as nome
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  base as (
    select
      (det->>'nCodTitulo')::bigint as cod,
      to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtVenc'), ''), 'DD/MM/YYYY') as dt,
      cli.nome as nome
    from mov
    left join cli on cli.codigo = det->>'nCodCliente'
    -- Só conta a pagar: é o único grupo que `ConsultarContaPagar` responde.
    where det->>'cGrupo' = 'CONTA_A_PAGAR'
      and nullif(det->>'nCodTitulo', '') is not null
  ),
  agrupado as (
    select cod, max(dt) as dt, min(nome) as nome
    from base
    where not p_so_cartao
       or (unaccent(lower(coalesce(nome, ''))) like '%cartao%'
           and (unaccent(lower(coalesce(nome, ''))) like '%lancamento%'
             or unaccent(lower(coalesce(nome, ''))) like '%fatura%'))
    group by cod
  )
  select a.cod, a.dt, a.nome
  from agrupado a
  where not exists (select 1 from omie_titulo_texto t where t.cod_titulo = a.cod)
  order by a.dt desc nulls last, a.cod desc
  limit greatest(1, least(coalesce(p_limite, 500), 5000));
$$;

comment on function public.omie_titulos_sem_texto(int, boolean) is
  'Títulos de cartão (conta a pagar) sem texto lido do Omie, do mais recente ao mais antigo. Fila da edge function omie-titulo-texto.';

-- Função nova em `public` nasce chamável sem login (o `anon` herda o grant do
-- PUBLIC): esta é da tela logada e do cron, não da rua.
revoke execute on function public.omie_titulos_sem_texto(int, boolean) from anon;
grant  execute on function public.omie_titulos_sem_texto(int, boolean) to authenticated, service_role;

/* O cron chama a edge function com este token — mesmo padrão das demais funções
   que exigem usuário logado quando o pedido vem da tela. */
insert into public.internal_cron_tokens (name, token)
values ('omie-titulo-texto', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

/* ----------------------------------------------------------------------------
 * A VARREDURA DIÁRIA — é ela que tira a espera da frente da pessoa.
 *
 * Medido em 12/08/2026 contra a API real: `ListarContasPagar` com
 * `exibir_obs: "S"` devolve a observação em lote — as 4.808 contas a pagar da
 * empresa em 49 páginas, 68 segundos. Título a título custaria 4.808 × 460 ms
 * (mais de meia hora), e é o que a tela vinha fazendo, 100 por vez, com a pessoa
 * esperando.
 *
 * 09:20 BRT (12:20 UTC): depois do omie-orcamento-sync (08:00) e do
 * omie-contas-pagar-sync (08:20), porque um título só aparece no drill-down
 * depois de entrar no cache de movimentos.
 * -------------------------------------------------------------------------- */
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

select cron.unschedule('omie-titulo-texto-varredura-diaria') where exists (
  select 1 from cron.job where jobname = 'omie-titulo-texto-varredura-diaria'
);
select cron.schedule(
  'omie-titulo-texto-varredura-diaria',
  '20 12 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-titulo-texto',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'omie-titulo-texto')
    ),
    body := jsonb_build_object('modo', 'varredura', 'trigger', 'cron', 'max', 200, 'orcamento_ms', 220000),
    timeout_milliseconds := 240000
  );
  $cron$
);
