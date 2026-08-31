-- O Hub avisa antes de você perguntar.
--
-- Pedido do usuário em 31/08/2026: "quero a IA o mais proativa possível e menos
-- reativa. Preciso ser INDUZIDO a ver as orientações, não ter que abrir a área.
-- Mas nem tudo pode pular na minha tela." E o exemplo que ele deu, que é o que
-- define a coisa toda: "se num mês eu emiti um tanto de nota e nesse mês o
-- número tá muito mais baixo do que deveria, tem que ser notificado — sem eu ter
-- que abrir o painel do Asaas".
--
-- ===========================================================================
-- O DEGRAU QUE FALTAVA
--
-- O Hub já tinha as duas pontas da escada e nada no meio:
--
--   INTERROMPE  modal do AvisoGrave (só `gravidade = 'alta'`)
--   te acha     faixa do topo, saudação diária do assistente
--   ---------   <vazio>
--   te induz    selo na sidebar (só o Radar tinha)
--   só se abrir DRE, Cartão, Churn, Notas, Auditoria, Tarefas...
--
-- Quase toda orientação analítica morava dentro da página e morria lá. O sino é
-- esse degrau: sempre visível, nunca bloqueia, e conta o que você ainda não viu.
--
-- ===========================================================================
-- A OUTRA METADE, QUE É A QUE REALMENTE MUDA O JOGO
--
-- Não basta um lugar novo para mostrar: hoje esses achados são `useMemo` dentro
-- do componente, ou seja, SÓ EXISTEM DEPOIS QUE VOCÊ ABRE A TELA. Nenhum selo
-- pode estar aceso antes da sua visita se o número só é calculado na visita.
--
-- Por isso o vigia roda em cron e GRAVA. É a mesma lição que a tabela
-- `integracao_estado` aprendeu: a tela de Integrações checava ao vivo, o que
-- serve para quem foi olhar e não serve para avisar quem não foi.
--
-- ===========================================================================
-- O QUE DECIDE QUE ALGO ESTÁ ERRADO É CONTA, NÃO OPINIÃO
--
-- A banda vive em `_shared/sinais-banda.ts`, com teste em
-- `src/lib/sinais/banda.test.ts` sobre as séries REAIS deste banco. A IA entra
-- só para redigir a frase e montar o rascunho — mesmo arranjo do
-- `cartao-recomendar`. Se a IA cair, o sinal continua tocando em texto seco;
-- se a banda variasse por humor do modelo, "hoje não apareceu nada" não
-- significaria nada.
--
-- ===========================================================================
-- A ARMADILHA QUE ESTA MIGRAÇÃO EVITA DE PROPÓSITO
--
-- A série óbvia — "quantas notas foram emitidas" — é uma cilada. Em agosto/2026
-- `emitida_asaas` caiu de 2345 para ZERO, e não houve falha nenhuma: foi o
-- `data_corte` da virada Asaas→Omie. Mudança de regime vira degrau, e degrau a
-- banda lê como anomalia. Um alarme desses na primeira semana ensina a pessoa a
-- ignorar o sino, e aí o sino grave também deixa de ser lido.
--
-- Por isso a série vigiada é a COBERTURA (emitidas ÷ as que exigem nota), que é
-- indiferente a qual sistema emitiu:
--
--     mar 91,7%   abr 95,0%   mai 95,7%   jun 95,9%   jul 87,3%   ago 10,8%
--
-- Sobrevive à troca de motor e mesmo assim acusa agosto.

/* ========================================================================= */
/* ============================ a régua de cada série ====================== */
/* ========================================================================= */

create table if not exists public.sinal_serie (
  serie             text primary key,
  /* Agrupa o selo da sidebar. É o nome do módulo, não o da página. */
  modulo            text not null,
  titulo            text not null,
  descricao         text,
  /* Para onde o sinal leva. Com filtro já aplicado, quando a página aceita. */
  rota              text not null,

  /* --- os parâmetros da banda (ver `_shared/sinais-banda.ts`) --- */
  direcao           text not null default 'ambos' check (direcao in ('abaixo','acima','ambos')),
  k                 numeric not null default 3,
  /* O botão "isso é normal" mexe AQUI. Alargar a banda ensina o vigia; sumir
     com o aviso o deixaria repetir o mesmo erro amanhã. */
  folga             numeric not null default 1,
  min_relativo      numeric not null default 0.15,
  historico_meses   integer not null default 6,

  gravidade         text not null default 'media' check (gravidade in ('alta','media','baixa')),
  /* Quem atende esta série por padrão. Sinal sem dono é sinal que ninguém
     atende; sinal que todo mundo vê é sinal que ninguém lê. */
  dono_user_id      uuid,
  ativa             boolean not null default true,
  atualizado_em     timestamptz not null default now()
);

comment on table public.sinal_serie is
  'A régua de cada série vigiada: onde ela mora, para que lado é notícia, e a largura da banda. Acrescentar série é INSERT aqui — se virar obra, o motor está errado.';

comment on column public.sinal_serie.folga is
  'Multiplicador da largura da banda. O botão "isso é normal" aumenta este número — é assim que o vigia aprende.';

/* ========================================================================= */
/* ================================== o sinal ============================== */
/* ========================================================================= */

create table if not exists public.sinais (
  id            uuid primary key default gen_random_uuid(),
  serie         text not null references public.sinal_serie(serie) on delete cascade,
  /* Qual instância: a competência ('2026-08'), o id da tarefa, o CNPJ... Vazio
     quando a série só produz um sinal por vez. */
  chave         text not null default '',
  /* O MODO do problema, como em `integracao_estado`: enquanto ele não muda, é o
     mesmo sinal, e reabri-lo seria repetir o que você já leu. */
  assinatura    text not null,

  titulo        text not null,
  /* Escritos pela IA. Nulos quando ela falhou — e o sinal vale assim mesmo. */
  corpo         text,
  acao          text,
  /* A ação já montada, para o botão de carimbar. Forma livre por série. */
  rascunho      jsonb,
  /* POR QUE disparou: {atual, centro, dispersao, z, relativo, n}. É o que
     responde "de onde veio esse alarme?" sem ter que reproduzir a conta. */
  medida        jsonb,
  /* R$ em jogo. É metade do critério de escalonamento — a outra é a idade. */
  valor         numeric,

  gravidade     text not null default 'media' check (gravidade in ('alta','media','baixa')),
  dono_user_id  uuid,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  /* Quando subiu do sino para a faixa do topo. */
  subiu_em      timestamptz,
  /* Você fez o que ele pedia. */
  carimbado_em  timestamptz,
  carimbado_por uuid,
  /* Sumiu sozinho: o número voltou para dentro da banda. */
  resolvido_em  timestamptz
);

comment on table public.sinais is
  'O que a IA achou sozinha, esperando no sino. Gravado pelo cron do vigia — existe ANTES de você abrir a tela, que é o ponto.';

/* Um sinal aberto por (série, instância, modo). Parcial: depois de resolvido, o
   mesmo problema pode nascer de novo — e deve, senão uma reincidência ficaria
   muda para sempre. */
create unique index if not exists sinais_aberto_unico
  on public.sinais (serie, chave, assinatura)
  where resolvido_em is null;

create index if not exists sinais_abertos_idx
  on public.sinais (criado_em desc) where resolvido_em is null;

/* ========================================================================= */
/* ========================== quem já viu o quê ============================ */
/* ========================================================================= */

-- Por PESSOA, pelo mesmo motivo do `aviso_dispensado`: duas pessoas olhando o
-- Hub têm o direito de ver o mesmo sinal, e o contador de não-lidos de uma não
-- é o da outra.
create table if not exists public.sinal_visto (
  user_id  uuid not null,
  sinal_id uuid not null references public.sinais(id) on delete cascade,
  visto_em timestamptz not null default now(),
  primary key (user_id, sinal_id)
);

alter table public.sinal_visto enable row level security;

drop policy if exists sinal_visto_propria on public.sinal_visto;
create policy sinal_visto_propria on public.sinal_visto
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

/* ========================================================================= */
/* ============================ os dois botões ============================= */
/* ========================================================================= */

alter table public.sinal_serie enable row level security;
alter table public.sinais      enable row level security;

drop policy if exists sinal_serie_leitura on public.sinal_serie;
create policy sinal_serie_leitura on public.sinal_serie
  for select to authenticated using (true);

drop policy if exists sinais_leitura on public.sinais;
create policy sinais_leitura on public.sinais
  for select to authenticated using (true);

/* ========================================================================= */
/* ============================== configuração ============================= */
/* ========================================================================= */

-- Os dois números que você vai querer mexer depois de ver o sino funcionando.
-- Ficam em tabela, e não em constante, justamente para não precisarem de deploy.
create table if not exists public.sinal_config (
  id                  integer primary key default 1 check (id = 1),
  /* Dias sem ser visto antes de um sinal caro subir para a faixa do topo. */
  dias_para_subir     integer not null default 3,
  /* R$ a partir do qual um sinal ganha o direito de subir. Abaixo disso ele
     envelhece no sino e se arquiva sozinho — o que é barato nunca interrompe. */
  valor_para_subir    numeric not null default 5000,
  /* Depois de quantos dias um sinal aberto e não carimbado se arquiva. */
  dias_para_arquivar  integer not null default 45,
  atualizado_em       timestamptz not null default now()
);

insert into public.sinal_config (id) values (1) on conflict (id) do nothing;

alter table public.sinal_config enable row level security;
drop policy if exists sinal_config_leitura on public.sinal_config;
create policy sinal_config_leitura on public.sinal_config
  for select to authenticated using (true);

/* ========================================================================= */
/* ========================== o que o vigia escreve ======================== */
/* ========================================================================= */

/**
 * Grava (ou atualiza) um sinal. Chamada pelo vigia com a service role.
 *
 * A REGRA DO REAPARECIMENTO, que é a mesma do `integracao_estado`: enquanto a
 * assinatura não muda, é o MESMO sinal — atualiza os números e não ressuscita o
 * "não lido" de quem já leu. Quando a assinatura muda, é outro problema, e aí
 * nasce um sinal novo (o índice parcial garante isso sozinho).
 */
create or replace function public.sinal_gravar(
  p_serie text, p_chave text, p_assinatura text, p_titulo text,
  p_corpo text, p_acao text, p_rascunho jsonb, p_medida jsonb,
  p_valor numeric, p_gravidade text, p_dono uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_id uuid;
begin
  insert into public.sinais
    (serie, chave, assinatura, titulo, corpo, acao, rascunho, medida, valor, gravidade, dono_user_id)
  values
    (p_serie, coalesce(p_chave,''), p_assinatura, p_titulo, p_corpo, p_acao,
     p_rascunho, p_medida, p_valor,
     case when p_gravidade in ('alta','media','baixa') then p_gravidade else 'media' end,
     p_dono)
  on conflict (serie, chave, assinatura) where resolvido_em is null
  do update set
    titulo = excluded.titulo,
    /* A IA só reescreve quando escreveu: se ela falhou nesta rodada, o texto
       bom de ontem continua valendo em vez de virar nulo. */
    corpo    = coalesce(excluded.corpo, public.sinais.corpo),
    acao     = coalesce(excluded.acao, public.sinais.acao),
    rascunho = coalesce(excluded.rascunho, public.sinais.rascunho),
    medida   = excluded.medida,
    valor    = excluded.valor,
    gravidade = excluded.gravidade,
    atualizado_em = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

/* `authenticated` TAMBÉM precisa de revoke explícito, e não só `anon`.
   O grant automático do Supabase alcança os dois papéis; revogar só de `anon`
   deixaria qualquer pessoa logada injetar sinal falso ou apagar os verdadeiros
   através de uma função `security definer`. Vale para as três de sistema
   (`sinal_gravar`, `sinal_resolver_ausentes`, `sinais_escalar`) — o vigia é
   quem escreve, e ele chega com a service role. */
revoke all on function public.sinal_gravar(text,text,text,text,text,text,jsonb,jsonb,numeric,text,uuid) from public;
revoke all on function public.sinal_gravar(text,text,text,text,text,text,jsonb,jsonb,numeric,text,uuid) from anon;
revoke all on function public.sinal_gravar(text,text,text,text,text,text,jsonb,jsonb,numeric,text,uuid) from authenticated;
grant execute on function public.sinal_gravar(text,text,text,text,text,text,jsonb,jsonb,numeric,text,uuid) to service_role;

/**
 * Fecha os sinais de uma série que o vigia NÃO reencontrou nesta rodada — o
 * número voltou para dentro da banda.
 *
 * Some sozinho, sem você precisar carimbar: cobrar um "ok" por um problema que
 * deixou de existir é a forma mais rápida de ensinar que o sino dá trabalho à
 * toa.
 */
create or replace function public.sinal_resolver_ausentes(p_serie text, p_vivos text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n integer;
begin
  update public.sinais
     set resolvido_em = now()
   where serie = p_serie
     and resolvido_em is null
     and not (chave || '|' || assinatura = any (coalesce(p_vivos, '{}'::text[])));
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.sinal_resolver_ausentes(text,text[]) from public;
revoke all on function public.sinal_resolver_ausentes(text,text[]) from anon;
revoke all on function public.sinal_resolver_ausentes(text,text[]) from authenticated;
grant execute on function public.sinal_resolver_ausentes(text,text[]) to service_role;

/* ========================================================================= */
/* =========================== o que o sino lê ============================= */
/* ========================================================================= */

/**
 * Os sinais abertos, com a marca de quem já leu.
 *
 * Devolve TODOS (foi a decisão: você vê tudo, e filtra "meus" na tela) mas já
 * traz `meu` calculado, para o filtro não precisar saber quem é você.
 */
create or replace function public.sinais_abertos()
returns table (
  id uuid, serie text, modulo text, chave text, titulo text, corpo text, acao text,
  rascunho jsonb, medida jsonb, valor numeric, gravidade text, rota text,
  dono_user_id uuid, dono_nome text, meu boolean, visto boolean,
  subiu_em timestamptz, carimbado_em timestamptz, criado_em timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select s.id, s.serie, ss.modulo, s.chave, s.titulo, s.corpo, s.acao,
         s.rascunho, s.medida, s.valor, s.gravidade, ss.rota,
         s.dono_user_id, p.nome,
         s.dono_user_id = auth.uid(),
         exists (select 1 from public.sinal_visto v
                  where v.sinal_id = s.id and v.user_id = auth.uid()),
         s.subiu_em, s.carimbado_em, s.criado_em
    from public.sinais s
    join public.sinal_serie ss on ss.serie = s.serie
    left join public.profiles p on p.user_id = s.dono_user_id
   where auth.uid() is not null
     and s.resolvido_em is null
   order by
     /* Não-lido primeiro, depois o que subiu, depois o caro, depois o novo.
        É a ordem em que a pessoa quer encontrar, não a ordem em que nasceu. */
     exists (select 1 from public.sinal_visto v
              where v.sinal_id = s.id and v.user_id = auth.uid()) asc,
     (s.subiu_em is not null) desc,
     coalesce(s.valor, 0) desc,
     s.criado_em desc;
$fn$;

revoke all on function public.sinais_abertos() from public;
revoke all on function public.sinais_abertos() from anon;
grant execute on function public.sinais_abertos() to authenticated;

/**
 * O contador do sino e os selos da sidebar, numa consulta só.
 *
 * Uma chamada por navegação em vez de uma por módulo: o selo da sidebar e o
 * número do sino saem do mesmo lugar, senão a sidebar diria 3 e o sino 4.
 */
create or replace function public.sinais_contagem()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with abertos as (
    select s.id, ss.modulo, ss.rota, s.dono_user_id, s.subiu_em,
           exists (select 1 from public.sinal_visto v
                    where v.sinal_id = s.id and v.user_id = auth.uid()) as visto
      from public.sinais s
      join public.sinal_serie ss on ss.serie = s.serie
     where auth.uid() is not null and s.resolvido_em is null
  )
  select jsonb_build_object(
    'total',     (select count(*) from abertos),
    'novos',     (select count(*) from abertos where not visto),
    'meus',      (select count(*) from abertos where dono_user_id = auth.uid() and not visto),
    'subiram',   (select count(*) from abertos where subiu_em is not null and not visto),
    'por_modulo', coalesce((select jsonb_object_agg(modulo, n)
                              from (select modulo, count(*) n from abertos
                                     where not visto group by modulo) x), '{}'::jsonb),
    /* {"/operacional/notas-fiscais": 1} — a sidebar sela o ITEM, e o item se
       identifica pela URL. Agrupar por módulo não bastaria: dois módulos podem
       cair na mesma página, e o mesmo módulo pode ter várias. */
    'por_rota',  coalesce((select jsonb_object_agg(rota, n)
                              from (select rota, count(*) n from abertos
                                     where not visto group by rota) y), '{}'::jsonb)
  );
$fn$;

revoke all on function public.sinais_contagem() from public;
revoke all on function public.sinais_contagem() from anon;
grant execute on function public.sinais_contagem() to authenticated;

/* ========================================================================= */
/* ============================ o que você faz ============================= */
/* ========================================================================= */

/** Marca como lido. `p_ids` vazio = marca tudo. */
create or replace function public.sinal_ver(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;

  insert into public.sinal_visto (user_id, sinal_id)
  select auth.uid(), s.id
    from public.sinais s
   where s.resolvido_em is null
     and (p_ids is null or cardinality(p_ids) = 0 or s.id = any (p_ids))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.sinal_ver(uuid[]) from public;
revoke all on function public.sinal_ver(uuid[]) from anon;
grant execute on function public.sinal_ver(uuid[]) to authenticated;

/** Você fez o que ele pedia. Fecha o sinal. */
create or replace function public.sinal_carimbar(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  update public.sinais
     set carimbado_em = now(), carimbado_por = auth.uid(), resolvido_em = now()
   where id = p_id and resolvido_em is null;
end;
$fn$;

revoke all on function public.sinal_carimbar(uuid) from public;
revoke all on function public.sinal_carimbar(uuid) from anon;
grant execute on function public.sinal_carimbar(uuid) to authenticated;

/**
 * "Isso é normal."
 *
 * NÃO é o mesmo que dispensar. Além de fechar o sinal, ALARGA a banda da série,
 * para que a mesma variação não volte a tocar amanhã. É a diferença entre calar
 * um alarme e ensinar o vigia — e é o que impede que o sino morra de excesso.
 *
 * O passo é multiplicativo e tem teto: sem teto, três cliques distraídos
 * desligariam a série para sempre, e ninguém perceberia que ela parou de
 * vigiar. Em 4,0 a banda já é tão larga que só o absurdo passa, e é um número
 * que ainda se enxerga na tela de configuração.
 */
create or replace function public.sinal_normalizar(p_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_serie text;
  v_folga numeric;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;

  select serie into v_serie from public.sinais where id = p_id and resolvido_em is null;
  if v_serie is null then return null; end if;

  update public.sinal_serie
     set folga = least(folga * 1.5, 4.0), atualizado_em = now()
   where serie = v_serie
  returning folga into v_folga;

  update public.sinais
     set resolvido_em = now(), carimbado_por = auth.uid()
   where id = p_id;

  return v_folga;
end;
$fn$;

revoke all on function public.sinal_normalizar(uuid) from public;
revoke all on function public.sinal_normalizar(uuid) from anon;
grant execute on function public.sinal_normalizar(uuid) to authenticated;

/* ========================================================================= */
/* ============================= o escalonamento =========================== */
/* ========================================================================= */

/**
 * Sobe para a faixa do topo o que ficou parado tempo demais E custa caro; e
 * arquiva o que envelheceu sem nunca ter valido a interrupção.
 *
 * As DUAS condições são necessárias de propósito. Só idade faria o barato
 * insistir; só valor faria o caro gritar no primeiro minuto, antes de você ter
 * tido a chance de ver no sino. É a mesma disciplina do `AvisoGrave`: quem
 * interrompe por tudo vira clique automático em "Entendi".
 *
 * `gravidade = 'alta'` sobe por conta própria — essa já nasce no modal.
 */
create or replace function public.sinais_escalar()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_cfg   public.sinal_config%rowtype;
  v_subiu integer;
  v_arq   integer;
begin
  select * into v_cfg from public.sinal_config where id = 1;

  update public.sinais s
     set subiu_em = now()
   where s.resolvido_em is null
     and s.subiu_em is null
     and s.criado_em < now() - make_interval(days => v_cfg.dias_para_subir)
     and (s.gravidade = 'alta' or coalesce(s.valor, 0) >= v_cfg.valor_para_subir)
     /* "Parado" é ninguém ter lido. Se alguém já viu e escolheu não agir, essa
        é uma decisão da pessoa — insistir seria discutir com ela. */
     and not exists (select 1 from public.sinal_visto v where v.sinal_id = s.id);
  get diagnostics v_subiu = row_count;

  update public.sinais
     set resolvido_em = now()
   where resolvido_em is null
     and criado_em < now() - make_interval(days => v_cfg.dias_para_arquivar);
  get diagnostics v_arq = row_count;

  return jsonb_build_object('subiram', v_subiu, 'arquivados', v_arq);
end;
$fn$;

revoke all on function public.sinais_escalar() from public;
revoke all on function public.sinais_escalar() from anon;
revoke all on function public.sinais_escalar() from authenticated;
grant execute on function public.sinais_escalar() to service_role;

/* ========================================================================= */
/* ====================== a série 1: cobertura de nota ===================== */
/* ========================================================================= */

/**
 * A cobertura de emissão numa janela: emitidas ÷ as que exigem nota.
 *
 * O RECORTE É POR COMPETÊNCIA DA COBRANÇA (`notas_fiscais_painel` janela em
 * `coalesce(data_pagamento, data_vencimento)`), e é isso que deixa comparar mês
 * parcial com mês parcial: basta pedir o mês anterior até o MESMO dia útil.
 *
 * `nao_exige` e `nota_a_cancelar` saem do denominador — cobrança não recebida e
 * estorno não deviam gerar nota, então contá-las afundaria a cobertura de um mês
 * com muito estorno e o vigia acusaria um problema que não existe.
 */
create or replace function public.sinal_cobertura_notas(p_de date, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with r as (select public.notas_fiscais_resumo(p_de, p_ate) as j)
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'exigem',   e.exigem,
    'emitidas', e.emitidas,
    'falta',       (r.j->>'falta')::numeric,
    'valor_falta', (r.j->>'valor_falta')::numeric,
    'cobertura', case when e.exigem > 0
                      then round(e.emitidas::numeric / e.exigem, 6)
                      else null end
  )
  from r,
  lateral (select
    (r.j->>'cobrancas')::numeric
      - (r.j->>'nao_exige')::numeric
      - (r.j->>'nota_a_cancelar')::numeric as exigem,
    (r.j->>'emitida_omie')::numeric
      + (r.j->>'emitida_asaas')::numeric   as emitidas
  ) e;
$fn$;

revoke all on function public.sinal_cobertura_notas(date,date) from public;
revoke all on function public.sinal_cobertura_notas(date,date) from anon;
grant execute on function public.sinal_cobertura_notas(date,date) to authenticated, service_role;

/* ========================================================================= */
/* ===================== a série 2: tarefa que encalhou ==================== */
/* ========================================================================= */

/**
 * A idade ATIVA de cada tarefa aberta, na mesma conta que a tela faz.
 *
 * Reproduz `src/lib/tarefas/idade.ts` em SQL: vida total menos `pausado_ms`
 * (trechos já fechados pelo gatilho) menos o trecho corrente, quando a coluna
 * atual é das que pausam. Card no Backlog não está atrasado, está esperando.
 *
 * A anomalia aqui não é temporal como a da nota — é de DISTRIBUIÇÃO: uma tarefa
 * é sinal quando destoa das OUTRAS do mesmo status, não do próprio passado. A
 * mesma banda serve; o que muda é o que entra nela.
 */
create or replace function public.sinal_tarefas_idade()
returns table (
  id uuid, titulo text, status text, responsavel text, prioridade text,
  prazo date, dias_ativos numeric, dono_user_id uuid
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select t.id, t.titulo, t.status, t.responsavel, t.prioridade, t.prazo,
         greatest(0, extract(epoch from (now() - t.created_at))
                     - coalesce(t.pausado_ms, 0) / 1000.0
                     - case when coalesce(c.pausa_idade, false)
                            then extract(epoch from (now() - coalesce(t.status_desde, t.created_at)))
                            else 0 end
                 ) / 86400.0,
         p.user_id
    from public.tarefas t
    left join public.tarefas_colunas c on c.nome = t.status
    /* O responsável é texto livre e vem com variantes ("Júlia", "Julia",
       "Júlia · Financeiro", com espaço sobrando). Casa pelo PRIMEIRO NOME sem
       acento, que é a mesma régua que a página de Tarefas usa. */
    left join public.profiles p
           on lower(public.unaccent(split_part(trim(t.responsavel), ' ', 1)))
            = lower(public.unaccent(split_part(trim(p.nome), ' ', 1)))
   where t.arquivada_em is null
     and t.concluido_em is null
     and t.status <> 'Concluído';
$fn$;

revoke all on function public.sinal_tarefas_idade() from public;
revoke all on function public.sinal_tarefas_idade() from anon;
grant execute on function public.sinal_tarefas_idade() to authenticated, service_role;

/* ========================================================================= */
/* ============================= as duas séries ============================ */
/* ========================================================================= */

-- Acrescentar série é INSERT. Se um dia virar obra, o motor está errado.
insert into public.sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, min_relativo)
values
  ('notas.cobertura', 'notas', 'Emissão de nota fiscal',
   'Notas emitidas sobre as cobranças que exigem nota, no mês corrente contra os anteriores no mesmo dia útil.',
   '/operacional/notas-fiscais', 'abaixo', 'alta', 0.15),
  ('tarefas.encalhada', 'tarefas', 'Tarefa encalhada',
   'Tarefa aberta muito mais velha que as outras do mesmo status, já descontado o tempo em coluna que não conta idade.',
   '/tarefas', 'acima', 'baixa', 0.5)
on conflict (serie) do nothing;

/* ========================================================================= */
/* =============================== o relógio =============================== */
/* ========================================================================= */

insert into public.internal_cron_tokens (name) values ('vigia-series')
on conflict (name) do nothing;

/* 07:10 UTC — antes do briefing das 9h, para que um sinal novo já esteja no
   sino quando você abre o Hub, e depois das syncs da madrugada, para não medir
   cobertura sobre cache do dia anterior. */
select cron.schedule(
  'vigia-series-diario',
  '10 7 * * *',
  $$
  select public.disparar_automacao(
    'vigia-series-diario',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/vigia-series',
    jsonb_build_object('trigger','cron','time', now()),
    'vigia-series',
    '{}'::jsonb
  );
  $$
);

/* O DEPLOY QUASE NÃO ACONTECEU, e a história fica aqui porque vai se repetir:
   em 31/08/2026 a publicação de `vigia-series` foi recusada com 402 (`Max number
   of functions reached for project`) — o plano free para em 100 funções, e o
   projeto estava exatamente em 100. Três daquelas vagas eram ocupadas por
   funções SEM CÓDIGO no repositório; duas delas (`anexar-comprovante-auditoria`,
   sobra de um rename, e `enviar-consolidado`) foram apagadas para abrir espaço.

   A segunda armadilha veio logo depois: a função subiu com `verify_jwt = true` e
   o primeiro disparo morreu em UNAUTHORIZED_NO_AUTH_HEADER **no gateway**, sem
   nada no log da função porque ela nem chegou a rodar. O conserto é a linha
   `[functions.vigia-series] verify_jwt = false` no `config.toml` — que aquele
   arquivo já documentava cinco vezes antes desta. */

/* O escalonamento é barato e não chama nada de fora, então roda direto no
   Postgres — de hora em hora, para que "3 dias" signifique 3 dias e não
   "3 dias até a próxima meia-noite". */
select cron.schedule(
  'sinais-escalar',
  '25 * * * *',
  $$ select public.sinais_escalar(); $$
);
