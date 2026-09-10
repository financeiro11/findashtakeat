/* ---------------------------------------------------------------------------
 * O CEP vale se EXISTE nos Correios — não se termina em 000.
 *
 * A DESCOBERTA (09/09/2026). O Hub tratava `cep_generico` — terminado em `000` —
 * como a causa do `E0240` ("o CEP informado não existe ou não pertence ao
 * município do endereço do tomador"). A correlação medida em 29/08 era real (17
 * das 18 recusas daquele lote tinham CEP `000`), mas a causa era outra, e o
 * critério errado começou a doer quando o volume cresceu.
 *
 * O que separa quem emite de quem é recusado é uma pergunta só: **este CEP
 * existe na base dos Correios?** Medido em 24 cadastros, 12 de cada lado:
 * 12/12 dos que emitem existem no ViaCEP, 12/12 dos recusados voltam
 * `{"erro": true}`. Na população: das 253 OS paradas em `precisa_de_gente` por
 * CEP, **252 têm CEP inexistente** — uma só não.
 *
 * O critério velho erra dos DOIS lados, e é por isso que apertá-lo não resolvia:
 *   • `45810-000` (Porto Seguro) termina em `000`, EXISTE, e emite. São 337
 *     cadastros com CEP "genérico" emitindo sem problema nenhum — todos eles
 *     seriam mandados para a fila de conserto sem ter defeito.
 *   • `41750-166` (Salvador), `90520-002` (Porto Alegre), `66093-380` (Belém)
 *     têm cara de CEP de rua e NÃO existem mais na base. Todos recusados, e
 *     nenhum deles a régua velha enxergava.
 *
 * POR QUE COLUNA E NÃO EXPRESSÃO GERADA, como `cep_generico`: a resposta não
 * está no dado, está numa base externa. Não dá para calcular em SQL — tem de ser
 * perguntado ao ViaCEP e GUARDADO. Daí `cep_valido` + `cep_checado_em`: a
 * segunda existe para que "nunca perguntei" (null) não se confunda com
 * "perguntei e não existe" (false), que é a mesma distinção que o módulo
 * `_shared/cep.ts` faz com o `null` de `existeNosCorreios`.
 *
 * `cep_generico` FICA. Ela não é mais o critério de trabalho, mas continua sendo
 * um fato do dado (e a tela ainda a mostra). Removê-la seria uma segunda mudança
 * no mesmo lugar, sem ganho.
 * ------------------------------------------------------------------------- */

alter table public.omie_clientes_endereco
  add column if not exists cep_valido boolean,
  add column if not exists cep_checado_em timestamptz;

comment on column public.omie_clientes_endereco.cep_valido is
  'O CEP existe na base dos Correios (ViaCEP)? null = nunca perguntado. É este campo, e não cep_generico, que prevê a recusa E0240 — medido em 252 de 253 OS travadas.';
comment on column public.omie_clientes_endereco.cep_checado_em is
  'Quando o ViaCEP foi consultado. Distingue "nunca perguntei" de "perguntei e não existe" — sem ela, uma queda de rede viraria "CEP inválido" para a base inteira.';

-- Parcial: quem interessa é a minoria inválida e a minoria nunca checada. O
-- índice cheio seria maior que as duas perguntas que ele responde.
create index if not exists omie_clientes_endereco_cep_invalido_idx
  on public.omie_clientes_endereco (cnpj_cpf) where cep_valido is false;
create index if not exists omie_clientes_endereco_cep_a_checar_idx
  on public.omie_clientes_endereco (codigo) where cep_valido is null;


/* ---------------------------------------------------------------------------
 * A FILA DE VERIFICAÇÃO — quem o Hub ainda não perguntou aos Correios
 * ---------------------------------------------------------------------------
 * São 6.480 cadastros e uma consulta HTTP por CEP. Varrer tudo de uma vez não
 * cabe no relógio do worker, e não precisa: a ordem abaixo põe na frente quem
 * tem consequência hoje.
 *
 * A ORDEM É A REGRA DE NEGÓCIO desta função, e é deliberada:
 *   1. quem tem OS recusada em aberto — é dinheiro parado agora;
 *   2. quem faturou nos últimos 60 dias — é quem vai emitir amanhã;
 *   3. o resto, do mais antigo para o mais novo.
 *
 * `p_revalidar_dias` existe porque CEP é dado vivo: os Correios aposentam faixa,
 * e um cadastro checado há seis meses pode ter deixado de valer. Zero (padrão)
 * significa "só os nunca checados" — a varredura de rotina.
 */
create or replace function public.ceps_a_validar(
  p_limite integer default 200,
  p_revalidar_dias integer default 0
)
returns table (codigo bigint, cnpj_cpf text, cep text, uf text, cidade text,
               logradouro text, bairro text, prioridade integer)
language sql stable security invoker set search_path = public as $$
with recusada as (
  select distinct o.n_cod_cli
  from public.nf_os_omie o
  where o.cancelada = false and o.nfse_status = '003'
    and coalesce(o.nfse_numero, '') = ''
    and o.carimbo_liberado_em is null
    and o.data_faturamento >= current_date - 120
),
recente as (
  select distinct o.n_cod_cli
  from public.nf_os_omie o
  where o.cancelada = false and o.data_faturamento >= current_date - 60
)
select e.codigo, e.cnpj_cpf, e.cep, e.estado, e.cidade, e.endereco, e.bairro,
       (case when r.n_cod_cli is not null then 1
             when q.n_cod_cli is not null then 2
             else 3 end)::int as prioridade
from public.omie_clientes_endereco e
left join recusada r on r.n_cod_cli = e.codigo
left join recente  q on q.n_cod_cli = e.codigo
where e.cep ~ '^[0-9]{8}$'
  and (e.cep_valido is null
       or (p_revalidar_dias > 0
           and e.cep_checado_em < now() - make_interval(days => p_revalidar_dias)))
order by prioridade, e.cep_checado_em nulls first, e.codigo
limit greatest(p_limite, 0);
$$;

comment on function public.ceps_a_validar(integer, integer) is
  'Cadastros cujo CEP ainda não foi conferido nos Correios, na ordem em que doem: recusa aberta, faturamento recente, resto. Consumida pela ação validar_ceps da omie-clientes-criar.';

revoke all on function public.ceps_a_validar(integer, integer) from public, anon;
grant execute on function public.ceps_a_validar(integer, integer) to authenticated, service_role;


/* ---------------------------------------------------------------------------
 * A LISTA DE RECUSAS PASSA A DIZER QUAL É O DEFEITO DE VERDADE
 * ---------------------------------------------------------------------------
 * Hoje a tela mostra o selo "CEP de cidade" quando `cep_generico`, e esse selo
 * mente nos dois sentidos: aparece em cadastro que emite bem e falta justamente
 * em `41750-166`, que é o que está travando. `cep_valido` entra ao lado — não no
 * lugar — para que a tela possa dizer "CEP não existe nos Correios", que é a
 * frase que manda a pessoa fazer a coisa certa.
 *
 * `drop` + `create`, e não `create or replace`: acrescentar coluna muda o
 * `returns table`, e o Postgres recusa a substituição. O único dependente é
 * `nfse_recusas_reemitiveis`, que faz `with r as (select * from ...)` e depois
 * escolhe colunas pelo nome — a coluna nova passa por ela sem ser notada. O
 * corpo abaixo é cópia fiel de `20260909230000`, com duas linhas a mais.
 * ------------------------------------------------------------------------- */

drop function if exists public.nfse_recusas_a_tratar(integer);

create function public.nfse_recusas_a_tratar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, cep_valido boolean, emitivel boolean,
  situacao text, consertado_em timestamptz, o_que_foi_feito text
)
language sql stable set search_path to 'public' as $function$
with recusa as (
  select o.n_cod_os, o.c_num_os, o.c_cod_int_os, o.cnpj_cpf, o.n_cod_cli,
         o.valor, o.data_faturamento, o.nfse_mensagem
  from public.nf_os_omie o
  where o.cancelada = false
    and o.nfse_status = '003'
    and coalesce(o.nfse_numero, '') = ''
    and o.carimbo_liberado_em is null
    and o.data_faturamento >= current_date - make_interval(days => greatest(p_dias, 1))
),
conserto as (
  select r.n_cod_os,
         max(k.criado_em) as consertado_em,
         (array_agg(k.resultado order by k.criado_em desc))[1] as resultado
  from recusa r
  join public.nf_cadastro_correcoes k
    on k.doc = r.cnpj_cpf
   and k.criado_em > r.data_faturamento::timestamptz
  where (k.resultado->'omie'->>'ok')::boolean is true
  group by r.n_cod_os
)
select r.n_cod_os, r.c_num_os, r.c_cod_int_os, r.cnpj_cpf,
       coalesce(en.nome, '—'),
       r.valor, r.data_faturamento,
       coalesce(r.nfse_mensagem, '(sem mensagem)'),
       case
         when r.nfse_mensagem ilike '%E0240%'  then 'CEP do cliente não confere com o município'
         when r.nfse_mensagem ilike '%E0921%'
           or r.nfse_mensagem ilike '%E0922%'  then 'Código do município do cliente'
         when r.nfse_mensagem ilike '%E0207%'  then 'CPF não existe no cadastro da Receita'
         when r.nfse_mensagem ilike '%E1235%'  then 'Telefone do cliente inválido'
         when r.nfse_mensagem ilike '%falta preencher%' then 'Cadastro incompleto no Omie'
         when r.nfse_mensagem ilike '%403%'
           or r.nfse_mensagem ilike '%Nenhuma resposta%'
           or r.nfse_mensagem ilike '%sobrecarregados%' then 'Instabilidade da prefeitura — reenviar resolve'
         else 'Ver mensagem da prefeitura'
       end,
       en.cep, en.cep_generico, en.cep_valido, en.emitivel,
       case
         when r.nfse_mensagem ilike '%403%'
           or r.nfse_mensagem ilike '%Nenhuma resposta%'
           or r.nfse_mensagem ilike '%sobrecarregados%' then 'so_reenviar'
         when c.n_cod_os is not null then 'consertado'
         else 'precisa_de_gente'
       end,
       c.consertado_em,
       case
         when c.n_cod_os is null then null
         else concat_ws(', ',
           nullif(c.resultado->'omie'->'escrito'->>'endereco', ''),
           nullif(c.resultado->'omie'->'escrito'->>'endereco_numero', ''),
           nullif(c.resultado->'omie'->'escrito'->>'cep', ''))
       end
from recusa r
left join public.omie_clientes_endereco en on en.codigo = r.n_cod_cli
left join conserto c on c.n_cod_os = r.n_cod_os
order by r.data_faturamento desc, r.valor desc;
$function$;

revoke all on function public.nfse_recusas_a_tratar(integer) from public, anon;
grant execute on function public.nfse_recusas_a_tratar(integer) to authenticated, service_role;


/* ---------------------------------------------------------------------------
 * A FILA DO PRÉ-VOO PASSA A USAR A RÉGUA NOVA
 * ---------------------------------------------------------------------------
 * Mesma troca, no lugar onde ela vale dinheiro: `nfse_preparo_montar` puxava
 * para a fila todo cadastro com CEP terminado em `000`. Eram 1.099 cadastros, e
 * 337 deles emitem sem problema — trabalho inventado. Com `cep_valido is false`
 * a fila passa a conter só quem a prefeitura vai mesmo recusar.
 *
 * `cep_valido is false` e não `not cep_valido`: quem ainda não foi checado é
 * `null`, e `not null` é `null` — o cadastro nunca perguntado ficaria fora da
 * fila em silêncio. O `is false` diz o que se quer: perguntamos, e não existe.
 * ------------------------------------------------------------------------- */
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
    select distinct on (cnpj_cpf)
           cnpj_cpf, codigo, nome, emitivel, cep_generico, cep_valido,
           endereco, endereco_numero, cep, email
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
             -- Preenchido e inexistente: pede refinamento, não preenchimento.
             case when cad.cep_valido is false                       then 'CEP não existe nos Correios' end
           ) as falta,
           round(a.valor, 2) as valor, a.cobrancas
    from ativos a
    join cad on cad.cnpj_cpf = a.doc
    where length(a.doc) in (11, 14)
      and (cad.emitivel = false or cad.cep_valido is false)
  )
  insert into public.nfse_preparo_fila as f
        (doc, codigo, nome, id_customer, falta, valor, cobrancas, montada_em)
  select doc, codigo, nome, id_customer, falta, valor, cobrancas, now() from alvo
  on conflict (doc) do update
    set codigo = excluded.codigo, nome = excluded.nome, id_customer = excluded.id_customer,
        falta  = excluded.falta,  valor = excluded.valor, cobrancas = excluded.cobrancas,
        montada_em = now();

  delete from public.nfse_preparo_fila f
  where f.situacao = 'pendente'
    and not exists (
      select 1 from public.omie_clientes_endereco e
      where e.cnpj_cpf = f.doc and (e.emitivel = false or e.cep_valido is false)
    );

  select count(*) into n from public.nfse_preparo_fila where situacao = 'pendente';
  return n;
end;
$function$;


/* ---------------------------------------------------------------------------
 * CÓDIGO MORTO QUE MENTE — `nfse_cadastros_a_preparar` sai
 * ---------------------------------------------------------------------------
 * Ela foi a primeira versão do pré-voo e foi substituída por
 * `nfse_preparo_montar` + `nfse_preparo_fila` porque recalculá-la a cada bloco
 * derrubava a função (está escrito no cabeçalho de `20260826250000`). Não tem
 * um único chamador — nem em TS, nem em cron, nem em outra função.
 *
 * O problema de deixá-la é que ela ficou parada na régua ANTIGA — só
 * `emitivel = false`, sem nem o `cep_generico`. Quem a encontrar procurando "a
 * fila de preparo" vai ler a regra errada e concluir que o CEP não entra no
 * critério. Duas funções com o mesmo nome de negócio e regras diferentes é
 * como se perde uma tarde.
 * ------------------------------------------------------------------------- */
drop function if exists public.nfse_cadastros_a_preparar(integer, date);
