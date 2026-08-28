-- O painel de notícias do briefing deixa de ser prosa e vira item com link.
--
-- O QUE HAVIA. A skill de briefing rodava de manhã, fazia WebSearch e gravava
-- três parágrafos em `briefing_diario.noticias` (macro, tech_saas, foodservice).
-- A tela renderizava o markdown. Isso tem três defeitos que só aparecem com o
-- uso:
--
--   1. SE A SKILL NÃO RODAR, o painel mostra o de ontem — e mostra sem dizer que
--      é de ontem. Notícia velha com cara de nova é pior que painel vazio.
--   2. NÃO HÁ ITEM. Os links vão empilhados no fim do parágrafo, sem veículo,
--      sem hora e sem título. Não dá para clicar no que interessa, nem para
--      dizer "essa eu já li".
--   3. NÃO HÁ MEMÓRIA. A mesma notícia volta três manhãs seguidas, porque nada
--      guarda o que já foi mostrado.
--
-- O QUE MUDA. Uma função no cron (`briefing-noticias`) busca pelo Firecrawl e
-- grava AQUI, item a item, com fonte, data, link e uma linha de "por que isto
-- importa". A skill continua dona da agenda e dos e-mails — que dependem de MCP
-- de agente e não cabem num cron — e continua escrevendo a prosa de macro e
-- foodservice, que segue aparecendo abaixo. As duas coisas convivem: a tela
-- mostra os itens quando há itens e cai na prosa quando não há.
--
-- TRÊS PAUTAS, ESCOLHIDAS POR SEREM ACIONÁVEIS (decisão de 28/08/2026):
-- ferramenta que usamos e mexeu, IA aplicada a backoffice que dá para copiar no
-- Hub, e movimento de concorrente. Notícia que não muda nada do que fazemos é
-- ruído com fonte confiável — e o painel do briefing é o lugar mais caro do Hub
-- para colocar ruído, porque é o que se lê todo dia.
--
-- QUEM ESCOLHE É CÓDIGO, A IA SÓ REDIGE. A régua está em
-- `_shared/briefing-noticias.ts` (testada em `src/lib/briefingNoticias.test.ts`):
-- vocabulário do que usamos, de quem disputa conosco, e um veto explícito ao
-- "as 10 melhores IAs de 2026" — que casa com todo o vocabulário porque é feito
-- para isso. A IA recebe só o item já aprovado, para escrever uma frase.

/* ================================================================= a tabela */

create table if not exists public.briefing_noticias (
  id            bigserial primary key,
  -- 'ia_ferramentas' | 'ia_backoffice' | 'concorrentes'. Texto e não enum: a
  -- lista de pautas é editorial e vai mudar mais que o esquema.
  pauta         text        not null,
  titulo        text        not null,
  url           text        not null,
  -- Host sem `www` + caminho sem barra final, sem querystring. É o que impede a
  -- mesma matéria de voltar amanhã vestida de `?utm_source=newsletter`. Ver
  -- `chaveDaUrl` no módulo compartilhado — a normalização mora lá para poder
  -- ser testada, e aqui só chega o resultado.
  chave         text        not null unique,
  -- O veículo, como o buscador informa (ou o host, quando ele não informa).
  fonte         text,
  -- Quando a matéria saiu. Fica null com frequência: metade dos veículos não
  -- devolve data no resultado da busca, e inventar uma seria pior.
  publicado_em  timestamptz,
  -- O snippet do buscador, cru. É o que a IA leu para escrever a linha abaixo —
  -- guardá-lo é o que permite conferir se ela inventou.
  resumo        text,
  -- Uma frase dizendo o que isto muda para a Takeat, escrita pela IA SOBRE o
  -- título e o snippet. Null quando a IA falhou: o item continua de pé sem ela,
  -- porque o link é o fato e a frase é o enrolamento.
  por_que_importa text,
  -- A nota da régua determinística e os termos que casaram. `motivos` existe
  -- para responder "por que isto está na minha tela?" sem abrir o código.
  relevancia    integer     not null default 0,
  motivos       text[]      not null default '{}',
  colhido_em    timestamptz not null default now(),
  -- Some da lista quando alguém marca. Não apaga: é o que impede a mesma
  -- notícia de voltar, e é o histórico de "de que se falava em agosto".
  lido_em       timestamptz,
  lido_por      text,
  detalhe       jsonb       not null default '{}'::jsonb
);

comment on table public.briefing_noticias is
  'Itens do painel de notícias do briefing, colhidos por `briefing-noticias` via Firecrawl. Uma linha por matéria; `chave` deduplica.';

-- A leitura da tela é sempre "as não lidas, mais recentes primeiro, por pauta".
create index if not exists briefing_noticias_fila
  on public.briefing_noticias (colhido_em desc) where lido_em is null;

-- A rodada compara o que achou contra o que já entrou nas últimas semanas —
-- por título, não por chave (o mesmo lançamento sai em oito portais, com oito
-- URLs). Este índice é o que faz essa consulta não virar varredura.
create index if not exists briefing_noticias_recentes
  on public.briefing_noticias (colhido_em desc);

alter table public.briefing_noticias enable row level security;

drop policy if exists briefing_noticias_leitura on public.briefing_noticias;
create policy briefing_noticias_leitura on public.briefing_noticias
  for select to authenticated using (true);

-- Marcar como lida é da tela; escrever item é da função (service_role, que não
-- passa por policy).
drop policy if exists briefing_noticias_marcar on public.briefing_noticias;
create policy briefing_noticias_marcar on public.briefing_noticias
  for update to authenticated using (true) with check (true);

/* ======================================================== o rateio de crédito */

-- OS NÚMEROS. Quatro buscas por dia (duas da pauta de ferramentas, uma de cada
-- outra) a 2 créditos cada = 8/dia = ~240/mês. O teto de 300 é a folga para as
-- buscas sob demanda de quem clicar "buscar agora" na tela.
--
-- DE ONDE SAEM OS 300. Da margem: os seis consumidores somavam 4.500 de um plano
-- de 5.000, e os 500 restantes eram reserva para o mês em que uma loja passar a
-- exigir proxy stealth e uma varredura custar cinco vezes mais. Agora a reserva
-- é de 200. Fica registrado porque é uma escolha, não uma sobra: se o radar
-- estourar num mês de stealth, é aqui que se corta primeiro.
--
-- O PISO DE 850 É QUASE O ÚLTIMO DA ESCADA (só o sinal de churn, em 900, para
-- antes). É o lugar certo: em semana de crédito apertado, ficar sem o painel de
-- notícias não quebra processo nenhum — ninguém deixa de emitir nota, de
-- conciliar ou de conferir anúncio por causa disso. E a notícia continua lá,
-- pública, para quem quiser procurar.
insert into public.firecrawl_orcamento (consumidor, rotulo, teto_mes, piso_saldo, para_que) values
  ('briefing_noticias', 'Notícias do briefing', 300, 850,
     'Quatro buscas por dia para o painel de notícias do briefing: IA, ferramentas que usamos e concorrentes.')
on conflict (consumidor) do nothing;

/* ============================================================= o agendamento */

insert into public.internal_cron_tokens (name, token)
values ('briefing-noticias', encode(gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

-- 10:40 UTC = 07:40 BRT. A ordem da manhã importa e é esta: vigilância de
-- páginas às 06:20, notícias às 07:40, novidades do Hub às 08:35, e a skill de
-- briefing às 09:00 — que é quando alguém abre a tela. Cada uma termina antes
-- de a próxima começar, e todas terminam antes do olho humano.
--
-- UMA VEZ POR DIA, E DE MANHÃ. O painel é lido antes do café; uma segunda
-- rodada à tarde dobraria a conta para entregar notícia a quem já fechou a aba.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'briefing-noticias-diaria') then
    perform cron.unschedule('briefing-noticias-diaria');
  end if;
  perform cron.schedule('briefing-noticias-diaria', '40 10 * * *', $cmd$
    select public.disparar_automacao(
      'briefing-noticias-diaria',
      'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/briefing-noticias',
      '{"action":"varrer"}'::jsonb,
      'briefing-noticias',
      '{}'::jsonb,
      150000
    );
  $cmd$);
end $$;
