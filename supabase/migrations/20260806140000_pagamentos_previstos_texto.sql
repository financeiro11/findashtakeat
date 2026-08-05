-- `pagamentos_previstos` v2: passa a devolver o TEXTO do título (observação,
-- documento, nota fiscal e favorecido da transferência) e a ler da janela
-- sincronizada pelo `omie-contas-pagar-sync`.
--
-- POR QUE: casar a agenda com o Omie só por fornecedor/categoria erra os casos
-- em que o cadastro não diz o que o pagamento é. O real que provou isso:
-- "Donos de Hamburgueria (2ª parcela) - R$ 6.000" está lançado como
-- "PLENUS SOLUCOES / Eventos e Feiras — obs: Donos de Hamburgueria (2 parcela)".
-- Sem ler a observação, a conferência acusava um título provisionado como
-- "sem provisão". O texto do CAP é o campo onde o time escreve o que é.
--
-- DUAS FONTES, NESTA ORDEM:
--  1. cache "contas_pagar" (omie-contas-pagar-sync): janela curta em torno de
--     hoje, com texto e — porque é lida direto do Omie a cada passada — mais
--     fresca. Em 05/08/2026 ela tinha 118 títulos do dia contra 116 do cache
--     de movimentos, que é de uma passada por dia.
--  2. cache "movimentos" (omie-sync e as demais syncs): cobre qualquer data.
--     Entra para todo título que a (1) não tem, então nada regride se o sync
--     novo não tiver rodado — só falta o texto.
--
-- Segue SECURITY DEFINER pelo mesmo motivo da v1: `omie_cache` tem RLS sem
-- policy e o dump bruto do Omie não vai para o cliente; aqui sai só a janela.

drop function if exists public.pagamentos_previstos(date, int);

create function public.pagamentos_previstos(
  p_dia         date,
  p_janela_dias int default 10   -- quantos dias antes/depois de p_dia entram
)
returns table (
  cod_titulo          bigint,
  vencimento          date,
  previsao            date,
  fornecedor          text,
  favorecido          text,      -- nome da transferência (CNAB), quando houver
  cnpj_cpf            text,
  categoria_codigo    text,
  categoria_descricao text,
  documento           text,
  documento_fiscal    text,
  observacao          text,
  parcela             text,
  valor               numeric,
  valor_aberto        numeric,
  status              text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  janela as (select least(greatest(coalesce(p_janela_dias, 10), 0), 60) as d),
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  cli as (
    select k->>'codigo' as codigo, k->>'nome' as nome
    from omie_cache, lateral jsonb_array_elements(dados) k
    where chave = 'clientes'
  ),
  -- (1) janela do contas a pagar, com texto
  cap as (
    select
      (t->>'cod')::bigint                        as cod,
      nullif(t->>'venc','')::date                as venc,
      nullif(t->>'prev','')::date                as prev,
      nullif(t->>'cli','')                       as cli,
      nullif(t->>'cpf','')                       as cpf,
      nullif(t->>'cat','')                       as cat,
      nullif(t->>'doc','')                       as doc,
      nullif(t->>'nf','')                        as nf,
      nullif(t->>'obs','')                       as obs,
      nullif(t->>'fav','')                       as fav,
      nullif(t->>'parc','')                      as parc,
      (t->>'valor')::numeric                     as valor,
      coalesce((t->>'aberto')::numeric, (t->>'valor')::numeric) as aberto,
      nullif(t->>'status','')                    as status
    from omie_cache, lateral jsonb_array_elements(dados) t
    where chave = 'contas_pagar'
  ),
  -- (2) movimentos: cobre o que a janela não tem
  mov as (
    select
      (det->>'nCodTitulo')::bigint                                as cod,
      to_date(nullif(det->>'dDtVenc',''), 'DD/MM/YYYY')            as venc,
      to_date(nullif(det->>'dDtPrevisao',''), 'DD/MM/YYYY')        as prev,
      nullif(det->>'nCodCliente','')                               as cli,
      nullif(det->>'cCPFCNPJCliente','')                           as cpf,
      nullif(det->>'cCodCateg','')                                 as cat,
      coalesce(nullif(det->>'cNumDocFiscal',''), nullif(det->>'cNumTitulo','')) as doc,
      nullif(det->>'cNumDocFiscal','')                             as nf,
      null::text                                                   as obs,
      null::text                                                   as fav,
      nullif(det->>'cNumParcela','')                               as parc,
      abs((det->>'nValorTitulo')::numeric)                         as valor,
      coalesce((res->>'nValAberto')::numeric, abs((det->>'nValorTitulo')::numeric)) as aberto,
      nullif(det->>'cStatus','')                                   as status
    from (
      select m->'detalhes' as det, m->'resumo' as res
      from omie_cache, lateral jsonb_array_elements(dados) m
      where chave = 'movimentos'
    ) x
    where det->>'cGrupo' = 'CONTA_A_PAGAR'
      and det->>'nValorTitulo' is not null
  ),
  tudo as (
    select * from cap
    union all
    select * from mov where cod not in (select cod from cap)
  )
  select
    t.cod,
    t.venc,
    t.prev,
    coalesce(cli.nome, f.nome),
    t.fav,
    t.cpf,
    t.cat,
    coalesce(c.descricao, t.cat),
    t.doc,
    t.nf,
    t.obs,
    t.parc,
    t.valor,
    t.aberto,
    t.status
  from tudo t
  cross join janela j
  left join cat c on c.codigo = t.cat
  left join cli   on cli.codigo = t.cli
  left join lib_fornecedores f
    on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
       regexp_replace(coalesce(t.cpf,''), '\D', '', 'g')
   and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
  where t.venc between p_dia - j.d and p_dia + j.d
  order by t.venc, t.valor desc;
$$;

comment on function public.pagamentos_previstos(date, int) is
  'Títulos a pagar do Omie (cache contas_pagar + movimentos) vencendo numa janela em torno de p_dia, com observação/documento/favorecido. Usado pelo Briefing para conferir os pagamentos da agenda contra o que está provisionado no ERP.';

-- Função nova em `public` nasce chamável por anon (grant automático do Supabase);
-- aqui isso seria o contas a pagar da empresa aberto com a chave do bundle.
revoke all     on function public.pagamentos_previstos(date, int) from public;
revoke execute on function public.pagamentos_previstos(date, int) from anon;
grant  execute on function public.pagamentos_previstos(date, int) to authenticated;
