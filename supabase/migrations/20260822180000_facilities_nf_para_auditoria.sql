-- Facilities → Auditoria: a NF que o Facilities anexa vale como evidência da auditoria.
--
-- Problema: o rapaz do Facilities anexa a NF em /facilities/historico, mas a auditoria
-- (cartão / PIX / achados) não enxerga esse arquivo e continua cobrando a mesma nota.
-- Ele acabava mandando duas vezes — e ele nem alcança as telas de auditoria: o cargo
-- `facilities` fica travado em /facilities (src/components/AppLayout.tsx:37-40).
--
-- Estrutura criada aqui:
--   1. campos fiscais em facilities_compras (arquivo em bucket privado + leitura da NF)
--   2. facilities_nf_auditoria — a ponte NF ↔ lançamento auditado, auditável e reversível
--   3. facilities_nf_candidatos() — quem casa com quem, com nível de confiança
--   4. facilities_nf_aplicar() / _desfazer() — grava a evidência no lado da auditoria
--
-- Regra de ouro (mesma convenção da Parametrização): documento bate → aplica sozinho;
-- valor+data sozinhos → vira PROPOSTA para alguém confirmar. Falso positivo aqui é pior
-- que nenhum casamento: marcaria um lançamento como resolvido com a nota errada. Nos
-- dados reais isso não é hipótese — havia uma compra de R$ 30 do "Mercado Livre"
-- empatando em valor com um "WISPRV WISPRFLOW.AI".

-- ---------------------------------------------------------------------------
-- 1. Campos fiscais da NF na compra
-- ---------------------------------------------------------------------------
-- `nf_url` (legado) apontava para o bucket PÚBLICO facilities-contratos, cuja policy
-- libera leitura para `anon` — nota fiscal por link sem login. NF é documento fiscal:
-- passa a viver no bucket privado comprovantes-auditoria, o mesmo que a auditoria já lê.
-- Mantemos nf_url para não quebrar linhas antigas (hoje: nenhuma, 0 de 41 usaram).
alter table public.facilities_compras
  add column if not exists nf_bucket      text,
  add column if not exists nf_arquivo     text,          -- path dentro do bucket
  add column if not exists nf_nome        text,          -- nome original do arquivo
  add column if not exists nf_enviada_em  timestamptz,
  add column if not exists nf_enviada_por text,
  -- o que a IA leu do PDF (mesmos nomes de campo da leitura da auditoria)
  add column if not exists nf_cnpj        text,
  add column if not exists nf_numero      text,
  add column if not exists nf_emissao     date,
  add column if not exists nf_valor       numeric,
  add column if not exists nf_ia          jsonb,
  add column if not exists nf_ia_em       timestamptz;

comment on column public.facilities_compras.nf_arquivo is
  'Path no bucket privado comprovantes-auditoria (prefixo facilities/). Fonte da evidência para a auditoria.';
comment on column public.facilities_compras.nf_cnpj is
  'CNPJ do emitente lido da própria NF — chave forte do casamento, independe do cadastro de fornecedor (0 de 25 fornecedores têm CNPJ).';

-- ---------------------------------------------------------------------------
-- 2. A ponte: qual NF do Facilities responde qual lançamento da auditoria
-- ---------------------------------------------------------------------------
create table if not exists public.facilities_nf_auditoria (
  id            bigserial primary key,
  compra_id     uuid not null references public.facilities_compras(id) on delete cascade,

  -- alvo do lado da auditoria; id_unico existe nas três tabelas
  alvo_tipo     text not null check (alvo_tipo in ('cartao', 'pix', 'achado')),
  alvo_id_unico text not null,

  confianca     text not null check (confianca in ('exata', 'alta', 'media', 'baixa')),
  criterio      jsonb not null default '{}'::jsonb,   -- o que bateu: valor, dias, nome, documento
  score         numeric,

  status        text not null default 'proposto'
                check (status in ('proposto', 'aplicado', 'recusado', 'desfeito')),

  aplicado_em   timestamptz,
  aplicado_por  text,
  decidido_em   timestamptz,
  decidido_por  text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (compra_id, alvo_tipo, alvo_id_unico)
);

-- Um lançamento da auditoria só pode ter UMA NF do Facilities valendo como evidência.
create unique index if not exists facilities_nf_auditoria_alvo_aplicado
  on public.facilities_nf_auditoria (alvo_tipo, alvo_id_unico)
  where status = 'aplicado';

create index if not exists facilities_nf_auditoria_compra
  on public.facilities_nf_auditoria (compra_id);
create index if not exists facilities_nf_auditoria_pendentes
  on public.facilities_nf_auditoria (status) where status = 'proposto';

drop trigger if exists trg_facilities_nf_auditoria_updated on public.facilities_nf_auditoria;
create trigger trg_facilities_nf_auditoria_updated
  before update on public.facilities_nf_auditoria
  for each row execute function public.update_updated_at_column();

alter table public.facilities_nf_auditoria enable row level security;
drop policy if exists facilities_nf_auditoria_all on public.facilities_nf_auditoria;
create policy facilities_nf_auditoria_all
  on public.facilities_nf_auditoria for all to authenticated
  using (true) with check (true);

-- índices que o casamento por valor precisa
create index if not exists auditoria_cartao_valor_data
  on public.auditoria_cartao_lancamentos (valor, data);
create index if not exists auditoria_pix_valor_data
  on public.auditoria_pix_lancamentos (valor, data);

-- ---------------------------------------------------------------------------
-- 3. Candidatos: qual lançamento da auditoria essa NF resolve
-- ---------------------------------------------------------------------------
-- Valor é filtro duro (exato contra o valor da compra OU o valor lido na NF).
-- Data é janela assimétrica — a compra é registrada no dia em que acontece, mas a
-- fatura do cartão e o PIX/boleto caem depois. Mesmos −7/+45 que a
-- `comprovantes-drive-sync` já usa para casar comprovante do Drive.
--
-- `grupo` é a chave da TRANSAÇÃO, não da linha: o mesmo gasto aparece como o lançamento
-- do cartão e como um ou mais achados (auditoria.id_transacao =
-- auditoria_cartao_lancamentos.id_unico). Sem isso, uma compra com 3 linhas pareceria
-- "ambígua" e travaria um casamento que é único de verdade.
drop function if exists public.facilities_nf_candidatos(uuid, int, int);

create or replace function public.facilities_nf_candidatos(
  p_compra_id uuid,
  p_dias_antes int default 7,
  p_dias_depois int default 45
)
returns table (
  alvo_tipo     text,
  alvo_id_unico text,
  grupo         text,
  alvo_data     date,
  alvo_valor    numeric,
  alvo_descricao text,
  alvo_status   text,
  dias          int,
  nome_score    numeric,
  documento_bate boolean,
  score         numeric,
  confianca     text,
  criterio      jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with c as (
    select
      co.id, co.data, co.valor, co.forma_pagamento,
      coalesce(co.nf_valor, co.valor)                        as valor_ref,
      coalesce(co.nf_emissao, co.data)                       as data_ref,
      public.normaliza_nome(coalesce(co.fornecedor_nome, '')) as fornec_norm,
      nullif(regexp_replace(coalesce(co.nf_cnpj, ''), '\D', '', 'g'), '') as cnpj_norm
    from public.facilities_compras co
    where co.id = p_compra_id
  ),
  -- lançamentos de cartão que ainda esperam nota
  cartao as (
    select
      'cartao'::text as alvo_tipo,
      a.id_unico     as alvo_id_unico,
      a.id_unico     as grupo,
      a.data         as alvo_data,
      a.valor        as alvo_valor,
      coalesce(a.estabelecimento, a.descricao_original, '') as alvo_descricao,
      a.status_nf    as alvo_status,
      null::text     as alvo_documento
    from public.auditoria_cartao_lancamentos a
    where a.status_nf in ('SEM NF', 'CONFERIR (passagem/hosp.)', 'OK (conferir)')
  ),
  -- lançamentos PIX/boleto sem comprovante
  pix as (
    select
      'pix'::text as alvo_tipo,
      p.id_unico  as alvo_id_unico,
      p.id_unico  as grupo,
      p.data      as alvo_data,
      p.valor     as alvo_valor,
      coalesce(p.favorecido, p.descricao, '') as alvo_descricao,
      p.status    as alvo_status,
      nullif(regexp_replace(coalesce(p.cnpj_cpf, ''), '\D', '', 'g'), '') as alvo_documento
    from public.auditoria_pix_lancamentos p
    where p.tem_comprovante = false
  ),
  -- achados abertos sem comprovante anexado
  achado as (
    select
      'achado'::text as alvo_tipo,
      x.id_unico     as alvo_id_unico,
      coalesce(x.id_transacao, x.id_unico) as grupo,
      x.data_lancamento as alvo_data,
      x.valor        as alvo_valor,
      coalesce(x.titulo, x.descricao, '') as alvo_descricao,
      x.status       as alvo_status,
      null::text     as alvo_documento
    from public.auditoria x
    where x.link_comprovante is null
      and x.status in ('Pendente', 'Em análise', 'Ajuste solicitado')
  ),
  alvos as (
    select * from cartao
    union all select * from pix
    union all select * from achado
  ),
  base as (
    select
      a.alvo_tipo, a.alvo_id_unico, a.grupo, a.alvo_data, a.alvo_valor,
      a.alvo_descricao, a.alvo_status,
      (a.alvo_data - c.data_ref)::int as dias,
      greatest(
        similarity(c.fornec_norm, public.normaliza_nome(a.alvo_descricao)),
        word_similarity(c.fornec_norm, public.normaliza_nome(a.alvo_descricao))
      )::numeric as nome_score,
      (c.cnpj_norm is not null and a.alvo_documento = c.cnpj_norm) as documento_bate
    from alvos a
    cross join c
    where
      -- valor exato (tolerância de centavo para ruído de arredondamento)
      abs(a.alvo_valor - c.valor_ref) <= 0.01
      -- forma de pagamento direciona a tabela; nula não filtra
      and (
        c.forma_pagamento is null
        or (c.forma_pagamento = 'cartao_corporativo' and a.alvo_tipo in ('cartao', 'achado'))
        or (c.forma_pagamento in ('pix_boleto', 'reembolso') and a.alvo_tipo in ('pix', 'achado'))
      )
      and a.alvo_data is not null
      and a.alvo_data between c.data_ref - p_dias_antes and c.data_ref + p_dias_depois
      -- não repropõe o que já foi aplicado ou recusado
      and not exists (
        select 1 from public.facilities_nf_auditoria v
        where v.compra_id = p_compra_id
          and v.alvo_tipo = a.alvo_tipo and v.alvo_id_unico = a.alvo_id_unico
          and v.status in ('aplicado', 'recusado')
      )
      -- nem rouba um lançamento que outra NF já resolveu
      and not exists (
        select 1 from public.facilities_nf_auditoria v2
        where v2.alvo_tipo = a.alvo_tipo and v2.alvo_id_unico = a.alvo_id_unico
          and v2.status = 'aplicado'
      )
  )
  select
    b.alvo_tipo, b.alvo_id_unico, b.grupo, b.alvo_data, b.alvo_valor,
    b.alvo_descricao, b.alvo_status, b.dias,
    round(b.nome_score, 3) as nome_score,
    b.documento_bate,
    round(
      (case when b.documento_bate then 1.0 else 0 end)
      + b.nome_score
      + greatest(0, 1 - abs(b.dias)::numeric / 60)
    , 3) as score,
    case
      -- CNPJ da própria NF + valor exato: não há o que discutir
      when b.documento_bate then 'exata'
      -- nome do fornecedor reconhecível e data perto
      when b.nome_score >= 0.55 and abs(b.dias) <= 15 then 'alta'
      when abs(b.dias) <= 30 then 'media'
      else 'baixa'
    end as confianca,
    jsonb_build_object(
      'valor', b.alvo_valor, 'dias', b.dias,
      'nome_score', round(b.nome_score, 3), 'documento_bate', b.documento_bate
    ) as criterio
  from base b
  order by score desc, abs(b.dias)
$$;

comment on function public.facilities_nf_candidatos(uuid, int, int) is
  'Lançamentos da auditoria que a NF desta compra pode resolver. `grupo` é a transação (cartão + seus achados são a MESMA compra). Valor exato é filtro duro.';

-- ---------------------------------------------------------------------------
-- 4. Aplicar: escrever a evidência do lado da auditoria
-- ---------------------------------------------------------------------------
create or replace function public.facilities_nf_aplicar(
  p_compra_id uuid,
  p_alvo_tipo text,
  p_alvo_id_unico text,
  p_confianca text default 'media',
  p_criterio jsonb default '{}'::jsonb,
  p_score numeric default null,
  p_por text default null
)
returns public.facilities_nf_auditoria
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_compra       public.facilities_compras;
  v_url          text;
  v_nome         text;
  v_agora        timestamptz := now();
  v_trilha       jsonb;
  v_id_transacao text;
  v_evento       jsonb;
  v_dono         text;
  v_out          public.facilities_nf_auditoria;
begin
  select * into v_compra from public.facilities_compras where id = p_compra_id;
  if not found then raise exception 'Compra % nao encontrada', p_compra_id; end if;
  if v_compra.nf_arquivo is null and v_compra.nf_url is null then
    raise exception 'Compra % nao tem NF anexada', p_compra_id;
  end if;

  -- Duas compras podem ter o mesmo valor no mesmo dia (as duas de R$ 59,59 do Nine
  -- Atacadista são um caso real), então duas propostas podem apontar para o MESMO
  -- lançamento. O índice parcial já impede o segundo vínculo; aqui só trocamos o erro
  -- cru do Postgres por uma frase que a tela possa mostrar.
  select c.item into v_dono
    from public.facilities_nf_auditoria v
    join public.facilities_compras c on c.id = v.compra_id
   where v.alvo_tipo = p_alvo_tipo and v.alvo_id_unico = p_alvo_id_unico
     and v.status = 'aplicado' and v.compra_id <> p_compra_id
   limit 1;
  if v_dono is not null then
    raise exception 'Este lancamento ja esta coberto pela NF de "%". Desfaca aquele vinculo antes.', v_dono;
  end if;

  -- A auditoria guarda um "link" que tanto pode ser URL quanto CAMINHO no bucket;
  -- src/lib/comprovante.ts resolve caminho em signed URL. Guardamos o caminho.
  v_url  := coalesce(v_compra.nf_arquivo, v_compra.nf_url);
  v_nome := coalesce(v_compra.nf_nome, 'NF ' || coalesce(v_compra.item, ''));
  v_evento := jsonb_build_object(
    'em', v_agora, 'por', coalesce(p_por, 'facilities'),
    'texto', 'NF enviada pelo Hub de Facilities: ' || v_nome,
    'tipo', 'comprovante_anexado', 'arquivo', v_nome
  );

  insert into public.facilities_nf_auditoria
    (compra_id, alvo_tipo, alvo_id_unico, confianca, criterio, score,
     status, aplicado_em, aplicado_por, decidido_em, decidido_por)
  values
    (p_compra_id, p_alvo_tipo, p_alvo_id_unico, p_confianca, p_criterio, p_score,
     'aplicado', v_agora, p_por, v_agora, p_por)
  on conflict (compra_id, alvo_tipo, alvo_id_unico) do update
    set status = 'aplicado', confianca = excluded.confianca, criterio = excluded.criterio,
        score = excluded.score, aplicado_em = v_agora, aplicado_por = excluded.aplicado_por,
        decidido_em = v_agora, decidido_por = excluded.decidido_por
  returning * into v_out;

  -- Carimba o lado da auditoria. Duas coisas que a tela exige e não são óbvias:
  --   • no achado quem manda nos chips e KPIs é `categoria = 'COM NF'`, não o status;
  --   • achado e lançamento do cartão são a MESMA nota vista de dois lados.
  if p_alvo_tipo = 'cartao' then
    update public.auditoria_cartao_lancamentos
       set link_comprovante = v_url, arquivo_comprovante = v_nome, status_nf = 'OK',
           observacao = trim(both ' ' from
             coalesce(observacao || ' - ', '') || 'NF pelo Hub de Facilities'),
           updated_at = v_agora
     where id_unico = p_alvo_id_unico;

    -- TODOS os achados desta transação: a mesma compra pode ter o achado de "SEM NF"
    -- e o de "ESCOPO". Deixar um para trás faz a tela seguir cobrando a nota que chegou.
    update public.auditoria
       set categoria = 'COM NF',
           link_comprovante = coalesce(link_comprovante, v_url),
           trilha = coalesce(trilha, '[]'::jsonb) || v_evento,
           updated_at = v_agora
     where id_transacao = p_alvo_id_unico;

  elsif p_alvo_tipo = 'pix' then
    update public.auditoria_pix_lancamentos
       set comprovante_url = v_url, anexo_nome = v_nome, tem_comprovante = true,
           observacao = trim(both ' ' from
             coalesce(observacao || ' - ', '') || 'NF pelo Hub de Facilities'),
           updated_at = v_agora
     where id_unico = p_alvo_id_unico;

  elsif p_alvo_tipo = 'achado' then
    select coalesce(trilha, '[]'::jsonb), id_transacao into v_trilha, v_id_transacao
      from public.auditoria where id_unico = p_alvo_id_unico;

    update public.auditoria
       set link_comprovante = v_url, categoria = 'COM NF', updated_at = v_agora,
           trilha = coalesce(v_trilha, '[]'::jsonb) || v_evento
     where id_unico = p_alvo_id_unico;

    -- espelha na origem do cartão, quando o achado tem uma
    if v_id_transacao is not null then
      update public.auditoria_cartao_lancamentos
         set status_nf = 'OK',
             link_comprovante = coalesce(link_comprovante, v_url),
             arquivo_comprovante = coalesce(arquivo_comprovante, v_nome),
             updated_at = v_agora
       where id_unico = v_id_transacao;
    end if;
  end if;

  -- fecha o ciclo do lado do Facilities: a NF foi aceita, não precisa mandar de novo
  update public.facilities_compras set nf_status = 'ok' where id = p_compra_id;

  return v_out;
end;
$$;

comment on function public.facilities_nf_aplicar(uuid, text, text, text, jsonb, numeric, text) is
  'Faz a NF do Facilities valer como evidência do lançamento auditado (cartão/PIX/achado) e marca a compra como resolvida.';

-- ---------------------------------------------------------------------------
-- 5. Desfazer: casou errado, tira a evidência sem apagar o rastro
-- ---------------------------------------------------------------------------
create or replace function public.facilities_nf_desfazer(
  p_vinculo_id bigint,
  p_por text default null
)
returns public.facilities_nf_auditoria
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v public.facilities_nf_auditoria;
begin
  select * into v from public.facilities_nf_auditoria where id = p_vinculo_id;
  if not found then raise exception 'Vinculo % nao encontrado', p_vinculo_id; end if;

  if v.status = 'aplicado' then
    if v.alvo_tipo = 'cartao' then
      update public.auditoria_cartao_lancamentos
         set link_comprovante = null, arquivo_comprovante = null, status_nf = 'SEM NF'
       where id_unico = v.alvo_id_unico;
    elsif v.alvo_tipo = 'pix' then
      update public.auditoria_pix_lancamentos
         set comprovante_url = null, anexo_nome = null, tem_comprovante = false
       where id_unico = v.alvo_id_unico;
    elsif v.alvo_tipo = 'achado' then
      update public.auditoria set link_comprovante = null where id_unico = v.alvo_id_unico;
    end if;
  end if;

  update public.facilities_nf_auditoria
     set status = 'desfeito', decidido_em = now(), decidido_por = p_por
   where id = p_vinculo_id
  returning * into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Painel: o que o Facilities já resolveu e o que espera confirmação
-- ---------------------------------------------------------------------------
create or replace view public.facilities_nf_auditoria_v
with (security_invoker = on) as
select
  v.id, v.compra_id, v.alvo_tipo, v.alvo_id_unico, v.confianca, v.criterio, v.score,
  v.status, v.aplicado_em, v.aplicado_por, v.created_at,
  c.data as compra_data, c.item as compra_item, c.fornecedor_nome,
  c.valor as compra_valor, c.forma_pagamento,
  c.nf_arquivo, c.nf_url, c.nf_nome, c.nf_cnpj, c.nf_numero
from public.facilities_nf_auditoria v
join public.facilities_compras c on c.id = v.compra_id;

-- ---------------------------------------------------------------------------
-- 7. As propostas, já com o lançamento do outro lado descrito
-- ---------------------------------------------------------------------------
-- Sem isto a tela mostraria só um id_unico, e ninguém confirma o que não consegue ler.
create or replace function public.facilities_nf_propostas()
returns table (
  id             bigint,
  compra_id      uuid,
  compra_item    text,
  compra_data    date,
  compra_valor   numeric,
  fornecedor_nome text,
  forma_pagamento text,
  nf_arquivo     text,
  nf_nome        text,
  nf_numero      text,
  nf_cnpj        text,
  alvo_tipo      text,
  alvo_id_unico  text,
  alvo_descricao text,
  alvo_data      date,
  alvo_valor     numeric,
  confianca      text,
  score          numeric,
  criterio       jsonb,
  created_at     timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    v.id, v.compra_id, c.item, c.data, c.valor,
    c.fornecedor_nome, c.forma_pagamento,
    c.nf_arquivo, c.nf_nome, c.nf_numero, c.nf_cnpj,
    v.alvo_tipo, v.alvo_id_unico,
    coalesce(ca.estabelecimento, ca.descricao_original, px.favorecido, px.descricao, ac.titulo, '')::text,
    coalesce(ca.data, px.data, ac.data_lancamento),
    coalesce(ca.valor, px.valor, ac.valor),
    v.confianca, v.score, v.criterio, v.created_at
  from public.facilities_nf_auditoria v
  join public.facilities_compras c on c.id = v.compra_id
  left join public.auditoria_cartao_lancamentos ca
    on v.alvo_tipo = 'cartao' and ca.id_unico = v.alvo_id_unico
  left join public.auditoria_pix_lancamentos px
    on v.alvo_tipo = 'pix' and px.id_unico = v.alvo_id_unico
  left join public.auditoria ac
    on v.alvo_tipo = 'achado' and ac.id_unico = v.alvo_id_unico
  where v.status = 'proposto'
    -- a compra pode ter sido resolvida por outro caminho enquanto isso
    and not exists (
      select 1 from public.facilities_nf_auditoria a
      where a.compra_id = v.compra_id and a.status = 'aplicado'
    )
  order by v.created_at desc, v.score desc nulls last
$$;

comment on function public.facilities_nf_propostas() is
  'NFs do Facilities esperando alguém dizer a qual lançamento pertencem.';

-- security_invoker acima faz a view respeitar o RLS de quem consulta, não o do dono.
--
-- Função nova nasce chamável SEM LOGIN, e o `revoke ... from anon` sozinho NÃO resolve:
-- o EXECUTE vem do grant implícito para PUBLIC, não de um grant para `anon`. Revogar de
-- `anon` deixa o de PUBLIC de pé e `has_function_privilege('anon', …)` continua true.
-- É preciso revogar de PUBLIC e devolver o acesso explicitamente — que é o desenho das
-- `auditoria_lojistas` / `auditoria_compras` (acl sem a entrada `=X/postgres`).
-- Cada instrução é sua própria linha: em bloco, um erro no meio abortaria o resto.
revoke all on function public.facilities_nf_candidatos(uuid, int, int) from public;
revoke all on function public.facilities_nf_aplicar(uuid, text, text, text, jsonb, numeric, text) from public;
revoke all on function public.facilities_nf_desfazer(bigint, text) from public;
revoke all on function public.facilities_nf_propostas() from public;

-- E de `anon` também: conforme o caso, o EXECUTE vem de um grant direto ao papel, e aí
-- revogar de PUBLIC não basta. Os dois juntos cobrem as duas formas; o que vale é a
-- conferência com has_function_privilege abaixo, não a leitura do ACL.
revoke all on function public.facilities_nf_candidatos(uuid, int, int) from anon;
revoke all on function public.facilities_nf_aplicar(uuid, text, text, text, jsonb, numeric, text) from anon;
revoke all on function public.facilities_nf_desfazer(bigint, text) from anon;
revoke all on function public.facilities_nf_propostas() from anon;

grant execute on function public.facilities_nf_candidatos(uuid, int, int) to authenticated, service_role;
grant execute on function public.facilities_nf_aplicar(uuid, text, text, text, jsonb, numeric, text) to authenticated, service_role;
grant execute on function public.facilities_nf_desfazer(bigint, text) to authenticated, service_role;
grant execute on function public.facilities_nf_propostas() to authenticated, service_role;

revoke all on public.facilities_nf_auditoria from anon;
revoke all on public.facilities_nf_auditoria_v from anon;
grant select on public.facilities_nf_auditoria_v to authenticated;
