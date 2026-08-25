-- O lojista do cartão, e por que o cartão sai da lista de fornecedores.
--
-- Com o favorecido resolvido contra o cadastro do Omie, a aba "Quem deve nota"
-- ficou legível — e imediatamente mostrou que estava errada: a primeira linha
-- era "Lancamento Fatura Cartao" com 519 títulos e R$ 836.973 faltando,
-- engolindo todos os fornecedores de verdade que vinham abaixo.
--
-- Aquilo não é uma contraparte: é o balde onde a fatura inteira entra no ERP. A
-- nota de cada uma daquelas linhas se cobra de QUEM GASTOU, na auditoria do
-- cartão, e não de um CNPJ. Misturar as duas coisas numa lista só faz a lista
-- não servir para nenhuma das duas.
--
-- Duas mudanças, então:
--
--   1. `cap_notas_titulos` passa a devolver a OBSERVAÇÃO crua do título. É lá
--      que mora o lojista do cartão, colado depois de um "|" e com as MESMAS
--      colunas posicionais do OFX. Ler esse texto AQUI seria escrever o segundo
--      parser de MEMO do repositório — e o cabeçalho de src/lib/observacaoTitulo.ts
--      já explica por que não: a tela de Notas e a do Cartão passariam a
--      discordar sobre o nome do mesmo lojista. Quem lê é o front, com o parser
--      único, e depois passa o resultado pelo mesmo mapa de apelidos.
--
--   2. O cartão sai da lista de fornecedores do resumo e vira um número próprio
--      no cabeçalho. Continua inteiro no denominador da cobertura — que é o que
--      responde "está tudo no ERP?"; o que muda é só onde ele aparece.

/* ============================================================================
 *  1. A observação junto — e a busca varrendo ela também
 * ========================================================================== */

-- Mudou o tipo de retorno (colunas novas), e o Postgres exige DROP antes de um
-- `create or replace` que mexe nas colunas de saída.
drop function if exists public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer);

create function public.cap_notas_titulos(
  p_de date, p_ate date,
  p_situacoes text[] default null,
  p_categoria text default null,
  p_conta text default null,
  p_busca text default null,
  p_gravidades text[] default null,
  p_limite integer default 200,
  p_offset integer default 0
)
returns table(
  cod_titulo bigint, favorecido text, favorecido_cru text, tem_apelido boolean,
  observacao text, doc text, categoria text, categoria_codigo text,
  conta text, valor numeric, competencia date, vencimento date, pagamento date,
  situacao text, gravidade text, anexos_no_erp integer, anexos jsonb,
  anexo_classe text, anexo_revisao text,
  nota_no_hub text, enviado_em timestamptz,
  nf_no_campo text, documento text, erro_leitura text, anexo_lido_em timestamptz,
  total_geral bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select t.*, tx.observacao
  from public.cap_titulos t
  left join public.omie_titulo_texto tx on tx.cod_titulo = t.cod_titulo
  where t.competencia between p_de and p_ate
    and (p_situacoes is null or t.situacao = any(p_situacoes))
    and (p_gravidades is null or t.gravidade = any(p_gravidades))
    and (p_categoria is null or t.categoria_codigo = p_categoria)
    and (p_conta is null or t.conta_codigo = p_conta)
    and (
      p_busca is null or btrim(p_busca) = '' or
      t.favorecido ilike '%' || p_busca || '%' or
      t.favorecido_cru ilike '%' || p_busca || '%' or
      -- A busca varre a observação também: é onde mora o nome do lojista do
      -- cartão, e sem isso procurar "Hubspot" não acharia a linha que a tela
      -- está mostrando como Hubspot. (Convenção do repo: o que a tela escreve na
      -- linha tem de estar no texto que o filtro varre.)
      coalesce(tx.observacao, '') ilike '%' || p_busca || '%' or
      t.doc like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%' or
      t.cod_titulo::text = btrim(p_busca)
    )
)
select b.cod_titulo, b.favorecido, b.favorecido_cru, b.tem_apelido,
       b.observacao, b.doc, b.categoria, b.categoria_codigo,
       b.conta, b.valor, b.competencia, b.vencimento, b.pagamento,
       b.situacao, b.gravidade, b.anexos_no_erp, b.anexos,
       b.anexo_classe, b.anexo_revisao,
       b.nota_no_hub, b.enviado_em,
       b.nf_no_campo, b.documento, b.erro_leitura, b.anexo_lido_em,
       (select count(*) from base)
from base b
-- Maior valor primeiro: quem cobra nota começa pelo que dói.
order by b.valor desc, b.cod_titulo
limit greatest(coalesce(p_limite, 200), 1) offset greatest(coalesce(p_offset, 0), 0);
$function$;

comment on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer) is
  'Os títulos filtrados, com o favorecido já apelidado e a OBSERVAÇÃO crua junto. O lojista do cartão sai da observação no front, pelo parser único de src/lib/observacaoTitulo.ts.';

/* ============================================================================
 *  2. O cartão fora da lista de fornecedores
 * ========================================================================== */

create or replace function public.eh_cartao(p_contraparte text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
-- Gêmea de `ehCartao` em src/lib/observacaoTitulo.ts. A fatura entra no ERP com
-- uma contraparte-carimbo ("Lancamento Fatura Cartao", "Lancamento cartão itau")
-- e é pelo nome mesmo que dá para reconhecer: não existe campo no movimento
-- dizendo "isto é cartão".
select lower(unaccent(coalesce(p_contraparte, ''))) ~ 'cartao'
   and lower(unaccent(coalesce(p_contraparte, ''))) ~ '(lancamento|fatura)';
$function$;

comment on function public.eh_cartao(text) is
  'A contraparte é o carimbo da fatura de cartão? Gêmea de ehCartao em src/lib/observacaoTitulo.ts.';

create or replace function public.cap_notas_resumo(p_de date, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select * from public.cap_titulos where competencia between p_de and p_ate
),
exigivel as (select * from base where situacao not in ('dispensa', 'conferir')),
falta as (select * from exigivel where situacao in ('sem_nota', 'pronta_para_enviar', 'anexo_suspeito')),
-- O cartão anda por outro caminho: quem cobra é a auditoria do cartão, do
-- responsável pelo gasto, e não um e-mail para um CNPJ.
falta_cartao as (select * from falta where public.eh_cartao(favorecido_cru)),
falta_fornecedor as (select * from falta where not public.eh_cartao(favorecido_cru))
select jsonb_build_object(
  'meta', jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'limiares', (select jsonb_build_object('medio', limiar_medio, 'grave', limiar_grave, 'urgente', limiar_urgente)
                 from public.cap_notas_config where id = 1),
    'titulos', (select count(*) from base),
    'valor', (select coalesce(round(sum(valor)::numeric, 2), 0) from base),
    'exigivel_titulos', (select count(*) from exigivel),
    'exigivel_valor',   (select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel),
    'cobertura_valor', (
      select case when coalesce(sum(valor), 0) = 0 then null
             else round(100 * sum(valor) filter (where situacao = 'com_nota') / sum(valor), 1) end
      from exigivel),
    'cobertura_titulos', (
      select case when count(*) = 0 then null
             else round(100.0 * count(*) filter (where situacao = 'com_nota') / count(*), 1) end
      from exigivel),
    'nao_verificado_valor', (
      select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel where situacao = 'nao_verificado'),
    'a_revisar', (select count(*) from exigivel where situacao = 'anexo_suspeito'),
    -- Quanto do que falta é cartão: não some da conta, só sai da lista de CNPJs.
    'cartao_titulos', (select count(*) from falta_cartao),
    'cartao_valor',   (select coalesce(round(sum(valor)::numeric, 2), 0) from falta_cartao),
    'atualizado_em', (select max(lido_em) from public.omie_titulo_anexo)
  ),
  'gravidade', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'gravidade', gravidade, 'titulos', n, 'valor', round(v::numeric, 2)
    ) order by ordem), '[]'::jsonb)
    from (
      select gravidade, count(*) n, sum(valor) v,
             case gravidade when 'urgente' then 1 when 'grave' then 2 when 'medio' then 3 else 4 end as ordem
      from falta group by gravidade
    ) t
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
             count(*) filter (where situacao in ('sem_nota', 'anexo_suspeito')) semn,
             coalesce(sum(valor) filter (where situacao in ('sem_nota', 'anexo_suspeito')), 0) vsem,
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
  'categorias', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoria', categoria, 'codigo', categoria_codigo,
      'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'sem_nota', semn, 'pronta', pronta, 'nao_verificado', nver,
      'urgentes', urg,
      'valor_faltante', round(vfalta::numeric, 2),
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end
    ) order by vfalta desc, v desc), '[]'::jsonb)
    from (
      select categoria, categoria_codigo, count(*) n, sum(valor) v,
             count(*) filter (where situacao = 'com_nota') ok,
             coalesce(sum(valor) filter (where situacao = 'com_nota'), 0) vok,
             count(*) filter (where situacao in ('sem_nota', 'anexo_suspeito')) semn,
             count(*) filter (where situacao = 'pronta_para_enviar') pronta,
             count(*) filter (where situacao = 'nao_verificado') nver,
             count(*) filter (where situacao <> 'com_nota' and gravidade = 'urgente') urg,
             coalesce(sum(valor) filter (where situacao <> 'com_nota'), 0) vfalta
      from exigivel group by 1, 2
    ) t
  ),
  'fornecedores', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'favorecido', favorecido, 'doc', doc, 'titulos', n,
      'urgentes', urg, 'valor_faltante', round(vfalta::numeric, 2)
    ) order by vfalta desc), '[]'::jsonb)
    from (
      select favorecido, nullif(doc, '') as doc, count(*) n, sum(valor) vfalta,
             count(*) filter (where gravidade = 'urgente') urg
      from falta_fornecedor group by 1, 2 order by sum(valor) desc limit 25
    ) t
  )
);
$function$;

revoke all on function public.eh_cartao(text) from anon;
revoke all on function public.cap_notas_resumo(date, date) from anon;
revoke all on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer) from anon;
grant execute on function public.cap_notas_resumo(date, date) to authenticated;
grant execute on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer) to authenticated;
