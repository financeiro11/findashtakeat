-- A carga da remuneração a partir do Omie.
--
-- Duas peças: uma view que LÊ o cache de movimentos já traduzido para o
-- vocabulário deste painel, e uma função que GRAVA o que ela devolve.
--
-- POR QUE UMA VIEW PRÓPRIA e não `cap_titulos`: aquela view resolve o mesmo
-- favorecido, mas carrega junto toda a maquinaria de anexos, notas fiscais e
-- gravidade que o painel de Auditoria precisa e este não. São ~150 linhas de
-- junções irrelevantes em cima de uma leitura que roda a cada carga. Aqui ficam
-- só as quatro peças que importam: movimento, categoria, favorecido e apelido.

/* ------------------------------------------------------------------ */
/* A leitura                                                           */
/* ------------------------------------------------------------------ */

-- `drop` antes do `create`, e não `create or replace`: aquele recusa qualquer
-- mudança na ORDEM ou no NOME das colunas ("cannot change name of view column"),
-- então toda vez que uma coluna nova entrar no meio a migration falharia. Nada
-- depende desta view a não ser a função abaixo, que só resolve o nome quando
-- roda — derrubar e recriar é seguro aqui.
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
    nullif((d.value -> 'detalhes') ->> 'nCodCliente', '')                        as cod_cliente
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
  -- O TRAÇO é o que separa categoria de pessoa de grupo contábil: existe uma
  -- categoria-pai "Despesas com Pessoal" (2.03) que casaria com um filtro só
  -- por "Pessoal" e traria lançamento agregado, sem dono.
  --
  -- "Diretores - Administrativo" (3.2.22) entra apesar de não ter "Pessoal" no
  -- nome: são quatro pessoas com remuneração mensal — Miguel Carvalho, Luiz
  -- Paulo, Pedro Faro e Victor Brittes. Sem ela o painel deixaria de fora a
  -- própria diretoria que pediu o painel.
  --
  -- O que NÃO entra, e por quê:
  --   3.1.1.9 Benefícios - Colaboradores  o favorecido é "Flash App", não a
  --                                       pessoa. É custo de gente, mas o
  --                                       rateio por pessoa não existe no ERP
  --                                       (mora em `rh_colaboradores.flash`).
  --   3.1.3.10 Influencer Fixo            criador de conteúdo contratado.
  --   3.1.3.11 Consultor / Parceiro       fornecedor, não colaborador.
  where r.descricao ~* '(Pessoal|Premia[çc][ãa]o|Escala)\s*-'
     or r.descricao ~* 'Pro\s*Labore'
     or r.descricao ~* 'Diretores\s*-'
)
select
  b.cod_titulo,
  b.categoria,
  b.valor,
  b.vencimento,
  b.pagamento,

  -- A COMPETÊNCIA É O MÊS DO REGISTRO (`dDtRegistro`).
  --
  -- Três datas competiam por este posto, e a escolha não é óbvia:
  --
  --   dDtEmissao   descartada: é NULA na maioria dos títulos — só os que o Hub
  --                provisionou (ago/2026 em diante) a preenchem.
  --   dDtVenc      quase certa: o fixo vence dia 05/07 e a premiação dia 15,
  --                ambos do mês SEGUINTE ao trabalhado, então "vencimento menos
  --                um mês" acerta 977 dos 1.136 títulos.
  --   dDtRegistro  a escolhida: preenchida em 100% dos títulos e é a âncora da
  --                DRE, então o painel e a demonstração falam do mesmo mês.
  --
  -- Onde as duas últimas divergem, é o REGISTRO que está certo: os 5 títulos de
  -- pro labore são registrados e pagos no mesmo mês, e a regra derivada do
  -- vencimento jogaria todos eles um mês para trás — sempre, sem exceção. O
  -- mesmo vale para os 33 pagamentos avulsos do fixo (R$ 162k) que não seguem o
  -- ciclo da folha.
  --
  -- Nos 321 de 338 títulos de premiação em que as duas regras concordam, a
  -- leitura é a que o financeiro confirmou: a comissão paga em 15/08 é a de
  -- julho, o mesmo mês do fixo que vence em 05/08.
  date_trunc('month', b.registro)::date as competencia,

  -- Classificação pela PALAVRA da descrição, nunca pelo código: a mesma
  -- descrição tem dois códigos no Omie ("3.1.1.11 Premiação - Sucesso" é
  -- 2.01.94 em abril e 2.03.03 depois) e o número do prefixo se repete entre
  -- coisas diferentes (3.1.1.10 é Pro Labore, Premiação-Suporte E
  -- Pessoal-Novos Canais).
  --
  -- Pro labore e diretoria caem em 'prolabore' e somam junto com o fixo na
  -- view mensal: o Miguel recebe pelas duas categorias no mesmo mês, e para
  -- quem lê a linha do tempo isso é uma remuneração só.
  case
    when b.categoria ~* 'Premia[çc][ãa]o'          then 'premiacao'
    when b.categoria ~* 'Escala'                   then 'escala'
    when b.categoria ~* 'Pro\s*Labore|Diretores'   then 'prolabore'
    else 'fixo'
  end as bloco,

  -- O apelido da Parametrização é o nome da PESSOA: o Omie entrega
  -- "DALBER NEGOCIOS" e sai "Breno D'Alberto". Por documento primeiro, que é
  -- mais confiável; por nome só quando o documento não resolve.
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
  -- Em 29/04/2026 o ERP tem 89 títulos de R$ 0,01, um por pessoa, somando R$ 1.
  -- É lançamento de teste ou ajuste que ficou lá. Nenhuma remuneração real fica
  -- abaixo de um real, então o corte é seguro e não precisa de lista de exceção.
  and b.valor >= 1;

comment on view public.vw_remuneracao_omie is
  'Movimentos do Omie nas categorias de pessoal, já com bloco, competência e nome da pessoa.';

revoke all on public.vw_remuneracao_omie from anon;

/* ------------------------------------------------------------------ */
/* A gravação                                                          */
/* ------------------------------------------------------------------ */

-- SECURITY DEFINER porque `omie_cache` tem RLS ligada e NENHUMA policy: nada
-- ali é legível por usuário autenticado, só pela service role. Uma função
-- INVOKER leria zero linhas e gravaria zero lançamentos — sem erro, sem aviso,
-- só um painel vazio que parece estar certo.
create or replace function public.remuneracao_carregar_omie()
returns table (pessoas_novas integer, lancamentos_gravados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pessoas integer := 0;
  v_lanc    integer := 0;
begin
  -- 1. Quem ainda não está no cadastro. As 118 pessoas do espelho do RH já
  --    entraram na semente com `codigo_rh`; o conflito por `chave` preserva
  --    esse vínculo e só acrescenta quem o RH não conhece — os que saíram.
  with novas as (
    insert into public.remuneracao_pessoa (nome, chave, doc)
    select distinct on (public.contraparte_chave(v.nome))
      v.nome,
      public.contraparte_chave(v.nome),
      v.doc
    from public.vw_remuneracao_omie v
    where v.nome is not null
      and length(public.contraparte_chave(v.nome)) >= 4
    order by public.contraparte_chave(v.nome), v.vencimento desc
    on conflict (chave) do nothing
    returning 1
  )
  select count(*) into v_pessoas from novas;

  -- 2. O documento de quem entrou pela semente do RH sem CNPJ preenchido.
  update public.remuneracao_pessoa p
     set doc = v.doc
    from (select distinct on (public.contraparte_chave(nome))
                 public.contraparte_chave(nome) as chave, doc
            from public.vw_remuneracao_omie
           where doc is not null
           order by public.contraparte_chave(nome), vencimento desc) v
   where p.chave = v.chave and p.doc is null;

  -- 3. Os lançamentos. `on conflict` em vez de `do nothing` porque um título
  --    pode ser corrigido no ERP depois de carregado — valor, categoria ou
  --    vencimento mudam e a carga seguinte tem de refletir isso.
  with gravados as (
    insert into public.remuneracao_lancamento
      (pessoa_id, competencia, bloco, valor, fonte, origem_ref, categoria, vencimento, pagamento)
    select p.id, v.competencia, v.bloco, v.valor, 'omie', v.cod_titulo::text,
           v.categoria, v.vencimento, v.pagamento
    from public.vw_remuneracao_omie v
      join public.remuneracao_pessoa p
        on p.chave = public.contraparte_chave(v.nome)
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

  return query select v_pessoas, v_lanc;
end $$;

comment on function public.remuneracao_carregar_omie() is
  'Carrega/atualiza a remuneração vinda do Omie. Idempotente: rodar duas vezes não duplica.';

-- A carga é ação de sistema: quem dispara é o cron ou uma Edge Function com a
-- service role, não o navegador. Sem este revoke o `authenticated` herda o
-- execute e a função — que é DEFINER — viraria um jeito de ler `omie_cache`
-- por fora da RLS.
revoke all on function public.remuneracao_carregar_omie() from anon, authenticated;
