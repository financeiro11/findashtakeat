-- A fusão passa a dizer quem decidiu — o documento ou uma pessoa.
--
-- `remuneracao_fundir` gravava o apelido sempre como origem 'documento', mesmo
-- quando quem juntou as duas linhas foi gente. É uma mentira pequena e cara:
-- daqui a seis meses, alguém olhando "por que estas duas viraram a mesma
-- pessoa?" precisa saber se um CNPJ provou ou se alguém decidiu — porque só a
-- segunda pode estar errada, e só ela vale reabrir.
--
-- `drop` antes do `create`: acrescentar um parâmetro com default cria uma
-- SOBRECARGA, não substitui a função. As duas ficariam vivas, a chamada de dois
-- argumentos continuaria caindo na antiga, e nada mudaria — sem erro nenhum.
drop function if exists public.remuneracao_fundir(uuid, uuid);

create function public.remuneracao_fundir(
  p_mantem  uuid,
  p_absorve uuid,
  p_origem  text default 'manual'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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

  update public.remuneracao_pessoa p
     set doc = coalesce(p.doc, (select doc from public.remuneracao_pessoa where id = p_absorve))
   where p.id = p_mantem;

  -- Antes do delete: o `on delete cascade` levaria os apelidos junto, e a
  -- duplicata voltaria na próxima carga.
  update public.remuneracao_pessoa_alias set pessoa_id = p_mantem where pessoa_id = p_absorve;

  insert into public.remuneracao_pessoa_alias (chave, pessoa_id, origem)
  values (v_chave, p_mantem, p_origem)
  on conflict (chave) do update
    set pessoa_id = excluded.pessoa_id, origem = excluded.origem;

  delete from public.remuneracao_pessoa where id = p_absorve;
end $$;

revoke all on function public.remuneracao_fundir(uuid, uuid, text) from anon, authenticated;

-- A fusão automática continua se declarando como o que é.
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
      select doc from rh_doc where doc is not null
      group by doc having count(distinct codigo) = 1
    ),
    orfao as (
      select p.id, p.doc from public.remuneracao_pessoa p
      where p.codigo_rh is null and p.doc is not null
    )
    select o.id as absorve, f.id as mantem
    from orfao o
      join doc_de_uma_ficha_so d on d.doc = o.doc
      join rh_doc rd            on rd.doc = o.doc
      join public.remuneracao_pessoa f on f.codigo_rh = rd.codigo
    where (select count(*) from orfao o2 where o2.doc = o.doc) = 1
  loop
    perform public.remuneracao_fundir(v_par.mantem, v_par.absorve, 'documento');
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

/* ------------------------------------------------------------------ */
/* O Nicolas                                                           */
/* ------------------------------------------------------------------ */

-- Confirmado pelo financeiro em 03/09/2026: é a mesma pessoa. O automático não
-- juntou porque os documentos divergem — e divergem por um defeito de cadastro,
-- não por serem pessoas diferentes: no Portal RH o CNPJ está com 13 dígitos
-- (5208619200012) contra 14 no Omie (52086192000102), mesma raiz 52086192/0001,
-- com um dígito comido no meio. Treze dígitos não é CNPJ válido.
--
-- Fica como 'manual' de propósito: se o CNPJ do Portal RH for corrigido um dia,
-- esta linha é a que explica por que a fusão já existia antes disso.
do $$
declare
  v_mantem  uuid;
  v_absorve uuid;
begin
  select id into v_mantem  from public.remuneracao_pessoa where codigo_rh = 'COL-333302';
  select id into v_absorve from public.remuneracao_pessoa
   where codigo_rh is null and public.contraparte_chave(nome) = public.contraparte_chave('Nicolas Tapias');

  if v_mantem is not null and v_absorve is not null then
    perform public.remuneracao_fundir(v_mantem, v_absorve, 'manual');
  end if;
end $$;
