/* O FREIO DA IA DESCE PARA O MOTOR — e o teto do mês passa a ser teto, não aviso.
 * ---------------------------------------------------------------------------------------
 * 09/09/2026. Nasceu de um print da conta da OpenAI: US$ 53,98 em 7 dias, 113 milhões de
 * tokens em 1.082 chamadas — 104 mil tokens POR CHAMADA. A investigação mostrou que o gasto
 * não era do Hub (`ai_usage_log` no mesmo período: 35 chamadas de OpenAI, US$ 0,095) e sim
 * do runtime da TETS, que roda fora deste repositório. Mas a pergunta que sobrou vale aqui:
 * o que impedia o HUB de fazer a mesma coisa? A resposta era "nada".
 *
 * O que existia era um SINO (`ia_orcamento_alerta`, de hora em hora, em 70/90/100%). Sino
 * não é freio: toca depois, e só se alguém estiver ouvindo. Um laço que descobre trabalho
 * novo às 2h da manhã gasta a noite inteira, e o aviso chega junto com a fatura.
 *
 * O QUE MUDOU DO LADO DO CÓDIGO (esta migration é a metade do banco):
 *   • `podeGastarIA` agora é chamado DE DENTRO dos dois motores (`_shared/openai.ts` e
 *     `_shared/gemini.ts`), antes de cada chamada — não mais opt-in em cada função. Das 16
 *     funções que usam a OpenAI, ZERO chamavam o freio; do lado do Gemini, duas.
 *   • O motor do Gemini passou a gravar sozinho no razão (13 dos 19 call sites não gravavam
 *     nada, inclusive o assistente, que transmite em stream e não passava nem perto).
 *   • As quatro funções que falam com a API do Gemini na mão — `parse-balancete-pdf`,
 *     `comprovantes-drive-sync`, `ask-finance-ai` e `editais-edi-consult` — ganharam o
 *     freio e o medidor na porta, porque o motor não freia o que não passa por ele.
 */

/* ========================================================================================
 * 1. O TETO DO MÊS INTEIRO VIRA FREIO
 * ========================================================================================
 * `ia_teto_global` existe desde 03/09 e era lido só pelo sino. Os tetos por consumidor
 * somam US$ 107/mês contra um global de US$ 60 — de propósito, porque cada um limita a
 * FORMA do gasto daquele consumidor, não a conta. Sem o global no freio, bastava um
 * consumidor novo com teto generoso para furar a conta inteira sem estourar teto nenhum.
 *
 * DROP e CREATE, e não `create or replace`, porque a lista de colunas muda — e um
 * `create or replace` com assinatura diferente deixaria a versão velha viva ao lado da
 * nova (a armadilha que já custou um dia neste repositório). O único chamador é
 * `podeGastarIA`; a tela `/configuracoes/uso-ia` lê `ia_consumo_mes()`, que não muda. */
drop function if exists public.ia_orcamento_status();

create function public.ia_orcamento_status()
returns table (
  consumidor text, rotulo text, para_que text, ativo boolean,
  teto_dia integer, usadas_hoje integer, resta_hoje integer,
  teto_mes_usd numeric, gasto_mes_usd numeric,
  teto_global_usd numeric, gasto_global_usd numeric
)
language sql
stable
set search_path to 'public'
as $$
  /* O DIA É O DE BRASÍLIA, não o UTC. Um teto diário que vira às 21h da noite
     local seria um teto que ninguém consegue prever — e o pg_cron agenda em UTC
     justamente para confundir quem não presta atenção. */
  with corte as (
    select (date_trunc('day', now() at time zone 'America/Sao_Paulo')
              at time zone 'America/Sao_Paulo') as dia,
           (date_trunc('month', now() at time zone 'America/Sao_Paulo')
              at time zone 'America/Sao_Paulo') as mes
  ),
  global as (
    select
      (select g.teto_mes_usd from ia_teto_global g where g.id limit 1)      as teto,
      coalesce((select sum(l.cost_usd) from ai_usage_log l, corte
                 where l.created_at >= corte.mes), 0)                       as gasto
  )
  select
    o.consumidor, o.rotulo, o.para_que, o.ativo, o.teto_dia,
    coalesce((select count(*)::int from ai_usage_log l, corte
               where l.feature = o.consumidor and l.created_at >= corte.dia), 0),
    greatest(0, o.teto_dia - coalesce((select count(*)::int from ai_usage_log l, corte
               where l.feature = o.consumidor and l.created_at >= corte.dia), 0)),
    o.teto_mes_usd,
    coalesce((select sum(l.cost_usd) from ai_usage_log l, corte
               where l.feature = o.consumidor and l.created_at >= corte.mes), 0),
    global.teto,
    global.gasto
  from ia_orcamento o, global
  order by o.consumidor;
$$;

revoke execute on function public.ia_orcamento_status() from anon;
grant execute on function public.ia_orcamento_status() to authenticated, service_role;

/* ========================================================================================
 * 2. QUEM NÃO SE IDENTIFICA
 * ========================================================================================
 * Chamada sem `consumidor` cai em `openai_sem_rotulo`/`gemini_sem_rotulo`. Eles precisam
 * EXISTIR aqui: `podeGastarIA` bloqueia consumidor que não está na tabela, e agora que o
 * freio mora no motor isso viraria "a função nova não funciona e ninguém sabe por quê".
 *
 * Teto pequeno de propósito: dá para uma função nova nascer e ser vista, e não dá para uma
 * função nova gastar o mês. */
insert into ia_orcamento (consumidor, rotulo, para_que, teto_dia, teto_mes_usd) values
  ('openai_sem_rotulo', 'OpenAI sem rótulo',
   'Chamada que não disse quem é. Aparece aqui para ser batizada, não para viver assim.',
   100, 3.00),
  ('gemini_sem_rotulo', 'Gemini sem rótulo',
   'Chamada que não disse quem é. Aparece aqui para ser batizada, não para viver assim.',
   100, 3.00)
on conflict (consumidor) do nothing;

/* ========================================================================================
 * 3. OS TETOS RECORTADOS PARA O NOVO DENOMINADOR
 * ========================================================================================
 * ATENÇÃO AO SENTIDO DESTE BLOCO: ele SOBE tetos, num dia de auditoria de gasto. Não é
 * contradição — é a consequência de ligar o freio em cima de consumo que nunca foi medido.
 * Até hoje `classificacao` media 3 funções; a partir de agora mede 7, entre elas o radar de
 * preços, que roda 15 vezes por dia (6 varreduras + 4 conferências + 5 vigias) e faz uma
 * chamada por fonte em cada uma. O teto de 120/dia barraria o radar na primeira manhã, e um
 * freio que quebra o trabalho normal é desligado na semana seguinte — vira teatro.
 *
 * OS NÚMEROS SÃO PROVISÓRIOS E ESTÃO DE PROPÓSITO 5 A 10× ACIMA DO ESPERADO. O teto existe
 * para conter LAÇO (10× o normal), não para aparar o uso normal. Recortar de verdade só é
 * honesto com uma semana de `ai_usage_log` já com a cobertura nova — antes disso, qualquer
 * número apertado é chute com aparência de política. Quem protege a conta enquanto isso é o
 * teto em dólar, que não subiu. */
update ia_orcamento set teto_dia = 800, teto_mes_usd = 25.00, atualizado_em = now()
 where consumidor = 'acervo_leitura';   -- + comprovantes-drive-sync (~107 fotos/rodada),
                                        --   parse-balancete-pdf, auditoria-conferir-comprovante
update ia_orcamento set teto_dia = 800, teto_mes_usd = 8.00, atualizado_em = now()
 where consumidor = 'classificacao';    -- + facilities-radar (15 rodadas/dia), cnpj-publico,
                                        --   firecrawl-collector, cartao-omie-sugerir, facilities-nf-auditoria
update ia_orcamento set teto_dia = 150, teto_mes_usd = 4.00, atualizado_em = now()
 where consumidor = 'rotina_diaria';    -- + briefing-noticias, churn-sinal-externo, vigilancia-mudancas
update ia_orcamento set teto_dia = 80, atualizado_em = now()
 where consumidor = 'texto_apoio';      -- + editais-edi-consult

/* `assistente` (300/dia) fica como está: ganhou `ask-finance-ai` e o stream do `ai-chat`,
   mas é uso de gente clicando, e 300 chamadas num dia já seriam um dia estranho. */

/* ========================================================================================
 * 4. O VIGIA DE VOLUME DA TETS
 * ========================================================================================
 * A agente roda fora daqui e não há freio nosso que a alcance — uma trava neste lado
 * barraria o REGISTRO de uma edição já feita, trilha furada em troca de nada. O que dá para
 * fazer é enxergar cedo.
 *
 * `agente_laco_alerta` (de 10 em 10 min) já pega RAJADA: 30 chamadas da mesma tarefa em 60
 * minutos. Foi desenhado para o episódio de 03/09 (102 edições em 4 minutos) e é bom nisso.
 * Ele NÃO pega o outro formato, que é o de 08/09: 50 passos espalhados em 12 horas, tarefas
 * variadas, nenhuma hora com 30 — e US$ 8,45 na conta. Gasto de agente é o TOTAL de passos
 * do dia, porque o preço é por passo: cada linha da trilha é uma ida inteira ao modelo,
 * levando prompt de sistema, catálogo de ferramentas e todo o histórico.
 *
 * O número: 120 passos/dia. Os dois piores dias medidos foram 03/09 (213) e 02/09 (83); a
 * mediana dos outros é 8. Cento e vinte é acima de qualquer dia normal e abaixo de todo dia
 * ruim. */
insert into sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, ativa)
values (
  'agente.volume', 'monitoramento', 'Volume de passos da TETS',
  'Passos da trilha no dia. O custo do agente é por passo — cada um reenvia o prompt '
  || 'inteiro ao modelo —, então o total do dia é a melhor leitura de gasto que temos '
  || 'deste lado da cerca.',
  '/monitoramento/thetys', 'acima', 'media', true
) on conflict (serie) do nothing;

create or replace function public.agente_volume_alerta(p_teto integer default 120)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dia   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_passos int;
  v_tarefas int;
  v_agente text;
  v_abertos int := 0;
begin
  for v_agente, v_passos, v_tarefas in
    select e.agente_id, count(*)::int, count(distinct e.tarefa)::int
      from agente_execucoes e
     where (e.executado_em at time zone 'America/Sao_Paulo')::date = v_dia
     group by e.agente_id
    having count(*) >= p_teto
  loop
    begin
      insert into sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade, medida)
      values (
        'agente.volume',
        v_agente,
        /* Uma vez por dia por agente: o sinal é sobre o DIA, e repetir a cada
           execução do cron transformaria um aviso em ruído. */
        format('agente.volume:%s:%s', v_agente, v_dia),
        format('%s já deu %s passos hoje', upper(v_agente), v_passos),
        format('%s passos em %s tarefas diferentes. Cada passo é uma ida inteira ao '
               || 'modelo: o prompt de sistema, o catálogo de ferramentas e o histórico '
               || 'da conversa vão junto em todas. Cem passos para um trabalho que cabia '
               || 'em um custam cem vezes.', v_passos, v_tarefas),
        'Abra a trilha em /monitoramento/thetys e veja se os passos se repetem sobre os '
        || 'mesmos registros. Se for uma tarefa em laço, o freio fica no n8n/runtime, '
        || 'não aqui.',
        v_passos, 'media',
        /* `medida` é JSONB, não texto — a mesma forma do `agente_laco_alerta`. Um literal
           solto aqui passa no CREATE e só estoura quando o cron roda. */
        jsonb_build_object('agente', v_agente, 'passos', v_passos,
                           'tarefas', v_tarefas, 'dia', v_dia)
      );
      v_abertos := v_abertos + 1;
    exception when unique_violation then
      null; -- já avisado hoje
    end;
  end loop;

  return jsonb_build_object('abertos', v_abertos, 'dia', v_dia, 'teto', p_teto);
end;
$$;

revoke execute on function public.agente_volume_alerta(integer) from anon;
grant execute on function public.agente_volume_alerta(integer) to service_role;

/* De hora em hora, e não de 10 em 10 minutos como o vigia de rajada: este olha o dia
   inteiro, e o dia não muda de cara em dez minutos. */
select cron.schedule('agente-volume-vigiar', '35 * * * *',
                     $$select public.agente_volume_alerta();$$);
