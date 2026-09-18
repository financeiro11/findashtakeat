-- ===========================================================================
-- DE-PARA: SÓ O FINANCEIRO EDITA · CATEGORIA "FORA DE PROPÓSITO" · ÓRFÃS ARQUIVADAS
--
-- Decisões do financeiro em 15/09/2026, depois da Conferência do Plano de contas.
-- NENHUMA delas muda número da DRE ou da DFC — a migration confere isso.
--
-- 1. FORA DE PROPÓSITO. Transferência entre contas próprias, aporte, aplicação,
--    CAPEX e afins ficam fora da DRE de propósito, e eram acusados todo mês como
--    pendência ("Fora da demonstração"). A marca registra a decisão (quem, quando,
--    por quê) e cala o aviso no Plano de contas e no "O que falta fechar". Marcada
--    por demonstrativo: estar fora da DRE não diz nada sobre a DFC.
--    FICARAM SEM MARCA, de propósito:
--      • 2.06.02 Parcelamento de Impostos — o financeiro vai conferir o que fazer;
--      • 2.01.02 Frete - Operação — não está fora por decisão: a linha do DE-PARA
--        dele tem o nome antigo ("3.2.2" × "3.2.2."). Marcá-la esconderia o defeito.
--
-- 2. SÓ O FINANCEIRO EDITA O DE-PARA. As policies de escrita de `omie_dre_mapa`
--    eram `true` para qualquer conta logada — inclusive Liderança e a Consultoria
--    Estratégica, que veem as Demonstrações. Passam a exigir `conciliacao`, a
--    capacidade de quem opera classificação no ERP. Ler continua livre para quem lê.
--    As Edge Functions escrevem com service role e não passam por aqui.
--
-- 3. ÓRFÃS ARQUIVADAS, NÃO APAGADAS. As linhas do DE-PARA cujo nome não existe mais
--    no Omie viram `ativo = false` com data e motivo — ficam registradas e somem das
--    listas. O omie-sync já ignora `ativo = false`, e nenhuma delas casava com
--    categoria existente (é a definição de órfã), então a DRE não muda.
--    As duas do Frete (conserto quase certo, par só de pontuação) NÃO são arquivadas.
-- ===========================================================================

-- ───────────────────────── 1. A marca ─────────────────────────

create table if not exists public.plano_contas_fora_da_demonstracao (
  codigo text not null,
  demonstrativo text not null check (demonstrativo in ('dre', 'dfc')),
  descricao text,
  motivo text,
  marcado_por uuid references auth.users(id) on delete set null,
  marcado_por_email text,
  marcado_em timestamptz not null default now(),
  primary key (codigo, demonstrativo)
);

comment on table public.plano_contas_fora_da_demonstracao is
  'Categoria do Omie que fica fora da DRE/DFC de propósito (transferência, aporte, CAPEX…). Cala o aviso de "fora da demonstração"; não muda número. Escrita só por quem tem conciliacao.';

alter table public.plano_contas_fora_da_demonstracao enable row level security;

drop policy if exists "le quem ve demonstracoes" on public.plano_contas_fora_da_demonstracao;
create policy "le quem ve demonstracoes" on public.plano_contas_fora_da_demonstracao
  for select to authenticated using (public.pode_ler('demonstracoes'));

drop policy if exists "financeiro marca" on public.plano_contas_fora_da_demonstracao;
create policy "financeiro marca" on public.plano_contas_fora_da_demonstracao
  for insert to authenticated with check (public.pode('conciliacao'));

drop policy if exists "financeiro atualiza" on public.plano_contas_fora_da_demonstracao;
create policy "financeiro atualiza" on public.plano_contas_fora_da_demonstracao
  for update to authenticated using (public.pode('conciliacao')) with check (public.pode('conciliacao'));

drop policy if exists "financeiro desmarca" on public.plano_contas_fora_da_demonstracao;
create policy "financeiro desmarca" on public.plano_contas_fora_da_demonstracao
  for delete to authenticated using (public.pode('conciliacao'));

revoke all on public.plano_contas_fora_da_demonstracao from anon;
grant select, insert, update, delete on public.plano_contas_fora_da_demonstracao to authenticated;

insert into public.plano_contas_fora_da_demonstracao (codigo, demonstrativo, descricao, motivo, marcado_por_email)
select v.codigo, v.demonstrativo,
       (select replace(replace(c->>'descricao', '&lt;', '<'), '&gt;', '>')
          from public.omie_cache, lateral jsonb_array_elements(dados) c
         where chave = 'categorias' and c->>'codigo' = v.codigo limit 1),
       'Fica fora de propósito — decisão do financeiro em 15/09/2026 (transferência, aporte, aplicação, CAPEX e afins).',
       'financeiro@takeat.app'
  from (values
    ('1.04.94', 'dre'), ('2.10.96', 'dre'), ('1.04.01', 'dre'), ('2.10.98', 'dre'), ('1.04.93', 'dre'),
    ('2.10.93', 'dre'), ('2.08.01', 'dre'), ('2.10.95', 'dre'), ('1.04.99', 'dre'), ('2.05.02', 'dre'),
    ('2.08.02', 'dre'), ('1.04.92', 'dre'), ('2.06.06', 'dre'), ('2.04.92', 'dre'), ('2.01.04', 'dre'),
    ('1.04.94', 'dfc'), ('2.10.96', 'dfc'), ('1.04.93', 'dfc'), ('2.10.93', 'dfc'), ('1.04.92', 'dfc'),
    ('2.01.04', 'dfc'), ('2.04.92', 'dfc')
  ) v(codigo, demonstrativo)
on conflict (codigo, demonstrativo) do nothing;

-- O "O que falta fechar" deixa de acusar o que foi marcado. Embrulho: a regra de
-- órfã continua na interna; a casca só tira as decisões já tomadas.
create or replace function public.demonstracoes_sem_de_para(p_tipo text, p_meses text[], p_piso numeric default 1000)
returns table(mes text, categoria text, codigo text, quantidade bigint, valor numeric, meses_antes integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.exigir('demonstracoes', 'demonstracoes_sem_de_para') then
    return;
  end if;
  return query
    select s.mes, s.categoria, s.codigo, s.quantidade, s.valor, s.meses_antes
      from public.demonstracoes_sem_de_para_interno(p_tipo, p_meses, p_piso) s
     where not exists (
       select 1 from public.plano_contas_fora_da_demonstracao f
        where f.codigo = s.codigo and f.demonstrativo = p_tipo
     );
end;
$function$;

-- ───────────────────────── 2. Só o financeiro escreve no DE-PARA ─────────────────────────

drop policy if exists "Authenticated can insert omie_dre_mapa" on public.omie_dre_mapa;
drop policy if exists "Authenticated can update omie_dre_mapa" on public.omie_dre_mapa;
drop policy if exists "Authenticated can delete omie_dre_mapa" on public.omie_dre_mapa;

drop policy if exists "Financeiro insere omie_dre_mapa" on public.omie_dre_mapa;
create policy "Financeiro insere omie_dre_mapa" on public.omie_dre_mapa
  for insert to authenticated with check (public.pode('conciliacao'));

drop policy if exists "Financeiro altera omie_dre_mapa" on public.omie_dre_mapa;
create policy "Financeiro altera omie_dre_mapa" on public.omie_dre_mapa
  for update to authenticated using (public.pode('conciliacao')) with check (public.pode('conciliacao'));

drop policy if exists "Financeiro remove omie_dre_mapa" on public.omie_dre_mapa;
create policy "Financeiro remove omie_dre_mapa" on public.omie_dre_mapa
  for delete to authenticated using (public.pode('conciliacao'));

-- ───────────────────────── 3. Órfãs arquivadas ─────────────────────────

alter table public.omie_dre_mapa add column if not exists arquivado_em timestamptz;
alter table public.omie_dre_mapa add column if not exists arquivado_motivo text;

do $$
declare
  v_casam_antes int;
  v_casam_depois int;
  v_arquivadas int;
  v_sem_de_para jsonb;
begin
  -- As linhas que CASAM com categoria existente são as únicas que mexem na DRE.
  select count(*) filter (where l->>'codigo' is not null) into v_casam_antes
    from jsonb_array_elements(public.plano_contas_de_para_saude(null)) l;

  update public.omie_dre_mapa m
     set ativo = false,
         arquivado_em = now(),
         arquivado_motivo = s.motivo,
         updated_at = now()
    from (
      select (l->>'id')::uuid as id,
             case when l->>'sugestao_codigo' is null
               then 'Arquivada em 15/09/2026 pelo financeiro: o nome não existe mais no plano de contas do Omie e nenhuma categoria atual se parece com ele.'
               else 'Arquivada em 15/09/2026 pelo financeiro: duplicata — a categoria atual (' || (l->>'sugestao_descricao') || ') já tem linha própria no DE-PARA.'
             end as motivo
        from jsonb_array_elements(public.plano_contas_de_para_saude(null)) l
       where l->>'codigo' is null
         and (l->>'sugestao_codigo' is null or coalesce((l->>'sugestao_ja_mapeada')::boolean, false))
    ) s
   where m.id = s.id and m.ativo is not false;
  get diagnostics v_arquivadas = row_count;

  select count(*) filter (where l->>'codigo' is not null) into v_casam_depois
    from jsonb_array_elements(public.plano_contas_de_para_saude(null)) l;

  raise notice 'DE-PARA: % linha(s) arquivada(s); linhas que casam com categoria: % antes, % depois',
    v_arquivadas, v_casam_antes, v_casam_depois;
  if v_casam_antes <> v_casam_depois then
    raise exception 'Arquivar mexeria em linha que casa com categoria existente (% × %) — nada foi aplicado', v_casam_antes, v_casam_depois;
  end if;

  -- O Frete continua ativo e órfão, esperando a decisão.
  if exists (select 1 from public.omie_dre_mapa where codigo_categoria = '3.2.2 Frete - Operação' and ativo = false) then
    raise exception 'O Frete não podia ter sido arquivado';
  end if;

  -- O "O que falta fechar" não acusa mais o que foi marcado.
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_sem_de_para
    from public.demonstracoes_sem_de_para('dre', array['Aug-26', 'Jul-26', 'Jun-26'], 1) s;
  if exists (
    select 1 from jsonb_array_elements(v_sem_de_para) x
      join public.plano_contas_fora_da_demonstracao f on f.codigo = x->>'codigo' and f.demonstrativo = 'dre'
  ) then
    raise exception 'demonstracoes_sem_de_para ainda acusa categoria marcada';
  end if;
  raise notice 'sem DE-PARA na DRE (jun–ago/26, piso 1): %',
    (select string_agg(distinct x->>'codigo', ', ') from jsonb_array_elements(v_sem_de_para) x);
end $$;
