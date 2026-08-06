/* ============================================================================
 * Cartão → Omie: o de-para de categoria e as travas contra lançar duas vezes.
 *
 * O QUE ESTA MIGRATION HABILITA
 * A fatura do cartão chega com três tipos de linha misturados, e hoje a
 * separação é manual: parcela de 2 em diante já foi provisionada e não pode
 * voltar; compra à vista entra no mês; 1ª parcela de N tem de virar N títulos.
 * O parser (`src/lib/cartao/ofx.ts`) já separa. O que falta é (a) saber em qual
 * categoria do Omie cada lojista cai e (b) garantir que nada seja lançado duas
 * vezes. É o que entra aqui.
 *
 * A ORDEM DAS TRAVAS IMPORTA, porque o risco não é simétrico: deixar de lançar
 * é um erro que aparece no fechamento; lançar duas vezes some dentro de 337 mil
 * reais de fatura. Por isso são três camadas independentes:
 *
 *   1. `cartao_faturas.provisionamento` — as faturas até ago/26 foram lançadas
 *      no Omie À MÃO, fora do Hub. O Hub não tem como saber disso sozinho, então
 *      é dado, não configuração: nascem travadas e nem oferecem o botão.
 *   2. `cartao_omie_titulos()` — antes de enviar, a tela procura no cache do
 *      Omie um título com o mesmo valor e data próxima. Pega inclusive o que foi
 *      lançado à mão no meio de um mês que o Hub controla.
 *   3. `cartao_envios_omie` + `codigo_lancamento_integracao` — o Omie recusa
 *      integração repetida. Última linha de defesa, contra clique duplo e
 *      reimportação do mesmo arquivo.
 *
 * NADA AQUI FALA COM O OMIE. Toda leitura é do `omie_cache` já baixado — dá para
 * rodar em pleno fechamento sem gastar uma chamada de API.
 * ========================================================================== */


/* ============================================================
 *  1. A trava do que já foi lançado à mão
 * ============================================================ */

alter table public.cartao_faturas
  add column if not exists provisionamento text not null default 'pendente';

do $$
begin
  alter table public.cartao_faturas
    add constraint cartao_faturas_provisionamento_chk
    check (provisionamento in ('pendente', 'fora_do_hub', 'enviado'));
exception when duplicate_object then null;
end $$;

/*
 * O MARCO. Toda fatura até esta competência foi lançada no Omie fora do Hub.
 *
 * É constante e não parâmetro de propósito: quem opera a tela não deve poder
 * "destravar julho" num momento de pressa. Mover o marco é mudar o código, com
 * revisão — que é a fricção certa para uma decisão que pode duplicar um mês
 * inteiro de despesa.
 */
create or replace function public.cartao_marco_provisionamento()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.competencia <= date '2026-08-01' then
    new.provisionamento := 'fora_do_hub';
  end if;
  return new;
end;
$$;

drop trigger if exists cartao_faturas_marco on public.cartao_faturas;
create trigger cartao_faturas_marco
  before insert or update on public.cartao_faturas
  for each row execute function public.cartao_marco_provisionamento();

-- Reimportar uma fatura antiga passa pelo trigger e continua travada.
update public.cartao_faturas
   set provisionamento = 'fora_do_hub'
 where competencia <= date '2026-08-01'
   and provisionamento <> 'fora_do_hub';


/* ============================================================
 *  2. O de-para: lojista da fatura → categoria do Omie
 * ============================================================
 * A chave NÃO é o nome que vem na fatura — é a `chave` normalizada por
 * `chaveDe()` (src/lib/cartao/ofx.ts), que funde as variantes do mesmo lojista:
 * "MP*MERCADOLIVREV", "EC *MERCADOLIVREV" e "MERCADOLIVRE*MERCADO" viram
 * MERCADOLIVRE. Sem essa fusão o de-para nunca aprenderia — a fatura de julho
 * tem 94 lojistas distintos depois de fundir e várias centenas antes.
 *
 * `origem` é o que a tela usa para decidir o que exigir de conferência:
 *   historico → saiu do que a analista já lançou no Omie nos meses passados;
 *   manual    → alguém escolheu na tela (vence sempre; é a palavra final);
 *   ia        → sugestão para lojista novo, que NUNCA entra sem confirmação.
 */
create table if not exists public.cartao_omie_map (
  chave                text primary key,
  codigo_categoria     text not null,
  descricao_categoria  text,
  origem               text not null default 'manual'
                       check (origem in ('historico', 'manual', 'ia')),
  -- Quantos lançamentos do histórico sustentam esta categoria e quantos foram
  -- examinados. "8 de 9" é uma coisa; "1 de 1", outra — e a tela mostra a
  -- diferença em vez de fingir que toda sugestão vale o mesmo.
  votos                int not null default 0,
  examinados           int not null default 0,
  -- Nomes crus que caíram nesta chave, para conferir a fusão a olho.
  exemplos             text[] not null default '{}',
  atualizado_em        timestamptz not null default now(),
  atualizado_por       uuid
);

create index if not exists cartao_omie_map_categoria_idx
  on public.cartao_omie_map (codigo_categoria);

alter table public.cartao_omie_map enable row level security;

drop policy if exists "cartao_omie_map_select_auth" on public.cartao_omie_map;
create policy "cartao_omie_map_select_auth"
  on public.cartao_omie_map for select to authenticated using (true);


/* ============================================================
 *  3. O registro do que o Hub mandou para o Omie
 * ============================================================
 * Existe desde já, vazia, porque é ela que responde "esta parcela já subiu?".
 * A tela de envio (ainda não construída) escreve aqui DEPOIS de o Omie
 * confirmar, nunca antes: uma linha aqui significa título existente lá.
 *
 * `integracao` é o `codigo_lancamento_integracao` mandado ao Omie —
 * "CARTAO-<fitid>-<parcela>". Ser PK aqui e único lá são duas travas para o
 * mesmo erro, propositalmente redundantes.
 */
create table if not exists public.cartao_envios_omie (
  integracao       text primary key,
  fitid            text not null,
  competencia      date not null,
  parcela_n        int,
  parcela_de       int,
  chave            text,
  estabelecimento  text,
  codigo_categoria text,
  valor            numeric not null,
  vencimento       date,
  cod_titulo       text,                    -- devolvido pelo Omie
  status           text not null default 'enviado'
                   check (status in ('enviado', 'erro', 'cancelado')),
  erro             text,
  enviado_em       timestamptz not null default now(),
  enviado_por      uuid
);

create index if not exists cartao_envios_omie_comp_idx on public.cartao_envios_omie (competencia);
create index if not exists cartao_envios_omie_fitid_idx on public.cartao_envios_omie (fitid);

alter table public.cartao_envios_omie enable row level security;

drop policy if exists "cartao_envios_omie_select_auth" on public.cartao_envios_omie;
create policy "cartao_envios_omie_select_auth"
  on public.cartao_envios_omie for select to authenticated using (true);


/* ============================================================
 *  4. Os títulos do Omie, do jeito que o cache já os tem
 * ============================================================
 * Serve a DUAS coisas ao mesmo tempo, e por isso devolve linha a linha em vez
 * de um resumo:
 *
 *   • aprender o de-para — casar cada lançamento das faturas já importadas com
 *     o título que a analista lançou, e ver que categoria ela usou;
 *   • conferir duplicidade — antes de enviar, procurar um título com o mesmo
 *     valor por perto da mesma data.
 *
 * Só CONTA_A_PAGAR: é onde despesa de cartão mora. Movimentos sem
 * `nValorTitulo` são a perna bancária do mesmo título e entrariam em dobro.
 */
create or replace function public.cartao_omie_titulos(p_de date, p_ate date)
returns table (
  cod_titulo          text,
  data                date,
  valor               numeric,
  codigo_categoria    text,
  descricao_categoria text,
  contraparte         text,
  documento           text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  cli as (
    select distinct on (c->>'codigo') c->>'codigo' as codigo, c->>'nome' as nome
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
      and m->'detalhes'->>'nValorTitulo' is not null
      and m->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
  )
  select
    det->>'nCodTitulo' as cod_titulo,
    to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'), ''), 'DD/MM/YYYY') as data,
    (det->>'nValorTitulo')::numeric as valor,
    det->>'cCodCateg' as codigo_categoria,
    cat.descricao as descricao_categoria,
    cli.nome as contraparte,
    nullif(det->>'cNumDocFiscal', '') as documento
  from mov
  left join cat on cat.codigo = det->>'cCodCateg'
  left join cli on cli.codigo = det->>'nCodCliente'
  where to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'), ''), 'DD/MM/YYYY')
        between p_de and p_ate;
$$;


/* ============================================================
 *  5. Gravar o de-para
 * ============================================================
 * `p_itens` = [{ chave, codigo_categoria, descricao_categoria, origem, votos,
 *                examinados, exemplos: [...] }]
 *
 * Uma escolha MANUAL nunca é sobrescrita por aprendizado ou por IA: quem
 * corrigiu na tela já viu o que o histórico dizia e discordou. O caminho de
 * volta é corrigir de novo na tela, não uma re-semeadura silenciosa.
 */
create or replace function public.cartao_omie_map_gravar(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  insert into public.cartao_omie_map as m
    (chave, codigo_categoria, descricao_categoria, origem, votos, examinados, exemplos, atualizado_em, atualizado_por)
  select
    btrim(i->>'chave'),
    btrim(i->>'codigo_categoria'),
    nullif(btrim(i->>'descricao_categoria'), ''),
    coalesce(nullif(i->>'origem', ''), 'manual'),
    coalesce((i->>'votos')::int, 0),
    coalesce((i->>'examinados')::int, 0),
    coalesce(
      (select array_agg(e) from jsonb_array_elements_text(coalesce(i->'exemplos', '[]'::jsonb)) e),
      '{}'
    ),
    now(),
    auth.uid()
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
  where nullif(btrim(i->>'chave'), '') is not null
    and nullif(btrim(i->>'codigo_categoria'), '') is not null
  on conflict (chave) do update set
    codigo_categoria    = excluded.codigo_categoria,
    descricao_categoria = excluded.descricao_categoria,
    origem              = excluded.origem,
    votos               = excluded.votos,
    examinados          = excluded.examinados,
    exemplos            = excluded.exemplos,
    atualizado_em       = now(),
    atualizado_por      = excluded.atualizado_por
  where m.origem <> 'manual' or excluded.origem = 'manual';

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'gravados', v_n);
end;
$$;


/* ============================================================
 *  6. Permissões
 * ============================================================
 * Função nova em `public` nasce chamável por `anon` (o grant vem do papel
 * PUBLIC). Como estas leem o financeiro inteiro e escrevem classificação,
 * revogar de `anon` é obrigatório — e é revogação nominal, uma a uma: um
 * `revoke ... from anon` em bloco derrubaria as `*_via_token`, que são anon de
 * propósito.
 */
revoke all on function public.cartao_omie_titulos(date, date) from public;
revoke all on function public.cartao_omie_titulos(date, date) from anon;
grant execute on function public.cartao_omie_titulos(date, date) to authenticated;

revoke all on function public.cartao_omie_map_gravar(jsonb) from public;
revoke all on function public.cartao_omie_map_gravar(jsonb) from anon;
grant execute on function public.cartao_omie_map_gravar(jsonb) to authenticated;
