-- O acervo já tinha a nota; o casador é que não conseguia enxergá-la.
--
-- Ponto de partida: a aba "Quem deve nota" acusava Marcelo Marani (R$ 166.667),
-- Ingram Micro (R$ 158.941) e Baptista Luz (R$ 52.038) — e as notas dos três
-- estavam em `notas_externas` o tempo todo. Medido nos 20 maiores devedores da
-- lista, 18 têm documento do mesmo CNPJ no acervo. Não é acervo pobre: são
-- quatro defeitos de leitura, cada um medido abaixo.
--
-- ---------------------------------------------------------------------------
-- 1. A CÓPIA QUE SOBREVIVEU ERA A MAIS POBRE  (51 de 164 grupos)
--
-- `marcar_copias` elege portador pelo MENOR id e o comentário dizia, com todas
-- as letras, que a escolha "é arbitrária de propósito — as cópias são o MESMO
-- documento, então qualquer uma serve". A premissa é meio verdadeira: é o mesmo
-- DOCUMENTO, não o mesmo REGISTRO. O e-mail da Notazz traz `anexo1.pdf` e
-- `anexo2.xml` da mesma NF; o PDF foi lido pelo nome (sem valor, tipo "outro")
-- e o XML foi lido por campo (valor R$ 37.499,99, tipo "nota"). O PDF tem id
-- menor. Resultado: o casador filtra `copia_de is null`, e a ÚNICA linha que
-- sabia o valor da nota nunca entrava na disputa.
--
-- Medido: em 51 dos 164 grupos de cópia o portador ficou sem o valor que uma
-- cópia tinha, e em 49 o portador não era sequer classificado como nota.
--
-- O conserto NÃO troca o portador — quem vai ao ERP deve continuar sendo o PDF,
-- que é o que um contador abre. O que muda é que o portador passa a HERDAR o
-- que o grupo sabe: valor, CNPJ, documento e a classificação de nota.
--
-- ---------------------------------------------------------------------------
-- 2. FILIAL NÃO É OUTRO FORNECEDOR  (5 títulos)
--
-- O título de Marani está no CNPJ 26.092.511/0001-74; a nota é emitida pela
-- 26.092.511/0002-55, com outra razão social ("NOVO MUNDO - TREINAMENTO E
-- CONSULTORIA EMPRESARIAL"). As regras 1 e 2 comparam os 14 dígitos e não
-- casam; a regra do nome não alcança porque "Marcelo Marani" e "Novo Mundo" não
-- se parecem. Mas os 8 primeiros dígitos são a RAIZ, e raiz igual é a mesma
-- empresa — filial diferente, faturamento diferente, dono o mesmo.
--
-- Entra como regra própria e como `alta`, nunca `exata`: raiz igual mais valor
-- ao centavo é forte, mas identidade mesmo só o CNPJ inteiro dá.
--
-- ---------------------------------------------------------------------------
-- 3. A NOTA PARTIDA EM DUAS  (o caso Marani, todo mês)
--
-- O título mensal é de R$ 41.666,66 e chegam DUAS notas no mesmo dia, do mesmo
-- emitente: R$ 37.499,99 e R$ 4.166,67. Somam exatamente o título (90% + 10%).
-- Nenhuma das duas casa sozinha por valor, e é por isso que seis meses de
-- Marani estão na lista.
--
-- Em 26/08/2026 este repo REFUTOU a ideia de "achar o subconjunto que soma", e
-- com razão: sobre um leque de notas soltas, chutar o subconjunto cola nota
-- errada em título certo. Esta regra é outra coisa, e as guardas são o que a
-- separam daquela: MESMO CNPJ, MESMO DIA, EXATAMENTE DUAS notas com valor
-- naquele dia, e soma ao centavo. Não é procurar combinação — é reconhecer que
-- o emitente partiu uma fatura em dois papéis.
--
-- Fica em `media`, e de propósito: a régua da autonomia manda `exata`/`alta`
-- ao ERP sozinhas, e aqui são DOIS arquivos para UM título. Quem confirma vê os
-- dois lado a lado e manda os dois — sozinho, o robô mandaria o primeiro, o
-- título passaria a ter anexo, e o segundo viraria "confere" sem nunca subir.
--
-- ---------------------------------------------------------------------------
-- 4. O EMPATE EM QUE UM DOS LADOS JÁ TEM NOTA  (132 notas)
--
-- A NFS-e da Ingram chega em XML de layout municipal que `lerXmlFiscal` não
-- sabe ler: sai com o CNPJ certo e SEM valor. Sem valor só a regra 2 alcança
-- (mesmo CNPJ na janela), e a janela pega dois títulos — empate, `ambiguo`.
-- Só que um dos dois JÁ TEM anexo no ERP. Se o documento reivindica dois
-- títulos e um deles já está resolvido, o que ele explica é o outro.
--
-- Medido nas 907 notas ambíguas por "vários alvos": 132 se resolvem assim.
-- E o número que vale mais é outro — em 664 delas TODOS os candidatos já têm
-- anexo: o empate é sobre nota que ninguém está devendo.
--
-- Também fica em `media`: é raciocínio sobre o ESTADO do mundo (quem já foi
-- resolvido), não sobre a identidade do documento. Vale como ordenação da fila
-- humana, não como autorização para subir sozinho.
--
-- ---------------------------------------------------------------------------
-- HIPÓTESE INVESTIGADA E DESCARTADA, para ninguém repetir o caminho: a pasta
-- "Notas Obra" do Drive é irmã das três que a `comprovantes-drive-sync` lê e
-- NÃO está no array `PASTAS` dela. Parecia a fonte que faltava — a obra é a
-- maior rubrica sem nota (175 títulos, R$ 283.533). Não é: os 258 arquivos
-- dela já estão em `notas_externas` sob `fonte = 'obra'`, com CNPJ nos 258 e
-- valor em 257. Somá-la ao varredor criaria um gêmeo por documento. Ver o
-- comentário que ficou no lugar do array.

/* ============================================================================
 *  1. Chave de acesso é prova de que o papel é nota
 *
 *  A leitura nova está em `_shared/nota-fiscal.ts`; isto aqui é o acerto do que
 *  já está gravado. Só promove quem está em "outro": "boleto", "recibo" e
 *  "extrato" foram escritos no nome do arquivo por alguém, e ali a palavra sabe
 *  mais do que a chave (existe boleto que cita a NF no próprio nome).
 * ========================================================================== */

update public.notas_externas
   set tipo_documento = 'nota', atualizado_em = now()
 where chave_fiscal is not null
   and coalesce(tipo_documento, 'nota') = 'outro';

/* ============================================================================
 *  2. O portador da cópia herda o que o grupo sabe
 * ========================================================================== */

create or replace function public.notas_externas_marcar_copias()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  with portador as (
    select chave_fiscal, min(id) as id
      from public.notas_externas
     where chave_fiscal is not null
     group by chave_fiscal
  )
  update public.notas_externas n
     set copia_de = p.id, atualizado_em = now()
    from portador p
   where n.chave_fiscal = p.chave_fiscal
     and n.id <> p.id
     -- Nota já enviada não vira cópia: o arquivo dela está no ERP, e apagar
     -- esse fato para chamá-la de cópia perderia o rastro de quem subiu o quê.
     and n.enviado_erp_em is null
     and n.copia_de is distinct from p.id;
  get diagnostics v_n = row_count;

  /* O PORTADOR HERDA O QUE O GRUPO SABE.
     Continua sendo o de menor id — trocá-lo faria o ERP receber o XML no lugar
     do PDF, e quem abre o anexo é gente. O que ele não pode é seguir mais pobre
     do que o conjunto: quem carrega o documento carrega também o que se sabe
     sobre ele. Preenche só buraco (`coalesce`), nunca sobrescreve leitura. */
  with grupo as (
    select coalesce(c.copia_de, c.id) as portador_id,
           min(c.valor)     filter (where c.valor is not null)     as valor,
           min(c.cnpj)      filter (where c.cnpj is not null)      as cnpj,
           min(c.documento) filter (where c.documento is not null) as documento,
           bool_or(c.parece_nota)                                  as alguem_e_nota
      from public.notas_externas c
     where c.chave_fiscal is not null
       and c.ignorado_em is null
     group by 1
  )
  update public.notas_externas n
     set valor     = coalesce(n.valor, g.valor),
         cnpj      = coalesce(n.cnpj, g.cnpj),
         documento = coalesce(n.documento, g.documento),
         tipo_documento = case
           when g.alguem_e_nota and coalesce(n.tipo_documento, 'nota') = 'outro' then 'nota'
           else n.tipo_documento
         end,
         atualizado_em = now()
    from grupo g
   where n.id = g.portador_id
     and (   (n.valor is null and g.valor is not null)
          or (n.cnpj is null and g.cnpj is not null)
          or (n.documento is null and g.documento is not null)
          or (g.alguem_e_nota and coalesce(n.tipo_documento, 'nota') = 'outro'));

  return v_n;
end;
$$;

revoke all on function public.notas_externas_marcar_copias() from public, anon;
grant execute on function public.notas_externas_marcar_copias() to authenticated, service_role;

comment on function public.notas_externas_marcar_copias() is
  'Colapsa pela chave fiscal as linhas que carregam o MESMO documento e faz o portador herdar valor, CNPJ e classificação do grupo. O portador segue sendo o de menor id (é ele que vai ao ERP, e o PDF é o que gente abre) — mas deixa de ser mais pobre que a cópia: em 51 de 164 grupos o valor da nota morava só no XML, que era descartado como cópia.';

/* ============================================================================
 *  3. O casador v4
 *
 *  Estrutura idêntica à v3 (peso da reivindicação, disputa por documento). O
 *  que muda: `alvos` passa a dizer se o título ainda está sem anexo, entram
 *  duas regras novas (raiz de CNPJ e nota partida) e o empate ganha um
 *  desempate. As quatro regras antigas mantêm a ordem relativa; a numeração
 *  abriu espaço no meio.
 * ========================================================================== */

create or replace function public.notas_externas_casar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resumo jsonb;
begin
  perform public.notas_externas_marcar_copias();

  update public.notas_externas
     set alvo_tipo = null, alvo_id_unico = null, casamento = null,
         confianca = null, candidatos = null, conferencia = null
   where enviado_erp_em is null
     and not alvo_manual
     and ignorado_em is null;

  with cap as materialized (
    /* A view é cara e agora é lida três vezes (o alvo 'erp', o "já tem anexo"
       do PIX e o do cartão). Materializar uma vez é a diferença entre 3 s e
       três vezes 3 s. */
    select cod_titulo, valor, doc, favorecido, favorecido_cru, situacao,
           coalesce(anexos_no_erp, 0) as anexos_no_erp,
           coalesce(pagamento, vencimento, emissao) as data
      from public.cap_titulos
  ),
  alvos as (
    select 'pix'::text as tipo, p.id_unico,
           p.data,
           round(abs(coalesce(p.valor, 0))::numeric, 2) as valor,
           /* O CNPJ DO TÍTULO VALE PARA O LANÇAMENTO DE PIX.
              `auditoria_pix_lancamentos.cnpj_cpf` vem do extrato e falta em
              muita linha — o pagamento de junho do Marani está sem ele, com o
              contas a pagar sabendo o CNPJ o tempo todo. Sem este `coalesce` as
              regras por documento simplesmente não existem para esses alvos, e
              a nota vira `sem_alvo` sem que nada acuse a falta. */
           coalesce(
             nullif(regexp_replace(coalesce(p.cnpj_cpf, ''), '\D', '', 'g'), ''),
             nullif(regexp_replace(coalesce(ct.doc, ''), '\D', '', 'g'), '')
           ) as doc,
           coalesce(p.favorecido, p.descricao, '') as nome,
           /* AINDA DEVE NOTA? É o que decide o empate lá embaixo. Para PIX e
              ERP a pergunta é a mesma — o id do PIX É o nCodTitulo —, e a
              resposta honesta é o que o ListarAnexo trouxe do próprio Omie. */
           coalesce(ct.anexos_no_erp = 0, not p.tem_comprovante, true) as falta_nota
      from public.auditoria_pix_lancamentos p
      left join cap ct
             on ct.cod_titulo = nullif(regexp_replace(p.id_unico, '\D', '', 'g'), '')::bigint
     where p.data is not null
    union all
    select 'cartao', a.id_unico,
           a.data,
           round(abs(coalesce(a.valor, 0))::numeric, 2),
           null,
           coalesce(a.estabelecimento, a.descricao_original, ''),
           coalesce(a.status_nf, '') <> 'OK' and coalesce(a.link_comprovante, '') = ''
      from public.auditoria_cartao_lancamentos a
     where a.data is not null
    union all
    select 'erp', c.cod_titulo::text,
           c.data,
           round(abs(coalesce(c.valor, 0))::numeric, 2),
           nullif(regexp_replace(coalesce(c.doc, ''), '\D', '', 'g'), ''),
           coalesce(c.favorecido_cru, c.favorecido, ''),
           c.anexos_no_erp = 0
      from cap c
     where c.data is not null
       and c.situacao <> 'dispensa'
       and not exists (select 1 from public.auditoria_pix_lancamentos p
                        where p.id_unico = c.cod_titulo::text)
       and not exists (select 1 from public.auditoria_cartao_lancamentos a
                        where a.omie_cod_titulo = c.cod_titulo::text)
  ),
  n as (
    select id, enviado_em, nome, valor, valor_parcela, forma_pagamento, cnpj, documento,
           parece_nota,
           coalesce(
             chave_fiscal,
             case when linha is not null then fonte || '|' || linha::text end,
             nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '')
               || '|' || coalesce(valor::text, '?') || '|' || coalesce(enviado_em::text, '?'),
             chave
           ) as documento_chave,
           case when not parece_nota then 0
                when valor is null    then 1
                else 2 end as peso,
           case
             when fonte = 'drive_mercado_livre' then array['cartao', 'erp']
             when forma_pagamento ilike '%cart%' then array['cartao', 'erp']
             when forma_pagamento ilike '%pix%'
               or forma_pagamento ilike '%boleto%'
               or forma_pagamento ilike '%transfer%' then array['pix', 'erp']
           end as tipos_alvo
      from public.notas_externas
     where enviado_erp_em is null and not alvo_manual and ignorado_em is null
       and enviado_em is not null
       and copia_de is null
  ),
  n_valor as (
    select distinct n.id, round(x * 100)::bigint + d as cents
      from n
      cross join lateral unnest(array[n.valor, n.valor_parcela]) as x
      cross join generate_series(-2, 2) as d
     where x is not null and x > 0
  ),
  n_doc as (
    select distinct n.id, d as doc
      from n
      cross join lateral unnest(array[n.cnpj, n.documento]) as d
     where d is not null and length(d) >= 11
  ),
  /* A NOTA PARTIDA. As guardas são a regra: mesmo CNPJ, mesmo dia, e aquele
     emitente emitiu EXATAMENTE duas notas com valor naquele dia. Sem a última,
     isto viraria a busca de subconjunto que já foi refutada aqui.

     Escrito como AGRUPAMENTO e não como auto-join com subconsulta correlata: a
     primeira versão pareava `n` consigo mesmo e contava o dia dentro do par, e
     a rodada inteira estourou o statement timeout. Com `having count(*) = 2` o
     `min(id)`/`max(id)` JÁ SÃO as duas notas, e sai num group by só. */
  partida as (
    select regexp_replace(cnpj, '\D', '', 'g') as cnpj,
           enviado_em,
           min(id) as id_a,
           max(id) as id_b,
           round(sum(valor) * 100)::bigint as cents
      from n
     where parece_nota and valor > 0 and cnpj is not null
       and length(regexp_replace(cnpj, '\D', '', 'g')) = 14
     group by 1, 2
    having count(*) = 2
  ),
  regra as (
    -- 1. documento + valor: identidade
    /* `a.falta_nota` viaja junto desde aqui em vez de ser buscado de novo em
       `finalistas`: um segundo join contra `alvos` inteiro custa mais do que
       carregar uma coluna por seis ramos. */
    select nv.id as nota_id, a.tipo, a.id_unico,
           'cnpj_valor'::text as casamento, 'exata'::text as confianca, 1 as prio,
           a.falta_nota, abs(a.data - n.enviado_em) as dist
      from n_valor nv
      join n      on n.id = nv.id
      join n_doc  nd on nd.id = nv.id
      join alvos  a  on a.doc = nd.doc
                    and round(a.valor * 100)::bigint = nv.cents
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    -- 2. documento + janela: o valor não bate, mas quem recebeu é o mesmo
    select n.id, a.tipo, a.id_unico, 'cnpj_data', 'alta', 2,
           a.falta_nota, abs(a.data - n.enviado_em)
      from n
      join n_doc nd on nd.id = n.id
      join alvos a  on a.doc = nd.doc
                   and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where (n.tipos_alvo is null or a.tipo = any(n.tipos_alvo))
       and n.parece_nota

    union all
    /* 3. RAIZ do CNPJ + valor: a filial que emite não é a filial que cobra.
       Exige valor ao centavo justamente porque a raiz sozinha é frouxa — um
       grupo grande tem dezenas de títulos abertos. */
    select nv.id, a.tipo, a.id_unico, 'cnpj_raiz_valor', 'alta', 3,
           a.falta_nota, abs(a.data - n.enviado_em)
      from n_valor nv
      join n     on n.id = nv.id
      join n_doc nd on nd.id = nv.id and length(nd.doc) = 14
      join alvos a  on length(a.doc) = 14
                   and left(a.doc, 8) = left(nd.doc, 8)
                   and a.doc <> nd.doc
                   and round(a.valor * 100)::bigint = nv.cents
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    -- 4. nota partida: as duas notas do dia somam o título
    select p.id_a, a.tipo, a.id_unico, 'nota_partida', 'media', 4,
           a.falta_nota, abs(a.data - p.enviado_em)
      from partida p
      join alvos a on length(a.doc) = 14
                  and left(a.doc, 8) = left(p.cnpj, 8)
                  and round(a.valor * 100)::bigint = p.cents
                  /* JANELA CURTA, e foi medindo que ela encurtou. Com -45/+60 a
                     dupla de 29/04 do Marani casou no título de 25/05: os
                     títulos dele são MENSAIS e todos valem R$ 41.666,66, então
                     valor não desempata nada e a janela larga escolhe o mês
                     errado. Fatura partida é do mês — o título está a dias. */
                  and a.data between p.enviado_em - 20 and p.enviado_em + 20
    union all
    select p.id_b, a.tipo, a.id_unico, 'nota_partida', 'media', 4,
           a.falta_nota, abs(a.data - p.enviado_em)
      from partida p
      join alvos a on length(a.doc) = 14
                  and left(a.doc, 8) = left(p.cnpj, 8)
                  and round(a.valor * 100)::bigint = p.cents
                  /* JANELA CURTA, e foi medindo que ela encurtou. Com -45/+60 a
                     dupla de 29/04 do Marani casou no título de 25/05: os
                     títulos dele são MENSAIS e todos valem R$ 41.666,66, então
                     valor não desempata nada e a janela larga escolhe o mês
                     errado. Fatura partida é do mês — o título está a dias. */
                  and a.data between p.enviado_em - 20 and p.enviado_em + 20

    union all
    -- 5. valor + janela apertada
    select nv.id, a.tipo, a.id_unico, 'valor_data', 'media', 5,
           a.falta_nota, abs(a.data - n.enviado_em)
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 15 and n.enviado_em + 45
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    -- 6. nome + valor
    select nv.id, a.tipo, a.id_unico, 'nome_valor', 'media', 6,
           a.falta_nota, abs(a.data - n.enviado_em)
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where (n.tipos_alvo is null or a.tipo = any(n.tipos_alvo))
       and coalesce(n.nome, '') <> '' and length(n.nome) >= 6
       and similarity(public.normaliza_nome(n.nome), public.normaliza_nome(a.nome)) >= 0.55
  ),
  melhor as (
    select nota_id, min(prio) as prio from regra group by nota_id
  ),
  finalistas as (
    select distinct r.nota_id, r.tipo, r.id_unico, r.casamento, r.confianca, r.prio,
           r.falta_nota, r.dist
      from regra r
      join melhor m on m.nota_id = r.nota_id and m.prio = r.prio
  ),
  contados as (
    select nota_id, count(*) as quantos,
           count(*) filter (where falta_nota) as quantos_devendo
      from finalistas group by nota_id
  ),
  /* O DESEMPATE PELO ESTADO DO MUNDO. Vários candidatos, mas só um ainda sem
     anexo: é dele que a nota fala. Nunca promove confiança — desce para
     `media`, porque isto não é identidade, é eliminação. */
  desempate as (
    select f.nota_id, f.tipo, f.id_unico
      from finalistas f
      join contados c on c.nota_id = f.nota_id
     where c.quantos > 1 and c.quantos_devendo = 1 and f.falta_nota
       /* E TEM DE SER TAMBÉM O MAIS PRÓXIMO EM DATA.
          Sem isto o desempate vira uma armadilha para fornecedor mensal de
          valor fixo: o título do mês certo já tem anexo, o do mês seguinte não,
          e "o único devendo" manda a nota de abril para maio. Se quem está
          devendo não é o mais perto, a coincidência não é explicação — a nota
          continua ambígua e alguém decide. */
       and f.dist = (select min(f2.dist) from finalistas f2 where f2.nota_id = f.nota_id)
  ),
  decisao as (
    select f.nota_id, c.quantos, c.quantos_devendo,
           coalesce(max(e.tipo),     min(f.tipo))     as tipo,
           coalesce(max(e.id_unico), min(f.id_unico)) as id_unico,
           case when max(e.id_unico) is not null then min(f.casamento) || '_unico_devendo'
                else min(f.casamento) end as casamento,
           case when max(e.id_unico) is not null then 'media'
                else min(f.confianca) end as confianca,
           min(f.prio) as prio,
           jsonb_agg(distinct jsonb_build_object('tipo', f.tipo, 'id_unico', f.id_unico)) as lista
      from finalistas f
      join contados c on c.nota_id = f.nota_id
      left join desempate e on e.nota_id = f.nota_id
     group by f.nota_id, c.quantos, c.quantos_devendo
  ),
  pretendentes as (
    select d.nota_id, d.tipo, d.id_unico, d.prio, n.documento_chave, n.peso
      from decisao d
      join n on n.id = d.nota_id
     where d.quantos = 1 or d.quantos_devendo = 1
  ),
  topo as (
    select tipo, id_unico, max(peso) as peso from pretendentes group by 1, 2
  ),
  disputa as (
    select p.tipo, p.id_unico,
           count(distinct p.documento_chave) as docs,
           min(p.documento_chave) as vencedor
      from pretendentes p
      join topo t on t.tipo = p.tipo and t.id_unico = p.id_unico and t.peso = p.peso
     -- A nota partida está FORA da guarda: dois documentos no mesmo título é
     -- exatamente o que ela afirma, e contá-los como disputa a anularia.
     where p.prio <> 4
     group by p.tipo, p.id_unico
  )
  update public.notas_externas nt
     set alvo_tipo     = case when ganhou then d.tipo      end,
         alvo_id_unico = case when ganhou then d.id_unico  end,
         casamento     = case when ganhou then d.casamento end,
         confianca     = case when ganhou then d.confianca end,
         candidatos    = case
                           when d.quantos > 1 and d.quantos_devendo <> 1
                             then jsonb_build_object(
                                    'motivo', 'varios_alvos',
                                    'quantos', d.quantos,
                                    'devendo', d.quantos_devendo,
                                    'regra', d.casamento,
                                    'alvos', (select jsonb_agg(x) from jsonb_array_elements(d.lista) with ordinality t(x, i) where i <= 5))
                           when not ganhou
                             then jsonb_build_object(
                                    'motivo', 'alvo_disputado',
                                    'quantos', 1,
                                    'linhas_disputando', coalesce(disp.docs, 1),
                                    'regra', d.casamento,
                                    'alvos', d.lista)
                         end,
         atualizado_em = now()
    from decisao d
    join n on n.id = d.nota_id
    left join disputa disp on disp.tipo = d.tipo and disp.id_unico = d.id_unico
                          and (d.quantos = 1 or d.quantos_devendo = 1)
    cross join lateral (
      select (d.quantos = 1 or d.quantos_devendo = 1)
         and coalesce(disp.docs, 1) = 1
         and coalesce(disp.vencedor, n.documento_chave) = n.documento_chave as ganhou
    ) g
   where nt.id = d.nota_id;

  /* -------- o double check: o que o ERP tem, de verdade -------- */
  update public.notas_externas nt
     set conferencia = case
           when nt.alvo_tipo is null and nt.candidatos is not null then 'ambiguo'
           when nt.alvo_tipo is null                               then 'sem_alvo'
           when nt.enviado_erp_em is not null                      then 'confere'
           when e.ja_tem                                           then 'confere'
           when nt.diz_anexado                                     then 'promessa_falsa'
           else 'falta_anexar'
         end,
         erp_anexos   = e.anexos,
         conferido_em = now(),
         atualizado_em = now()
    from (
      select nt2.id,
             coalesce(
               case when nt2.alvo_tipo = 'pix'
                    then p.tem_comprovante or coalesce(ota.qtd, 0) > 0
                    when nt2.alvo_tipo = 'erp'
                    then coalesce(ota.qtd, 0) > 0
                    else coalesce(c.status_nf, '') = 'OK'
                      or coalesce(c.link_comprovante, '') <> ''
               end, false) as ja_tem,
             case when nt2.alvo_tipo in ('pix', 'erp') then ota.qtd end as anexos
        from public.notas_externas nt2
        left join public.auditoria_pix_lancamentos p
               on nt2.alvo_tipo = 'pix' and p.id_unico = nt2.alvo_id_unico
        left join public.auditoria_cartao_lancamentos c
               on nt2.alvo_tipo = 'cartao' and c.id_unico = nt2.alvo_id_unico
        left join public.omie_titulo_anexo ota
               on nt2.alvo_tipo in ('pix', 'erp')
              and ota.cod_titulo = nullif(regexp_replace(nt2.alvo_id_unico, '\D', '', 'g'), '')::bigint
       where nt2.ignorado_em is null
    ) e
   where nt.id = e.id;

  /* A FILA SEGUE A DECISÃO.
     `casar` refaz o alvo de tudo que ainda não subiu, e a fila ficava para trás
     — ela só era escrita na entrada, nunca revista. Medido depois de recasar:
     9 notas com `fila_erp` e alvo NENHUM (o recasamento tirou o que tinham) e
     65 apontando para título que já recebeu anexo. A varredura mandaria as
     primeiras para lugar nenhum e duplicaria as segundas, e nada no caminho
     acusaria: `omie-anexar-comprovante` lê a fila e confia nela.
     A porta é exatamente a da `notas_externas_enfileirar`; aqui ela é só
     reaplicada depois que a conferência mudou de resposta. */
  update public.notas_externas
     set fila_erp = false, atualizado_em = now()
   where fila_erp
     and enviado_erp_em is null
     and (alvo_tipo is null
       or copia_de is not null
       or not tem_arquivo
       or conferencia is null
       or conferencia not in ('falta_anexar', 'promessa_falsa'));

  select jsonb_build_object(
    'notas',    (select count(*) from public.notas_externas),
    'copias',   (select count(*) from public.notas_externas where copia_de is not null),
    'por_fonte', (select jsonb_object_agg(fonte, n)
                    from (select fonte, count(*) n from public.notas_externas group by fonte) t),
    'conferencia', (select jsonb_object_agg(coalesce(conferencia, 'sem_conferencia'), n)
                    from (select conferencia, count(*) n from public.notas_externas group by conferencia) t),
    'por_confianca', (select jsonb_object_agg(coalesce(confianca, 'sem_casamento'), n)
                    from (select confianca, count(*) n from public.notas_externas group by confianca) t),
    'por_regra', (select jsonb_object_agg(coalesce(casamento, 'sem_casamento'), n)
                    from (select casamento, count(*) n from public.notas_externas group by casamento) t),
    'ambiguo_varios_alvos', (select count(*) from public.notas_externas
                              where candidatos->>'motivo' = 'varios_alvos'),
    'ambiguo_alvo_disputado', (select count(*) from public.notas_externas
                              where candidatos->>'motivo' = 'alvo_disputado'),
    'em_pix',    (select count(*) from public.notas_externas where alvo_tipo = 'pix'),
    'em_cartao', (select count(*) from public.notas_externas where alvo_tipo = 'cartao'),
    'em_erp',    (select count(*) from public.notas_externas where alvo_tipo = 'erp'),
    'na_fila',   (select count(*) from public.notas_externas
                   where fila_erp and enviado_erp_em is null)
  ) into v_resumo;

  return v_resumo;
end;
$$;

revoke all on function public.notas_externas_casar() from public, anon;
grant execute on function public.notas_externas_casar() to authenticated, service_role;

/* ============================================================================
 *  4. `cap_titulos` passa a saber que o ACERVO também entrega
 *
 *  O CTE `enviado` soma quatro origens — auditoria de PIX, cartão, Facilities e
 *  as pastas do Drive — e o acervo não estava entre elas. `notas_externas` é a
 *  quinta, e desde 26/08/2026 é ela quem mais manda arquivo ao ERP.
 *
 *  A consequência era exatamente a queixa que abriu este arquivo. O XML da
 *  NFS-e da Ingram subiu para o título 5502610063 em 26/08 às 15:35, sem erro; a
 *  releitura do ERP (`omie_titulo_anexo.lido_em`) era de 25/08 às 17:39, e a
 *  view não tinha como saber do envio no meio. Resultado: "Quem deve nota"
 *  cobrando R$ 79.450 de quem já tinha entregue. Medido: **19 títulos,
 *  R$ 96.769** nessa situação.
 *
 *  O estado `enviado_aguardando` JÁ EXISTIA na view para dizer isso ("o Hub
 *  mandou, o ERP ainda não confirmou") — só não era alcançável por esta origem.
 *
 *  O corpo abaixo é a definição EM PRODUÇÃO, lida do banco com `pg_get_viewdef`
 *  e não do arquivo que a criou: as migrations deste repo já divergiram do que
 *  está aplicado, e recriar a partir do arquivo desfaria o que veio depois. A
 *  única alteração é o `union all` novo dentro de `enviado`.
 * ========================================================================== */

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
            'cartao'::text
           FROM auditoria_cartao_lancamentos
          WHERE auditoria_cartao_lancamentos.omie_cod_titulo ~ '^\d+$'::text AND COALESCE(auditoria_cartao_lancamentos.link_comprovante, ''::text) <> ''::text
        UNION
         SELECT comprovantes_drive.cod_titulo::bigint AS cod_titulo,
            'drive'::text
           FROM comprovantes_drive
          WHERE comprovantes_drive.cod_titulo ~ '^\d+$'::text
        UNION
         SELECT facilities_compras.omie_cod_titulo::bigint AS omie_cod_titulo,
            'facilities'::text
           FROM facilities_compras
          WHERE facilities_compras.omie_cod_titulo ~ '^\d+$'::text AND COALESCE(facilities_compras.nf_arquivo, ''::text) <> ''::text
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
          WHERE notas_externas.alvo_tipo = ANY (ARRAY['pix'::text, 'erp'::text]) AND notas_externas.enviado_erp_em IS NOT NULL AND notas_externas.alvo_id_unico ~ '^\d+$'::text
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
            COALESCE(NULLIF(btrim(t.favorecido), ''::text), cad.nome, cadd.nome) AS nome_cru,
            contraparte_chave(COALESCE(NULLIF(btrim(t.favorecido), ''::text), cad.nome, cadd.nome)) AS chave_nome
           FROM mov m
             LEFT JOIN cadastro cad ON cad.codigo = m.cod_cliente
             LEFT JOIN cadastro_doc cadd ON cadd.doc = NULLIF(m.doc_mov, ''::text)
             LEFT JOIN omie_titulo_texto t ON t.cod_titulo = m.cod_titulo
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
    COALESCE(ad.apelido, an2.apelido, a.nome_cru, '—'::text) AS favorecido,
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
