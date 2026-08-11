/* ============================================================================
 * EBITDA Ajustado: o one-off que chega picado.
 *
 * O PROBLEMA QUE ESTA MIGRATION RESOLVE. `ebitda_ajuste_candidatos` olha um
 * lançamento de cada vez, e por isso é cega para o caso mais comum de fatura
 * atrasada: o gasto não vem numa cobrança grande, vem em VÁRIAS pequenas. O
 * DATADOG em Jul-26 entrou em seis cobranças (R$ 4.941 a R$ 12.236) que somam
 * R$ 49.443 — meses represados que caíram todos em julho. A INHIRE, no mesmo
 * mês, veio em cinco licenças de R$ 990. Nenhuma das onze passa perto de virar
 * candidata sozinha; juntas são o que desajustou "Servidor" e "Softwares
 * Administrativos".
 *
 * A REGRA É A MESMA, SÓ QUE NO CONJUNTO. Os três sinais de histórico continuam
 * sendo "novo", "esporádico" e "salto" — mudou a unidade de medida: em vez de um
 * lançamento contra a mediana dos lançamentos do fornecedor, é o TOTAL DO MÊS
 * contra a mediana dos totais MENSAIS dele. É o que responde à pergunta certa
 * ("este fornecedor custa isto todo mês?") em vez de à pergunta que a cobrança
 * picada torna sem sentido ("esta cobrança é grande?").
 *
 * O NOME DO CARTÃO. Um grupo só existe se tiver nome, e no cartão a contraparte
 * do Omie é sempre o balde da fatura. O lojista sai de `cartao_lancamentos` pelo
 * mesmo casamento valor+janela do `demonstracoes_contrapartes` (migration
 * 20260806180000) — inclusive na covardia: `count(distinct) = 1`, senão ninguém
 * é nomeado. Título de cartão sem lojista identificado NÃO entra em grupo
 * nenhum: "Cartão (lojista não identificado)" não é um fornecedor sobre o qual
 * alguém consiga decidir.
 *
 * O HISTÓRICO DO CARTÃO VEM DA FATURA, não do ERP. No Omie o histórico de
 * DATADOG não existe — todo gasto de cartão está sob o balde. Quem sabe se o
 * DATADOG apareceu em junho é `cartao_lancamentos`, que guarda o OFX importado.
 * As duas fontes entram no mesmo `union all`: chave do Omie para quem tem nome
 * no ERP, lojista para quem só existe na fatura. Não há dupla contagem porque o
 * título de cartão, no Omie, está sob um nome que esta função descarta.
 * ========================================================================== */

/* ----------------------------------------------------------------------------
 *  A decisão de um grupo
 *
 *  Uma linha, não uma por lançamento. O ajuste é UM ("os R$ 49 mil de Datadog"),
 *  e quem reparte em "só parte" reparte o conjunto — dividir a parcela devolvida
 *  entre seis títulos seria inventar um rateio que ninguém pediu e que nenhuma
 *  tela sabe desfazer. `cods` guarda de que títulos o grupo é feito: é o que
 *  impede o mesmo lançamento de ser contado duas vezes (uma no grupo, outra
 *  sozinho) e o que permite abrir a lista na tela.
 * -------------------------------------------------------------------------- */

alter table public.demonstracoes_ebitda_ajuste
  add column if not exists grupo text,          -- a chave do agrupamento ('datadog')
  add column if not exists cods  text[];        -- os títulos que o grupo consolida

comment on column public.demonstracoes_ebitda_ajuste.grupo is
  'Chave normalizada do fornecedor/lojista quando a decisão é sobre um conjunto de lançamentos. Nulo no ajuste por título e no avulso.';
comment on column public.demonstracoes_ebitda_ajuste.cods is
  'Títulos do Omie consolidados no grupo. A tela usa para não oferecer o mesmo lançamento duas vezes.';

/* Índice CHEIO, não parcial. O `on_conflict=col_key,grupo` do PostgREST vira
   `ON CONFLICT (col_key, grupo)` SEM predicado, e o Postgres se recusa a inferir
   um índice parcial sem repetir o `where` dele — foi o 42P10 que deixou a
   decisão por título sem gravar durante toda a vida da linha (migration
   20260806220000). NULL não conflita com NULL num unique, então ajuste avulso e
   ajuste por título (ambos com `grupo` nulo) continuam podendo repetir. */
create unique index if not exists demonstracoes_ebitda_ajuste_grupo_uk
  on public.demonstracoes_ebitda_ajuste (col_key, grupo);

-- O vínculo título → lojista pelo MEMO (ver `itens_base` abaixo) casa o texto
-- inteiro; sem este índice cada título de cartão varre a fatura de dois anos.
-- O irmão por valor, `cartao_lancamentos_valor2_idx`, veio na 20260806180000.
create index if not exists cartao_lancamentos_descricao_idx
  on public.cartao_lancamentos (descricao);

/* ============================================================================
 *  Candidatos a ajuste, agrupados
 *
 *  Três sinais, todos sobre o TOTAL DO MÊS de cada fornecedor contra os 12 meses
 *  anteriores dele:
 *
 *    grupo_novo        não aparece em nenhum dos 12 meses e já entra somando.
 *    grupo_esporadico  aparece em um ou dois dos doze.
 *    grupo_salto       aparece todo mês, mas este mês somou muito acima do
 *                      normal dele; o candidato é só o EXCESSO sobre a mediana
 *                      mensal — o que ele custa TODO mês continua no EBITDA.
 *
 *  Sem sinal de `palavra`: ela é do lançamento (rescisão, acordo, captação vêm
 *  em um título, não picadas em seis) e `ebitda_ajuste_candidatos` já a cobre.
 *
 *  Grupo é sempre 2+ lançamentos: um lançamento sozinho é candidato individual,
 *  e mostrá-lo aqui de novo seria a mesma sugestão em dois lugares.
 * ========================================================================== */

create or replace function public.ebitda_ajuste_grupos(
  p_mes      text,       -- 'Jul-26'
  p_rubricas text[],     -- rubricas que ficam ACIMA do EBITDA (vêm do esquema da tela)
  p_piso     numeric default 5000
)
returns table (
  grupo            text,
  contraparte      text,
  rubrica          text,
  categoria        text,
  lancamentos      integer,
  primeira         date,
  ultima           date,
  do_cartao        boolean,
  valor_lancamento numeric,   -- a soma como está no blob (despesa negativa)
  valor            numeric,   -- o add-back sugerido
  regra            text,
  motivo           text,
  forca            text,
  hist_meses       integer,
  hist_mediana     numeric,
  cods             text[],
  itens            jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  -- Mesma limpeza de nome do drill-down (migration 20260803210000).
  cli as (
    select distinct on (c->>'codigo')
      c->>'codigo' as codigo,
      coalesce(
        nullif(btrim(regexp_replace(
          regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
          '\s+\d{11}$', '')), ''),
        c->>'nome'
      ) as nome
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  base as (
    select
      b.*,
      (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
        [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY') as mes,
      (extract(year from b.dt) * 12 + extract(month from b.dt))::int as mi
    from (
      select
        det,
        case when upper(coalesce(det->>'cNatureza','R')) similar to '(P|D)%' then -1 else 1 end as sinal,
        -- EBITDA é DRE: competência, a mesma cadeia de fallback do omie-sync.
        to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'),''),'DD/MM/YYYY') as dt,
        det->>'cCodCateg' as codigo,
        (det->>'nValorTitulo')::numeric as bruto
      from mov
    ) b
    where b.dt is not null
      -- Sem nValorTitulo é a perna bancária do mesmo título: vale zero na DRE.
      and b.bruto is not null
      -- Dois anos: o mês pedido precisa de 12 meses de histórico ANTES dele.
      and b.dt >= (date_trunc('year', current_date) - interval '2 year')::date
      and b.dt <= current_date
  ),
  /* Contraparte de cada título, SEM o DE-PARA — mesma razão de
     `ebitda_ajuste_candidatos`: casar as duas expressões do DE-PARA sobre dois
     anos inteiros é o passo caro, e "quanto esta contraparte costuma custar" é
     nome e valor, não rubrica. */
  com_nome as (
    select
      b.*,
      coalesce(nullif(btrim(cli.nome), ''), f.nome) as contraparte,
      lower(btrim(regexp_replace(unaccent(
        coalesce(nullif(btrim(cli.nome),''), f.nome, nullif(b.det->>'cCPFCNPJCliente',''), 'cli:'||coalesce(b.det->>'nCodCliente','?'))
      ), '\s+', ' ', 'g'))) as chave
    from base b
    left join cli on cli.codigo = b.det->>'nCodCliente'
    left join lib_fornecedores f
      on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
         regexp_replace(coalesce(b.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
  ),
  -- Só o mês pedido paga o DE-PARA. Tudo qualificado com o alias: `rubrica`,
  -- `valor` e `categoria` também são nomes de SAÍDA desta função.
  mes_alvo as (
    select distinct on (n.det->>'nCodTitulo')
      n.det->>'nCodTitulo' as cod_titulo,
      n.dt, n.sinal, n.mi, n.chave, n.contraparte,
      coalesce(c.descricao, n.codigo) as categoria,
      dp.rubrica,
      abs(n.bruto) as valor
    from com_nome n
    left join cat c on c.codigo = n.codigo
    join omie_dre_mapa dp
      on dp.ativo is not false
     and dp.demonstrativo in ('dre', 'ambos')
     and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, n.codigo)), '\s+', ' ', 'g')))
    where n.mes = p_mes
    order by n.det->>'nCodTitulo', dp.rubrica
  ),
  /* ==========================================================================
   *  O lojista por trás do balde da fatura, por DOIS caminhos.
   *
   *  1) PELO MEMO DA OBSERVAÇÃO (preciso). O Omie cola o MEMO da fatura na
   *     observação do título, depois de um "|" — e `cartao_lancamentos.descricao`
   *     guarda esse MESMO memo cru, vindo do OFX. Então o vínculo é igualdade de
   *     texto, e o nome sai já canônico (`estabelecimento`), sem ninguém aqui
   *     precisar reimplementar o parser.
   *
   *     E reimplementá-lo em SQL é o que NÃO se pode fazer: `limparNome` (em
   *     `lib/cartao/ofx.ts`) transforma "ANTHROPIC* CLAUDE SU", "ANTHROPICV" e
   *     "CLAUDE.AI SUBSCRIPTI" no mesmo "ANTHROPIC". Um recorte ingênuo por
   *     coluna erra em 234 de 285 casos e quebraria o agrupamento justamente
   *     onde ele importa — o mesmo fornecedor viraria três grupos.
   *
   *  2) PELO VALOR + JANELA (reserva), o casamento da
   *     `demonstracoes_contrapartes`. Só entra quando o memo não resolveu, o que
   *     hoje é a maioria: a observação custa uma chamada ao Omie por título e só
   *     está em cache para quem já foi olhado (`omie_titulo_texto`).
   *
   *  Os dois são igualmente COVARDES (`count(distinct) = 1`, senão ninguém é
   *  nomeado). Em Jul-26 eles concordam em 123 de 123 títulos onde ambos
   *  respondem; juntos nomeiam 686 dos 732 (o valor sozinho nomeava 641, e os 45
   *  que o memo acrescenta valem R$ 32.342).
   *
   *  A PRIMEIRA CONDIÇÃO DE CADA LATERAL É O PORTÃO, e ela não olha `cl`: para o
   *  título que não é cartão o Postgres nem abre a fatura. E o filtro de rubrica
   *  mora AQUI, não numa CTE `alvo` no meio do caminho — com a CTE, `alvo` era
   *  referenciada duas vezes (pelo lateral e pelo join de volta), o Postgres a
   *  materializava, perdia a estimativa de linhas e trocava o índice de
   *  `round(valor,2)` por varredura: 7,6s contra os 0,19s desta forma.
   * ======================================================================== */
  itens_base as (
    select
      a.*,
      (lower(unaccent(a.contraparte)) like '%cartao%'
        and (lower(unaccent(a.contraparte)) like '%lancamento%'
          or lower(unaccent(a.contraparte)) like '%fatura%')) as do_cartao,
      coalesce(pm.lojista, pv.lojista) as lojista
    from mes_alvo a
    left join omie_titulo_texto tt on tt.cod_titulo::text = a.cod_titulo
    left join lateral (
      select case when count(distinct cl.estabelecimento) = 1
                  then min(cl.estabelecimento) end as lojista
      from cartao_lancamentos cl
      where lower(unaccent(a.contraparte)) like '%cartao%'
        and position('|' in coalesce(tt.observacao, '')) > 0
        -- o mesmo corte do `memoDaObservacao()`: tudo depois do ÚLTIMO "|", sem
        -- ltrim (o parser corta por POSIÇÃO de coluna, e um espaço a menos no
        -- começo desloca o nome inteiro). `(?s)` porque há quebra de linha antes.
        and cl.descricao = regexp_replace(tt.observacao, '(?s)^.*\|', '')
    ) pm on true
    left join lateral (
      select case when count(distinct cl.estabelecimento) = 1
                  then min(cl.estabelecimento) end as lojista
      from cartao_lancamentos cl
      where pm.lojista is null
        and lower(unaccent(a.contraparte)) like '%cartao%'
        and round(cl.valor, 2) = round(a.valor, 2)
        -- a janela é assimétrica porque a compra SEMPRE precede o título: a
        -- fatura fecha no fim do mês e o Omie registra no fechamento.
        and cl.data between a.dt - interval '75 days' and a.dt + interval '10 days'
    ) pv on true
    where a.rubrica = any(p_rubricas)
  ),
  /* Cartão sem lojista identificado não vira grupo. O balde da fatura juntaria
     num "grupo" de centenas de lançamentos tudo que foi pago no cartão naquela
     rubrica — um número grande sobre o qual ninguém consegue decidir nada. */
  elegiveis as (
    select
      i.*,
      coalesce(i.lojista, i.contraparte) as rotulo,
      coalesce(
        lower(btrim(regexp_replace(unaccent(i.lojista), '\s+', ' ', 'g'))),
        i.chave
      ) as gchave
    from itens_base i
    where not (i.do_cartao and i.lojista is null)
  ),
  /* Um grupo é (fornecedor, rubrica, sinal) dentro do mês. Rubrica porque a
     decisão guarda UMA rubrica e um grupo espalhado por três estaria mentindo em
     duas; sinal porque despesa e receita do mesmo nome não se somam. */
  g as (
    select
      e.gchave,
      e.rubrica,
      e.sinal,
      (array_agg(e.rotulo    order by e.valor desc))[1] as rotulo,
      (array_agg(e.categoria order by e.valor desc))[1] as categoria,
      bool_or(e.do_cartao)                              as do_cartao,
      count(*)::int                                     as n,
      sum(e.valor)                                      as total,
      min(e.dt)                                         as primeira,
      max(e.dt)                                         as ultima,
      max(e.mi)                                         as mi,
      array_agg(e.cod_titulo order by e.dt, e.cod_titulo) as cods,
      jsonb_agg(jsonb_build_object(
        'cod_titulo', e.cod_titulo,
        'data',       e.dt,
        'categoria',  e.categoria,
        'valor',      round(e.sinal * e.valor, 2)
      ) order by e.dt, e.cod_titulo)                    as itens
    from elegiveis e
    where e.gchave is not null and e.rotulo is not null
    group by e.gchave, e.rubrica, e.sinal
    having count(*) >= 2 and sum(e.valor) >= p_piso
  ),
  /* Histórico MENSAL do fornecedor. Restrito às chaves que formaram grupo e à
     janela de 12 meses — varrer os dois anos inteiros por chave era o que
     estourava o tempo na função irmã. Todos os grupos são do mesmo mês, então
     `max(mi)` é a âncora de todos. */
  janela as (select max(mi) as mi from g),
  /* ==========================================================================
   *  Até onde o histórico REALMENTE vai.
   *
   *  "Não aparece em nenhum dos 12 meses anteriores" é uma afirmação sobre o
   *  passado, e ela só vale se o passado estiver no banco. O `omie_cache` só tem
   *  densidade a partir de mar/26 (antes são 2 a 20 movimentos por mês, resto de
   *  carga antiga): pedir Abr-26 dava 34 "fornecedores novos" que são gente na
   *  folha desde sempre — o cache simplesmente não tinha os meses para
   *  desmenti-los. Um mês desses não é sinal fraco, é frase falsa, e ela sai
   *  daqui escrita dentro de um número que vai para o board.
   *
   *  Então o alcance é medido, não presumido, e cada fonte tem o seu: a fatura
   *  do cartão é densa desde dez/25, o ERP só desde mar/26. Os cortes (100
   *  movimentos, 20 linhas) separam mês de verdade de resíduo de importação.
   * ======================================================================== */
  cobertura as (
    select
      (select count(*) from (
        select 1 from base b, janela j
        where b.mi between j.mi - 12 and j.mi - 1
        group by b.mi having count(*) >= 100
      ) z) as meses_omie,
      (select count(*) from (
        select 1 from cartao_lancamentos cl, janela j
        where (extract(year from cl.data) * 12 + extract(month from cl.data))::int
              between j.mi - 12 and j.mi - 1
        group by (extract(year from cl.data) * 12 + extract(month from cl.data))::int
        having count(*) >= 20
      ) z) as meses_cartao
  ),
  hist_omie as (
    select n.chave as gchave, n.mi as m, sum(abs(n.bruto)) as tot
    from com_nome n, janela j
    where n.chave in (select gchave from g)
      and n.mi between j.mi - 12 and j.mi - 1
    group by 1, 2
  ),
  -- O que o ERP não sabe: no Omie o gasto de cartão está todo sob o balde, então
  -- o histórico de um lojista só existe na fatura importada.
  hist_cartao as (
    select
      lower(btrim(regexp_replace(unaccent(cl.estabelecimento), '\s+', ' ', 'g'))) as gchave,
      (extract(year from cl.data) * 12 + extract(month from cl.data))::int as m,
      sum(cl.valor) as tot
    from cartao_lancamentos cl, janela j
    where lower(btrim(regexp_replace(unaccent(cl.estabelecimento), '\s+', ' ', 'g')))
          in (select gchave from g)
      and (extract(year from cl.data) * 12 + extract(month from cl.data))::int
          between j.mi - 12 and j.mi - 1
    group by 1, 2
  ),
  hist as (
    select
      k.gchave,
      count(h.m)::int as n_meses,
      (percentile_cont(0.5) within group (order by h.tot))::numeric as mediana,
      -- o mês imediatamente anterior, que é o que separa pico de degrau
      sum(h.tot) filter (where h.m = (select mi - 1 from janela)) as anterior
    from (select distinct gchave from g) k
    left join (
      select * from hist_omie
      union all
      select * from hist_cartao
    ) h on h.gchave = k.gchave
    group by k.gchave
  ),
  marcado as (
    select
      g.*,
      h.n_meses,
      h.mediana,
      h.anterior,
      -- quantos meses de passado sustentam a afirmação, na fonte deste grupo
      case when g.do_cartao then c.meses_cartao else c.meses_omie end as alcance,
      case
        -- Sem passado suficiente não se afirma nada sobre o passado. Três meses
        -- é o mínimo para "não é gasto de todo mês" significar alguma coisa.
        when (case when g.do_cartao then c.meses_cartao else c.meses_omie end) < 3 then null
        when h.n_meses = 0 then 'grupo_novo'
        when h.n_meses <= 2 then 'grupo_esporadico'
        /* O SALTO SÓ VALE ONDE O RELÓGIO É O MESMO.
         *
         * O total do mês é competência do TÍTULO; o histórico de um lojista de
         * cartão é data de COMPRA, e o Omie registra a fatura com atraso
         * variável. Em Jul-26 o Airbnb somou 48 títulos (R$ 12.228) que são as
         * compras de maio e junho juntas, contra uma "mediana" de R$ 4.029/mês
         * — isso não é gasto fora do padrão, é o calendário. Comparar os dois
         * relógios produz um add-back inventado, e esta linha vai para o board.
         *
         * Fornecedor com nome no Omie não tem o problema: histórico e mês saem
         * do mesmo campo. E as duas regras de PRESENÇA continuam valendo no
         * cartão — "apareceu ou não apareceu" não depende de qual mês é.
         */
        when not g.do_cartao
             and h.mediana > 0
             and g.total >= 3 * h.mediana
             and (g.total - h.mediana) >= p_piso
             /* Subir e FICAR é mudança de patamar, não atraso: o Google Ads
                dobrou em junho (R$ 15.165) e repetiu em julho (R$ 15.059). A
                mediana de 12 meses, puxada para baixo pelos meses antigos, faz
                degrau parecer pico — e devolver um degrau ao EBITDA esconde um
                custo que a operação passou a ter. */
             and coalesce(h.anterior, 0) < 0.6 * g.total
          then 'grupo_salto'
      end as regra_calc
    from g
    join hist h on h.gchave = g.gchave
    cross join cobertura c
  )
  select
    m.gchave      as grupo,
    m.rotulo      as contraparte,
    m.rubrica,
    m.categoria,
    m.n           as lancamentos,
    m.primeira,
    m.ultima,
    m.do_cartao,
    round(m.sinal * m.total, 2) as valor_lancamento,
    -- Add-back: no salto só o excesso sobre o que o fornecedor custa todo mês.
    round(case when m.regra_calc = 'grupo_salto'
      then -m.sinal * (m.total - m.mediana)
      else -m.sinal * m.total
    end, 2) as valor,
    m.regra_calc as regra,
    /* Os motivos NÃO repetem o total de propósito: quando um dos lançamentos do
       grupo já foi decidido sozinho, a tela tira ele da conta e recalcula — uma
       frase com o total dentro passaria a mentir. Total e período estão no
       cartão, ao lado. `G`/`D` no to_char leem lc_numeric do banco (en_US) e
       sairiam "R$ 4.029,19" como "R$ 4,029.19": formata-se em US e inverte-se os
       separadores com translate. */
    case m.regra_calc
      /* Os meses são o ALCANCE medido, não "12": prometer doze quando o
         histórico tem quatro é a diferença entre uma conferência e um chute. */
      when 'grupo_novo' then format(
        '%s não aparece em nenhum dos %s meses anteriores que o histórico cobre, e neste mês vem em %s cobranças.',
        coalesce(m.rotulo, 'Esta contraparte'), m.alcance, m.n)
      when 'grupo_esporadico' then format(
        '%s apareceu em %s dos %s meses anteriores que o histórico cobre — não é gasto de todo mês — e neste mês vem em %s cobranças.',
        coalesce(m.rotulo, 'Esta contraparte'), m.n_meses, m.alcance, m.n)
      when 'grupo_salto' then format(
        '%s costuma custar R$ %s por mês (mediana de %s meses) e no mês anterior custou R$ %s; neste mês vem em %s cobranças. O que passa da mediana é o atraso; o resto é gasto normal de %s.',
        coalesce(m.rotulo, 'Esta contraparte'),
        translate(to_char(m.mediana, 'FM999,999,999,990.00'), '.,', ',.'),
        m.n_meses,
        translate(to_char(coalesce(m.anterior, 0), 'FM999,999,999,990.00'), '.,', ',.'),
        m.n, p_mes)
    end as motivo,
    case
      when m.total >= 5 * p_piso then 'alta'
      when m.total >= 2 * p_piso then 'media'
      else 'baixa'
    end as forca,
    m.n_meses    as hist_meses,
    m.mediana    as hist_mediana,
    m.cods,
    m.itens
  from marcado m
  where m.regra_calc is not null
  order by m.total desc;
$$;

revoke all on function public.ebitda_ajuste_grupos(text, text[], numeric) from public;
revoke execute on function public.ebitda_ajuste_grupos(text, text[], numeric) from anon;
grant execute on function public.ebitda_ajuste_grupos(text, text[], numeric) to authenticated, service_role;

-- `cartao_lancamentos` tem RLS; a função é `security definer` e devolve o NOME do
-- lojista agregado, nunca a linha da fatura.