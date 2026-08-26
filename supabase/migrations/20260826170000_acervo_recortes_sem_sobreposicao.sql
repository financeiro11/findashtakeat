-- Os recortes do acervo param de se sobrepor.
--
-- A QUEIXA, e ela estava certa: "alguns são exatamente iguais aos outros".
-- Medido em 26/08/2026, com os oito cartões na tela:
--
--   falta_no_erp   246  =  sobe_sozinha 96 + espera_gente 150, EXATO, sem sobra.
--                          Três cartões para um número só.
--   promessa_falsa  57  =  100% contido em falta_no_erp. Não é um grupo à parte:
--                          é um pedaço dele com nome próprio.
--   na_fila         96  =  o MESMO conjunto de sobe_sozinha, linha por linha.
--
-- Oito cartões, cinco populações. E pior que a redundância: `sem_alvo` contava
-- só quem tem arquivo (1.732) enquanto `ambiguas` contava todo mundo (1.686).
-- Dois números lado a lado que não se comparam, e nada na tela dizendo isso.
--
-- A DIVISÃO QUE O DADO JÁ TINHA. `conferencia` é uma partição de verdade: cinco
-- valores, mutuamente exclusivos, que somam 4.283. Cruzando com "tem arquivo",
-- sai a única leitura que fecha a conta:
--
--   dos 3.794 arquivos guardados          dos 4.283 registros
--     sem alvo        1.732                 os 489 restantes são registro
--     empate          1.614                 sem documento — e-mail que só
--     falta anexar      189                 trouxe link, sem anexo
--     diz que anexou     57
--     o ERP tem         202
--     -------------------------
--     soma            3.794  ✔
--
-- Então: o primeiro nível é ESTADO DO DOCUMENTO e fecha em 3.794. O segundo é
-- o CAMINHO ATÉ O ERP (sobe sozinha, espera você, na fila, mandadas) e é um
-- recorte de dentro das 246 que faltam — não compete com o primeiro.
--
-- O que muda aqui:
--   1. 'ambiguas' passa a exigir arquivo, como 'sem_alvo' já exigia;
--   2. entram 'falta_anexar' e 'confere', que faltavam para a partição fechar;
--   3. entra 'sem_arquivo', para os 489 deixarem de ser invisíveis;
--   4. o resumo ganha os números correspondentes, um por recorte.
--
-- Nenhum recorte antigo some: 'falta_no_erp', 'na_fila' e 'no_erp' continuam
-- valendo. Eles deixam de ser CARTÃO na tela, e viram o segundo nível.

drop function if exists public.notas_externas_acervo(text, text, text, text, integer, integer);
drop function if exists public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text);
drop function if exists public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric);

create or replace function public.notas_externas_acervo(
  p_situacao  text    default 'falta_no_erp',
  p_alvo      text    default null,
  p_fonte     text    default null,
  p_busca     text    default null,
  p_limite    integer default 60,
  p_offset    integer default 0,
  p_de        date    default null,
  p_ate       date    default null,
  p_ordem     text    default 'trabalho',
  p_valor_min numeric default null,
  p_valor_max numeric default null
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
  with pedido as (
    -- Os dígitos do que foi digitado, uma vez só: a busca por CNPJ e por chave
    -- usa os mesmos, e recalcular por linha custa caro em 4 mil linhas.
    select nullif(regexp_replace(coalesce(p_busca, ''), '\D', '', 'g'), '') as digitos,
           public.normaliza_nome(coalesce(p_busca, '')) as texto
  ),
  filtrado as (
    select n.*
      from public.notas_externas n, pedido q
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
             /* 'ambiguas' EXIGE ARQUIVO, como 'sem_alvo' sempre exigiu. Antes nao
                exigia, e por isso o cartao dizia 1.686 e o irmao dizia 1.732 sobre
                populacoes que nao se comparavam - 72 das ambiguas nao tem arquivo
                nenhum. Cartao que nao bate com a lista e cartao que ninguem
                confere duas vezes. */
             when 'ambiguas'      then n.conferencia = 'ambiguo' and n.tem_arquivo
             when 'sem_alvo'      then n.conferencia = 'sem_alvo' and n.tem_arquivo
             -- Os dois que faltavam para a particao fechar sem sobra.
             when 'falta_anexar'  then n.conferencia = 'falta_anexar' and n.tem_arquivo
             when 'confere'       then n.conferencia = 'confere' and n.tem_arquivo
             -- O registro sem documento: existe a linha, nao existe o arquivo.
             when 'sem_arquivo'   then not n.tem_arquivo
             when 'com_erro'      then n.erro_erp is not null and n.enviado_erp_em is null
             -- A consulta: o que existe, não o que falta.
             when 'biblioteca'    then n.tem_arquivo and n.parece_nota
             when 'com_arquivo'   then n.tem_arquivo
             else true
           end
       and (p_alvo is null or n.alvo_tipo = p_alvo)
       and (p_fonte is null or n.fonte = p_fonte)
       -- Período: "as notas de junho" é como o pedido chega.
       and (p_de  is null or n.enviado_em >= p_de)
       and (p_ate is null or n.enviado_em <= p_ate)
       /* Faixa de valor. Nota sem valor lido fica FORA quando se filtra por
          faixa — dizer que uma nota de valor desconhecido está entre R$ 100 e
          R$ 200 é inventar. São ~880 das 4.283 sem valor. */
       and (p_valor_min is null or n.valor >= p_valor_min)
       and (p_valor_max is null or n.valor <= p_valor_max)
       and (
         p_busca is null or btrim(p_busca) = ''
         -- texto: fornecedor, o que é, detalhe, código do título
         or public.normaliza_nome(coalesce(n.nome, '') || ' ' || coalesce(n.o_que_e, '') || ' '
              || coalesce(n.detalhe, '') || ' ' || coalesce(n.alvo_id_unico, ''))
            like '%' || q.texto || '%'
         -- identidade: CNPJ e chave de acesso, dígito contra dígito
         or (
           q.digitos is not null and length(q.digitos) >= 6
           and (coalesce(n.cnpj, '') like '%' || q.digitos || '%'
             or coalesce(n.chave_fiscal, '') like '%' || q.digitos || '%')
         )
       )
  ),
  pagina as (
    select f.*, count(*) over () as total
      from filtrado f
     order by
       /* 'trabalho' (padrão): a pior notícia primeiro, e dentro dela o maior
          valor — promessa falsa é alguém dizendo que fez e não fez, e R$ 40 mil
          não pode ficar atrás de R$ 12 só porque chegou depois.
          'recente': para consulta, quem pergunta quer o último documento. */
       case when coalesce(p_ordem, 'trabalho') = 'recente' then 0 else
         case f.conferencia when 'promessa_falsa' then 0 when 'falta_anexar' then 1 else 2 end
       end,
       case when coalesce(p_ordem, 'trabalho') = 'recente' then 0 else
         case f.confianca when 'exata' then 0 when 'alta' then 1 when 'media' then 2 else 3 end
       end,
       case when coalesce(p_ordem, 'trabalho') = 'recente' then f.enviado_em end desc nulls last,
       case when coalesce(p_ordem, 'trabalho') = 'recente' then null else coalesce(f.valor, 0) end desc,
       f.id desc
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
   order by
     case when coalesce(p_ordem, 'trabalho') = 'recente' then 0 else
       case f.conferencia when 'promessa_falsa' then 0 when 'falta_anexar' then 1 else 2 end
     end,
     case when coalesce(p_ordem, 'trabalho') = 'recente' then 0 else
       case f.confianca when 'exata' then 0 when 'alta' then 1 when 'media' then 2 else 3 end
     end,
     case when coalesce(p_ordem, 'trabalho') = 'recente' then f.enviado_em end desc nulls last,
     case when coalesce(p_ordem, 'trabalho') = 'recente' then null else coalesce(f.valor, 0) end desc,
     f.id desc;
$$;

revoke all on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric) from public;
revoke all on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric) from anon;
grant execute on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric) to authenticated, service_role;

comment on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric) is
  'A lista do acervo. p_situacao aceita os recortes de trabalho (falta_no_erp, sobe_sozinha, espera_gente, promessa_falsa, na_fila, no_erp, ambiguas, sem_alvo, com_erro) e os de consulta (biblioteca = nota fiscal com arquivo; com_arquivo = tudo que abre). p_busca varre texto E, com 6+ dígitos, CNPJ e chave fiscal. p_ordem: trabalho (urgência) ou recente (data).';

/* ---------------------------------------------------------------------------
 *  O resumo ganha o número da biblioteca
 * ------------------------------------------------------------------------ */
-- `arquivos` e `notas` já existiam e são exatamente os dois recortes de consulta
-- ('com_arquivo' e 'biblioteca'). Falta só o universo, para a tela poder dizer
-- quantas linhas existem ao todo — inclusive as 489 que são só link de e-mail,
-- sem arquivo, que não aparecem em nenhum dos outros números.

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
    'tudo',          (select count(*) from base),
    'arquivos',      (select count(*) from base where tem_arquivo),
    'notas',         (select count(*) from base where tem_arquivo and parece_nota),
    'sem_arquivo',   (select count(*) from base where not tem_arquivo),
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
    'promessa_falsa',(select count(*) from base where conferencia = 'promessa_falsa'),
    'ambiguas',      (select count(*) from base where conferencia = 'ambiguo' and tem_arquivo),
    'sem_alvo',      (select count(*) from base where conferencia = 'sem_alvo' and tem_arquivo),
    'falta_anexar',  (select count(*) from base where conferencia = 'falta_anexar' and tem_arquivo),
    'confere',       (select count(*) from base where conferencia = 'confere' and tem_arquivo),
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
