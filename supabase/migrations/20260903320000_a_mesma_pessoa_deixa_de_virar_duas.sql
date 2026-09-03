-- A mesma pessoa deixa de virar duas linhas.
--
-- O casamento entre o espelho do RH e o pagamento do Omie era por
-- `contraparte_chave` EXATA. Só que os dois lados escrevem o nome diferente:
--
--   Portal RH                     Omie
--   Lucas Segatto Soares          Lucas Segatto
--   Thayrone Silva Cazeca         Thayrone Cazeca
--   Júlia Paulino Rocon           Julia Rocon
--   Pedro Mastelo Faro            Pedro Faro
--   JULYAN BOURGUIGNON RIBEIRO    Julyan Ribeiro
--   Vitor Lago Quintela           Vitorlagoquintela
--
-- O resultado eram DUAS linhas para a mesma pessoa: uma com ficha e sem
-- pagamento nenhum, outra com todos os pagamentos e sem cargo, setor ou tempo
-- de casa. Hoje são 32 de um lado e 52 do outro.
--
-- POR QUE UMA TABELA DE APELIDO, e não só fundir as linhas: fundir sem isto se
-- desfaz sozinho. A carga seguinte lê "Lucas Segatto" do Omie, não acha essa
-- chave (a linha que sobrou tem a chave do RH), e cria a duplicata de novo —
-- todo dia, para sempre. O apelido é o que faz a decisão durar.

/* ------------------------------------------------------------------ */
/* O apelido                                                           */
/* ------------------------------------------------------------------ */

create table if not exists public.remuneracao_pessoa_alias (
  -- `contraparte_chave` do nome como a OUTRA fonte escreve.
  chave      text primary key,
  pessoa_id  uuid not null references public.remuneracao_pessoa(id) on delete cascade,
  -- 'documento' quando o CNPJ provou; 'manual' quando uma pessoa decidiu.
  origem     text not null default 'manual' check (origem in ('documento','manual')),
  criado_em  timestamptz not null default now()
);

comment on table public.remuneracao_pessoa_alias is
  'Nome alternativo → pessoa. É o que impede a carga de recriar uma duplicata já resolvida.';

create index if not exists remuneracao_pessoa_alias_pessoa_idx
  on public.remuneracao_pessoa_alias (pessoa_id);

alter table public.remuneracao_pessoa_alias enable row level security;
drop policy if exists "remuneracao_alias por cargo" on public.remuneracao_pessoa_alias;
create policy "remuneracao_alias por cargo" on public.remuneracao_pessoa_alias
  for all to authenticated
  using (public.pode_ver_remuneracao())
  with check (public.pode_ver_remuneracao());
revoke all on public.remuneracao_pessoa_alias from anon;

/* ------------------------------------------------------------------ */
/* Quem é esta chave?                                                  */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao_pessoa_por_chave(p_chave text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select id from public.remuneracao_pessoa where chave = p_chave),
    (select pessoa_id from public.remuneracao_pessoa_alias where chave = p_chave)
  )
$$;

revoke all on function public.remuneracao_pessoa_por_chave(text) from anon, authenticated;

/* ------------------------------------------------------------------ */
/* Fundir duas linhas                                                  */
/* ------------------------------------------------------------------ */

-- Sobrevive a linha COM ficha do RH: é ela que carrega cargo, setor e data de
-- início. Os lançamentos da outra migram, a chave da outra vira apelido, e a
-- outra some.
create or replace function public.remuneracao_fundir(p_mantem uuid, p_absorve uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_chave text;
begin
  if p_mantem = p_absorve then return; end if;

  select chave into v_chave from public.remuneracao_pessoa where id = p_absorve;
  if v_chave is null then return; end if;

  -- Os lançamentos mudam de dono. `on conflict` na unique (fonte, origem_ref)
  -- não pode acontecer aqui (o mesmo título nunca está nas duas), mas se as
  -- duas linhas tiverem carregado o mesmo título alguma vez, a versão que fica
  -- é a que já estava na linha que sobrevive.
  update public.remuneracao_lancamento l
     set pessoa_id = p_mantem
   where l.pessoa_id = p_absorve
     and not exists (
       select 1 from public.remuneracao_lancamento m
       where m.pessoa_id = p_mantem and m.fonte = l.fonte and m.origem_ref = l.origem_ref
     );

  -- O que sobrar é duplicata literal do mesmo título; sai junto com a linha.
  delete from public.remuneracao_lancamento where pessoa_id = p_absorve;

  -- O documento da absorvida, se a que fica não tinha.
  update public.remuneracao_pessoa p
     set doc = coalesce(p.doc, (select doc from public.remuneracao_pessoa where id = p_absorve))
   where p.id = p_mantem;

  -- Os apelidos que a absorvida já tinha mudam de dono ANTES do delete, senão o
  -- `on delete cascade` os leva junto e a duplicata volta na próxima carga.
  update public.remuneracao_pessoa_alias set pessoa_id = p_mantem where pessoa_id = p_absorve;

  -- E a chave dela vira apelido — é isto que impede a recriação.
  insert into public.remuneracao_pessoa_alias (chave, pessoa_id, origem)
  values (v_chave, p_mantem, 'documento')
  on conflict (chave) do update set pessoa_id = excluded.pessoa_id;

  delete from public.remuneracao_pessoa where id = p_absorve;
end $$;

/* ------------------------------------------------------------------ */
/* Fundir pelo documento — o que dá para fazer sem perguntar           */
/* ------------------------------------------------------------------ */

-- Nome parecido NÃO funde sozinho: "Vitor Coelho" e "Vitor Rosa Coelho" podem
-- ser a mesma pessoa ou dois Vitores, e errar aqui mostra o salário de um sob o
-- nome do outro. O CNPJ prova; parecença de nome só sugere.
--
-- E nem todo CNPJ prova: quatro pessoas ativas dividem o 37.511.891/0001-50, e
-- por isso só valem os documentos que apontam para UMA ficha só.
create or replace function public.remuneracao_fundir_por_documento()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_par record;
  v_n integer := 0;
begin
  for v_par in
    with rh_doc as (
      select r.codigo,
             nullif(regexp_replace(coalesce(r.cnpj, ''), '\D', '', 'g'), '') as doc
      from public.rh_colaboradores r
    ),
    doc_de_uma_ficha_so as (
      select doc from rh_doc
      where doc is not null
      group by doc having count(distinct codigo) = 1
    ),
    -- Tem pagamento e não tem ficha.
    orfao as (
      select p.id, p.doc
      from public.remuneracao_pessoa p
      where p.codigo_rh is null and p.doc is not null
    )
    select o.id as absorve, f.id as mantem
    from orfao o
      join doc_de_uma_ficha_so d on d.doc = o.doc
      join rh_doc rd            on rd.doc = o.doc
      join public.remuneracao_pessoa f on f.codigo_rh = rd.codigo
    -- Um órfão que casasse com duas fichas não é decisão de máquina.
    where (select count(*) from orfao o2 where o2.doc = o.doc) = 1
  loop
    perform public.remuneracao_fundir(v_par.mantem, v_par.absorve);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

revoke all on function public.remuneracao_fundir(uuid, uuid)        from anon, authenticated;
revoke all on function public.remuneracao_fundir_por_documento()    from anon, authenticated;

/* ------------------------------------------------------------------ */
/* A carga passa a enxergar o apelido                                  */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao_carregar_omie()
returns table (pessoas_novas integer, lancamentos_gravados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pessoas integer := 0;
  v_lanc    integer := 0;
begin
  -- Só entra quem a chave NÃO resolve — nem direto, nem por apelido. Sem o
  -- segundo teste, toda fusão feita ontem viraria duplicata de novo hoje.
  with novas as (
    insert into public.remuneracao_pessoa (nome, chave, doc)
    select distinct on (public.contraparte_chave(v.nome))
      v.nome, public.contraparte_chave(v.nome), v.doc
    from public.vw_remuneracao_omie v
    where v.nome is not null
      and length(public.contraparte_chave(v.nome)) >= 4
      and public.remuneracao_pessoa_por_chave(public.contraparte_chave(v.nome)) is null
    order by public.contraparte_chave(v.nome), v.vencimento desc
    on conflict (chave) do nothing
    returning 1
  )
  select count(*) into v_pessoas from novas;

  update public.remuneracao_pessoa p
     set doc = v.doc
    from (select distinct on (public.contraparte_chave(nome))
                 public.contraparte_chave(nome) as chave, doc
            from public.vw_remuneracao_omie
           where doc is not null
           order by public.contraparte_chave(nome), vencimento desc) v
   where p.doc is null
     and p.id = public.remuneracao_pessoa_por_chave(v.chave);

  with gravados as (
    insert into public.remuneracao_lancamento
      (pessoa_id, competencia, bloco, valor, fonte, origem_ref, categoria, vencimento, pagamento)
    select pid, v.competencia, v.bloco, v.valor, 'omie', v.cod_titulo::text,
           v.categoria, v.vencimento, v.pagamento
    from public.vw_remuneracao_omie v
      cross join lateral (
        select public.remuneracao_pessoa_por_chave(public.contraparte_chave(v.nome)) as pid
      ) r
    where r.pid is not null
    on conflict (fonte, origem_ref) do update
      set valor         = excluded.valor,
          competencia   = excluded.competencia,
          bloco         = excluded.bloco,
          categoria     = excluded.categoria,
          vencimento    = excluded.vencimento,
          pagamento     = excluded.pagamento,
          pessoa_id     = excluded.pessoa_id,
          atualizado_em = now()
    returning 1
  )
  select count(*) into v_lanc from gravados;

  return query select v_pessoas, v_lanc;
end $$;

/* ------------------------------------------------------------------ */
/* A rotina ganha a etapa                                              */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao_atualizar()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rh       integer;
  v_fundidas integer;
  v_omie     record;
begin
  v_rh       := public.remuneracao_sincronizar_rh();
  -- Funde ANTES de carregar: assim o apelido já existe quando a carga procurar
  -- o dono do título, e o pagamento cai direto na pessoa certa.
  v_fundidas := public.remuneracao_fundir_por_documento();
  select * into v_omie from public.remuneracao_carregar_omie();

  return jsonb_build_object(
    'pessoas_do_rh',   v_rh,
    'fundidas',        v_fundidas,
    'pessoas_do_omie', v_omie.pessoas_novas,
    'lancamentos',     v_omie.lancamentos_gravados,
    'em',              now()
  );
end $$;
