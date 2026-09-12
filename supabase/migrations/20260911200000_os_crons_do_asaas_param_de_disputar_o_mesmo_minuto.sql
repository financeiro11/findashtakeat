-- Os crons do Asaas param de disputar o mesmo endpoint no mesmo minuto.
--
-- O QUE ACONTECIA. A migration 20260903250000 espalhou as rotinas do Asaas em tres
-- horarios por dia, mas pos os CINCO jobs no MESMO minuto de cada horario (10:45,
-- 15:30 e 20:00 UTC). Tres deles varrem o endpoint `/payments`:
--
--     asaas-sync-diario         atualizar  -> pagamentos + assinaturas + NF-e +
--                                             janela + estornos  (~160 requisicoes)
--     asaas-janela-sync-diaria  janela     -> a MESMA janela do de cima (~70)
--     estornos-sync-asaas       atualizar  -> varredura fatiada de /payments
--
-- Medido em 24 execucoes entre 04 e 11/09/2026, uma falha de `IDLE_TIMEOUT (150s)`
-- para cada uma delas:
--
--     asaas-sync-diario         17 de 24
--     estornos-sync-asaas       22 de 24
--     asaas-janela-sync-diaria  13 de 24
--     asaas-extrato-sync-diario  0 de 24   <- a unica que NAO pagina /payments
--
-- E as falhas vinham em BLOCO: nos slots em que uma caiu, quase sempre cairam as
-- tres; nos que uma passou, passaram as tres. Isso nao e "funcao lenta", e disputa
-- de um recurso compartilhado — o limite POR ENDPOINT da conta Asaas. O portao de
-- concorrencia do `_shared/asaas.ts` (TETO_CONCORRENTE = 8) e por ISOLATE, nao por
-- conta: com tres funcoes de pe ao mesmo tempo sao 24 requisicoes simultaneas em
-- `/payments`, e o Asaas responde com espera — ate 75s por vez, dentro de um
-- orcamento de 150s. Duas esperas e a rodada morreu.
--
-- O CONSERTO tem tres partes. Esta e a primeira: **separar no tempo**. As outras
-- duas estao na `asaas-sync` (a janela saiu do "atualizar", que a refazia inteira
-- em paralelo com o cron que ja era dono dela; e a rodada ganhou orcamento, e
-- devolve o parcial em vez de morrer no gateway).
--
-- POR QUE 7 MINUTOS: o pior caso de cada rodada e o proprio corte do gateway, 150s
-- = 2,5 min. Sete minutos separam as tres com folga mesmo no dia ruim, e as tres
-- continuam cabendo dentro da mesma "janela da manha/tarde" para quem le o painel.
--
-- `alter_job` e nao `unschedule`+`schedule` de proposito: o comando de cada job
-- carrega o jsonb do corpo e o nome do token, e reescreve-lo aqui e como se perde
-- um `x-cron-token` sem perceber — ja aconteceu (ver 20260829230000). Trocar so o
-- horario nao toca no comando.
--
-- IDEMPOTENTE: reaplicar so reafirma os mesmos horarios.

do $$
declare
  alvo record;
  novos text[][] := array[
    -- jobname                       , novo horario (UTC)
    ['asaas-janela-sync-diaria-1' , '52 10 * * *'],  -- 07:52 BRT
    ['asaas-janela-sync-diaria-2' , '37 15 * * *'],  -- 12:37 BRT
    ['asaas-janela-sync-diaria-3' , '7 20 * * *'],   -- 17:07 BRT
    ['estornos-sync-asaas-1'      , '59 10 * * *'],  -- 07:59 BRT
    ['estornos-sync-asaas-2'      , '44 15 * * *'],  -- 12:44 BRT
    ['estornos-sync-asaas-3'      , '14 20 * * *']   -- 17:14 BRT
  ];
  i int;
begin
  for i in 1 .. array_length(novos, 1) loop
    select jobid, jobname into alvo from cron.job where jobname = novos[i][1];
    if not found then
      raise notice 'cron % nao encontrado, pulando', novos[i][1];
      continue;
    end if;
    perform cron.alter_job(alvo.jobid, schedule => novos[i][2]);
    raise notice 'cron % -> %', alvo.jobname, novos[i][2];
  end loop;
end $$;
