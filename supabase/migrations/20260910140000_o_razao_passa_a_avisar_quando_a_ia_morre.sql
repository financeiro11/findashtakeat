/* O RAZÃO PASSA A AVISAR QUANDO A IA MORRE, e não só quando ela gasta.
 * ---------------------------------------------------------------------------------------
 * 09/09/2026, achado no meio de uma auditoria de GASTO — e o achado é o oposto.
 *
 * `ai_usage_log` dos últimos 7 dias, por consumidor:
 *     notas_motivo ............ 234 chamadas com ZERO token,   7 com tokens
 *     notas_desempate .......... 65 com zero,                  0 com tokens
 *     email_resposta ........... 50 com zero,                  5 com tokens
 *     automacao_diagnostico .... 27 com zero,                  0 com tokens
 *
 * Zero token não é chamada barata: é chamada que FALHOU — a convenção que os call sites e
 * agora os dois motores seguem (`registrarUsoIA` com 0/0 no catch). O log da função diz o
 * resto, sem espaço para dúvida:
 *
 *     Gemini error 429 … "Your prepayment credits are depleted."
 *
 * Ou seja: 376 das 391 chamadas de Gemini da semana falharam, o crédito pré-pago acabou por
 * volta de 04/09 e METADE DA IA DO HUB ESTAVA MORTA HÁ CINCO DIAS. A fila do
 * `anexo-triagem` parou de drenar (14 documentos represados, 0 lidos por rodada, de meia em
 * meia hora, o dia inteiro), o motivo de nota não é mais escrito, o diagnóstico de
 * automação não roda.
 *
 * POR QUE NINGUÉM VIU: o único vigia que existia era o `ia_orcamento_alerta`, que toca em
 * 70/90/100% do TETO DE GASTO. Motor parado não gasta — e um painel que só sabe medir
 * dinheiro lê "US$ 0,015 no Gemini este mês" como economia. O medidor estava certo e mudo:
 * as 376 linhas estavam lá desde o dia 4, com zero em `total_tokens`, esperando alguém
 * perguntar. Um razão que ninguém interroga não vale mais que razão nenhum.
 *
 * ESTE É O PAR QUE FALTAVA. Teto protege a conta; isto protege o TRABALHO. As duas metades
 * do mesmo sino, e a segunda é a que teria falado primeiro nesta semana.
 */
insert into sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, ativa)
values (
  'ia.falhas', 'configuracoes', 'IA falhando',
  'Proporção de chamadas de IA que voltam sem token nenhum na última hora. Zero token é '
  || 'chamada que falhou: crédito acabado, chave errada, modelo que sumiu. Existe porque '
  || 'o teto de gasto nunca dispara quando o motor está parado.',
  '/configuracoes/uso-ia', 'acima', 'alta', true
) on conflict (serie) do nothing;

/**
 * Toca quando, na última hora, um consumidor teve pelo menos `p_minimo` chamadas e pelo
 * menos `p_pct` por cento delas voltaram zeradas.
 *
 * O MÍNIMO EXISTE PARA NÃO GRITAR COM UMA ANDORINHA: uma única chamada que falhou é
 * terça-feira, não incidente. Cinco em uma hora, quase todas falhando, é o motor no chão.
 *
 * SQL puro, de propósito — mesma razão do `ia_orcamento_alerta`: um alerta sobre a IA
 * estar fora do ar que precisasse da IA para existir seria a piada que se conta sozinha.
 */
create or replace function public.ia_falhas_alerta(
  p_minimo integer default 5,
  p_pct    integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hora    text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24');
  v_abertos int := 0;
  r         record;
begin
  for r in
    select
      l.feature,
      count(*)::int                                          as chamadas,
      count(*) filter (where l.total_tokens = 0)::int         as zeradas,
      round(100.0 * count(*) filter (where l.total_tokens = 0) / count(*))::int as pct,
      /* O modelo mais recente da janela dá o nome do motor no título — é a primeira
         pergunta de quem lê o aviso ("morreu qual dos dois?"). */
      (array_agg(l.model order by l.created_at desc))[1]      as modelo
    from ai_usage_log l
    where l.created_at >= now() - interval '60 minutes'
    group by l.feature
    having count(*) >= p_minimo
       and 100.0 * count(*) filter (where l.total_tokens = 0) / count(*) >= p_pct
  loop
    begin
      insert into sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade, medida)
      values (
        'ia.falhas',
        r.feature,
        format('ia.falhas:%s:%s', r.feature, v_hora),   -- uma vez por hora por consumidor
        format('%s: %s de %s chamadas de IA falharam na última hora',
               r.feature, r.zeradas, r.chamadas),
        format('%s%% das chamadas voltaram sem token nenhum, no modelo %s. Chamada sem '
               || 'token é chamada que não aconteceu: crédito esgotado, chave inválida ou '
               || 'modelo que saiu do ar. O teto de gasto NÃO avisa isso — motor parado '
               || 'não gasta.', r.pct, coalesce(r.modelo, '?')),
        'Veja o motivo em Edge Functions › Logs (procure por "error 429" ou "credits"). '
        || 'Se for crédito do Gemini, o Hub cai sozinho para a OpenAI só nas funções que '
        || 'passam por _shared/openai.ts — as que chamam o Gemini direto ficam paradas.',
        r.pct, 'alta',
        /* JSONB, como manda a coluna. Ver a nota gêmea em `agente_volume_alerta`. */
        jsonb_build_object('consumidor', r.feature, 'chamadas', r.chamadas,
                           'zeradas', r.zeradas, 'pct', r.pct, 'modelo', r.modelo)
      );
      v_abertos := v_abertos + 1;
    exception when unique_violation then
      null; -- já avisado nesta hora
    end;
  end loop;

  return jsonb_build_object('abertos', v_abertos, 'janela_min', 60, 'minimo', p_minimo, 'pct', p_pct);
end;
$$;

revoke execute on function public.ia_falhas_alerta(integer, integer) from anon;
grant execute on function public.ia_falhas_alerta(integer, integer) to service_role;

/* Aos 25 de cada hora — cinco minutos antes do sino de orçamento (que roda aos 20), para
   que, num dia em que os dois tenham o que dizer, o aviso de "parou" chegue antes do
   aviso de "gastou". */
select cron.schedule('ia-falhas-vigiar', '25 * * * *', $$select public.ia_falhas_alerta();$$);
