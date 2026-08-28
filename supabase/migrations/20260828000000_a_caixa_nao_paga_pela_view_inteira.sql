-- A Caixa parou de pagar pela `cap_titulos` inteira para saber seis nomes.
--
-- Sintoma, em 28/08/2026: o usuário jogou 11 notas na Caixa e a tela respondeu
-- *"Não deu para ler a caixa: canceling statement due to statement timeout"*.
-- Os 11 arquivos estavam gravados e a leitura andando — quem falhou foi a
-- LISTA, e a tela, sem lista, parecia dizer que a subida não tinha funcionado.
--
-- ---------------------------------------------------------------------------
-- O QUE CUSTAVA: um `left join lateral` que parece barato e não é
--
-- `caixa_notas_lista` pegava o favorecido/valor/data do lançamento assim:
--
--     left join lateral (
--       select ... from public.cap_titulos c where c.cod_titulo = <id> limit 1
--     ) t on true
--
-- O comentário original dizia que "com o id na mão pega uma linha por índice,
-- não varre a view". Está errado, e a medição mostra por quê: `cap_titulos`
-- monta os CTEs `alvo`, `cadastro` e `nomes_sem_nf` como MATERIALIZED, e CTE
-- materializado é uma barreira de otimização — o `where cod_titulo = X` não
-- desce para dentro dela. A view constrói os 5.013 títulos com situação,
-- gravidade, anexo e apelido, e SÓ ENTÃO joga 5.012 fora.
--
--     explain analyze select favorecido from cap_titulos where cod_titulo = N
--     -> 118.838 buffers, 2.443 ms   (para devolver uma linha)
--
-- A lista inteira levava ~2,4 s. O papel `authenticated` tem
-- `statement_timeout = 8s`, e a tela relia de 6 em 6 segundos enquanto houvesse
-- arquivo "lendo": onze notas entrando, chamadas de 2,4 s empilhando a cada
-- 6 s, mais o casador (que leva 19–27 s) rodando junto. Não era uma consulta
-- lenta demais — era uma consulta cara repetida rápido demais.
--
-- ---------------------------------------------------------------------------
-- 1) O ÍNDICE QUE FALTAVA — vale para todo mundo, não só para a Caixa
--
-- Dentro de `cap_titulos`, a substituição de "Lancamento Fatura Cartao" pelo
-- lojista faz um subselect em `auditoria_cartao_lancamentos` por título. Sem
-- índice em `omie_cod_titulo`, cada um era um seq scan da tabela inteira, 999
-- vezes, duas vezes: **91.908 dos 118.838 buffers da view, 77% do trabalho**.
-- Com o índice, a leitura da view cai de 2,4 s para 1,5 s — e isso melhora
-- TODA a página /governanca/notas-erp, não só esta lista.
--
-- 2) `cap_titulo_resumo` — o rótulo, sem a situação
--
-- Quem só quer escrever "Fornecedor · R$ 1.234 · 03/08" não precisa de
-- gravidade, régua de categoria nem estado do anexo. A função nova filtra os
-- movimentos do `omie_cache` PELOS IDS PEDIDOS antes de qualquer junção, e
-- reaproveita as mesmas fontes de nome da view — `omie_titulo_texto`, o
-- cadastro do Omie, o lojista do cartão e o apelido da Parametrização
-- (`contraparte_apelido`), nesta ordem. Conferido título a título contra a
-- `cap_titulos`: mesmo nome, mesmo valor, mesma data.
--
--     select favorecido from cap_titulo_resumo(array[...6 ids...])
--     -> 27 ms
--
-- ELA NÃO SUBSTITUI A VIEW, e não deve. `cap_titulos` responde "este título
-- está coberto?"; esta responde "como se chama este título?". Usá-la para a
-- primeira pergunta traria de volta a divergência que a view existe para
-- evitar. O teto prático são algumas dezenas de ids — o apelido é resolvido
-- por lateral, que a cinco mil linhas fica caro de novo.

/* ============================ 1) o índice ============================ */

create index if not exists auditoria_cartao_omie_cod_titulo_idx
  on public.auditoria_cartao_lancamentos (omie_cod_titulo);

comment on index public.auditoria_cartao_omie_cod_titulo_idx is
  'O lojista do cartão dentro de `cap_titulos` é buscado por título. Sem este índice era um seq scan por linha da view — 77% do custo dela. Ver 20260828000000.';

/* ====================== 2) o rótulo, sem a situação ====================== */

create or replace function public.cap_titulo_resumo(p_cods bigint[])
returns table (cod_titulo bigint, favorecido text, valor numeric, data date)
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  with alvos as (
    select distinct c from unnest(coalesce(p_cods, '{}'::bigint[])) c where c is not null
  ),
  /* O FILTRO VEM ANTES DA JUNÇÃO, que é a diferença toda para a view: o
     `in (select ...)` entra no mesmo scan que expande o jsonb, e sobram seis
     linhas em vez de cinco mil. */
  mov as (
    select distinct on ((((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint))
           (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint)              as cod_titulo,
           (((d.value -> 'detalhes') ->> 'nValorTitulo')::numeric)           as valor,
           coalesce(
             to_date(nullif((d.value -> 'detalhes') ->> 'dDtPagamento', ''), 'DD/MM/YYYY'),
             to_date(nullif((d.value -> 'detalhes') ->> 'dDtVenc', ''),      'DD/MM/YYYY'),
             to_date(nullif((d.value -> 'detalhes') ->> 'dDtEmissao', ''),   'DD/MM/YYYY'))  as data,
           regexp_replace(coalesce((d.value -> 'detalhes') ->> 'cCPFCNPJCliente', ''), '\D', '', 'g') as doc_mov,
           nullif((d.value -> 'detalhes') ->> 'nCodCliente', '')             as cod_cliente
      from public.omie_cache,
           lateral jsonb_array_elements(omie_cache.dados) d
     where omie_cache.chave = 'movimentos'
       and ((d.value -> 'detalhes') ->> 'cGrupo') = 'CONTA_A_PAGAR'
       and (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint) in (select c from alvos)
     order by (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint)
  ),
  cad as (
    select nullif(c.value ->> 'codigo', '')                                    as codigo,
           regexp_replace(coalesce(c.value ->> 'cnpj_cpf', ''), '\D', '', 'g')  as doc,
           nullif(btrim(c.value ->> 'nome'), '')                               as nome
      from public.omie_cache,
           lateral jsonb_array_elements(omie_cache.dados) c
     where omie_cache.chave = 'clientes'
  ),
  /* `min(nome)` agrupado, e não o join direto: o mesmo CNPJ aparece mais de uma
     vez no cadastro do Omie, e sem agrupar um título viraria três linhas. É a
     mesma defesa do `cadastro_doc` da view. */
  cad_cod as (select codigo, min(nome) as nome from cad where codigo is not null group by codigo),
  cad_doc as (select doc,    min(nome) as nome from cad where doc <> ''         group by doc),
  nomeado as (
    select m.cod_titulo, m.valor, m.data,
           coalesce(nullif(m.doc_mov, ''), cd.doc)                       as doc,
           coalesce(nullif(btrim(t.favorecido), ''), cc.nome, cd.nome)   as bruto
      from mov m
      left join public.omie_titulo_texto t on t.cod_titulo = m.cod_titulo
      left join cad_cod cc on cc.codigo = m.cod_cliente
      left join cad_doc cd on cd.doc    = nullif(m.doc_mov, '')
  ),
  /* O LOJISTA NO LUGAR DE "Lancamento Fatura Cartao" — a mesma troca da view.
     Sem isto, a nota que casou com uma parcela de fatura mostraria o nome
     genérico do lançamento em vez de quem vendeu. */
  exibivel as (
    select n.cod_titulo, n.valor, n.data, n.doc,
           coalesce(
             case when coalesce(n.bruto, '') ~* '^lan[cç]amento +fatura +cart'
                  then coalesce(
                         nullif(btrim(nc.lojista), ''),
                         (select max(btrim(cl.estabelecimento))
                            from public.auditoria_cartao_lancamentos cl
                           where cl.omie_cod_titulo = n.cod_titulo::text
                             and nullif(btrim(cl.estabelecimento), '') is not null))
                  else null end,
             n.bruto)                                                    as exibir
      from nomeado n
      left join public.omie_titulo_nome_cartao nc on nc.cod_titulo = n.cod_titulo
  )
  select e.cod_titulo,
         coalesce(ad.apelido, an.apelido, e.exibir, '—') as favorecido,
         e.valor,
         e.data
    from exibivel e
    left join lateral (
      select min(a.apelido) as apelido
        from public.contraparte_apelido a
       where a.via = 'doc' and a.apelido is not null
         and coalesce(e.doc, '') <> '' and a.chave = e.doc
    ) ad on true
    left join lateral (
      select min(a.apelido) as apelido
        from public.contraparte_apelido a
       where a.via = 'nome' and a.apelido is not null
         and length(contraparte_chave(e.exibir)) >= 4
         and a.chave = contraparte_chave(e.exibir)
    ) an on true
$$;

comment on function public.cap_titulo_resumo(bigint[]) is
  'O rótulo barato de um punhado de títulos: favorecido (já com o apelido da Parametrização e o lojista do cartão), valor e competência. Existe porque ler `cap_titulos` para saber o NOME de seis títulos custava 2,4s — a view monta situação, gravidade e anexo de 5 mil linhas antes de filtrar, e os CTEs MATERIALIZED impedem o filtro de descer. Não serve para perguntar se o título está coberto: isso é da view. Ver 20260828000000.';

revoke all on function public.cap_titulo_resumo(bigint[]) from public, anon;
grant execute on function public.cap_titulo_resumo(bigint[]) to authenticated, service_role;

/* ===================== 3) a lista da Caixa, sem a view ===================== */

create or replace function public.caixa_notas_lista(
  p_dias   int default 7,
  p_limite int default 120
)
returns table (
  id            bigint,
  fonte         text,
  arquivo       text,
  detalhe       text,
  visto_em      timestamptz,
  tem_arquivo   boolean,
  lido_em       timestamptz,
  leitura_erro  text,
  nome          text,
  cnpj          text,
  valor         numeric,
  documento     text,
  data_doc      date,
  tipo_documento text,
  casamento     text,
  confianca     text,
  alvo_tipo     text,
  alvo_id_unico text,
  alvo_favorecido text,
  alvo_valor    numeric,
  alvo_data     date,
  enviado_erp_em timestamptz,
  erro_erp      text,
  estado        text
)
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  with base as (
    select n.*
      from public.notas_externas n
     where n.ignorado_em is null
       and n.copia_de is null
       and (
             n.fonte = 'caixa'
          or (n.fonte = 'email' and n.visto_em >= now() - make_interval(days => greatest(1, p_dias)))
       )
     order by n.visto_em desc nulls last
     limit greatest(1, least(coalesce(p_limite, 120), 400))
  ),
  /* UMA CHAMADA PARA TODOS OS ALVOS, e não um lateral por linha. Das 200 linhas
     da Caixa, sete têm lançamento; pedir o rótulo dessas sete de uma vez custa
     27 ms. Era daqui que vinha o `statement timeout` de 28/08/2026. */
  alvos as (
    select coalesce(
             array_agg(distinct nullif(regexp_replace(b.alvo_id_unico, '\D', '', 'g'), '')::bigint),
             '{}'::bigint[]
           ) as cods
      from base b
     where b.alvo_id_unico ~ '^\d+$'
  ),
  resumo as (
    select * from public.cap_titulo_resumo((select cods from alvos))
  )
  select b.id, b.fonte, coalesce(b.o_que_e, b.detalhe, '(sem nome)'), b.detalhe,
         b.visto_em, b.tem_arquivo, b.lido_do_arquivo_em, b.leitura_erro,
         b.nome, b.cnpj, b.valor, b.documento,
         coalesce(b.vencimento, b.enviado_em) as data_doc,
         b.tipo_documento, b.casamento, b.confianca,
         b.alvo_tipo, b.alvo_id_unico, r.favorecido, r.valor, r.data,
         b.enviado_erp_em, b.erro_erp,
         case
           when b.enviado_erp_em is not null then 'no_omie'
           when b.alvo_id_unico is not null and b.fila_erp then 'subindo'
           when b.alvo_id_unico is not null then 'esperando'
           when b.lido_do_arquivo_em is null and b.valor is null then 'lendo'
           when b.valor is null then 'nao_deu'
           else 'sem_dono'
         end as estado
    from base b
    left join resumo r
      on b.alvo_id_unico ~ '^\d+$'
     and r.cod_titulo = nullif(regexp_replace(b.alvo_id_unico, '\D', '', 'g'), '')::bigint
   order by b.visto_em desc nulls last
$$;

comment on function public.caixa_notas_lista(int, int) is
  'O que está na Caixa de notas e em que pé: o que a leitura tirou do papel, o lançamento que o casador achou e se já subiu ao Omie. O estado é DEDUZIDO das colunas da esteira — uma coluna `status` seria uma quinta verdade sobre a mesma nota. Mostra também o que entrou por e-mail nos últimos dias, porque encaminhar para financeiro@ é um dos caminhos de entrada. O rótulo do lançamento vem de `cap_titulo_resumo` numa chamada só: pelo `cap_titulos` custava 2,4s e estourava o teto de 8s do `authenticated` enquanto a tela relia de 6 em 6 segundos. Ver 20260827360000 e 20260828000000.';

revoke all on function public.caixa_notas_lista(int, int) from public, anon;
grant execute on function public.caixa_notas_lista(int, int) to authenticated, service_role;
