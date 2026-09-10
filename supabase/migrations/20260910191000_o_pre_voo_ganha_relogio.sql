/* ---------------------------------------------------------------------------
 * O PRÉ-VOO GANHA RELÓGIO — a esteira que existia e nunca partia.
 *
 * A LACUNA, mapeada em 09/09/2026. Três peças do conserto preventivo estavam
 * escritas, testadas e paradas:
 *
 *   • `nfse_preparo_montar()` — monta a fila de quem vai falhar — sem UM
 *     chamador. Nem TS, nem cron. A fila só existia se alguém a montasse à mão.
 *   • a ação `preparar` da `omie-clientes-criar` — que consome essa fila e
 *     conserta o cadastro ANTES da recusa — sem cron e sem botão.
 *   • e agora `validar_ceps`, que sem cron nasceria com o mesmo destino.
 *
 * O efeito de estarem paradas é o que se mediu: o único conserto que rodava
 * sozinho era o REATIVO (`corrigirRecusados`, pendurado na ação `criar` das
 * 12:45 UTC), que só age depois de a prefeitura ter recusado — isto é, depois de
 * a receita ter entrado sem nota. Todo o desenho preventivo estava construído e
 * desligado.
 *
 * A ORDEM DAS QUATRO CHAMADAS É A REGRA, e por isso os horários são fixos e
 * espaçados em vez de um job só:
 *
 *   11:20  validar_ceps ...... pergunta aos Correios quais CEPs não existem
 *   11:35  validar_ceps ...... segunda leva (uma cabe ~350 no relógio)
 *   11:45  nfse_preparo_montar  monta a fila COM a resposta de cima
 *   11:50  preparar .......... conserta os 40 de maior valor
 *   11:58  preparar .......... mais 40
 *   12:45  criar (já existia)   cadastra o que falta + conserta os recusados
 *
 * Montar a fila antes de validar produziria a fila da régua velha: quem entra
 * nela é `cep_valido is false`, e sem a varredura todo mundo é `null`. É a mesma
 * razão pela qual o `preparar` vem depois do `montar`, e não junto.
 *
 * 11:20 UTC = 08:20 BRT. O pg_cron lê a agenda em UTC, e escrever horário de
 * Brasília aqui já fez cron rodar três horas antes sem sintoma nenhum.
 *
 * `p_timeout_ms` de 150000: as duas ações têm orçamento interno de ~100-110s e
 * o padrão do `disparar_automacao` é 90s — com ele, o pg_net registraria timeout
 * numa rodada que terminou bem, e a faixa de automações mostraria vermelho sem
 * motivo. Alarme que soa à toa é alarme que se aprende a ignorar.
 * ------------------------------------------------------------------------- */

create extension if not exists pg_cron with schema cron;

do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('nf-cep-validar-1', '20 11 * * *', '{"action":"validar_ceps","teto":400}'),
      ('nf-cep-validar-2', '35 11 * * *', '{"action":"validar_ceps","teto":400}'),
      ('nf-preparo-1',     '50 11 * * *', '{"action":"preparar","teto":40}'),
      ('nf-preparo-2',     '58 11 * * *', '{"action":"preparar","teto":40}')
    ) as t(nome, quando, corpo)
  loop
    if exists (select 1 from cron.job where jobname = j.nome) then perform cron.unschedule(j.nome); end if;
    /* `p_token_nome` PREENCHIDO. É o defeito que já deixou quatro jobs do radar
       respondendo "Não autenticado." por dias, com `cron.job_run_details`
       dizendo "succeeded" e `automacao_execucao` sem uma linha: o token de cron
       só é injetado quando se passa o NOME dele. */
    perform cron.schedule(j.nome, j.quando, format($cmd$
      select public.disparar_automacao(
        %L,
        'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-clientes-criar',
        %L::jsonb,
        'omie-clientes-criar',
        '{}'::jsonb,
        150000
      );
    $cmd$, j.nome, j.corpo));
  end loop;
end $$;

/* A montagem da fila é função do próprio Postgres — não precisa de HTTP, de
   token nem de Edge Function. Chamar `disparar_automacao` para ela seria dar uma
   volta pela internet para escrever numa tabela ao lado. */
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nf-preparo-montar') then
    perform cron.unschedule('nf-preparo-montar');
  end if;
  perform cron.schedule('nf-preparo-montar', '45 11 * * *',
    $cmd$ select public.nfse_preparo_montar(); $cmd$);
end $$;
