-- Duas coisas que a planilha e o fornecedor já diziam, e o casador não ouvia.
--
-- ---------------------------------------------------------------------------
-- 1. A PLANILHA DECLARA O VENCIMENTO, e a esteira usava o carimbo do formulário
--
-- A aba "NFs - Eventos & Parcerias" tem uma coluna que nenhuma outra tem:
-- "informe a data de vencimento do pagamento". Estava preenchida em 85 das 448
-- linhas e o parser nunca a leu — ele ancorava tudo no `Timestamp`.
--
-- O estrago aparece inteiro nas seis parcelas da ABF: "ABF CON 2/7" a "7/7",
-- R$ 7.142,85 cada, foram enviadas AO MESMO TEMPO (09/04/2026 12:43–12:46) com
-- vencimentos de 20/04 a 20/09. Pelo carimbo são seis notas idênticas — mesmo
-- valor, mesmo dia — e as seis ficavam `ambiguo`. Pelo vencimento, cada uma
-- acha o seu mês. Mesma história em Burger Expo (7 parcelas de R$ 4.128,57).
--
-- Por isso a âncora de TODAS as regras de janela passa a ser
-- `coalesce(vencimento, enviado_em)`. `enviado_em` continua significando o que
-- sempre significou — quando o formulário foi enviado —, e é isso que faz valer
-- a pena ter duas colunas em vez de sobrescrever uma.
--
-- A leitura está em `planilhasNotas.ts` (+ gêmeo Deno), com 3 testes novos.
-- Duas armadilhas medidas ali: a coluna tem ordem PRÓPRIA (54 linhas provam
-- `mm/dd` contra 2 que provam `dd/mm`, porque é digitada à mão num formulário
-- em locale americano), e tem ano digitado errado — "2/27/0206" — que agora sai
-- como nulo em vez de virar uma data que nenhuma janela alcança.
--
-- ---------------------------------------------------------------------------
-- 2. TEM FORNECEDOR QUE COBRA O MÊS INTEIRO NUM TÍTULO SÓ
--
-- Regra dita pelo usuário em 27/08/2026: "PrimeAcesso nós pagamos no mês
-- seguinte todas as notas somadas do mês anterior".
--
-- Isso não é palpite que dê para inferir, e é exatamente o que faltava: em
-- 26/08 este repo testou "achar o subconjunto que soma" e REFUTOU, porque
-- procurava dentro de uma janela de dias e nenhum subconjunto fechava. A janela
-- errada era o problema. Conferido agora, mês contra mês:
--
--   título 15/05 (R$ 2.799,80) ← 7 notas de abril  = R$ 2.799,80   ✓ ao centavo
--   título 15/06 (R$ 3.226,90) ← 7 notas de maio   = R$ 3.226,90   ✓
--   título 15/07 (R$ 5.779,90) ← 10 notas de junho = R$ 5.779,90   ✓
--   título 17/08 (R$ 4.063,06) ← 8 notas de julho  = R$ 4.063,06   ✓
--   título 15/04 (R$ 6.903,70) ← 9 notas de março  = R$ 6.203,70   ✗ falta R$ 700
--
-- Quatro de cinco fecham exato. O quinto NÃO casa, e é assim que tem de ser: a
-- regra exige a soma bater ao centavo, então "falta uma nota de R$ 700" segue
-- aparecendo como falta, que é a verdade.
--
-- A regra mora em TABELA, não em `if`. É conhecimento de negócio que só quem
-- paga tem, e vai aparecer de novo em outro fornecedor — quando aparecer, é uma
-- linha de insert, não um deploy. `meses_depois` existe porque nem todo mundo
-- fecha em 30 dias.
--
-- Ela entra com PRIORIDADE 0, acima de todas as inferências: quando alguém
-- DECLARA como o fornecedor cobra, essa declaração ganha de coincidência de
-- valor. E sai com confiança `media` — são 7 a 10 arquivos para um título, e
-- quem confirma precisa ver a lista antes de mandar tudo ao ERP.

/* ============================================================================
 *  1. O vencimento declarado
 * ========================================================================== */

alter table public.notas_externas add column if not exists vencimento date;

comment on column public.notas_externas.vencimento is
  'A data de vencimento que a planilha declara (só a aba de Eventos pergunta). Quando existe, é ELA a âncora das janelas do casador — `enviado_em` é o carimbo do formulário, e seis parcelas enviadas no mesmo minuto têm o mesmo carimbo e vencimentos diferentes.';

/* ============================================================================
 *  2. A regra do fornecedor
 * ========================================================================== */

create table if not exists public.fornecedor_regra_nota (
  doc          text primary key,
  regra        text not null check (regra in ('consolidado_mensal')),
  meses_depois integer not null default 1 check (meses_depois between 0 and 6),
  nome         text,
  observacao   text,
  criado_em    timestamptz not null default now(),
  criado_por   uuid
);

comment on table public.fornecedor_regra_nota is
  'Como cada fornecedor cobra, quando isso não dá para inferir do dado. `consolidado_mensal`: um título fecha a SOMA de todas as notas de um mês anterior (`meses_depois`). Cadastro, não código — a próxima regra é um insert.';

alter table public.fornecedor_regra_nota enable row level security;

drop policy if exists fornecedor_regra_nota_leitura on public.fornecedor_regra_nota;
create policy fornecedor_regra_nota_leitura on public.fornecedor_regra_nota
  for select to authenticated using (true);

drop policy if exists fornecedor_regra_nota_escrita on public.fornecedor_regra_nota;
create policy fornecedor_regra_nota_escrita on public.fornecedor_regra_nota
  for all to authenticated using (true) with check (true);

insert into public.fornecedor_regra_nota (doc, regra, meses_depois, nome, observacao)
values ('17990627000130', 'consolidado_mensal', 1, 'PrimeAcesso',
        'Pagamos no mês seguinte a soma de todas as notas do mês anterior. Dito pelo financeiro em 27/08/2026; confere ao centavo em 4 dos 5 títulos de 2026.')
on conflict (doc) do update
  set regra = excluded.regra, meses_depois = excluded.meses_depois,
      nome = excluded.nome, observacao = excluded.observacao;

/* ============================================================================
 *  3. O casador v5
 *
 *  Sobre a v4: a âncora das janelas passa a ser `coalesce(vencimento,
 *  enviado_em)` e entra a regra `consolidado_mensal`, na prioridade 0.
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
              contas a pagar sabendo o CNPJ o tempo todo. */
           coalesce(
             nullif(regexp_replace(coalesce(p.cnpj_cpf, ''), '\D', '', 'g'), ''),
             nullif(regexp_replace(coalesce(ct.doc, ''), '\D', '', 'g'), '')
           ) as doc,
           coalesce(p.favorecido, p.descricao, '') as nome,
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
    select id, enviado_em,
           /* A ÂNCORA. O vencimento declarado ganha do carimbo do formulário —
              ver o cabeçalho: seis parcelas da ABF têm o mesmo carimbo. */
           coalesce(vencimento, enviado_em) as data_ref,
           /* VENCIMENTO DECLARADO APERTA A JANELA.
              Quando a planilha diz "vence em 20/07", isso é afirmação de quem
              pagou — não o carimbo de quando o formulário foi enviado. As seis
              parcelas da ABF valem R$ 7.142,85 cada e os seis títulos valem
              R$ 7.142,86 cada: com a janela larga cada nota alcança dois ou três
              títulos e todas empatam. Com a data afirmada, cada uma alcança o
              seu. */
           vencimento is not null as tem_vencimento,
           nome, valor, valor_parcela, forma_pagamento, cnpj, documento,
           parece_nota,
           nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '') as cnpj_num,
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
  /* O FORNECEDOR QUE COBRA O MÊS INTEIRO. Ver o cabeçalho: é declaração de
     gente, não inferência, e por isso entra na frente de todas as regras. */
  consol as (
    /* O MÊS DA CONSOLIDAÇÃO É O DO TÍTULO, não o do extrato.
       `alvos` do PIX usa a data do lançamento bancário, e as duas divergem: o
       título 5490549824 da PrimeAcesso vence em 15/07 e o extrato marca 30/06.
       Pela data do extrato a regra procurava as notas de MAIO — que já são do
       título anterior — e o mês inteiro deixava de fechar. */
    select a.tipo, a.id_unico, a.doc, a.valor as valor_titulo,
           (date_trunc('month', coalesce(ct.data, a.data))
              - make_interval(months => r.meses_depois))::date as mes_nota
      from alvos a
      join public.fornecedor_regra_nota r
        on r.doc = a.doc and r.regra = 'consolidado_mensal'
      left join cap ct
             on a.tipo in ('pix', 'erp')
            and ct.cod_titulo = nullif(regexp_replace(a.id_unico, '\D', '', 'g'), '')::bigint
     where a.doc is not null and a.data is not null
  ),
  /* A SOMA CONTA O MÊS INTEIRO, inclusive o que já subiu ao ERP.
     `n` exclui a nota já enviada — e, se ela sair da soma, o mês nunca mais
     fecha e o título inteiro deixa de casar. Foi o que aconteceu com julho e
     agosto da PrimeAcesso na primeira rodada: parte das notas já estava no
     Omie, a soma deu menos que o título, e as outras ficaram órfãs. Quem soma é
     o mês; quem recebe alvo é só quem ainda não tem. */
  n_do_mes as (
    select id, valor,
           nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '') as cnpj_num,
           coalesce(vencimento, enviado_em) as data_ref
      from public.notas_externas
     where ignorado_em is null and copia_de is null
       and enviado_em is not null and parece_nota and valor > 0
  ),
  consol_par as (
    select c.tipo, c.id_unico, c.valor_titulo, nn.id as nota_id, nn.valor
      from consol c
      join n_do_mes nn on nn.cnpj_num = c.doc
                      and date_trunc('month', nn.data_ref)::date = c.mes_nota
  ),
  /* Só casa se a soma FECHAR AO CENTAVO. Quando falta uma nota, o título
     continua devendo — e é essa a resposta certa. */
  consol_ok as (
    select tipo, id_unico
      from consol_par
     group by tipo, id_unico, valor_titulo
    having abs(sum(valor) - min(valor_titulo)) <= 0.02
  ),
  partida as (
    select cnpj_num as cnpj, data_ref,
           min(id) as id_a, max(id) as id_b,
           round(sum(valor) * 100)::bigint as cents
      from n
     where parece_nota and valor > 0 and cnpj_num is not null
       and length(cnpj_num) = 14
     group by 1, 2
    having count(*) = 2
  ),
  regra as (
    -- 0. a regra DECLARADA do fornecedor
    select p.nota_id, p.tipo, p.id_unico,
           'consolidado_mensal'::text as casamento, 'media'::text as confianca, 0 as prio,
           a.falta_nota, 0 as dist
      from consol_par p
      join consol_ok ok on ok.tipo = p.tipo and ok.id_unico = p.id_unico
      join alvos a on a.tipo = p.tipo and a.id_unico = p.id_unico
      join n on n.id = p.nota_id

    union all
    -- 1. documento + valor: identidade
    select nv.id, a.tipo, a.id_unico, 'cnpj_valor', 'exata', 1,
           a.falta_nota, abs(a.data - n.data_ref)
      from n_valor nv
      join n      on n.id = nv.id
      join n_doc  nd on nd.id = nv.id
      join alvos  a  on a.doc = nd.doc
                    and round(a.valor * 100)::bigint = nv.cents
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    -- 2. documento + janela: o valor não bate, mas quem recebeu é o mesmo
    select n.id, a.tipo, a.id_unico, 'cnpj_data', 'alta', 2,
           a.falta_nota, abs(a.data - n.data_ref)
      from n
      join n_doc nd on nd.id = n.id
      join alvos a  on a.doc = nd.doc
                   and a.data between n.data_ref - (case when n.tem_vencimento then 10 else 45 end)
                                  and n.data_ref + (case when n.tem_vencimento then 10 else 60 end)
     where (n.tipos_alvo is null or a.tipo = any(n.tipos_alvo))
       and n.parece_nota

    union all
    -- 3. RAIZ do CNPJ + valor: a filial que emite não é a filial que cobra
    select nv.id, a.tipo, a.id_unico, 'cnpj_raiz_valor', 'alta', 3,
           a.falta_nota, abs(a.data - n.data_ref)
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
           a.falta_nota, abs(a.data - p.data_ref)
      from partida p
      join alvos a on length(a.doc) = 14
                  and left(a.doc, 8) = left(p.cnpj, 8)
                  and round(a.valor * 100)::bigint = p.cents
                  and a.data between p.data_ref - 20 and p.data_ref + 20
    union all
    select p.id_b, a.tipo, a.id_unico, 'nota_partida', 'media', 4,
           a.falta_nota, abs(a.data - p.data_ref)
      from partida p
      join alvos a on length(a.doc) = 14
                  and left(a.doc, 8) = left(p.cnpj, 8)
                  and round(a.valor * 100)::bigint = p.cents
                  and a.data between p.data_ref - 20 and p.data_ref + 20

    union all
    -- 5. valor + janela apertada
    select nv.id, a.tipo, a.id_unico, 'valor_data', 'media', 5,
           a.falta_nota, abs(a.data - n.data_ref)
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.data_ref - (case when n.tem_vencimento then 10 else 15 end)
                                 and n.data_ref + (case when n.tem_vencimento then 10 else 45 end)
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    -- 6. nome + valor
    select nv.id, a.tipo, a.id_unico, 'nome_valor', 'media', 6,
           a.falta_nota, abs(a.data - n.data_ref)
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.data_ref - (case when n.tem_vencimento then 10 else 45 end)
                                 and n.data_ref + (case when n.tem_vencimento then 10 else 60 end)
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
  /* DOIS DESEMPATES, e os dois exigem ser o MAIS PRÓXIMO EM DATA.
     Sem essa exigência o desempate vira armadilha para fornecedor mensal de
     valor fixo: o título do mês certo já tem anexo, o do mês seguinte não, e
     "o único devendo" manda a nota de abril para maio.

     1. SÓ UM CANDIDATO AINDA DEVE. Se o documento reivindica vários títulos e
        um só está sem anexo, é dele que ele fala.
     2. O MESMO FORNECEDOR, EM PARCELAS. Quando a regra vencedora é por
        DOCUMENTO (prioridades 1 a 3, todas com CNPJ), o fornecedor já está
        certo e o que falta é o mês — e aí a data é a única distinção que
        existe. É o caso da BuzzLead: nove títulos de R$ 1.343,57, um por mês,
        e uma nota mensal de R$ 1.343,57. Por valor elas são indistinguíveis;
        pela data, cada uma acha a sua.
        Fica FORA de `valor_data` e `nome_valor` de propósito: lá o fornecedor
        não está provado, e proximidade sem identidade é chute. */
  desempate as (
    select f.nota_id, f.tipo, f.id_unico
      from finalistas f
      join contados c on c.nota_id = f.nota_id
     where c.quantos > 1
       and f.falta_nota
       and (c.quantos_devendo = 1 or f.prio between 1 and 3)
       and f.dist = (select min(f2.dist) from finalistas f2 where f2.nota_id = f.nota_id)
       /* E o mais próximo tem de ser ÚNICO: dois títulos à mesma distância não
          se desempatam por data, e escolher um deles seria sorteio. */
       and 1 = (select count(*) from finalistas f3
                 where f3.nota_id = f.nota_id
                   and f3.dist = (select min(f4.dist) from finalistas f4 where f4.nota_id = f.nota_id))
  ),
  decisao as (
    select f.nota_id, c.quantos, c.quantos_devendo,
           /* QUEM DECIDE A VITÓRIA É ISTO, e não `quantos_devendo = 1`.
              O desempate tem duas vias (o único devendo; a parcela mais próxima
              do mesmo fornecedor) e testar só a primeira lá embaixo faria a
              segunda ser calculada e jogada fora — as notas da BuzzLead
              desempatavam certo e mesmo assim saíam como `ambiguo`. */
           bool_or(e.id_unico is not null)            as desempatou,
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
     where d.quantos = 1 or d.desempatou
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
     /* O ALVO INTEIRO sai da guarda quando alguma regra de AGRUPAMENTO o
        reivindica — não bastava tirar as linhas dela.
        Medido: as 8 notas de julho da PrimeAcesso casaram pela regra declarada
        e mesmo assim morreram aqui, porque UMA nota de agosto reivindicava o
        mesmo título por `cnpj_data`. Ela sozinha criava a linha de disputa, e
        `vencedor` passava a ser o documento DELA — então as 8 perdiam para uma
        reivindicação mais fraca. Quando a regra declarada aponta um título,
        é ela que responde por ele. */
     where not exists (
             select 1 from pretendentes q
              where q.tipo = p.tipo and q.id_unico = p.id_unico
                and q.prio in (0, 4))
     group by p.tipo, p.id_unico
  )
  update public.notas_externas nt
     set alvo_tipo     = case when ganhou then d.tipo      end,
         alvo_id_unico = case when ganhou then d.id_unico  end,
         casamento     = case when ganhou then d.casamento end,
         confianca     = case when ganhou then d.confianca end,
         candidatos    = case
                           when d.quantos > 1 and not d.desempatou
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
                          and (d.quantos = 1 or d.desempatou)
    cross join lateral (
      select (d.quantos = 1 or d.desempatou)
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

  /* A FILA SEGUE A DECISÃO — a porta é a da `notas_externas_enfileirar`. */
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
    'com_vencimento', (select count(*) from public.notas_externas where vencimento is not null),
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
