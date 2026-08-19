/* ============================================================================
 * Rescisões — o detalhamento de cada desligamento, verba por verba.
 *
 * O PROBLEMA. Quem calcula a rescisão é uma skill do Claude: ela pega admissão,
 * desligamento, motivo, salário e aviso, e devolve o espelho completo (saldo de
 * salário, aviso indenizado, 13º e férias proporcionais, multa de 40%, INSS,
 * IRRF…). Esse cálculo vivia em conversa: no mês seguinte ninguém sabia mais de
 * que os R$ 38 mil eram feitos, se já tinham sido pagos, nem se o prazo do
 * art. 477 tinha vencido. O que sobrava no Hub era a saída consolidada dentro
 * da folha, sem nome e sem memória.
 *
 * A DIVISÃO DE TRABALHO é a mesma do cartão (ver 20260805120000_cartao_ofx.sql):
 *   • a skill entrega o CÁLCULO — as verbas, uma a uma, com referência e
 *     fórmula (é o que o Hub não sabe fazer: interpretar a CLT);
 *   • o Hub guarda, soma, confere e controla o pagamento.
 *
 * Guardar só o texto do parecer seria mais simples e estaria errado: "quanto
 * custaram as rescisões deste ano", "quanto ainda está a pagar" e "esta soma
 * bate?" são perguntas de coluna, não de parágrafo. Por isso a verba é linha de
 * tabela — e a memória em markdown fica ao lado dela, não no lugar dela.
 *
 * CONFERÊNCIA. Os totais vêm da skill E são recalculados das verbas. Quando os
 * dois discordam, ninguém escolhe em silêncio: guarda-se o que a skill mandou e
 * a divergência aparece na tela (e volta no retorno desta função, para a própria
 * skill enxergar que errou a soma). O oposto — sobrescrever o total pelo
 * recálculo — esconderia justamente o erro que interessa achar.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) A rescisão (o cabeçalho de cada desligamento)
 * ------------------------------------------------------------------
 * `chave` é o identificador natural: nome normalizado + data do desligamento.
 * Existe para a skill poder REGRAVAR o mesmo cálculo (corrigiu o salário, mudou
 * o motivo, chegou a data real do pagamento) sem criar uma segunda rescisão da
 * mesma pessoa. Sem ela, rodar a skill duas vezes dobrava o custo do ano.
 *
 * Sobre os campos de FGTS — a nomenclatura aqui é deliberada, porque misturá-los
 * é o erro que inflaria o custo:
 *   fgts_base_multa  saldo da conta do FGTS. É BASE de cálculo, NÃO é caixa.
 *   fgts_multa       os 40% (ou 20% no acordo do art. 484-A). É caixa.
 *   fgts_recolher    o FGTS do mês / sobre as verbas rescisórias. É caixa.
 *   encargos         INSS patronal e o que mais a empresa paga por fora. Caixa.
 * `custo_empresa` = líquido + fgts_multa + fgts_recolher + encargos. É o número
 * que se compara com a folha do mês — o líquido sozinho mente para baixo.
 */
create table if not exists public.rescisoes (
  id             uuid primary key default gen_random_uuid(),
  chave          text not null unique,        -- 'joao da silva|2026-08-15'
  colaborador    text not null,
  colaborador_id uuid references public.lib_colaboradores(id) on delete set null,
  cpf            text,
  matricula      text,
  cargo          text,
  departamento   text,
  centro_custo   text,
  vinculo        text not null default 'clt'
                 check (vinculo in ('clt','pj','estagio','aprendiz','outro')),

  admissao       date,                        -- nulo só quando não se sabe (PJ antigo)
  aviso_em       date,                        -- dia em que o aviso foi comunicado
  desligamento   date not null,               -- término do contrato (conta o prazo do art. 477)
  motivo         text not null
                 check (motivo in ('sem_justa_causa','pedido_demissao','justa_causa',
                                   'acordo_484a','termino_experiencia','termino_contrato',
                                   'rescisao_indireta','fim_contrato_pj','outro')),
  aviso_previo   text
                 check (aviso_previo in ('indenizado','trabalhado','dispensado',
                                         'nao_cumprido','nao_se_aplica')),
  aviso_dias     int,
  salario_base   numeric(14,2),

  total_proventos numeric(14,2) not null default 0,
  total_descontos numeric(14,2) not null default 0,
  liquido         numeric(14,2) not null default 0,
  fgts_base_multa numeric(14,2),
  fgts_multa      numeric(14,2),
  fgts_recolher   numeric(14,2),
  encargos        numeric(14,2),
  custo_empresa   numeric(14,2),

  data_pagamento_prevista date,               -- da skill; na falta, desligamento + 10 dias
  data_pagamento          date,               -- quando saiu do caixa de verdade
  situacao       text not null default 'calculada'
                 check (situacao in ('calculada','conferida','paga','cancelada')),

  memoria_md     text,                        -- a memória de cálculo, como a skill escreveu
  observacao     text,
  fonte          text,                        -- nome da skill que calculou
  skill_versao   text,
  calculado_em   timestamptz,                 -- quando a skill rodou
  arquivo        text,                        -- planilha/PDF de origem, se houver

  registrado_em  timestamptz not null default now(),
  registrado_por uuid,
  atualizado_em  timestamptz not null default now()
);

create index if not exists rescisoes_desligamento_idx on public.rescisoes (desligamento desc);
create index if not exists rescisoes_situacao_idx     on public.rescisoes (situacao);

/* ------------------------------------------------------------------
 * 2) As verbas (o detalhamento — a matéria-prima da tela)
 * ------------------------------------------------------------------
 * Um registro por linha do espelho. `valor` é sempre POSITIVO: o sinal mora em
 * `tipo`, porque misturar provento e desconto no mesmo sinal obrigaria toda
 * consulta a lembrar da convenção.
 *
 * `tipo` separa quatro coisas que NÃO somam juntas:
 *   provento     entra no líquido a pagar
 *   desconto     sai do líquido
 *   fgts         vai para a conta do FGTS / guia (não passa pelo líquido)
 *   informativo  base de cálculo, saldo, referência — só explica
 * Um 'fgts' somado como provento estouraria o líquido em 40% — daí a separação
 * ser do tipo, e não da leitura de quem consulta.
 *
 * `referencia` ('12 dias', '3/12', '40%'), `base` e `formula` são o que
 * transforma um número em auditoria: sem eles, "Férias proporcionais 4.812,50"
 * não dá para conferir nem para explicar em reunião.
 */
create table if not exists public.rescisoes_verbas (
  id          uuid primary key default gen_random_uuid(),
  rescisao_id uuid not null references public.rescisoes(id) on delete cascade,
  ordem       int not null default 0,
  tipo        text not null check (tipo in ('provento','desconto','fgts','informativo')),
  rubrica     text not null,                  -- 'Saldo de salário'
  referencia  text,                           -- '12 dias' · '3/12' · '40%'
  base        numeric(14,2),                  -- base de cálculo da verba
  valor       numeric(14,2) not null,         -- sempre >= 0
  formula     text,                           -- 'salário 5.000,00 / 30 × 12 dias'
  fundamento  text,                           -- 'CLT art. 477' (opcional)
  incide_inss boolean,
  incide_irrf boolean,
  incide_fgts boolean
);

create index if not exists rescisoes_verbas_resc_idx on public.rescisoes_verbas (rescisao_id, ordem);

alter table public.rescisoes        enable row level security;
alter table public.rescisoes_verbas enable row level security;

drop policy if exists "rescisoes_select_auth" on public.rescisoes;
create policy "rescisoes_select_auth"
  on public.rescisoes for select to authenticated using (true);

drop policy if exists "rescisoes_verbas_select_auth" on public.rescisoes_verbas;
create policy "rescisoes_verbas_select_auth"
  on public.rescisoes_verbas for select to authenticated using (true);
-- Escrita só pelas funções abaixo: o cálculo vem da skill e a mudança de
-- situação precisa de autor registrado.


/* ============================================================
 *  Normalização de nome — só para casar com a Biblioteca
 * ============================================================
 * Mesma receita do resto do Hub (lower + unaccent + espaço colapsado), aqui
 * para achar o colaborador em `lib_colaboradores` e para montar a `chave`.
 */
create or replace function public.rescisao_nome_chave(p_nome text)
returns text
language sql
stable                                        -- `unaccent` é STABLE, não IMMUTABLE
set search_path = public, pg_temp
as $$
  select lower(btrim(regexp_replace(unaccent(coalesce(p_nome, '')), '\s+', ' ', 'g')));
$$;

revoke all on function public.rescisao_nome_chave(text) from public;
revoke all on function public.rescisao_nome_chave(text) from anon;
grant execute on function public.rescisao_nome_chave(text) to authenticated;
grant execute on function public.rescisao_nome_chave(text) to service_role;


/* ============================================================
 *  Registro — o ponto de entrada da skill
 * ============================================================
 * Uma chamada, um payload, idempotente POR RESCISÃO: regravar a mesma pessoa
 * com a mesma data de desligamento troca o cálculo inteiro (cabeçalho + todas
 * as verbas) e não encosta nas outras. É o que permite corrigir um salário-base
 * errado sem refazer o ano.
 *
 * Aceita uma rescisão só ou um lote (útil na primeira carga, com o histórico).
 *
 * Payload:
 *   { "rescisoes": [ {
 *       "colaborador":  "João da Silva",       -- obrigatório
 *       "desligamento": "2026-08-15",          -- obrigatório (término do contrato)
 *       "motivo":       "sem_justa_causa",     -- obrigatório (ver o check da tabela)
 *       "chave":        "...",                 -- opcional; padrão nome+desligamento
 *       "cpf": "000.000.000-00", "matricula": "123",
 *       "cargo": "Analista", "departamento": "Financeiro", "centro_custo": "ADM",
 *       "vinculo": "clt",
 *       "admissao": "2024-03-01", "aviso_em": "2026-08-01",
 *       "aviso_previo": "indenizado", "aviso_dias": 33,
 *       "salario_base": 5000.00,
 *       "total_proventos": 12345.67,           -- opcional: na falta, soma das verbas
 *       "total_descontos": 1234.56,
 *       "liquido": 11111.11,
 *       "fgts_base_multa": 8000.00, "fgts_multa": 3200.00,
 *       "fgts_recolher": 400.00,   "encargos": 0,
 *       "custo_empresa": 14711.11,             -- opcional: líquido + multa + recolher + encargos
 *       "data_pagamento_prevista": "2026-08-25",
 *       "data_pagamento": null,
 *       "situacao": "calculada",               -- calculada | conferida | paga | cancelada
 *       "memoria_md": "### Como cheguei nos números\n…",
 *       "observacao": null,
 *       "fonte": "Cálculo de Rescisão", "skill_versao": "1.2",
 *       "calculado_em": "2026-08-18T10:00:00Z",
 *       "arquivo": "rescisao-joao.pdf",
 *       "verbas": [ {
 *           "tipo": "provento",                -- provento | desconto | fgts | informativo
 *           "rubrica": "Saldo de salário",
 *           "referencia": "15 dias",
 *           "base": 5000.00,
 *           "valor": 2500.00,                  -- SEMPRE positivo
 *           "formula": "5.000,00 / 30 × 15",
 *           "fundamento": "CLT art. 457",
 *           "incide_inss": true, "incide_irrf": true, "incide_fgts": true
 *         } ] } ] }
 *
 * Retorno: { ok, rescisoes, itens: [ { chave, id, verbas, divergencia } ] }
 * `divergencia` é a diferença (em reais) entre o líquido declarado e o que as
 * verbas somam — 0 quando fecha, e é o campo que a skill deve olhar.
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
  v_id        uuid;
  v_chave     text;
  v_deslig    date;
  v_nome      text;
  v_colab     uuid;
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
  -- Um objeto solto também serve: a skill não deveria ter de embrulhar uma
  -- rescisão só num array para gravá-la.
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

    -- Vínculo com a Biblioteca: por id, se a skill souber; senão pelo nome
    -- normalizado. Não achar não é erro — a pessoa pode ter saído antes de o
    -- cadastro existir —, só deixa a rescisão sem link.
    v_colab := nullif(r->>'colaborador_id', '')::uuid;
    if v_colab is null then
      select c.id into v_colab
        from public.lib_colaboradores c
       where public.rescisao_nome_chave(c.nome) = public.rescisao_nome_chave(v_nome)
       limit 1;
    end if;

    -- Soma das verbas do payload, para preencher o que a skill não declarou e
    -- para medir a divergência do que ela declarou.
    select
      coalesce(sum(case when v->>'tipo' = 'provento' then abs((v->>'valor')::numeric) end), 0),
      coalesce(sum(case when v->>'tipo' = 'desconto' then abs((v->>'valor')::numeric) end), 0)
      into v_prov_calc, v_desc_calc
      from jsonb_array_elements(coalesce(r->'verbas', '[]'::jsonb)) v;

    v_prov := coalesce(nullif(r->>'total_proventos', '')::numeric, v_prov_calc);
    v_desc := coalesce(nullif(r->>'total_descontos', '')::numeric, v_desc_calc);
    v_liq  := coalesce(nullif(r->>'liquido', '')::numeric, v_prov - v_desc);

    v_multa    := nullif(r->>'fgts_multa', '')::numeric;
    v_recolher := nullif(r->>'fgts_recolher', '')::numeric;
    v_encargos := nullif(r->>'encargos', '')::numeric;
    -- Na falta do custo declarado, monta-se o que sai do caixa. `fgts_base_multa`
    -- fica de fora de propósito: é base de cálculo, não pagamento.
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
      registrado_por, registrado_em, atualizado_em
    ) values (
      v_chave, v_nome, v_colab,
      nullif(btrim(r->>'cpf'), ''), nullif(btrim(r->>'matricula'), ''),
      nullif(btrim(r->>'cargo'), ''), nullif(btrim(r->>'departamento'), ''),
      nullif(btrim(r->>'centro_custo'), ''),
      coalesce(nullif(btrim(r->>'vinculo'), ''), 'clt'),
      nullif(r->>'admissao', '')::date,
      nullif(r->>'aviso_em', '')::date,
      v_deslig,
      coalesce(nullif(btrim(r->>'motivo'), ''), 'outro'),
      nullif(btrim(r->>'aviso_previo'), ''),
      nullif(r->>'aviso_dias', '')::int,
      nullif(r->>'salario_base', '')::numeric,
      v_prov, v_desc, v_liq,
      nullif(r->>'fgts_base_multa', '')::numeric, v_multa, v_recolher, v_encargos, v_custo,
      -- Prazo do art. 477 §6º: 10 dias corridos do término do contrato. A skill
      -- pode mandar a data combinada; na falta dela, vale o teto legal.
      coalesce(nullif(r->>'data_pagamento_prevista', '')::date, v_deslig + 10),
      nullif(r->>'data_pagamento', '')::date,
      coalesce(nullif(btrim(r->>'situacao'), ''), 'calculada'),
      nullif(r->>'memoria_md', ''), nullif(r->>'observacao', ''),
      nullif(btrim(r->>'fonte'), ''), nullif(btrim(r->>'skill_versao'), ''),
      nullif(r->>'calculado_em', '')::timestamptz,
      nullif(btrim(r->>'arquivo'), ''),
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
      -- Pagamento e situação são do HUB depois de gravados: quem marcou "paga em
      -- 20/08" no painel não perde isso porque a skill rodou de novo. A skill só
      -- consegue escrever aqui se mandar o campo explicitamente.
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
      atualizado_em   = now()
    returning id into v_id;

    -- Troca o detalhamento inteiro. Regravar é substituir, não acumular: sem o
    -- delete, corrigir uma verba deixaria a errada viva ao lado da certa.
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
    from jsonb_array_elements(coalesce(r->'verbas', '[]'::jsonb)) with ordinality as v(value, pos)
    where nullif(btrim(v.value->>'rubrica'), '') is not null;

    get diagnostics v_n = row_count;
    v_total := v_total + 1;
    v_itens := v_itens || jsonb_build_object(
      'chave', v_chave,
      'id', v_id,
      'verbas', v_n,
      -- 0 quando o líquido declarado fecha com as verbas. Diferente de 0 é o
      -- aviso que a tela vai mostrar — e que a skill deveria corrigir na origem.
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


/* ============================================================
 *  Situação — o controle de quem paga
 * ============================================================
 * O ciclo é 'calculada' → 'conferida' → 'paga', e 'cancelada' para o cálculo
 * que não virou desligamento (ou que entrou duplicado). Cancelada continua
 * gravada de propósito: a tela a mostra riscada e a tira das somas, o que é
 * diferente de nunca ter existido.
 *
 * Marcar 'paga' sem data assume hoje — é o caso comum (marca-se no dia em que
 * se pagou), e obrigar a digitar a data seria atrito sem ganho.
 */
create or replace function public.rescisao_situacao(
  p_id             uuid,
  p_situacao       text,
  p_data_pagamento date default null,
  p_observacao     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if p_situacao not in ('calculada','conferida','paga','cancelada') then
    raise exception 'Situação inválida: %', p_situacao;
  end if;

  update public.rescisoes set
    situacao       = p_situacao,
    data_pagamento = case
                       when p_situacao = 'paga' then coalesce(p_data_pagamento, data_pagamento, current_date)
                       when p_situacao in ('calculada','conferida') then null
                       else data_pagamento
                     end,
    observacao     = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
    atualizado_em  = now()
  where id = p_id;

  if not found then
    raise exception 'Rescisão não encontrada.';
  end if;
end;
$$;

revoke all on function public.rescisao_situacao(uuid, text, date, text) from public;
revoke all on function public.rescisao_situacao(uuid, text, date, text) from anon;
grant execute on function public.rescisao_situacao(uuid, text, date, text) to authenticated;
grant execute on function public.rescisao_situacao(uuid, text, date, text) to service_role;


comment on table public.rescisoes is
  'Uma linha por desligamento, calculado pela skill de rescisão do Claude. Totais vêm da skill e são conferidos contra a soma das verbas — divergência aparece na tela, não é corrigida em silêncio.';
comment on table public.rescisoes_verbas is
  'O detalhamento da rescisão, verba por verba. `valor` sempre positivo; o sinal está em `tipo` (provento/desconto/fgts/informativo). fgts e informativo NÃO entram no líquido.';
comment on column public.rescisoes.custo_empresa is
  'O que sai do caixa: líquido + fgts_multa + fgts_recolher + encargos. `fgts_base_multa` fica fora — é base de cálculo.';
