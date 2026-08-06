-- Confronto "agenda × Omie" do Briefing Diário: os títulos A PAGAR do Omie que
-- vencem perto de um dia.
--
-- POR QUE UMA FUNÇÃO NO BANCO: `omie_cache` tem RLS ligado e nenhuma policy — o
-- dump bruto do Omie (a empresa inteira) não é exposto ao cliente. Mesma decisão
-- (e mesmo desenho) de `demonstracoes_lancamentos`: SECURITY DEFINER devolvendo
-- só a fatia que a tela já mostra — aqui, uma janela de dias em torno do dia do
-- briefing. Ler do cache também evita bater na API do Omie a cada abertura da
-- página (o cache é repuxado pelas syncs diárias).
--
-- O QUE ENTRA:
--  • só `cGrupo = CONTA_A_PAGAR` (é uma conferência de PAGAMENTOS);
--  • só linhas com `nValorTitulo` — as demais são a perna de conta corrente do
--    mesmo título (têm nCodMovCC) e entrariam como duplicata de R$ 0,00;
--  • todos os status, inclusive PAGO: título vencendo hoje e já pago continua
--    PROVISIONADO — quem confere na tela decide o que fazer com essa informação.
--
-- NOME DO FORNECEDOR: o movimento traz só `nCodCliente` + CPF/CNPJ. O cache
-- `clientes` (omie-clientes-sync, semanal) resolve pelo código; quando o cliente
-- ainda não está nesse cache, cai para `lib_fornecedores` pelo documento só com
-- os dígitos. Sem os dois, volta NULL e a conferência casa por categoria/valor.

create or replace function public.pagamentos_previstos(
  p_dia         date,
  p_janela_dias int default 10   -- quantos dias antes/depois de p_dia entram
)
returns table (
  cod_titulo          bigint,
  vencimento          date,
  previsao            date,
  fornecedor          text,
  cnpj_cpf            text,
  categoria_codigo    text,
  categoria_descricao text,
  documento           text,
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
  mov as (
    select m->'detalhes' as det, m->'resumo' as res
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  base as (
    select
      det, res,
      to_date(nullif(det->>'dDtVenc',''), 'DD/MM/YYYY') as venc,
      abs((det->>'nValorTitulo')::numeric) as bruto
    from mov
    where det->>'cGrupo' = 'CONTA_A_PAGAR'
      and det->>'nValorTitulo' is not null
  )
  select
    (b.det->>'nCodTitulo')::bigint,
    b.venc,
    to_date(nullif(b.det->>'dDtPrevisao',''), 'DD/MM/YYYY'),
    coalesce(cli.nome, f.nome),
    nullif(b.det->>'cCPFCNPJCliente',''),
    nullif(b.det->>'cCodCateg',''),
    coalesce(c.descricao, b.det->>'cCodCateg'),
    coalesce(nullif(b.det->>'cNumDocFiscal',''), nullif(b.det->>'cNumTitulo','')),
    nullif(b.det->>'cNumParcela',''),
    b.bruto,
    coalesce((b.res->>'nValAberto')::numeric, b.bruto),
    nullif(b.det->>'cStatus','')
  from base b
  cross join janela j
  left join cat c on c.codigo = b.det->>'cCodCateg'
  left join cli   on cli.codigo = b.det->>'nCodCliente'
  left join lib_fornecedores f
    on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
       regexp_replace(coalesce(b.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
   and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
  where b.venc between p_dia - j.d and p_dia + j.d
  order by b.venc, b.bruto desc;
$$;

comment on function public.pagamentos_previstos(date, int) is
  'Títulos a pagar do Omie (cache) vencendo numa janela de dias em torno de p_dia. Usado pelo Briefing para conferir os pagamentos da agenda contra o que está provisionado no ERP.';

-- Toda função nova em `public` nasce com EXECUTE para anon (grant automático do
-- Supabase, ver 20260804160200). Aqui isso seria o contas a pagar da empresa
-- aberto com a anon key, que está no bundle do front — fecha.
revoke all     on function public.pagamentos_previstos(date, int) from public;
revoke execute on function public.pagamentos_previstos(date, int) from anon;
grant  execute on function public.pagamentos_previstos(date, int) to authenticated;
