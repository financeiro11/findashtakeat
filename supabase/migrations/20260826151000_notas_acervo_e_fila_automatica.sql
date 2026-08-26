-- O acervo ganha tela própria, e a nota de identidade sobe sozinha.
--
-- DUAS COISAS QUE FALTAVAM, e as duas pelo mesmo motivo: o acervo era medição,
-- não ação.
--
-- 1. NINGUÉM ESTAVA NA FILA. Em 26/08/2026 havia 4.183 linhas em
--    `notas_externas`, 3.694 com arquivo — e `fila_erp` estava em `false` nas
--    4.183. A fila só liga por `notas_externas_enfileirar(ids)`, que é um botão
--    na aba PIX da Auditoria, mês a mês. O lado do cartão não tinha tela
--    nenhuma: 55 notas com arquivo, alvo casado e título no Omie, invisíveis.
--    O encanamento inteiro existia e estava vazio.
--
-- 2. A DECISÃO ERA A MESMA PARA TODO MUNDO. Casar por CNPJ+valor é identidade:
--    o documento diz de quem é a nota e o valor bate ao centavo. Casar por
--    valor+data numa fatura de 3.768 linhas é coincidência rotineira. Tratar os
--    dois com o mesmo clique gasta a atenção de gente no que não precisa dela e
--    deixa passar o que precisa.
--
--    Então a régua é a CONFIANÇA: `exata` e `alta` sobem no cron que já existe;
--    `media` espera alguém dizer que sim. Anexo no ERP é difícil de desfazer, e
--    nota errada dentro de um título é coisa que o contador vê.
--
-- Medido no dado real depois de ligar o alvo 'erp': 120 notas exata/alta prontas
-- para subir sozinhas (79 no ERP, 41 no PIX) e 150 de confiança média esperando
-- confirmação.

/* ============================================================================
 *  1. A fila automática
 * ========================================================================== */

create or replace function public.notas_externas_enfileirar_automatico(
  p_limite integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
  v_n   integer;
begin
  /* A régua da autonomia, num lugar só.

     `exata`  = CNPJ do documento + valor ao centavo. É identidade.
     `alta`   = mesmo CNPJ dentro da janela de datas. O valor não bate (nota
                cheia × parcela, retenção, desconto), mas quem recebeu é o mesmo.
     `media`  = valor+data ou nome parecido. NÃO entra aqui de propósito.

     `alvo_manual` entra mesmo sem confiança: se alguém escolheu o alvo à mão,
     a decisão já foi tomada por gente — é mais forte que qualquer heurística. */
  select array_agg(id order by id)
    into v_ids
    from (
      select id
        from public.notas_externas
       where enviado_erp_em is null
         and ignorado_em is null
         and alvo_tipo is not null
         and tem_arquivo
         and conferencia in ('falta_anexar', 'promessa_falsa')
         and (confianca in ('exata', 'alta') or alvo_manual)
         and not fila_erp
       order by id
       limit p_limite
    ) t;

  if v_ids is null then
    return jsonb_build_object('enfileiradas', 0, 'ja_na_fila',
      (select count(*) from public.notas_externas where fila_erp and enviado_erp_em is null));
  end if;

  -- Reaproveita a porta que já existe: ela é que sabe as travas (arquivo,
  -- conferência, alvo) e é ela que escreve o link no lado do cartão. Duas
  -- portas para a mesma fila é como não ter trava nenhuma.
  v_n := public.notas_externas_enfileirar(v_ids);

  return jsonb_build_object(
    'enfileiradas', v_n,
    'ja_na_fila', (select count(*) from public.notas_externas
                    where fila_erp and enviado_erp_em is null),
    'esperando_gente', (select count(*) from public.notas_externas
                         where enviado_erp_em is null and ignorado_em is null
                           and alvo_tipo is not null and tem_arquivo
                           and conferencia in ('falta_anexar', 'promessa_falsa')
                           and confianca = 'media' and not alvo_manual and not fila_erp)
  );
end;
$$;

comment on function public.notas_externas_enfileirar_automatico(integer) is
  'Põe na fila do ERP o que casou por IDENTIDADE (exata/alta) ou foi decidido à mão. Confiança média fica de fora — essa espera alguém confirmar na aba Acervo.';

revoke all on function public.notas_externas_enfileirar_automatico(integer) from public;
revoke all on function public.notas_externas_enfileirar_automatico(integer) from anon;
grant execute on function public.notas_externas_enfileirar_automatico(integer) to authenticated, service_role;

/* ============================================================================
 *  2. O resumo do acervo — o cabeçalho da aba
 * ========================================================================== */

create or replace function public.notas_externas_acervo_resumo()
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with base as (
    select * from public.notas_externas where ignorado_em is null
  )
  select jsonb_build_object(
    'arquivos',      (select count(*) from base where tem_arquivo),
    'notas',         (select count(*) from base where tem_arquivo and parece_nota),
    -- O que o Hub tem e o ERP não: é ESTE o número que a aba existe para zerar.
    'falta_no_erp',  (select count(*) from base
                       where tem_arquivo and enviado_erp_em is null
                         and conferencia in ('falta_anexar', 'promessa_falsa')),
    'sobe_sozinha',  (select count(*) from base
                       where tem_arquivo and enviado_erp_em is null
                         and conferencia in ('falta_anexar', 'promessa_falsa')
                         and (confianca in ('exata', 'alta') or alvo_manual)),
    'espera_gente',  (select count(*) from base
                       where tem_arquivo and enviado_erp_em is null
                         and conferencia in ('falta_anexar', 'promessa_falsa')
                         and confianca = 'media' and not alvo_manual),
    'na_fila',       (select count(*) from base where fila_erp and enviado_erp_em is null),
    'no_erp',        (select count(*) from base where enviado_erp_em is not null),
    -- A planilha jurou que anexou e o título está vazio. Não é fila: é achado.
    'promessa_falsa',(select count(*) from base where conferencia = 'promessa_falsa'),
    'ambiguas',      (select count(*) from base where conferencia = 'ambiguo'),
    'sem_alvo',      (select count(*) from base where conferencia = 'sem_alvo' and tem_arquivo),
    'com_erro',      (select count(*) from base where erro_erp is not null and enviado_erp_em is null),
    'por_alvo',      (select coalesce(jsonb_object_agg(coalesce(alvo_tipo, 'sem_alvo'), n), '{}'::jsonb)
                        from (select alvo_tipo, count(*) n from base group by alvo_tipo) t),
    'por_fonte',     (select coalesce(jsonb_object_agg(fonte, n), '{}'::jsonb)
                        from (select fonte, count(*) n from base where tem_arquivo group by fonte) t)
  );
$$;

revoke all on function public.notas_externas_acervo_resumo() from public;
revoke all on function public.notas_externas_acervo_resumo() from anon;
grant execute on function public.notas_externas_acervo_resumo() to authenticated, service_role;

/* ============================================================================
 *  3. A lista — com o LADO DE LÁ junto
 * ========================================================================== */
-- O que torna a aba útil não é a nota: é a nota AO LADO do lançamento que ela
-- explica. Sem o favorecido, o valor e a data do alvo, "casamento por valor+data
-- com confiança média" é uma frase; com eles, alguém decide em dois segundos.
--
-- `cap_titulos` entra em CTE de referência única e MATERIALIZADA. Ela abre o
-- `omie_cache` inteiro (~880 ms medidos) e, sem o `materialized`, o planejador a
-- inlinaria em cada um dos ramos do alvo — três varreduras onde bastava uma.
--
-- E A PÁGINA VEM ANTES DO ENRIQUECIMENTO. Medido: filtrar já com os três joins
-- custava 1.836 ms, porque a view era aberta para as 4.277 notas e não para as
-- 60 que vão à tela. Recortando primeiro e casando o lado de lá depois, a conta
-- cai à metade — o piso é a própria view, que a aba Títulos já paga.
--
-- O preço: a BUSCA varre o que está na nota (nome, o que é, detalhe) e o código
-- do título, não o favorecido do lançamento. Procurar pelo nome do fornecedor
-- exigiria a view ANTES do recorte, que é justamente o que custava o dobro — e
-- em nota de fornecedor os dois nomes são o mesmo texto quase sempre, porque foi
-- por ele que o casamento aconteceu.

create or replace function public.notas_externas_acervo(
  p_situacao  text    default 'falta_no_erp',
  p_alvo      text    default null,
  p_fonte     text    default null,
  p_busca     text    default null,
  p_limite    integer default 60,
  p_offset    integer default 0
)
returns table (
  id             bigint,
  fonte          text,
  linha          integer,
  nome           text,
  o_que_e        text,
  detalhe        text,
  valor          numeric,
  enviado_em     date,
  competencia    text,
  link           text,
  tem_arquivo    boolean,
  parece_nota    boolean,
  tipo_documento text,
  cnpj           text,
  chave_fiscal   text,
  diz_anexado    boolean,
  status_planilha text,
  alvo_tipo      text,
  alvo_id_unico  text,
  alvo_manual    boolean,
  casamento      text,
  confianca      text,
  conferencia    text,
  candidatos     jsonb,
  fila_erp       boolean,
  enviado_erp_em timestamptz,
  erro_erp       text,
  -- o lado de lá
  alvo_nome      text,
  alvo_valor     numeric,
  alvo_data      date,
  alvo_categoria text,
  alvo_situacao  text,
  alvo_cod_titulo text,
  total          bigint
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with filtrado as (
    select n.*
      from public.notas_externas n
     where n.ignorado_em is null
       and case coalesce(p_situacao, 'falta_no_erp')
             -- O trabalho: Hub tem, ERP não.
             when 'falta_no_erp'  then n.tem_arquivo and n.enviado_erp_em is null
                                       and n.conferencia in ('falta_anexar', 'promessa_falsa')
             when 'sobe_sozinha'  then n.tem_arquivo and n.enviado_erp_em is null
                                       and n.conferencia in ('falta_anexar', 'promessa_falsa')
                                       and (n.confianca in ('exata','alta') or n.alvo_manual)
             when 'espera_gente'  then n.tem_arquivo and n.enviado_erp_em is null
                                       and n.conferencia in ('falta_anexar', 'promessa_falsa')
                                       and n.confianca = 'media' and not n.alvo_manual
             when 'promessa_falsa' then n.conferencia = 'promessa_falsa'
             when 'na_fila'       then n.fila_erp and n.enviado_erp_em is null
             when 'no_erp'        then n.enviado_erp_em is not null
             when 'ambiguas'      then n.conferencia = 'ambiguo'
             when 'sem_alvo'      then n.conferencia = 'sem_alvo' and n.tem_arquivo
             when 'com_erro'      then n.erro_erp is not null and n.enviado_erp_em is null
             else true
           end
       and (p_alvo is null or n.alvo_tipo = p_alvo)
       and (p_fonte is null or n.fonte = p_fonte)
       and (
         p_busca is null or btrim(p_busca) = '' or
         public.normaliza_nome(coalesce(n.nome, '') || ' ' || coalesce(n.o_que_e, '') || ' '
           || coalesce(n.detalhe, '') || ' ' || coalesce(n.alvo_id_unico, ''))
           like '%' || public.normaliza_nome(p_busca) || '%'
       )
  ),
  pagina as (
    select f.*, count(*) over () as total
      from filtrado f
     /* A pior notícia primeiro, e dentro dela o maior valor: promessa falsa é
        alguém dizendo que fez e não fez, e R$ 40 mil não pode ficar atrás de
        R$ 12 só porque chegou depois. */
     order by case f.conferencia when 'promessa_falsa' then 0 when 'falta_anexar' then 1 else 2 end,
              case f.confianca when 'exata' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
              coalesce(f.valor, 0) desc, f.id
     limit greatest(1, least(coalesce(p_limite, 60), 300))
    offset greatest(0, coalesce(p_offset, 0))
  ),
  cap as materialized (
    select cod_titulo, valor, coalesce(pagamento, vencimento, emissao) as data,
           coalesce(favorecido, favorecido_cru, '') as nome, categoria, situacao
      from public.cap_titulos
     where exists (select 1 from pagina g
                    where g.alvo_tipo = 'erp'
                      and g.alvo_id_unico = cap_titulos.cod_titulo::text)
  ),
  enriquecido as (
    select n.*,
           case n.alvo_tipo
             when 'erp'    then c.nome
             when 'pix'    then coalesce(p.favorecido, p.descricao)
             when 'cartao' then coalesce(a.estabelecimento, a.descricao_original)
           end as l_nome,
           case n.alvo_tipo
             when 'erp' then c.valor when 'pix' then p.valor when 'cartao' then a.valor
           end as l_valor,
           case n.alvo_tipo
             when 'erp' then c.data when 'pix' then p.data when 'cartao' then a.data
           end as l_data,
           case n.alvo_tipo
             when 'erp' then c.categoria when 'pix' then p.categoria when 'cartao' then a.categoria
           end as l_categoria,
           case n.alvo_tipo
             when 'erp' then c.situacao
             when 'pix' then case when p.tem_comprovante then 'com_nota' else 'sem_nota' end
             when 'cartao' then case when coalesce(a.status_nf,'') = 'OK' then 'com_nota' else 'sem_nota' end
           end as l_situacao,
           /* O código do título, que é o que se procura no Omie. No PIX e no
              'erp' o próprio id já é ele; no cartão mora numa coluna à parte e
              só existe depois que o "Cruzar com Omie" passou. */
           case n.alvo_tipo
             when 'cartao' then a.omie_cod_titulo
             when 'erp'    then n.alvo_id_unico
             when 'pix'    then n.alvo_id_unico
           end as l_cod_titulo
      from pagina n
      left join cap c on n.alvo_tipo = 'erp'
                     and c.cod_titulo = nullif(regexp_replace(n.alvo_id_unico, '\D', '', 'g'), '')::bigint
      left join public.auditoria_pix_lancamentos p
             on n.alvo_tipo = 'pix' and p.id_unico = n.alvo_id_unico
      left join public.auditoria_cartao_lancamentos a
             on n.alvo_tipo = 'cartao' and a.id_unico = n.alvo_id_unico
  )
  select f.id, f.fonte, f.linha, f.nome, f.o_que_e, f.detalhe, f.valor, f.enviado_em,
         f.competencia, f.link, f.tem_arquivo, f.parece_nota, f.tipo_documento, f.cnpj,
         f.chave_fiscal, f.diz_anexado, f.status_planilha,
         f.alvo_tipo, f.alvo_id_unico, f.alvo_manual, f.casamento, f.confianca,
         f.conferencia, f.candidatos, f.fila_erp, f.enviado_erp_em, f.erro_erp,
         f.l_nome, f.l_valor, f.l_data, f.l_categoria, f.l_situacao, f.l_cod_titulo,
         f.total
    from enriquecido f
   -- A mesma ordem do recorte, repetida porque o join a desfaz.
   order by case f.conferencia when 'promessa_falsa' then 0 when 'falta_anexar' then 1 else 2 end,
            case f.confianca when 'exata' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
            coalesce(f.valor, 0) desc, f.id;
$$;

revoke all on function public.notas_externas_acervo(text, text, text, text, integer, integer) from public;
revoke all on function public.notas_externas_acervo(text, text, text, text, integer, integer) from anon;
grant execute on function public.notas_externas_acervo(text, text, text, text, integer, integer) to authenticated, service_role;
