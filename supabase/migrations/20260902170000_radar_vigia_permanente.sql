-- Radar: a vigia permanente — o produto que se olha sempre, e o momento em que
-- se vai comprar de verdade.
--
-- O PROBLEMA. Um alvo do radar só tinha dois estados: `ativo` (quatro varreduras
-- por dia, cinco fontes, conferência de estoque e frete, quarentena, aviso) ou
-- `ativo = false` (não olha nada e a curva congela). Não havia meio-termo — e o
-- meio-termo é justamente o caso mais comum do Facilities: monitor, notebook,
-- headset, mouse e teclado são o kit de estação, comprados o ano inteiro, e
-- ninguém quer um aviso deles hoje. O que se quer é CHEGAR na compra sabendo se
-- o preço de hoje é bom.
--
-- A CONTA QUE DECIDIU O DESENHO. No ritmo `ativo`, um alvo custa 5 fontes × 4
-- rodadas × 30 dias ≈ 600 créditos de Firecrawl por mês, mais a conferência. Os
-- seis do kit custariam 3.600 num plano de 5.000 rateado com editais, cadastro
-- de CNPJ, vigilância de páginas e sinal de churn — ou seja, a vigia permanente
-- comeria o orçamento de todo mundo. No ritmo desta migração (2 fontes, uma
-- rodada por semana, sem conferência), o mesmo alvo custa ~9 créditos por mês.
-- É a diferença entre inviável e irrelevante, e ela não vem de vigiar menos
-- produtos: vem do REGIME.
--
-- E O REGIME COUBE PORQUE A CURVA JÁ ERA GRAVADA NA VARREDURA. O histórico de
-- preço (`facilities_radar_precos`) é escrito no upsert das ofertas, dentro de
-- `varrerAlvo` — não na conferência. Então a vigia muda produz histórico
-- COMPLETO sem gastar um único crédito da metade cara (abrir o anúncio um a um,
-- `maxAge: 0`, digitar o CEP). Se a curva dependesse da conferência, nada disto
-- seria barato e esta migração não existiria.
--
-- TRÊS ESTADOS, e o terceiro é o que faltava:
--
--   1. FAIXA em vigia — "Monitor 24–27\" IPS". Muda: nenhum aviso, nenhuma
--      conferência, duas fontes, uma vez por semana. Só engorda a curva.
--   2. MODELO ADOTADO — nasce de uma oferta que alguém gostou, aponta para a
--      faixa em `pai_id` e corre no mesmo regime barato. A curva dele se lê
--      SOBRE a da faixa: "o MX Master está 12% acima da mediana de mouse".
--   3. COMPRA — o ritmo de sempre. Liga por botão ou pela Solicitação, e volta
--      a dormir sozinho quando `compra_ate` vence.
--
-- O QUE A VIGIA ACEITA EM TROCA DO PREÇO. Sem conferência, a curva inclui
-- anúncio esgotado que a vitrine ainda lista com o último preço praticado — o
-- fantasma que este módulo persegue em todos os outros lugares. Aqui ele é
-- aceito de propósito: a vigia responde "o mercado está caro?", não "dá para
-- comprar este?". No dia em que o alvo entra em compra, a conferência liga e os
-- fantasmas morrem antes de qualquer decisão. A tela precisa dizer isso, e diz.
--
-- CAFÉ E LIMPEZA CONTINUAM FORA, e agora por regra e não por combinado. A Takeat
-- tem fornecedor fechado dos dois; o barateamento desta migração tornaria
-- tentador ligar a vigia neles, e a decisão de 28/08/2026 não mudou. O check
-- abaixo mora no banco porque é onde ele não se esquece.

/* ====================================================== as três colunas */

-- 'compra' é o padrão, e é o que preserva o comportamento de hoje: todo alvo
-- que já existe continua exatamente no ritmo em que estava. Esta migração não
-- muda nada sozinha — ela abre a porta do outro regime.
alter table public.facilities_radar_alvos
  add column if not exists modo text not null default 'compra',
  -- A faixa de que este alvo é um modelo específico. `on delete cascade` seria
  -- errado: apagar a faixa não pode levar junto a curva do modelo, que é
  -- histórico legítimo de mercado e o que a próxima compra vai consultar.
  add column if not exists pai_id uuid references public.facilities_radar_alvos(id) on delete set null,
  -- Até quando este alvo fica em modo compra. NULL em duas situações opostas:
  -- o alvo de vigia (que não está em compra) e o alvo que sempre foi de compra
  -- (cadastrado para uma aquisição específica, e que ninguém quer ver dormir).
  -- É essa ambiguidade útil que faz `dormir_expirados` mexer só em quem foi
  -- ACORDADO — ver lá embaixo.
  add column if not exists compra_ate timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_modo_conhecido') then
    alter table public.facilities_radar_alvos
      add constraint radar_modo_conhecido check (modo in ('vigia', 'compra'));
  end if;

  -- A PROIBIÇÃO DO CAFÉ, escrita onde não se esquece. `specs.unidade` é o que
  -- liga o modo de compra recorrente (preço por quilo/litro/peça) — é, na
  -- prática, a definição de consumível neste módulo. Varredura pontual continua
  -- valendo: o que não pode é ficar ligado.
  if not exists (select 1 from pg_constraint where conname = 'radar_vigia_nao_e_consumivel') then
    alter table public.facilities_radar_alvos
      add constraint radar_vigia_nao_e_consumivel
      check (modo <> 'vigia' or (specs->>'unidade') is null);
  end if;

  -- Um modelo adotado não pode ser pai de outro: a árvore tem dois níveis de
  -- propósito. Três níveis dariam a mesma curva contada duas vezes e uma tela
  -- que ninguém lê.
  if not exists (select 1 from pg_constraint where conname = 'radar_pai_nao_e_o_proprio') then
    alter table public.facilities_radar_alvos
      add constraint radar_pai_nao_e_o_proprio check (pai_id is null or pai_id <> id);
  end if;
end $$;

comment on column public.facilities_radar_alvos.modo is
  'vigia = curva permanente, muda e barata (2 fontes, semanal, sem conferência nem aviso); compra = o ritmo cheio, com conferência e aviso.';
comment on column public.facilities_radar_alvos.pai_id is
  'A faixa de que este alvo é um modelo específico. A curva do filho se lê sobre a do pai.';
comment on column public.facilities_radar_alvos.compra_ate is
  'Quando o modo compra expira e o alvo volta à vigia. Só é preenchido em alvo ACORDADO — alvo que nasceu de compra fica com null e nunca dorme sozinho.';

-- A fila de vigia é lida por modo e por cadência; a de compra, idem. O índice
-- antigo (ativo, favorito, ultima_varredura) não cobre o corte por modo, que
-- passa a ser a primeira coisa que as duas filas perguntam.
create index if not exists idx_radar_alvos_modo
  on public.facilities_radar_alvos (modo, ativo, favorito desc, ultima_varredura nulls first);
create index if not exists idx_radar_alvos_pai
  on public.facilities_radar_alvos (pai_id) where pai_id is not null;

/* ================================================= as duas filas, em raias */

-- POR QUE RAIA SEPARADA, E NÃO A MESMA FILA COM CADÊNCIA MAIOR.
--
-- Cada chamada da varredura cobre no máximo DOIS alvos — não por escolha, mas
-- porque o worker morre aos ~150s e `ORCAMENTO_MS` corta em 55s. A fila é
-- ordenada por `favorito desc, ultima_varredura asc`, e um alvo de vigia fica
-- sete dias sem ser varrido: na semana em que a cadência dele vencesse, ele
-- seria o mais antigo da fila e tomaria a vaga de um alvo EM COMPRA — que é o
-- que alguém está esperando ver na tela naquele dia.
--
-- Duas filas, dois crons, dois quinhões de crédito. Elas nunca disputam nada, e
-- é por isso que ligar a vigia não pode piorar a compra.
create or replace function public.facilities_radar_fila(p_limite integer default 20)
returns setof public.facilities_radar_alvos
language sql
stable
security invoker
set search_path = public
as $$
  select a.*
  from facilities_radar_alvos a
  where a.ativo
    and a.modo = 'compra'
    and (
      a.cadencia_dias <= 0
      or a.ultima_varredura is null
      or a.ultima_varredura < now() - make_interval(days => a.cadencia_dias) + interval '1 hour'
    )
    -- O piso, independente da cadência: nem o alvo de cadência 0 ("toda rodada")
    -- precisa ser varrido duas vezes em quatro minutos (as chamadas `-b` do cron).
    and (a.ultima_varredura is null or a.ultima_varredura < now() - interval '30 minutes')
  order by a.favorito desc, a.ultima_varredura asc nulls first
  limit greatest(coalesce(p_limite, 20), 1);
$$;

revoke all on function public.facilities_radar_fila(integer) from anon, public;
grant execute on function public.facilities_radar_fila(integer) to authenticated, service_role;

-- A raia da vigia. Mesma forma, outro corte — e o mesmo piso de 30 minutos,
-- porque o cron semanal dispara CINCO chamadas espaçadas de cinco minutos (duas
-- vagas cada, ~10 alvos no total) e a segunda não pode reencontrar quem a
-- primeira acabou de varrer.
--
-- A cadência sozinha já resolveria no caso normal (7 dias), mas alvo de vigia
-- com `cadencia_dias = 0` é legítimo — alguém pode querer a curva diária de um
-- item durante uma negociação — e aí só o piso segura.
create or replace function public.facilities_radar_fila_vigia(p_limite integer default 20)
returns setof public.facilities_radar_alvos
language sql
stable
security invoker
set search_path = public
as $$
  select a.*
  from facilities_radar_alvos a
  where a.ativo
    and a.modo = 'vigia'
    and (
      a.cadencia_dias <= 0
      or a.ultima_varredura is null
      or a.ultima_varredura < now() - make_interval(days => a.cadencia_dias) + interval '1 hour'
    )
    and (a.ultima_varredura is null or a.ultima_varredura < now() - interval '30 minutes')
  -- Favorito na frente, e depois quem está há mais tempo sem curva. Modelo
  -- adotado e faixa disputam a mesma fila de propósito: o que interessa é a
  -- série não ter buraco, e um buraco na faixa custa o mesmo que no modelo.
  order by a.favorito desc, a.ultima_varredura asc nulls first
  limit greatest(coalesce(p_limite, 20), 1);
$$;

revoke all on function public.facilities_radar_fila_vigia(integer) from anon, public;
grant execute on function public.facilities_radar_fila_vigia(integer) to authenticated, service_role;

/* ============================================ o rendimento não vota com vigia */

-- DUAS CORREÇÕES, e a primeira é uma armadilha que a vigia criaria sozinha.
--
-- 1. OFERTA DE VIGIA NÃO VOTA. Esta função ordena as fontes da varredura pelo
--    que cada uma rendeu, e "render" é ter trazido oferta dentro do teto que
--    sobreviveu à conferência. Alvo de vigia NUNCA é conferido — então toda
--    oferta dele contaria como não-sobrevivente, e uma fonte lida só nas
--    rodadas de vigia apareceria como imprestável. A fonte cairia no ranking
--    por ter feito exatamente o que se pediu dela. O ranking é da compra: só
--    alvo de compra vota.
--
-- 2. "SOBREVIVEU À CONFERÊNCIA" É `disponivel is true`, não `is distinct from
--    false`. O filtro antigo contava também o que nunca foi conferido
--    (`disponivel is null`) — que é o estado de todo achado recém-chegado e de
--    todo achado que a quarentena descartou por idade. Contar o não-conferido
--    como sobrevivente é premiar a fonte pelo volume, que é o oposto do que
--    esta função foi escrita para medir (o comentário original já dizia
--    "sobreviveram à conferência"; a implementação é que não dizia).
--
-- O `anuncios` continua contando tudo do alvo de compra — é o denominador, e é
-- ele que diz "16 anúncios, 1 aproveitável".
create or replace function public.facilities_radar_rendimento(p_dias integer default 14)
returns table (
  fonte     text,
  anuncios  integer,
  uteis     integer,
  alertas   integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.fonte,
    count(*)::int as anuncios,
    count(*) filter (where o.dentro_do_teto and o.disponivel is true)::int as uteis,
    count(distinct al.id)::int as alertas
  from facilities_radar_ofertas o
  join facilities_radar_alvos a on a.id = o.alvo_id and a.modo = 'compra'
  left join facilities_radar_alertas al on al.oferta_id = o.id
  where o.visto_em > now() - make_interval(days => greatest(coalesce(p_dias, 14), 1))
  group by o.fonte;
$$;

revoke all on function public.facilities_radar_rendimento(integer) from anon, public;
grant execute on function public.facilities_radar_rendimento(integer) to authenticated, service_role;

/* ==================================================== acordar e voltar a dormir */

-- O ALVO ACORDADO VOLTA A DORMIR SOZINHO, e este é o guarda mais importante do
-- desenho. Sem ele, o modo compra vira o novo permanente por esquecimento: numa
-- terça alguém liga "estou comprando" para decidir um monitor, compra na
-- quinta, e o alvo segue queimando 20 créditos por dia até o fim do ciclo — e
-- descobrir isso exige alguém olhar o painel de créditos e desconfiar.
--
-- SÓ MEXE EM QUEM FOI ACORDADO. `compra_ate` só é preenchido ao acordar; o alvo
-- cadastrado direto para uma aquisição (o uso original do módulo) tem `null` e
-- nunca é tocado aqui. É a mesma coluna dizendo duas coisas, e é de propósito:
-- "tem prazo" é exatamente o que distingue os dois.
create or replace function public.facilities_radar_dormir_expirados()
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with dormiram as (
    update facilities_radar_alvos
       set modo = 'vigia',
           compra_ate = null,
           -- A cadência da compra (0 = toda rodada) não pode sobreviver ao
           -- retorno: seria um alvo de vigia entrando em toda rodada semanal e,
           -- pior, passando na frente por estar sempre "há mais tempo sem
           -- varrer". Volta ao semanal, que é o ritmo da vigia.
           cadencia_dias = 7,
           updated_at = now()
     where modo = 'compra'
       and compra_ate is not null
       and compra_ate < now()
    returning 1
  )
  select coalesce(count(*), 0)::int from dormiram;
$$;

revoke all on function public.facilities_radar_dormir_expirados() from anon, public;
grant execute on function public.facilities_radar_dormir_expirados() to authenticated, service_role;

-- Acorda uma faixa e os modelos adotados dela. Existe como função (e não como
-- update solto na tela) porque são três decisões que têm de andar juntas:
-- o modo, o prazo e a cadência — e porque o gatilho da Solicitação precisa da
-- mesma regra sem duplicá-la.
create or replace function public.facilities_radar_acordar(
  p_alvo_id uuid,
  p_dias integer default 14,
  p_solicitacao_id uuid default null
)
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with acordados as (
    update facilities_radar_alvos a
       set modo = 'compra',
           ativo = true,
           -- Em compra o alvo entra em TODA rodada: é quando o preço se mexe
           -- durante o dia que a pessoa está olhando.
           cadencia_dias = 0,
           compra_ate = now() + make_interval(days => greatest(coalesce(p_dias, 14), 1)),
           -- Só preenche o vínculo se não houver outro. Sobrescrever mandaria o
           -- achado virar cotação na solicitação errada.
           solicitacao_id = coalesce(a.solicitacao_id, p_solicitacao_id),
           updated_at = now()
     -- A FAIXA E OS FILHOS DELA, na mesma chamada. Acordar a faixa e deixar o
     -- modelo adotado dormindo entregaria justamente a metade menos útil: quem
     -- adotou um modelo quer o preço DELE no dia da compra.
     where (a.id = p_alvo_id or a.pai_id = p_alvo_id)
       and a.modo = 'vigia'
    returning 1
  )
  select coalesce(count(*), 0)::int from acordados;
$$;

revoke all on function public.facilities_radar_acordar(uuid, integer, uuid) from anon, public;
grant execute on function public.facilities_radar_acordar(uuid, integer, uuid) to authenticated, service_role;

/* =========================================== a Solicitação acorda o alvo */

-- O SEGUNDO CAMINHO. O botão na tela cobre a compra que ninguém formalizou; a
-- Solicitação cobre o processo que já existe — abrir uma no Facilities é, por
-- definição, dizer "agora estou comprando isto".
--
-- O CASAMENTO É ESTREITO DE PROPÓSITO, e este é o ponto de todo o gatilho.
-- Casar por CATEGORIA acordaria todos os alvos de TI de uma vez (monitor,
-- notebook, headset, mouse, teclado) numa solicitação de mouse — cinco alvos ×
-- 20 créditos/dia × 14 dias ≈ 1.400 créditos por um pedido de R$ 90. Então
-- casa-se pelo NOME, com duas provas alternativas:
--
--   • o título do alvo aparece como palavra inteira no da solicitação
--     ("Mouse sem fio para o suporte" contém "mouse"); ou
--   • os dois títulos se parecem o bastante (`similarity >= 0.45`), que é o que
--     pega "Monitor 27 polegadas" contra "Monitores para a sala de reunião".
--
-- `\y` e não `\b`: em Postgres `\b` é backspace e a fronteira de palavra é
-- `\y` — o erro falha calado, casando nada e nunca reclamando.
--
-- E ACORDA NO MÁXIMO UM. Se dois alvos casarem, vence o mais parecido. Um
-- gatilho que acorda "o que der" é um gatilho que ninguém deixa ligado.
create or replace function public.facilities_radar_acordar_por_solicitacao()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_alvo uuid;
  v_titulo text := lower(unaccent(coalesce(new.titulo, '')));
begin
  -- A solicitação que o PRÓPRIO radar abriu (achado virando cotação) não acorda
  -- ninguém: o alvo dela já está em compra, e o único efeito possível seria
  -- acordar um alvo vizinho por semelhança de nome.
  if coalesce(new.observacao, '') like 'Aberta pelo Radar de Preços%' then
    return new;
  end if;
  if length(v_titulo) < 3 then
    return new;
  end if;

  select a.id into v_alvo
  from facilities_radar_alvos a
  where a.modo = 'vigia'
    and a.ativo
    -- Só faixa: um modelo adotado é acordado pelo pai, em `facilities_radar_acordar`.
    and a.pai_id is null
    and (new.categoria is null or a.categoria is null or a.categoria = new.categoria)
    and (
      v_titulo ~ ('\y' || lower(unaccent(a.titulo)) || '\y')
      or similarity(lower(unaccent(a.titulo)), v_titulo) >= 0.45
    )
  order by similarity(lower(unaccent(a.titulo)), v_titulo) desc
  limit 1;

  if v_alvo is not null then
    perform public.facilities_radar_acordar(v_alvo, 14, new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_radar_acordar_por_solicitacao on public.facilities_solicitacoes;
create trigger trg_radar_acordar_por_solicitacao
  after insert on public.facilities_solicitacoes
  for each row execute function public.facilities_radar_acordar_por_solicitacao();

/* ================================================= o painel, com a árvore */

-- O MODELO ADOTADO APARECE SOB A FAIXA. Ordenar por `created_at` deixaria o
-- filho no fim da lista, longe do pai — e a leitura que dá sentido a ele ("o MX
-- Master contra a mediana de mouse") depende de os dois estarem lado a lado.
--
-- A chave de ordenação do filho é a DO PAI (favorito e data), com um desempate
-- que põe o pai antes. Assim favoritar a faixa carrega os modelos dela junto,
-- que é o que se espera de um agrupamento.
drop function if exists public.facilities_radar_painel();

create function public.facilities_radar_painel()
returns table (
  alvo                jsonb,
  alertas_novos       integer,
  ofertas_ativas      integer,
  melhor              jsonb,
  economia_aberta     numeric,
  economia_realizada  numeric,
  pontos_historico    integer,
  menor_fora_do_teto  numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_jsonb(a) as alvo,
    (select count(*)::int from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'novo') as alertas_novos,
    -- `is distinct from false`: estoque desconhecido é o caso normal de quem
    -- ainda não foi conferido — e, em alvo de vigia, é o caso de TODOS, porque
    -- vigia não confere. A tela avisa que o número não passou pela conferência.
    (select count(*)::int from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false) as ofertas_ativas,
    (select to_jsonb(o) from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false
       order by coalesce(o.preco_unitario, o.preco_total, o.preco) asc, o.score desc
       limit 1) as melhor,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status in ('novo','visto')), 2), 0) as economia_aberta,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'virou_cotacao'), 2), 0) as economia_realizada,
    (select count(distinct (pr.coletado_em at time zone 'America/Sao_Paulo')::date)::int
       from facilities_radar_precos pr
       join facilities_radar_ofertas o2 on o2.id = pr.oferta_id
      where o2.alvo_id = a.id) as pontos_historico,
    (select round(min(coalesce(o3.preco_unitario, o3.preco_total, o3.preco)), 2)
       from facilities_radar_ofertas o3
      where o3.alvo_id = a.id and o3.ativo and not o3.dentro_do_teto
        and o3.disponivel is distinct from false) as menor_fora_do_teto
  from facilities_radar_alvos a
  left join facilities_radar_alvos p on p.id = a.pai_id
  order by
    coalesce(p.ativo, a.ativo) desc,
    coalesce(p.favorito, a.favorito) desc,
    coalesce(p.created_at, a.created_at) desc,
    (a.pai_id is not null),
    a.created_at desc;
$$;

revoke all on function public.facilities_radar_painel() from anon, public;
grant execute on function public.facilities_radar_painel() to authenticated, service_role;

/* ==================================================== o quinhão de crédito */

-- A VIGIA TEM QUINHÃO PRÓPRIO, e é isto — não o tamanho da lista — que impede
-- ela de quebrar o resto. O número pequeno protege enquanto ninguém cadastrar
-- muita coisa; o teto protege depois, inclusive do dia de empolgação em que
-- alguém cadastra trinta faixas. Com o teto, a pior consequência possível é a
-- vigia parar — e vigia parada custa uma semana de curva, que é o preço mais
-- barato que qualquer freio deste módulo já cobrou.
--
--   nominal: 10 alvos × 2 fontes × 4,3 semanas ≈ 86 créditos/mês
--   teto:    200 — folga para stealth (a mesma página salta de 1 para 5) e
--            para a lista crescer sem alguém ter de vir mexer aqui
--
-- PISO 850: a vigia é a segunda a parar quando o plano aperta, logo depois do
-- sinal de churn (900). Adiar a curva uma semana não custa nada; adiar a
-- conferência (120) deixa fantasma na tela do Facilities.
insert into public.firecrawl_orcamento (consumidor, rotulo, teto_mes, piso_saldo, para_que) values
  ('radar_vigia', 'Radar — vigia permanente', 200, 850,
     'Uma leitura por semana, em duas fontes, dos produtos que a empresa compra sempre. Não avisa nada: constrói a curva que a próxima compra vai consultar.')
on conflict (consumidor) do nothing;
