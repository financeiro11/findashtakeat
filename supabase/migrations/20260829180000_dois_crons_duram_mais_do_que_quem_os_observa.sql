-- Dois crons duram mais do que quem os observa — e um deles se dá mais prazo do
-- que o worker lhe concede.
--
-- Medido em 29/08/2026, logo depois de devolver os tokens (`20260829170000`).
-- Com a autenticação consertada, `vigilancia-mudancas-diaria` e
-- `omie-contas-pagar-sync-diario` passaram a rodar de verdade — e a rodar por
-- mais de 90 segundos, que é o prazo que `disparar_automacao` usa por padrão:
--
--   Timeout of 90000 ms reached. Total time: 90001 ms
--   (DNS time: 0.6 ms, handshake: -0.6 ms, HTTP Request/Response: 89999 ms)
--
-- A ASSINATURA IMPORTA e é o que separa este caso do outro. Quando o estouro é
-- por DISPUTA DE FILA, o pg_net contabiliza a espera como "DNS time" (o worker
-- processa praticamente em série, e o relógio do pedido corre enquanto ele
-- aguarda a vez) — foi o que aconteceu quando disparei cinco de uma vez. Aqui o
-- DNS é 0,6 ms e o tempo inteiro está em Request/Response: a função ATENDEU e
-- estava trabalhando. Prova independente: `vigilancia_paginas` mostra 4 páginas
-- lidas nos 15 minutos seguintes ao disparo, 9 das 10 no dia.
--
-- Ou seja: não é falha, é MIOPIA. O painel só pode dizer `sem_resposta` (o "?"
-- cinza) para os dois, todo dia, para sempre — nunca verde, nunca vermelho.
-- Quem desiste de esperar é o observador, e a informação existe do outro lado.
--
-- PRAZO NOVO: 150 s, e o número não é redondo por acaso. O worker das Edge
-- Functions morre por volta dos 150 s (ver CLAUDE.md, "Trabalho extra numa
-- função que já rodava perto do limite precisa de relógio"). Esperar MAIS que
-- isso seria esperar por uma resposta que já não pode vir; esperar menos é o que
-- estávamos fazendo. 150 s alinha a janela de observação com o teto real.
--
-- E O CONTAS A PAGAR SE DAVA 180 s. `orcamento_ms` é o prazo que a função usa
-- para decidir quando parar (`const prazo = Date.now() + orcamento_ms`), e o
-- cron mandava 180000 — trinta segundos ALÉM do ponto em que o processo é
-- derrubado. É exatamente o modo de falha que o CLAUDE.md descreve: o worker
-- morre sem exceção que dê para pegar, a resposta nunca sai e o trabalho já
-- feito se perde na hora de gravar. O orçamento passa a 120 s, deixando ~30 s de
-- folga entre "parei de buscar" e o teto — que é o tempo de gravar e responder.
-- O `max_consultas` (300) fica como está: quem deve limitar o volume é o teto de
-- consultas, e quem deve limitar o relógio é o orçamento.

do $do$
declare
  v_anon text;
  v_extra text;
begin
  /* A anon key é lida do próprio comando atual em vez de recopiada aqui: ela é
     pública, mas duplicar segredo-nenhum num arquivo de migração é como se
     perde o rastro de qual é a boa. */
  select substring(command from '''apikey''\s*,\s*''([^'']+)''')
    into v_anon
    from cron.job where jobname = 'omie-contas-pagar-sync-diario';

  if v_anon is null then
    raise exception 'não achei a anon key no comando de omie-contas-pagar-sync-diario';
  end if;

  v_extra := format('jsonb_build_object(%L, %L, %L, %L)',
                    'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon);

  perform cron.schedule('omie-contas-pagar-sync-diario', '20 11 * * *', format(
    E'  select public.disparar_automacao(\n'
    '    %L,\n'
    '    %L,\n'
    '    jsonb_build_object(''action'', ''sync'', ''trigger'', ''cron'', ''max_consultas'', 300, ''orcamento_ms'', 120000),\n'
    '    %L,\n'
    '    %s,\n'
    '    150000\n'
    '  );',
    'omie-contas-pagar-sync-diario',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-contas-pagar-sync',
    'omie-contas-pagar-sync',
    v_extra));

  /* A vigilância não manda Authorization de propósito — ela roda com
     `verify_jwt = false` e o `x-cron-token` é quem prova quem é. Ver o
     `config.toml`. Só o prazo muda. */
  perform cron.schedule('vigilancia-mudancas-diaria', '20 9 * * *', format(
    E'  select public.disparar_automacao(\n'
    '    %L,\n'
    '    %L,\n'
    '    ''{"action":"varrer"}''::jsonb,\n'
    '    %L,\n'
    '    ''{}''::jsonb,\n'
    '    150000\n'
    '  );',
    'vigilancia-mudancas-diaria',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/vigilancia-mudancas',
    'vigilancia-mudancas'));

  raise notice 'prazo de observação dos dois crons longos ajustado para 150s';
end
$do$;
