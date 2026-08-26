-- Quem consertar ANTES do corte, em vez de descobrir falhando.
--
-- Com `omie_clientes_endereco` preenchido, a pergunta que era impossível passou a
-- ser um `where`. Medido em 26/08/26 sobre os clientes com cobrança recebida desde
-- 01/07: **2.552 ativos com cadastro no Omie, 564 (22,1%) não emitem** — 556 sem
-- número do endereço, 185 sem logradouro, 70 sem e-mail. Sem esta varredura, esses
-- 564 viram 564 recusas no primeiro dia de setembro; com ela, viram zero.
--
-- A ordem é por VALOR, e não é vaidade: a varredura anda ~30 clientes por
-- invocação, e se ela for interrompida no meio o que já foi feito tem de ser o que
-- mais importa.

create or replace function public.nfse_cadastros_a_preparar(
  p_limite integer default 30,
  p_desde  date default null
)
returns table(
  doc text, codigo bigint, nome text, id_customer text,
  falta text, valor_ultimos_meses numeric, cobrancas integer
)
language sql
stable
set search_path to 'public'
as $function$
with ativos as (
  select regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         min(c.id_asaas) as id_customer,
         sum(p.valor) as valor,
         count(*)::int as cobrancas
  from public.asaas_cache p
  join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
  where p.tipo = 'payment' and p.valor > 0
    and upper(coalesce(p.status,'')) in ('RECEIVED','RECEIVED_IN_CASH')
    and coalesce(p.data_pagamento, p.data_vencimento) >= coalesce(p_desde, current_date - 60)
  group by 1
),
cad as (
  -- O MENOR código por documento, que é o critério da fila de emissão
  -- (`min(codigo)`). Consertar outro cadastro do mesmo CNPJ arrumaria um e
  -- emitiria pelo outro — 414 documentos têm cadastro duplicado no Omie.
  select distinct on (cnpj_cpf)
         cnpj_cpf, codigo, nome, emitivel, endereco, endereco_numero, cep, email
  from public.omie_clientes_endereco
  where cnpj_cpf is not null and cnpj_cpf <> ''
  order by cnpj_cpf, codigo
)
select a.doc, cad.codigo, cad.nome, a.id_customer,
       concat_ws(', ',
         case when coalesce(btrim(cad.endereco), '') = ''        then 'logradouro' end,
         case when coalesce(btrim(cad.endereco_numero), '') = '' then 'número' end,
         case when coalesce(btrim(cad.cep), '') = ''             then 'CEP' end,
         case when coalesce(btrim(cad.email), '') = ''           then 'e-mail' end
       ) as falta,
       round(a.valor, 2), a.cobrancas
from ativos a
join cad on cad.cnpj_cpf = a.doc
where length(a.doc) in (11, 14)
  and cad.emitivel = false
  /* Já tentado preventivamente: não se repete. Quem continuar incompleto depois
   * da tentativa é caso humano — o cadastro que nem a Receita resolve (logradouro
   * preenchido com o nome da cidade, número "00") existe e não some com insistência. */
  and not exists (
    select 1 from public.nf_cadastro_correcoes k
    where k.doc = a.doc and k.origem = 'preventivo'
  )
order by a.valor desc
limit greatest(p_limite, 0);
$function$;

comment on function public.nfse_cadastros_a_preparar(integer, date) is
  'Clientes ativos cujo cadastro no Omie não emite NFS-e, em ordem de valor. Alimenta a varredura preventiva da omie-clientes-criar.';

revoke all on function public.nfse_cadastros_a_preparar(integer, date) from anon;
