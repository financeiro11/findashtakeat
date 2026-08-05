-- Trocar a categoria de um lançamento pelo Hub — e o Omie muda junto.
--
-- O QUE ISTO RESOLVE
-- O drill-down (migration 20260803150000) e o alerta de reclassificação
-- (20260804120000) já mostram QUAL lançamento está na rubrica errada. Até aqui a
-- correção terminava fora do Hub: abrir o Omie, achar o título, trocar a
-- categoria, voltar e sincronizar. Agora a troca sai do próprio painel: a Edge
-- Function `omie-trocar-categoria` altera o título no Omie (fonte da verdade),
-- confirma que colou e só então chama `omie_cache_trocar_categoria` para o cache
-- local refletir o mesmo. Se o Omie recusar, nada muda aqui — o Hub nunca mostra
-- uma classificação que o ERP não tem.
--
-- O que entra neste arquivo:
--   1. omie_categorias_disponiveis() → o seletor de categoria da tela, já dizendo
--      em que rubrica da DRE e da DFC cada categoria vai cair.
--   2. omie_lancamento()             → os dados do título (grupo, natureza,
--      categoria atual) que a Edge Function precisa antes de falar com o Omie.
--   3. omie_cache_trocar_categoria() → aplica a troca no cache já baixado.
--   4. omie_categoria_alteracoes     → trilha de quem trocou o quê, quando.

/* ============================================================
 *  1. Categorias disponíveis (alimenta o seletor)
 * ============================================================ */

-- Só o que se pode de fato lançar: fora as inativas e as totalizadoras (que são
-- pastas do plano de contas, não destino de lançamento). Das 177 do Omie sobram
-- 133. `usos` é a contagem no histórico já baixado — categoria que a empresa
-- realmente usa sobe na lista, e o resto continua acessível pela busca.
--
-- A rubrica vem do DE-PARA, que é chaveado pela DESCRIÇÃO da categoria (não pelo
-- código curto) — mesma normalização de acento/espaço usada no omie-sync e no
-- drill-down. Mostrar a rubrica no seletor é o ponto: quem corrige está mirando
-- a linha da DRE, não o código do plano de contas.
create or replace function public.omie_categorias_disponiveis()
returns table (
  codigo      text,
  descricao   text,
  despesa     boolean,
  receita     boolean,
  rubrica_dre text,
  rubrica_dfc text,
  usos        bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cat as (
    select
      c->>'codigo'    as codigo,
      c->>'descricao' as descricao,
      coalesce(c->>'conta_despesa','N') = 'S' as despesa,
      coalesce(c->>'conta_receita','N') = 'S' as receita
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
      and coalesce(c->>'conta_inativa','N') <> 'S'
      and coalesce(c->>'totalizadora','N')  <> 'S'
      and nullif(c->>'codigo','') is not null
  ),
  usos as (
    select m->'detalhes'->>'cCodCateg' as codigo, count(*) as n
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
      -- Sem nValorTitulo é a perna bancária do título: não é lançamento próprio.
      and m->'detalhes'->>'nValorTitulo' is not null
    group by 1
  ),
  -- Se o DE-PARA mapear a mesma categoria em duas rubricas do mesmo
  -- demonstrativo (configuração ambígua que o painel de DE-PARA deixa fazer),
  -- fica uma só — o seletor não é o lugar de expor esse outro problema.
  mapa as (
    select
      lower(btrim(regexp_replace(unaccent(codigo_categoria), '\s+', ' ', 'g'))) as chave,
      max(rubrica) filter (where demonstrativo in ('dre','ambos')) as rubrica_dre,
      max(rubrica) filter (where demonstrativo in ('dfc','ambos')) as rubrica_dfc
    from omie_dre_mapa
    where ativo is not false
    group by 1
  )
  select
    c.codigo, c.descricao, c.despesa, c.receita,
    m.rubrica_dre, m.rubrica_dfc,
    coalesce(u.n, 0) as usos
  from cat c
  left join mapa m
    on m.chave = lower(btrim(regexp_replace(unaccent(c.descricao), '\s+', ' ', 'g')))
  left join usos u on u.codigo = c.codigo
  order by coalesce(u.n, 0) desc, c.descricao;
$$;

/* ============================================================
 *  2. O título, do jeito que o cache conhece
 * ============================================================ */

-- A Edge Function precisa saber ANTES de chamar o Omie: qual endpoint usar
-- (`cGrupo`), qual é a categoria de hoje (para gravar o "de" na trilha e para
-- não gastar uma alteração à toa) e o rótulo humano do lançamento (para as
-- mensagens de erro dizerem de qual despesa se está falando).
--
-- `cGrupo` é o que separa o que dá para alterar do que não dá:
--   CONTA_A_PAGAR / CONTA_A_RECEBER → título financeiro, alterável pela API.
--   PREVISAO_ORDEM_SERVICO / PREVISAO_CONTRATO → previsão gerada por OS/contrato;
--     a categoria mora no documento de origem, não no financeiro.
--   CONTA_CORRENTE_* → a perna bancária do mesmo título (sem nValorTitulo).
create or replace function public.omie_lancamento(p_cod_titulo text)
returns table (
  cod_titulo  text,
  grupo       text,
  natureza    text,
  categoria   text,
  valor       numeric,
  data        date,
  contraparte text,
  documento   text,
  status      text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cli as (
    select distinct on (c->>'codigo')
      c->>'codigo' as codigo,
      coalesce(
        nullif(btrim(regexp_replace(
          regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
          '\s+\d{11}$', '')), ''),
        c->>'nome'
      ) as nome
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
      and m->'detalhes'->>'nCodTitulo' = p_cod_titulo
      -- 124 movimentos de conta corrente vêm com nCodTitulo = '0' (não têm
      -- título próprio). '0' não identifica ninguém: casá-lo devolveria uma
      -- linha qualquer desse monte.
      and p_cod_titulo not in ('', '0')
  )
  select
    det->>'nCodTitulo' as cod_titulo,
    det->>'cGrupo'     as grupo,
    upper(coalesce(det->>'cNatureza','')) as natureza,
    det->>'cCodCateg'  as categoria,
    (det->>'nValorTitulo')::numeric as valor,
    to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'),''),'DD/MM/YYYY') as data,
    coalesce(nullif(btrim(cli.nome), ''), nullif(det->>'cCPFCNPJCliente','')) as contraparte,
    nullif(det->>'cNumDocFiscal','') as documento,
    nullif(det->>'cStatus','') as status
  from mov
  left join cli on cli.codigo = det->>'nCodCliente'
  -- O mesmo título aparece como conta a pagar/receber E como movimento de conta
  -- corrente. A perna com valor é a que carrega a classificação.
  order by (det->>'nValorTitulo') is null, det->>'cGrupo'
  limit 1;
$$;

/* ============================================================
 *  3. Aplicar a troca no cache local
 * ============================================================ */

-- Chamada DEPOIS de o Omie confirmar a alteração. Reescreve `cCodCateg` em todas
-- as pernas do título (a do financeiro e a de conta corrente), para o drill-down
-- e a detecção de reclassificação — que leem o cache, não a API — enxergarem o
-- mesmo que o ERP.
--
-- `atualizado_em` NÃO é tocado de propósito: o cache continua com a idade do
-- último pull de verdade, senão esta escrita adiaria a próxima sincronização
-- completa e o resto do dado ficaria velho sem ninguém perceber.
--
-- O UPDATE dispara o trigger `omie_cache_reclassifica`, que recalcula os alertas
-- — é assim que o aviso do lançamento corrigido some da tela sozinho.
create or replace function public.omie_cache_trocar_categoria(
  p_cod_titulo text,
  p_codigo     text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  -- '0' é o nCodTitulo dos 124 movimentos de conta corrente sem título próprio.
  -- Sem esta guarda, uma chamada com '0' reescreveria a categoria dos 124 de uma
  -- vez — o pior estrago possível para uma função de correção pontual.
  if coalesce(p_cod_titulo, '') in ('', '0') then
    raise exception 'cod_titulo inválido: %', coalesce(p_cod_titulo, '(nulo)');
  end if;
  if coalesce(p_codigo, '') = '' then
    raise exception 'código de categoria vazio';
  end if;

  select count(*) into v_n
  from omie_cache, lateral jsonb_array_elements(dados) m
  where chave = 'movimentos'
    and m->'detalhes'->>'nCodTitulo' = p_cod_titulo;

  if v_n = 0 then
    return 0;
  end if;

  update omie_cache o
     set dados = (
       select jsonb_agg(
                case when m->'detalhes'->>'nCodTitulo' = p_cod_titulo
                     then jsonb_set(m, '{detalhes,cCodCateg}', to_jsonb(p_codigo))
                     else m
                end
                order by ord
              )
       from jsonb_array_elements(o.dados) with ordinality t(m, ord)
     )
   where o.chave = 'movimentos';

  return v_n;
end;
$$;

/* ============================================================
 *  4. Trilha das alterações
 * ============================================================ */

-- Mudar categoria no ERP é ato contábil: fica registrado quem fez, de onde
-- (célula da DRE ou da DFC) e para que rubrica o número foi. Sem isto, a única
-- prova da correção seria o log do Omie, que ninguém do time abre.
create table if not exists public.omie_categoria_alteracoes (
  id                 uuid primary key default gen_random_uuid(),
  cod_titulo         text not null,
  grupo              text,                 -- CONTA_A_PAGAR | CONTA_A_RECEBER
  contraparte        text,
  documento          text,
  data               date,
  valor              numeric,
  categoria_de       text,
  descricao_de       text,
  categoria_para     text,
  descricao_para     text,
  rubrica_dre_de     text,
  rubrica_dre_para   text,
  rubrica_dfc_de     text,
  rubrica_dfc_para   text,
  origem             text,                 -- 'dre' | 'dfc' — de qual tela veio o clique
  mes                text,                 -- 'Jul-26', a célula de onde saiu
  motivo             text,
  alterado_por       uuid,
  alterado_por_email text,
  criado_em          timestamptz not null default now()
);

create index if not exists omie_categoria_alteracoes_titulo_idx
  on public.omie_categoria_alteracoes (cod_titulo, criado_em desc);

alter table public.omie_categoria_alteracoes enable row level security;

drop policy if exists "auth read omie_categoria_alteracoes" on public.omie_categoria_alteracoes;
create policy "auth read omie_categoria_alteracoes"
  on public.omie_categoria_alteracoes for select to authenticated using (true);
-- Escrita só pela Edge Function (service role): a linha só existe se o Omie
-- confirmou a troca.

/* ============================================================
 *  5. Token de diagnóstico da Edge Function
 * ============================================================ */

-- Mesmo mecanismo das syncs agendadas (`x-cron-token`), mas aqui NÃO existe job:
-- serve para conferir pelo banco o que o Omie responde para um título — a única
-- forma de depurar a integração sem a service key. A função amarra este caminho
-- à ação de LEITURA (`consultar`); alterar categoria continua exigindo usuário
-- logado.
insert into public.internal_cron_tokens (name) values ('omie-trocar-categoria')
  on conflict (name) do nothing;

/* ============================================================
 *  Permissões
 * ============================================================ */

-- Toda função nova em `public` nasce com EXECUTE para anon — e a anon key é
-- pública (está no bundle do front). Ver 20260804160200.
revoke all on function public.omie_categorias_disponiveis() from public;
revoke all on function public.omie_lancamento(text) from public;
revoke all on function public.omie_cache_trocar_categoria(text, text) from public;

revoke execute on function public.omie_categorias_disponiveis() from anon;
revoke execute on function public.omie_lancamento(text) from anon;
revoke execute on function public.omie_cache_trocar_categoria(text, text) from anon;

-- O seletor roda no navegador de quem está logado; as outras duas são do
-- servidor (Edge Function com service role) e não têm por que ficar ao alcance
-- do cliente — `omie_cache_trocar_categoria` menos ainda, que é escrita.
grant execute on function public.omie_categorias_disponiveis() to authenticated, service_role;
grant execute on function public.omie_lancamento(text) to service_role;
grant execute on function public.omie_cache_trocar_categoria(text, text) to service_role;
