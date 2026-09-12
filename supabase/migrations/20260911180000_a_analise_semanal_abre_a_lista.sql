-- A ANÁLISE SEMANAL PASSA A ABRIR — e a medir TEMPO, não só quantidade.
--
-- DUAS COISAS FALTAVAM NA MESMA ABA, e são a mesma coisa vista de dois lados:
--
-- 1. O payload de `resumo_tarefas_semana` só guarda agregado — "Tesouraria: 2
--    tarefas · 2 de rotina · lead 0.5d". Quem lê não tem como conferir NEM
--    corrigir: descobrir quais tarefas entraram numa fatia exigia refazer a
--    conta à mão no banco. E como cada número depende da classificação (área,
--    natureza, rotina), um carimbo errado do regex vira número errado que
--    ninguém rastreia até a linha que o causou.
--
-- 2. "Operacional 55%" é contagem de CARDS, e contagem é o denominador errado
--    para a pergunta que se faz aqui. Sempre haverá mais tarefas operacionais:
--    elas são pequenas e voltam toda semana. O que se quer saber é onde o TEMPO
--    foi — se sobrou semana para construir (Automação) e decidir (Estratégico),
--    ou se ela inteira foi manter de pé.
--
-- O TEMPO PRECISA DE UM CAMPO, E NÃO SÓ DE UMA ESTIMATIVA. Foi o que os dados
-- disseram: na semana de 31/08, SETE das onze tarefas foram criadas no Backlog e
-- arrastadas direto para Concluído num único movimento — o board não tem
-- trilha nenhuma de trabalho nelas, e todo relógio derivado dele dá zero. Um
-- gráfico de "% do tempo" montado só com isso concentraria a semana inteira nos
-- dois ou três cards que por acaso passaram por "Em andamento": um número com
-- cara de autoridade e sem lastro. Por isso `tarefas.horas_gastas` — apontado
-- por quem fez, na própria lista que a aba agora abre — e a estimativa do board
-- só como PISO, sempre identificada como estimativa, com a cobertura ("quantas
-- horas da semana foram apontadas de fato") escrita na tela ao lado do número.
--
-- A ESTIMATIVA DO BOARD, quando é ela que vale: `fn_horas_uteis` conta as horas
-- COMERCIAIS (9h–18h, seg–sex, fuso de São Paulo) entre criar e concluir — é o
-- que impede que um card aberto na sexta e fechado na segunda valha 64 horas. E
-- desconta a fração da vida em que o card esteve em Backlog/Acompanhamento, que
-- é a regra que o quadro já usa para a idade (migration 20260810150000). É
-- relógio, não esforço: dois cards abertos ao mesmo tempo contam as mesmas
-- horas duas vezes, e por isso a soma da semana pode passar da capacidade do
-- time. O que vale é a PROPORÇÃO, e é assim que a tela apresenta.
--
-- O DESENHO DO DRILL-DOWN É O DE `demonstracoes_lancamentos` na DRE: a função
-- devolve exatamente as linhas que o resumo agrega — mesmo peso, mesma pessoa,
-- mesmo lead, mesmas horas, mesma família — mais o `id`, que é o que permite
-- abrir, apontar a hora e corrigir a classificação da tarefa.
-- `fn_resumo_tarefas_semana` passa a LER daqui em vez de repetir o SELECT: dois
-- lugares calculando peso é como ter dois números com o mesmo nome, e no dia em
-- que um mudar o outro mente em silêncio.
--
-- SEM `security definer`, de propósito. `tarefas` tem RLS com política e a
-- função só lê: como invoker ela é exatamente tão aberta quanto o quadro que a
-- pessoa já enxerga. Uma RPC definer a mais seria a 200ª deste projeto a furar
-- RLS por construção sem ganhar nada com isso.

-- ============================================================== horas gastas
alter table public.tarefas
  add column if not exists horas_gastas numeric;

comment on column public.tarefas.horas_gastas is
  'Horas que a tarefa realmente consumiu, apontadas por quem fez. NULL = não apontado, e aí a Análise usa a estimativa do board (horas comerciais abertas, menos o tempo parado) DIZENDO que é estimativa. É o único número de tempo com lastro: 2 em cada 3 cards vão do Backlog para Concluído num movimento só, e para esses o board não sabe nada.';

-- =============================================================== horas úteis
create or replace function public.fn_horas_uteis(p_ini timestamptz, p_fim timestamptz)
returns numeric
language sql
immutable
as $$
  -- `at time zone` ANTES do date_trunc: sem isso a janela 9h–18h seria contada
  -- no fuso da sessão (UTC no PostgREST), ou seja, das 6h às 15h de Vitória.
  select coalesce(sum(
    greatest(0, extract(epoch from (
        least   (p_fim at time zone 'America/Sao_Paulo', d + interval '18 hours')
      - greatest(p_ini at time zone 'America/Sao_Paulo', d + interval '9 hours')
    )) / 3600.0)
  ), 0)::numeric
  from generate_series(
         date_trunc('day', p_ini at time zone 'America/Sao_Paulo'),
         date_trunc('day', p_fim at time zone 'America/Sao_Paulo'),
         interval '1 day') d
  where extract(isodow from d) <= 5;   -- sábado e domingo não contam
$$;

comment on function public.fn_horas_uteis(timestamptz, timestamptz) is
  'Horas comerciais (9h–18h, seg–sex, fuso de São Paulo) entre dois instantes. Teto de 9h por dia: é o que impede que um card aberto na sexta e fechado na segunda valha um fim de semana inteiro de "trabalho".';

revoke all on function public.fn_horas_uteis(timestamptz, timestamptz) from anon;

-- ========================================================= tarefas da semana
drop function if exists public.fn_tarefas_da_semana(date, date);

create function public.fn_tarefas_da_semana(p_ini date, p_fim date)
returns table(
  id              uuid,
  titulo          text,
  natureza        text,
  area            text,
  rotina          boolean,
  cat_origem      text,
  pessoa          text,
  responsavel     text,
  prioridade      text,
  subtarefas      int,
  lead_dias       int,
  peso            int,
  horas           numeric,   -- a que conta: apontada, ou a estimativa do board
  horas_apontadas numeric,   -- null = ninguém apontou
  horas_board     numeric,   -- a estimativa, sempre calculada (serve de comparação)
  horas_abertas   numeric,   -- horas comerciais entre criar e concluir
  horas_paradas   numeric,   -- quanto das abertas foi em coluna que não conta
  familia         text,
  criada_em       timestamptz,
  concluida_em    timestamptz
)
language sql
stable
as $$
  -- Tudo qualificado por `t.`: em função SQL com RETURNS TABLE os nomes de saída
  -- (id, titulo, area…) colidem com os das colunas, e o alias é o que deixa a
  -- leitura sem ambiguidade.
  select
    t.id,
    t.titulo,
    t.cat_natureza as natureza,
    t.cat_area     as area,
    coalesce(t.rotina, false)      as rotina,
    coalesce(t.cat_origem, 'auto') as cat_origem,
    -- A mesma normalização de nome do resumo: sem ela a mesma pessoa aparece
    -- duas vezes na lista e uma vez só no gráfico.
    case lower(unaccent(trim(coalesce(t.responsavel,''))))
      when 'julia' then 'Júlia'
      when 'julia · financeiro' then 'Júlia'
      when 'júlia · financeiro' then 'Júlia'
      else coalesce(nullif(trim(t.responsavel),''),'—')
    end as pessoa,
    t.responsavel,
    t.prioridade,
    (case when jsonb_typeof(t.subtarefas)='array' then jsonb_array_length(t.subtarefas) else 0 end) as subtarefas,
    (t.concluido_em::date - t.created_at::date) as lead_dias,
    -- O peso é esforço ESTIMADO (prioridade + tamanho do checklist), não medido.
    -- Continua aqui porque é ele que ordena a fila de automação; o tempo abaixo
    -- é que responde "onde a semana foi".
    least(100,
      case t.prioridade when 'Urgente' then 60 when 'Alta' then 45
                        when 'Média' then 30 when 'Baixa' then 15 else 20 end
      + 8 * (case when jsonb_typeof(t.subtarefas)='array' then jsonb_array_length(t.subtarefas) else 0 end)
    ) as peso,
    coalesce(nullif(t.horas_gastas, 0), x.horas_board) as horas,
    nullif(t.horas_gastas, 0) as horas_apontadas,
    x.horas_board,
    round(h.abertas, 1) as horas_abertas,
    round(h.abertas * h.parada, 1) as horas_paradas,
    coalesce(public.fn_familia_texto(t.titulo), '(sem título)') as familia,
    t.created_at,
    t.concluido_em
  from public.tarefas t
  -- `pausado_ms` é relógio de parede — o gatilho da idade não sabe de horário
  -- comercial. Descontá-lo direto das horas úteis subtrai maçã de laranja e
  -- chega a tirar mais horas do que o card teve (72h de fim de semana parado de
  -- uma conta que só tem 27h de segunda a sexta). O que se transporta entre as
  -- duas escalas é a PROPORÇÃO: se metade da vida do card foi em coluna parada,
  -- metade das horas comerciais dele também foi.
  cross join lateral (
    select
      public.fn_horas_uteis(t.created_at, t.concluido_em) as abertas,
      coalesce(greatest(0, least(1,
        coalesce(t.pausado_ms,0)::numeric
        / nullif(extract(epoch from (t.concluido_em - t.created_at)) * 1000, 0)::numeric
      )), 0) as parada
  ) h
  -- Piso de meia hora: card que nasceu no Backlog e foi arrastado direto para
  -- Concluído tem 100% da vida "parada" e cairia a zero — sumiria do mix de
  -- tempo justamente a rotina do dia a dia, que é metade da semana.
  cross join lateral (
    select greatest(0.5, round(h.abertas * (1 - h.parada), 1)) as horas_board
  ) x
  where t.arquivada_em is null
    and t.status = 'Concluído'
    and t.concluido_em::date between p_ini and p_fim;
$$;

comment on function public.fn_tarefas_da_semana(date, date) is
  'As tarefas concluídas numa semana, com peso/horas/lead/pessoa/família já calculados — a MESMA base que fn_resumo_tarefas_semana agrega. Serve o drill-down da aba Análise: cada número abre na lista que o formou, e a lista é onde se aponta a hora e se corrige a classificação que o produziu.';

revoke all on function public.fn_tarefas_da_semana(date, date) from anon;
grant execute on function public.fn_tarefas_da_semana(date, date) to authenticated, service_role;

-- ============================================================ resumo semanal
-- Idêntica à de 20260827270000 em tudo que já calculava. Duas mudanças: as
-- linhas vêm da função acima (em vez de um SELECT repetido) e todo recorte
-- ganha `horas` ao lado de `n`, para que a tela possa trocar o denominador sem
-- uma segunda ida ao banco.
create or replace function public.fn_resumo_tarefas_semana(p_ref date default current_date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_ini date;
  v_fim date;
  v_total int;
  v_tot jsonb; v_nat jsonb; v_area jsonb; v_pes jsonb;
  v_toppeso jsonb; v_toplead jsonb; v_tophoras jsonb; v_rec jsonb; v_payload jsonb;
BEGIN
  v_ini := (date_trunc('week', p_ref::timestamp)::date) - 7;  -- segunda da semana anterior
  v_fim := v_ini + 6;                                         -- domingo

  DROP TABLE IF EXISTS _resumo_b;
  CREATE TEMP TABLE _resumo_b AS
  SELECT * FROM public.fn_tarefas_da_semana(v_ini, v_fim);

  SELECT count(*) INTO v_total FROM _resumo_b;

  SELECT jsonb_build_object(
           'concluidas', count(*),
           'lead_mediana', COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_dias),0),
           'pct_operacional', COALESCE(round(100.0*count(*) FILTER (WHERE natureza='Operacional')/NULLIF(count(*),0)),0),
           'pct_estrategico', COALESCE(round(100.0*count(*) FILTER (WHERE natureza='Estratégico')/NULLIF(count(*),0)),0),
           'pct_automacao',  COALESCE(round(100.0*count(*) FILTER (WHERE natureza='Automação')/NULLIF(count(*),0)),0),
           'pct_rotina',     COALESCE(round(100.0*count(*) FILTER (WHERE rotina)/NULLIF(count(*),0)),0),
           'rotinas',        count(*) FILTER (WHERE rotina),
           'peso_rotina',    COALESCE(sum(peso) FILTER (WHERE rotina),0),
           'peso_total',     COALESCE(sum(peso),0),
           -- O mesmo mix medido em horas. `pct_*_h` vêm prontos para que a barra
           -- não precise decidir arredondamento.
           'horas_total',       COALESCE(round(sum(horas),1),0),
           'horas_rotina',      COALESCE(round(sum(horas) FILTER (WHERE rotina),1),0),
           'pct_rotina_h',      COALESCE(round(100.0*sum(horas) FILTER (WHERE rotina)/NULLIF(sum(horas),0)),0),
           'pct_operacional_h', COALESCE(round(100.0*sum(horas) FILTER (WHERE natureza='Operacional')/NULLIF(sum(horas),0)),0),
           'pct_estrategico_h', COALESCE(round(100.0*sum(horas) FILTER (WHERE natureza='Estratégico')/NULLIF(sum(horas),0)),0),
           'pct_automacao_h',   COALESCE(round(100.0*sum(horas) FILTER (WHERE natureza='Automação')/NULLIF(sum(horas),0)),0),
           -- A cobertura: sem ela o mix de tempo parece medido quando ainda é
           -- quase todo estimativa do board. A tela escreve os dois lado a lado.
           'apontadas',         count(*) FILTER (WHERE horas_apontadas IS NOT NULL),
           'horas_apontadas',   COALESCE(round(sum(horas) FILTER (WHERE horas_apontadas IS NOT NULL),1),0),
           'pct_horas_apontadas', COALESCE(round(100.0*sum(horas) FILTER (WHERE horas_apontadas IS NOT NULL)/NULLIF(sum(horas),0)),0)
         ) INTO v_tot FROM _resumo_b;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'n')::int DESC),'[]'::jsonb) INTO v_nat
  FROM (SELECT jsonb_build_object('natureza',natureza,'n',count(*),
               'lead_mediana',COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_dias),0),
               'peso_medio',COALESCE(round(avg(peso)),0),
               'horas',COALESCE(round(sum(horas),1),0),
               'rotinas',count(*) FILTER (WHERE rotina)) x
        FROM _resumo_b GROUP BY natureza) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'n')::int DESC),'[]'::jsonb) INTO v_area
  FROM (SELECT jsonb_build_object('area',area,'n',count(*),
               'lead_mediana',COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_dias),0),
               'peso_medio',COALESCE(round(avg(peso)),0),
               'horas',COALESCE(round(sum(horas),1),0),
               'horas_rotina',COALESCE(round(sum(horas) FILTER (WHERE rotina),1),0),
               'rotinas',count(*) FILTER (WHERE rotina),
               'peso_rotina',COALESCE(sum(peso) FILTER (WHERE rotina),0)) x
        FROM _resumo_b GROUP BY area) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'n')::int DESC),'[]'::jsonb) INTO v_pes
  FROM (SELECT jsonb_build_object('pessoa',pessoa,'n',count(*),
               'peso_total',COALESCE(sum(peso),0),
               'horas',COALESCE(round(sum(horas),1),0),
               'horas_construir',COALESCE(round(sum(horas) FILTER (WHERE natureza IN ('Automação','Estratégico')),1),0),
               'rotinas',count(*) FILTER (WHERE rotina)) x
        FROM _resumo_b GROUP BY pessoa) s;

  -- `id` entra nas listas de topo para que clicar num item abra a tarefa certa —
  -- casar por título falharia justamente no caso que interessa, o de duas
  -- execuções da mesma rotina na mesma semana.
  SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_toppeso
  FROM (SELECT jsonb_build_object('id',id,'titulo',titulo,'pessoa',pessoa,'area',area,'peso',peso,'lead_dias',lead_dias,'horas',horas,'rotina',rotina) x
        FROM _resumo_b ORDER BY peso DESC, lead_dias DESC LIMIT 5) s;

  SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_toplead
  FROM (SELECT jsonb_build_object('id',id,'titulo',titulo,'pessoa',pessoa,'area',area,'lead_dias',lead_dias,'horas',horas,'rotina',rotina) x
        FROM _resumo_b ORDER BY lead_dias DESC LIMIT 5) s;

  -- Onde o tempo foi, tarefa a tarefa. É a lista que o peso estimado não dava:
  -- peso alto é palpite de complexidade, hora alta é a semana que passou.
  SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_tophoras
  FROM (SELECT jsonb_build_object('id',id,'titulo',titulo,'pessoa',pessoa,'area',area,'natureza',natureza,
               'horas',horas,'apontada',(horas_apontadas IS NOT NULL),'lead_dias',lead_dias,'rotina',rotina) x
        FROM _resumo_b ORDER BY horas DESC, peso DESC LIMIT 5) s;

  -- Recorrentes da semana, com o peso somado e agora também as horas: é o custo
  -- que ordena a fila de automação — 4 execuções leves custam menos que 2 pesadas.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'horas')::numeric DESC),'[]'::jsonb) INTO v_rec
  FROM (SELECT jsonb_build_object('familia',familia,'n',count(*),
               'peso_total',COALESCE(sum(peso),0),
               'horas',COALESCE(round(sum(horas),1),0),
               'area',min(area)) x
        FROM _resumo_b GROUP BY familia HAVING count(*)>=2) s;

  v_payload := jsonb_build_object(
    'semana_inicio', v_ini, 'semana_fim', v_fim,
    'totais', v_tot, 'por_natureza', v_nat, 'por_area', v_area,
    'por_pessoa', v_pes, 'top_pesadas', v_toppeso, 'top_lead', v_toplead,
    'top_horas', v_tophoras, 'recorrentes', v_rec
  );

  INSERT INTO public.resumo_tarefas_semana (semana_inicio, semana_fim, gerado_em, total_concluidas, payload)
  VALUES (v_ini, v_fim, now(), v_total, v_payload)
  ON CONFLICT (semana_inicio)
  DO UPDATE SET semana_fim=EXCLUDED.semana_fim, gerado_em=now(),
                total_concluidas=EXCLUDED.total_concluidas, payload=EXCLUDED.payload;

  DROP TABLE IF EXISTS _resumo_b;
  RETURN v_payload;
END;
$function$;
