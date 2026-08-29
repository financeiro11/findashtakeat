/* ============================================================================
 * A FILA DE CONSERTO PASSA A ENXERGAR AS TRÊS FONTES.
 *
 * O BURACO, medido em 29/08/2026:
 *
 *     fila de conserto (`nf_cadastros_a_corrigir`) .....  18 clientes
 *     backlog real do histórico (nov/25 a jul/26) ...... 843 clientes
 *
 * A fila lia UMA fonte: `nf_emissoes`, o nosso diário. Ou seja, só o cliente cuja
 * nota NÓS tentamos emitir e a prefeitura recusou. Cobrança que nunca passou por
 * aqui — porque no período de paralelo a nota era do Asaas — simplesmente não
 * existia para ela. São 1.056 cobranças (R$ 387.128) em que o Asaas tentou,
 * falhou, e ninguém nunca soube.
 *
 * E a fila PREVENTIVA (`nfse_preparo_fila`) tinha o buraco gêmeo: ela seleciona
 * por `omie_clientes_endereco.emitivel = false`, que é uma checagem puramente
 * ESTRUTURAL — logradouro, número, CEP e e-mail preenchidos. O erro dominante
 * não é campo vazio, é campo preenchido e errado: **CEP genérico de município**,
 * responsável por 577 recusas do lado do Asaas e 222 do nosso. Cadastro completo
 * com CEP de cidade passava por "pronto" nas duas filas.
 *
 * ---------------------------------------------------------------------------
 * AS TRÊS FONTES, e o que cada uma prova.
 *
 *   1. NOSSO DIÁRIO — a prefeitura recusou a nota que nós mandamos. Prova
 *      direta, é o que já existia.
 *   2. NOTA DO ASAAS EM `ERROR` — a prefeitura recusou a nota que ELE mandou,
 *      pelo mesmo cadastro. A prova é dele, mas o defeito é o mesmo e o conserto
 *      também. Só as famílias de CADASTRO entram: série da DPS e credencial são
 *      problema do emissor dele e evaporam quando a produção for só nossa —
 *      pôr isso na fila de conserto seria mandar arrumar o que não está quebrado.
 *   3. NUNCA TENTADA — ninguém emitiu e o cadastro não está pronto. É a fila
 *      preventiva, e é ela que ganha o sinal do CEP genérico abaixo.
 *
 * ---------------------------------------------------------------------------
 * O QUE **NÃO** MUDA, e é o que segura o custo:
 *
 * • O teto de 3 tentativas automáticas por cliente continua. Ele é o que impede
 *   a fila de gastar chamada de Receita para reescrever eternamente o mesmo
 *   endereço que a prefeitura recusa por outro motivo.
 * • A guarda "nenhuma correção depois da última recusa" continua: entra na fila
 *   quem falhou DEPOIS do último conserto, não quem já foi tratado e espera o
 *   próximo desfecho.
 * • Continua exigindo cadastro no Omie (`join omie_cli`): sem cadastro lá é
 *   outro caso, e outra ferramenta (`criar`).
 * • Nada aqui emite nada. Esta migration só amplia quem é OLHADO.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) O sinal que faltava: CEP de município
 * ------------------------------------------------------------------
 * Coluna GERADA, como `emitivel`, e pelo mesmo motivo: vale para as linhas que
 * já existem e para as que a sync escrever depois, sem que nenhuma delas
 * precise saber que ela existe.
 *
 * `000` no fim é o CEP geral da cidade — o que a Receita devolve para município
 * pequeno e o que o Portal Nacional recusa com E0240 quando quer o da rua. Não é
 * prova de defeito (município de CEP único é legítimo), é sinal de RISCO: em
 * 29/08 o refinamento pelo ViaCEP achou CEP de rua para 26 de 46 clientes assim.
 */
alter table public.omie_clientes_endereco
  add column if not exists cep_generico boolean
  generated always as (right(regexp_replace(coalesce(cep, ''), '[^0-9]', '', 'g'), 3) = '000') stored;

comment on column public.omie_clientes_endereco.cep_generico is
  'CEP terminado em 000 - o CEP geral do municipio. Nao e defeito (municipio de CEP unico e legitimo), e sinal de risco: e a causa correlacionada a 17 das 18 recusas E0240 medidas em 29/08/2026. O refinamento pelo ViaCEP (refinarCep, em omie-clientes-criar) acha o CEP da rua em cerca de metade dos casos.';

create index if not exists omie_clientes_endereco_cep_generico_idx
  on public.omie_clientes_endereco (cnpj_cpf) where cep_generico;


/* ------------------------------------------------------------------
 * 2) A fila de conserto, com as duas fontes de RECUSA
 * ------------------------------------------------------------------
 * `drop` antes do `create`: a assinatura ganha a coluna `fonte`, e trocar o
 * `returns table` num `create or replace` deixa o overload antigo vivo (ver
 * `migrations-nao-batem-com-o-banco`). O chamador em `omie-clientes-criar`
 * ignora colunas que não conhece, então acrescentar é compatível.
 */
drop function if exists public.nf_cadastros_a_corrigir(integer);

create function public.nf_cadastros_a_corrigir(p_limite integer default 15)
returns table (
  doc text, id_customer text, n_cod_cli bigint, nome text, ids text[],
  motivo text, ultima_recusa timestamptz, tentativas integer, os_faturada boolean,
  fonte text
)
language sql stable set search_path to 'public' as $function$
with ultimo as (
  -- Um por OS, o mais recente. `criar_os` é passo anterior e `email` é posterior
  -- à nota: nenhum dos dois responde "esta emissão terminou".
  select distinct on (e.n_cod_os)
         e.n_cod_os, e.id_asaas, e.resultado, e.erro, e.criado_em
  from public.nf_emissoes e
  where e.n_cod_os is not null
    and e.acao in ('faturar', 'criar_e_faturar')
  order by e.n_cod_os, e.criado_em desc
),
/* FONTE 1 — a prefeitura recusou a NOSSA nota. */
do_diario as (
  select u.id_asaas, u.erro, u.criado_em, u.n_cod_os, 'nosso'::text as fonte
  from ultimo u
  where u.resultado = 'erro'
    /* A recusa por endereço, nas duas vozes: a do Omie ("falta preencher o
     * Número do Endereço") e a da prefeitura (E0240 do CEP, E0921/E0922 do
     * código do município). Ver nfse-presas-cadastro-do-tomador. */
    and (
      u.erro ilike '%falta preencher%'
      or u.erro like '%E0240%'
      or u.erro like '%E0921%'
      or u.erro like '%E0922%'
      or u.erro ilike '%código do município%'
    )
),
/* FONTE 2 — a prefeitura recusou a nota DELE, pelo mesmo cadastro.
 *
 * Só famílias de cadastro. Série da DPS (356 casos) e credencial (196) ficam de
 * fora de propósito: são da conta do Asaas, somem quando a produção for só pelo
 * Omie, e não há cadastro a consertar.
 *
 * `effectiveDate` é a data do desfecho e é ela que a guarda "nenhum conserto
 * depois da última recusa" compara. Sem data utilizável a linha fica de fora —
 * entrar sem data furaria a guarda e a fila repetiria o cliente para sempre. */
do_asaas as (
  select n.pagamento_ref as id_asaas,
         n.dados->>'statusDescription' as erro,
         ((n.dados->>'effectiveDate')::date)::timestamptz as criado_em,
         null::bigint as n_cod_os,
         'asaas'::text as fonte
  from public.asaas_cache n
  where n.tipo = 'invoice'
    and upper(coalesce(n.status, '')) = 'ERROR'
    and n.pagamento_ref is not null
    and (n.dados->>'effectiveDate') ~ '^\d{4}-\d{2}-\d{2}$'
    and (
      n.dados->>'statusDescription' ilike '%E0240%'
      or n.dados->>'statusDescription' ilike '%CEP informado%'
      or n.dados->>'statusDescription' ilike '%E0921%'
      or n.dados->>'statusDescription' ilike '%E0922%'
      or n.dados->>'statusDescription' ilike '%telefone%'
      or n.dados->>'statusDescription' ilike '%Dados Pessoa%'
      or n.dados->>'statusDescription' ilike '%formul%'
    )
    -- Nota boa dele para a MESMA cobrança encerra o assunto.
    and not exists (
      select 1 from public.asaas_cache b
      where b.tipo = 'invoice' and b.pagamento_ref = n.pagamento_ref
        and upper(coalesce(b.status, '')) not in ('ERROR', 'CANCELLED', 'CANCELED')
    )
    -- Nossa nota autorizada também.
    and not exists (
      select 1 from public.nf_os_omie o
      where o.cancelada = false and o.nfse_status = '004'
        and o.c_cod_int_os = n.pagamento_ref
    )
),
evidencia as (
  select * from do_diario
  union all
  select * from do_asaas
),
comdoc as (
  select r.*,
         p.dados->>'customer' as id_customer,
         regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         coalesce(c.dados->>'name', c.dados->>'company', '—') as nome,
         coalesce(o.faturada, false) as os_faturada
  from evidencia r
  join public.asaas_cache p on p.tipo = 'payment' and p.id_asaas = r.id_asaas
  join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
  left join public.nf_os_omie o on o.n_cod_os = r.n_cod_os
),
omie_cli as (
  select regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') as doc,
         min((c->>'codigo')::bigint) as codigo
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
    and regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') <> ''
  group by 1
),
porcliente as (
  select d.doc,
         min(d.id_customer) as id_customer,
         min(d.nome)        as nome,
         array_agg(d.id_asaas order by d.criado_em desc) as ids,
         (array_agg(d.erro  order by d.criado_em desc))[1] as motivo,
         max(d.criado_em)   as ultima_recusa,
         bool_and(d.os_faturada) as os_faturada,
         /* Quando as duas fontes acusam o mesmo cliente, o rótulo diz as duas —
            e "ambas" é o caso mais forte: o cadastro derrubou nota nossa E dele. */
         case when count(distinct d.fonte) > 1 then 'ambas' else min(d.fonte) end as fonte
  from comdoc d
  where length(d.doc) in (11, 14)
  group by d.doc
)
select pc.doc, pc.id_customer, oc.codigo, pc.nome, pc.ids, pc.motivo,
       pc.ultima_recusa,
       (select count(*)::int from public.nf_cadastro_correcoes k
         where k.doc = pc.doc and k.origem = 'automatico') as tentativas,
       pc.os_faturada,
       pc.fonte
from porcliente pc
join omie_cli oc on oc.doc = pc.doc          -- sem cadastro no Omie é outro caso: `criar`
where not exists (
        select 1 from public.nf_cadastro_correcoes k
        where k.doc = pc.doc and k.origem = 'automatico'
          and k.criado_em > pc.ultima_recusa
      )
  and (select count(*) from public.nf_cadastro_correcoes k
        where k.doc = pc.doc and k.origem = 'automatico') < 3
order by pc.ultima_recusa desc
limit greatest(p_limite, 0);
$function$;

revoke all on function public.nf_cadastros_a_corrigir(integer) from public, anon;
grant execute on function public.nf_cadastros_a_corrigir(integer) to authenticated, service_role;


/* ------------------------------------------------------------------
 * 3) A fila preventiva passa a ver o CEP de município
 * ------------------------------------------------------------------
 * Mesma função de antes, com `emitivel = false` virando "não está pronto" —
 * que agora tem duas causas. O `falta` ganha a terceira palavra, porque é ele
 * que a tela mostra e "CEP" (vazio) e "CEP de cidade" (preenchido e arriscado)
 * pedem ações diferentes de quem lê.
 */
create or replace function public.nfse_preparo_montar(p_desde date default null::date)
returns integer
language plpgsql security definer set search_path to 'public' as $function$
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
           cnpj_cpf, codigo, nome, emitivel, cep_generico, endereco, endereco_numero, cep, email
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
             case when coalesce(btrim(cad.email), '') = ''           then 'e-mail' end,
             -- Preenchido e arriscado, não vazio: pede refinamento, não preenchimento.
             case when cad.cep_generico                              then 'CEP de cidade' end
           ) as falta,
           round(a.valor, 2) as valor, a.cobrancas
    from ativos a
    join cad on cad.cnpj_cpf = a.doc
    where length(a.doc) in (11, 14)
      and (cad.emitivel = false or cad.cep_generico)
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
      where e.cnpj_cpf = f.doc and (e.emitivel = false or e.cep_generico)
    );

  select count(*) into n from public.nfse_preparo_fila where situacao = 'pendente';
  return n;
end;
$function$;
