-- Reembolso e título de teste saem da remuneração.
--
-- EU TINHA RESPONDIDO QUE REEMBOLSO NÃO ENTRAVA, e estava errado. Conferi
-- olhando as CATEGORIAS: não existe categoria "Reembolso" no ERP, então concluí
-- que nenhum reembolso chegava aqui. Só que o reembolso não tem categoria
-- própria — ele é lançado DENTRO da categoria de pessoal da própria pessoa, e o
-- que o identifica é o número do título, `REIMB-*`, que o módulo de Reembolsos
-- do Hub carimba.
--
-- O sintoma: o Thayrone aparecia com R$ 27.800 de fixo em agosto (R$ 27.500 de
-- salário + R$ 300 de um reembolso) e a tela lia isso como um reajuste de
-- +R$ 300. O Wericles aparecia com "fixo hoje R$ 333", que era um reembolso
-- inteiro e nenhum salário.
--
-- E a Júlia aparecia com R$ 4.603,71 porque existe um título de R$ 3,71 com
-- `cCodIntTitulo = 'TESTE-TETS-...'` — registro deixado por teste da agente no
-- ERP, não dinheiro.
--
-- O FILTRO É POR IDENTIFICADOR, NÃO POR VALOR. Um piso de "ignore abaixo de
-- R$ 400" mataria escala de verdade (que vai de R$ 120 a R$ 600) e premiação
-- pequena. `REIMB` e `TESTE` dizem o que a linha é; o valor só diz que ela é
-- pequena, que é outra coisa.
--
-- São 4 reembolsos (R$ 967) e 1 teste (R$ 3,71) na janela atual. Pouco dinheiro
-- e muita distorção: os dois casos acima estavam na primeira tela que alguém
-- abriu.

drop view if exists public.vw_remuneracao_omie;

create view public.vw_remuneracao_omie
with (security_invoker = true) as
with mov as (
  select distinct on ((((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint))
    (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint)                         as cod_titulo,
    nullif((d.value -> 'detalhes') ->> 'cCodCateg', '')                          as categoria_codigo,
    ((d.value -> 'detalhes') ->> 'nValorTitulo')::numeric                        as valor,
    to_date(nullif((d.value -> 'detalhes') ->> 'dDtRegistro', ''), 'DD/MM/YYYY') as registro,
    to_date(nullif((d.value -> 'detalhes') ->> 'dDtVenc', ''), 'DD/MM/YYYY')     as vencimento,
    to_date(nullif((d.value -> 'detalhes') ->> 'dDtPagamento', ''), 'DD/MM/YYYY') as pagamento,
    regexp_replace(coalesce((d.value -> 'detalhes') ->> 'cCPFCNPJCliente', ''), '\D', '', 'g') as doc_mov,
    nullif((d.value -> 'detalhes') ->> 'nCodCliente', '')                        as cod_cliente,
    -- Os dois campos que dizem O QUE a linha é, e não quanto ela vale.
    coalesce((d.value -> 'detalhes') ->> 'cNumTitulo', '')                       as num_titulo,
    coalesce((d.value -> 'detalhes') ->> 'cCodIntTitulo', '')                    as cod_integracao
  from public.omie_cache, lateral jsonb_array_elements(omie_cache.dados) d
  where omie_cache.chave = 'movimentos'
    and ((d.value -> 'detalhes') ->> 'cGrupo') = 'CONTA_A_PAGAR'
  order by (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint)
),
cadastro as materialized (
  select c.value ->> 'codigo' as codigo,
         regexp_replace(coalesce(c.value ->> 'cnpj_cpf', ''), '\D', '', 'g') as doc,
         nullif(btrim(c.value ->> 'nome'), '') as nome
  from public.omie_cache, lateral jsonb_array_elements(omie_cache.dados) c
  where omie_cache.chave = 'clientes'
),
cadastro_doc as materialized (
  select doc, min(nome) as nome from cadastro where doc <> '' group by doc
),
ape_doc as materialized (
  select chave, min(apelido) as apelido from public.contraparte_apelido
  where via = 'doc' and apelido is not null group by chave
),
ape_nome as materialized (
  select chave, min(apelido) as apelido from public.contraparte_apelido
  where via = 'nome' and apelido is not null group by chave
),
base as (
  select m.cod_titulo, m.valor, m.registro, m.vencimento, m.pagamento, m.doc_mov,
         r.descricao as categoria,
         coalesce(nullif(btrim(t.favorecido), ''), cad.nome, cadd.nome) as nome_cru
  from mov m
    join public.omie_categoria_regra r on r.codigo = m.categoria_codigo
    left join cadastro cad       on cad.codigo = m.cod_cliente
    left join cadastro_doc cadd  on cadd.doc = nullif(m.doc_mov, '')
    left join public.omie_titulo_texto t on t.cod_titulo = m.cod_titulo
  where (r.descricao ~* '(Pessoal|Premia[çc][ãa]o|Escala)\s*-'
      or r.descricao ~* 'Pro\s*Labore'
      or r.descricao ~* 'Diretores\s*-')
    -- Reembolso é despesa da pessoa que a empresa devolve, não remuneração.
    -- Vem carimbado pelo módulo de Reembolsos do Hub.
    and m.num_titulo      !~* '^REIMB'
    and m.cod_integracao  !~* '^REIMB'
    -- Título de teste da agente. Não é dinheiro.
    and m.cod_integracao  !~* '^TESTE'
)
select
  b.cod_titulo,
  b.categoria,
  b.valor,
  b.vencimento,
  b.pagamento,
  date_trunc('month', b.registro)::date as competencia,
  case
    when b.categoria ~* 'Premia[çc][ãa]o' then 'premiacao'
    when b.categoria ~* 'Escala'          then 'escala'
    when b.categoria ~* 'Pro\s*Labore'    then 'prolabore'
    else 'fixo'
  end as bloco,
  coalesce(ad.apelido, an.apelido, b.nome_cru) as nome,
  b.nome_cru,
  b.registro,
  nullif(b.doc_mov, '') as doc
from base b
  left join ape_doc ad
    on nullif(b.doc_mov, '') is not null and ad.chave = b.doc_mov
  left join ape_nome an
    on length(public.contraparte_chave(coalesce(b.nome_cru, ''))) >= 4
   and an.chave = public.contraparte_chave(b.nome_cru)
where b.registro is not null
  and b.nome_cru is not null
  -- Os 101 títulos de R$ 0,01 de abril, que são lançamento de ajuste.
  and b.valor >= 1;

comment on view public.vw_remuneracao_omie is
  'Movimentos do Omie que SÃO remuneração — sem reembolso, sem título de teste, sem centavo de ajuste.';

revoke all on public.vw_remuneracao_omie from anon;

/* ------------------------------------------------------------------ */
/* A carga passa a limpar o que deixou de ser remuneração              */
/* ------------------------------------------------------------------ */

-- Faltava a outra metade: a carga só inseria e atualizava. Um título que sai da
-- vista — porque virou reembolso, porque foi reclassificado no ERP, porque foi
-- excluído — ficava gravado para sempre, e nenhuma passada o tirava.
--
-- A poda é ESTREITA de propósito: só apaga dentro da janela de competências que
-- o cache enxerga hoje. Fora dela a tabela é o histórico (o Conta Azul virá
-- para lá), e o cache é uma janela rolante — podar pelo que ele não vê
-- apagaria o passado inteiro no dia em que a janela andasse.
create or replace function public.remuneracao_carregar_omie()
returns table (pessoas_novas integer, lancamentos_gravados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pessoas integer := 0;
  v_lanc    integer := 0;
  v_de      date;
  v_ate     date;
begin
  select min(competencia), max(competencia) into v_de, v_ate from public.vw_remuneracao_omie;

  with novas as (
    insert into public.remuneracao_pessoa (nome, chave, doc)
    select distinct on (public.contraparte_chave(v.nome))
      v.nome, public.contraparte_chave(v.nome), v.doc
    from public.vw_remuneracao_omie v
    where v.nome is not null
      and length(public.contraparte_chave(v.nome)) >= 4
      and public.remuneracao_pessoa_por_chave(public.contraparte_chave(v.nome)) is null
    order by public.contraparte_chave(v.nome), v.vencimento desc
    on conflict (chave) do nothing
    returning 1
  )
  select count(*) into v_pessoas from novas;

  update public.remuneracao_pessoa p
     set doc = v.doc
    from (select distinct on (public.contraparte_chave(nome))
                 public.contraparte_chave(nome) as chave, doc
            from public.vw_remuneracao_omie
           where doc is not null
           order by public.contraparte_chave(nome), vencimento desc) v
   where p.doc is null
     and p.id = public.remuneracao_pessoa_por_chave(v.chave);

  with gravados as (
    insert into public.remuneracao_lancamento
      (pessoa_id, competencia, bloco, valor, fonte, origem_ref, categoria, vencimento, pagamento)
    select pid, v.competencia, v.bloco, v.valor, 'omie', v.cod_titulo::text,
           v.categoria, v.vencimento, v.pagamento
    from public.vw_remuneracao_omie v
      cross join lateral (
        select public.remuneracao_pessoa_por_chave(public.contraparte_chave(v.nome)) as pid
      ) r
    where r.pid is not null
    on conflict (fonte, origem_ref) do update
      set valor         = excluded.valor,
          competencia   = excluded.competencia,
          bloco         = excluded.bloco,
          categoria     = excluded.categoria,
          vencimento    = excluded.vencimento,
          pagamento     = excluded.pagamento,
          pessoa_id     = excluded.pessoa_id,
          atualizado_em = now()
    returning 1
  )
  select count(*) into v_lanc from gravados;

  if v_de is not null then
    delete from public.remuneracao_lancamento l
     where l.fonte = 'omie'
       and l.competencia between v_de and v_ate
       and not exists (
         select 1 from public.vw_remuneracao_omie v
          where v.cod_titulo::text = l.origem_ref
       );
  end if;

  return query select v_pessoas, v_lanc;
end $$;

select public.remuneracao_atualizar();
