-- Histórico com buraco só emenda com confirmação.
--
-- ── O QUE ACONTECEU ───────────────────────────────────────────────────────
--
-- As três cargas do Conta Azul (…20260909200000, …220000, …235500) casaram o
-- apelido do extrato ("juliane marketing", "joao vitor", "luis gui") com a
-- ficha do Portal RH que tinha o mesmo primeiro nome. Em 14/09/2026 a
-- varredura por fichas com 3+ meses sem pagamento achou oito casos com código
-- do RH, e o financeiro conferiu um por um:
--
--   mesma pessoa   Bruno de Pádua Fischer (16 meses), Kelven Silva Santos (13)
--   OUTRA pessoa   Mariana Fiorin (21), Renata Ruas (20), Luiz Fernando (10),
--                  Daniel Marcos (9), Luis Guilherme (4), João Vitor Clasen (3)
--
-- mais a Juliane, separada em …20260914120000. Seis em oito. Nome parecido não
-- prova nada; o que acusa é a LINHA DO TEMPO: a série para, fica meses sem nada
-- (quase sempre terminando num acerto de contas) e recomeça, muitas vezes em
-- outra área. Buraco de UM mês é normal — é o `dDtRegistro` do Omie
-- escorregando (16 casos) — e não entra.
--
-- ── A TRAVA ───────────────────────────────────────────────────────────────
--
-- 1. `remuneracao_emendas()` lista todo buraco de 3+ meses, e
--    `remuneracao_emenda_confirmada` guarda os que uma pessoa disse que são a
--    mesma pessoa.
-- 2. Um trigger RECUSA gravar linha por nome (Conta Azul, manual, NF do Drive)
--    que encoste num buraco não confirmado. Carga futura que emende duas
--    pessoas quebra na hora, em vez de aparecer semanas depois na tela.
-- 3. O Omie fica FORA do trigger: a carga diária roda às 09:40 e uma exceção
--    ali pararia a remuneração inteira. O Omie casa por CNPJ primeiro; o que
--    ele emendar por nome aparece na fila da tela, igual a qualquer outro.
-- 4. A tela ganha a fila "Conferir históricos": "mesma pessoa" confirma,
--    "separar" leva o trecho anterior ao buraco para uma ficha própria.
--
-- A separação NÃO move título do Omie: a carga regrava `pessoa_id` no
-- `on conflict` e desfaria a separação no dia seguinte, calada. Quando o
-- trecho tem Omie, o conserto é no favorecido do ERP, e a função diz isso.

/* ------------------------------------------------------------------ */
/* 1. As confirmações                                                  */
/* ------------------------------------------------------------------ */

create table if not exists public.remuneracao_emenda_confirmada (
  pessoa_id      uuid not null references public.remuneracao_pessoa(id) on delete cascade,
  -- Último mês pago ANTES do buraco. É a chave: se a série mudar e o buraco
  -- andar, a confirmação antiga não vale para o buraco novo.
  depois_de      date not null,
  confirmado_por uuid,
  observacao     text,
  criado_em      timestamptz not null default now(),
  primary key (pessoa_id, depois_de)
);

alter table public.remuneracao_emenda_confirmada enable row level security;
-- Sem policy: só as funções abaixo (DEFINER) leem e escrevem.
revoke all on public.remuneracao_emenda_confirmada from anon, authenticated;

/* ------------------------------------------------------------------ */
/* 2. Os buracos                                                       */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao_emendas(p_pessoas uuid[] default null)
returns table (
  pessoa_id   uuid,
  nome        text,
  codigo_rh   text,
  depois_de   date,
  retoma_em   date,
  meses_sem   integer,
  area_antes  text,
  area_depois text,
  confirmada  boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with m as (
    -- A área do mês sai do fixo quando há fixo: a premiação pode ser do time
    -- antigo no mês da transferência.
    select l.pessoa_id, l.competencia,
           coalesce(max(l.categoria) filter (where l.bloco in ('fixo', 'prolabore')),
                    max(l.categoria)) as categoria
      from public.remuneracao_lancamento l
     where p_pessoas is null or l.pessoa_id = any(p_pessoas)
     group by 1, 2
  ), g as (
    select m.*,
           lag(m.competencia) over w as anterior,
           lag(m.categoria)   over w as categoria_anterior
      from m
    window w as (partition by m.pessoa_id order by m.competencia)
  )
  select g.pessoa_id, p.nome, p.codigo_rh, g.anterior, g.competencia,
         (extract(year from age(g.competencia, g.anterior)) * 12
          + extract(month from age(g.competencia, g.anterior)))::int - 1,
         -- "3.2.7.4 .Escala - Suporte" → "Suporte"; "Diretores - Administrativo" → "Administrativo"
         btrim(regexp_replace(g.categoria_anterior, '^.*-', '')),
         btrim(regexp_replace(g.categoria, '^.*-', '')),
         exists (select 1 from public.remuneracao_emenda_confirmada c
                  where c.pessoa_id = g.pessoa_id and c.depois_de = g.anterior)
    from g
    join public.remuneracao_pessoa p on p.id = g.pessoa_id
   where g.anterior is not null
     -- 3+ meses sem pagamento: retoma no 4º mês depois do último pago, ou além.
     and g.competencia > g.anterior + interval '3 months'
$function$;

/* Onde começa o trecho que termina em `p_depois_de`: logo depois do buraco
   anterior (confirmado ou não), ou no primeiro mês da ficha. É o que a
   separação leva — nunca a ficha inteira para trás. */
create or replace function public.remuneracao__inicio_do_trecho(p_pessoa uuid, p_depois_de date)
returns date
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select max(e.retoma_em) from public.remuneracao_emendas(array[p_pessoa]) e
      where e.retoma_em <= p_depois_de),
    (select min(l.competencia) from public.remuneracao_lancamento l where l.pessoa_id = p_pessoa)
  )
$function$;

/* ------------------------------------------------------------------ */
/* 3. A trava na gravação                                              */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao__checar_chegada(p_chegou jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v record;
begin
  if p_chegou is null or jsonb_array_length(p_chegou) = 0 then return; end if;

  select e.* into v
    from public.remuneracao_emendas(
           (select array_agg(distinct (x ->> 'p')::uuid) from jsonb_array_elements(p_chegou) x)
         ) e
   where not e.confirmada
     -- Só o buraco que ESTA gravação encosta. Um buraco antigo, ainda na fila da
     -- tela, não pode travar uma correção feita em outra ponta da mesma ficha.
     and exists (
       select 1 from jsonb_array_elements(p_chegou) x
        where (x ->> 'p')::uuid = e.pessoa_id
          and (x ->> 'c')::date in (e.depois_de, e.retoma_em)
     )
   order by e.meses_sem desc
   limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = format(
        '%s ficaria com %s meses sem pagamento entre %s e %s (%s → %s) — nome parecido não prova que é a mesma pessoa.',
        v.nome, v.meses_sem, to_char(v.depois_de, 'MM/YYYY'), to_char(v.retoma_em, 'MM/YYYY'),
        coalesce(v.area_antes, '?'), coalesce(v.area_depois, '?')),
      hint = 'Se for a mesma pessoa, confirme antes: remuneracao_confirmar_emenda(pessoa, depois_de). '
          || 'Se não for, grave numa ficha própria, "Nome (Área)".';
  end if;
end $function$;

create or replace function public.remuneracao__guarda_emenda_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.remuneracao__checar_chegada((
    select jsonb_agg(distinct jsonb_build_object('p', n.pessoa_id, 'c', n.competencia))
      from novos n
     where n.fonte <> 'omie'
  ));
  return null;
end $function$;

create or replace function public.remuneracao__guarda_emenda_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.remuneracao__checar_chegada((
    select jsonb_agg(distinct jsonb_build_object('p', n.pessoa_id, 'c', n.competencia))
      from novos n
      join antigos o on o.id = n.id
     where n.fonte <> 'omie'
       and (o.pessoa_id is distinct from n.pessoa_id or o.competencia is distinct from n.competencia)
  ));
  return null;
end $function$;

-- Por COMANDO, não por linha: uma carga de 800 linhas checa uma vez. Postgres
-- não aceita tabela de transição em trigger de dois eventos, daí serem dois.
drop trigger if exists trg_remuneracao_emenda_insert on public.remuneracao_lancamento;
create trigger trg_remuneracao_emenda_insert
  after insert on public.remuneracao_lancamento
  referencing new table as novos
  for each statement execute function public.remuneracao__guarda_emenda_insert();

drop trigger if exists trg_remuneracao_emenda_update on public.remuneracao_lancamento;
create trigger trg_remuneracao_emenda_update
  after update on public.remuneracao_lancamento
  referencing old table as antigos new table as novos
  for each statement execute function public.remuneracao__guarda_emenda_update();

/* ------------------------------------------------------------------ */
/* 4. O que a tela chama                                               */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao_emendas_suspeitas()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not public.pode_ver_remuneracao() then
    raise exception 'sem permissão para conferir históricos';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'pessoa_id',    e.pessoa_id,
             'nome',         e.nome,
             'codigo_rh',    e.codigo_rh,
             'cargo',        r.cargo,
             'depois_de',    e.depois_de,
             'retoma_em',    e.retoma_em,
             'meses_sem',    e.meses_sem,
             'area_antes',   e.area_antes,
             'area_depois',  e.area_depois,
             'desde',        t.desde,
             'total_antes',  t.total,
             'tem_omie',     t.tem_omie,
             'fixo_antes',   (select sum(l.valor) from public.remuneracao_lancamento l
                               where l.pessoa_id = e.pessoa_id and l.competencia = e.depois_de and l.bloco = 'fixo'),
             'fixo_depois',  (select sum(l.valor) from public.remuneracao_lancamento l
                               where l.pessoa_id = e.pessoa_id and l.competencia = e.retoma_em and l.bloco = 'fixo')
           ) order by e.codigo_rh is null, e.meses_sem desc, e.nome)
      from public.remuneracao_emendas(null) e
      left join public.rh_colaboradores r on r.codigo = e.codigo_rh
      cross join lateral (
        select d.desde,
               (select sum(l.valor) from public.remuneracao_lancamento l
                 where l.pessoa_id = e.pessoa_id and l.competencia between d.desde and e.depois_de) as total,
               exists (select 1 from public.remuneracao_lancamento l
                        where l.pessoa_id = e.pessoa_id and l.fonte = 'omie'
                          and l.competencia between d.desde and e.depois_de) as tem_omie
          from (select public.remuneracao__inicio_do_trecho(e.pessoa_id, e.depois_de) as desde) d
      ) t
     where not e.confirmada
  ), '[]'::jsonb);
end $function$;

create or replace function public.remuneracao_confirmar_emenda(
  p_pessoa uuid, p_depois_de date, p_observacao text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not public.pode_ver_remuneracao() then
    raise exception 'sem permissão para confirmar históricos';
  end if;
  if not exists (select 1 from public.remuneracao_pessoa where id = p_pessoa) then
    raise exception 'ficha não encontrada';
  end if;

  -- Não exige que o buraco já exista: uma carga pode confirmar ANTES de gravar
  -- a linha que o cria, que é justamente o caminho que o trigger pede.
  insert into public.remuneracao_emenda_confirmada (pessoa_id, depois_de, confirmado_por, observacao)
  values (p_pessoa, p_depois_de, auth.uid(), nullif(btrim(p_observacao), ''))
  on conflict (pessoa_id, depois_de) do update
    set confirmado_por = excluded.confirmado_por,
        observacao     = coalesce(excluded.observacao, remuneracao_emenda_confirmada.observacao),
        criado_em      = now();
end $function$;

create or replace function public.remuneracao_separar_emenda(
  p_pessoa uuid, p_depois_de date, p_nome text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e      record;
  v_nome   text := nullif(btrim(p_nome), '');
  v_chave  text;
  v_alvo   uuid;
  v_desde  date;
begin
  if auth.uid() is not null and not public.pode_ver_remuneracao() then
    raise exception 'sem permissão para separar históricos';
  end if;
  if v_nome is null then
    raise exception 'dê um nome à ficha que vai receber o histórico';
  end if;

  select * into v_e from public.remuneracao_emendas(array[p_pessoa]) e where e.depois_de = p_depois_de;
  if not found then
    raise exception 'essa ficha não tem buraco de 3+ meses depois de %', to_char(p_depois_de, 'MM/YYYY');
  end if;

  v_desde := public.remuneracao__inicio_do_trecho(p_pessoa, p_depois_de);

  if exists (select 1 from public.remuneracao_lancamento l
              where l.pessoa_id = p_pessoa and l.fonte = 'omie'
                and l.competencia between v_desde and p_depois_de) then
    raise exception 'o trecho de % a % tem título do Omie, e a carga diária o devolveria para "%" amanhã',
      to_char(v_desde, 'MM/YYYY'), to_char(p_depois_de, 'MM/YYYY'), v_e.nome
      using hint = 'O conserto é no favorecido do título no Omie (CNPJ ou nome), não aqui.';
  end if;

  v_chave := public.contraparte_chave(v_nome);
  if length(v_chave) < 3 then
    raise exception 'nome curto demais para virar ficha: "%"', v_nome;
  end if;

  -- Nome que já é de uma ficha: o trecho vai para ELA. É assim que se devolve
  -- um histórico ao dono certo — e o trigger confere se isso não abre outro buraco.
  select id into v_alvo from public.remuneracao_pessoa where chave = v_chave;
  if v_alvo = p_pessoa then
    raise exception 'esse nome é o da própria ficha — escolha outro';
  end if;

  if v_alvo is null then
    insert into public.remuneracao_pessoa (nome, chave, eh_pessoa, observacao)
    values (v_nome, v_chave, true,
            format('Histórico de %s a %s separado de "%s" em %s: %s meses sem pagamento antes de a série recomeçar (%s → %s).',
                   to_char(v_desde, 'MM/YYYY'), to_char(p_depois_de, 'MM/YYYY'), v_e.nome,
                   to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
                   v_e.meses_sem, coalesce(v_e.area_antes, '?'), coalesce(v_e.area_depois, '?')))
    returning id into v_alvo;
  end if;

  update public.remuneracao_lancamento
     set pessoa_id = v_alvo
   where pessoa_id = p_pessoa
     and competencia between v_desde and p_depois_de;

  delete from public.remuneracao_emenda_confirmada
   where pessoa_id = p_pessoa and depois_de = p_depois_de;

  return v_alvo;
end $function$;

revoke all on function public.remuneracao_emendas(uuid[])                      from public, anon, authenticated;
revoke all on function public.remuneracao__inicio_do_trecho(uuid, date)        from public, anon, authenticated;
revoke all on function public.remuneracao__checar_chegada(jsonb)               from public, anon, authenticated;
revoke all on function public.remuneracao__guarda_emenda_insert()              from public, anon, authenticated;
revoke all on function public.remuneracao__guarda_emenda_update()              from public, anon, authenticated;
revoke all on function public.remuneracao_emendas_suspeitas()                  from public, anon;
revoke all on function public.remuneracao_confirmar_emenda(uuid, date, text)   from public, anon;
revoke all on function public.remuneracao_separar_emenda(uuid, date, text)     from public, anon;
grant execute on function public.remuneracao_emendas_suspeitas()                to authenticated, service_role;
grant execute on function public.remuneracao_confirmar_emenda(uuid, date, text) to authenticated, service_role;
grant execute on function public.remuneracao_separar_emenda(uuid, date, text)   to authenticated, service_role;

/* ------------------------------------------------------------------ */
/* 5. As decisões de 14/09/2026                                        */
/* ------------------------------------------------------------------ */

do $$
declare
  v_id uuid;
  r    record;
begin
  -- Mesma pessoa, voltou depois de sair.
  for r in select * from (values
      ('BRUNO DE PADUA FISCHER', date '2024-09-01'),
      ('Kelven Silva Santos',    date '2025-04-01')
    ) as t(nome, depois_de)
  loop
    select id into v_id from public.remuneracao_pessoa where nome = r.nome and codigo_rh is not null;
    if v_id is null then raise exception 'ficha não encontrada: %', r.nome; end if;
    perform public.remuneracao_confirmar_emenda(v_id, r.depois_de,
      'Conferido pelo financeiro em 14/09/2026: é a mesma pessoa, que saiu e voltou.');
  end loop;

  -- Outra pessoa com o mesmo primeiro nome. O trecho antes do buraco vai para
  -- uma ficha própria, no padrão das que saíram antes de abr/2026.
  for r in select * from (values
      ('Mariana Fiorin e Silva',          date '2024-07-01', 'Mariana (Marketing)',          10200.00),
      ('RENATA RUAS PESSOA',              date '2024-11-01', 'Renata (Administrativo)',       2700.00),
      ('Luiz Fernando Pinto da Silva',    date '2025-07-01', 'Luiz Fernando (Sucesso)',        283.87),
      ('Daniel Marcos Cunha Pereira',     date '2025-04-01', 'Daniel (Tecnologia)',          16633.93),
      ('Luis Guilherme Borborema Rocha',  date '2025-09-01', 'Luis Guilherme (Automações)',  24770.86),
      -- Não é o João Guilherme: ele tem ficha própria (Administrativo, até
      -- jun/25) e recebeu nos mesmos meses. É um terceiro João, de Tecnologia
      -- (R$ 4.000 → 7.500) que passou a Diretores em dez/24 e saiu em set/25.
      ('João Vitor Clasen de Andrades',   date '2025-09-01', 'João Vitor (Tecnologia)',     168616.48)
    ) as t(nome, depois_de, nova, total)
  loop
    select id into v_id from public.remuneracao_pessoa where nome = r.nome and codigo_rh is not null;
    if v_id is null then raise exception 'ficha não encontrada: %', r.nome; end if;
    v_id := public.remuneracao_separar_emenda(v_id, r.depois_de, r.nova);
    update public.remuneracao_pessoa
       set observacao = 'Saiu antes de abril/2026 — só aparece no export do Conta Azul, com apelido curto. '
                     || format('Não é %s; separada em 14/09/2026.', r.nome)
     where id = v_id;
    if (select sum(valor) from public.remuneracao_lancamento where pessoa_id = v_id) <> r.total then
      raise exception '%: esperava R$ % na ficha nova, veio R$ %', r.nova, r.total,
        (select sum(valor) from public.remuneracao_lancamento where pessoa_id = v_id);
    end if;
  end loop;

  -- Conferência: nenhuma ficha do RH fica com buraco sem decisão.
  if exists (select 1 from public.remuneracao_emendas(null) e where e.codigo_rh is not null and not e.confirmada) then
    raise exception 'ainda há ficha do RH com buraco não conferido: %',
      (select string_agg(e.nome, ', ') from public.remuneracao_emendas(null) e
        where e.codigo_rh is not null and not e.confirmada);
  end if;

  if has_function_privilege('anon', 'public.remuneracao_separar_emenda(uuid, date, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.remuneracao_emendas_suspeitas()', 'EXECUTE') then
    raise exception 'as funções de emenda continuam abertas para anon';
  end if;
end $$;
