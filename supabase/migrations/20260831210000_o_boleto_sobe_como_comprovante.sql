-- O boleto sobe ao ERP — como comprovante, e a NF continua sendo cobrada.
--
-- Decisão do usuário em 31/08/2026: *"Pode mandar o boleto para o ERP mas com a
-- marcação de que é da mesma categoria de recibo e comprovante. Torna isso como
-- regra daqui para frente."*
--
-- Até aqui a fila do ERP recusava boleto e recibo (`notas_externas_enfileirar`
-- exige `parece_nota or alvo_manual`), e a recusa era calada: a linha ficava no
-- Acervo sem ninguém saber o que faltava. Medido em 31/08: das 22 notas casadas
-- e fora da fila, **16 são boleto, recibo ou "outro"** — e 7 delas casaram por
-- CNPJ, ou seja, o vínculo estava provado e o que as prendia era o papel.
--
-- A CATEGORIA JÁ EXISTIA, e é isto que torna a mudança barata: `documento_classe
-- = 'comprovante'` (recibo, boleto, extrato) produz a situação `so_comprovante`
-- — "Só comprovante, falta a NF" — que sai do vermelho, NÃO entra no verde e
-- continua em `SITUACOES_FALTANDO`. É a mesma decisão de 27/08 (migration
-- 20260827380000), agora valendo também para o que o Hub MANDA, e não só para o
-- que ele encontra no ERP.
--
-- ---------------------------------------------------------------------------
-- A REGRA, daqui para a frente
--
--   tipo_documento = 'nota' (ou nulo)          → sobe, e vale como NOTA.
--   tipo_documento in (boleto, recibo, extrato) → sobe, e vale como COMPROVANTE.
--   tipo_documento = 'outro'                   → NÃO sobe sozinho.
--
-- O `outro` fica de fora por medida, não por prudência genérica: das 8 linhas
-- travadas nesse balde, **5 são lixo de e-mail** — `~WRD2579.jpg`,
-- `~WRD3098.jpg`, `~WRD1329.jpg` (imagens temporárias do Word em assinatura) e
-- `qrcode_pix.png`. Mandar isso ao Omie é pior do que não mandar nada: o
-- próximo a abrir o título acredita no que está pendurado lá. As 3 que são
-- documento de verdade (a cobrança do Alude, a fatura da Rocha Locações)
-- continuam esperando alguém olhar — e o `alvo_manual` segue sendo a porta,
-- porque quem confirma abriu o arquivo no visor.
--
-- ---------------------------------------------------------------------------
-- A MARCAÇÃO VALE DESDE O MINUTO ZERO, e sem ela a regra criaria uma mentira
--
-- `anexo_documento_classe` decide pelo que se sabe do anexo NO ERP: primeiro a
-- revisão de gente, depois a leitura da IA, por último o nome do arquivo. Um
-- boleto recém-enviado não tem nenhum dos três — cai em `indefinido`, e
-- `indefinido` com anexo cai no `else` da situação, que é **`com_nota`**. Ou
-- seja: sem esta parte, todo boleto que subisse pintaria o título de VERDE até
-- a `anexo-triagem-ia` reler o arquivo lá dentro, gastando uma chamada de IA
-- para descobrir o que o Hub já sabia quando mandou.
--
-- Por isso `enviado_por_titulo` passa a carregar `classe_enviada`, e o
-- `documento_classe` a consultá-la — mas SÓ no buraco: `coalesce(nullif(dc,
-- 'indefinido'), classe_enviada)`. A ordem de autoridade não muda; gente e IA
-- continuam ganhando de tudo. As outras quatro origens (auditoria, cartão,
-- facilities, Drive) mandam `null`: elas não sabem dizer que papel é, e chutar
-- por elas seria trocar um buraco honesto por um palpite.
--
-- ---------------------------------------------------------------------------
-- NO CARTÃO O STATUS É PRÓPRIO — 'SÓ COMPROVANTE'
--
-- `notas_externas_enfileirar` carimba `status_nf = 'OK'` no lançamento do cartão
-- quando a nota é aceita, e 'OK' quer dizer "resolvido": a linha sai da cobrança
-- na Base do cartão e some da fatura do líder. Um boleto entrando por essa porta
-- apagaria a cobrança da NF de um lado enquanto o ERP continuava cobrando do
-- outro — duas telas do mesmo Hub discordando, que é o defeito que este módulo
-- passou a semana inteira consertando.
--
-- 'SÓ COMPROVANTE' cai certo em todos os consumidores, conferidos um a um:
--   • `Lideres.tsx` conta como PENDENTE tudo que não está na lista de resolvidos
--     — a NF continua sendo cobrada do líder;
--   • `BaseCartao.tsx` não o conta em "sem NF" nem em "OK", e o valor aparece
--     sozinho no filtro de status (a lista é montada do que existe na base);
--   • `Achados.tsx` só puxa `status_nf = 'OK'` para dentro da auditoria, então
--     um comprovante não entra como se fosse nota aprovada.
-- `deriveCategoria` ganha o caso explícito ("SÓ COMPROVANTE" → SEM NF): sem ele
-- a função devolvia `null` por acidente de substring, e acidente não é regra.
--
-- E a PROMOÇÃO existe: quando a NF de verdade chegar depois do boleto, ela
-- sobrescreve o 'SÓ COMPROVANTE' e o link. Sem essa cláusula o boleto ocuparia
-- a linha para sempre — a guarda antiga (`link_comprovante = ''`) barraria a
-- própria nota que estamos esperando.

/* ============================================================================
 *  0. A REGRA, NUM LUGAR SÓ
 * ==========================================================================
 * Ela é lida em três pontos — a porta da fila, o carimbo no cartão e o "o que
 * falta" da aba Falta um passo. Repetida três vezes, o próximo tipo de
 * documento que entrar sai de sincronia num deles e a tela volta a mandar
 * apertar um botão que não faz nada, que é exatamente o defeito de ontem.
 */

create or replace function public.nota_pode_ir_ao_erp(
  p_tipo_documento text,
  p_alvo_manual    boolean
)
returns boolean
language sql
immutable
as $$
  /* `coalesce(..., 'nota')` espelha a coluna gerada `parece_nota`: sem tipo
     lido, o documento é tratado como nota — é o padrão que já vigorava. */
  select coalesce(p_tipo_documento, 'nota') in ('nota', 'boleto', 'recibo', 'extrato')
      or coalesce(p_alvo_manual, false)
$$;

comment on function public.nota_pode_ir_ao_erp(text, boolean) is
  'A regra de 31/08/2026: nota, boleto, recibo e extrato sobem ao Omie — os três últimos valendo como COMPROVANTE, com a NF ainda sendo cobrada. `outro` (o balde do lixo de e-mail: ~WRD*.jpg, qrcode_pix.png) só sobe com `alvo_manual`, o carimbo de quem abriu o arquivo no visor.';

revoke all on function public.nota_pode_ir_ao_erp(text, boolean) from anon;
grant execute on function public.nota_pode_ir_ao_erp(text, boolean) to authenticated, service_role;

/* ============================================================================
 *  1. A PORTA DA FILA — de "é nota" para "é documento"
 * ========================================================================== */

CREATE OR REPLACE FUNCTION public.notas_externas_enfileirar(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer;
begin
  update public.notas_externas ne
     set fila_erp = true, erro_erp = null, atualizado_em = now()
   where ne.id = any(p_ids)
     and ne.enviado_erp_em is null
     and ne.ignorado_em is null
     and ne.alvo_tipo is not null
     and ne.conferencia in ('falta_anexar', 'promessa_falsa')
     and ne.tem_arquivo
     and ne.copia_de is null
     /* A GUARDA DO PAPEL, agora medindo a coisa certa.
        Ela nasceu para impedir que a máquina anexasse boleto onde se cobra nota
        fiscal — e o remédio foi não anexar nada. Mas o problema nunca foi o
        boleto CHEGAR ao título: era ele chegar como se fosse a nota. Isso quem
        resolve é a classe (ver a parte 2), não a recusa.
        O que continua fora é `outro`: o balde onde moram o `~WRD2579.jpg` da
        assinatura de e-mail e o `qrcode_pix.png`. Para esses, a porta é o
        `alvo_manual` — o carimbo de quem abriu o arquivo no visor e disse que é
        este. Ver o cabeçalho desta migration. */
     and public.nota_pode_ir_ao_erp(ne.tipo_documento, ne.alvo_manual)
     /* E NÃO SE MANDA O QUE UMA CÓPIA MINHA JÁ MANDOU. Mesmo papel, mesmo
        título, dois anexos iguais — que é justamente o que a conferência existe
        para evitar, e o que ela deixa passar enquanto o cache do ListarAnexo
        não alcança o envio de ontem à noite. */
     and not exists (
       select 1 from public.notas_externas irma
        where irma.enviado_erp_em is not null
          and irma.id <> ne.id
          and coalesce(irma.copia_de, irma.id) = coalesce(ne.copia_de, ne.id)
     );
  get diagnostics v_n = row_count;

  /* No CARTÃO a nota também vale localmente, e é o que tira a linha do "SEM NF"
     — lá a coluna guarda o link de onde a nota estiver, e não uma afirmação
     sobre o ERP.

     `parece_nota` sozinho decide o STATUS, e `alvo_manual` não entra: quem
     confirmou disse "este documento é deste título", não "este boleto é a nota
     fiscal". As duas afirmações são diferentes, e só a primeira foi feita. */
  update public.auditoria_cartao_lancamentos a
     set status_nf = case when nt.parece_nota then 'OK' else 'SÓ COMPROVANTE' end,
         link_comprovante = nt.link,
         arquivo_comprovante = coalesce(a.arquivo_comprovante, nt.fonte || coalesce(' · linha ' || nt.linha, '')),
         updated_at = now()
    from public.notas_externas nt
   where nt.id = any(p_ids)
     and nt.alvo_tipo = 'cartao'
     and nt.tem_arquivo
     and public.nota_pode_ir_ao_erp(nt.tipo_documento, nt.alvo_manual)
     and a.id_unico = nt.alvo_id_unico
     and coalesce(a.status_nf, '') <> 'OK'
     /* A linha vazia recebe qualquer papel; a que já tem comprovante só cede
        lugar para a NOTA. Sem a segunda metade, o boleto que chegou primeiro
        trancaria a porta para a nota que se está esperando. */
     and (coalesce(a.link_comprovante, '') = ''
          or (coalesce(a.status_nf, '') = 'SÓ COMPROVANTE' and nt.parece_nota));

  return v_n;
end;
$function$;

comment on function public.notas_externas_enfileirar(bigint[]) is
  'Põe na fila de envio ao ERP. Desde 31/08/2026 boleto, recibo e extrato passam — e valem como COMPROVANTE, não como nota: no cartão o status vira ''SÓ COMPROVANTE'' e no ERP a classe do anexo é ''comprovante'', então a NF continua sendo cobrada nos dois lados. Só `outro` (o balde do lixo de e-mail) continua precisando de `alvo_manual`.';

/* ============================================================================
 *  2. A CLASSE QUE O HUB JÁ SABE, sem esperar a IA reler no ERP
 * ==========================================================================
 * Abaixo, a `cap_titulos` inteira. Mudam três pontos, todos comentados no
 * lugar: `enviado` ganha a coluna `classe`, `enviado_por_titulo` a agrega em
 * `classe_enviada`, e o lateral `dcl` passa a preencher com ela o `indefinido`.
 */
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
            -- O QUE O HUB SABE QUE MANDOU. As outras quatro origens não sabem
            -- dizer (mandam pelo nome do arquivo); o acervo tem `tipo_documento`
            -- decidido na entrada. Ver o cabeçalho desta migration.
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
            -- NOTA GANHA DE COMPROVANTE quando o título recebeu os dois: um
            -- boleto ao lado da NF-e não desfaz a NF-e.
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
    an.ia_leitura ->> 'tipo'::text AS anexo_tipo_lido
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


/* ============================================================================
 *  3. A ABA "FALTA UM PASSO" DESCREVE A PORTA NOVA
 * ==========================================================================
 * `auditoria_envio_quase_la` (migration 20260831200000, de hoje mais cedo) media
 * `pode_enfileirar` como `parece_nota or alvo_manual` — a porta velha. Com o
 * boleto passando, a frase "o arquivo não tem cara de nota fiscal" viraria
 * falsa: o boleto agora sobe, e o que sobra parado é só o `outro`, cujo problema
 * não é ser boleto — é ninguém saber o que ele é.
 *
 * Muda só o cálculo de `pode_enfileirar` (que passa a chamar a regra) e a frase
 * do último caso. O resto da função é o de 20260831200000, palavra por palavra.
 */

create or replace function public.auditoria_envio_quase_la(p_limite integer default 300)
returns table(origem text, ref_id text, rotulo text, competencia date, valor numeric,
              tem_comprovante boolean, tem_titulo boolean, ja_enviado boolean, falta text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with uni as (
  /* AS TRÊS ORIGENS DE PORTA DIRETA. A varredura (`pendentes()`) lê estas
     tabelas por conta própria: tendo comprovante, título e nenhum carimbo de
     envio, a linha entra no lote da próxima rodada sem passar por fila nenhuma.
     Por isso `na_fila` é `true` — não é otimismo, é como o envio funciona. */
  select 'auditoria'::text as origem, a.id::text as ref_id,
         coalesce(a.titulo, a.id_unico) as rotulo,
         a.competencia, a.valor,
         coalesce(a.link_comprovante, '') <> ''    as tem_comprovante,
         coalesce(a.omie_cod_titulo, '') <> ''     as tem_titulo,
         a.omie_anexo_enviado_em is not null       as ja_enviado,
         a.status, a.omie_cod_titulo as cod_titulo,
         null::text as acervo,
         true as na_fila, true as pode_enfileirar
  from public.auditoria a
  union all
  select 'cartao', c.id::text,
         coalesce(nullif(c.estabelecimento, ''), c.descricao_original, c.id_unico),
         c.competencia, c.valor,
         coalesce(c.link_comprovante, '') <> '',
         coalesce(c.omie_cod_titulo, '') <> '',
         c.omie_anexo_enviado_em is not null,
         c.status_nf, c.omie_cod_titulo, null::text,
         true, true
  from public.auditoria_cartao_lancamentos c
  union all
  select 'facilities', f.id::text,
         coalesce(nullif(f.item, ''), f.fornecedor_nome, f.id::text),
         f.data, f.valor,
         coalesce(f.nf_arquivo, '') <> '',
         coalesce(f.omie_cod_titulo, '') <> '',
         f.omie_anexo_enviado_em is not null,
         f.nf_status, f.omie_cod_titulo, null::text,
         true, true
  from public.facilities_compras f
  union all
  /* DRIVE — e o vínculo vem do ACERVO, não da coluna morta.
   *
   * `comprovantes_drive.cod_titulo` parou de ser escrito em 26/08/2026. Quem
   * casa o arquivo do Drive desde então é `notas_externas_casar`, sobre a linha
   * gêmea em `notas_externas` — mesmo `drive_id`, mesmo arquivo. */
  select 'drive', d.id::text,
         coalesce(nullif(d.emitente, ''), d.nome_arquivo, d.id::text),
         d.data, d.valor,
         coalesce(d.drive_id, '') <> '',
         coalesce(nullif(d.cod_titulo, ''), n.alvo_id_unico) is not null,
         d.omie_anexo_enviado_em is not null or coalesce(n.conferencia, '') = 'confere',
         d.casamento,
         coalesce(nullif(d.cod_titulo, ''),
                  case when n.alvo_tipo in ('pix', 'erp') then n.alvo_id_unico end),
         case when n.conferencia = 'ambiguo'
                   and coalesce((n.candidatos->>'devendo')::int, -1) = 0
              then 'ambiguo_resolvido' else n.conferencia end,
         coalesce(n.fila_erp, false)
           or (coalesce(d.cod_titulo, '') <> '' and d.confianca = 'alta'),
         public.nota_pode_ir_ao_erp(n.tipo_documento, n.alvo_manual)
  from public.comprovantes_drive d
  left join lateral (
    select ne.alvo_tipo, ne.alvo_id_unico, ne.conferencia, ne.candidatos,
           ne.fila_erp, ne.tipo_documento, ne.alvo_manual
      from public.notas_externas ne
     where ne.drive_id = d.drive_id
       and ne.ignorado_em is null
       and ne.copia_de is null
     order by (ne.alvo_tipo is not null) desc, ne.id
     limit 1
  ) n on coalesce(d.drive_id, '') <> ''
  union all
  /* ACERVO — as notas de planilha e de e-mail, que não têm linha no Drive. */
  select 'acervo', ne.id::text,
         coalesce(nullif(ne.nome, ''), nullif(ne.o_que_e, ''),
                  ne.fonte || coalesce(' linha ' || ne.linha, '')),
         coalesce(ne.vencimento, ne.enviado_em), ne.valor,
         ne.tem_arquivo,
         ne.alvo_id_unico is not null,
         ne.enviado_erp_em is not null or coalesce(ne.conferencia, '') = 'confere',
         null::text,
         ne.alvo_id_unico,
         case when ne.conferencia = 'ambiguo'
                   and coalesce((ne.candidatos->>'devendo')::int, -1) = 0
              then 'ambiguo_resolvido' else ne.conferencia end,
         coalesce(ne.fila_erp, false),
         public.nota_pode_ir_ao_erp(ne.tipo_documento, ne.alvo_manual)
  from public.notas_externas ne
 where ne.alvo_tipo in ('pix', 'erp')
   and ne.alvo_id_unico ~ '^\d+$'
   and ne.ignorado_em is null
   and ne.copia_de is null
   and not exists (
     select 1 from public.comprovantes_drive d2
      where coalesce(ne.drive_id, '') <> '' and d2.drive_id = ne.drive_id)
)
select u.origem, u.ref_id, u.rotulo, u.competencia, u.valor,
       u.tem_comprovante, u.tem_titulo, u.ja_enviado,
       case
         when u.ja_enviado then 'já está no Omie'
         when q.cod_titulo is not null
              then 'parou de tentar depois de ' || greatest(q.tentativas, q.erros) || ' tentativas: '
                   || coalesce(q.ultimo_motivo, 'o envio morreu sem deixar motivo')
         when u.acervo = 'ambiguo_resolvido'
              then 'a nota serve para vários títulos e todos eles já têm nota no Omie — nada a fazer'
         when u.acervo = 'ambiguo'
              then 'a nota serve para mais de um título — falta escolher qual (aba Acervo)'
         when not u.tem_comprovante and not u.tem_titulo
              then 'falta a nota E o vínculo com o título do Omie'
         when not u.tem_comprovante then 'falta a nota (o título já está casado)'
         when not u.tem_titulo      then 'a nota existe, mas o título do Omie não foi casado'
         /* AS DUAS PORTAS QUE FALTAM ABRIR. Nada põe uma nota do acervo na fila
            sozinho: a varredura só leva o que tem `fila_erp`. Desde 31/08/2026
            boleto e recibo passam pela regra (sobem como comprovante), então
            quem fica no segundo caso é só o `outro` — e o que o prende não é o
            papel ser boleto, é ninguém saber o que ele é. */
         when not u.na_fila and u.pode_enfileirar
              then 'a nota está casada e ninguém mandou ao ERP — marque na aba Acervo de notas e clique "Mandar ao ERP"'
         when not u.na_fila
              then 'o Hub não reconheceu que papel é este arquivo — nem nota, nem boleto, nem recibo. Abra na aba Acervo de notas, confirme que é este documento, e ele sobe'
         when u.origem = 'auditoria' and coalesce(u.status, '') <> 'Aprovado'
              then 'a nota está aqui e o título casado — falta aprovar o achado (status: ' || coalesce(nullif(u.status, ''), 'sem status') || ')'
         else 'pronta para subir'
       end as falta
from uni u
left join public.omie_anexo_quarentena q on q.cod_titulo = nullif(u.cod_titulo, '')
where not u.ja_enviado
order by (case when u.tem_comprovante and u.tem_titulo then 0 else 1 end), u.valor desc nulls last
limit greatest(coalesce(p_limite, 300), 1);
$function$;

revoke all on function public.auditoria_envio_quase_la(integer) from anon, public;
grant execute on function public.auditoria_envio_quase_la(integer) to authenticated, service_role;

comment on function public.auditoria_envio_quase_la(integer) is
  'O que está a um passo de virar anexo no Omie, e qual é o passo. "Pronta para subir" quer dizer o que a varredura realmente leva: porta direta (auditoria/cartão/facilities) ou `fila_erp` ligado. Quem está casado e fora da fila diz o gesto que falta, e a régua de quem PODE ir é `nota_pode_ir_ao_erp` — a mesma que a fila usa.';
