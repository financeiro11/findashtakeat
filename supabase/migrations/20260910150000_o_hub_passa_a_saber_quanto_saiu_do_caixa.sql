-- O Hub passa a saber QUANTO SAIU DO CAIXA, e não só quanto o título valia.
--
-- O QUE ESTAVA ERRADO. `cap_titulos.valor` é o Valor da Conta do título
-- (`detalhes.nValorTitulo`). O relatório de Contas a Pagar do Omie não soma isso:
-- ele soma o Valor Pago, que é o Valor da Conta MAIS juros e multa MENOS desconto.
-- Quem somava `valor` para dizer "saiu tanto do caixa" errava sempre que houve
-- encargo ou desconto. Medido em 09/09/2026, o desvio ia nos dois sentidos e
-- chegou a 0,37% do mês (mai/26: R$ 5.080,10 de desconto não capturado).
--
-- POR QUE NÃO É UM `alter table`. `cap_titulos` é uma VIEW (relkind='v') sobre
-- `omie_cache`, chave 'movimentos', filtrando `cGrupo = 'CONTA_A_PAGAR'`. Não há
-- writer, não há backfill: ela recalcula a cada leitura. Acrescentar coluna aqui
-- é `create or replace view` — e por isso as novas entram todas NO FIM da lista,
-- que é a única forma que o `replace` aceita sem derrubar os consumidores.
--
-- DE ONDE VÊM OS NÚMEROS. Do objeto `resumo`, que `listarMovimentos` já gravava no
-- cache desde sempre (`_shared/omie.ts` empurra o movimento inteiro) e que esta
-- view simplesmente nunca leu — só olhava `detalhes`. Nenhuma chamada nova ao
-- Omie, nenhum `ConsultarContaPagar`, nenhum crédito gasto.
--
-- A ARMADILHA DO NOME, medida contra a API real em 09/09/2026 no título
-- 5517043182 (Café - Sede, pago em 08/09/2026):
--
--     "resumo": { "nJuros": 35.41, "nMulta": 0, "nValPago": 690,
--                 "nDesconto": 0, "cLiquidado": "S",
--                 "nValAberto": 0, "nValLiquido": 725.41 }
--
-- `nValPago` vale 690,00 — é o PRINCIPAL amortizado, igual ao valor da conta. Quem
-- saiu do caixa foram 725,41, e isso é `nValLiquido`. Mapear `valor_pago` pelo
-- campo de nome parecido devolveria uma coluna idêntica a `valor`, com um nome
-- prometendo o contrário e a soma errando calada. Por isso, aqui:
--
--     valor_principal_pago  <- resumo.nValPago      (o principal, não é a saída)
--     juros_multa           <- resumo.nJuros + nMulta
--     desconto              <- resumo.nDesconto
--     valor_pago            <- resumo.nValLiquido   ** É ESTA QUE SE SOMA **
--     liquidado             <- resumo.cLiquidado = 'S'
--
-- A identidade `nValLiquido = nValPago + nJuros + nMulta - nDesconto` foi conferida
-- linha a linha em todos os 4.458 títulos pagos da base: zero exceções.
--
-- POR QUE `liquidado` TAMBÉM ENTRA. O relatório do Omie não conta como pago o
-- título com baixa parcial, e `cStatus = 'PAGO'` sozinho não distingue. Em toda a
-- base isso é UM título — o 5471444771 (pago 11/05/2026, conta R$ 3.000,00,
-- desconto R$ 184,50, líquido R$ 2.815,50, `nValAberto` NEGATIVO em -75) — e ele é
-- a diferença inteira de maio: 1.547.339,01 - 2.815,50 = 1.544.523,51, que é o
-- total do relatório. Sem esta coluna o consumidor não tem como reproduzir o corte.
-- Cuidado ao usá-la sozinha: os 2 títulos CANCELADOS também vêm com cLiquidado='S'.
-- O filtro do relatório é `status = 'PAGO' and liquidado`.
--
-- NULO x ZERO. `resumo` vem em 100% dos movimentos, então `valor_pago` nunca nasce
-- nulo — a regra de "não sei" não chega a disparar. Título ainda não pago traz
-- `nValLiquido = 0`, que aqui significa "nada saiu ainda", não "não sei"; se algum
-- dia o Omie omitir o campo, o `->>` devolve nulo sozinho e ninguém copia `valor`
-- para dentro de `valor_pago`.
--
-- `valor` NÃO MUDA. Nenhuma coluna existente muda de nome, tipo, ordem ou
-- significado; `cap_notas_*` e os painéis do Hub continuam lendo o que liam.

create or replace view public.cap_titulos as
 WITH mov AS (
         SELECT DISTINCT ON ((((d.value -> 'detalhes'::text) ->> 'nCodTitulo'::text)::bigint)) ((d.value -> 'detalhes'::text) ->> 'nCodTitulo'::text)::bigint AS cod_titulo,
            NULLIF((d.value -> 'detalhes'::text) ->> 'cCodCateg'::text, ''::text) AS categoria_codigo,
            NULLIF((d.value -> 'detalhes'::text) ->> 'nCodCC'::text, ''::text) AS conta_codigo,
            ((d.value -> 'detalhes'::text) ->> 'nValorTitulo'::text)::numeric AS valor,
            to_date(NULLIF((d.value -> 'detalhes'::text) ->> 'dDtEmissao'::text, ''::text), 'DD/MM/YYYY'::text) AS emissao,
            to_date(NULLIF((d.value -> 'detalhes'::text) ->> 'dDtVenc'::text, ''::text), 'DD/MM/YYYY'::text) AS vencimento,
            to_date(NULLIF((d.value -> 'detalhes'::text) ->> 'dDtPagamento'::text, ''::text), 'DD/MM/YYYY'::text) AS pagamento,
            NULLIF((d.value -> 'detalhes'::text) ->> 'cStatus'::text, ''::text) AS status,
            regexp_replace(COALESCE((d.value -> 'detalhes'::text) ->> 'cCPFCNPJCliente'::text, ''::text), '\D'::text, ''::text, 'g'::text) AS doc_mov,
            NULLIF((d.value -> 'detalhes'::text) ->> 'nCodCliente'::text, ''::text) AS cod_cliente,
            NULLIF((d.value -> 'detalhes'::text) ->> 'cNumParcela'::text, ''::text) AS parcela,
            -- A BAIXA, que mora em `resumo` e não em `detalhes`. Ver o cabeçalho:
            -- `nValPago` é o principal; quem saiu do caixa é `nValLiquido`.
            ((d.value -> 'resumo'::text) ->> 'nValPago'::text)::numeric AS valor_principal_pago,
            COALESCE(((d.value -> 'resumo'::text) ->> 'nJuros'::text)::numeric, 0::numeric)
              + COALESCE(((d.value -> 'resumo'::text) ->> 'nMulta'::text)::numeric, 0::numeric) AS juros_multa,
            COALESCE(((d.value -> 'resumo'::text) ->> 'nDesconto'::text)::numeric, 0::numeric) AS desconto,
            ((d.value -> 'resumo'::text) ->> 'nValLiquido'::text)::numeric AS valor_pago,
            ((d.value -> 'resumo'::text) ->> 'cLiquidado'::text) = 'S'::text AS liquidado
           FROM omie_cache,
            LATERAL jsonb_array_elements(omie_cache.dados) d(value)
          WHERE omie_cache.chave = 'movimentos'::text AND ((d.value -> 'detalhes'::text) ->> 'cGrupo'::text) = 'CONTA_A_PAGAR'::text
          ORDER BY (((d.value -> 'detalhes'::text) ->> 'nCodTitulo'::text)::bigint)
        ), cadastro AS MATERIALIZED (
         SELECT c.value ->> 'codigo'::text AS codigo,
            regexp_replace(COALESCE(c.value ->> 'cnpj_cpf'::text, ''::text), '\D'::text, ''::text, 'g'::text) AS doc,
            NULLIF(btrim(c.value ->> 'nome'::text), ''::text) AS nome
           FROM omie_cache,
            LATERAL jsonb_array_elements(omie_cache.dados) c(value)
          WHERE omie_cache.chave = 'clientes'::text
        ), cadastro_doc AS MATERIALIZED (
         SELECT cadastro.doc,
            min(cadastro.nome) AS nome
           FROM cadastro
          WHERE cadastro.doc <> ''::text
          GROUP BY cadastro.doc
        ), ape_doc AS MATERIALIZED (
         SELECT contraparte_apelido.chave,
            min(contraparte_apelido.apelido) AS apelido
           FROM contraparte_apelido
          WHERE contraparte_apelido.via = 'doc'::text AND contraparte_apelido.apelido IS NOT NULL
          GROUP BY contraparte_apelido.chave
        ), ape_nome AS MATERIALIZED (
         SELECT contraparte_apelido.chave,
            min(contraparte_apelido.apelido) AS apelido
           FROM contraparte_apelido
          WHERE contraparte_apelido.via = 'nome'::text AND contraparte_apelido.apelido IS NOT NULL
          GROUP BY contraparte_apelido.chave
        ), nota_no_hub AS (
         SELECT auditoria.omie_cod_titulo::bigint AS cod_titulo,
            'auditoria'::text AS fonte
           FROM auditoria
          WHERE auditoria.omie_cod_titulo ~ '^\d+$'::text AND COALESCE(auditoria.link_comprovante, ''::text) <> ''::text
        UNION
         SELECT auditoria_cartao_lancamentos.omie_cod_titulo::bigint AS omie_cod_titulo,
            'cartao'::text AS text
           FROM auditoria_cartao_lancamentos
          WHERE auditoria_cartao_lancamentos.omie_cod_titulo ~ '^\d+$'::text AND COALESCE(auditoria_cartao_lancamentos.link_comprovante, ''::text) <> ''::text
        UNION
         SELECT comprovantes_drive.cod_titulo::bigint AS cod_titulo,
            'drive'::text AS text
           FROM comprovantes_drive
          WHERE comprovantes_drive.cod_titulo ~ '^\d+$'::text
        UNION
         SELECT facilities_compras.omie_cod_titulo::bigint AS omie_cod_titulo,
            'facilities'::text AS text
           FROM facilities_compras
          WHERE facilities_compras.omie_cod_titulo ~ '^\d+$'::text AND COALESCE(facilities_compras.nf_arquivo, ''::text) <> ''::text
        UNION
         SELECT NULLIF(regexp_replace(ne.alvo_id_unico, '\D'::text, ''::text, 'g'::text), ''::text)::bigint AS cod_titulo,
                CASE
                    WHEN ne.fila_erp THEN 'acervo'::text
                    ELSE 'acervo_a_confirmar'::text
                END AS fonte
           FROM notas_externas ne
          WHERE (ne.alvo_tipo = ANY (ARRAY['pix'::text, 'erp'::text])) AND ne.alvo_id_unico ~ '^\d+$'::text AND ne.tem_arquivo AND ne.copia_de IS NULL AND ne.ignorado_em IS NULL AND ne.enviado_erp_em IS NULL
        ), hub AS (
         SELECT nota_no_hub.cod_titulo,
            string_agg(DISTINCT nota_no_hub.fonte, '+'::text ORDER BY nota_no_hub.fonte) AS fontes
           FROM nota_no_hub
          GROUP BY nota_no_hub.cod_titulo
        ), enviado AS (
         SELECT auditoria.omie_cod_titulo::bigint AS cod_titulo,
            max(auditoria.omie_anexo_enviado_em) AS em,
            NULL::text AS classe
           FROM auditoria
          WHERE auditoria.omie_cod_titulo ~ '^\d+$'::text AND auditoria.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (auditoria.omie_cod_titulo::bigint)
        UNION ALL
         SELECT auditoria_cartao_lancamentos.omie_cod_titulo::bigint AS omie_cod_titulo,
            max(auditoria_cartao_lancamentos.omie_anexo_enviado_em) AS max,
            NULL::text AS classe
           FROM auditoria_cartao_lancamentos
          WHERE auditoria_cartao_lancamentos.omie_cod_titulo ~ '^\d+$'::text AND auditoria_cartao_lancamentos.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (auditoria_cartao_lancamentos.omie_cod_titulo::bigint)
        UNION ALL
         SELECT facilities_compras.omie_cod_titulo::bigint AS omie_cod_titulo,
            max(facilities_compras.omie_anexo_enviado_em) AS max,
            NULL::text AS classe
           FROM facilities_compras
          WHERE facilities_compras.omie_cod_titulo ~ '^\d+$'::text AND facilities_compras.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (facilities_compras.omie_cod_titulo::bigint)
        UNION ALL
         SELECT comprovantes_drive.cod_titulo::bigint AS cod_titulo,
            max(comprovantes_drive.omie_anexo_enviado_em) AS max,
            NULL::text AS classe
           FROM comprovantes_drive
          WHERE comprovantes_drive.cod_titulo ~ '^\d+$'::text AND comprovantes_drive.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (comprovantes_drive.cod_titulo::bigint)
        UNION ALL
         SELECT NULLIF(regexp_replace(notas_externas.alvo_id_unico, '\D'::text, ''::text, 'g'::text), ''::text)::bigint AS cod_titulo,
            max(notas_externas.enviado_erp_em) AS max,
                CASE
                    WHEN bool_or(notas_externas.parece_nota) THEN 'nota'::text
                    WHEN bool_or(notas_externas.tipo_documento = ANY (ARRAY['boleto'::text, 'recibo'::text, 'extrato'::text])) THEN 'comprovante'::text
                    ELSE NULL::text
                END AS classe
           FROM notas_externas
          WHERE (notas_externas.alvo_tipo = ANY (ARRAY['pix'::text, 'erp'::text])) AND notas_externas.enviado_erp_em IS NOT NULL AND notas_externas.alvo_id_unico ~ '^\d+$'::text
          GROUP BY (NULLIF(regexp_replace(notas_externas.alvo_id_unico, '\D'::text, ''::text, 'g'::text), ''::text)::bigint)
        ), enviado_por_titulo AS (
         SELECT enviado.cod_titulo,
            max(enviado.em) AS enviado_em,
                CASE
                    WHEN bool_or(enviado.classe = 'nota'::text) THEN 'nota'::text
                    WHEN bool_or(enviado.classe = 'comprovante'::text) THEN 'comprovante'::text
                    ELSE NULL::text
                END AS classe_enviada
           FROM enviado
          GROUP BY enviado.cod_titulo
        ), cfg AS (
         SELECT cap_notas_config.limiar_medio,
            cap_notas_config.limiar_grave,
            cap_notas_config.limiar_urgente
           FROM cap_notas_config
          WHERE cap_notas_config.id = 1
        ), alvo AS MATERIALIZED (
         SELECT m.cod_titulo,
            m.categoria_codigo,
            m.conta_codigo,
            m.valor,
            m.emissao,
            m.vencimento,
            m.pagamento,
            m.status,
            m.doc_mov,
            m.cod_cliente,
            m.parcela,
            -- Carregadas de `mov` sem tocar: quem decide o que somar é o consumidor.
            m.valor_principal_pago,
            m.juros_multa,
            m.desconto,
            m.valor_pago,
            m.liquidado,
            COALESCE(NULLIF(m.doc_mov, ''::text), cad.doc) AS doc,
            n.bruto AS nome_cru,
            n.exibir AS nome_exibir,
            contraparte_chave(n.exibir) AS chave_nome
           FROM mov m
             LEFT JOIN cadastro cad ON cad.codigo = m.cod_cliente
             LEFT JOIN cadastro_doc cadd ON cadd.doc = NULLIF(m.doc_mov, ''::text)
             LEFT JOIN omie_titulo_texto t ON t.cod_titulo = m.cod_titulo
             LEFT JOIN omie_titulo_nome_cartao nc ON nc.cod_titulo = m.cod_titulo
             CROSS JOIN LATERAL ( SELECT b.bruto,
                    COALESCE(
                        CASE
                            WHEN COALESCE(b.bruto, ''::text) ~* '^lan[cç]amento +fatura +cart'::text THEN COALESCE(NULLIF(btrim(nc.lojista), ''::text), ( SELECT max(btrim(cl.estabelecimento)) AS max
                               FROM auditoria_cartao_lancamentos cl
                              WHERE cl.omie_cod_titulo = m.cod_titulo::text AND NULLIF(btrim(cl.estabelecimento), ''::text) IS NOT NULL))
                            ELSE NULL::text
                        END, b.bruto) AS exibir
                   FROM ( SELECT COALESCE(NULLIF(btrim(t.favorecido), ''::text), cad.nome, cadd.nome) AS bruto) b) n
        ), nomes_sem_nf AS MATERIALIZED (
         SELECT DISTINCT a2.nome_exibir AS nome
           FROM alvo a2
             JOIN fornecedor_sem_nf f ON f.resolvido_em IS NULL AND normaliza_nome(COALESCE(a2.nome_exibir, ''::text)) ~~ (('%'::text || normaliza_nome(f.padrao_nome)) || '%'::text)
        )
 SELECT a.cod_titulo,
    a.categoria_codigo,
    COALESCE(r.descricao, a.categoria_codigo, '(sem categoria)'::text) AS categoria,
    COALESCE(r.regra, 'exige'::text) AS regra,
    a.conta_codigo,
    COALESCE(cc.nome, 'conta '::text || COALESCE(a.conta_codigo, '?'::text)) AS conta,
    a.valor,
    a.emissao,
    a.vencimento,
    a.pagamento,
    COALESCE(a.pagamento, a.vencimento, a.emissao) AS competencia,
    a.status,
    a.doc,
    a.parcela,
    a.cod_cliente,
    COALESCE(ad.apelido, an2.apelido, a.nome_exibir, a.nome_cru, '—'::text) AS favorecido,
    COALESCE(a.nome_cru, '—'::text) AS favorecido_cru,
    COALESCE(ad.apelido, an2.apelido) IS NOT NULL AS tem_apelido,
    NULLIF(btrim(t2.nota_fiscal), ''::text) AS nf_no_campo,
    NULLIF(btrim(t2.documento), ''::text) AS documento,
    an.qtd AS anexos_no_erp,
    an.anexos,
    an.classe AS anexo_classe,
    an.revisao AS anexo_revisao,
    an.erro AS erro_leitura,
    an.lido_em AS anexo_lido_em,
    h.fontes AS nota_no_hub,
    e.enviado_em,
        CASE
            WHEN a.valor >= (( SELECT cfg.limiar_urgente
               FROM cfg)) THEN 'urgente'::text
            WHEN a.valor >= (( SELECT cfg.limiar_grave
               FROM cfg)) THEN 'grave'::text
            WHEN a.valor >= (( SELECT cfg.limiar_medio
               FROM cfg)) THEN 'medio'::text
            ELSE 'irrelevante'::text
        END AS gravidade,
        CASE
            WHEN COALESCE(r.regra, 'exige'::text) = 'dispensa'::text THEN 'dispensa'::text
            WHEN COALESCE(r.regra, 'exige'::text) = 'conferir'::text THEN 'conferir'::text
            WHEN COALESCE(an.qtd, 0) > 0 AND dcl.dc = 'nota'::text THEN 'com_nota'::text
            WHEN COALESCE(an.qtd, 0) > 0 AND dcl.dc = 'comprovante'::text AND snf.nome IS NOT NULL THEN 'comprovante_aceito'::text
            WHEN COALESCE(an.qtd, 0) > 0 AND dcl.dc = 'comprovante'::text THEN 'so_comprovante'::text
            WHEN COALESCE(an.qtd, 0) > 0 AND dcl.dc = 'nao_documento'::text THEN 'sem_nota'::text
            WHEN COALESCE(an.qtd, 0) > 0 AND an.classe = 'duvidoso'::text THEN 'anexo_suspeito'::text
            WHEN COALESCE(an.qtd, 0) > 0 THEN 'com_nota'::text
            WHEN an.erro IS NOT NULL THEN 'erro_leitura'::text
            WHEN e.enviado_em IS NOT NULL AND (an.lido_em IS NULL OR e.enviado_em > an.lido_em) THEN 'enviado_aguardando'::text
            WHEN an.cod_titulo IS NULL THEN 'nao_verificado'::text
            WHEN h.fontes = 'acervo_a_confirmar'::text THEN 'espera_confirmacao'::text
            WHEN h.fontes IS NOT NULL THEN 'pronta_para_enviar'::text
            ELSE 'sem_nota'::text
        END AS situacao,
    dcl.dc AS documento_classe,
    snf.nome IS NULL AS fornecedor_emite_nf,
    an.ia_leitura ->> 'tipo'::text AS anexo_tipo_lido,
    -- AS CINCO NOVAS, obrigatoriamente no fim da lista: `create or replace view`
    -- só aceita acréscimo no fim. Ver o cabeçalho desta migration.
    a.valor_principal_pago,
    a.juros_multa,
    a.desconto,
    a.valor_pago,
    a.liquidado
   FROM alvo a
     LEFT JOIN omie_categoria_regra r ON r.codigo = a.categoria_codigo
     LEFT JOIN omie_caixa_conta cc ON cc.ncodcc = a.conta_codigo
     LEFT JOIN omie_titulo_anexo an ON an.cod_titulo = a.cod_titulo
     LEFT JOIN omie_titulo_texto t2 ON t2.cod_titulo = a.cod_titulo
     LEFT JOIN hub h ON h.cod_titulo = a.cod_titulo
     LEFT JOIN enviado_por_titulo e ON e.cod_titulo = a.cod_titulo
     LEFT JOIN ape_doc ad ON a.doc IS NOT NULL AND a.doc <> ''::text AND ad.chave = a.doc
     LEFT JOIN ape_nome an2 ON length(a.chave_nome) >= 4 AND an2.chave = a.chave_nome
     LEFT JOIN nomes_sem_nf snf ON snf.nome = a.nome_exibir
     CROSS JOIN LATERAL ( SELECT COALESCE(NULLIF(anexo_documento_classe(an.classe, an.revisao, an.ia_leitura ->> 'tipo'::text, snf.nome IS NULL), 'indefinido'::text), e.classe_enviada, 'indefinido'::text) AS dc) dcl;

comment on column public.cap_titulos.valor is
  'Valor da Conta do título no Omie (detalhes.nValorTitulo). NÃO é a saída de caixa: não tem juros, multa nem desconto. Para somar quanto saiu do banco, use `valor_pago`.';

comment on column public.cap_titulos.valor_pago is
  'O que efetivamente saiu do caixa: Valor da Conta + juros + multa − desconto (resumo.nValLiquido, medido contra a API em 09/09/2026). É ESTA a coluna para somar saída de caixa — é ela que reproduz o Valor Pago do relatório de Contas a Pagar do Omie. Zero em título ainda não pago. Cuidado: o campo `resumo.nValPago` do Omie NÃO é isto — é o principal, e está em `valor_principal_pago`.';

comment on column public.cap_titulos.valor_principal_pago is
  'O principal amortizado na baixa (resumo.nValPago), sem encargos nem desconto. Costuma ser igual a `valor`, mas não sempre — em jun/26 diferiu em R$ 969,00. Não é a saída de caixa; para isso é `valor_pago`.';

comment on column public.cap_titulos.juros_multa is
  'Juros + multa cobrados na baixa (resumo.nJuros + resumo.nMulta). Zero quando não houve.';

comment on column public.cap_titulos.desconto is
  'Desconto concedido na baixa (resumo.nDesconto). Zero quando não houve. É a maior fonte de divergência histórica: R$ 5.080,10 só em mai/26.';

comment on column public.cap_titulos.liquidado is
  'A baixa quitou o título por inteiro (resumo.cLiquidado = ''S''). O relatório de Contas a Pagar do Omie NÃO conta como pago o título com baixa parcial, e `status = ''PAGO''` sozinho não distingue — o filtro que reproduz o relatório é `status = ''PAGO'' and liquidado`. Em toda a base isso é um título só (5471444771, mai/26, R$ 2.815,50), mas é a diferença inteira daquele mês. Não use sozinha: os títulos CANCELADOS também vêm com ''S''.';

-- A view nasceu com `revoke ... from anon` e só service_role lê (ver 20260826120000).
-- `create or replace view` preserva a ACL, mas reafirmar é barato e este projeto já
-- teve incidente de acesso por grant implícito ao anon.
revoke all on public.cap_titulos from anon, public, authenticated;
grant select on public.cap_titulos to service_role;
