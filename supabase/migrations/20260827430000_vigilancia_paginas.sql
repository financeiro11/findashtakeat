-- Vigilância de páginas: saber do reajuste antes da fatura.
--
-- O QUE ACONTECE HOJE. O fornecedor muda a tabela de preços em maio; a fatura
-- chega em junho; a variação aparece na DRE em julho, quando alguém abre a
-- ponte de variação e pergunta "por que Software subiu?". A resposta existe e é
-- pública — está na página de preços do fornecedor desde maio —, mas ninguém
-- tem o hábito de reler dez páginas de preço por mês, e com razão: é trabalho
-- chato, repetitivo e quase sempre sem novidade. É exatamente o trabalho que se
-- automatiza.
--
-- COMO FUNCIONA. Uma leitura por dia de cada página, com o `changeTracking` do
-- Firecrawl: ele guarda a versão anterior e devolve `changeStatus` ("same" /
-- "changed") com o diff no formato do `git diff`. O modo git-diff não custa
-- crédito extra — a leitura é 1 crédito, a comparação vem junto. (O modo `json`,
-- que extrai campos, custa 5; não vale para o que se quer aqui, que é "mudou
-- alguma coisa nesta página?".)
--
-- DIA NENHUM MUDA NADA, E ESSE É O PONTO. A vigilância é uma aposta assimétrica:
-- 300 créditos por mês para, algumas vezes por ano, saber de um reajuste antes
-- da cobrança. Por isso ela tem o penúltimo piso de saldo do rateio (800): é a
-- primeira a ceder o lugar quando o crédito aperta, porque adiar um dia não
-- custa nada, e a informação continua lá amanhã.
--
-- O QUE ELA NÃO É. Não é auditoria de contrato nem substituto do que a
-- Parametrização sabe do fornecedor. É um sino: "esta página mexeu, vá olhar".
-- Quem lê o diff e decide se importa é gente.

/* ================================================================ as páginas */

create table if not exists public.vigilancia_paginas (
  id             bigserial primary key,
  nome           text not null,
  url            text not null unique,
  -- Como a despesa aparece na DRE. É o que liga o aviso à linha que vai mexer.
  categoria      text,
  -- O nome do fornecedor como ele está em `lib_fornecedores`, quando houver.
  -- Texto e não FK de propósito: a página de preços de um concorrente não tem
  -- fornecedor nenhum, e uma FK obrigaria a inventar um.
  fornecedor     text,
  ativo          boolean not null default true,
  -- O que se espera achar aqui. Vai no prompt de quem resume o diff — sem isso
  -- a IA descreve mudança de banner com o mesmo destaque de mudança de preço.
  o_que_olhar    text,
  ultima_leitura timestamptz,
  -- "same", "changed", "new", ou a mensagem de erro. Uma página que nunca abre
  -- precisa DIZER isso na tela: silêncio vira "nada mudou", que é o contrário.
  ultimo_status  text,
  criado_em      timestamptz not null default now()
);

alter table public.vigilancia_paginas enable row level security;
drop policy if exists vigilancia_paginas_leitura on public.vigilancia_paginas;
create policy vigilancia_paginas_leitura on public.vigilancia_paginas
  for select to authenticated using (true);
-- A tela cadastra e desliga páginas; escrever o resultado da leitura é da função.
drop policy if exists vigilancia_paginas_escrita on public.vigilancia_paginas;
create policy vigilancia_paginas_escrita on public.vigilancia_paginas
  for all to authenticated using (true) with check (true);

/* =============================================================== o que mudou */

create table if not exists public.vigilancia_mudancas (
  id           bigserial primary key,
  pagina_id    bigint not null references public.vigilancia_paginas(id) on delete cascade,
  detectado_em timestamptz not null default now(),
  -- Uma frase em português, escrita pela IA SOBRE O DIFF. Ela não julga se é
  -- caro: descreve o que mudou. A decisão é de quem lê.
  resumo       text,
  -- 'preco' quando o diff mexe em número com moeda; 'outro' no resto. É regra em
  -- código, não opinião da IA — ver `classificarDiff` na função.
  natureza     text not null default 'outro',
  diff         text,
  -- Some da lista quando alguém marca como visto. Não apaga: o histórico de
  -- reajustes de um fornecedor é justamente o que se quer ter daqui a um ano.
  visto_em     timestamptz,
  visto_por    text
);

create index if not exists vigilancia_mudancas_pagina
  on public.vigilancia_mudancas (pagina_id, detectado_em desc);

alter table public.vigilancia_mudancas enable row level security;
drop policy if exists vigilancia_mudancas_leitura on public.vigilancia_mudancas;
create policy vigilancia_mudancas_leitura on public.vigilancia_mudancas
  for select to authenticated using (true);
drop policy if exists vigilancia_mudancas_marcar on public.vigilancia_mudancas;
create policy vigilancia_mudancas_marcar on public.vigilancia_mudancas
  for update to authenticated using (true) with check (true);

/* ================================================================= a semente */

-- AS PÁGINAS ENTRAM PARA SEREM MEDIDAS, não porque eu garanto que abrem.
-- É a mesma escolha do radar de preços com as lojas: a que não abrir vai dizer
-- isso em `ultimo_status` na primeira rodada, e aí se corrige o endereço ou se
-- desliga a linha. Supor que funciona e descobrir meses depois que a página
-- mudou de lugar seria o pior dos mundos — vigilância muda é indistinguível de
-- mercado parado.
--
-- Os fornecedores saíram de `lib_fornecedores` (categorias "Software / SaaS",
-- "Softwares - Administrativo/Marketing/Operação" e "Telefone e Internet").
-- O Asaas está aqui por ser o de maior impacto: a taxa dele entra em TODA
-- receita que passa pela régua de cobrança.
insert into public.vigilancia_paginas (nome, url, categoria, fornecedor, o_que_olhar) values
  ('Asaas — taxas',      'https://www.asaas.com/precos',                 'Tarifas',                              'ASAAS',     'Taxa por boleto, Pix e cartão; mudança de faixa por volume.'),
  ('Anthropic — API',    'https://www.anthropic.com/pricing',            'Software / SaaS',                      'ANTHROPIC', 'Preço por milhão de tokens de cada modelo.'),
  ('OpenAI — API',       'https://openai.com/api/pricing/',              'Software / SaaS',                      'OPENAI',    'Preço por milhão de tokens de cada modelo.'),
  ('Notion',             'https://www.notion.com/pricing',               'Software / SaaS',                      'NOTION',    'Preço por usuário/mês dos planos pagos.'),
  ('ClickUp',            'https://clickup.com/pricing',                  'Software / SaaS',                      'CLICKUP',   'Preço por usuário/mês dos planos pagos.'),
  ('Canva',              'https://www.canva.com/pt_br/precos/',          'Software / SaaS',                      'CANVA',     'Preço do plano por equipe e número de assentos incluídos.'),
  ('HubSpot',            'https://www.hubspot.com/pricing',              'Software / SaaS',                      'HUBSPOT',   'Preço dos hubs e mudança no que cada faixa inclui.'),
  -- `/precos/` e não `/planos/`: as duas primeiras tentativas voltaram
  -- `changeStatus: "removed"` na rodada de estreia (27/08/2026), que é como o
  -- Firecrawl diz "esta página não existe". Fica registrado porque é a prova de
  -- que a coluna `ultimo_status` faz o trabalho dela — URL chutada não vira
  -- vigilância muda, vira linha vermelha na tela.
  ('Omie — ERP',         'https://www.omie.com.br/precos/',              '3.1.2.1 Softwares - Administrativo',   'OMIEXPERIENCE LTDA.', 'Preço do plano e limites de nota fiscal por mês.'),
  ('Onfly',              'https://www.onfly.com.br/planos',              '3.1.2.1 Softwares - Administrativo',   'ONFLY',     'Preço por viajante e taxa por reserva.'),
  ('Focus NFe',          'https://focusnfe.com.br/precos/',              '3.2.5. Software - Operação',           'FOCUS NFE', 'Preço por nota emitida e pacote mensal.')
on conflict (url) do nothing;
