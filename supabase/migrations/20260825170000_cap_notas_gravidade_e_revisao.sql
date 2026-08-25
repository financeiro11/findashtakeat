-- Gravidade em vez de piso, e a fila de revisão do anexo duvidoso.
--
-- DUAS DECISÕES DE 25/08/2026, e as duas mudam o desenho:
--
--  1. "Tudo idealmente tem que ter nota, mas há níveis de gravidade."
--     O piso saiu. Ele DISPENSAVA a despesa pequena da conta — e dispensar é
--     dizer que não precisa de nota, o que não é verdade. O que existe é
--     prioridade de cobrança: < R$ 150 irrelevante, até 500 médio, até 1.000
--     grave, acima disso urgente. Todos continuam no denominador; o que muda é
--     por onde se começa a cobrar.
--
--  2. "Pode revisar" os anexos cujo nome não parece nota. Só que a primeira
--     heurística presumia culpa e acusou 89 de 356 — e a lista era quase toda
--     legítima: chave de NF-e de 44 dígitos, "Alude_Cobrança-De-Aluguel…",
--     "cesan jun.pdf". Fila cheia de falso positivo é fila que ninguém abre
--     duas vezes, e aí o `nf_undefined_correta.pdf` de verdade se esconde no
--     meio dos 89. A regra virou a inversa: só é duvidoso quem tem sinal
--     NEGATIVO e nenhum positivo.

/* ============================================================================
 *  1. A régua de gravidade
 * ========================================================================== */

alter table public.cap_notas_config
  add column if not exists limiar_medio   numeric not null default 150,
  add column if not exists limiar_grave   numeric not null default 500,
  add column if not exists limiar_urgente numeric not null default 1000;

comment on column public.cap_notas_config.limiar_medio is
  'Abaixo disto a nota faltante é "irrelevante" — continua faltando, só não é por onde se começa.';
comment on column public.cap_notas_config.limiar_urgente is
  'Acima disto a nota faltante é "urgente".';

create or replace function public.cap_gravidade(p_valor numeric)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
select case
  when p_valor is null then 'irrelevante'
  when p_valor >= (select limiar_urgente from public.cap_notas_config where id = 1) then 'urgente'
  when p_valor >= (select limiar_grave   from public.cap_notas_config where id = 1) then 'grave'
  when p_valor >= (select limiar_medio   from public.cap_notas_config where id = 1) then 'medio'
  else 'irrelevante'
end;
$function$;

comment on function public.cap_gravidade(numeric) is
  'A prioridade de cobrança de uma nota que falta, pelo valor do título. Não dispensa nada — ordena.';

/* ============================================================================
 *  2. O anexo parece nota? — gêmea de classificarAnexo em _shared/anexo-tipo.ts
 * ==========================================================================
 * As duas existem porque a leitura acontece no Deno (na varredura) e a
 * reclassificação do que JÁ foi lido acontece aqui, sem gastar 1.133 chamadas ao
 * Omie de novo. Quando uma mudar, a outra muda junto — o teste de
 * src/lib/anexoTipo.test.ts é o que fixa o comportamento esperado das duas. */

create or replace function public.anexo_classe(p_nome text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
select case
  when coalesce(btrim(p_nome), '') = '' then 'duvidoso'
  -- Chave de acesso: 44 dígitos (NF-e/NFC-e) ou 50 (NFS-e nacional). É prova.
  when p_nome ~ '(^|[^0-9])([0-9]{44}|[0-9]{50})([^0-9]|$)' then 'nota'
  when lower(p_nome) ~ '\mnfs?e?\M|\mnf\M|nota[-_ ]?fiscal|\mnota\M|danfe|invoice|fatura|recibo|boleto|cupom|comprovante|cobran[cç]a|duplicata'
       then 'nota'
  when lower(p_nome) ~ 'undefined|\mnull\M|sem[-_ ]?nome|screenshot|captura[-_ ]de[-_ ]tela|whatsapp[-_ ]?image|\mphoto\M|\.tmp\M'
       then 'duvidoso'
  when lower(p_nome) ~ '^(documento|arquivo|imagem|image|scan|digitalizar?)\s*(\([0-9]+\))?(\.[a-z0-9]+)?$|^img[-_]?[0-9]+|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
       then 'duvidoso'
  else 'indefinido'
end;
$function$;

comment on function public.anexo_classe(text) is
  'nota | duvidoso | indefinido, pelo NOME do anexo. Gêmea de classificarAnexo em _shared/anexo-tipo.ts.';

/* ============================================================================
 *  3. A revisão humana do anexo duvidoso
 * ========================================================================== */

alter table public.omie_titulo_anexo
  add column if not exists classe       text,
  add column if not exists revisao      text check (revisao in ('nota', 'nao_e_nota')),
  add column if not exists revisado_em  timestamptz,
  add column if not exists revisado_por uuid references auth.users(id) on delete set null;

comment on column public.omie_titulo_anexo.classe is
  'A melhor classe entre os anexos do título (nota > indefinido > duvidoso). Calculada do nome.';
comment on column public.omie_titulo_anexo.revisao is
  'O veredito de quem abriu o anexo. "nota" tira da fila e conta como coberto; "nao_e_nota" devolve o título para a lista do que falta.';

/* Reclassifica o que já foi lido — sem tocar no Omie de novo.
 * A melhor classe entre os anexos vale: um título com a nota E um print junto
 * está coberto, e mandar alguém revisar isso é gastar atenção à toa. */
update public.omie_titulo_anexo a
   set classe = coalesce((
         select case
           when bool_or(public.anexo_classe(x->>'nome') = 'nota')       then 'nota'
           when bool_or(public.anexo_classe(x->>'nome') = 'indefinido') then 'indefinido'
           else 'duvidoso'
         end
         from jsonb_array_elements(a.anexos) x
       ), null)
 where a.qtd > 0;

/* ============================================================================
 *  4. A view, com gravidade e com o estado de revisão
 * ========================================================================== */

-- A view precisa ser RECRIADA (colunas novas no meio, e `create or replace` só
-- deixa acrescentar no fim), e é ela que segura o `piso_valor`. Função SQL com
-- corpo em string não cria dependência, então o drop não leva as RPCs junto.
drop view if exists public.cap_titulos;

-- O piso dispensava a despesa pequena da conta. Não é o que se quer: tudo exige
-- nota, o que muda é a ordem de cobrança (ver `gravidade`).
alter table public.cap_notas_config drop column if exists piso_valor;

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
         regexp_replace(coalesce(d->'detalhes'->>'cCPFCNPJCliente', ''), '\D', '', 'g') as doc,
         nullif(d->'detalhes'->>'nCodCliente', '')                     as cod_cliente,
         nullif(d->'detalhes'->>'cNumParcela', '')                     as parcela
  from public.omie_cache, jsonb_array_elements(dados) d
  where chave = 'movimentos'
    and d->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
  order by (d->'detalhes'->>'nCodTitulo')::bigint
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
),
enviado_por_titulo as (
  select cod_titulo, max(em) as enviado_em from enviado group by cod_titulo
),
cfg as (select limiar_medio, limiar_grave, limiar_urgente from public.cap_notas_config where id = 1)
select
  m.cod_titulo,
  m.categoria_codigo,
  coalesce(r.descricao, m.categoria_codigo, '(sem categoria)') as categoria,
  coalesce(r.regra, 'exige')                                   as regra,
  m.conta_codigo,
  coalesce(cc.nome, 'conta ' || coalesce(m.conta_codigo, '?')) as conta,
  m.valor,
  m.emissao,
  m.vencimento,
  m.pagamento,
  coalesce(m.pagamento, m.vencimento, m.emissao)               as competencia,
  m.status,
  m.doc,
  m.parcela,
  coalesce(nullif(btrim(t.favorecido), ''), '—')               as favorecido,
  nullif(btrim(t.nota_fiscal), '')                             as nf_no_campo,
  nullif(btrim(t.documento), '')                               as documento,
  a.qtd                                                        as anexos_no_erp,
  a.anexos                                                     as anexos,
  a.classe                                                     as anexo_classe,
  a.revisao                                                    as anexo_revisao,
  a.erro                                                       as erro_leitura,
  a.lido_em                                                    as anexo_lido_em,
  h.fontes                                                     as nota_no_hub,
  e.enviado_em,
  -- A prioridade de cobrança. Vale para toda linha; só interessa nas que faltam.
  case
    when m.valor >= (select limiar_urgente from cfg) then 'urgente'
    when m.valor >= (select limiar_grave   from cfg) then 'grave'
    when m.valor >= (select limiar_medio   from cfg) then 'medio'
    else 'irrelevante'
  end                                                          as gravidade,
  case
    when coalesce(r.regra, 'exige') = 'dispensa' then 'dispensa'
    when coalesce(r.regra, 'exige') = 'conferir' then 'conferir'
    -- O ERP tem arquivo. Ele é a nota?
    when coalesce(a.qtd, 0) > 0 and a.revisao = 'nao_e_nota'          then 'sem_nota'
    when coalesce(a.qtd, 0) > 0 and a.revisao = 'nota'                then 'com_nota'
    when coalesce(a.qtd, 0) > 0 and a.classe = 'duvidoso'             then 'anexo_suspeito'
    when coalesce(a.qtd, 0) > 0                                      then 'com_nota'
    when a.erro is not null                                          then 'erro_leitura'
    when a.cod_titulo is null                                        then 'nao_verificado'
    when h.fontes is not null                                        then 'pronta_para_enviar'
    else 'sem_nota'
  end                                                          as situacao
from mov m
left join public.omie_categoria_regra r  on r.codigo     = m.categoria_codigo
left join public.omie_caixa_conta cc     on cc.ncodcc    = m.conta_codigo
left join public.omie_titulo_anexo a     on a.cod_titulo = m.cod_titulo
left join public.omie_titulo_texto t     on t.cod_titulo = m.cod_titulo
left join hub h                          on h.cod_titulo = m.cod_titulo
left join enviado_por_titulo e           on e.cod_titulo = m.cod_titulo;

comment on view public.cap_titulos is
  'Um título do contas a pagar do Omie por linha, com a régua da categoria, o que o ERP tem de anexo, o que o Hub tem de arquivo e a gravidade da cobrança. Leitura só via RPC security definer — omie_cache não é legível pelo usuário.';

revoke all on public.cap_titulos from anon, authenticated;

/* ============================================================================
 *  5. Marcar a revisão
 * ========================================================================== */

create or replace function public.cap_anexo_revisar(p_cod_titulo bigint, p_veredito text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_veredito not in ('nota', 'nao_e_nota') then
    raise exception 'Veredito inválido: use "nota" ou "nao_e_nota".';
  end if;
  update public.omie_titulo_anexo
     set revisao = p_veredito, revisado_em = now(), revisado_por = auth.uid()
   where cod_titulo = p_cod_titulo;
  if not found then
    raise exception 'Título % ainda não foi lido no Omie — não há anexo para revisar.', p_cod_titulo;
  end if;
  return p_veredito;
end;
$function$;

comment on function public.cap_anexo_revisar(bigint, text) is
  'Registra o veredito de quem abriu o anexo duvidoso. "nota" conta como coberto; "nao_e_nota" devolve o título para a lista do que falta.';

revoke all on function public.cap_gravidade(numeric) from anon;
revoke all on function public.anexo_classe(text) from anon;
revoke all on function public.cap_anexo_revisar(bigint, text) from anon;
grant execute on function public.cap_anexo_revisar(bigint, text) to authenticated;
