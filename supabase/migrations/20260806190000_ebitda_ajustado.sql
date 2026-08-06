/* ============================================================================
 * EBITDA Ajustado: o EBITDA sem os eventos que não se repetem.
 *
 * O PROBLEMA. O EBITDA de um mês desaba porque saiu uma rescisão de R$ 60 mil,
 * ou salta porque um fornecedor anual foi pago naquele mês. Quem lê a linha não
 * tem como saber: o número é o mesmo, venha de onde vier. A conversa com
 * investidor, com o board e com o próprio BP é sempre sobre o EBITDA
 * RECORRENTE — o que a operação faz num mês normal.
 *
 * A DECISÃO É HUMANA, O GARIMPO É DA MÁQUINA. Um one-off quase nunca tem
 * categoria própria no Omie: a rescisão entra em "Equipe Comercial", o
 * advogado entra em "Assessorias & Consultorias". Não dá para marcar rubrica
 * inteira. O que dá é olhar lançamento por lançamento contra o histórico do
 * próprio fornecedor — e é exatamente isso que `ebitda_ajuste_candidatos` faz,
 * devolvendo cada candidato COM O MOTIVO de ter sido levantado. Quem decide se
 * é ajuste é quem fecha o mês; a função só serve a lista.
 *
 * O QUE FICA GUARDADO É A DECISÃO, NÃO A SUGESTÃO. Sugestão é derivada: sai do
 * cache do Omie e muda quando o cache muda. Materializá-la só criaria mais uma
 * cópia para envelhecer. A tabela abaixo guarda o que a máquina não sabe
 * refazer: o "isto é não recorrente, e por causa disto", com autor e data.
 *
 * SINAL. `valor` é o que É SOMADO ao EBITDA — o add-back. Despesa não
 * recorrente está no blob como -48.000, então o ajuste é +48.000; receita não
 * recorrente de +30.000 vira -30.000. Guardar já somável evita que cada leitor
 * (blob, tela, IA) precise reinventar a inversão de sinal — e errar.
 * ========================================================================== */

create table if not exists public.demonstracoes_ebitda_ajuste (
  id             uuid primary key default gen_random_uuid(),
  col_key        text not null,                       -- 'Jun-26', a chave de coluna da tela

  -- 'aceito' entra na linha; 'recusado' fica guardado para o mesmo candidato não
  -- voltar a piscar toda vez que alguém abre o painel.
  status         text not null check (status in ('aceito','recusado')),
  origem         text not null default 'sugestao' check (origem in ('sugestao','manual')),

  -- De onde saiu o número. Nulos no ajuste avulso (provisão, estorno, algo que
  -- não tem título no Omie).
  cod_titulo     text,
  rubrica        text,                                -- rubrica da DRE onde o lançamento caiu
  contraparte    text,
  data           date,
  valor_lancamento numeric,                           -- como está no blob (despesa negativa)

  -- O add-back: quanto isto SOMA ao EBITDA. Num salto contra o histórico é só o
  -- excesso — o fornecedor de R$ 3 mil/mês que veio R$ 48 mil tem R$ 45 mil de
  -- não recorrente, não R$ 48 mil.
  valor          numeric not null,

  descricao      text not null,                       -- por que não se repete (vai para a tela e para a IA)
  regra          text,                                -- heurística que levantou o candidato
  motivo_sugestao text,                               -- o que a máquina viu, em português

  autor          uuid,
  autor_email    text,
  decidido_em    timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Um lançamento é decidido uma vez por mês. Índice PARCIAL porque ajuste avulso
-- não tem título, e `unique` deixaria passar quantos nulos quisessem.
create unique index if not exists demonstracoes_ebitda_ajuste_titulo_uk
  on public.demonstracoes_ebitda_ajuste (col_key, cod_titulo)
  where cod_titulo is not null;

create index if not exists demonstracoes_ebitda_ajuste_mes_idx
  on public.demonstracoes_ebitda_ajuste (col_key, status);

alter table public.demonstracoes_ebitda_ajuste enable row level security;

-- Leitura: qualquer pessoa logada — a tela precisa listar os ajustes do mês.
drop policy if exists "auth read demonstracoes_ebitda_ajuste" on public.demonstracoes_ebitda_ajuste;
create policy "auth read demonstracoes_ebitda_ajuste"
  on public.demonstracoes_ebitda_ajuste for select to authenticated using (true);

-- Escrita: só pela service role, na edge function `demonstracoes-ebitda-ajuste`.
-- Mesmo motivo do valor manual: gravar a decisão sem reescrever a linha do blob
-- deixaria a tabela dizendo uma coisa e a DRE mostrando outra.

/* ============================================================================
 *  Candidatos
 *
 *  Quatro sinais, todos contra o histórico do PRÓPRIO fornecedor nos 12 meses
 *  anteriores ao mês pedido — nunca contra uma média da empresa, que misturaria
 *  aluguel com rescisão:
 *
 *    contraparte_nova  fornecedor que nunca apareceu antes e já entra grande.
 *    esporadico        aparece uma ou duas vezes em doze meses.
 *    salto             fornecedor recorrente que veio muito acima da mediana
 *                      dele; o candidato é só o EXCESSO.
 *    palavra           o texto do título fala de rescisão, acordo, indenização,
 *                      captação, aquisição — coisas que por definição não se
 *                      repetem. É o único sinal que pega gasto de cartão, cuja
 *                      contraparte é sempre o balde "Lancamento Fatura Cartao"
 *                      e cujo histórico, portanto, não diz nada.
 *
 *  Os três primeiros descartam contraparte-balde pelo espalhamento do mês (mais
 *  de 3 rubricas num mês só não é fornecedor, é rótulo guarda-chuva) — o mesmo
 *  corte que derrubou 618 alertas de reclassificação para 91.
 * ========================================================================== */

create or replace function public.ebitda_ajuste_candidatos(
  p_mes      text,       -- 'Jun-26'
  p_rubricas text[],     -- rubricas que ficam ACIMA do EBITDA (vêm do esquema da tela)
  p_piso     numeric default 5000
)
returns table (
  cod_titulo       text,
  data             date,
  rubrica          text,
  contraparte      text,
  cnpj_cpf         text,
  categoria        text,
  texto            text,
  valor_lancamento numeric,
  valor            numeric,
  regra            text,
  motivo           text,
  forca            text,
  hist_lancamentos integer,
  hist_mediana     numeric
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
  /* Contraparte de cada título, SEM o DE-PARA.
     O join do DE-PARA casa duas expressões (unaccent + regexp) e é o passo caro:
     rodá-lo sobre os dois anos inteiros estourava 55s. E ele não é necessário
     aqui — "quanto esta contraparte costuma custar" é nome e valor, não rubrica.
     De quebra o histórico fica mais honesto: um fornecedor que só aparecia numa
     rubrica ABAIXO do EBITDA deixa de ser anunciado como fornecedor novo. */
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
  -- `data` e `valor` também são nomes de SAÍDA desta função, e coluna solta com
  -- esse nome vira "reference is ambiguous".
  mes_alvo as (
    select distinct on (n.det->>'nCodTitulo')
      n.det->>'nCodTitulo' as cod_titulo,
      n.dt, n.sinal, n.mi, n.chave, n.contraparte,
      nullif(n.det->>'cCPFCNPJCliente','') as cnpj_cpf,
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
  alvo as (
    select m.* from mes_alvo m where m.rubrica = any(p_rubricas)
  ),
  /* Histórico da contraparte nos 12 meses anteriores — por CONTRAPARTE, nunca
     por título. Todos os títulos de um mesmo fornecedor no mesmo mês olham para
     a mesma janela, então agrupar por título multiplicava o trabalho pelo número
     de lançamentos dele: "Lancamento Fatura Cartao" tem centenas num mês e
     milhares no histórico, e o produto dos dois (milhões de linhas entrando num
     percentile_cont) estourava 55 segundos. Por contraparte, o histórico inteiro
     é varrido uma vez só. */
  chaves_alvo as (
    select distinct a.chave, a.mi from alvo a
  ),
  hist as (
    select k.chave,
           count(h.chave)::int as n,
           (percentile_cont(0.5) within group (order by abs(h.bruto)))::numeric as mediana
    from chaves_alvo k
    left join com_nome h
      on h.chave = k.chave
     and h.mi between k.mi - 12 and k.mi - 1
    group by k.chave
  ),
  -- Espalhamento DO PRÓPRIO MÊS: quem abre em mais de 3 rubricas não é
  -- fornecedor, é rótulo guarda-chuva (a fatura de cartão abriu em 15 de uma vez).
  espalhamento as (
    select m.chave, count(distinct m.rubrica) as rubricas_mes
    from mes_alvo m group by 1
  ),
  sinais as (
    select
      a.*,
      h.n as hist_n,
      h.mediana,
      t.observacao,
      e.rubricas_mes,
      -- Palavras que descrevem evento único. Deliberadamente estreitas: "multa"
      -- e "acordo" sozinhos pegariam multa de trânsito e acordo comercial, que
      -- se repetem todo mês.
      lower(unaccent(
        coalesce(a.contraparte,'') || ' ' || coalesce(a.categoria,'') || ' ' || coalesce(t.observacao,'')
      )) ~ ('(rescis|verba rescis|indeniz|demiss|desligamento|homologac|reclamat|trabalhist'
         || '|advocat|honorario advocat|juridic|arbitr|processo judic|acordo judic|acordo extrajud'
         || '|captacao|due diligence|valuation|aquisic|fusao|incorporac'
         || '|mudanca de sede|reforma|obra civil|multa de mora|multa contratual)') as palavra
    from alvo a
    join hist h on h.chave = a.chave
    join espalhamento e on e.chave = a.chave
    left join omie_titulo_texto t on t.cod_titulo::text = a.cod_titulo
  ),
  marcado as (
    select
      s.*,
      case
        -- Ordem importa: o salto é mais preciso que a palavra (devolve só o
        -- excesso), então vem antes dela.
        when s.hist_n = 0 and s.valor >= p_piso and s.rubricas_mes <= 3
          then 'contraparte_nova'
        when s.hist_n between 1 and 2 and s.valor >= p_piso and s.rubricas_mes <= 3
          then 'esporadico'
        when s.hist_n >= 3 and s.mediana > 0 and s.valor >= 3 * s.mediana
             and (s.valor - s.mediana) >= p_piso and s.rubricas_mes <= 3
          then 'salto'
        -- A palavra não exige o piso cheio: rescisão pequena continua sendo
        -- rescisão, e é o único sinal que alcança o gasto de cartão.
        when s.palavra and s.valor >= greatest(p_piso / 5, 500)
          then 'palavra'
      end as regra_calc
    from sinais s
  )
  select
    m.cod_titulo,
    m.dt as data,
    m.rubrica,
    m.contraparte,
    m.cnpj_cpf,
    m.categoria,
    m.observacao as texto,
    m.sinal * m.valor as valor_lancamento,
    -- Add-back: no salto só o excesso; nos demais, o lançamento inteiro. Em
    -- centavos porque é isto que vai para o blob, e lá o total é arredondado —
    -- a mediana sai com três casas e a linha não fecharia com a soma.
    round(case when m.regra_calc = 'salto'
      then -m.sinal * (m.valor - m.mediana)
      else -m.sinal * m.valor
    end, 2) as valor,
    m.regra_calc as regra,
    /* `G` e `D` no to_char leem lc_numeric do banco, que aqui é en_US: sairia
       "R$ 48,000.00" no meio de uma frase em português. `,` e `.` no padrão são
       literais fixos, então formata-se em US e troca-se os dois com translate. */
    case m.regra_calc
      when 'contraparte_nova' then format(
        '%s nunca apareceu nos 12 meses anteriores e já entra com R$ %s.',
        coalesce(m.contraparte, 'Esta contraparte'),
        translate(to_char(m.valor, 'FM999,999,999,990.00'), '.,', ',.'))
      when 'esporadico' then format(
        '%s apareceu %s vez(es) em 12 meses — não é gasto de todo mês.',
        coalesce(m.contraparte, 'Esta contraparte'), m.hist_n)
      when 'salto' then format(
        '%s costuma vir R$ %s (mediana de %s lançamentos) e neste mês veio R$ %s — R$ %s acima do normal.',
        coalesce(m.contraparte, 'Esta contraparte'),
        translate(to_char(m.mediana, 'FM999,999,999,990.00'), '.,', ',.'), m.hist_n,
        translate(to_char(m.valor, 'FM999,999,999,990.00'), '.,', ',.'),
        translate(to_char(m.valor - m.mediana, 'FM999,999,999,990.00'), '.,', ',.'))
      when 'palavra' then format(
        'O texto do lançamento descreve um evento único (rescisão, acordo, captação e afins): %s',
        left(coalesce(nullif(btrim(m.observacao), ''), m.categoria, ''), 160))
    end as motivo,
    case
      when m.valor >= 5 * p_piso then 'alta'
      when m.valor >= 2 * p_piso then 'media'
      else 'baixa'
    end as forca,
    m.hist_n as hist_lancamentos,
    m.mediana as hist_mediana
  from marcado m
  where m.regra_calc is not null
  order by m.valor desc;
$$;

revoke all on function public.ebitda_ajuste_candidatos(text, text[], numeric) from public;
revoke execute on function public.ebitda_ajuste_candidatos(text, text[], numeric) from anon;
grant execute on function public.ebitda_ajuste_candidatos(text, text[], numeric) to authenticated, service_role;
