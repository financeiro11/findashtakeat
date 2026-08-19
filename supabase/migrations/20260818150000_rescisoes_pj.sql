/* ============================================================================
 * Rescisão PJ — o painel passa a falar a língua da skill que existe.
 *
 * O QUE MUDOU. A primeira versão foi desenhada para uma rescisão CLT (FGTS,
 * INSS, aviso prévio). A skill que a Takeat de fato roda ("Rescisão PJ") calcula
 * outra coisa, com outras seis parcelas:
 *
 *     férias proporcionais − férias já tiradas + proporcional do mês de saída
 *     + variável/comissão + multa de rescisão − desconto Flash = TOTAL A RECEBER
 *
 * e classifica a saída em VOLUNTÁRIA ou INVOLUNTÁRIA (é isso que liga ou desliga
 * a multa de 1× remuneração, pela política de RH de 01/07/2026). Nada disso
 * cabia nos campos anteriores: `motivo` só aceitava a taxonomia da CLT e a
 * skill teria de traduzir o próprio resultado para gravar — que é exatamente o
 * tipo de tradução onde o número se perde.
 *
 * A DECISÃO CENTRAL desta migration é a função `rescisao_verbas_pj`: a skill
 * manda as SEIS PARCELAS que ela já imprime na resposta e o banco monta as
 * verbas (rubrica, referência e fórmula) a partir delas. Sem isso, integrar a
 * skill exigiria reescrevê-la para emitir um array de verbas — trabalho no lado
 * errado. Com isso, gravar é uma chamada só, com os números que ela já tem.
 *
 * O caminho antigo continua valendo: quem mandar `verbas` explícitas (uma
 * rescisão CLT, um caso fora do padrão) tem elas gravadas como vieram.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) Os campos que a skill produz e não tinham onde morar
 * ------------------------------------------------------------------ */
alter table public.rescisoes
  add column if not exists tipo_desligamento    text,      -- voluntario | involuntario
  add column if not exists motivo_texto         text,      -- o campo "Motivo desligamento" do e-mail, cru
  add column if not exists fonte_remuneracao    text,      -- planilha | email (o e-mail sobrepõe a planilha)
  add column if not exists dias_ferias_tirados  int,
  add column if not exists meses_trabalhados    int,       -- pela regra do "mês cheio" (>15 dias)
  add column if not exists dias_trabalhados_mes int,
  add column if not exists dias_mes_saida       int,
  add column if not exists flash_mensal         numeric(14,2),
  add column if not exists fontes               jsonb not null default '[]'::jsonb,
  add column if not exists alertas              jsonb not null default '[]'::jsonb,
  add column if not exists texto_resposta       text;

do $$ begin
  alter table public.rescisoes
    add constraint rescisoes_tipo_desligamento_check
    check (tipo_desligamento is null or tipo_desligamento in ('voluntario','involuntario'));
exception when duplicate_object then null; end $$;

/* `motivo` ganha os dois valores da skill PJ. Continuam valendo os da CLT: o
   painel é o mesmo para os dois mundos, e um dia entra uma rescisão celetista. */
alter table public.rescisoes drop constraint if exists rescisoes_motivo_check;
alter table public.rescisoes
  add constraint rescisoes_motivo_check check (motivo in (
    'voluntario','involuntario',
    'sem_justa_causa','pedido_demissao','justa_causa','acordo_484a',
    'termino_experiencia','termino_contrato','rescisao_indireta','fim_contrato_pj','outro'
  ));

/* O produtor real de rescisão aqui é a skill PJ. Deixar o padrão em 'clt'
   marcaria como celetista todo registro em que o campo viesse ausente — e a
   etiqueta errada na tela é pior do que campo vazio. */
alter table public.rescisoes alter column vinculo set default 'pj';

comment on column public.rescisoes.fontes is
  'De onde a skill tirou os dados: [{"texto":"Planilha RH (aba PJs, linha 12)","url":"https://…"}]. É o que permite auditar o cálculo sem refazê-lo.';
comment on column public.rescisoes.alertas is
  'Ressalvas que a skill deu em voz alta (variável não informado, férias além do direito acumulado, remuneração do e-mail sobrepondo a planilha). Array de texto — some da tela se vazio.';
comment on column public.rescisoes.texto_resposta is
  'A resposta formatada como a skill imprimiu. Guardada para reenviar/conferir palavra por palavra — os números da tela saem das colunas, não daqui.';


/* Número em português na fórmula. O `to_char` segue o lc_numeric do banco (que
   aqui é C) e devolvia "8,000.00" — separador trocado no meio de uma explicação
   de cálculo é ruído que faz duvidar do número certo. `translate` troca os dois
   símbolos de uma vez. */
create or replace function public.rescisao_brl(n numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select translate(to_char(coalesce(n, 0), 'FM999G999G999D00'), ',.', '.,');
$$;

revoke all on function public.rescisao_brl(numeric) from public;
revoke all on function public.rescisao_brl(numeric) from anon;
grant execute on function public.rescisao_brl(numeric) to authenticated;
grant execute on function public.rescisao_brl(numeric) to service_role;

/* ============================================================
 *  As seis parcelas viram verbas
 * ============================================================
 * Recebe o objeto da rescisão e devolve o array de verbas no formato da tabela.
 * Aceita as parcelas dentro de "componentes" ou soltas na raiz — a skill não
 * deveria ter de lembrar de embrulhar.
 *
 * Referência e fórmula são montadas aqui porque é o que transforma um número em
 * auditoria: "Férias proporcionais R$ 7.000,00" não se confere; "28 meses ·
 * 3.000,00 / 12 × 28" se confere de cabeça.
 *
 * O que NÃO se inventa: `meses_trabalhados` vem da skill (a regra do "mês cheio"
 * é dela e replicá-la aqui criaria duas versões da mesma conta, que um dia
 * divergem). Sem ele, a verba entra sem referência — melhor do que com uma
 * referência que talvez esteja errada.
 */
create or replace function public.rescisao_verbas_pj(r jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  c          jsonb := coalesce(r->'componentes', r);   -- aceita aninhado ou solto
  v          jsonb := '[]'::jsonb;
  v_rem      numeric := coalesce(nullif(c->>'remuneracao', '')::numeric,
                                 nullif(r->>'remuneracao', '')::numeric,
                                 nullif(r->>'salario_base', '')::numeric);
  v_meses    int  := nullif(r->>'meses_trabalhados', '')::int;
  v_diasFer  int  := coalesce(nullif(r->>'dias_ferias_tirados', '')::int, 0);
  v_diasTrab int  := nullif(r->>'dias_trabalhados_mes', '')::int;
  v_diasMes  int  := nullif(r->>'dias_mes_saida', '')::int;
  v_deslig   date := nullif(r->>'desligamento', '')::date;
  v_flash    numeric := coalesce(nullif(r->>'flash_mensal', '')::numeric, 500);
  v_naoTrab  int;
  -- Uma parcela só entra se a skill a mandou. `null` é "não calculei"; 0 é
  -- "calculei e deu zero" — e os dois precisam aparecer diferente na tela.
  v_val      numeric;
begin
  -- Dias do mês da saída: derivados da própria data quando não vierem. Aqui não
  -- há regra de negócio para divergir — é calendário.
  if v_deslig is not null then
    v_diasTrab := coalesce(v_diasTrab, extract(day from v_deslig)::int);
    v_diasMes  := coalesce(v_diasMes,
                           extract(day from (date_trunc('month', v_deslig) + interval '1 month - 1 day'))::int);
  end if;
  v_naoTrab := case when v_diasMes is not null and v_diasTrab is not null then v_diasMes - v_diasTrab end;

  -- 1) Férias proporcionais (brutas)
  v_val := nullif(c->>'ferias_proporcionais', '')::numeric;
  if v_val is not null then
    v := v || jsonb_build_object(
      'ordem', 0, 'tipo', 'provento', 'rubrica', 'Férias proporcionais',
      'referencia', case when v_meses is not null then v_meses || ' meses' end,
      'base', v_rem, 'valor', v_val,
      'formula', case when v_rem is not null and v_meses is not null
                      then format('%s / 12 × %s meses', public.rescisao_brl(v_rem), v_meses) end,
      'fundamento', 'Regra interna PJ'
    );
  end if;

  -- 2) Férias já tiradas (desconto). Cada dia vale 1/30 da remuneração.
  v_val := nullif(c->>'desconto_ferias_tiradas', '')::numeric;
  if v_val is not null and v_val <> 0 then
    v := v || jsonb_build_object(
      'ordem', 1, 'tipo', 'desconto', 'rubrica', 'Férias já tiradas',
      'referencia', v_diasFer || ' dias', 'base', v_rem, 'valor', v_val,
      'formula', case when v_rem is not null
                      then format('%s / 30 × %s dias', public.rescisao_brl(v_rem), v_diasFer) end
    );
  end if;

  -- 3) Proporcional do mês de saída
  v_val := nullif(c->>'proporcional_mes', '')::numeric;
  if v_val is not null then
    v := v || jsonb_build_object(
      'ordem', 2, 'tipo', 'provento', 'rubrica', 'Proporcional do mês de saída',
      'referencia', case when v_diasTrab is not null then v_diasTrab || ' dias' end,
      'base', v_rem, 'valor', v_val,
      'formula', case when v_rem is not null and v_diasTrab is not null and v_diasMes is not null
                      then format('%s × %s/%s', public.rescisao_brl(v_rem), v_diasTrab, v_diasMes) end
    );
  end if;

  -- 4) Variável / comissão. Entra mesmo zerada: a skill sempre mostra a linha, e
  -- "R$ 0,00 (não informado no e-mail)" é informação, não ausência.
  v_val := nullif(c->>'variavel', '')::numeric;
  if v_val is not null then
    v := v || jsonb_build_object(
      'ordem', 3, 'tipo', 'provento', 'rubrica', 'Variável / comissão',
      'referencia', case when v_val = 0 then 'não informado no e-mail' end,
      'valor', v_val
    );
  end if;

  -- 5) Multa de rescisão — 1× remuneração, só em desligamento involuntário.
  v_val := nullif(c->>'multa_rescisao', '')::numeric;
  if v_val is not null and v_val <> 0 then
    v := v || jsonb_build_object(
      'ordem', 4, 'tipo', 'provento', 'rubrica', 'Multa de rescisão',
      'referencia', '1× remuneração', 'base', v_rem, 'valor', v_val,
      'fundamento', 'Política de RH de 01/07/2026'
    );
  end if;

  -- 6) Desconto Flash — o benefício é creditado no mês cheio e a saída no meio
  -- do mês devolve os dias não usufruídos.
  v_val := nullif(c->>'desconto_flash', '')::numeric;
  if v_val is not null and v_val <> 0 then
    v := v || jsonb_build_object(
      'ordem', 5, 'tipo', 'desconto', 'rubrica', 'Benefício Flash não usufruído',
      'referencia', case when v_naoTrab is not null then v_naoTrab || ' dias' end,
      'base', v_flash, 'valor', v_val,
      'formula', case when v_naoTrab is not null and v_diasMes is not null
                      then format('%s × %s/%s', public.rescisao_brl(v_flash), v_naoTrab, v_diasMes) end
    );
  end if;

  return v;
end;
$$;

revoke all on function public.rescisao_verbas_pj(jsonb) from public;
revoke all on function public.rescisao_verbas_pj(jsonb) from anon;
grant execute on function public.rescisao_verbas_pj(jsonb) to authenticated;
grant execute on function public.rescisao_verbas_pj(jsonb) to service_role;


/* ============================================================
 *  Registro — agora falando PJ
 * ============================================================
 * Substitui a versão da migration anterior. O que mudou:
 *   • aceita `remuneracao` (o nome que a skill usa) além de `salario_base`;
 *   • aceita `tipo_desligamento` + `motivo_texto` e deriva `motivo` deles;
 *   • aceita `total_a_receber` como apelido de `liquido`;
 *   • monta as verbas das seis parcelas quando `verbas` não vier;
 *   • guarda fontes, alertas e o texto da resposta.
 *
 * Payload PJ (o mínimo que a skill precisa mandar):
 *   { "rescisoes": [ {
 *       "colaborador": "João da Silva",
 *       "desligamento": "2026-05-15",
 *       "tipo_desligamento": "involuntario",
 *       "motivo_texto": "performance abaixo da meta",
 *       "vinculo": "pj",
 *       "admissao": "2024-03-10",
 *       "remuneracao": 8000.00,
 *       "fonte_remuneracao": "planilha",
 *       "meses_trabalhados": 27,
 *       "dias_ferias_tirados": 30,
 *       "dias_trabalhados_mes": 15,
 *       "componentes": {
 *         "ferias_proporcionais": 18000.00,
 *         "desconto_ferias_tiradas": 8000.00,
 *         "proporcional_mes": 3870.97,
 *         "variavel": 1500.00,
 *         "multa_rescisao": 8000.00,
 *         "desconto_flash": 258.06
 *       },
 *       "total_a_receber": 23112.91,
 *       "fontes": [
 *         {"texto":"Planilha RH (aba PJs)","url":"https://docs.google.com/…"},
 *         {"texto":"E-mail \"Desligamento João\" lido em 15/05/2026"}
 *       ],
 *       "alertas": ["Variável não informado no e-mail — considerado R$ 0,00"],
 *       "texto_resposta": "📋 Rescisão — João da Silva\n…",
 *       "fonte": "Rescisão PJ", "calculado_em": "2026-05-16T12:00:00Z"
 *     } ] }
 */
create or replace function public.rescisao_registrar(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r           jsonb;
  v_lista     jsonb;
  v_verbas    jsonb;
  v_id        uuid;
  v_chave     text;
  v_deslig    date;
  v_nome      text;
  v_colab     uuid;
  v_tipo      text;
  v_motivo    text;
  v_rem       numeric;
  v_prov      numeric;
  v_desc      numeric;
  v_liq       numeric;
  v_prov_calc numeric;
  v_desc_calc numeric;
  v_multa     numeric;
  v_recolher  numeric;
  v_encargos  numeric;
  v_custo     numeric;
  v_n         int;
  v_total     int := 0;
  v_itens     jsonb := '[]'::jsonb;
begin
  v_lista := case
    when p_payload ? 'rescisoes' then coalesce(p_payload->'rescisoes', '[]'::jsonb)
    when p_payload ? 'colaborador' then jsonb_build_array(p_payload)
    else '[]'::jsonb
  end;

  for r in select * from jsonb_array_elements(v_lista) loop
    v_nome := btrim(coalesce(r->>'colaborador', ''));
    if v_nome = '' then
      raise exception 'Rescisão sem colaborador.';
    end if;
    if nullif(r->>'desligamento', '') is null then
      raise exception 'Rescisão de % sem data de desligamento.', v_nome;
    end if;
    v_deslig := (r->>'desligamento')::date;
    v_chave  := coalesce(
      nullif(btrim(r->>'chave'), ''),
      public.rescisao_nome_chave(v_nome) || '|' || to_char(v_deslig, 'YYYY-MM-DD')
    );

    v_colab := nullif(r->>'colaborador_id', '')::uuid;
    if v_colab is null then
      select c.id into v_colab
        from public.lib_colaboradores c
       where public.rescisao_nome_chave(c.nome) = public.rescisao_nome_chave(v_nome)
       limit 1;
    end if;

    -- 'remuneracao' é o nome da skill PJ; 'salario_base' o da CLT. Mesma coluna.
    v_rem := coalesce(nullif(r->>'remuneracao', '')::numeric, nullif(r->>'salario_base', '')::numeric);

    -- Tipo e motivo. A skill PJ manda `tipo_desligamento`; quem mandar `motivo`
    -- direto (CLT) continua sendo respeitado.
    v_tipo := nullif(btrim(r->>'tipo_desligamento'), '');
    v_motivo := coalesce(nullif(btrim(r->>'motivo'), ''), v_tipo, 'outro');

    -- As verbas: as explícitas mandam; na falta delas, as seis parcelas viram verbas.
    v_verbas := coalesce(r->'verbas', '[]'::jsonb);
    if jsonb_array_length(v_verbas) = 0 then
      v_verbas := public.rescisao_verbas_pj(r);
    end if;

    select
      coalesce(sum(case when v->>'tipo' = 'provento' then abs((v->>'valor')::numeric) end), 0),
      coalesce(sum(case when v->>'tipo' = 'desconto' then abs((v->>'valor')::numeric) end), 0)
      into v_prov_calc, v_desc_calc
      from jsonb_array_elements(v_verbas) v;

    v_prov := coalesce(nullif(r->>'total_proventos', '')::numeric, v_prov_calc);
    v_desc := coalesce(nullif(r->>'total_descontos', '')::numeric, v_desc_calc);
    -- 'total_a_receber' é como a skill PJ chama o líquido.
    v_liq  := coalesce(nullif(r->>'total_a_receber', '')::numeric,
                       nullif(r->>'liquido', '')::numeric,
                       v_prov - v_desc);

    v_multa    := nullif(r->>'fgts_multa', '')::numeric;
    v_recolher := nullif(r->>'fgts_recolher', '')::numeric;
    v_encargos := nullif(r->>'encargos', '')::numeric;
    v_custo := coalesce(
      nullif(r->>'custo_empresa', '')::numeric,
      v_liq + coalesce(v_multa, 0) + coalesce(v_recolher, 0) + coalesce(v_encargos, 0)
    );

    insert into public.rescisoes (
      chave, colaborador, colaborador_id, cpf, matricula, cargo, departamento, centro_custo,
      vinculo, admissao, aviso_em, desligamento, motivo, aviso_previo, aviso_dias, salario_base,
      total_proventos, total_descontos, liquido,
      fgts_base_multa, fgts_multa, fgts_recolher, encargos, custo_empresa,
      data_pagamento_prevista, data_pagamento, situacao,
      memoria_md, observacao, fonte, skill_versao, calculado_em, arquivo,
      tipo_desligamento, motivo_texto, fonte_remuneracao, dias_ferias_tirados,
      meses_trabalhados, dias_trabalhados_mes, dias_mes_saida, flash_mensal,
      fontes, alertas, texto_resposta,
      registrado_por, registrado_em, atualizado_em
    ) values (
      v_chave, v_nome, v_colab,
      nullif(btrim(r->>'cpf'), ''), nullif(btrim(r->>'matricula'), ''),
      nullif(btrim(r->>'cargo'), ''), nullif(btrim(r->>'departamento'), ''),
      nullif(btrim(r->>'centro_custo'), ''),
      coalesce(nullif(btrim(r->>'vinculo'), ''), 'pj'),
      nullif(r->>'admissao', '')::date,
      nullif(r->>'aviso_em', '')::date,
      v_deslig, v_motivo,
      nullif(btrim(r->>'aviso_previo'), ''),
      nullif(r->>'aviso_dias', '')::int,
      v_rem,
      v_prov, v_desc, v_liq,
      nullif(r->>'fgts_base_multa', '')::numeric, v_multa, v_recolher, v_encargos, v_custo,
      coalesce(nullif(r->>'data_pagamento_prevista', '')::date, v_deslig + 10),
      nullif(r->>'data_pagamento', '')::date,
      coalesce(nullif(btrim(r->>'situacao'), ''), 'calculada'),
      nullif(r->>'memoria_md', ''), nullif(r->>'observacao', ''),
      nullif(btrim(r->>'fonte'), ''), nullif(btrim(r->>'skill_versao'), ''),
      nullif(r->>'calculado_em', '')::timestamptz,
      nullif(btrim(r->>'arquivo'), ''),
      v_tipo, nullif(btrim(r->>'motivo_texto'), ''), nullif(btrim(r->>'fonte_remuneracao'), ''),
      nullif(r->>'dias_ferias_tirados', '')::int,
      nullif(r->>'meses_trabalhados', '')::int,
      -- Dias do mês da saída: se a skill não mandar, saem do calendário — a ficha
      -- precisa dizer "15 de 31" mesmo quando só a data veio.
      coalesce(nullif(r->>'dias_trabalhados_mes', '')::int, extract(day from v_deslig)::int),
      coalesce(nullif(r->>'dias_mes_saida', '')::int,
               extract(day from (date_trunc('month', v_deslig) + interval '1 month - 1 day'))::int),
      nullif(r->>'flash_mensal', '')::numeric,
      coalesce(r->'fontes', '[]'::jsonb), coalesce(r->'alertas', '[]'::jsonb),
      nullif(r->>'texto_resposta', ''),
      auth.uid(), now(), now()
    )
    on conflict (chave) do update set
      colaborador    = excluded.colaborador,
      colaborador_id = coalesce(excluded.colaborador_id, rescisoes.colaborador_id),
      cpf            = coalesce(excluded.cpf,          rescisoes.cpf),
      matricula      = coalesce(excluded.matricula,    rescisoes.matricula),
      cargo          = coalesce(excluded.cargo,        rescisoes.cargo),
      departamento   = coalesce(excluded.departamento, rescisoes.departamento),
      centro_custo   = coalesce(excluded.centro_custo, rescisoes.centro_custo),
      vinculo        = excluded.vinculo,
      admissao       = coalesce(excluded.admissao,     rescisoes.admissao),
      aviso_em       = coalesce(excluded.aviso_em,     rescisoes.aviso_em),
      motivo         = excluded.motivo,
      aviso_previo   = coalesce(excluded.aviso_previo, rescisoes.aviso_previo),
      aviso_dias     = coalesce(excluded.aviso_dias,   rescisoes.aviso_dias),
      salario_base   = coalesce(excluded.salario_base, rescisoes.salario_base),
      total_proventos = excluded.total_proventos,
      total_descontos = excluded.total_descontos,
      liquido         = excluded.liquido,
      fgts_base_multa = coalesce(excluded.fgts_base_multa, rescisoes.fgts_base_multa),
      fgts_multa      = coalesce(excluded.fgts_multa,      rescisoes.fgts_multa),
      fgts_recolher   = coalesce(excluded.fgts_recolher,   rescisoes.fgts_recolher),
      encargos        = coalesce(excluded.encargos,        rescisoes.encargos),
      custo_empresa   = excluded.custo_empresa,
      data_pagamento_prevista = coalesce(excluded.data_pagamento_prevista, rescisoes.data_pagamento_prevista),
      -- Pagamento e situação são do HUB: regravar o cálculo não pode apagar o
      -- "paga em 20/08" marcado na tela.
      data_pagamento  = coalesce(excluded.data_pagamento, rescisoes.data_pagamento),
      situacao        = case
                          when nullif(btrim(r->>'situacao'), '') is not null then excluded.situacao
                          else rescisoes.situacao
                        end,
      memoria_md      = coalesce(excluded.memoria_md,   rescisoes.memoria_md),
      observacao      = coalesce(excluded.observacao,   rescisoes.observacao),
      fonte           = coalesce(excluded.fonte,        rescisoes.fonte),
      skill_versao    = coalesce(excluded.skill_versao, rescisoes.skill_versao),
      calculado_em    = coalesce(excluded.calculado_em, rescisoes.calculado_em),
      arquivo         = coalesce(excluded.arquivo,      rescisoes.arquivo),
      tipo_desligamento    = coalesce(excluded.tipo_desligamento,    rescisoes.tipo_desligamento),
      motivo_texto         = coalesce(excluded.motivo_texto,         rescisoes.motivo_texto),
      fonte_remuneracao    = coalesce(excluded.fonte_remuneracao,    rescisoes.fonte_remuneracao),
      dias_ferias_tirados  = coalesce(excluded.dias_ferias_tirados,  rescisoes.dias_ferias_tirados),
      meses_trabalhados    = coalesce(excluded.meses_trabalhados,    rescisoes.meses_trabalhados),
      dias_trabalhados_mes = coalesce(excluded.dias_trabalhados_mes, rescisoes.dias_trabalhados_mes),
      dias_mes_saida       = coalesce(excluded.dias_mes_saida,       rescisoes.dias_mes_saida),
      flash_mensal         = coalesce(excluded.flash_mensal,         rescisoes.flash_mensal),
      -- Fontes e alertas são do cálculo: recalculou, valem os novos (inclusive
      -- vazio — o alerta que a skill deixou de dar não pode ficar preso na tela).
      fontes          = excluded.fontes,
      alertas         = excluded.alertas,
      texto_resposta  = coalesce(excluded.texto_resposta, rescisoes.texto_resposta),
      atualizado_em   = now()
    returning id into v_id;

    delete from public.rescisoes_verbas where rescisao_id = v_id;

    insert into public.rescisoes_verbas
      (rescisao_id, ordem, tipo, rubrica, referencia, base, valor, formula, fundamento,
       incide_inss, incide_irrf, incide_fgts)
    select
      v_id,
      coalesce(nullif(v.value->>'ordem', '')::int, (v.pos - 1)::int),
      coalesce(nullif(btrim(v.value->>'tipo'), ''), 'provento'),
      btrim(v.value->>'rubrica'),
      nullif(btrim(v.value->>'referencia'), ''),
      nullif(v.value->>'base', '')::numeric,
      abs(coalesce(nullif(v.value->>'valor', '')::numeric, 0)),
      nullif(btrim(v.value->>'formula'), ''),
      nullif(btrim(v.value->>'fundamento'), ''),
      nullif(v.value->>'incide_inss', '')::boolean,
      nullif(v.value->>'incide_irrf', '')::boolean,
      nullif(v.value->>'incide_fgts', '')::boolean
    from jsonb_array_elements(v_verbas) with ordinality as v(value, pos)
    where nullif(btrim(v.value->>'rubrica'), '') is not null;

    get diagnostics v_n = row_count;
    v_total := v_total + 1;
    v_itens := v_itens || jsonb_build_object(
      'chave', v_chave,
      'id', v_id,
      'verbas', v_n,
      -- 0 quando o total a receber fecha com as parcelas. Diferente de 0 é o
      -- aviso que a tela mostra — e que a skill deveria corrigir na origem.
      'divergencia', round(v_liq - (v_prov_calc - v_desc_calc), 2)
    );
  end loop;

  return jsonb_build_object('ok', true, 'rescisoes', v_total, 'itens', v_itens);
end;
$$;

revoke all on function public.rescisao_registrar(jsonb) from public;
revoke all on function public.rescisao_registrar(jsonb) from anon;
grant execute on function public.rescisao_registrar(jsonb) to authenticated;
grant execute on function public.rescisao_registrar(jsonb) to service_role;
