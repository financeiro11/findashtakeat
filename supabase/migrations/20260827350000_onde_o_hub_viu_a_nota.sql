-- "Achou e não consegue pegar" tinha de dizer ONDE achou.
--
-- Pedido do usuário: *"se achou mas não consegue pegar, pelo menos tenho que
-- saber onde achou para ir atrás. Bota o link do email ou outras coisas que me
-- indiquem onde estão"*. Está certo — o estágio dizia "sabe-se onde está" e não
-- dizia onde, o que é a mesma frustração de um erro que diz "algo deu errado".
--
-- E o Hub SABE. Medido nos títulos `sem_nota` com registro no acervo sem
-- arquivo: **12 linhas, 11 títulos, todas com `fonte = 'email'` e o id da
-- mensagem do Gmail dentro da `chave`** (`email|1936491e3273843f`). Esse id abre
-- a mensagem exata em `mail.google.com/mail/u/0/#all/<id>`. O dado estava lá
-- desde a primeira ingestão, guardado como chave de deduplicação, e nunca tinha
-- sido lido como endereço.
--
-- ---------------------------------------------------------------------------
-- UMA LISTA DE PISTAS, NÃO UMA
--
-- `nota_onde_esta` devolve um ARRAY. Uma mesma linha pode ter o e-mail que a
-- trouxe E o link do portal do fornecedor que o e-mail continha — e mandar
-- alguém atrás de uma nota com metade do caminho é pior do que mandar com o
-- caminho inteiro. Quando não houver pista nenhuma, devolve vazio: é resposta
-- também, e diferente de "não perguntei".
--
-- ---------------------------------------------------------------------------
-- E O QUE NÃO TEM PISTA NENHUMA continua sem inventar uma
--
-- Os R$ 143.876 do Flash não têm linha no acervo — a caixa `financeiro@` nunca
-- recebeu nada deles. A pista ali é o cadastro (`nota_fonte_bloqueada`), que já
-- diz "vão para o e-mail do Miguel". A coluna `onde` nasce para esse cadastro
-- poder guardar um endereço quando ele existir; nasce VAZIA, porque inventar um
-- link plausível para o Flash seria mandar a pessoa clicar em nada.

create or replace function public.nota_onde_esta(
  p_fonte           text,
  p_chave           text,
  p_link            text,
  p_link_documento  text,
  p_drive_id        text
)
returns jsonb
language sql
immutable
as $$
  /* DUAS PISTAS PARA O MESMO ENDEREÇO É UMA PISTA. Quando o e-mail já tinha
     sido gravado com a própria URL do Gmail na coluna `link`, a Victoria
     Partners saía com "abrir o e-mail" e "abrir o link" apontando para o mesmo
     lugar — dois botões que fazem a mesma coisa fazem quem lê procurar a
     diferença que não existe. O `distinct on` mantém o de menor `ordem`, que é
     o de rótulo mais específico. */
  select coalesce(jsonb_agg(x order by ordem), '[]'::jsonb)
    from (
      select distinct on (x->>'url') ordem, x from (
      /* O E-MAIL PRIMEIRO. É o endereço mais próximo do original: a mensagem
         com o remetente, o assunto e o que mais tenha vindo junto. */
      select 1 as ordem,
             jsonb_build_object(
               'tipo', 'email',
               'rotulo', 'abrir o e-mail',
               'url', 'https://mail.google.com/mail/u/0/#all/' || split_part(p_chave, '|', 2)) as x
       where p_fonte = 'email' and p_chave like 'email|%'
         and length(split_part(p_chave, '|', 2)) > 4
      union all
      /* O LINK QUE VEIO DENTRO do documento/e-mail — portal do fornecedor. */
      select 2, jsonb_build_object('tipo', 'portal', 'rotulo', 'abrir o link do fornecedor',
                                   'url', p_link_documento)
       where p_link_documento ~* '^https?://'
      union all
      select 3, jsonb_build_object('tipo', 'drive', 'rotulo', 'abrir no Drive', 'url', p_link)
       where p_link ~* '^https?://drive\.google\.com'
      union all
      select 4, jsonb_build_object('tipo', 'link', 'rotulo', 'abrir o link', 'url', p_link)
       where p_link ~* '^https?://' and p_link !~* '^https?://drive\.google\.com'
      union all
      select 5, jsonb_build_object('tipo', 'drive', 'rotulo', 'abrir no Drive',
                                   'url', 'https://drive.google.com/file/d/' || p_drive_id || '/view')
       where p_drive_id is not null and coalesce(p_link, '') !~* '^https?://'
      ) u
      order by x->>'url', ordem
    ) t
$$;

comment on function public.nota_onde_esta(text, text, text, text, text) is
  'Onde o Hub viu esta nota, como lista de endereços clicáveis. O id da mensagem do Gmail mora dentro de `notas_externas.chave` (`email|<id>`) desde a primeira ingestão — era chave de deduplicação e também é endereço. Ver 20260827350000.';

alter table public.nota_fonte_bloqueada
  add column if not exists onde text;

comment on column public.nota_fonte_bloqueada.onde is
  'Endereço para ir atrás da nota deste fornecedor, quando existir um (portal, caixa, pasta). Fica NULO quando não há — inventar um link plausível manda a pessoa clicar em nada.';

/* ============================================================================
 *  As pistas, título a título
 * ==========================================================================
 * Devolve os títulos que ainda devem nota e sobre os quais o Hub tem algum
 * endereço. NÃO refaz a classificação de `cap_notas_diagnostico` — duas cópias
 * da mesma regra é uma para desatualizar, e a discordância apareceria como uma
 * lista que não bate com o número do cartão em cima dela. Aqui a pergunta é
 * outra e mais simples: "de tudo que ainda falta, sobre o que eu sei dizer onde
 * está?" */

create or replace function public.cap_notas_pistas(
  p_de     date default null,
  p_ate    date default null,
  p_limite int  default 80
)
returns table (
  cod_titulo   bigint,
  favorecido   text,
  valor        numeric,
  competencia  date,
  categoria    text,
  fonte        text,
  quando       timestamptz,
  o_que_e      text,
  detalhe      text,
  tem_arquivo  boolean,
  pistas       jsonb,
  bloqueio     jsonb
)
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  with t as materialized (
    select c.cod_titulo, c.favorecido, c.favorecido_cru, c.valor, c.competencia, c.categoria
      from public.cap_titulos c
     where c.situacao = 'sem_nota'
       and (p_de is null or c.competencia >= p_de)
       and (p_ate is null or c.competencia <= p_ate)
  ),
  /* O QUE O ACERVO APONTA para o título, com ou sem arquivo. Sem arquivo é
     justamente o caso interessante: o Hub viu a mensagem e não conseguiu o
     documento. */
  do_acervo as materialized (
    select distinct on (n.alvo_id_unico)
           nullif(regexp_replace(n.alvo_id_unico, '\D', '', 'g'), '')::bigint as cod_titulo,
           n.fonte, n.enviado_em as quando, n.o_que_e, n.detalhe, n.tem_arquivo,
           public.nota_onde_esta(n.fonte, n.chave, n.link, n.link_documento, n.drive_id) as pistas
      from public.notas_externas n
     where n.alvo_tipo in ('pix', 'erp')
       and n.alvo_id_unico ~ '^\d+$'
       and n.ignorado_em is null
       and n.copia_de is null
     -- sem arquivo primeiro: é quem precisa que alguém vá atrás
     order by n.alvo_id_unico, n.tem_arquivo, n.enviado_em desc nulls last
  ),
  /* O CADASTRO DE FONTE BLOQUEADA, para quem nem linha no acervo tem.
     `normaliza_nome` roda sobre os nomes DISTINTOS, e não sobre os títulos:
     mil e quinhentos títulos são algumas centenas de fornecedores, e essa
     função custa unaccent. A primeira versão chamava-a dentro da condição do
     join — mil e quinhentos vezes quatro padrões — e a RPC estourou o gateway
     com 524. Ver [[nfse-auditoria-desempenho-sql]]. */
  padroes as materialized (
    select public.normaliza_nome(b.padrao_nome) as p,
           b.padrao_nome, b.motivo, b.acao, b.onde
      from public.nota_fonte_bloqueada b
     where b.resolvido_em is null
  ),
  nomes as materialized (
    select distinct coalesce(favorecido, favorecido_cru, '') as nome from t
  ),
  casa as materialized (
    select distinct on (nn.nome) nn.nome,
           jsonb_build_object('fornecedor', p.padrao_nome, 'motivo', p.motivo,
                              'acao', p.acao, 'onde', p.onde) as bloqueio
      from (select nome, public.normaliza_nome(nome) as n from nomes) nn
      join padroes p on nn.n like '%' || p.p || '%'
  )
  select t.cod_titulo, t.favorecido, t.valor, t.competencia, t.categoria,
         a.fonte, a.quando, a.o_que_e, a.detalhe, coalesce(a.tem_arquivo, false),
         coalesce(a.pistas, '[]'::jsonb),
         b.bloqueio
    from t
    left join do_acervo a on a.cod_titulo = t.cod_titulo
    left join casa b on b.nome = coalesce(t.favorecido, t.favorecido_cru, '')
   where coalesce(jsonb_array_length(a.pistas), 0) > 0
      or b.bloqueio is not null
   order by t.valor desc
   limit greatest(1, least(coalesce(p_limite, 80), 400))
$$;

comment on function public.cap_notas_pistas(date, date, int) is
  'De tudo que ainda deve nota, sobre o que o Hub sabe dizer ONDE está: o e-mail que a trouxe, o link do portal, a pasta do Drive — ou o cadastro de fonte bloqueada, quando nem linha no acervo existe. Ver 20260827350000.';

revoke all on function public.cap_notas_pistas(date, date, int) from public, anon;
grant execute on function public.cap_notas_pistas(date, date, int) to authenticated, service_role;

revoke all on function public.nota_onde_esta(text, text, text, text, text) from public, anon;
grant execute on function public.nota_onde_esta(text, text, text, text, text) to authenticated, service_role;
