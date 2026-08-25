-- O lojista do cartão passa a estar escrito DENTRO do Omie.
--
-- O PROBLEMA. No contas a pagar, todo gasto de cartão entra com a contraparte
-- "Lancamento Fatura Cartao" — 2.146 títulos só entre abril e agosto. Quem abre
-- o ERP vê uma coluna inteira com o mesmo nome genérico e R$ 837 mil espalhados
-- nela. O lojista existe, mas enterrado na observação, depois de um "|", em
-- colunas posicionais que ninguém lê a olho:
--
--   Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.|Hubspot Inc.V  888-48
--
-- Resolver isso só na tela do Hub não resolve o problema de quem pediu: a
-- exigência é que o ERP seja a fonte, e no ERP o nome não está em lugar nenhum
-- que se leia.
--
-- ONDE ESCREVER. `numero_documento` — 20 caracteres, aparece na listagem do
-- contas a pagar, e está VAZIO em todo título de cartão (conferido: dos 1.447
-- títulos com documento preenchido na base, nenhum é de cartão; o próprio
-- `montarTitulo` do Hub deixa o campo de fora "porque é o que a prática faz").
-- Campo vazio, visível e sem semântica disputada é o melhor lugar para pôr um
-- nome. `nota_fiscal` NÃO serve: significa outra coisa e poluiria a métrica de
-- cobertura que esta mesma tela publica.
--
-- QUEM LÊ O MEMO. `_shared/cartao-memo.ts`, o MESMO leitor que o front usa — ele
-- desceu de `src/lib/cartao/ofx.ts` para `_shared/` justamente para poder ser
-- usado dos dois lados. Não há um segundo parser, nem aqui em SQL: esta migration
-- só entrega o texto cru para a Edge Function ler.

/* ============================================================================
 *  O registro do que foi escrito
 * ========================================================================== */

create table if not exists public.omie_titulo_nome_cartao (
  cod_titulo   bigint primary key,
  -- o que foi (ou seria) escrito em numero_documento, já cortado em 20
  documento    text,
  -- o lojista inteiro, antes do corte — é o que permite conferir depois
  lojista      text,
  -- 'apelido' quando o nome veio da Parametrização, 'fatura' quando veio do MEMO
  origem       text,
  escrito_em   timestamptz,
  erro         text,
  tentativas   integer not null default 0,
  atualizado_em timestamptz not null default now()
);

comment on table public.omie_titulo_nome_cartao is
  'O nome do lojista escrito no numero_documento do título de cartão no Omie. Uma linha por título: com escrito_em preenchido está no ERP; com erro, não foi e diz por quê.';
comment on column public.omie_titulo_nome_cartao.erro is
  'A recusa do Omie. "Período contábil fechado" é a mais comum e NÃO é bug: é o ERP dizendo que a correção tem de passar por quem controla o fechamento.';

create index if not exists omie_titulo_nome_cartao_pendente_idx
  on public.omie_titulo_nome_cartao (atualizado_em) where escrito_em is null;

revoke all on public.omie_titulo_nome_cartao from anon, authenticated;
grant select on public.omie_titulo_nome_cartao to authenticated;
grant all    on public.omie_titulo_nome_cartao to service_role;

alter table public.omie_titulo_nome_cartao enable row level security;
drop policy if exists "nome_cartao_leitura" on public.omie_titulo_nome_cartao;
create policy "nome_cartao_leitura" on public.omie_titulo_nome_cartao
  for select to authenticated using (true);

/* ============================================================================
 *  A fila — quem ainda não tem nome no ERP
 * ========================================================================== */

create or replace function public.cartao_nome_fila(p_limite integer default 40)
returns table(
  cod_titulo bigint, favorecido_cru text, observacao text,
  valor numeric, competencia date, documento_atual text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
select t.cod_titulo, t.favorecido_cru, tx.observacao, t.valor, t.competencia, t.documento
from public.cap_titulos t
join public.omie_titulo_texto tx on tx.cod_titulo = t.cod_titulo
left join public.omie_titulo_nome_cartao n on n.cod_titulo = t.cod_titulo
where public.eh_cartao(t.favorecido_cru)
  -- Só há o que escrever se houver o que ler.
  and coalesce(tx.observacao, '') <> ''
  -- Documento já preenchido? Então alguém (ou nós) já resolveu; não sobrescreve.
  and coalesce(t.documento, '') = ''
  -- Já escrito com sucesso não volta. Erro volta, mas com paciência: três
  -- tentativas bastam para separar "o Omie estava ocupado" de "o mês está
  -- fechado", e insistir no segundo caso é gastar chamada todo dia para sempre.
  and n.escrito_em is null
  and coalesce(n.tentativas, 0) < 3
-- O mais recente primeiro: é a fatura que alguém está olhando agora, e é a que
-- tem mais chance de estar em mês aberto.
order by t.competencia desc nulls last, t.valor desc
limit greatest(coalesce(p_limite, 40), 1);
$function$;

comment on function public.cartao_nome_fila(integer) is
  'Títulos de cartão sem nome no numero_documento do Omie. Entrega a observação crua; quem lê o MEMO é a Edge Function, com o parser único de _shared/cartao-memo.ts.';

/* ============================================================================
 *  O apelido de um punhado de nomes, em uma chamada
 * ==========================================================================
 * A Edge Function extrai o lojista de um lote inteiro e pergunta os apelidos de
 * uma vez. Uma consulta por título seria uma rajada de idas ao banco para
 * responder o que cabe numa. */

create or replace function public.contraparte_apelido_de(p_nomes text[])
returns table(nome text, apelido text)
language sql
stable
security definer
set search_path to 'public'
as $function$
select n.nome, ap.apelido
from unnest(coalesce(p_nomes, '{}')) as n(nome)
left join lateral (
  select a.apelido
  from public.contraparte_apelido a
  where a.via = 'nome'
    and a.apelido is not null
    and a.chave = public.contraparte_chave(n.nome)
  limit 1
) ap on true;
$function$;

comment on function public.contraparte_apelido_de(text[]) is
  'O apelido da Parametrização para uma lista de nomes, em uma chamada. Casamento por chave de nome — o lojista do cartão não tem CNPJ.';

/* ---------------------------------- cron ---------------------------------- */

insert into public.internal_cron_tokens (name)
select 'omie-cartao-nome'
where not exists (select 1 from public.internal_cron_tokens where name = 'omie-cartao-nome');

select cron.unschedule('omie-cartao-nome')
where exists (select 1 from cron.job where jobname = 'omie-cartao-nome');

-- De 30 em 30 minutos, e fora dos minutos da varredura de anexos (7/27/47): as
-- duas falam com o Omie, e a trava dele é POR MÉTODO — deixá-las no mesmo minuto
-- só faria uma esperar a outra.
select cron.schedule(
  'omie-cartao-nome',
  '17,47 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-cartao-nome',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'omie-cartao-nome')
    ),
    body := '{"action":"aplicar","limite":40}'::jsonb
  );
  $cron$
);

revoke all on function public.cartao_nome_fila(integer) from anon;
revoke all on function public.contraparte_apelido_de(text[]) from anon;
grant execute on function public.contraparte_apelido_de(text[]) to authenticated;
