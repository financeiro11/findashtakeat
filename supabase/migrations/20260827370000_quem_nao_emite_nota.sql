-- Quem naturalmente não emite nota fiscal — em TABELA, não em regex no código.
--
-- Pedido de 27/08/2026: *"lançamentos que tenham recibo ou outro comprovante que
-- não é nota fiscal eu preciso que fiquem sinalizados. Não precisa considerar na
-- parte vermelha, mas deixa sinalizado, porque se um dia aparecer a NF ela tem
-- que ser colocada nesses lugares. Mas leve em consideração aqueles fornecedores
-- que naturalmente não emitem nota."*
--
-- Essa última frase é a que exige cadastro. A diferença entre "falta a nota" e
-- "não existe nota a faltar" não se deduz do documento — ela depende de QUEM
-- emitiu, e isso é conhecimento de quem opera. Hoje mora numa expressão regular
-- dentro de `_shared/anexo-triagem.ts` (Uber, 99, Cabify, inDriver) e num gêmeo
-- SQL `aceita_recibo_do_app`. Duas cópias da mesma lista, e o próximo caso —
-- um MEI, um fornecedor de fora, um aplicativo novo — depende de alguém mexer
-- em código.
--
-- ---------------------------------------------------------------------------
-- UMA LISTA SÓ, e por isso a função velha passa a LER A TABELA
--
-- `aceita_recibo_do_app` continua existindo com o mesmo nome e a mesma
-- assinatura porque `cap_notas_diagnostico` a chama — mas o corpo dela vira uma
-- consulta ao cadastro. Deixar as duas vivas com listas próprias é garantir que
-- daqui a um mês o diagnóstico e a tela de títulos discordem sobre o mesmo
-- fornecedor, e ninguém saiba qual das duas está certa.
--
-- ---------------------------------------------------------------------------
-- O QUE ENTRA NA SEMENTE, e por que só isto
--
-- Os quatro aplicativos de mobilidade (o print da corrida É o documento) e os
-- estrangeiros que já apareceram: eles emitem invoice, não NFS-e, e o Hub já
-- trata a invoice deles como nota desde `20260827250000`. Cada linha aqui é uma
-- exceção à regra de que nota é nota — a lista nasce curta de propósito, e
-- cresce por decisão de gente na tela, não por palpite meu.

create table if not exists public.fornecedor_sem_nf (
  id           bigserial primary key,
  padrao_nome  text not null,
  motivo       text not null,
  /** Nulo enquanto vale. Preenchido quando o fornecedor passa a emitir. */
  resolvido_em timestamptz,
  criado_em    timestamptz not null default now(),
  criado_por   text,
  unique (padrao_nome)
);

comment on table public.fornecedor_sem_nf is
  'Fornecedores que não emitem nota fiscal — o recibo/invoice deles É o documento. Casa por trecho do nome (`padrao_nome`), normalizado. É a ÚNICA lista: `aceita_recibo_do_app` lê daqui. Ver 20260827370000.';
comment on column public.fornecedor_sem_nf.padrao_nome is
  'Trecho do nome do favorecido, como o extrato ou o Omie o escrevem. Casa por `like %trecho%` sobre o nome normalizado — "uber" pega "UBER *TRIP" e "DL*UberRides".';

alter table public.fornecedor_sem_nf enable row level security;
drop policy if exists fornecedor_sem_nf_leitura on public.fornecedor_sem_nf;
create policy fornecedor_sem_nf_leitura on public.fornecedor_sem_nf
  for select to authenticated using (true);
drop policy if exists fornecedor_sem_nf_escrita on public.fornecedor_sem_nf;
create policy fornecedor_sem_nf_escrita on public.fornecedor_sem_nf
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.fornecedor_sem_nf to authenticated;
grant usage, select on sequence public.fornecedor_sem_nf_id_seq to authenticated;

insert into public.fornecedor_sem_nf (padrao_nome, motivo, criado_por) values
  ('uber',      'Mobilidade por aplicativo: não emite nota por corrida. O recibo da corrida é o documento.', 'semente'),
  ('uberrides', 'Mobilidade por aplicativo: não emite nota por corrida. O recibo da corrida é o documento.', 'semente'),
  ('99',        'Mobilidade por aplicativo: não emite nota por corrida. O recibo da corrida é o documento.', 'semente'),
  ('99app',     'Mobilidade por aplicativo: não emite nota por corrida. O recibo da corrida é o documento.', 'semente'),
  ('cabify',    'Mobilidade por aplicativo: não emite nota por corrida. O recibo da corrida é o documento.', 'semente'),
  ('indriver',  'Mobilidade por aplicativo: não emite nota por corrida. O recibo da corrida é o documento.', 'semente'),
  ('hubspot',   'Fornecedor de fora: emite invoice, não NFS-e. A invoice vale como nota desde 27/08/2026.', 'semente'),
  ('datadog',   'Fornecedor de fora: emite invoice, não NFS-e. A invoice vale como nota desde 27/08/2026.', 'semente'),
  ('campbell',  'Fornecedor de fora: emite invoice, não NFS-e. A invoice vale como nota desde 27/08/2026.', 'semente'),
  ('clickup',   'Fornecedor de fora: emite invoice, não NFS-e. A invoice vale como nota desde 27/08/2026.', 'semente'),
  ('cubostart', 'Fornecedor de fora: emite invoice, não NFS-e. A invoice vale como nota desde 27/08/2026.', 'semente')
on conflict (padrao_nome) do nothing;

/* ============================================================================
 *  A pergunta, de um jeito só
 * ========================================================================== */

create or replace function public.fornecedor_emite_nf(p_nome text)
returns boolean
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  select not exists (
    select 1 from public.fornecedor_sem_nf f
     where f.resolvido_em is null
       and public.normaliza_nome(coalesce(p_nome, ''))
             like '%' || public.normaliza_nome(f.padrao_nome) || '%'
  )
$$;

comment on function public.fornecedor_emite_nf(text) is
  'Este fornecedor emite nota fiscal? `false` quando ele está no cadastro `fornecedor_sem_nf` — e aí o recibo dele conta como documento em vez de contar como falta. Ver 20260827370000.';

/* A FUNÇÃO VELHA PASSA A LER A TABELA. Mesmo nome, mesma assinatura, mesma
   resposta — `cap_notas_diagnostico` continua funcionando sem tocar nela. O que
   muda é que a lista deixa de estar em dois lugares.
   Deixa de ser `immutable`: quem lê tabela é `stable`, e mentir sobre isso faria
   o planner cachear a resposta dentro de uma consulta que acabou de mudar a
   tabela. */
create or replace function public.aceita_recibo_do_app(nome text)
returns boolean
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  select not public.fornecedor_emite_nf(nome)
$$;

comment on function public.aceita_recibo_do_app(text) is
  'Mantida pelo nome porque `cap_notas_diagnostico` a chama; o corpo agora lê `fornecedor_sem_nf`. Ver 20260827370000.';

revoke all on function public.fornecedor_emite_nf(text) from public, anon;
grant execute on function public.fornecedor_emite_nf(text) to authenticated, service_role;

/* ============================================================================
 *  Que documento está pendurado no título
 * ==========================================================================
 * Quatro respostas, e a ordem entre elas é a ordem da autoridade: gente primeiro,
 * IA depois, nome do arquivo por último.
 *
 *   `nota`         é nota fiscal (ou cupom fiscal, que também é)
 *   `comprovante`  é papel de verdade e NÃO é nota: recibo, boleto, comprovante
 *                  de pagamento, extrato. Prova o gasto, não substitui a nota.
 *   `nao_documento` contrato, proposta, foto sem documento, print de tela solto
 *   `indefinido`   ninguém olhou ainda — e este é o estado mais comum hoje:
 *                  702 dos 758 títulos com anexo nunca foram lidos por dentro.
 *
 * O `indefinido` NÃO vira falta. Ele continua contando como hoje, e é a varredura
 * de triagem que o resolve com o tempo. Transformar "não sei" em "não tem" faria
 * 434 títulos saírem do verde de uma vez por uma mudança de leitura, não por uma
 * mudança de fato.
 *
 * O PRINT DE TELA É O CASO INTERESSANTE. Para Uber e 99 ele É o documento — o
 * app não emite outra coisa. Para o resto é uma foto de alguma coisa. Por isso
 * ele depende de quem emitiu, e é o único tipo que depende.
 */

create or replace function public.anexo_documento_classe(
  p_classe    text,
  p_revisao   text,
  p_ia_tipo   text,
  p_emite_nf  boolean
)
returns text
language sql
immutable
as $$
  select case
    -- 1. GENTE. Quem abriu e disse "é a nota" encerra a discussão.
    when p_revisao = 'nota' then 'nota'
    -- 2. A IA, quando leu.
    when p_ia_tipo in ('nota_fiscal', 'cupom_fiscal') then 'nota'
    when p_ia_tipo in ('recibo', 'comprovante_pagamento', 'boleto', 'extrato') then 'comprovante'
    when p_ia_tipo = 'print_de_tela' then
      case when coalesce(p_emite_nf, true) then 'nao_documento' else 'comprovante' end
    when p_ia_tipo in ('contrato', 'proposta', 'foto_sem_documento', 'outro') then 'nao_documento'
    -- 3. Gente disse que não é nota e ninguém leu o que é: não dá para chamar de
    --    comprovante, e continua valendo como falta, igual a hoje.
    when p_revisao = 'nao_e_nota' then 'nao_documento'
    -- 4. O NOME DO ARQUIVO, que é o que existe para 702 títulos.
    when p_classe = 'nota' then 'nota'
    else 'indefinido'
  end
$$;

comment on function public.anexo_documento_classe(text, text, text, boolean) is
  'O que está pendurado no título: nota, comprovante (recibo/boleto/extrato — prova o gasto e não substitui a nota), nao_documento, ou indefinido (ninguém leu ainda). A ordem é a da autoridade: gente, IA, nome do arquivo. `print_de_tela` só é comprovante para quem não emite nota. Ver 20260827370000.';

revoke all on function public.anexo_documento_classe(text, text, text, boolean) from anon;
grant execute on function public.anexo_documento_classe(text, text, text, boolean) to authenticated, service_role;

/* ============================================================================
 *  A triagem passa a alcançar o `indefinido`
 * ==========================================================================
 * Ela só pegava `duvidoso` — 60 títulos — porque a pergunta dela era "este anexo
 * de nome estranho serve?". A pergunta agora é outra e maior: "que documento é
 * este?", e ela vale para os 434 cujo nome não diz nada.
 *
 * A ordem por VALOR continua: se a varredura vai levar dias, que ela comece pelo
 * que importa. E o `duvidoso` continua na frente do `indefinido` porque lá
 * alguém está esperando uma resposta para decidir; aqui é enriquecimento. */

create or replace function public.anexo_triagem_fila(p_limite integer default 6)
returns table (
  cod_titulo bigint, id_anexo text, c_tabela text, nome text,
  favorecido text, valor numeric, competencia date, categoria text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.cod_titulo,
         coalesce(a.anexos->0->>'id', '') as id_anexo,
         coalesce(a.c_tabela, 'conta-pagar') as c_tabela,
         a.anexos->0->>'nome' as nome,
         coalesce(t.favorecido, t.favorecido_cru, '') as favorecido,
         t.valor, t.competencia, t.categoria
    from public.omie_titulo_anexo a
    join public.cap_titulos t on t.cod_titulo = a.cod_titulo
   where coalesce(a.qtd, 0) > 0
     and a.revisao is null
     and a.classe in ('duvidoso', 'indefinido')
     and (a.ia_conferido_em is null
          or a.ia_arquivo is distinct from coalesce(a.anexos->0->>'nome', ''))
   order by (a.classe = 'duvidoso') desc, t.valor desc nulls last, a.cod_titulo
   limit greatest(1, least(coalesce(p_limite, 6), 12));
$$;

comment on function public.anexo_triagem_fila(integer) is
  'A fila da leitura de anexos do ERP. Alcança `duvidoso` E `indefinido` desde 27/08/2026: a pergunta deixou de ser "este anexo estranho serve?" e virou "que documento é este?", que é o que permite marcar o título que só tem recibo. Duvidoso primeiro (alguém espera resposta), depois por valor.';

/* `integer` e não `bigint`: `create or replace` não muda tipo de retorno, e
   trocá-lo exigiria derrubar a função com todos os `grant` junto. */
create or replace function public.anexo_triagem_fila_total()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select count(*)::int
    from public.omie_titulo_anexo a
   where coalesce(a.qtd, 0) > 0
     and a.revisao is null
     and a.classe in ('duvidoso', 'indefinido')
     and (a.ia_conferido_em is null
          or a.ia_arquivo is distinct from coalesce(a.anexos->0->>'nome', ''));
$$;
