-- Classificação das tarefas: vocabulário de área espelhando os módulos do Hub,
-- natureza pelo VERBO (não pelo substantivo) e um eixo novo — rotina × pontual.
--
-- POR QUE: `cat_natureza`/`cat_area` existem desde sempre e já alimentam a aba
-- Análise, mas 111 das 240 tarefas vivas (46%) caíam em `cat_area='Outros'` e
-- NENHUMA linha tinha `cat_origem='manual'` — o carimbo automático era o único
-- que existia, porque a tela nunca ofereceu como corrigi-lo. "Outros" não era
-- sujeira: era vocabulário faltando. Contrato, minuta, loan agreement e tax
-- return não tinham casa (Societário); rescisão, desligamento e orçamento de RH
-- não tinham casa (Pessoas & Folha); "Remessa 25/08" e "CAP Remessa 20/08" não
-- eram Tesouraria porque o regex não conhecia a palavra "remessa".
--
-- A área agora espelha os módulos do menu. Isso é o que torna a leitura
-- acionável: "a carga operacional da semana foi em Notas Fiscais" aponta direto
-- para o próximo alvo da esteira de automações — antes, "Processos 40%" não
-- apontava para lugar nenhum.
--
-- ROTINA é o eixo que a análise não tinha. "Operacional = 70%" não decide nada;
-- "Operacional 70%, dos quais 45 pontos são rotina que volta todo mês" É a fila
-- de automação medida em custo. A função já tentava adivinhar isso pela
-- "família" do título, mas "Remessa 25/08" e "Remessa dia 17" eram famílias
-- diferentes — a data no fim do título é justamente o que se repete.

-- ===================================================================== rotina
alter table public.tarefas
  add column if not exists rotina boolean not null default false;

comment on column public.tarefas.rotina is
  'Trabalho que volta sozinho (semanal/mensal), em oposição ao pontual. Carimbado pelo gatilho a partir do título e corrigível na tela — é a fila de automação medida em custo, não um rótulo cosmético.';

comment on column public.tarefas.cat_origem is
  '"auto" = carimbo do gatilho fn_tarefa_autoclassifica; "manual" = alguém corrigiu na tela e o gatilho não encosta mais (nem no backfill de uma migration futura).';

-- ==================================================================== família
-- A família é o título sem o que muda de uma repetição para a outra: colchetes
-- ([THOMAS], [CUBOSTART]), o que vem depois de "<>" / "-->" / " - ", datas e
-- números soltos. É ela que faz "Remessa 25/08", "Remessa dia 17" e "CAP
-- Remessa 20/08" se reconhecerem como a mesma rotina.
create or replace function public.fn_familia_texto(p_texto text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(unaccent(coalesce(p_texto, ''))), '\[[^\]]*\]', '', 'g'),
          '\s*(<>|-->|->|--|\s-\s|<|>).*$', ''),                       -- corta no separador
        '\y\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\y', '', 'g'),            -- datas 25/08, 20-08-2026
      '\y(dia|semana|mes|ate|de)?\s*\d+\y', '', 'g'),                  -- "dia 17", "2025", números soltos
    '\s+', ' ', 'g')), '');
$$;

comment on function public.fn_familia_texto(text) is
  'O título reduzido ao que se repete entre uma execução e outra da mesma rotina. Usado pelo resumo semanal (recorrentes) e pelo backfill de tarefas.rotina.';

-- ================================================================ classificação
-- Muda a assinatura (ganha `rotina`), então precisa cair antes: `create or
-- replace` com outra lista de colunas de retorno é recusado, e um DROP sem o
-- IF EXISTS quebraria a segunda execução deste arquivo.
drop function if exists public.fn_classifica_texto(text);

create function public.fn_classifica_texto(p_texto text)
returns table(natureza text, area text, rotina boolean)
language plpgsql
immutable
as $function$
DECLARE
  t text := lower(unaccent(coalesce(p_texto, '')));
  n text;
  a text;
  r boolean;
BEGIN
  -- =============================== NATUREZA (Run / Grow / Build) ==============
  -- Pelo VERBO, não pelo substantivo: fechar a DRE todo mês é rotina
  -- operacional; ANALISAR a DRE é trabalho estratégico. O regex antigo mandava
  -- as duas para "Estratégico" só porque a palavra "DRE" aparecia.
  -- \y, e não \b: em Postgres a fronteira de palavra é \y — `\b` fora de colchetes
  -- é o caractere BACKSPACE, então todo padrão com \b nunca casa. O regex antigo
  -- vinha com `\bdre\b`, `\bbp\b`, `\bcac\b` e nenhum deles jamais classificou
  -- nada; era isso que enchia "Outros" mesmo quando a palavra estava no título.
  IF t ~ '(automa|n8n|\yrpa\y|\ymcp\y|claude|\yagente\y|\yrobos?\y|integrac)' THEN
    n := 'Automação';                       -- construir a máquina
  ELSIF t ~ '(estrateg|analis|\yestudo\y|planejamento|\yplano\y|\ypauta\y|conselho|investidor|\yboard\y|data room|cap ?table|\yflip\y|edital|fapes|finep|cen[a]rio|proposta|negocia|\ybp\y|orcament|tracker|revisao (do )?processo|reporte|trimestr|[1234]t2[0-9]|\ypdi\y|anjos|\yprojeto\y|due diligence|valuation|\ypolitica\y)' THEN
    n := 'Estratégico';                     -- decidir para onde ir
  ELSE
    n := 'Operacional';                     -- manter de pé
  END IF;

  -- ============================= ÁREA (ordem = prioridade) ====================
  -- O vocabulário são os módulos do Hub. A ordem resolve os títulos que citam
  -- dois assuntos: "Extratos Cobranças <> John" é Recebíveis (a cobrança é o
  -- assunto), não Tesouraria (o extrato é só o meio).
  IF t ~ 'recarga' THEN
    a := 'Recargas';
  ELSIF t ~ '(edital|fapes|finep|bndes|sebrae|fomento|prestacao de contas)' THEN
    a := 'Editais';
  ELSIF t ~ '(auditoria|\yachado|divergencia)' THEN
    a := 'Auditoria';
  ELSIF t ~ '(folha|salario|rescis|desligamento|demiss|admiss|\yrh\y|colaborador|funcionari|\yferias\y|decimo terceiro|beneficio|vale (transporte|refeicao|alimentacao)|ponto eletronico|proporcion|estagi|\yvaga\y|onboarding|recrutamento|lideranca|\ypdi\y|calculo (da |de )?saida|comiss|\yvariavel\y)' THEN
    a := 'Pessoas & Folha';
  ELSIF t ~ '(contrato|minuta|acordo|distrato|loan agreement|tax return|societ|procurac|estatuto|\ynda\y|certificado digital|juridic|advogad|\ysocio|holding|cap ?table|\yflip\y|\ycayman\y|\yllc\y|\yltd\y)' THEN
    a := 'Societário & Jurídico';
  ELSIF t ~ '(\ynf\y|\ynfs\y|\ynfe\y|nfse|nfs-e|nota fiscal|\ynotas?\y|emissao|emitir|retenc|\yanexo|anexac|recibo|danfe)' THEN
    a := 'Notas Fiscais';
  ELSIF t ~ '(asaas|cobranc|estorno|refund|inadimpl|negativac|assinaturas\y|\ymrr\y|churn|carteira de clientes|fatura em aberto|reembolso|recebivel)' THEN
    a := 'Recebíveis';
  ELSIF t ~ '(pagamento|\ypagar\y|remessa|\ycap\y|cart(ao|oes)|sicoob|ita[u]|banestes|bancari|\ycaixa\y|extrato|\yboleto|conciliac|transferencia|\ypix\y|\ysaldo\y|capital de giro|comprovante|\ygastos?\y|\ycustos?\y|\ydespesa)' THEN
    a := 'Tesouraria';
  ELSIF t ~ '(\ydre\y|\ydfc\y|balancete|\ybalanco\y|fechamento|competencia|contabil|contador|reclassific|demonstrac|\yrazao\y|\yebitda\y|deprecia|plano de contas)' THEN
    a := 'Fechamento';
  ELSIF t ~ '(\ybp\y|orcament|tracker|\ycac\y|cen[a]rio|report|conselho|investidor|\yboard\y|revisao (mensal|do mes)|painel de bordo|trimestr|data room|forecast|\ykpi|\ypauta\y|\ymetas?\y|estrategic|\yreuniao\y|calendario)' THEN
    a := 'Planejamento';
  -- Segunda porta do Societário, e não uma palavra a mais lá em cima: "documento"
  -- é genérico demais para vir antes de Notas Fiscais — "Documento da NF" é nota,
  -- "Documentos Campbells" é due diligence. A ordem é que separa os dois.
  ELSIF t ~ '(\ydocumentos?\y|documentac)' THEN
    a := 'Societário & Jurídico';
  ELSIF t ~ '(\ycompras?\y|cotac|facilities|equipamento|notebook|\ymouse\y|monitor\y|licenca|assinatura de software)' THEN
    a := 'Facilities & Compras';
  ELSIF t ~ '(\yhub\y|supabase|github|vercel|lovable|n8n|\ymcp\y|\yrpa\y|claude|\yapi\y|integrac|datadog|banco de dados|thetys|\ydashboard\y|\ypainel\y|\ysistema\y|planilhamento)' THEN
    a := 'Sistema & Dados';
  ELSE
    a := 'Outros';
  END IF;

  -- ================================== ROTINA =================================
  -- Só o que o título DIZ. A repetição de fato (mesma família aparecendo várias
  -- vezes) é medida pelo backfill lá embaixo e pelo resumo semanal — aqui, no
  -- insert, ainda não há com o que comparar.
  r := t ~ '(rotina|semanal|mensal|diari|quinzenal|recorrente|toda (segunda|terca|quarta|quinta|sexta)|todo (mes|dia)|todos os (meses|dias)|fechamento do mes)';

  RETURN QUERY SELECT n, a, r;
END;
$function$;

comment on function public.fn_classifica_texto(text) is
  'Carimbo automático de natureza/área/rotina a partir do título. Vocabulário de área = módulos do Hub. Sempre perde para o carimbo manual (tarefas.cat_origem = ''manual'').';

-- ==================================================================== gatilho
create or replace function public.fn_tarefa_autoclassifica()
returns trigger
language plpgsql
as $function$
DECLARE r record;
BEGIN
  -- Quem corrigiu na tela mandou. O gatilho não encosta mais nessa linha —
  -- nem quando o título muda depois.
  IF COALESCE(NEW.cat_origem, 'auto') = 'manual' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM public.fn_classifica_texto(coalesce(NEW.titulo, ''));
  IF NEW.cat_natureza IS NULL THEN NEW.cat_natureza := r.natureza; END IF;
  IF NEW.cat_area     IS NULL THEN NEW.cat_area     := r.area;     END IF;
  -- `rotina` é NOT NULL DEFAULT false, então não dá para usar "é nulo?" como
  -- sinal de "não foi preenchido": o carimbo automático só liga, nunca desliga
  -- o que veio marcado no insert.
  IF NOT NEW.rotina THEN NEW.rotina := r.rotina; END IF;
  RETURN NEW;
END;
$function$;

-- =================================================================== backfill
-- Reclassifica tudo o que nunca foi tocado à mão. Como `cat_origem='manual'`
-- não existe em nenhuma linha hoje, na prática é o acervo inteiro — mas a
-- condição fica escrita para que repetir este arquivo amanhã não apague o
-- trabalho de quem revisou nesse meio-tempo.
update public.tarefas t
   set cat_natureza = c.natureza,
       cat_area     = c.area,
       rotina       = c.rotina
  from (select id, (public.fn_classifica_texto(titulo)).* from public.tarefas) c
 where c.id = t.id
   and coalesce(t.cat_origem, 'auto') <> 'manual';

-- Rotina medida pela repetição de fato: a mesma família concluída 3 vezes ou
-- mais é rotina, mesmo que nenhum título contenha a palavra "mensal". É assim
-- que "Remessa", "Relatório Caixa" e "CAP Remessa" entram na fila de automação
-- sem ninguém precisar marcá-las uma a uma.
with familias as (
  select public.fn_familia_texto(titulo) as f, count(*) as n
    from public.tarefas
   where arquivada_em is null
     and public.fn_familia_texto(titulo) is not null
   group by 1
  having count(*) >= 3
)
update public.tarefas t
   set rotina = true
  from familias f
 where public.fn_familia_texto(t.titulo) = f.f
   and coalesce(t.cat_origem, 'auto') <> 'manual'
   and t.rotina = false;

-- ============================================================ resumo semanal
-- Mesma função de antes, com três mudanças: a família passa a vir de
-- fn_familia_texto (que enxerga a repetição por trás da data no título), o
-- payload ganha o recorte de rotina, e `por_area`/`por_natureza` ganham quanto
-- de cada um é rotina — que é a pergunta que a aba precisa responder.
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
  v_toppeso jsonb; v_toplead jsonb; v_rec jsonb; v_payload jsonb;
BEGIN
  v_ini := (date_trunc('week', p_ref::timestamp)::date) - 7;  -- segunda da semana anterior
  v_fim := v_ini + 6;                                         -- domingo

  DROP TABLE IF EXISTS _resumo_b;
  CREATE TEMP TABLE _resumo_b AS
  SELECT
    t.titulo,
    t.cat_natureza AS natureza,
    t.cat_area     AS area,
    COALESCE(t.rotina, false) AS rotina,
    CASE lower(unaccent(trim(coalesce(t.responsavel,''))))
      WHEN 'julia' THEN 'Júlia'
      WHEN 'julia · financeiro' THEN 'Júlia'
      WHEN 'júlia · financeiro' THEN 'Júlia'
      ELSE COALESCE(NULLIF(trim(t.responsavel),''),'—')
    END AS pessoa,
    (t.concluido_em::date - t.created_at::date) AS lead_dias,
    LEAST(100,
      CASE t.prioridade WHEN 'Urgente' THEN 60 WHEN 'Alta' THEN 45
                        WHEN 'Média' THEN 30 WHEN 'Baixa' THEN 15 ELSE 20 END
      + 8 * (CASE WHEN jsonb_typeof(t.subtarefas)='array' THEN jsonb_array_length(t.subtarefas) ELSE 0 END)
    ) AS peso,
    COALESCE(public.fn_familia_texto(t.titulo), '(sem título)') AS familia
  FROM public.tarefas t
  WHERE t.arquivada_em IS NULL AND t.status='Concluído' AND t.concluido_em::date BETWEEN v_ini AND v_fim;

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
           'peso_total',     COALESCE(sum(peso),0)
         ) INTO v_tot FROM _resumo_b;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'n')::int DESC),'[]'::jsonb) INTO v_nat
  FROM (SELECT jsonb_build_object('natureza',natureza,'n',count(*),
               'lead_mediana',COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_dias),0),
               'peso_medio',COALESCE(round(avg(peso)),0),
               'rotinas',count(*) FILTER (WHERE rotina)) x
        FROM _resumo_b GROUP BY natureza) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'n')::int DESC),'[]'::jsonb) INTO v_area
  FROM (SELECT jsonb_build_object('area',area,'n',count(*),
               'lead_mediana',COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_dias),0),
               'peso_medio',COALESCE(round(avg(peso)),0),
               'rotinas',count(*) FILTER (WHERE rotina),
               'peso_rotina',COALESCE(sum(peso) FILTER (WHERE rotina),0)) x
        FROM _resumo_b GROUP BY area) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'n')::int DESC),'[]'::jsonb) INTO v_pes
  FROM (SELECT jsonb_build_object('pessoa',pessoa,'n',count(*),
               'peso_total',COALESCE(sum(peso),0),
               'rotinas',count(*) FILTER (WHERE rotina)) x
        FROM _resumo_b GROUP BY pessoa) s;

  SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_toppeso
  FROM (SELECT jsonb_build_object('titulo',titulo,'pessoa',pessoa,'area',area,'peso',peso,'lead_dias',lead_dias,'rotina',rotina) x
        FROM _resumo_b ORDER BY peso DESC, lead_dias DESC LIMIT 5) s;

  SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_toplead
  FROM (SELECT jsonb_build_object('titulo',titulo,'pessoa',pessoa,'area',area,'lead_dias',lead_dias,'rotina',rotina) x
        FROM _resumo_b ORDER BY lead_dias DESC LIMIT 5) s;

  -- Recorrentes da semana: agora inclui o peso somado, porque é ele que ordena
  -- a fila de automação — 4 execuções leves custam menos que 2 pesadas.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'peso_total')::int DESC),'[]'::jsonb) INTO v_rec
  FROM (SELECT jsonb_build_object('familia',familia,'n',count(*),
               'peso_total',COALESCE(sum(peso),0),
               'area',min(area)) x
        FROM _resumo_b GROUP BY familia HAVING count(*)>=2) s;

  v_payload := jsonb_build_object(
    'semana_inicio', v_ini, 'semana_fim', v_fim,
    'totais', v_tot, 'por_natureza', v_nat, 'por_area', v_area,
    'por_pessoa', v_pes, 'top_pesadas', v_toppeso, 'top_lead', v_toplead,
    'recorrentes', v_rec
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

-- Função nova nasce chamável por `anon` neste projeto (ver a migration
-- 20260804160200): fn_familia_texto não expõe dado, mas a regra vale para
-- todas — tirar o acesso é mais barato que descobrir a exceção depois.
revoke all on function public.fn_familia_texto(text) from anon;
revoke all on function public.fn_classifica_texto(text) from anon;
