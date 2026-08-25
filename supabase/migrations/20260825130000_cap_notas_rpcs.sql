-- A medição de cobertura de notas no CAP — a view e as consultas da tela.
--
-- TUDO AQUI É `security definer`, E ISSO NÃO É DESCUIDO. A base de tudo é
-- `omie_cache`, que tem RLS ligado e ZERO policy de propósito: só service_role lê.
-- Uma função `invoker` sobre ela não dá erro — ela lê a tabela VAZIA e devolve
-- "nenhum título", que é a pior resposta possível numa tela de auditoria: um zero
-- que parece cobertura perfeita. Já aconteceu neste repo; ver a nota de
-- omie-cache-rls-sem-policy.
--
-- A TAXONOMIA. Um título do contas a pagar cai em exatamente um estado, e a ordem
-- da decisão importa:
--
--   dispensa          a categoria não gera nota de fornecedor (folha, tributo,
--                     transferência, tarifa). Fora do numerador E do denominador.
--   conferir          às vezes tem nota, às vezes é bilhete/cupom. Idem.
--   dispensa_piso     abaixo do piso configurado (nasce em zero = nada aqui).
--   com_nota          o ERP confirmou anexo. É o único estado verde.
--   pronta_para_enviar o Hub TEM a nota e o ERP não — falha nossa, e a mais fácil
--                     de corrigir, porque o arquivo já está na mão.
--   sem_nota          exige, foi verificado, não tem anexo e ninguém tem o arquivo.
--   erro_leitura      o Omie não deixou ler. Diferente de "não tem".
--   nao_verificado    ninguém perguntou ainda.

/* ============================================================================
 *  A base: um título do contas a pagar por linha, com tudo que se sabe dele
 * ========================================================================== */

create or replace view public.cap_titulos as
with mov as (
  -- `distinct on` porque um título aparece uma vez por movimento (a inclusão e a
  -- baixa são duas linhas do mesmo nCodTitulo). Sem isto, um título pago contaria
  -- em dobro e o valor total ficaria inflado.
  select distinct on ((d->'detalhes'->>'nCodTitulo')::bigint)
         (d->'detalhes'->>'nCodTitulo')::bigint                        as cod_titulo,
         nullif(d->'detalhes'->>'cCodCateg', '')                       as categoria_codigo,
         nullif(d->'detalhes'->>'nCodCC', '')                          as conta_codigo,
         (d->'detalhes'->>'nValorTitulo')::numeric                     as valor,
         to_date(nullif(d->'detalhes'->>'dDtEmissao', ''), 'DD/MM/YYYY')   as emissao,
         to_date(nullif(d->'detalhes'->>'dDtVenc', ''), 'DD/MM/YYYY')      as vencimento,
         to_date(nullif(d->'detalhes'->>'dDtPagamento', ''), 'DD/MM/YYYY') as pagamento,
         nullif(d->'detalhes'->>'cStatus', '')                         as status,
         regexp_replace(coalesce(d->'detalhes'->>'cCPFCNPJCliente', ''), '\D', '', 'g') as doc,
         nullif(d->'detalhes'->>'nCodCliente', '')                     as cod_cliente,
         nullif(d->'detalhes'->>'cNumParcela', '')                     as parcela
  from public.omie_cache, jsonb_array_elements(dados) d
  where chave = 'movimentos'
    and d->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
  order by (d->'detalhes'->>'nCodTitulo')::bigint
),
-- O Hub tem o arquivo da nota em algum lugar? Quatro fontes, uma união.
nota_no_hub as (
  select omie_cod_titulo::bigint as cod_titulo, 'auditoria'::text as fonte
    from public.auditoria
   where omie_cod_titulo ~ '^\d+$'
     and coalesce(link_comprovante, '') <> ''
  union
  select omie_cod_titulo::bigint, 'cartao'
    from public.auditoria_cartao_lancamentos
   where omie_cod_titulo ~ '^\d+$'
     and coalesce(link_comprovante, '') <> ''
  union
  select cod_titulo::bigint, 'drive'
    from public.comprovantes_drive
   where cod_titulo ~ '^\d+$'
  union
  select omie_cod_titulo::bigint, 'facilities'
    from public.facilities_compras
   where omie_cod_titulo ~ '^\d+$'
     and coalesce(nf_arquivo, '') <> ''
),
hub as (
  select cod_titulo, string_agg(distinct fonte, '+' order by fonte) as fontes
  from nota_no_hub group by cod_titulo
),
-- Já carimbamos envio deste título?
enviado as (
  select omie_cod_titulo::bigint as cod_titulo, max(omie_anexo_enviado_em) as em
    from public.auditoria
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null
   group by 1
  union all
  select omie_cod_titulo::bigint, max(omie_anexo_enviado_em)
    from public.auditoria_cartao_lancamentos
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null
   group by 1
),
enviado_por_titulo as (
  select cod_titulo, max(em) as enviado_em from enviado group by cod_titulo
),
cfg as (select piso_valor from public.cap_notas_config where id = 1)
select
  m.cod_titulo,
  m.categoria_codigo,
  coalesce(r.descricao, m.categoria_codigo, '(sem categoria)') as categoria,
  coalesce(r.regra, 'exige')                                   as regra,
  m.conta_codigo,
  coalesce(cc.nome, 'conta ' || coalesce(m.conta_codigo, '?')) as conta,
  m.valor,
  m.emissao,
  m.vencimento,
  m.pagamento,
  coalesce(m.pagamento, m.vencimento, m.emissao)               as competencia,
  m.status,
  m.doc,
  m.parcela,
  coalesce(nullif(btrim(t.favorecido), ''), '—')               as favorecido,
  nullif(btrim(t.nota_fiscal), '')                             as nf_no_campo,
  nullif(btrim(t.documento), '')                               as documento,
  a.qtd                                                        as anexos_no_erp,
  a.anexos                                                     as anexos,
  a.erro                                                       as erro_leitura,
  a.lido_em                                                    as anexo_lido_em,
  h.fontes                                                     as nota_no_hub,
  e.enviado_em,
  case
    when coalesce(r.regra, 'exige') = 'dispensa'                     then 'dispensa'
    when coalesce(r.regra, 'exige') = 'conferir'                     then 'conferir'
    when m.valor < (select piso_valor from cfg)                      then 'dispensa_piso'
    when coalesce(a.qtd, 0) > 0                                      then 'com_nota'
    when a.erro is not null                                          then 'erro_leitura'
    when a.cod_titulo is null                                        then 'nao_verificado'
    when h.fontes is not null                                        then 'pronta_para_enviar'
    else 'sem_nota'
  end                                                          as situacao
from mov m
left join public.omie_categoria_regra r  on r.codigo     = m.categoria_codigo
left join public.omie_caixa_conta cc     on cc.ncodcc    = m.conta_codigo
left join public.omie_titulo_anexo a     on a.cod_titulo = m.cod_titulo
left join public.omie_titulo_texto t     on t.cod_titulo = m.cod_titulo
left join hub h                          on h.cod_titulo = m.cod_titulo
left join enviado_por_titulo e           on e.cod_titulo = m.cod_titulo;

comment on view public.cap_titulos is
  'Um título do contas a pagar do Omie por linha, com a régua da categoria, o que o ERP tem de anexo e o que o Hub tem de arquivo. Base de toda a medição de notas. Leitura só via RPC security definer — omie_cache não é legível pelo usuário.';

revoke all on public.cap_titulos from anon, authenticated;

/* ============================================================================
 *  O resumo — o número que vai para a reunião
 * ========================================================================== */

create or replace function public.cap_notas_resumo(p_de date, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select * from public.cap_titulos
  where competencia between p_de and p_ate
),
exigivel as (select * from base where situacao not in ('dispensa', 'conferir', 'dispensa_piso'))
select jsonb_build_object(
  'meta', jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'piso', (select piso_valor from public.cap_notas_config where id = 1),
    'titulos', (select count(*) from base),
    'valor', (select coalesce(round(sum(valor)::numeric, 2), 0) from base),
    'exigivel_titulos', (select count(*) from exigivel),
    'exigivel_valor',   (select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel),
    -- A cobertura, do jeito que se defende numa reunião: sobre o que EXIGE nota.
    'cobertura_valor', (
      select case when coalesce(sum(valor), 0) = 0 then null
             else round(100 * sum(valor) filter (where situacao = 'com_nota') / sum(valor), 1) end
      from exigivel
    ),
    'cobertura_titulos', (
      select case when count(*) = 0 then null
             else round(100.0 * count(*) filter (where situacao = 'com_nota') / count(*), 1) end
      from exigivel
    ),
    -- Quanto do universo ainda é "não sei". Enquanto isto não for zero, a
    -- cobertura acima é um piso, não o número.
    'nao_verificado_valor', (
      select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel where situacao = 'nao_verificado'
    ),
    'atualizado_em', (select max(lido_em) from public.omie_titulo_anexo)
  ),
  'situacoes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'situacao', situacao, 'titulos', n, 'valor', round(v::numeric, 2)
    ) order by v desc), '[]'::jsonb)
    from (select situacao, count(*) n, sum(valor) v from base group by 1) s
  ),
  'meses', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'valor_com_nota', round(vok::numeric, 2),
      'sem_nota', semn, 'valor_sem_nota', round(vsem::numeric, 2),
      'pronta', pronta, 'nao_verificado', nver
    ) order by mes), '[]'::jsonb)
    from (
      select to_char(date_trunc('month', competencia), 'YYYY-MM') as mes,
             count(*) n, sum(valor) v,
             count(*) filter (where situacao = 'com_nota') ok,
             coalesce(sum(valor) filter (where situacao = 'com_nota'), 0) vok,
             count(*) filter (where situacao = 'sem_nota') semn,
             coalesce(sum(valor) filter (where situacao = 'sem_nota'), 0) vsem,
             count(*) filter (where situacao = 'pronta_para_enviar') pronta,
             count(*) filter (where situacao = 'nao_verificado') nver
      from exigivel group by 1
    ) t
  ),
  'contas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'conta', conta, 'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'valor_com_nota', round(vok::numeric, 2),
      'nao_verificado', nver,
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end
    ) order by v desc), '[]'::jsonb)
    from (
      select conta, count(*) n, sum(valor) v,
             count(*) filter (where situacao = 'com_nota') ok,
             coalesce(sum(valor) filter (where situacao = 'com_nota'), 0) vok,
             count(*) filter (where situacao = 'nao_verificado') nver
      from exigivel group by 1
    ) t
  ),
  -- A pergunta "quais categorias menos têm nota", respondida por valor faltante:
  -- é o que diz onde vale a pena gastar a próxima hora de cobrança.
  'categorias', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoria', categoria, 'codigo', categoria_codigo,
      'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'sem_nota', semn, 'pronta', pronta, 'nao_verificado', nver,
      'valor_faltante', round(vfalta::numeric, 2),
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end
    ) order by vfalta desc, v desc), '[]'::jsonb)
    from (
      select categoria, categoria_codigo, count(*) n, sum(valor) v,
             count(*) filter (where situacao = 'com_nota') ok,
             coalesce(sum(valor) filter (where situacao = 'com_nota'), 0) vok,
             count(*) filter (where situacao = 'sem_nota') semn,
             count(*) filter (where situacao = 'pronta_para_enviar') pronta,
             count(*) filter (where situacao = 'nao_verificado') nver,
             coalesce(sum(valor) filter (where situacao <> 'com_nota'), 0) vfalta
      from exigivel group by 1, 2
    ) t
  ),
  -- Os fornecedores que mais devem nota. A cobrança é por CNPJ, não por título.
  'fornecedores', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'favorecido', favorecido, 'doc', doc, 'titulos', n,
      'valor_faltante', round(vfalta::numeric, 2)
    ) order by vfalta desc), '[]'::jsonb)
    from (
      select favorecido, doc, count(*) n, sum(valor) vfalta
      from exigivel where situacao in ('sem_nota', 'pronta_para_enviar')
      group by 1, 2 order by sum(valor) desc limit 25
    ) t
  )
);
$function$;

comment on function public.cap_notas_resumo(date, date) is
  'A cobertura de notas de fornecedor no ERP: totais, por mês, por conta e por categoria, mais quem mais deve nota. Denominador = só o que a régua diz que exige nota.';

/* ============================================================================
 *  A lista — o que falta, título a título
 * ========================================================================== */

create or replace function public.cap_notas_titulos(
  p_de date,
  p_ate date,
  p_situacoes text[] default null,
  p_categoria text default null,
  p_conta text default null,
  p_busca text default null,
  p_limite integer default 200,
  p_offset integer default 0
)
returns table(
  cod_titulo bigint, favorecido text, doc text, categoria text, categoria_codigo text,
  conta text, valor numeric, competencia date, vencimento date, pagamento date,
  situacao text, anexos_no_erp integer, nota_no_hub text, enviado_em timestamptz,
  nf_no_campo text, documento text, erro_leitura text, anexo_lido_em timestamptz,
  total_geral bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select * from public.cap_titulos
  where competencia between p_de and p_ate
    and (p_situacoes is null or situacao = any(p_situacoes))
    and (p_categoria is null or categoria_codigo = p_categoria)
    and (p_conta is null or conta_codigo = p_conta)
    and (
      p_busca is null or btrim(p_busca) = '' or
      favorecido ilike '%' || p_busca || '%' or
      doc like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%' or
      cod_titulo::text = btrim(p_busca)
    )
)
select b.cod_titulo, b.favorecido, b.doc, b.categoria, b.categoria_codigo,
       b.conta, b.valor, b.competencia, b.vencimento, b.pagamento,
       b.situacao, b.anexos_no_erp, b.nota_no_hub, b.enviado_em,
       b.nf_no_campo, b.documento, b.erro_leitura, b.anexo_lido_em,
       (select count(*) from base)
from base b
-- Maior valor primeiro: quem cobra nota começa pelo que dói.
order by b.valor desc, b.cod_titulo
limit greatest(coalesce(p_limite, 200), 1) offset greatest(coalesce(p_offset, 0), 0);
$function$;

comment on function public.cap_notas_titulos(date, date, text[], text, text, text, integer, integer) is
  'Os títulos do contas a pagar filtrados por situação/categoria/conta, do maior valor para o menor. total_geral repete em toda linha para a tela paginar sem uma segunda consulta.';

/* ============================================================================
 *  A fila da varredura — quais títulos a Edge Function deve ler no Omie
 * ========================================================================== */

create or replace function public.cap_anexos_fila(p_limite integer default 60)
returns table(cod_titulo bigint, valor numeric, competencia date, situacao text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with cfg as (select releitura_dias from public.cap_notas_config where id = 1)
select t.cod_titulo, t.valor, t.competencia, t.situacao
from public.cap_titulos t
where t.regra = 'exige'
  and (
    -- nunca lido
    t.anexo_lido_em is null
    -- leitura falhou: volta na próxima rodada
    or t.erro_leitura is not null
    -- não tinha anexo da última vez, e já faz tempo: pode ter ganhado um
    or (coalesce(t.anexos_no_erp, 0) = 0
        and t.anexo_lido_em < now() - make_interval(days => (select releitura_dias from cfg)))
  )
-- O que já foi pago e é recente primeiro: é o que alguém está cobrando agora.
-- Título com anexo confirmado nunca volta — anexo não desaparece sozinho.
order by (t.anexo_lido_em is not null), t.competencia desc nulls last, t.valor desc
limit greatest(coalesce(p_limite, 60), 1);
$function$;

comment on function public.cap_anexos_fila(integer) is
  'Títulos que exigem nota e cuja leitura de anexo no Omie está faltando ou velha. Consumida pela Edge Function omie-anexos-varredura.';

/* ============================================================================
 *  "Quase lá" — por que uma nota que existe não entrou na fila de envio
 * ==========================================================================
 * A fila de envio é CONJUNTIVA: precisa de comprovante E título casado E nenhum
 * carimbo de envio. Faltando uma, a linha some sem erro e sem aparecer em lugar
 * nenhum — foi assim que os 79 achados de junho ficaram inteiros de fora e
 * ninguém percebeu por dois meses. Esta função é o oposto disso: ela lista o que
 * está a UM passo de subir e diz qual é o passo. */

create or replace function public.auditoria_envio_quase_la(p_limite integer default 300)
returns table(
  origem text, ref_id text, rotulo text, competencia date, valor numeric,
  tem_comprovante boolean, tem_titulo boolean, ja_enviado boolean, falta text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with uni as (
  select 'auditoria'::text as origem, a.id::text as ref_id,
         coalesce(a.titulo, a.id_unico) as rotulo,
         a.competencia, a.valor,
         coalesce(a.link_comprovante, '') <> ''    as tem_comprovante,
         coalesce(a.omie_cod_titulo, '') <> ''     as tem_titulo,
         a.omie_anexo_enviado_em is not null       as ja_enviado,
         a.status
  from public.auditoria a
  union all
  select 'cartao', c.id::text,
         coalesce(nullif(c.estabelecimento, ''), c.descricao_original, c.id_unico),
         c.competencia, c.valor,
         coalesce(c.link_comprovante, '') <> '',
         coalesce(c.omie_cod_titulo, '') <> '',
         c.omie_anexo_enviado_em is not null,
         c.status_nf
  from public.auditoria_cartao_lancamentos c
  union all
  select 'facilities', f.id::text,
         coalesce(nullif(f.item, ''), f.fornecedor_nome, f.id::text),
         f.data, f.valor,
         coalesce(f.nf_arquivo, '') <> '',
         coalesce(f.omie_cod_titulo, '') <> '',
         f.omie_anexo_enviado_em is not null,
         f.nf_status
  from public.facilities_compras f
)
select u.origem, u.ref_id, u.rotulo, u.competencia, u.valor,
       u.tem_comprovante, u.tem_titulo, u.ja_enviado,
       case
         when u.ja_enviado                            then 'já está no Omie'
         when not u.tem_comprovante and not u.tem_titulo
              then 'falta a nota E o vínculo com o título do Omie'
         when not u.tem_comprovante                   then 'falta a nota (o título já está casado)'
         when not u.tem_titulo                        then 'a nota existe, mas o título do Omie não foi casado'
         when u.origem = 'auditoria' and coalesce(u.status, '') <> 'Aprovado'
              then 'a nota está aqui e o título casado — falta aprovar o achado (status: ' || coalesce(nullif(u.status, ''), 'sem status') || ')'
         else 'pronta para subir'
       end as falta
from uni u
where not u.ja_enviado
order by (case when u.tem_comprovante and u.tem_titulo then 0 else 1 end),
         u.valor desc nulls last
limit greatest(coalesce(p_limite, 300), 1);
$function$;

comment on function public.auditoria_envio_quase_la(integer) is
  'O que está a um passo de virar anexo no Omie, e qual é o passo. Existe porque a fila de envio é conjuntiva e some em silêncio quando falta uma das três condições.';

/* ---------------------------------------------------------------------------
 * Função nova nasce chamável por anon. Fechar uma a uma — REVOKE em bloco não
 * alcança a assinatura, e a função continuaria pública sem ninguém notar.
 * ------------------------------------------------------------------------- */
revoke all on function public.cap_notas_resumo(date, date) from anon;
revoke all on function public.cap_notas_titulos(date, date, text[], text, text, text, integer, integer) from anon;
revoke all on function public.cap_anexos_fila(integer) from anon;
revoke all on function public.auditoria_envio_quase_la(integer) from anon;

grant execute on function public.cap_notas_resumo(date, date) to authenticated;
grant execute on function public.cap_notas_titulos(date, date, text[], text, text, text, integer, integer) to authenticated;
grant execute on function public.auditoria_envio_quase_la(integer) to authenticated;
