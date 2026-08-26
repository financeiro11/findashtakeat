-- A varredura de anexos: o ritmo que ela mantém para sempre, e a porta que ficou aberta.
--
-- O QUE ACONTECEU EM 25/08/2026. O botão "Varrer o ERP" devolveu
-- "Edge Function returned a non-2xx status code" na cara de quem clicou. No log
-- do worker, o motivo real:
--
--     cap_anexos_fila: <!DOCTYPE html> … <title>supabase.co | 520</title>
--
-- Não foi o Postgres: a mesma consulta roda em 390 ms. Foi o PostgREST/gateway
-- devolvendo uma PÁGINA DE ERRO DA CLOUDFLARE depois de 36 segundos, enquanto o
-- banco estava ocupado com as outras varreduras. A função tratava isso como
-- falha definitiva, abortava a rodada inteira e devolvia 500 — e o supabase-js
-- ainda trocava a mensagem por aquela frase que não diz nada.
--
-- DUAS COISAS MUDAM AQUI:
--
--   1. O RITMO PERMANENTE. Título que o Omie já respondeu "não tem anexo" volta
--      para a fila a cada `releitura_dias` — para sempre. Hoje isso são 1.322
--      títulos, e todos são de abril/26 para cá, então não incomoda. Daqui a um
--      ano são os mesmos 1.322 mais os de 2027, e um título de abril/26 pago,
--      fechado e sem nota há um ano NÃO vai ganhar uma agora. Reler é gastar a
--      trava por método do Omie — a mesma que o envio de comprovante disputa, e
--      de onde saíram os três 425 das 17h27. Passa a haver um teto de idade:
--      depois dele, a leitura vale como definitiva. Título NUNCA lido não é
--      afetado por isto — esse entra na fila com qualquer idade.
--
--   2. A PORTA, E O REVOKE QUE NÃO FECHAVA NADA. `cap_anexos_fila`,
--      `cap_anexo_revisar` e `auditoria_envio_quase_la` estão executáveis por
--      `anon` neste momento — medido no banco, não suposto. As tabelas por baixo
--      estão fechadas, mas as funções são `security definer`, então passam por
--      cima: com a anon key (que é pública, está no bundle) dava para listar o
--      contas a pagar inteiro e até gravar veredito de revisão.
--
--      E o motivo de continuar aberto depois de tantos `revoke ... from anon` é
--      o ACL, que diz o seguinte:
--
--          {=X/postgres, postgres=X/postgres, authenticated=X/postgres, …}
--           ↑ este é o PUBLIC
--
--      `anon` nunca teve concessão PRÓPRIA: ele executa pelo PUBLIC. E REVOKE só
--      tira concessão explícita — `revoke from anon` aí é uma instrução que roda
--      sem erro e não muda nada. O que fecha é `revoke ... from public`, e é
--      seguro porque `authenticated` e `service_role` têm concessão própria e
--      sobrevivem ao revoke.

/* ============================================================================
 *  1. O teto de idade da releitura
 * ========================================================================== */

alter table public.cap_notas_config
  add column if not exists releitura_max_dias integer not null default 120;

comment on column public.cap_notas_config.releitura_max_dias is
  'Depois de quantos dias de competência a leitura "não tem anexo" passa a valer como definitiva e o título para de voltar à fila. Não afeta quem nunca foi lido.';

create or replace function public.cap_anexos_fila(p_limite integer default 60)
returns table(cod_titulo bigint, valor numeric, competencia date, situacao text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with cfg as (
  select releitura_dias, releitura_max_dias from public.cap_notas_config where id = 1
),
lido as (select cod_titulo, retentar from public.omie_titulo_anexo)
select t.cod_titulo, t.valor, t.competencia, t.situacao
from public.cap_titulos t
left join lido l on l.cod_titulo = t.cod_titulo
where t.regra = 'exige'
  and (
    -- Nunca perguntamos. Entra com qualquer idade: "não verificado" é o estado
    -- que segura a cobertura como piso, e ele só sai daqui.
    t.anexo_lido_em is null
    -- Falhou por algo que passa (rate limit): volta. Recusa de negócio do Omie
    -- ("documento não cadastrado") entra com retentar = false e não volta nunca.
    or (t.erro_leitura is not null and coalesce(l.retentar, true))
    -- Não tinha anexo, a leitura envelheceu E o título ainda é novo o bastante
    -- para alguém anexar alguma coisa nele. Passado o teto, a resposta do Omie
    -- vale como definitiva — reler não mudaria o número e gasta a trava da API.
    or (t.erro_leitura is null
        and coalesce(t.anexos_no_erp, 0) = 0
        and t.anexo_lido_em < now() - make_interval(days => (select releitura_dias from cfg))
        and coalesce(t.competencia, current_date)
            >= current_date - (select releitura_max_dias from cfg))
  )
order by (t.anexo_lido_em is not null), t.competencia desc nulls last, t.valor desc
limit greatest(coalesce(p_limite, 60), 1);
$function$;

comment on function public.cap_anexos_fila(integer) is
  'Títulos que exigem nota e cuja leitura de anexo no Omie está faltando, falhou de um jeito que volta, ou envelheceu num título ainda recente. Consumida pela Edge Function omie-anexos-varredura.';

/* Quanto ainda falta, sem trazer as linhas.
 *
 * A varredura precisa disto para dizer na tela "restam 744" em vez de deixar
 * quem clicou adivinhar se a rodada resolveu tudo ou só um pedaço. Chama a
 * própria fila com teto alto de propósito: uma segunda cópia do critério é uma
 * segunda coisa para desatualizar, e o custo é o mesmo — a varredura já paga
 * essa varrida uma vez por rodada. */
create or replace function public.cap_anexos_fila_total()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
select count(*) from public.cap_anexos_fila(2147483647);
$function$;

comment on function public.cap_anexos_fila_total() is
  'Quantos títulos ainda faltam ser lidos no Omie. Mesmo critério de cap_anexos_fila, sem materializar as linhas na resposta.';

/* ============================================================================
 *  2. Sair da frente do envio de comprovante
 * ==========================================================================
 * A trava do Omie é POR MÉTODO, e as duas varreduras batem no MESMO método:
 * esta lê `ListarAnexo` título a título, e `omie-anexar-comprovante` chama
 * `contarAnexos` (que é `ListarAnexo`) duas vezes por anexo — antes e depois de
 * subir, para confirmar que colou.
 *
 * Os horários se atropelavam: o envio começa em :05, :20, :35 e :50 e a rodada
 * dele passa dos 100 segundos; a leitura entrava em :07, dois minutos depois,
 * em cima. Daí saíram os três "API bloqueada por consumo indevido" das 17h27 —
 * e cada um deles custa até 18 segundos de backoff dentro da janela de 100s da
 * rodada, ou seja, títulos que deixaram de ser lidos por causa do horário.
 *
 * :12, :27 e :42 é sempre sete minutos depois de um envio começar e cinco antes
 * do próximo — a leitura cabe inteira no vão. Mesma frequência, mesmo teto por
 * rodada: só o relógio muda. */

select cron.unschedule('omie-anexos-varredura')
where exists (select 1 from cron.job where jobname = 'omie-anexos-varredura');

select cron.schedule(
  'omie-anexos-varredura',
  '12,27,42 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-anexos-varredura',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'omie-anexos-varredura')
    ),
    body := '{"action":"varrer","limite":150}'::jsonb
  );
  $cron$
);

/* ============================================================================
 *  3. Fechar a porta que o `create or replace` reabriu
 * ==========================================================================
 * Uma assinatura por linha: REVOKE em bloco não alcança a assinatura, e a
 * função continuaria pública sem ninguém notar. E é `from public`, não só
 * `from anon` — ver a explicação do ACL lá em cima. */

revoke all on function public.cap_notas_resumo(date, date)      from anon, public;
revoke all on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer)
                                                                from anon, public;
revoke all on function public.cap_anexos_fila(integer)          from anon, public;
revoke all on function public.cap_anexos_fila_total()           from anon, public;
revoke all on function public.cap_anexo_revisar(bigint, text)   from anon, public;
revoke all on function public.auditoria_envio_quase_la(integer) from anon, public;
revoke all on function public.cap_gravidade(numeric)            from anon, public;
revoke all on function public.anexo_classe(text)                from anon, public;
revoke all on function public.cap_regra_sugerida(text, text)    from anon, public;
revoke all on function public.contraparte_chave(text)           from anon, public;

-- E de volta a quem precisa. A fila é consumida pela Edge Function, que fala
-- como service_role; a tela precisa do resumo, da lista, do revisar e do
-- "falta um passo".
grant execute on function public.cap_notas_resumo(date, date)      to authenticated, service_role;
grant execute on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer)
                                                                   to authenticated, service_role;
grant execute on function public.cap_anexo_revisar(bigint, text)   to authenticated, service_role;
grant execute on function public.auditoria_envio_quase_la(integer) to authenticated, service_role;
grant execute on function public.cap_anexos_fila(integer)          to service_role;
grant execute on function public.cap_anexos_fila_total()           to authenticated, service_role;
