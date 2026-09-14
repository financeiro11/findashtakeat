-- A régua ganha um segundo eixo: a CONTA DE PAGAMENTO também dispensa nota.
--
-- PEDIDO DO USUÁRIO EM 12/09/2026, olhando o quadro "Por conta de pagamento" de
-- /governanca/notas-erp: *"Os valores do BTG e do Itaú não devem ser
-- contabilizados para este cálculo do Notas no ERP. Nada ali é do meu interesse
-- saber se tem nota."*
--
-- ELE ESTÁ CERTO, E O NÚMERO ESTAVA GRANDE. Medido hoje, os oito títulos
-- exigíveis da "BTG - Conta Investimento" somam R$ 406.018 com 0% de cobertura —
-- o segundo maior monte de "falta nota" do Hub inteiro, atrás só da conta
-- corrente do Sicoob. São todos do favorecido "Banco Btg Pactual", na categoria
-- `2.10.93` (sem descrição no plano de contas, logo `exige` por padrão), e todos
-- em `so_comprovante`: aplicação e resgate de CDB, movimento entre o nosso
-- dinheiro e o nosso dinheiro. Não existe nota de fornecedor para pedir. A
-- "Itaú - Mastercard" é a mesma natureza em outra escala — quatro títulos, R$ 169.
--
-- POR QUE NÃO RESOLVER PELA RÉGUA DE CATEGORIA. Daria para marcar `2.10.93` como
-- `dispensa` e o número sairia igual HOJE. Mas seria a regra errada escrita no
-- lugar errado por coincidência: `2.10.93` é um código sem cadastro, e no dia em
-- que alguém o nomear e usar numa despesa de verdade a dispensa viajaria junto,
-- calada. O que o usuário afirmou é sobre a CONTA — "nada ali" —, e é na conta
-- que a regra tem de morar.
--
-- A REGRA MORA EM `omie_caixa_conta.exige_nota`, ao lado de `incluir`, que já é
-- exatamente este tipo de decisão humana sobre uma conta (entra no saldo
-- consolidado?). O sync do caixa só reescreve `ncodcc`, `nome`, `banco` e
-- `saldo` — a coluna nova sobrevive a ele, como `saldo_inicial` e `ordem` já
-- sobrevivem.
--
-- COMO O NÚMERO MUDA. `cap_titulos.regra` passa a ser a regra EFETIVA: conta
-- dispensada vence a categoria e o título nasce em `situacao = 'dispensa'`. Com
-- isso, de graça e sem uma segunda regra escrita em outro lugar:
--
--   • `cap_notas_resumo` já corta `dispensa` dos DOIS lados da conta, então os
--     R$ 406 mil saem do denominador e a linha desaparece do quadro "Por conta
--     de pagamento" (o bloco `contas` agrega só o exigível);
--   • `cap_anexos_fila` filtra `regra = 'exige'`, então a varredura PARA de
--     perguntar ao Omie por esses títulos — chamada de API que se gastava para
--     confirmar que um resgate de CDB não tem nota fiscal;
--   • os títulos continuam existindo e achaveis na aba Títulos pelo recorte
--     "Não exige" — dispensar não é esconder.
--
-- `conta_exige_nota` vai junto, no fim da lista de colunas (é o que
-- `create or replace view` aceita), para que quem auditar um título veja POR QUE
-- ele está dispensado enquanto a categoria dele diz `exige`. Sem ela, a única
-- explicação possível seria "confie".
--
-- QUEM MAIS FICA MARCADO: só as duas contas que o usuário apontou. As outras
-- candidatas óbvias (BTG - Aplicações, BTG - Conta Corrente, Sicoob - Aplicação
-- RDC, Banestes Subvenção) hoje têm ZERO títulos exigíveis, então marcá-las não
-- mudaria número nenhum — e marcar por palpite uma conta que amanhã pague um
-- fornecedor de verdade é criar um buraco silencioso na cobertura. Elas ficam a
-- um clique na aba Régua, que é onde a decisão pertence.

-- ---------------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------------

alter table public.omie_caixa_conta
  add column if not exists exige_nota boolean not null default true;

comment on column public.omie_caixa_conta.exige_nota is
  'Os títulos pagos por esta conta entram na medição de "nota do fornecedor no ERP"? `false` dispensa a conta inteira: os títulos nascem em `situacao = ''dispensa''` na view `cap_titulos`, saem dos dois lados da cobertura e a varredura de anexos para de perguntar por eles ao Omie. Para conta de aplicação e investimento, onde o movimento é entre o nosso dinheiro e o nosso dinheiro. Decisão humana, editada em /governanca/notas-erp › Régua; o sync do caixa não a reescreve. Ver 20260912130000.';

-- As duas do pedido. `false` explícito só nelas — o default cuida do resto.
update public.omie_caixa_conta
   set exige_nota = false, atualizado_em = now()
 where ncodcc in (
   '5456223148',  -- BTG - Conta Investimento  (8 títulos, R$ 406.018, 0% de cobertura)
   '5480278817'   -- Itaú - Mastercard         (4 títulos, R$ 169)
 );

-- ---------------------------------------------------------------------------
-- 2. A view passa a olhar a regra EFETIVA (conta vence categoria)
-- ---------------------------------------------------------------------------
--
-- Cópia fiel de 20260910150000 com três mudanças, todas no `select` final:
--   • o lateral `rr`, que resolve conta-vence-categoria num lugar só;
--   • `regra` e o `case` da `situacao` passam a ler `rr.regra` em vez de `r.regra`
--     (estavam escritos duas vezes, e divergir aqui é a falha clássica deste módulo);
--   • `conta_exige_nota`, nova, no fim.

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
    rr.regra,
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
            WHEN rr.regra = 'dispensa'::text THEN 'dispensa'::text
            WHEN rr.regra = 'conferir'::text THEN 'conferir'::text
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
    a.valor_principal_pago,
    a.juros_multa,
    a.desconto,
    a.valor_pago,
    a.liquidado,
    -- NOVA, no fim da lista porque `create or replace view` não aceita outro
    -- lugar: por que este título está dispensado quando a categoria dele exige.
    COALESCE(cc.exige_nota, true) AS conta_exige_nota
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
     -- A REGRA EFETIVA, resolvida uma vez: a conta vence a categoria. Escrita
     -- aqui, e não repetida na coluna `regra` e no `case` da `situacao`, porque
     -- duas cópias da mesma regra divergem na primeira edição distraída.
     CROSS JOIN LATERAL ( SELECT CASE
              WHEN NOT COALESCE(cc.exige_nota, true) THEN 'dispensa'::text
              ELSE COALESCE(r.regra, 'exige'::text)
            END AS regra) rr
     CROSS JOIN LATERAL ( SELECT COALESCE(NULLIF(anexo_documento_classe(an.classe, an.revisao, an.ia_leitura ->> 'tipo'::text, snf.nome IS NULL), 'indefinido'::text), e.classe_enviada, 'indefinido'::text) AS dc) dcl;

comment on column public.cap_titulos.regra is
  'A regra EFETIVA de exigência de nota: `dispensa` quando a conta de pagamento está marcada com `exige_nota = false` em `omie_caixa_conta` (conta vence categoria), senão a regra da categoria em `omie_categoria_regra`, com `exige` como padrão de quem não tem linha lá. Ver `conta_exige_nota` para saber qual dos dois eixos dispensou. Consumida por `cap_anexos_fila`, que só pergunta ao Omie por `regra = ''exige''`.';

comment on column public.cap_titulos.conta_exige_nota is
  'A conta de pagamento deste título entra na medição de notas? `false` (BTG - Conta Investimento, Itaú - Mastercard) força `regra = ''dispensa''` e `situacao = ''dispensa''` mesmo quando a categoria exige. Existe para que a dispensa de um título seja explicável: sem ela, um título de categoria `exige` aparecendo como dispensado não tem justificativa visível. Editada em /governanca/notas-erp › Régua. Ver 20260912130000.';

-- A view nasceu com `revoke ... from anon` e só service_role lê (ver 20260826120000).
revoke all on public.cap_titulos from anon, public, authenticated;
grant select on public.cap_titulos to service_role;
