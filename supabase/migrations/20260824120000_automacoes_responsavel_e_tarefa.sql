-- Linha de produção: quem toca cada automação, e o botão que vira tarefa.
--
-- Três coisas que andam juntas:
--
-- 1. RESPONSÁVEL PADRONIZADO. O campo é texto livre e apodreceu: sete grafias
--    para duas pessoas ("Henrique"/"Henrique ", "Júlia"/"Julia"/"Julia "/
--    "Júlia "). Um filtro montado sobre o valor cru listaria sete opções e
--    esconderia metade das automações de quem se procura. O módulo de tarefas
--    já decidiu a grafia canônica (o select do TaskDialog tem exatamente
--    "Henrique" e "Júlia") — aqui só se adota a mesma.
--
-- 2. VÍNCULO automação → tarefa. É o que permite o botão virar "ver tarefa" em
--    vez de abrir a terceira cópia do mesmo trabalho, e o que faz o card do
--    Kanban saber de que automação ele nasceu.
--
-- 3. A COLUNA "automações" MORRE. Ela nunca existiu de verdade: as colunas do
--    quadro vivem no localStorage de cada navegador (tarefas.columns.cfg.v1) e
--    "automações" não está em DEFAULT_COLUMNS. Ou seja, as 9 tarefas paradas lá
--    são invisíveis para qualquer pessoa que não tenha essa coluna salva na
--    própria máquina. Elas voltam para "Backlog" — que todo mundo enxerga — e
--    passam a se distinguir pelo carimbo (cat_natureza = 'Automação'), não pela
--    coluna.

-- ---------------------------------------------------------------------------
-- 1. Vínculo com a tarefa
-- ---------------------------------------------------------------------------
-- Nullable: automação que ainda não virou trabalho não tem tarefa. O
-- `on delete set null` é o que deixa criar uma nova depois de apagar a antiga
-- no quadro — sem ele o vínculo apontaria para um fantasma e o botão travaria.
alter table public.automacoes_catalogo
  add column if not exists tarefa_id uuid
  references public.tarefas(id) on delete set null;

create index if not exists idx_automacoes_catalogo_tarefa
  on public.automacoes_catalogo(tarefa_id)
  where tarefa_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Grafia canônica do responsável
-- ---------------------------------------------------------------------------
-- Casamento por valor exato depois do btrim, e não por prefixo (`ilike 'juli%'`
-- pegaria uma Juliana no dia em que entrar uma). "Ambos", "RPA" e "VPX" ficam
-- como estão de propósito: não são erro de digitação, são respostas legítimas.
update public.automacoes_catalogo
   set responsavel = 'Henrique', updated_at = now()
 where responsavel is not null
   and btrim(responsavel) = 'Henrique'
   and responsavel <> 'Henrique';

update public.automacoes_catalogo
   set responsavel = 'Júlia', updated_at = now()
 where responsavel is not null
   and btrim(responsavel) in ('Júlia', 'Julia')
   and responsavel <> 'Júlia';

-- ---------------------------------------------------------------------------
-- 3. Esvaziar a coluna "automações"
-- ---------------------------------------------------------------------------
-- O histórico registra o movimento porque foi o sistema que moveu, não a
-- pessoa: sem esta linha a tarefa aparece em outra coluna amanhã sem explicação.
-- `usuario` nulo é a marca de "quem fez foi a automação", igual ao Facilities.
insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao)
select id, titulo, 'movida',
       'Movida de "automações" para "Backlog": a coluna foi removida do quadro '
       || '(ela só existia no navegador de quem a criou). O card agora se '
       || 'identifica pelo carimbo de automação.'
  from public.tarefas
 where status = 'automações';

update public.tarefas
   set status = 'Backlog', updated_at = now()
 where status = 'automações';

-- Nada de sair carimbando cat_natureza por padrão de título: 7 das 9 já são
-- 'Automação' e acendem a faixa sozinhas. As outras duas ("[PROJETO] Omie e
-- Asaas", "Estudar Open Finance") ficam como estão porque não são construção de
-- automação — e um regex em cima de "[RPA]" ainda pegaria os cards da coluna
-- Tasks - RPA, que já têm chip próprio e ficariam marcados duas vezes.

-- ---------------------------------------------------------------------------
-- 4. A automação vira tarefa
-- ---------------------------------------------------------------------------
/*
 * Espelha `cartao_recomendacao_tarefa`: um clique de gente numa ficha abre a
 * tarefa no quadro, com o vínculo de volta gravado na origem.
 *
 * POR QUE RPC, E NÃO INSERT NA TELA: são quatro escritas que precisam andar
 * juntas (tarefa, log, vínculo e o `ordem` calculado do topo da fila). Feito no
 * front, uma falha de rede no meio deixa tarefa sem vínculo — e aí o botão
 * oferece criar a segunda.
 *
 * POR QUE BOTÃO, E NÃO GATILHO NO STATUS: diferente do Facilities, aqui não há
 * caminho automático que mereça virar trabalho sozinho. Arrastar um card no
 * kanban do catálogo é gesto de arrumação, não decisão de começar.
 *
 * IDEMPOTENTE: chamar duas vezes devolve a MESMA tarefa, enquanto ela estiver
 * viva no quadro. Concluída ou arquivada, o vínculo se solta e uma nova pode
 * nascer — retomar uma automação depois de meses é caso real, e obrigar a
 * apagar a tarefa velha para isso seria pior.
 */
create or replace function public.automacao_criar_tarefa(
  p_id          uuid,
  p_responsavel text default null,
  p_prazo       date default null,
  p_prioridade  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a         public.automacoes_catalogo;
  v_resp    text;
  v_prio    text;
  v_obs     text;
  v_ordem   int;
  v_tarefa  uuid;
  v_viva    uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select * into a from public.automacoes_catalogo where id = p_id;
  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  -- Já tem tarefa viva? Devolve ela. "Viva" exclui concluída e arquivada: essas
  -- somem do quadro, e apontar para elas faria o botão dizer "ver tarefa" sobre
  -- algo que a pessoa não consegue mais achar.
  if a.tarefa_id is not null then
    select t.id into v_viva
      from public.tarefas t
     where t.id = a.tarefa_id
       and t.arquivada_em is null
       and t.status <> 'Concluído';
    if found then
      return v_viva;
    end if;
  end if;

  -- Responsável: o que a tela mandou, senão o dono da automação. "Ambos" não
  -- serve como dono de tarefa (o quadro filtra por pessoa), então a tela é
  -- obrigada a escolher — aqui só se recusa o vazio.
  v_resp := nullif(btrim(coalesce(p_responsavel, a.responsavel, '')), '');
  if v_resp is null or v_resp = 'Ambos' then
    raise exception 'Escolha quem vai tocar esta automação.';
  end if;

  -- Prioridade herda o impacto quando a tela não opina: alto impacto é o que a
  -- fila já mandou fazer primeiro, e a tarefa não deveria discordar dela.
  v_prio := coalesce(
    nullif(btrim(coalesce(p_prioridade, '')), ''),
    case btrim(coalesce(a.impacto, ''))
      when 'Alto'  then 'Alta'
      when 'Baixo' then 'Baixa'
      else 'Média'
    end
  );

  v_obs := 'Aberta da Linha de Produção (Time › IA & Automação).'
           || coalesce(E'\n\nDor: '     || nullif(btrim(a.dor), ''),     '')
           || coalesce(E'\n\nSolução: ' || nullif(btrim(a.solucao), ''), '')
           || coalesce(E'\n\nFerramentas: ' || nullif(btrim(a.ferramentas), ''), '')
           || E'\n\nImpacto ' || coalesce(nullif(btrim(a.impacto), ''), 'Médio')
           || ' · Esforço '   || coalesce(nullif(btrim(a.esforco), ''), 'Médio')
           || coalesce(' · Nível N' || a.nivel::text, '');

  select coalesce(max(ordem), 0) + 1 into v_ordem from public.tarefas;

  insert into public.tarefas (
    ordem, titulo, responsavel, status, prioridade, prazo, observacao,
    subtarefas, cat_natureza, cat_area, cat_origem
  ) values (
    v_ordem,
    a.automacao,
    v_resp,
    'Backlog',
    v_prio,
    -- Prazo no fuso de quem lê: às 22h de Brasília o banco (UTC) já virou o dia
    -- e o prazo cairia um dia adiante do combinado. Uma semana, e não três dias
    -- como no cartão: construir automação não é conferir lançamento.
    coalesce(p_prazo, (now() at time zone 'America/Sao_Paulo')::date + 7),
    v_obs,
    '[]'::jsonb,
    'Automação',
    'Sistema/Hub',
    'auto'
  )
  returning id into v_tarefa;

  -- Aqui o autor É conhecido (foi um clique na ficha), diferente do gatilho do
  -- Facilities, onde `usuario` fica nulo porque quem criou foi a máquina.
  insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario_id)
  values (v_tarefa, a.automacao, 'criada',
          'Criada da Linha de Produção: automação "' || a.automacao || '"',
          auth.uid());

  update public.automacoes_catalogo
     set tarefa_id = v_tarefa, updated_at = now()
   where id = p_id;

  return v_tarefa;
end;
$$;

-- Função nova nasce chamável por `anon` neste projeto — o revoke não é zelo,
-- é o que impede criar tarefa sem login. Um por linha: em bloco, um nome errado
-- derruba os outros junto.
revoke all on function public.automacao_criar_tarefa(uuid, text, date, text) from public;
revoke all on function public.automacao_criar_tarefa(uuid, text, date, text) from anon;
grant execute on function public.automacao_criar_tarefa(uuid, text, date, text) to authenticated;
