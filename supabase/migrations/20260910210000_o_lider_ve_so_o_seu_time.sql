-- O LÍDER VÊ A FOLHA DO PRÓPRIO TIME.
--
-- Até aqui a folha era tudo ou nada: `pode_ver_remuneracao()` liberava admin,
-- diretoria e RH, e mais ninguém. Um Head que precisa de número na mão para
-- conversa de carreira tinha de pedir print para o financeiro.
--
-- Agora existe um segundo degrau. `remuneracao_time` abre UMA tela — o painel —
-- recortada nos setores marcados na ficha DAQUELA CONTA (`profiles.setores_folha`).
-- É por conta e não por perfil de propósito: os dois Heads de hoje têm o mesmo
-- perfil `lideranca` e times diferentes.
--
-- ESCONDER NÃO É PROTEGER, e por isso o recorte não mora no front. As tabelas
-- `remuneracao_*` continuam fechadas ao líder (a policy segue exigindo
-- `pode_ver_remuneracao()`, que ele não tem); o que ele alcança é
-- `remuneracao_painel()`, que passa a ser SECURITY DEFINER e devolve só as
-- pessoas do escopo de quem chamou. Uma tela filtrada por cima de uma tabela
-- aberta seria a folha inteira a um PostgREST de distância.
--
-- ---------------------------------------------------------------------------
-- O TIME DE UMA PESSOA: DUAS FONTES, UMA RESPOSTA
--
-- `rh_colaboradores.setor` é o organograma de hoje, e é o único vocabulário que
-- separa Produto de Tecnologia — na categoria do Omie os dois recebem sob
-- "Tecnologia", e a área derivada da categoria não sabe dividi-los.
--
-- Só que o setor existe só para quem tem ficha no Portal RH. Quem saiu antes de
-- abr/2026 não tem: são 99 favorecidos com pagamento e sem ficha, R$ 2,4 milhões
-- de história. Recortar só pelo setor faria o 2025 de um líder aparecer 29%
-- menor, sem nenhum aviso de que faltava algo.
--
-- Por isso `remuneracao_pessoa` ganha um `setor` PRÓPRIO: a classificação à mão,
-- feita na tela, para quem o RH não conhece. O time efetivo é
-- `coalesce(rh.setor, pessoa.setor)` — a classificação preenche o buraco e nunca
-- briga com o organograma nem é apagada pela carga diária.

-- ─────────────────────── 1. A classificação à mão ───────────────────────

alter table public.remuneracao_pessoa
  add column if not exists setor text;

comment on column public.remuneracao_pessoa.setor is
  'Time classificado à mão, para quem não tem ficha no Portal RH. Só preenche o '
  'buraco: o time efetivo é coalesce(rh_colaboradores.setor, este). A carga '
  'diária não escreve aqui.';

-- A fusão de fichas apaga a absorvida. Sem isto, juntar duas linhas da mesma
-- pessoa perderia a classificação — e ela não voltaria sozinha, porque nada mais
-- escreve nesta coluna.
create or replace function public.remuneracao_fundir(
  p_mantem uuid, p_absorve uuid, p_origem text default 'manual'::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_chave text;
begin
  if p_mantem = p_absorve then return; end if;
  if p_origem not in ('documento', 'manual') then
    raise exception 'origem inválida: %', p_origem;
  end if;

  select chave into v_chave from public.remuneracao_pessoa where id = p_absorve;
  if v_chave is null then return; end if;

  update public.remuneracao_lancamento l
     set pessoa_id = p_mantem
   where l.pessoa_id = p_absorve
     and not exists (
       select 1 from public.remuneracao_lancamento m
       where m.pessoa_id = p_mantem and m.fonte = l.fonte and m.origem_ref = l.origem_ref
     );

  delete from public.remuneracao_lancamento where pessoa_id = p_absorve;

  -- `doc` e `setor` sobrevivem à fusão: o documento porque é o que funde a
  -- próxima duplicata, o setor porque é decisão de gente e não se regenera.
  update public.remuneracao_pessoa p
     set doc   = coalesce(p.doc,   (select doc   from public.remuneracao_pessoa where id = p_absorve)),
         setor = coalesce(p.setor, (select setor from public.remuneracao_pessoa where id = p_absorve))
   where p.id = p_mantem;

  -- Antes do delete: o `on delete cascade` levaria os apelidos junto, e a
  -- duplicata voltaria na próxima carga.
  update public.remuneracao_pessoa_alias set pessoa_id = p_mantem where pessoa_id = p_absorve;

  insert into public.remuneracao_pessoa_alias (chave, pessoa_id, origem)
  values (v_chave, p_mantem, p_origem)
  on conflict (chave) do update
    set pessoa_id = excluded.pessoa_id, origem = excluded.origem;

  delete from public.remuneracao_pessoa where id = p_absorve;
end $function$;

revoke execute on function public.remuneracao_fundir(uuid, uuid, text) from anon;

-- ─────────────────────── 2. O recorte de cada conta ───────────────────────

alter table public.profiles
  add column if not exists setores_folha text[] not null default '{}';

comment on column public.profiles.setores_folha is
  'Os times que esta conta enxerga no painel de Remuneração, pelo nome do setor '
  'no Portal RH. Só vale para quem tem a capacidade remuneracao_time; quem tem '
  'remuneracao vê a empresa inteira e ignora isto. Vazio não abre ninguém.';

/* A POLICY DE UPDATE DE `profiles` DEIXA A PESSOA EDITAR A PRÓPRIA LINHA, e é
   assim que ela troca o próprio nome. Sem esta guarda, ela também se daria os
   times que quisesse com um PATCH — e o recorte inteiro viraria enfeite. Mesma
   trava que já protege `cargo` e `perfil`: para quem não é admin, o campo volta
   ao que era, em silêncio. */
create or replace function public.profiles_guard_cargo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admins_restantes integer;
begin
  -- Cron, Edge Functions e RPCs definer passam direto: não têm auth.uid() e
  -- reprovariam na checagem de admin.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if public.eh_admin() then
    -- NÃO DEIXE A CASA SEM CHAVE. Se o último admin se rebaixar, ninguém mais
    -- consegue mexer em perfil nenhum pela tela — o conserto passaria a exigir
    -- SQL direto no banco. Barrar aqui custa uma linha e evita o lockout.
    if old.perfil = 'admin' and new.perfil is distinct from 'admin' then
      select count(*) into v_admins_restantes
        from public.profiles p
       where p.perfil = 'admin' and p.id <> old.id;
      if v_admins_restantes = 0 then
        raise exception 'este é o último admin do Hub — promova outra pessoa antes de mudar este perfil';
      end if;
    end if;
    return new;
  end if;

  -- Todo o resto: os campos de acesso voltam ao que eram, em silêncio. O update
  -- do próprio nome continua passando.
  new.cargo         := old.cargo;
  new.perfil        := old.perfil;
  new.setores_folha := old.setores_folha;
  return new;
end;
$function$;

-- ─────────────────────── 3. A capacidade nova ───────────────────────

/* O admin não se edita: qualquer escrita na linha dele devolve a linha cheia.
   `remuneracao_time` entra aqui junto das outras — quem vê tudo também "vê o
   time", e uma capacidade faltando na coluna travada pareceria defeito da tela. */
create or replace function public.acesso_perfil_guarda()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' and old.perfil = 'admin' then
    raise exception 'a linha do admin não pode ser removida';
  end if;
  if new.perfil = 'admin' then
    new.capacidades := array[
      'metricas', 'tesouraria', 'conciliacao', 'demonstracoes', 'planejamento',
      'orcamento', 'societario', 'apresentacoes', 'editais', 'remuneracao',
      'remuneracao_time',
      'time', 'biblioteca', 'maquinario', 'usuarios', 'parceiros', 'facilities',
      'assistente'
    ];
  end if;
  return new;
end;
$function$;

-- Toca a linha do admin para o trigger reescrevê-la com a capacidade nova.
update public.acesso_perfil set atualizado_em = now() where perfil = 'admin';

/* Abre a tela recortada. Lê a MESMA `acesso_perfil` que a tela de Perfis de
   acesso grava — repetir a lista de perfis aqui dentro faria desmarcar na tela
   esconder o menu e deixar o dado passar. */
create or replace function public.pode_ver_remuneracao_do_time()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select p.perfil = 'admin'
        or 'remuneracao_time' = any(coalesce(
             (select a.capacidades from public.acesso_perfil a where a.perfil = p.perfil),
             '{}'::text[]))
      from public.profiles p
     where p.user_id = auth.uid()
     limit 1), false)
$function$;

revoke execute on function public.pode_ver_remuneracao_do_time() from anon;

-- ─────────────────────── 4. O painel, recortado no servidor ───────────────────────

/* Era `language sql` e confiava na RLS das tabelas. Agora é DEFINER, e por isso
   a permissão passa a ser explícita e é a PRIMEIRA coisa que acontece aqui: sem
   ela, qualquer conta autenticada leria a folha inteira por esta função.
   Quem tem `remuneracao` continua vendo tudo; o líder vê os setores dele; quem
   não tem nenhuma das duas leva exceção, não um jsonb vazio — "nenhuma pessoa" e
   "sem permissão" são indistinguíveis para quem está olhando a tela. */
create or replace function public.remuneracao_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tudo    boolean := public.pode_ver_remuneracao();
  v_setores text[]  := '{}';
  v_out     jsonb;
begin
  if not v_tudo then
    if not public.pode_ver_remuneracao_do_time() then
      raise exception 'sem permissão para ver a remuneração';
    end if;
    select coalesce(p.setores_folha, '{}') into v_setores
      from public.profiles p where p.user_id = auth.uid() limit 1;
  end if;

  with pessoa as (
    select
      p.id, p.nome, p.codigo_rh, p.doc, p.eh_pessoa,
      r.cargo,
      -- O TIME EFETIVO. O Portal RH manda; a classificação à mão preenche o
      -- buraco de quem ele não conhece.
      coalesce(r.setor, p.setor) as setor,
      -- De onde veio o time, para a tela poder pedir a classificação do resto.
      case when r.setor is not null then 'rh'
           when p.setor is not null then 'manual'
           else null end as setor_fonte,
      r.modalidade,
      nullif(btrim(r.inicio), '')   as inicio,
      nullif(btrim(r.datadesl), '') as datadesl,
      r.valor as valor_contrato,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'competencia', m.competencia,
            'fixo',        coalesce(m.fixo, 0),
            'prolabore',   coalesce(m.prolabore, 0),
            'premiacao',   coalesce(m.premiacao, 0),
            'escala',      coalesce(m.escala, 0),
            'outro',       coalesce(m.outro, 0),
            'total',       m.total,
            'fontes',      m.fontes,
            'area',        m.area
          ) order by m.competencia
        ) filter (where m.competencia is not null),
        '[]'::jsonb
      ) as meses
    from public.remuneracao_pessoa p
      left join public.rh_colaboradores r      on r.codigo = p.codigo_rh
      left join public.vw_remuneracao_mensal m on m.pessoa_id = p.id
    -- O RECORTE. Uma linha, e é a única coisa que separa a folha do líder da
    -- folha da empresa. Pessoa sem time nenhum não entra em recorte nenhum.
    where v_tudo or coalesce(r.setor, p.setor) = any(v_setores)
    group by p.id, p.nome, p.codigo_rh, p.doc, p.eh_pessoa,
             r.cargo, r.setor, p.setor, r.modalidade, r.inicio, r.datadesl, r.valor
  )
  select jsonb_build_object(
    -- Os meses do SELETOR seguem sendo os da base inteira: cortá-los no recorte
    -- faria o líder perder os meses em que o time dele não recebeu nada, e o
    -- seletor mudaria de tamanho conforme quem olha.
    'meses', coalesce(
      (select jsonb_agg(distinct competencia) from public.remuneracao_lancamento),
      '[]'::jsonb),
    'pessoas', coalesce(
      (select jsonb_agg(to_jsonb(pessoa) order by pessoa.nome) from pessoa),
      '[]'::jsonb),
    'gerado_em', to_jsonb(now()),
    -- O recorte dito em voz alta, para a tela não ter de deduzi-lo do que veio.
    'escopo', case when v_tudo then jsonb_build_object('tudo', true)
                   else jsonb_build_object('tudo', false, 'setores', to_jsonb(v_setores)) end
  ) into v_out;

  return v_out;
end $function$;

revoke execute on function public.remuneracao_painel() from anon;

/* O frescor também: sem ele o líder não sabe que está olhando número de ontem,
   que é exatamente a armadilha de 04/09/2026. Ele não dispara a carga
   (`remuneracao_atualizar` segue exigindo `pode_ver_remuneracao()`) — quem
   recarrega o Omie é quem responde pela folha inteira. */
create or replace function public.remuneracao_frescor()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and not public.pode_ver_remuneracao()
     and not public.pode_ver_remuneracao_do_time() then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'carga_em', (select max(atualizado_em) from public.remuneracao_lancamento),
    'omie_em',  (select atualizado_em from public.omie_cache where chave = 'movimentos')
  );
end $function$;

revoke execute on function public.remuneracao_frescor() from anon;

-- ─────────────────────── 5. O vocabulário dos times ───────────────────────

/* Os setores que existem — para o seletor da tela de Usuários e para o da
   classificação. DEFINER porque quem escolhe o recorte de um líder é o admin,
   mas quem PRECISA ler a lista não deveria precisar de acesso à folha inteira.
   Devolve só nomes de time: nenhum valor, nenhuma pessoa. */
create or replace function public.remuneracao_setores()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(s order by s), '{}')
    from (
      select distinct nullif(btrim(setor), '') as s from public.rh_colaboradores
      union
      select distinct nullif(btrim(setor), '') from public.remuneracao_pessoa
    ) t
   where s is not null
$function$;

revoke execute on function public.remuneracao_setores() from anon;

-- ─────────────────────── 6. Ligar para quem pediu ───────────────────────

-- Liderança ganha a folha do próprio time. Sem setores na ficha, ainda não abre
-- ninguém — o recorte é a linha abaixo.
update public.acesso_perfil
   set capacidades = capacidades || array['remuneracao_time'],
       atualizado_em = now()
 where perfil = 'lideranca'
   and not ('remuneracao_time' = any(capacidades));

-- Os dois Heads de hoje. Danilo: Operações são os três times de pós-venda.
-- Vinicius: Produto, separado de Tecnologia (o CTO é diretoria e já vê tudo).
update public.profiles set setores_folha = array['Sucesso', 'Onboarding', 'Suporte']
 where lower(email) = 'danilo@takeat.app';

update public.profiles set setores_folha = array['Produto']
 where lower(email) = 'vmbuteri.takeat@gmail.com';

/* CONFERÊNCIA. Um recorte que devolve a empresa inteira, ou nenhuma pessoa, é o
   tipo de erro que só aparece quando o líder abre a tela e não entende o que vê.
   Falhar aqui é mais barato. */
do $$
declare
  v_danilo integer;
  v_todos  integer;
begin
  select count(distinct p.id) into v_danilo
    from public.remuneracao_pessoa p
    left join public.rh_colaboradores r on r.codigo = p.codigo_rh
   where coalesce(r.setor, p.setor) = any(array['Sucesso', 'Onboarding', 'Suporte']);

  select count(*) into v_todos from public.remuneracao_pessoa;

  if v_danilo = 0 then
    raise exception 'o recorte do Head de Operações não achou ninguém';
  end if;
  if v_danilo >= v_todos then
    raise exception 'o recorte do Head de Operações devolveu a base inteira (% de %)', v_danilo, v_todos;
  end if;
  raise notice 'recorte de Operações: % pessoas de % na base', v_danilo, v_todos;
end $$;
