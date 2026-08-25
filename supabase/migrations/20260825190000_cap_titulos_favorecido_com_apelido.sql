-- O favorecido na tela: nome do Omie, e o apelido da Parametrização por cima.
--
-- O QUE ESTAVA ERRADO. `cap_titulos.favorecido` vinha só de
-- `omie_titulo_texto.favorecido`, que é lido título a título via
-- ConsultarContaPagar — uma chamada por título, alimentada por um cron que
-- priorizou o cartão. Resultado na tela: uma coluna inteira de "—" com o CNPJ
-- embaixo, que é justamente o que a Parametrização existe para não acontecer.
--
-- O nome estava ali o tempo todo, a uma junção de distância: o movimento carrega
-- `nCodCliente` e o cadastro espelhado (`omie_cache.clientes`, 6.999 linhas) tem
-- o nome. Medido: 4.920 dos 4.921 títulos do contas a pagar resolvem por esse
-- caminho. O `omie_titulo_texto` continua tendo precedência quando existe — ele
-- traz o favorecido COMO ESCRITO NO TÍTULO, que é mais específico que o cadastro.
--
-- O CNPJ TAMBÉM MELHORA. 2.992 movimentos vêm sem `cCPFCNPJCliente`; onde o
-- cadastro tem o documento, ele passa a valer. Isso não é cosmético: a aba "Quem
-- deve nota" agrupa por CNPJ, e sem documento cada título virava uma linha só.
--
-- A ORDEM DO APELIDO é a mesma de `apelidoDe` em src/lib/apelidos.ts:
-- DOCUMENTO primeiro (identidade de verdade), NOME depois (o que sobra quando
-- não há CNPJ). A busca por nome usa `contraparte_chave`, gêmea de `chavePessoa`
-- — mesma normalização, mesmo descarte de sufixo societário.
--
-- O nome CRU continua na linha de apoio, na tela: é ele que se procura no Omie.
--
-- DESEMPENHO. A primeira versão casava o apelido num `left join lateral` sobre a
-- view `contraparte_apelido`, e o planejador a reavaliava a cada uma das 4.921
-- linhas — a consulta estourou o tempo. Aqui são dois CTEs materializados (um
-- por documento, um por chave de nome) e duas junções por hash, com a chave do
-- nome calculada UMA vez dentro do `alvo`.
--
-- O QUE ESTA MIGRATION NÃO RESOLVE, de propósito: o lojista do cartão. No contas
-- a pagar todo gasto de cartão entra como "Lancamento Fatura Cartao" e o nome
-- real está na OBSERVAÇÃO, com as mesmas colunas posicionais do OFX. Quem lê
-- aquilo é o parser único do repo (src/lib/observacaoTitulo.ts), no front —
-- escrever um segundo em SQL faria esta tela e a do Cartão discordarem sobre o
-- nome do mesmo lojista.

/* ============================================================================
 *  A chave de casamento por nome — gêmea de chavePessoa (src/lib/pessoasPJ.ts)
 * ========================================================================== */

create or replace function public.contraparte_chave(p_nome text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
with sem_cnpj as (
  -- O CNPJ sai ANTES de normalizar, enquanto ainda tem os pontos e a barra que
  -- identificam o formato; depois seria só um punhado de dígitos no meio do nome.
  select regexp_replace(coalesce(p_nome, ''), '\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}', ' ', 'g') as t
),
normalizado as (
  -- Mesmo `normalize()` do repo: sem acento, maiúsculas, só A-Z0-9 e espaço.
  select btrim(regexp_replace(
           regexp_replace(upper(unaccent(t)), '[^A-Z0-9 ]', ' ', 'g'),
           '\s+', ' ', 'g')) as t
  from sem_cnpj
)
-- O sufixo societário vem empilhado ("FULANO SERVICOS LTDA ME"), então sai em
-- passadas. Quatro cobrem tudo que aparece no cadastro.
select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
         t, '\s+(SOCIEDADE INDIVIDUAL DE ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S A|SA|EI)$', ''),
            '\s+(SOCIEDADE INDIVIDUAL DE ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S A|SA|EI)$', ''),
            '\s+(SOCIEDADE INDIVIDUAL DE ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S A|SA|EI)$', ''),
            '\s+(SOCIEDADE INDIVIDUAL DE ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S A|SA|EI)$', ''))
from normalizado;
$function$;

comment on function public.contraparte_chave(text) is
  'Chave de casamento por nome, gêmea de chavePessoa em src/lib/pessoasPJ.ts: sem CNPJ colado, sem acento, sem pontuação e sem sufixo societário.';

/* ============================================================================
 *  O cadastro de apelidos, achatado por documento e por chave de nome
 * ========================================================================== */

create or replace view public.contraparte_apelido as
with base as (
  select f.id, f.nome, nullif(btrim(f.apelido), '') as apelido, f.documento_norm
  from public.lib_fornecedores f
),
-- Por documento: o do próprio cadastro E o das grafias aprendidas.
por_doc as (
  select documento_norm as doc, apelido, nome
  from base where documento_norm is not null and length(documento_norm) >= 11
  union
  select a.documento_norm, b.apelido, b.nome
  from public.contrapartes_alias a
  join base b on b.id = a.fornecedor_id
  where a.documento_norm is not null and length(a.documento_norm) >= 11
),
-- Por nome: a grafia canônica e todas as alternativas conhecidas.
por_nome as (
  select public.contraparte_chave(nome) as chave, apelido, nome from base
  union
  select public.contraparte_chave(a.alias), b.apelido, b.nome
  from public.contrapartes_alias a
  join base b on b.id = a.fornecedor_id
)
select 'doc'::text as via, doc as chave, apelido, nome from por_doc
union all
-- MIN_CHAVE = 4: chave curta ("ME", "DL") casaria com meio mundo. O piso é o
-- mesmo do CHECK da tabela e da constante do TypeScript.
select 'nome', chave, apelido, nome from por_nome where length(chave) >= 4;

comment on view public.contraparte_apelido is
  'O cadastro da Parametrização achatado: uma linha por documento e por grafia conhecida. Gêmea do mapa que montarMapaApelidos monta no navegador.';

revoke all on public.contraparte_apelido from anon, authenticated;

/* ============================================================================
 *  A view, agora com o favorecido resolvido
 * ========================================================================== */

drop view if exists public.cap_titulos;

create view public.cap_titulos as
with mov as (
  select distinct on ((d->'detalhes'->>'nCodTitulo')::bigint)
         (d->'detalhes'->>'nCodTitulo')::bigint                        as cod_titulo,
         nullif(d->'detalhes'->>'cCodCateg', '')                       as categoria_codigo,
         nullif(d->'detalhes'->>'nCodCC', '')                          as conta_codigo,
         (d->'detalhes'->>'nValorTitulo')::numeric                     as valor,
         to_date(nullif(d->'detalhes'->>'dDtEmissao', ''), 'DD/MM/YYYY')   as emissao,
         to_date(nullif(d->'detalhes'->>'dDtVenc', ''), 'DD/MM/YYYY')      as vencimento,
         to_date(nullif(d->'detalhes'->>'dDtPagamento', ''), 'DD/MM/YYYY') as pagamento,
         nullif(d->'detalhes'->>'cStatus', '')                         as status,
         regexp_replace(coalesce(d->'detalhes'->>'cCPFCNPJCliente', ''), '\D', '', 'g') as doc_mov,
         nullif(d->'detalhes'->>'nCodCliente', '')                     as cod_cliente,
         nullif(d->'detalhes'->>'cNumParcela', '')                     as parcela
  from public.omie_cache, jsonb_array_elements(dados) d
  where chave = 'movimentos'
    and d->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
  order by (d->'detalhes'->>'nCodTitulo')::bigint
),
-- O cadastro do Omie: é ele que tem o nome de 4.920 dos 4.921 títulos.
cadastro as materialized (
  select (c->>'codigo')                                                as codigo,
         regexp_replace(coalesce(c->>'cnpj_cpf', ''), '\D', '', 'g')   as doc,
         nullif(btrim(c->>'nome'), '')                                 as nome
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
),
cadastro_doc as materialized (
  select doc, min(nome) as nome from cadastro where doc <> '' group by doc
),
-- O cadastro da Parametrização, achatado UMA vez. Documento e nome viram dois
-- índices separados: o documento é prova, o nome é indício, e a precedência
-- entre eles é a mesma de `apelidoDe` no TypeScript.
ape_doc as materialized (
  select chave, min(apelido) as apelido
  from public.contraparte_apelido where via = 'doc' and apelido is not null
  group by chave
),
ape_nome as materialized (
  select chave, min(apelido) as apelido
  from public.contraparte_apelido where via = 'nome' and apelido is not null
  group by chave
),
nota_no_hub as (
  select omie_cod_titulo::bigint as cod_titulo, 'auditoria'::text as fonte
    from public.auditoria
   where omie_cod_titulo ~ '^\d+$' and coalesce(link_comprovante, '') <> ''
  union
  select omie_cod_titulo::bigint, 'cartao'
    from public.auditoria_cartao_lancamentos
   where omie_cod_titulo ~ '^\d+$' and coalesce(link_comprovante, '') <> ''
  union
  select cod_titulo::bigint, 'drive'
    from public.comprovantes_drive
   where cod_titulo ~ '^\d+$'
  union
  select omie_cod_titulo::bigint, 'facilities'
    from public.facilities_compras
   where omie_cod_titulo ~ '^\d+$' and coalesce(nf_arquivo, '') <> ''
),
hub as (
  select cod_titulo, string_agg(distinct fonte, '+' order by fonte) as fontes
  from nota_no_hub group by cod_titulo
),
enviado as (
  select omie_cod_titulo::bigint as cod_titulo, max(omie_anexo_enviado_em) as em
    from public.auditoria
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null group by 1
  union all
  select omie_cod_titulo::bigint, max(omie_anexo_enviado_em)
    from public.auditoria_cartao_lancamentos
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null group by 1
  union all
  select omie_cod_titulo::bigint, max(omie_anexo_enviado_em)
    from public.facilities_compras
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null group by 1
),
enviado_por_titulo as (
  select cod_titulo, max(em) as enviado_em from enviado group by cod_titulo
),
cfg as (select limiar_medio, limiar_grave, limiar_urgente from public.cap_notas_config where id = 1),
alvo as materialized (
  select m.*,
         coalesce(nullif(m.doc_mov, ''), cad.doc) as doc,
         -- O favorecido ESCRITO NO TÍTULO vence o cadastro (é mais específico);
         -- o cadastro por código vence o cadastro por documento.
         coalesce(nullif(btrim(t.favorecido), ''), cad.nome, cadd.nome) as nome_cru,
         -- Calculada UMA vez aqui, não dentro da junção: é o que permite o hash.
         public.contraparte_chave(coalesce(nullif(btrim(t.favorecido), ''), cad.nome, cadd.nome)) as chave_nome
  from mov m
  left join cadastro cad      on cad.codigo = m.cod_cliente
  left join cadastro_doc cadd on cadd.doc   = nullif(m.doc_mov, '')
  left join public.omie_titulo_texto t on t.cod_titulo = m.cod_titulo
)
select
  a.cod_titulo,
  a.categoria_codigo,
  coalesce(r.descricao, a.categoria_codigo, '(sem categoria)') as categoria,
  coalesce(r.regra, 'exige')                                   as regra,
  a.conta_codigo,
  coalesce(cc.nome, 'conta ' || coalesce(a.conta_codigo, '?')) as conta,
  a.valor,
  a.emissao,
  a.vencimento,
  a.pagamento,
  coalesce(a.pagamento, a.vencimento, a.emissao)               as competencia,
  a.status,
  a.doc,
  a.parcela,
  a.cod_cliente,
  -- Documento primeiro, nome depois: casar por nome quando há CNPJ seria trocar
  -- prova por indício.
  coalesce(ad.apelido, an2.apelido, a.nome_cru, '—')           as favorecido,
  coalesce(a.nome_cru, '—')                                    as favorecido_cru,
  (coalesce(ad.apelido, an2.apelido) is not null)              as tem_apelido,
  nullif(btrim(t2.nota_fiscal), '')                            as nf_no_campo,
  nullif(btrim(t2.documento), '')                              as documento,
  an.qtd                                                       as anexos_no_erp,
  an.anexos                                                    as anexos,
  an.classe                                                    as anexo_classe,
  an.revisao                                                   as anexo_revisao,
  an.erro                                                      as erro_leitura,
  an.lido_em                                                   as anexo_lido_em,
  h.fontes                                                     as nota_no_hub,
  e.enviado_em,
  case
    when a.valor >= (select limiar_urgente from cfg) then 'urgente'
    when a.valor >= (select limiar_grave   from cfg) then 'grave'
    when a.valor >= (select limiar_medio   from cfg) then 'medio'
    else 'irrelevante'
  end                                                          as gravidade,
  case
    when coalesce(r.regra, 'exige') = 'dispensa' then 'dispensa'
    when coalesce(r.regra, 'exige') = 'conferir' then 'conferir'
    when coalesce(an.qtd, 0) > 0 and an.revisao = 'nao_e_nota'         then 'sem_nota'
    when coalesce(an.qtd, 0) > 0 and an.revisao = 'nota'               then 'com_nota'
    when coalesce(an.qtd, 0) > 0 and an.classe = 'duvidoso'            then 'anexo_suspeito'
    when coalesce(an.qtd, 0) > 0                                      then 'com_nota'
    when an.erro is not null                                          then 'erro_leitura'
    when an.cod_titulo is null                                        then 'nao_verificado'
    when h.fontes is not null                                         then 'pronta_para_enviar'
    else 'sem_nota'
  end                                                          as situacao
from alvo a
left join public.omie_categoria_regra r  on r.codigo      = a.categoria_codigo
left join public.omie_caixa_conta cc     on cc.ncodcc     = a.conta_codigo
left join public.omie_titulo_anexo an    on an.cod_titulo = a.cod_titulo
left join public.omie_titulo_texto t2    on t2.cod_titulo = a.cod_titulo
left join hub h                          on h.cod_titulo  = a.cod_titulo
left join enviado_por_titulo e           on e.cod_titulo  = a.cod_titulo
left join ape_doc  ad  on a.doc is not null and a.doc <> '' and ad.chave = a.doc
left join ape_nome an2 on length(a.chave_nome) >= 4 and an2.chave = a.chave_nome;

comment on view public.cap_titulos is
  'Um título do contas a pagar do Omie por linha: régua da categoria, anexo no ERP, arquivo no Hub, gravidade da cobrança e o favorecido já com o apelido da Parametrização. Leitura só via RPC security definer — omie_cache não é legível pelo usuário.';

revoke all on public.cap_titulos from anon, authenticated;
revoke all on function public.contraparte_chave(text) from anon;
