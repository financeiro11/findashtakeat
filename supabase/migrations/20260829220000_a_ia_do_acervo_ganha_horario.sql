-- A IA do acervo ganha horário.
--
-- SEIS RODADAS POR DIA, e o número sai da conta, não do gosto. O lote é de 12
-- documentos (`MAX_LOTE`), então 6 rodadas encostam em 72 desempates — bem
-- abaixo do teto de 120/dia que `ia_orcamento` impõe. A folga é de propósito:
-- o teto é o freio de emergência, não a meta. Um agendamento que consome o teto
-- inteiro todo dia transforma o freio em decoração, porque qualquer pico
-- inesperado (alguém clicando "cruzar notas", uma leva nova de planilha) passa a
-- bater na parede.
--
-- DE 2 EM 2 HORAS, das 08h às 18h de Brasília. Fila de 426 documentos não tem
-- pressa nenhuma: neste ritmo ela se esvazia em cerca de uma semana, e uma
-- semana é tempo de sobra para alguém reparar se a IA estiver errando antes de
-- ela ter errado muito.
--
-- NO MINUTO :05, que é dos poucos vazios. Os :00, :15, :20, :30 e :40 já estão
-- disputados por outros crons, e o pg_net processa praticamente em série — a
-- espera na fila corre no relógio do próprio pedido e vira estouro de 90s sem
-- que a função tenha sido chamada. Ver `20260829180000`.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notas-explicar-rodada') then
    perform cron.unschedule('notas-explicar-rodada');
  end if;

  perform cron.schedule('notas-explicar-rodada', '5 11-21/2 * * *', $cmd$
    select public.disparar_automacao(
      'notas-explicar-rodada',
      'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/notas-explicar',
      '{"action":"rodada","limite":12}'::jsonb,
      'notas-explicar',
      '{}'::jsonb,
      140000
    );
  $cmd$);
end $$;

-- A descrição em português desta automação NÃO mora aqui: ela vai em `O_QUE_FAZ`,
-- em `src/lib/automacoes.ts`. (`automacoes_catalogo` é outra coisa — é o catálogo
-- da Linha de Produção, com dor/solução/esforço, e não tem coluna `jobname`.)
