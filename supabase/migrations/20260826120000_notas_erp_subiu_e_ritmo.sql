-- Notas no ERP: o que já subiu para de pedir atenção, e o que nunca sobe passa a pedir.
--
-- O QUE A TELA ESTAVA DIZENDO DE ERRADO em 25/08/2026, medido no banco:
--
--   16 títulos em "Pronta para subir" (R$ 21.054). Destes:
--     • 7 JÁ TINHAM SUBIDO — `omie_anexo_enviado_em` às 20:29, e a última leitura
--       do ERP era das 17:47. A leitura é mais VELHA que o envio: o Omie não foi
--       perguntado depois que o arquivo chegou lá. A tela pedia uma ação já feita.
--     • 2 vinham só do Drive (`comprovantes_drive`) — e a fila de envio NUNCA
--       leu essa tabela. A view conta o Drive como "o Hub tem a nota", o envio
--       não o conhece: promessa que ninguém ia cumprir, para sempre.
--
--   E `cap_anexos_fila` só devolvia um título relido depois de `releitura_dias`
--   (30). Ou seja: anexar a nota com sucesso deixava a cobertura errada por um
--   mês, e a pessoa olhando para "falta subir" no que já estava no ERP.
--
-- TRÊS MUDANÇAS, e todas na mesma direção: o humano só toca no duvidoso.
--
--   1. ESTADO NOVO `enviado_aguardando` — "subiu, conferindo no ERP". Não é
--      cobertura (o Omie ainda não confirmou; prometer verde aqui seria contar
--      anexo que talvez não tenha colado), mas também não é tarefa de ninguém.
--      Fica na conta do que falta e sai da lista do que se cobra.
--
--   2. A FILA CONFIRMA O PRÓPRIO ENVIO PRIMEIRO. Título cujo envio é mais novo
--      que a leitura entra na frente de tudo: é a leitura mais barata que existe
--      (uma chamada resolve um item que já está resolvido) e é a única que
--      transforma trabalho feito em número certo.
--
--   3. O QUE NÃO SOBE PARA DE TENTAR, E VIRA LINHA. O achado 152 tentou 34 vezes
--      em 3 dias — sempre o mesmo motivo ("arquivo de 9,7 MB, acima do limite").
--      Repetir de 15 em 15 minutos o que não vai mudar sozinho gasta a trava do
--      Omie e esconde o problema: ninguém lê log de cron. Três falhas com o mesmo
--      motivo em 7 dias e o item sai da fila automática e aparece em "Falta um
--      passo" com o motivo escrito. Trocar o arquivo o traz de volta sozinho.

/* ============================================================================
 *  1. O Drive também carimba
 * ==========================================================================
 * `comprovantes_drive` vira origem de envio de verdade, e para isso precisa do
 * mesmo freio que as outras três têm: sem a marca de "já foi", a varredura
 * mandaria o mesmo arquivo todo dia e o título ficaria com N cópias da nota. */

alter table public.comprovantes_drive
  add column if not exists omie_anexo_enviado_em timestamptz,
  add column if not exists omie_anexo_nome text;

comment on column public.comprovantes_drive.omie_anexo_enviado_em is
  'Quando este arquivo do Drive foi anexado ao título no Omie. É o freio da varredura de envio: sem ele, o mesmo arquivo subiria de novo a cada rodada.';

/* ============================================================================
 *  2. A view, com o estado "subiu, conferindo"
 * ==========================================================================
 * Só duas coisas mudam em relação a 20260825190000: `comprovantes_drive` entra
 * na CTE `enviado`, e o CASE de situação ganha um degrau. O resto é cópia fiel —
 * a view é reescrita inteira porque `create or replace view` não aceita mudar a
 * lista de colunas, e um `drop` sem o corpo completo levaria a tela junto. */

drop view if exists public.cap_titulos;

create view public.cap_titulos as
with mov as (
  select distinct on ((d->'detalhes'->>'nCodTitulo')::bigint)
         (d->'detalhes'->>'nCodTitulo')::bigint                        as cod_titulo,
         nullif(d->'detalhes'->>'cCodCateg', '')                       as categoria_codigo,
         nullif(d->'detalhes'->>'nCodCC', '')                          as conta_codigo,
         (d->'detalhes'->>'nValorTitulo')::numeric                     as valor,
         to_date(nullif(d->'detalhes'->>'dDtEmissao', ''), 'DD/MM/YYYY')   as emissao,
         to_date(nullif(d->'detalhes'->>'dDtVenc', ''), 'DD/MM/YYYY')      as vencimento,
         to_date(nullif(d->'detalhes'->>'dDtPagamento', ''), 'DD/MM/YYYY') as pagamento,
         nullif(d->'detalhes'->>'cStatus', '')                         as status,
         regexp_replace(coalesce(d->'detalhes'->>'cCPFCNPJCliente', ''), '\D', '', 'g') as doc_mov,
         nullif(d->'detalhes'->>'nCodCliente', '')                     as cod_cliente,
         nullif(d->'detalhes'->>'cNumParcela', '')                     as parcela
  from public.omie_cache, jsonb_array_elements(dados) d
  where chave = 'movimentos'
    and d->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
  order by (d->'detalhes'->>'nCodTitulo')::bigint
),
cadastro as materialized (
  select (c->>'codigo')                                                as codigo,
         regexp_replace(coalesce(c->>'cnpj_cpf', ''), '\D', '', 'g')   as doc,
         nullif(btrim(c->>'nome'), '')                                 as nome
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
),
cadastro_doc as materialized (
  select doc, min(nome) as nome from cadastro where doc <> '' group by doc
),
ape_doc as materialized (
  select chave, min(apelido) as apelido
  from public.contraparte_apelido where via = 'doc' and apelido is not null
  group by chave
),
ape_nome as materialized (
  select chave, min(apelido) as apelido
  from public.contraparte_apelido where via = 'nome' and apelido is not null
  group by chave
),
nota_no_hub as (
  select omie_cod_titulo::bigint as cod_titulo, 'auditoria'::text as fonte
    from public.auditoria
   where omie_cod_titulo ~ '^\d+$' and coalesce(link_comprovante, '') <> ''
  union
  select omie_cod_titulo::bigint, 'cartao'
    from public.auditoria_cartao_lancamentos
   where omie_cod_titulo ~ '^\d+$' and coalesce(link_comprovante, '') <> ''
  union
  select cod_titulo::bigint, 'drive'
    from public.comprovantes_drive
   where cod_titulo ~ '^\d+$'
  union
  select omie_cod_titulo::bigint, 'facilities'
    from public.facilities_compras
   where omie_cod_titulo ~ '^\d+$' and coalesce(nf_arquivo, '') <> ''
),
hub as (
  select cod_titulo, string_agg(distinct fonte, '+' order by fonte) as fontes
  from nota_no_hub group by cod_titulo
),
enviado as (
  select omie_cod_titulo::bigint as cod_titulo, max(omie_anexo_enviado_em) as em
    from public.auditoria
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null group by 1
  union all
  select omie_cod_titulo::bigint, max(omie_anexo_enviado_em)
    from public.auditoria_cartao_lancamentos
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null group by 1
  union all
  select omie_cod_titulo::bigint, max(omie_anexo_enviado_em)
    from public.facilities_compras
   where omie_cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null group by 1
  union all
  -- A quarta origem, que faltava: o comprovante que veio das pastas do Drive.
  select cod_titulo::bigint, max(omie_anexo_enviado_em)
    from public.comprovantes_drive
   where cod_titulo ~ '^\d+$' and omie_anexo_enviado_em is not null group by 1
),
enviado_por_titulo as (
  select cod_titulo, max(em) as enviado_em from enviado group by cod_titulo
),
cfg as (select limiar_medio, limiar_grave, limiar_urgente from public.cap_notas_config where id = 1),
alvo as materialized (
  select m.*,
         coalesce(nullif(m.doc_mov, ''), cad.doc) as doc,
         coalesce(nullif(btrim(t.favorecido), ''), cad.nome, cadd.nome) as nome_cru,
         public.contraparte_chave(coalesce(nullif(btrim(t.favorecido), ''), cad.nome, cadd.nome)) as chave_nome
  from mov m
  left join cadastro cad      on cad.codigo = m.cod_cliente
  left join cadastro_doc cadd on cadd.doc   = nullif(m.doc_mov, '')
  left join public.omie_titulo_texto t on t.cod_titulo = m.cod_titulo
)
select
  a.cod_titulo,
  a.categoria_codigo,
  coalesce(r.descricao, a.categoria_codigo, '(sem categoria)') as categoria,
  coalesce(r.regra, 'exige')                                   as regra,
  a.conta_codigo,
  coalesce(cc.nome, 'conta ' || coalesce(a.conta_codigo, '?')) as conta,
  a.valor,
  a.emissao,
  a.vencimento,
  a.pagamento,
  coalesce(a.pagamento, a.vencimento, a.emissao)               as competencia,
  a.status,
  a.doc,
  a.parcela,
  a.cod_cliente,
  coalesce(ad.apelido, an2.apelido, a.nome_cru, '—')           as favorecido,
  coalesce(a.nome_cru, '—')                                    as favorecido_cru,
  (coalesce(ad.apelido, an2.apelido) is not null)              as tem_apelido,
  nullif(btrim(t2.nota_fiscal), '')                            as nf_no_campo,
  nullif(btrim(t2.documento), '')                              as documento,
  an.qtd                                                       as anexos_no_erp,
  an.anexos                                                    as anexos,
  an.classe                                                    as anexo_classe,
  an.revisao                                                   as anexo_revisao,
  an.erro                                                      as erro_leitura,
  an.lido_em                                                   as anexo_lido_em,
  h.fontes                                                     as nota_no_hub,
  e.enviado_em,
  case
    when a.valor >= (select limiar_urgente from cfg) then 'urgente'
    when a.valor >= (select limiar_grave   from cfg) then 'grave'
    when a.valor >= (select limiar_medio   from cfg) then 'medio'
    else 'irrelevante'
  end                                                          as gravidade,
  case
    when coalesce(r.regra, 'exige') = 'dispensa' then 'dispensa'
    when coalesce(r.regra, 'exige') = 'conferir' then 'conferir'
    when coalesce(an.qtd, 0) > 0 and an.revisao = 'nao_e_nota'         then 'sem_nota'
    when coalesce(an.qtd, 0) > 0 and an.revisao = 'nota'               then 'com_nota'
    when coalesce(an.qtd, 0) > 0 and an.classe = 'duvidoso'            then 'anexo_suspeito'
    when coalesce(an.qtd, 0) > 0                                      then 'com_nota'
    when an.erro is not null                                          then 'erro_leitura'
    -- O ARQUIVO JÁ SUBIU e o ERP ainda não foi perguntado depois disso. Não é
    -- verde (o Omie não confirmou) e não é tarefa (ninguém precisa fazer nada):
    -- é o intervalo entre o envio e a releitura, que agora é de minutos.
    when e.enviado_em is not null
         and (an.lido_em is null or e.enviado_em > an.lido_em)         then 'enviado_aguardando'
    when an.cod_titulo is null                                        then 'nao_verificado'
    when h.fontes is not null                                         then 'pronta_para_enviar'
    else 'sem_nota'
  end                                                          as situacao
from alvo a
left join public.omie_categoria_regra r  on r.codigo      = a.categoria_codigo
left join public.omie_caixa_conta cc     on cc.ncodcc     = a.conta_codigo
left join public.omie_titulo_anexo an    on an.cod_titulo = a.cod_titulo
left join public.omie_titulo_texto t2    on t2.cod_titulo = a.cod_titulo
left join hub h                          on h.cod_titulo  = a.cod_titulo
left join enviado_por_titulo e           on e.cod_titulo  = a.cod_titulo
left join ape_doc ad  on a.doc is not null and a.doc <> '' and ad.chave = a.doc
left join ape_nome an2 on length(a.chave_nome) >= 4 and an2.chave = a.chave_nome;

comment on view public.cap_titulos is
  'Um título do contas a pagar por linha, com a régua de categoria aplicada, o anexo lido no Omie e a situação de nota. situacao=enviado_aguardando significa que o Hub já mandou o arquivo e o ERP ainda não foi relido — não conta como cobertura e não é tarefa de ninguém.';

-- A mesma porta de antes do drop: quem lê esta view é RPC `security definer`,
-- e não o cliente. Abrir para `authenticated` aqui daria, com a anon key de um
-- usuário qualquer, o contas a pagar inteiro linha a linha.
revoke all on public.cap_titulos from anon, public, authenticated;
grant select on public.cap_titulos to service_role;

/* ============================================================================
 *  3. O resumo: o estado novo entra onde o "pronta" já estava
 * ==========================================================================
 * `enviado_aguardando` conta como falta (o Omie não confirmou) e como "pronta"
 * nos contadores por mês e por categoria — é a mesma família amarela: trabalho
 * nosso, em andamento. O bloco `situacoes` já devolve cada estado separado, que
 * é de onde os cartões do painel tiram o número. */

create or replace function public.cap_notas_resumo(p_de date, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select * from public.cap_titulos where competencia between p_de and p_ate
),
exigivel as (select * from base where situacao not in ('dispensa', 'conferir')),
falta as (select * from exigivel
           where situacao in ('sem_nota', 'pronta_para_enviar', 'anexo_suspeito', 'enviado_aguardando')),
-- O cartão anda por outro caminho: quem cobra é a auditoria do cartão, do
-- responsável pelo gasto, e não um e-mail para um CNPJ.
falta_cartao as (select * from falta where public.eh_cartao(favorecido_cru)),
falta_fornecedor as (select * from falta where not public.eh_cartao(favorecido_cru))
select jsonb_build_object(
  'meta', jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'limiares', (select jsonb_build_object('medio', limiar_medio, 'grave', limiar_grave, 'urgente', limiar_urgente)
                 from public.cap_notas_config where id = 1),
    'titulos', (select count(*) from base),
    'valor', (select coalesce(round(sum(valor)::numeric, 2), 0) from base),
    'exigivel_titulos', (select count(*) from exigivel),
    'exigivel_valor',   (select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel),
    'cobertura_valor', (
      select case when coalesce(sum(valor), 0) = 0 then null
             else round(100 * sum(valor) filter (where situacao = 'com_nota') / sum(valor), 1) end
      from exigivel),
    'cobertura_titulos', (
      select case when count(*) = 0 then null
             else round(100.0 * count(*) filter (where situacao = 'com_nota') / count(*), 1) end
      from exigivel),
    'nao_verificado_valor', (
      select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel where situacao = 'nao_verificado'),
    'a_revisar', (select count(*) from exigivel where situacao = 'anexo_suspeito'),
    -- Quanto do que falta é cartão: não some da conta, só sai da lista de CNPJs.
    'cartao_titulos', (select count(*) from falta_cartao),
    'cartao_valor',   (select coalesce(round(sum(valor)::numeric, 2), 0) from falta_cartao),
    'atualizado_em', (select max(lido_em) from public.omie_titulo_anexo)
  ),
  'gravidade', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'gravidade', gravidade, 'titulos', n, 'valor', round(v::numeric, 2)
    ) order by ordem), '[]'::jsonb)
    from (
      select gravidade, count(*) n, sum(valor) v,
             case gravidade when 'urgente' then 1 when 'grave' then 2 when 'medio' then 3 else 4 end as ordem
      from falta group by gravidade
    ) t
  ),
  'situacoes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'situacao', situacao, 'titulos', n, 'valor', round(v::numeric, 2)
    ) order by v desc), '[]'::jsonb)
    from (select situacao, count(*) n, sum(valor) v from base group by 1) s
  ),
  'meses', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'valor_com_nota', round(vok::numeric, 2),
      'sem_nota', semn, 'valor_sem_nota', round(vsem::numeric, 2),
      'pronta', pronta, 'nao_verificado', nver
    ) order by mes), '[]'::jsonb)
    from (
      select to_char(date_trunc('month', competencia), 'YYYY-MM') as mes,
             count(*) n, sum(valor) v,
             count(*) filter (where situacao = 'com_nota') ok,
             coalesce(sum(valor) filter (where situacao = 'com_nota'), 0) vok,
             count(*) filter (where situacao in ('sem_nota', 'anexo_suspeito')) semn,
             coalesce(sum(valor) filter (where situacao in ('sem_nota', 'anexo_suspeito')), 0) vsem,
             count(*) filter (where situacao in ('pronta_para_enviar', 'enviado_aguardando')) pronta,
             count(*) filter (where situacao = 'nao_verificado') nver
      from exigivel group by 1
    ) t
  ),
  'contas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'conta', conta, 'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'valor_com_nota', round(vok::numeric, 2),
      'nao_verificado', nver,
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end
    ) order by v desc), '[]'::jsonb)
    from (
      select conta, count(*) n, sum(valor) v,
             count(*) filter (where situacao = 'com_nota') ok,
             coalesce(sum(valor) filter (where situacao = 'com_nota'), 0) vok,
             count(*) filter (where situacao = 'nao_verificado') nver
      from exigivel group by 1
    ) t
  ),
  'categorias', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoria', categoria, 'codigo', categoria_codigo,
      'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'sem_nota', semn, 'pronta', pronta, 'nao_verificado', nver,
      'urgentes', urg,
      'valor_faltante', round(vfalta::numeric, 2),
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end
    ) order by vfalta desc, v desc), '[]'::jsonb)
    from (
      select categoria, categoria_codigo, count(*) n, sum(valor) v,
             count(*) filter (where situacao = 'com_nota') ok,
             coalesce(sum(valor) filter (where situacao = 'com_nota'), 0) vok,
             count(*) filter (where situacao in ('sem_nota', 'anexo_suspeito')) semn,
             count(*) filter (where situacao in ('pronta_para_enviar', 'enviado_aguardando')) pronta,
             count(*) filter (where situacao = 'nao_verificado') nver,
             count(*) filter (where situacao <> 'com_nota' and gravidade = 'urgente') urg,
             coalesce(sum(valor) filter (where situacao <> 'com_nota'), 0) vfalta
      from exigivel group by 1, 2
    ) t
  ),
  'fornecedores', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'favorecido', favorecido, 'doc', doc, 'titulos', n,
      'urgentes', urg, 'valor_faltante', round(vfalta::numeric, 2)
    ) order by vfalta desc), '[]'::jsonb)
    from (
      select favorecido, nullif(doc, '') as doc, count(*) n, sum(valor) vfalta,
             count(*) filter (where gravidade = 'urgente') urg
      -- Quem se cobra por e-mail: só o que depende do fornecedor. O que já
      -- subiu, ou está pronto para subir, é trabalho nosso e não entra.
      from falta_fornecedor
      where situacao in ('sem_nota', 'anexo_suspeito')
      group by 1, 2 order by sum(valor) desc limit 25
    ) t
  )
);
$function$;

/* ============================================================================
 *  4. A fila confirma o próprio envio antes de qualquer outra coisa
 * ========================================================================== */

create or replace function public.cap_anexos_fila(p_limite integer default 60)
returns table(cod_titulo bigint, valor numeric, competencia date, situacao text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with cfg as (
  select releitura_dias, releitura_max_dias from public.cap_notas_config where id = 1
),
lido as (select cod_titulo, retentar from public.omie_titulo_anexo)
select t.cod_titulo, t.valor, t.competencia, t.situacao
from public.cap_titulos t
left join lido l on l.cod_titulo = t.cod_titulo
where t.regra = 'exige'
  and (
    -- Nunca perguntamos. Entra com qualquer idade: "não verificado" é o estado
    -- que segura a cobertura como piso, e ele só sai daqui.
    t.anexo_lido_em is null
    -- NÓS mandamos o arquivo depois da última leitura. Uma chamada confirma o
    -- que já está feito — e enquanto ela não acontece a tela pede uma ação que
    -- não existe mais. É a leitura de melhor retorno da fila inteira.
    --
    -- Só para quem ainda está sem anexo confirmado: título já verde não muda de
    -- estado com uma segunda nota, e a chamada sairia do mesmo teto por método
    -- que a fila inteira disputa.
    or (t.enviado_em is not null and t.enviado_em > t.anexo_lido_em
        and coalesce(t.anexos_no_erp, 0) = 0)
    -- Falhou por algo que passa (rate limit): volta. Recusa de negócio do Omie
    -- ("documento não cadastrado") entra com retentar = false e não volta nunca.
    or (t.erro_leitura is not null and coalesce(l.retentar, true))
    -- Não tinha anexo, a leitura envelheceu E o título ainda é novo o bastante
    -- para alguém anexar alguma coisa nele.
    or (t.erro_leitura is null
        and coalesce(t.anexos_no_erp, 0) = 0
        and t.anexo_lido_em < now() - make_interval(days => (select releitura_dias from cfg))
        and coalesce(t.competencia, current_date)
            >= current_date - (select releitura_max_dias from cfg))
  )
order by
  -- Confirmar o que acabou de subir vem na frente de descobrir o que nunca foi
  -- perguntado: é mais barato, e é o que tira linha errada da tela.
  (t.enviado_em is null or t.enviado_em <= coalesce(t.anexo_lido_em, '-infinity'::timestamptz)),
  (t.anexo_lido_em is not null),
  t.competencia desc nulls last, t.valor desc
limit greatest(coalesce(p_limite, 60), 1);
$function$;

comment on function public.cap_anexos_fila(integer) is
  'Títulos que exigem nota e cuja leitura de anexo no Omie está faltando, ficou para trás de um envio nosso, falhou de um jeito que volta, ou envelheceu num título ainda recente. Consumida pela Edge Function omie-anexos-varredura.';

/* ============================================================================
 *  5. "Falta um passo" ganha o Drive — e diz quando o item está na quarentena
 * ==========================================================================
 * A QUARENTENA JÁ EXISTE e já funciona: `omie_anexo_quarentena` tira da fila o
 * título que falhou três vezes, e a varredura a lê antes de montar o lote. O
 * que faltava era a outra metade — dizer isso a alguém. Enquanto o motivo mora
 * só no log de uma Edge Function, "parou de tentar" e "nunca tentou" têm a
 * mesma cara na tela: nenhuma.
 *
 * O achado 152 é o caso: 34 tentativas em 3 dias, sempre o mesmo motivo
 * ("arquivo de 9,7 MB, acima do limite de 8 MB"). Agora ele aparece com o
 * motivo escrito, e trocar o arquivo por um menor o devolve à fila sozinho.
 *
 * `cod_titulo` entra no SELECT porque é a chave da quarentena — ela é por
 * TÍTULO, não por linha de origem: dois achados no mesmo título compartilham o
 * destino, que é justamente o que se quer (o Omie recusa a segunda escrita). */

create or replace function public.auditoria_envio_quase_la(p_limite integer default 300)
returns table(origem text, ref_id text, rotulo text, competencia date, valor numeric,
              tem_comprovante boolean, tem_titulo boolean, ja_enviado boolean, falta text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with uni as (
  select 'auditoria'::text as origem, a.id::text as ref_id,
         coalesce(a.titulo, a.id_unico) as rotulo,
         a.competencia, a.valor,
         coalesce(a.link_comprovante, '') <> ''    as tem_comprovante,
         coalesce(a.omie_cod_titulo, '') <> ''     as tem_titulo,
         a.omie_anexo_enviado_em is not null       as ja_enviado,
         a.status, a.omie_cod_titulo as cod_titulo
  from public.auditoria a
  union all
  select 'cartao', c.id::text,
         coalesce(nullif(c.estabelecimento, ''), c.descricao_original, c.id_unico),
         c.competencia, c.valor,
         coalesce(c.link_comprovante, '') <> '',
         coalesce(c.omie_cod_titulo, '') <> '',
         c.omie_anexo_enviado_em is not null,
         c.status_nf, c.omie_cod_titulo
  from public.auditoria_cartao_lancamentos c
  union all
  select 'facilities', f.id::text,
         coalesce(nullif(f.item, ''), f.fornecedor_nome, f.id::text),
         f.data, f.valor,
         coalesce(f.nf_arquivo, '') <> '',
         coalesce(f.omie_cod_titulo, '') <> '',
         f.omie_anexo_enviado_em is not null,
         f.nf_status, f.omie_cod_titulo
  from public.facilities_compras f
  union all
  -- A quarta origem. Estava contada como "o Hub tem a nota" na cobertura e não
  -- existia em lugar nenhum do caminho de envio: nem na fila, nem nesta lista.
  select 'drive', d.id::text,
         coalesce(nullif(d.emitente, ''), d.nome_arquivo, d.id::text),
         d.data, d.valor,
         coalesce(d.drive_id, '') <> '',
         coalesce(d.cod_titulo, '') <> '',
         d.omie_anexo_enviado_em is not null,
         d.casamento, d.cod_titulo
  from public.comprovantes_drive d
)
select u.origem, u.ref_id, u.rotulo, u.competencia, u.valor,
       u.tem_comprovante, u.tem_titulo, u.ja_enviado,
       case
         when u.ja_enviado then 'já está no Omie'
         -- A quarentena vem ANTES dos outros diagnósticos: quando ela existe, o
         -- item tem nota e título (senão nem teria sido tentado) e a frase
         -- "pronta para subir" seria mentira — ele não vai subir mais.
         -- `greatest`: cada tentativa escreve 'tentando' e depois 'erro', mas a
         -- marca prévia é recente — nas linhas velhas só existe o 'erro'. Somar
         -- os dois contaria em dobro; o maior é o número honesto.
         when q.cod_titulo is not null
              then 'parou de tentar depois de ' || greatest(q.tentativas, q.erros) || ' tentativas: '
                   || coalesce(q.ultimo_motivo, 'o envio morreu sem deixar motivo')
         when not u.tem_comprovante and not u.tem_titulo
              then 'falta a nota E o vínculo com o título do Omie'
         when not u.tem_comprovante then 'falta a nota (o título já está casado)'
         when not u.tem_titulo      then 'a nota existe, mas o título do Omie não foi casado'
         when u.origem = 'auditoria' and coalesce(u.status, '') <> 'Aprovado'
              then 'a nota está aqui e o título casado — falta aprovar o achado (status: ' || coalesce(nullif(u.status, ''), 'sem status') || ')'
         else 'pronta para subir'
       end as falta
from uni u
left join public.omie_anexo_quarentena q on q.cod_titulo = nullif(u.cod_titulo, '')
where not u.ja_enviado
order by (case when u.tem_comprovante and u.tem_titulo then 0 else 1 end), u.valor desc nulls last
limit greatest(coalesce(p_limite, 300), 1);
$function$;

/* ============================================================================
 *  6. Privilégios
 * ==========================================================================
 * `from anon, public`: a concessão que deixa a função aberta é a de PUBLIC
 * (`=X/postgres` no ACL), e `revoke from anon` sozinho não a alcança.
 * (Ver supabase-grant-anon-automatico.) */

revoke all on function public.cap_notas_resumo(date, date) from anon, public;
revoke all on function public.cap_anexos_fila(integer) from anon, public;
revoke all on function public.auditoria_envio_quase_la(integer) from anon, public;
-- A quarentena é lida pela tela agora (via `auditoria_envio_quase_la`, que é
-- definer) e pela varredura com a service role. Nada muda de porta aqui.
drop function if exists public.omie_anexo_envio_travados();

grant execute on function public.cap_notas_resumo(date, date) to authenticated, service_role;
grant execute on function public.cap_anexos_fila(integer) to authenticated, service_role;
grant execute on function public.auditoria_envio_quase_la(integer) to authenticated, service_role;
