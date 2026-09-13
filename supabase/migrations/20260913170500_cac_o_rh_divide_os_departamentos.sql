-- ===========================================================================
-- PAINEL CAC: O PORTAL RH ENTRA COMO APOIO NA DIVISÃO DOS DEPARTAMENTOS.
--
-- Pedido de 13/09/2026: "use a parte de colaboradores (RH) como suporte para
-- fazer a divisão entre os departamentos", com duas correções da skill:
--   • Michael Cardoso Thome é FIELD SALES (a skill dizia Inside Sales);
--   • Lucas Caldas era FRANQUIAS. É o "Lucas Henrique Caldas" do cadastro de
--     remuneração (CNPJ 57.993.634/0001-00), que o Omie também paga por um
--     cadastro SEM documento ("Lucas Caldas", código 5472069462).
--
-- APOIO, NÃO DONO. A planilha Dados Pessoal continua mandando no departamento
-- de quem está nela: o RH escreve o Eduardo como "Performance" e a planilha como
-- "Comunidade" — e é a planilha que bate exato com o oficial em abr–jun/26. O
-- RH faz três coisas:
--   1. traz quem FALTA no cadastro (contratado depois da planilha, gente que a
--      skill mandava para o fallback por categoria: André Neves Alves é
--      Onboarding no RH, não Suporte);
--   2. desativa quem o RH dá como DESLIGADO (só tira da lista "sem pagamento";
--      o que a pessoa recebeu continua somando);
--   3. aponta na tela onde o setor do RH cairia em OUTRA linha do painel.
--
-- FRANQUIA VOLTA A SER "Franquia" + "Franquias". O RH põe o Thayrone, a
-- Nathallya, a Emanuelle e o Lucas no mesmo setor. A skill ignorava "Franquias"
-- e por isso o oficial de mai–jun/26 tem só o Thayrone (R$ 27.500); daqui em
-- diante a linha fica acima do oficial pelo que os outros três receberam.
-- ===========================================================================

-- ─────────────────────── 1. Setor do RH → departamento do CAC ───────────────────────

create table if not exists public.cac_setor_rh (
  setor         text primary key,
  departamento  text not null,
  atualizado_em timestamptz not null default now()
);

comment on table public.cac_setor_rh is
  'De-para do setor do Portal RH (rh_colaboradores.setor) para o departamento que cac_linhas aponta. O RH escreve "Onboarding"; a linha procura "Onboarding e Setup".';

alter table public.cac_setor_rh enable row level security;
drop policy if exists "cac_setor_rh le" on public.cac_setor_rh;
create policy "cac_setor_rh le" on public.cac_setor_rh
  for select to authenticated using (true);
drop policy if exists "cac_setor_rh escreve" on public.cac_setor_rh;
create policy "cac_setor_rh escreve" on public.cac_setor_rh
  for all to authenticated
  using (public.pode_ver_remuneracao()) with check (public.pode_ver_remuneracao());

revoke all on public.cac_setor_rh from anon;
grant select, insert, update, delete on public.cac_setor_rh to authenticated;
grant all on public.cac_setor_rh to service_role;

-- `do nothing`: rodar de novo não desfaz um de-para ajustado depois.
insert into public.cac_setor_rh (setor, departamento) values
  ('Field Sales',        'Field Sales'),
  ('Inside Sales',       'Inside Sales'),
  ('Franquias',          'Franquias'),
  ('Onboarding',         'Onboarding e Setup'),
  ('Sucesso',            'Sucesso'),
  ('Suporte',            'Suporte'),
  ('Operações',          'Liderança OPS'),
  ('Performance',        'Performance'),
  ('Marketing',          'Branding e Conteúdo'),
  ('Eventos',            'Eventos'),
  ('Parcerias',          'Canais Indiretos'),
  ('Tecnologia',         'Tecnologia'),
  ('Produto',            'Produto'),
  ('RPA',                'RPA'),
  ('Financeiro',         'Financeiro'),
  ('Pessoas & Cultura',  'RH/DP'),
  ('Diretoria',          'Diretoria')
on conflict (setor) do nothing;

-- ─────────────────────── 2. As duas correções ───────────────────────

update public.cac_pessoas
   set departamento = 'Field Sales',
       observacao = 'Field Sales, confirmado em 13/09/2026 (a skill custos-cac-mensal dizia Inside Sales).',
       atualizado_em = now()
 where cnpj = '46148025000138';

insert into public.cac_pessoas (cnpj, nome, departamento, observacao, ativo, codigos_omie)
values ('57993634000100', 'Lucas Henrique Caldas', 'Franquias',
        'Franquias, confirmado em 13/09/2026. O Omie também o paga pelo cadastro "Lucas Caldas", sem documento.',
        false, '{5472069462}')
on conflict (cnpj) do update
  set departamento = excluded.departamento,
      observacao   = excluded.observacao,
      codigos_omie = array(select distinct unnest(public.cac_pessoas.codigos_omie || excluded.codigos_omie)),
      atualizado_em = now();

update public.cac_linhas
   set departamentos = '{Franquia,Franquias}', atualizado_em = now()
 where grupo = 'Equipes' and rotulo = 'Franquia';

-- ─────────────────────── 3. Trazer do RH ───────────────────────

/* DEFINER porque o botão da tela e o cron chamam a mesma função, e ela escreve
   em `cac_pessoas` lendo `rh_colaboradores`. A trava pergunta ao JWT, não ao
   `current_user` (que dentro de DEFINER é sempre o dono — ver
   armadilhas-postgres-supabase): sem JWT é o cron, com JWT tem de ver a folha. */
create or replace function public.cac_sincronizar_rh()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ins integer := 0;
  v_des integer := 0;
begin
  if auth.role() = 'authenticated' and not public.pode_ver_remuneracao() then
    raise exception 'Trazer do RH exige acesso à folha.';
  end if;

  with bruto as (
    select btrim(r.nome) as nome, r.setor,
           nullif(btrim(coalesce(r.datadesl, '')), '') as datadesl,
           regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g') as d
      from public.rh_colaboradores r
     where r.nome !~* 'teste'
       and coalesce(btrim(r.setor), '') <> ''
  ),
  resolvido as (
    select b.nome, b.setor, b.datadesl,
           case
             when length(b.d) in (11, 14) and b.d !~ '^0{8}' then b.d
             -- O RH guarda às vezes só a raiz do CNPJ. Vale se ela aponta para UM
             -- documento só no cadastro do Omie; dois, e fica de fora.
             when length(b.d) = 8 then (
               select min(o.doc) from public.omie_clientes_doc o
                where length(o.doc) = 14 and left(o.doc, 8) = b.d
               having count(distinct o.doc) = 1)
           end as doc
      from bruto b
  ),
  novos as (
    select distinct on (x.doc) x.doc, x.nome, x.setor, x.datadesl
      from resolvido x
     where x.doc is not null
       and not exists (
         select 1 from public.cac_pessoas p
          where p.cnpj = x.doc
             or (length(x.doc) = 14 and length(p.cnpj) = 14 and left(p.cnpj, 8) = left(x.doc, 8)))
     order by x.doc, x.datadesl nulls first
  ),
  ins as (
    insert into public.cac_pessoas (cnpj, nome, departamento, observacao, ativo)
    select n.doc, n.nome, coalesce(m.departamento, n.setor),
           'Veio do Portal RH (setor ' || n.setor || ') em ' || to_char(current_date, 'DD/MM/YYYY') || '.',
           not coalesce(n.datadesl ~ '^\d{4}-\d{2}-\d{2}$' and n.datadesl::date <= current_date, false)
      from novos n
      left join public.cac_setor_rh m on m.setor = n.setor
    on conflict (cnpj) do nothing
    returning 1
  )
  select count(*) into v_ins from ins;

  -- Desligado no RH sai da lista "sem pagamento". Nunca liga ninguém de volta:
  -- quem está inativo por decisão da tela continua inativo.
  with saiu as (
    update public.cac_pessoas p
       set ativo = false, atualizado_em = now()
     where p.ativo
       and exists (
         select 1 from public.rh_colaboradores r
          where regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g') = p.cnpj
            and r.datadesl ~ '^\d{4}-\d{2}-\d{2}$' and r.datadesl::date <= current_date)
       and not exists (
         select 1 from public.rh_colaboradores r
          where regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g') = p.cnpj
            and coalesce(btrim(r.datadesl), '') = '')
    returning 1
  )
  select count(*) into v_des from saiu;

  return jsonb_build_object('inseridos', v_ins, 'desativados', v_des);
end;
$function$;

revoke all on function public.cac_sincronizar_rh() from public;
revoke all on function public.cac_sincronizar_rh() from anon;
grant execute on function public.cac_sincronizar_rh() to authenticated, service_role;

-- ─────────────────────── 4. O setor do RH ao lado de cada pessoa ───────────────────────

/* INVOKER: lê `rh_colaboradores` e `cac_pessoas` com a RLS de quem chama, e as
   duas já exigem a folha. A tela usa para mostrar "RH: Marketing" e acusar
   quando o setor cairia em outra linha. */
create or replace function public.cac_pessoas_rh()
returns table (cnpj text, nome_rh text, setor_rh text, departamento_rh text, datadesl text)
language sql
stable
set search_path to 'public'
as $function$
  select distinct on (p.cnpj)
         p.cnpj, r.nome, r.setor, coalesce(m.departamento, r.setor), nullif(btrim(coalesce(r.datadesl, '')), '')
    from public.cac_pessoas p
    join public.rh_colaboradores r
      on regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g') = p.cnpj
      or (length(regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g')) = 8
          and length(p.cnpj) = 14
          and left(p.cnpj, 8) = regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g'))
    left join public.cac_setor_rh m on m.setor = r.setor
   where r.nome !~* 'teste'
   order by p.cnpj, nullif(btrim(coalesce(r.datadesl, '')), '') nulls first
$function$;

revoke all on function public.cac_pessoas_rh() from public;
revoke all on function public.cac_pessoas_rh() from anon;
grant execute on function public.cac_pessoas_rh() to authenticated, service_role;

-- ─────────────────────── 5. Roda agora e todo dia ───────────────────────

-- O RH guarda o setor de HOJE. O André Neves Alves aparece lá como Onboarding,
-- mas recebeu até mai/26 em Premiação/Escala/Pessoal - Suporte, e o oficial de
-- abril o põe em Suporte — foi o único caso em que o setor atual reescreveu o
-- passado (R$ 8.830,65 de mai/26 pulavam de Suporte para Onboarding).
-- Inserido antes da sincronia para ela não o trazer como Onboarding.
insert into public.cac_pessoas (cnpj, nome, departamento, observacao, ativo)
values ('53352402000111', 'André Neves Alves', 'Suporte',
        'Suporte: recebeu até mai/26 nas categorias de Suporte e o oficial de abril o põe lá. O Portal RH mostra o setor de hoje (Onboarding).',
        false)
on conflict (cnpj) do update
  set departamento = excluded.departamento, observacao = excluded.observacao, ativo = false, atualizado_em = now();

-- 09:50 BRT: depois de `remuneracao-atualizar-diaria` (09:40), que já trouxe o RH do dia.
select cron.schedule('cac-sincronizar-rh-diaria', '50 12 * * *', $$select public.cac_sincronizar_rh();$$);

do $$
declare
  r jsonb;
begin
  r := public.cac_sincronizar_rh();
  raise notice 'primeira sincronia com o RH: %', r;

  r := public.cac_sincronizar_rh();
  if (r->>'inseridos')::int <> 0 then
    raise exception 'a sincronia com o RH não é idempotente: %', r;
  end if;

  -- A Renata só tem a raiz no RH (61107569); tem de ter entrado pelo CNPJ inteiro.
  if not exists (select 1 from public.cac_pessoas where cnpj = '61107569000145') then
    raise exception 'a raiz do CNPJ da Renata não resolveu no cadastro do Omie';
  end if;

  perform count(*) from public.cac_pessoas_rh();
  perform count(*) from public.cac_painel(2026);
end $$;

-- ─────────────────────── 6. As notas, remedidas ───────────────────────

/* Contra CAC_Jun26.xlsx, depois do RH, do Michael e do Lucas (13/09/2026). */
update public.cac_linhas c
   set regra_nota = v.nota, atualizado_em = now()
  from (values
    ('Equipes', 'Franquia',
     'Franquia + Franquias, como o Portal RH (Thayrone, Nathallya, Emanuelle e Lucas Caldas) — decidido em 13/09/26. Fica acima do oficial de mai–jun/26 (R$ 27.500, só o Thayrone) porque a skill deixava "Franquias" de fora. O Lucas Caldas cai em mai/26, que é a competência dos títulos dele.'),
    ('Equipes', 'Inside Sales',
     'CONFERIR: bate em abr/26 (67.148,10 × 67.147,51); mai fica 5,5% abaixo (64.004,13 × 67.695,01) e jun 7% abaixo (77.924,17 × 83.824,17).'),
    ('Equipes', 'Field Sales',
     'CONFERIR: bate em jun/26 (68.228,33 × 68.328,33); mai fica 8% abaixo. O Michael é Field Sales (decidido em 13/09/26); o oficial de abril também pôs aqui gente que hoje está em Franquia e Inside Sales.'),
    ('Equipes', 'Onboarding e Setup',
     'CONFERIR: mai/26 1,4% acima e jun 3,8% acima do oficial (76.358,43 × 73.533,43).'),
    ('Equipes', 'Suporte',
     'CONFERIR: jun/26 dá 44.833,33 contra 36.708,33 do oficial. R$ 2.980 são de gente de Onboarding paga em 3.2.7.2, que a skill conta inteira em Suporte.')
  ) as v(grupo, rotulo, nota)
 where c.grupo = v.grupo and c.rotulo = v.rotulo;
