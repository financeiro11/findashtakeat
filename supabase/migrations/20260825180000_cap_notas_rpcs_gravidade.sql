-- As consultas da tela passam a falar em gravidade e em anexo a conferir.
--
-- Três mudanças de contrato, e as três vêm de decisão de negócio de 25/08/2026:
--
--   • `meta.piso` saiu, `meta.limiares` entrou. O piso dispensava; a gravidade
--     ordena. Quem lê a tela precisa saber ONDE ficam os cortes, e eles moram no
--     banco — a legenda "acima de R$ 1.000" é montada a partir daqui, não escrita
--     à mão no componente.
--
--   • `gravidade` é um bloco novo do resumo: quanto de nota faltante cai em cada
--     faixa. É o que responde "por onde começo a cobrar" — e o número justifica
--     a pergunta: 180 títulos urgentes concentram R$ 1,21 mi dos R$ 1,30 mi que
--     faltam, enquanto 253 irrelevantes somam R$ 12 mil.
--
--   • `anexo_suspeito` entra como situação de verdade. Título com arquivo cujo
--     nome não identifica documento nenhum NÃO conta como coberto até alguém
--     abrir e dizer o que é. Contar como verde seria a mesma armadilha do
--     `nf_undefined_correta.pdf`: cobertura boa em cima de arquivo que ninguém
--     sabe o que é.
--
-- E `cap_notas_titulos` ganhou `p_gravidades` NO MEIO da assinatura. A versão
-- antiga é derrubada explicitamente no fim: `create or replace` deixaria as duas
-- vivas como overload, e a tela chamaria a que o PostgREST resolvesse primeiro.
-- (Ver migrations-nao-batem-com-o-banco.)

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
falta as (select * from exigivel where situacao in ('sem_nota', 'pronta_para_enviar', 'anexo_suspeito'))
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
      select favorecido, doc, count(*) n, sum(valor) vfalta,
             count(*) filter (where gravidade = 'urgente') urg
      from falta group by 1, 2 order by sum(valor) desc limit 25
    ) t
  )
);
$function$;

create or replace function public.cap_notas_titulos(
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
  cod_titulo bigint, favorecido text, doc text, categoria text, categoria_codigo text,
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
  select * from public.cap_titulos
  where competencia between p_de and p_ate
    and (p_situacoes is null or situacao = any(p_situacoes))
    and (p_gravidades is null or gravidade = any(p_gravidades))
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

-- A assinatura antiga (sem p_gravidades) ficaria viva em paralelo como overload
-- e a tela chamaria a errada, sem erro nenhum para denunciar.
drop function if exists public.cap_notas_titulos(date, date, text[], text, text, text, integer, integer);

revoke all on function public.cap_notas_resumo(date, date) from anon;
revoke all on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer) from anon;
grant execute on function public.cap_notas_resumo(date, date) to authenticated;
grant execute on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer) to authenticated;
