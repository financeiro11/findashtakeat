-- O quadro dizia "sem nota" para 339 títulos cuja nota o Hub já tinha achado.
--
-- `cap_titulos` monta `nota_no_hub` de quatro fontes — auditoria, cartão, Drive e
-- Facilities — e **o acervo de notas não estava entre elas**. Só quando a fila
-- conseguia SUBIR o arquivo ao ERP é que o título saía de `sem_nota`, via
-- `enviado_erp_em`. Enquanto isso a linha aparecia em "Quem deve nota" como se
-- ninguém soubesse onde a nota estava.
--
-- Para o que a fila leva sozinha isso era um atraso de minutos. Para o que
-- espera decisão de gente — confiança `media`, que nunca é enviada sem alguém
-- dizer "é esta" — era permanente: 339 títulos, e o pedido que abriu esta frente
-- foi exatamente *"garanta que você está olhando tudo, essas notas existem"*.
--
-- ---------------------------------------------------------------------------
-- UM ESTADO NOVO, PORQUE SÃO DOIS TRABALHOS DIFERENTES
--
-- `pronta_para_enviar` já queria dizer "o Hub tem o arquivo e o ERP não", e a
-- ajuda dela na tela diz, com todas as letras, *"não é tarefa de ninguém"*. Isso
-- é verdade para a nota que está na fila e falso para a que espera confirmação —
-- e chamar as duas pelo mesmo nome faria a segunda esperar para sempre por uma
-- varredura que nunca vai levá-la.
--
--   `pronta_para_enviar`   a fila leva. Máquina.
--   `espera_confirmacao`   o Hub achou, a evidência é média, falta o clique.
--
-- A distinção sai do próprio `fila_erp`, que já é a porta de entrada do envio —
-- não é um segundo julgamento sobre a mesma coisa. E o teste é `h.fontes =
-- 'acervo_a_confirmar'` EXATO: se o título tem qualquer outra fonte junto, algo
-- está subindo e o estado certo continua sendo `pronta_para_enviar`.
--
-- Abaixo, a `cap_titulos` inteira. Mudaram um ramo e uma cláusula; ela vem
-- completa porque é assim que a próxima pessoa lê o que está rodando.

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
            NULLIF((d.value -> 'detalhes'::text) ->> 'cNumParcela'::text, ''::text) AS parcela
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
                CASE WHEN ne.fila_erp THEN 'acervo'::text ELSE 'acervo_a_confirmar'::text END AS fonte
           FROM notas_externas ne
          WHERE (ne.alvo_tipo = ANY (ARRAY['pix'::text, 'erp'::text]))
            AND ne.alvo_id_unico ~ '^\d+$'::text
            AND ne.tem_arquivo AND ne.copia_de IS NULL
            AND ne.ignorado_em IS NULL AND ne.enviado_erp_em IS NULL
        ), hub AS (
         SELECT nota_no_hub.cod_titulo,
            string_agg(DISTINCT nota_no_hub.fonte, '+'::text ORDER BY nota_no_hub.fonte) AS fontes
           FROM nota_no_hub
          GROUP BY nota_no_hub.cod_titulo
        ), enviado AS (
         SELECT auditoria.omie_cod_titulo::bigint AS cod_titulo,
            max(auditoria.omie_anexo_enviado_em) AS em
           FROM auditoria
          WHERE auditoria.omie_cod_titulo ~ '^\d+$'::text AND auditoria.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (auditoria.omie_cod_titulo::bigint)
        UNION ALL
         SELECT auditoria_cartao_lancamentos.omie_cod_titulo::bigint AS omie_cod_titulo,
            max(auditoria_cartao_lancamentos.omie_anexo_enviado_em) AS max
           FROM auditoria_cartao_lancamentos
          WHERE auditoria_cartao_lancamentos.omie_cod_titulo ~ '^\d+$'::text AND auditoria_cartao_lancamentos.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (auditoria_cartao_lancamentos.omie_cod_titulo::bigint)
        UNION ALL
         SELECT facilities_compras.omie_cod_titulo::bigint AS omie_cod_titulo,
            max(facilities_compras.omie_anexo_enviado_em) AS max
           FROM facilities_compras
          WHERE facilities_compras.omie_cod_titulo ~ '^\d+$'::text AND facilities_compras.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (facilities_compras.omie_cod_titulo::bigint)
        UNION ALL
         SELECT comprovantes_drive.cod_titulo::bigint AS cod_titulo,
            max(comprovantes_drive.omie_anexo_enviado_em) AS max
           FROM comprovantes_drive
          WHERE comprovantes_drive.cod_titulo ~ '^\d+$'::text AND comprovantes_drive.omie_anexo_enviado_em IS NOT NULL
          GROUP BY (comprovantes_drive.cod_titulo::bigint)
        UNION ALL
         SELECT NULLIF(regexp_replace(notas_externas.alvo_id_unico, '\D'::text, ''::text, 'g'::text), ''::text)::bigint AS cod_titulo,
            max(notas_externas.enviado_erp_em) AS max
           FROM notas_externas
          WHERE (notas_externas.alvo_tipo = ANY (ARRAY['pix'::text, 'erp'::text])) AND notas_externas.enviado_erp_em IS NOT NULL AND notas_externas.alvo_id_unico ~ '^\d+$'::text
          GROUP BY (NULLIF(regexp_replace(notas_externas.alvo_id_unico, '\D'::text, ''::text, 'g'::text), ''::text)::bigint)
        ), enviado_por_titulo AS (
         SELECT enviado.cod_titulo,
            max(enviado.em) AS enviado_em
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
            WHEN COALESCE(an.qtd, 0) > 0 AND an.revisao = 'nao_e_nota'::text THEN 'sem_nota'::text
            WHEN COALESCE(an.qtd, 0) > 0 AND an.revisao = 'nota'::text THEN 'com_nota'::text
            WHEN COALESCE(an.qtd, 0) > 0 AND an.classe = 'duvidoso'::text THEN 'anexo_suspeito'::text
            WHEN COALESCE(an.qtd, 0) > 0 THEN 'com_nota'::text
            WHEN an.erro IS NOT NULL THEN 'erro_leitura'::text
            WHEN e.enviado_em IS NOT NULL AND (an.lido_em IS NULL OR e.enviado_em > an.lido_em) THEN 'enviado_aguardando'::text
            WHEN an.cod_titulo IS NULL THEN 'nao_verificado'::text
            WHEN h.fontes = 'acervo_a_confirmar'::text THEN 'espera_confirmacao'::text
            WHEN h.fontes IS NOT NULL THEN 'pronta_para_enviar'::text
            ELSE 'sem_nota'::text
        END AS situacao
   FROM alvo a
     LEFT JOIN omie_categoria_regra r ON r.codigo = a.categoria_codigo
     LEFT JOIN omie_caixa_conta cc ON cc.ncodcc = a.conta_codigo
     LEFT JOIN omie_titulo_anexo an ON an.cod_titulo = a.cod_titulo
     LEFT JOIN omie_titulo_texto t2 ON t2.cod_titulo = a.cod_titulo
     LEFT JOIN hub h ON h.cod_titulo = a.cod_titulo
     LEFT JOIN enviado_por_titulo e ON e.cod_titulo = a.cod_titulo
     LEFT JOIN ape_doc ad ON a.doc IS NOT NULL AND a.doc <> ''::text AND ad.chave = a.doc
     LEFT JOIN ape_nome an2 ON length(a.chave_nome) >= 4 AND an2.chave = a.chave_nome;
