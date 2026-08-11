-- "Este está certo" tem que valer na DRE e na DFC.
--
-- O QUE ESTAVA ERRADO
-- Um lançamento mal classificado rende DUAS linhas em `omie_reclassificacoes`:
-- a chave é (tipo, cod_titulo), então o mesmo nCodTitulo aparece uma vez como
-- 'dre' e outra como 'dfc'. Mas a decisão de quem auditava era gravada por
-- `id` — ou seja, calava só a linha do demonstrativo que estava aberto na tela.
-- Quem marcava os lançamentos como corretos na DFC reabria a DRE e via os
-- mesmos casos de novo, sem nenhuma pista de que já os tinha resolvido.
--
-- Aconteceu de verdade: em Jul-26, 6 lançamentos de "Premiações" decididos na
-- DRE seguiam abertos na DFC, e os 2 de "Outras despesas Adm" decididos na DFC
-- seguiam abertos na DRE.
--
-- A CORREÇÃO
-- A decisão passa a ser sobre o LANÇAMENTO, não sobre a tela: o alvo do update
-- é `cod_titulo`, que pega as duas linhas. É a leitura certa — a categoria é
-- uma só no Omie, e "este está certo" é uma afirmação sobre o lançamento, não
-- sobre qual demonstrativo alguém abriu primeiro.
--
-- O par de rubricas ("sempre pode cair nas duas") precisa do mesmo cuidado por
-- outro motivo: os nomes de rubrica NÃO são os mesmos nos dois demonstrativos
-- ("Outras despesas Adm" na DRE, "Outras Despesas Adm" na DFC). Uma regra só
-- silenciaria metade, e a outra metade voltaria a piscar na próxima detecção.
-- Por isso a regra é gravada uma por demonstrativo em que o lançamento apareceu.

/* ============================================================
 *  Ignorar
 * ============================================================ */

create or replace function public.reclassificacao_ignorar(
  p_id     uuid,
  p_escopo text default 'lancamento',
  p_motivo text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  al public.omie_reclassificacoes%rowtype;
  n integer;
begin
  select * into al from omie_reclassificacoes where id = p_id;
  if not found then
    raise exception 'alerta % não encontrado', p_id;
  end if;

  if p_escopo = 'fornecedor' then
    -- Uma regra por par de rubricas de CADA demonstrativo em que este
    -- lançamento caiu — ver o comentário do cabeçalho sobre os nomes.
    insert into omie_reclassificacoes_regras (fornecedor_chave, fornecedor, rubrica_a, rubrica_b, motivo)
    select distinct r.fornecedor_chave, r.fornecedor,
           least(r.rubrica, r.rubrica_padrao), greatest(r.rubrica, r.rubrica_padrao), p_motivo
      from omie_reclassificacoes r
     where r.cod_titulo = al.cod_titulo
    on conflict (fornecedor_chave, rubrica_a, rubrica_b) do update
       set motivo = coalesce(excluded.motivo, omie_reclassificacoes_regras.motivo);

    with pares as (
      select distinct least(r.rubrica, r.rubrica_padrao)    as ra,
                      greatest(r.rubrica, r.rubrica_padrao) as rb
        from omie_reclassificacoes r
       where r.cod_titulo = al.cod_titulo
    )
    update omie_reclassificacoes t
       set status = 'ignorado', ignorado_em = now(), ignorado_por = auth.uid(), ignorado_motivo = p_motivo
      from pares p
     where t.fornecedor_chave = al.fornecedor_chave
       and least(t.rubrica, t.rubrica_padrao) = p.ra
       and greatest(t.rubrica, t.rubrica_padrao) = p.rb;
  else
    -- O mesmo nCodTitulo nos dois demonstrativos, e só ele: quem confere um a
    -- um não quer que a decisão vaze para os outros lançamentos do fornecedor.
    update omie_reclassificacoes
       set status = 'ignorado', ignorado_em = now(), ignorado_por = auth.uid(), ignorado_motivo = p_motivo
     where cod_titulo = al.cod_titulo;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

/* ============================================================
 *  Reabrir — pelo mesmo critério, senão o desfazer fica torto
 * ============================================================ */

create or replace function public.reclassificacao_reabrir(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  al public.omie_reclassificacoes%rowtype;
  v_regra integer;
  n integer;
begin
  select * into al from omie_reclassificacoes where id = p_id;
  if not found then
    raise exception 'alerta % não encontrado', p_id;
  end if;

  -- Reabrir um caso calado no escopo do fornecedor tem que derrubar as regras
  -- junto (as duas, uma por demonstrativo), senão a próxima detecção o cala de
  -- novo.
  with pares as (
    select distinct least(r.rubrica, r.rubrica_padrao)    as ra,
                    greatest(r.rubrica, r.rubrica_padrao) as rb
      from omie_reclassificacoes r
     where r.cod_titulo = al.cod_titulo
  )
  delete from omie_reclassificacoes_regras g
   using pares p
   where g.fornecedor_chave = al.fornecedor_chave
     and g.rubrica_a = p.ra
     and g.rubrica_b = p.rb;
  get diagnostics v_regra = row_count;

  if v_regra > 0 then
    -- Havia regra: o silêncio era do par inteiro, então some com ele inteiro.
    with pares as (
      select distinct least(r.rubrica, r.rubrica_padrao)    as ra,
                      greatest(r.rubrica, r.rubrica_padrao) as rb
        from omie_reclassificacoes r
       where r.cod_titulo = al.cod_titulo
    )
    update omie_reclassificacoes t
       set status = 'aberto', ignorado_em = null, ignorado_por = null, ignorado_motivo = null
      from pares p
     where t.fornecedor_chave = al.fornecedor_chave
       and least(t.rubrica, t.rubrica_padrao) = p.ra
       and greatest(t.rubrica, t.rubrica_padrao) = p.rb;
  else
    -- Sem regra, foi decisão avulsa: reabre só este lançamento (nos dois
    -- demonstrativos), para não ressuscitar outros que alguém conferiu um a um.
    update omie_reclassificacoes
       set status = 'aberto', ignorado_em = null, ignorado_por = null, ignorado_motivo = null
     where cod_titulo = al.cod_titulo;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

/* ============================================================
 *  Backfill: as gêmeas que ficaram para trás
 * ============================================================ */

-- Quem já foi decidido de um lado herda a decisão do outro, com a data e o
-- autor originais — a pessoa fez o trabalho, só não sabia que ele valia meio.
update omie_reclassificacoes t
   set status          = 'ignorado',
       ignorado_em     = d.ignorado_em,
       ignorado_por    = d.ignorado_por,
       ignorado_motivo = d.ignorado_motivo
  from (
    select distinct on (cod_titulo)
           cod_titulo, ignorado_em, ignorado_por, ignorado_motivo
      from omie_reclassificacoes
     where status = 'ignorado'
     order by cod_titulo, ignorado_em desc nulls last
  ) d
 where t.cod_titulo = d.cod_titulo
   and t.status = 'aberto';

revoke all on function public.reclassificacao_ignorar(uuid, text, text) from public;
revoke all on function public.reclassificacao_reabrir(uuid) from public;
revoke all on function public.reclassificacao_ignorar(uuid, text, text) from anon;
revoke all on function public.reclassificacao_reabrir(uuid) from anon;
grant execute on function public.reclassificacao_ignorar(uuid, text, text) to authenticated;
grant execute on function public.reclassificacao_reabrir(uuid) to authenticated;