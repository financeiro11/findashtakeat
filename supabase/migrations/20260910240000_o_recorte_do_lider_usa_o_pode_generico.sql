-- O RECORTE DO LÍDER PASSA A USAR O `pode()` GENÉRICO.
--
-- `20260910210000` criou `pode_ver_remuneracao_do_time()` copiando a forma de
-- `pode_ver_remuneracao()`: ler `acesso_perfil` e conferir a capacidade. Em
-- paralelo, `20260910230000` generalizou exatamente isso em `public.pode(cap)`,
-- que faz a mesma leitura para QUALQUER capacidade.
--
-- Duas cópias da mesma verdade é o começo da divergência que este módulo inteiro
-- existe para evitar. A específica sai; fica a genérica.
--
-- E `remuneracao_time` ganha a linha dela em `acesso_modo`, como **bloqueio**:
-- ela já bloqueia de fato (o painel levanta exceção para quem não a tem), e o
-- padrão de capacidade sem linha é `aviso`. Um interruptor que diz "avisa"
-- enquanto a porta recusa é pior do que interruptor nenhum, porque quem lê a
-- tela de Perfis conclui que ainda está medindo.

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
    if not public.pode('remuneracao_time') then
      raise exception 'sem permissão para ver a remuneração';
    end if;
    select coalesce(p.setores_folha, '{}') into v_setores
      from public.profiles p where p.user_id = auth.uid() limit 1;
  end if;

  with pessoa as (
    select
      p.id, p.nome, p.codigo_rh, p.doc, p.eh_pessoa,
      r.cargo,
      coalesce(r.setor, p.setor) as setor,
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
    where v_tudo or coalesce(r.setor, p.setor) = any(v_setores)
    group by p.id, p.nome, p.codigo_rh, p.doc, p.eh_pessoa,
             r.cargo, r.setor, p.setor, r.modalidade, r.inicio, r.datadesl, r.valor
  )
  select jsonb_build_object(
    'meses', coalesce(
      (select jsonb_agg(distinct competencia) from public.remuneracao_lancamento),
      '[]'::jsonb),
    'pessoas', coalesce(
      (select jsonb_agg(to_jsonb(pessoa) order by pessoa.nome) from pessoa),
      '[]'::jsonb),
    'gerado_em', to_jsonb(now()),
    'escopo', case when v_tudo then jsonb_build_object('tudo', true)
                   else jsonb_build_object('tudo', false, 'setores', to_jsonb(v_setores)) end
  ) into v_out;

  return v_out;
end $function$;

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
     and not public.pode('remuneracao_time') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'carga_em', (select max(atualizado_em) from public.remuneracao_lancamento),
    'omie_em',  (select atualizado_em from public.omie_cache where chave = 'movimentos')
  );
end $function$;

drop function if exists public.pode_ver_remuneracao_do_time();

insert into public.acesso_modo (capacidade, modo) values ('remuneracao_time', 'bloqueio')
on conflict (capacidade) do update set modo = 'bloqueio', mudado_em = now();

-- As duas foram recriadas; o `create or replace` NÃO preserva o ACL quando a
-- assinatura é a mesma, mas preserva quando já existia — refazer é barato e o
-- `has_function_privilege` abaixo é quem responde.
revoke all on function public.remuneracao_painel()  from public, anon;
revoke all on function public.remuneracao_frescor() from public, anon;
grant execute on function public.remuneracao_painel()  to authenticated, service_role;
grant execute on function public.remuneracao_frescor() to authenticated, service_role;

do $$
declare v_abertas text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_abertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('remuneracao_painel', 'remuneracao_frescor')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_abertas is not null then
    raise exception 'ainda abertas para anon: %', v_abertas;
  end if;
end $$;
