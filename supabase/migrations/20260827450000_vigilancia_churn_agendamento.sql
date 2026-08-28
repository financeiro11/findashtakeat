-- O agendamento das duas rodadas novas, e os tokens que as autenticam.
--
-- O TOKEN VEM PRIMEIRO, e não é burocracia: as funções exigem `x-cron-token` ou
-- gente logada, e `disparar_automacao` só injeta o cabeçalho quando recebe o
-- NOME do token. Foi exatamente esse o defeito que deixou o radar de preços
-- quatro dias sem varrer — os jobs passavam `p_token_nome = null`, a função
-- respondia "Não autenticado" e o `cron.job_run_details` dizia "succeeded",
-- porque o SQL que enfileira o POST funcionou. Um agendamento que não roda
-- parece um agendamento que rodou e não achou nada.
--
-- OS HORÁRIOS ESTÃO EM UTC porque é assim que o pg_cron os lê. A pegadinha já
-- custou dias de varredura no horário errado; os comentários repetem a conversão
-- em cada bloco de propósito.

/* ------------------------------------------------------------- os tokens */

insert into public.internal_cron_tokens (name, token)
values
  ('vigilancia-mudancas', encode(gen_random_bytes(24), 'hex')),
  ('churn-sinal-externo', encode(gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

/* ------------------------------------------------- vigilância de páginas */

-- 09:20 UTC = 06:20 BRT. Antes do expediente: quem abrir o Hub de manhã já
-- encontra o aviso do reajuste, e a rodada não disputa relógio com as outras
-- automações da manhã (o radar varre às 08:45 BRT).
--
-- UMA VEZ POR DIA, E SÓ. Página de preço de fornecedor não muda de hora em hora;
-- duas leituras diárias dobrariam a conta para descobrir a mesma coisa meio dia
-- antes — e "meio dia antes" não muda decisão nenhuma sobre um reajuste que vai
-- aparecer na fatura do mês que vem.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vigilancia-mudancas-diaria') then
    perform cron.unschedule('vigilancia-mudancas-diaria');
  end if;
  perform cron.schedule('vigilancia-mudancas-diaria', '20 9 * * *', $cmd$
    select public.disparar_automacao(
      'vigilancia-mudancas-diaria',
      'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/vigilancia-mudancas',
      '{"action":"varrer"}'::jsonb,
      'vigilancia-mudancas',
      '{}'::jsonb
    );
  $cmd$);
end $$;

/* ---------------------------------------------------- sinal de churn */

-- Segunda-feira, 12:10 UTC = 09:10 BRT. SEMANAL, e não diária, por dois motivos
-- que se somam: a fila só admite quem está vencido há mais de 30 dias e não foi
-- consultado no trimestre (uma rodada diária encontraria a fila vazia quase
-- sempre), e cada linha gerada precisa que alguém olhe — dez por semana é o que
-- se confere sem virar pilha.
--
-- Segunda de manhã porque é quando a cobrança olha a régua da semana: o sinal
-- chega junto com a decisão que ele deveria informar, não três dias depois.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'churn-sinal-externo-semanal') then
    perform cron.unschedule('churn-sinal-externo-semanal');
  end if;
  perform cron.schedule('churn-sinal-externo-semanal', '10 12 * * 1', $cmd$
    select public.disparar_automacao(
      'churn-sinal-externo-semanal',
      'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/churn-sinal-externo',
      '{"action":"varrer","limite":10}'::jsonb,
      'churn-sinal-externo',
      '{}'::jsonb
    );
  $cmd$);
end $$;
