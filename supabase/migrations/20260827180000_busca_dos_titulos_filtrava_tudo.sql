-- A busca da aba Títulos trazia a tabela inteira.
--
-- Digitar "hubspot" devolvia Flash App, Baptista Luz e NAYARA no topo, com as
-- linhas do HubSpot escondidas no meio. Não era ordenação: era o filtro não
-- filtrando.
--
-- A CAUSA, numa linha:
--
--     t.doc like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'
--
-- `regexp_replace('hubspot', '\D', '', 'g')` devolve **string vazia**, e
-- `doc like '%%'` é verdadeiro para todo título que tem CNPJ. O ramo do CNPJ,
-- que existe para achar por documento, passou a aceitar tudo sempre que a
-- busca não tinha número — ou seja, em quase toda busca.
--
-- É o modo de falhar mais caro que existe numa tela de conferência: o filtro
-- não devolve erro, devolve MAIS. Quem procura acha o que procurava (ele está
-- lá, no meio) e não tem por que desconfiar do resto.
--
-- Piso de 4 dígitos para o ramo do CNPJ: com menos, "99" casaria o documento de
-- meio mundo. Busca por número de título continua exata, noutro ramo.
--
-- O resto da função é a definição em produção, lida com `pg_get_functiondef` —
-- as migrations deste repo já divergiram do que está aplicado, e recriar a
-- partir do arquivo antigo desfaria o que veio depois.

create or replace function public.cap_notas_titulos(p_de date, p_ate date, p_situacoes text[] DEFAULT NULL::text[], p_categoria text DEFAULT NULL::text, p_conta text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_gravidades text[] DEFAULT NULL::text[], p_limite integer DEFAULT 200, p_offset integer DEFAULT 0, p_categorias text[] DEFAULT NULL::text[], p_contas text[] DEFAULT NULL::text[], p_valor_min numeric DEFAULT NULL::numeric, p_valor_max numeric DEFAULT NULL::numeric, p_mes_de text DEFAULT NULL::text, p_mes_ate text DEFAULT NULL::text)
returns TABLE(cod_titulo bigint, favorecido text, favorecido_cru text, tem_apelido boolean, observacao text, doc text, categoria text, categoria_codigo text, conta text, valor numeric, competencia date, vencimento date, pagamento date, situacao text, gravidade text, anexos_no_erp integer, anexos jsonb, anexo_classe text, anexo_revisao text, nota_no_hub text, enviado_em timestamp with time zone, nf_no_campo text, documento text, erro_leitura text, anexo_lido_em timestamp with time zone, total_geral bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$

with base as (
  select t.*, tx.observacao
  from public.cap_titulos t
  left join public.omie_titulo_texto tx on tx.cod_titulo = t.cod_titulo
  where t.competencia between p_de and p_ate
    and (p_situacoes is null or t.situacao = any(p_situacoes))
    and (p_gravidades is null or t.gravidade = any(p_gravidades))
    and (p_categoria is null or t.categoria_codigo = p_categoria)
    and (p_conta is null or t.conta_codigo = p_conta)
    -- Os cortes de coluna. `coalesce(..., '')` porque "sem categoria" e "sem
    -- conta" existem na base e precisam ser marcáveis como qualquer outra opção.
    and (p_categorias is null or coalesce(t.categoria_codigo, '') = any(p_categorias))
    and (p_contas     is null or coalesce(t.conta_codigo, '')     = any(p_contas))
    and (p_valor_min  is null or t.valor >= p_valor_min)
    and (p_valor_max  is null or t.valor <= p_valor_max)
    -- Recorte de mês DENTRO do período do cabeçalho. Título sem competência não
    -- entra num corte por mês: não há mês para ele cair.
    and (p_mes_de  is null or (t.competencia is not null
                               and to_char(t.competencia, 'YYYY-MM') >= p_mes_de))
    and (p_mes_ate is null or (t.competencia is not null
                               and to_char(t.competencia, 'YYYY-MM') <= p_mes_ate))
    and (
      p_busca is null or btrim(p_busca) = '' or
      t.favorecido ilike '%' || p_busca || '%' or
      t.favorecido_cru ilike '%' || p_busca || '%' or
      coalesce(tx.observacao, '') ilike '%' || p_busca || '%' or
      /* O CNPJ SÓ ENTRA QUANDO A BUSCA TEM NÚMERO.
         `regexp_replace('hubspot', '\D', '', 'g')` devolve STRING VAZIA, e
         `doc like '%%'` é verdadeiro para todo título com CNPJ — então buscar
         qualquer palavra trazia a tabela inteira, com as linhas certas
         escondidas no meio. Quatro dígitos é o piso: com menos, "99" casaria o
         CNPJ de meio mundo. */
      (length(regexp_replace(p_busca, '\D', '', 'g')) >= 4
        and t.doc like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%') or
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
$fn$;

revoke all on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer, text[], text[], numeric, numeric, text, text) from public, anon;
grant execute on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer, text[], text[], numeric, numeric, text, text) to authenticated, service_role;
