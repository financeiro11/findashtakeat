/* ---------------------------------------------------------------------------
 * O AVISO DO ASAAS CHEGA AO SINO E À EMISSÃO (16/09/2026).
 *
 * Desde 15/09/2026 o `asaas-webhook` grava o espelho `asaas_cache` segundos
 * depois de cada mudança no Asaas. Quatro coisas dependiam do espelho estar
 * atrasado, ou não sabiam dele:
 *
 *   1) CHARGEBACK no Sino. A contestação no cartão tem prazo de resposta, e até
 *      hoje só aparecia como status numa linha. Um gatilho no espelho abre o
 *      sinal no minuto em que o status entra em contestação — qualquer escritor
 *      (webhook ou varredura) serve — e fecha quando sai.
 *   2) O WEBHOOK É VIGIADO. Depois de 15 falhas seguidas o Asaas INTERROMPE a
 *      fila e o Hub volta, calado, a depender só das varreduras. Silêncio de 3h
 *      em horário comercial ou evento com erro nas últimas 24h viram sinal.
 *   3) A ESTORNOS-SYNC SAI DA API NO DIA A DIA. Os três crons diários seguem
 *      iguais (o padrão da função virou a fonte "espelho"); entra uma rodada
 *      SEMANAL na fonte "api", que é a rede e a única que apaga estorno
 *      cancelado. Ver o cabeçalho de `supabase/functions/estornos-sync`.
 *   4) A EMISSÃO NÃO ESPERA MAIS A VARREDURA. A janela 13h–21h UTC existia
 *      porque "emitir antes da asaas-sync das 12:15 é emitir sobre os dados de
 *      ontem" — com o webhook, isso deixou de ser verdade. Ganha a manhã (07:00–
 *      08:40 BRT, antes do preparo de cadastros das 08:45) e a última hora da
 *      tarde (até 19:50 BRT). Emissão e espelho andam JUNTOS, como sempre.
 *
 * O que NÃO muda aqui, de propósito: as varreduras `asaas-sync` e `janela`
 * seguem três vezes por dia. Só se reduzem depois de alguns dias de diário do
 * webhook sem erro — e é o vigia do item 2 que vai dizer isso.
 * ------------------------------------------------------------------------- */

-- ---------------------------------------------------------------------------
-- As séries. `modulo` e `rota` são o que o Sino agrupa e para onde leva.
-- ---------------------------------------------------------------------------
insert into public.sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, ativa)
values
  ('asaas.chargeback', 'asaas', 'Cobrança contestada no cartão',
   'Cobrança do Asaas que entrou em contestação (chargeback). Produtor determinístico: um gatilho no '
   'espelho asaas_cache abre o sinal quando o status entra em CHARGEBACK_* e fecha quando sai.',
   '/asaas', 'acima', 'alta', true),
  ('asaas.webhook', 'automacoes', 'Aviso do Asaas parado ou com erro',
   'O webhook do Asaas deixou de chegar em horário comercial, ou gravou evento com erro. Sem ele, o '
   'espelho volta a depender só das varreduras (3× ao dia). Produtor: asaas_webhook_vigiar(), de hora em hora.',
   '/monitoramento/automacoes', 'acima', 'alta', true)
on conflict (serie) do update
  set modulo = excluded.modulo, titulo = excluded.titulo, descricao = excluded.descricao,
      rota = excluded.rota, gravidade = excluded.gravidade, atualizado_em = now();

-- ---------------------------------------------------------------------------
-- 1) Chargeback.
--
-- NUNCA DERRUBA A GRAVAÇÃO. O gatilho roda dentro do upsert do webhook; um erro
-- aqui viraria "erro de dado" lá, que o webhook responde 200 e não repete — a
-- cobrança ficaria fora do espelho por causa de um aviso. Por isso o bloco
-- engole a exceção e só registra.
--
-- SÓ TRANSIÇÃO. As 13 cobranças que já estavam em contestação em 16/09/2026 não
-- ganham sinal retroativo: parte delas é de mês fechado que nenhuma varredura
-- revisita, e o status no espelho pode estar velho.
-- ---------------------------------------------------------------------------
create or replace function public.asaas_sinal_chargeback()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_assinatura text := 'asaas.chargeback:' || new.id_asaas;
  v_rotulo text;
begin
  begin
    if new.status in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then
      v_rotulo := case new.status
        when 'CHARGEBACK_REQUESTED' then 'contestação recebida'
        when 'CHARGEBACK_DISPUTE' then 'em disputa'
        else 'aguardando a reversão'
      end;

      -- Já aberto: só acompanha a fase, sem abrir outro.
      update public.sinais
         set medida = jsonb_build_object('status', new.status),
             titulo = regexp_replace(titulo, '— [^—]*$', '— ' || v_rotulo),
             atualizado_em = now()
       where assinatura = v_assinatura and resolvido_em is null;

      if not found then
        insert into public.sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade, medida)
        select
          'asaas.chargeback', new.id_asaas, v_assinatura,
          coalesce(nullif(cli.nome, ''), 'Cliente sem nome no espelho') || ' contestou uma cobrança no cartão — ' || v_rotulo,
          /* O `to_char` segue o `lc_numeric` do servidor (`C`): a troca em dois
             passos inverte os separadores — mesmo truque de 20260911120000. */
          'R$ ' || replace(replace(replace(
                     to_char(coalesce(new.valor, 0), 'FM999,999,990.00'),
                     ',', '#'), '.', ','), '#', '.') ||
            coalesce(' · vencimento ' || to_char(new.data_vencimento, 'DD/MM/YYYY'), '') ||
            coalesce(' · ' || nullif(new.dados->>'description', ''), '') ||
            ' · cobrança ' || new.id_asaas || '.',
          'Abra a cobrança no Asaas e responda à contestação dentro do prazo que ele indica. '
            'O aviso fecha sozinho quando a contestação terminar.',
          new.valor,
          'alta',
          jsonb_build_object('status', new.status)
        from (select 1) um
        left join public.asaas_cache cli
          on cli.tipo = 'customer' and cli.id_asaas = new.dados->>'customer';
      end if;
    else
      update public.sinais
         set resolvido_em = now(), atualizado_em = now(),
             medida = coalesce(medida, '{}'::jsonb) || jsonb_build_object('desfecho', new.status)
       where assinatura = v_assinatura and resolvido_em is null;
    end if;
  exception when others then
    raise warning 'asaas_sinal_chargeback(%): %', new.id_asaas, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.asaas_sinal_chargeback() from public, anon, authenticated;

drop trigger if exists asaas_cache_chargeback_ins on public.asaas_cache;
create trigger asaas_cache_chargeback_ins
  after insert on public.asaas_cache
  for each row
  when (new.tipo = 'payment'
        and new.status in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'))
  execute function public.asaas_sinal_chargeback();

-- `update of status` + o `when` com OLD: o upsert do espelho reescreve todas as
-- colunas, e sem a comparação o gatilho rodaria em cada uma das ~8 mil linhas
-- que as varreduras tocam por dia.
drop trigger if exists asaas_cache_chargeback_upd on public.asaas_cache;
create trigger asaas_cache_chargeback_upd
  after update of status on public.asaas_cache
  for each row
  when (new.tipo = 'payment'
        and new.status is distinct from old.status
        and (new.status in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL')
             or old.status in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL')))
  execute function public.asaas_sinal_chargeback();

-- ---------------------------------------------------------------------------
-- 2) O vigia do webhook.
--
-- 3 HORAS, SÓ EM DIA ÚTIL DAS 09h ÀS 19h BRT. Medido no primeiro dia (15–16/09):
-- 345 eventos, o maior intervalo em horário comercial foi 42 min, e o da
-- madrugada 62 min. Três horas de silêncio no expediente não é calmaria.
--
-- ERRO = `resultado = 'erro'` (a gravação no espelho falhou). O `erro` anotado
-- num evento 'gravado' (cliente ou estorno em segundo plano) não conta: a
-- cobrança entrou, e a varredura completa o resto.
-- ---------------------------------------------------------------------------
create or replace function public.asaas_webhook_vigiar()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ultimo timestamptz;
  v_erros integer;
  v_exemplo text;
  v_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_expediente boolean;
  v_silencio boolean;
begin
  select max(recebido_em) into v_ultimo from public.asaas_webhook_eventos;
  select count(*), max(evento || ' ' || coalesce(objeto_id, '') || ': ' || left(coalesce(erro, ''), 160))
    into v_erros, v_exemplo
    from public.asaas_webhook_eventos
   where resultado = 'erro' and recebido_em > now() - interval '24 hours';

  v_expediente := extract(isodow from v_local) between 1 and 5
              and extract(hour from v_local) between 9 and 18;
  v_silencio := v_ultimo is null or v_ultimo < now() - interval '3 hours';

  -- Silêncio: abre só no expediente; fecha assim que voltar a chegar.
  if v_expediente and v_silencio then
    insert into public.sinais (serie, chave, assinatura, titulo, corpo, acao, gravidade, medida)
    select 'asaas.webhook', 'silencio', 'asaas.webhook:silencio',
           'O Asaas parou de avisar o Hub',
           'Nenhum evento do webhook desde ' ||
             coalesce(to_char(v_ultimo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'sempre') ||
             '. Sem o aviso, cobranças novas, pagas ou editadas só entram nas varreduras (07:45, 12:30 e 17:00).',
           'Em Asaas › Integrações › Webhooks, veja se o webhook "Hub Financeiro - espelho asaas_cache" está '
             'interrompido; se estiver, reative (os eventos ficam guardados 14 dias). O aviso fecha sozinho '
             'quando os eventos voltarem.',
           'alta',
           jsonb_build_object('ultimo_evento', v_ultimo)
     where not exists (select 1 from public.sinais
                        where assinatura = 'asaas.webhook:silencio' and resolvido_em is null);
  elsif not v_silencio then
    update public.sinais set resolvido_em = now(), atualizado_em = now()
     where assinatura = 'asaas.webhook:silencio' and resolvido_em is null;
  end if;

  if v_erros > 0 then
    update public.sinais
       set medida = jsonb_build_object('erros_24h', v_erros), valor = v_erros, atualizado_em = now()
     where assinatura = 'asaas.webhook:erros' and resolvido_em is null;
    if not found then
      insert into public.sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade, medida)
      values ('asaas.webhook', 'erros', 'asaas.webhook:erros',
              'Aviso do Asaas que não gravou',
              v_erros || ' evento(s) do webhook não entraram no espelho nas últimas 24h. Exemplo: ' ||
                coalesce(v_exemplo, '—') || '. A varredura seguinte cura a linha; o que se repete é defeito.',
              'O diário é a tabela asaas_webhook_eventos (resultado = ''erro''). Se o erro for o mesmo em vários '
                'eventos, é conserto de código ou de esquema, não de dado.',
              v_erros, 'media', jsonb_build_object('erros_24h', v_erros));
    end if;
  else
    update public.sinais set resolvido_em = now(), atualizado_em = now()
     where assinatura = 'asaas.webhook:erros' and resolvido_em is null;
  end if;

  return jsonb_build_object('ultimo_evento', v_ultimo, 'silencio', v_silencio,
                            'expediente', v_expediente, 'erros_24h', v_erros);
end;
$$;

revoke all on function public.asaas_webhook_vigiar() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'asaas-webhook-vigia';
select cron.schedule('asaas-webhook-vigia', '33 * * * *', $$ select public.asaas_webhook_vigiar(); $$);

-- ---------------------------------------------------------------------------
-- 3) Estornos: a rodada semanal pela API.
--
-- Domingo 06:00 e 06:12 BRT (09:00/09:12 UTC), longe dos crons do Asaas (o
-- primeiro do dia é 07:45 BRT). Duas voltas porque a fonte "api" corta pelo
-- relógio dos 150s e retoma pelo cursor: com ~35s por fatia, duas rodadas dão a
-- volta nas 5 fatias. Nome do cron = nome no histórico, para o painel de
-- automações ligar os dois.
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'estornos-sync-asaas-semanal';
select cron.schedule('estornos-sync-asaas-semanal', '0,12 9 * * 0', $cmd$
  select public.disparar_automacao(
    'estornos-sync-asaas-semanal',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/estornos-sync',
    jsonb_build_object('action', 'atualizar', 'fonte', 'api', 'trigger', 'cron'),
    'estornos-sync',
    jsonb_build_object('apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U')
  );
$cmd$);

-- ---------------------------------------------------------------------------
-- 4) A emissão ganha a manhã e o fim da tarde.
--
-- A manhã é um cron À PARTE (e não um horário a mais no principal) porque
-- precisa parar às 08:40 BRT: das 08:45 às 08:58 rodam o `nf-preparo-*` e às
-- 09:45 o `omie-clientes-criar-diario`, que também falam com o Omie. Os
-- `:50` ficam de fora pelo mesmo motivo (e pelo `asaas-sync-diario-1` às 07:45).
--
-- A `omie-clientes-criar` foi escrita para deixar o cadastro pronto "antes das
-- 13h". A manhã não fura isso: cobrança recusada por cadastro fica 24h fora da
-- fila (`nfse_carencia`), então a rodada das 07:00 não retenta a recusa de ontem
-- antes do conserto; e cadastro não conferido nem entra na fila.
-- ---------------------------------------------------------------------------
select cron.alter_job((select jobid from cron.job where jobname = 'nf-emissao-diaria'),
                      schedule := '0,10,20,30,40,50 13-22 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'nf-espelho-rodada'),
                      schedule := '5,15,25,35,45,55 13-22 * * *');

select cron.unschedule(jobid) from cron.job where jobname in ('nf-emissao-manha', 'nf-espelho-manha');
select cron.schedule('nf-emissao-manha', '0,10,20,30,40 10-11 * * *', $cmd$
  select public.disparar_automacao(
    'nf-emissao-manha',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-nfse-sync',
    '{"action":"emitir_dia"}'::jsonb,
    'omie-nfse-sync',
    jsonb_build_object('apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U')
  );
$cmd$);
select cron.schedule('nf-espelho-manha', '5,15,25,35,45 10-11 * * *', $cmd$
  select public.disparar_automacao(
    'nf-espelho-manha',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-nfse-sync',
    '{"action":"espelhar","teto_status":40,"so_se_houver_forno":true,"anexar":false}'::jsonb,
    'omie-nfse-sync',
    jsonb_build_object('apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U')
  );
$cmd$);
