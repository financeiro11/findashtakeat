-- A fila do pré-voo, MATERIALIZADA — porque recalculá-la a cada bloco a derrubava.
--
-- A primeira versão de `nfse_cadastros_a_preparar` montava a lista na hora: varria
-- os 59 mil pagamentos, casava com os 6,2 mil clientes por `dados->>'cpfCnpj'` e
-- ainda cruzava com o histórico de correções. Custava caro e era chamada UMA VEZ
-- POR BLOCO de 25 clientes — vinte e tantas vezes seguidas. Estourou o statement
-- timeout já no segundo bloco, e o pior é como estourou: a Edge Function devolvia
-- `{"status":"ok","erro":"canceling statement..."}` e o laço seguia contente,
-- fazendo nada, vinte vezes.
--
-- A lista de quem consertar não muda entre um bloco e o outro. Então ela se monta
-- uma vez, vira tabela, e cada bloco só faz `where situacao='pendente' limit N`.

create table if not exists public.nfse_preparo_fila (
  doc          text primary key,
  codigo       bigint,
  nome         text,
  id_customer  text,
  falta        text,
  valor        numeric,
  cobrancas    integer,
  -- pendente | corrigido | sem_receita | humano | bloqueado
  situacao     text not null default 'pendente',
  motivo       text,
  tentativas   integer not null default 0,
  montada_em   timestamptz not null default now(),
  tratada_em   timestamptz
);

create index if not exists nfse_preparo_fila_pendente_idx
  on public.nfse_preparo_fila (situacao, valor desc);

alter table public.nfse_preparo_fila enable row level security;
create policy nfse_preparo_fila_leitura
  on public.nfse_preparo_fila for select to authenticated using (true);
revoke all on public.nfse_preparo_fila from anon;

/*
 * Monta (ou remonta) a fila. Idempotente: quem já foi tratado guarda a situação,
 * quem sumiu da condição sai. Chamar de novo depois de uma varredura de endereço
 * é o que faz a fila encolher — o cadastro consertado deixa de ser `emitivel=false`.
 */
create or replace function public.nfse_preparo_montar(p_desde date default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  with ativos as (
    select regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
           min(c.id_asaas) as id_customer,
           sum(p.valor)    as valor,
           count(*)::int   as cobrancas
    from public.asaas_cache p
    join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
    where p.tipo = 'payment' and p.valor > 0
      and upper(coalesce(p.status,'')) in ('RECEIVED','RECEIVED_IN_CASH')
      and coalesce(p.data_pagamento, p.data_vencimento) >= coalesce(p_desde, current_date - 60)
    group by 1
  ),
  cad as (
    -- O MENOR código por documento: é o critério da fila de emissão (`min(codigo)`).
    -- 414 documentos têm cadastro duplicado no Omie; consertar o outro arrumaria
    -- um cadastro e emitiria pelo que continua torto.
    select distinct on (cnpj_cpf)
           cnpj_cpf, codigo, nome, emitivel, endereco, endereco_numero, cep, email
    from public.omie_clientes_endereco
    where cnpj_cpf is not null and cnpj_cpf <> ''
    order by cnpj_cpf, codigo
  ),
  alvo as (
    select a.doc, cad.codigo, cad.nome, a.id_customer,
           concat_ws(', ',
             case when coalesce(btrim(cad.endereco), '') = ''        then 'logradouro' end,
             case when coalesce(btrim(cad.endereco_numero), '') = '' then 'número' end,
             case when coalesce(btrim(cad.cep), '') = ''             then 'CEP' end,
             case when coalesce(btrim(cad.email), '') = ''           then 'e-mail' end
           ) as falta,
           round(a.valor, 2) as valor, a.cobrancas
    from ativos a
    join cad on cad.cnpj_cpf = a.doc
    where length(a.doc) in (11, 14) and cad.emitivel = false
  )
  insert into public.nfse_preparo_fila as f
        (doc, codigo, nome, id_customer, falta, valor, cobrancas, montada_em)
  select doc, codigo, nome, id_customer, falta, valor, cobrancas, now() from alvo
  on conflict (doc) do update
    set codigo = excluded.codigo, nome = excluded.nome, id_customer = excluded.id_customer,
        falta  = excluded.falta,  valor = excluded.valor, cobrancas = excluded.cobrancas,
        montada_em = now();

  -- Saiu da condição (cadastro consertado, cliente inativo): sai da fila. Só o
  -- que ainda está pendente — o histórico de quem foi tratado fica.
  delete from public.nfse_preparo_fila f
  where f.situacao = 'pendente'
    and not exists (
      select 1 from public.omie_clientes_endereco e
      where e.cnpj_cpf = f.doc and e.emitivel = false
    );

  select count(*) into n from public.nfse_preparo_fila where situacao = 'pendente';
  return n;
end;
$function$;

revoke all on function public.nfse_preparo_montar(date) from anon;
