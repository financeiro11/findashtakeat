-- O ACERVO SÓ SABIA FILTRAR PELO QUE ELE É — nunca por que parou.
--
-- Os recortes da aba respondiam "onde está o arquivo" (sem alvo, empate, falta
-- anexar, o ERP tem) e "quem decide" (sobe sozinha, espera você). Nenhum
-- respondia a pergunta que faz alguém trabalhar a fila: *por que este documento
-- não chegou ao ERP?* — e sem ela "Sem alvo" era um monte de 2.750 linhas com
-- uma ajuda que dizia, literalmente, que não havia o que fazer.
--
-- `notas_externas_parada` (migração `20260827480000`) passou a classificar isso.
-- Esta migração leva a classificação para dentro da lista: filtrar por motivo,
-- ver o que foi arquivado e por qual faxina, e cortar por mês pela data que
-- importa.
--
-- ---------------------------------------------------------------------------
-- TRÊS CONSERTOS JUNTOS, porque os três são a mesma consulta
--
-- 1. `p_motivo` — o corte novo, que casa com os cartões de "por que parou".
--
-- 2. O ARQUIVADO PASSA A SER VISÍVEL. A RPC começava com `ignorado_em is null`
--    fixo: o que a faxina arquiva SUMIA da tela, sem recorte que o trouxesse de
--    volta. Arquivar sem poder olhar o que foi arquivado é apagar com outro
--    nome — e a faxina de hoje tirou 1.275 documentos. Agora
--    `p_situacao = 'arquivado'` mostra os arquivados (com o motivo escrito, e
--    o botão de desarquivar do lado); todos os outros recortes continuam
--    escondendo-os, como antes.
--
-- 3. O PERÍODO PASSA A USAR O VENCIMENTO. O filtro cortava por `enviado_em`, que
--    é quando o formulário foi preenchido ou o e-mail chegou — não quando a
--    despesa é. Uma nota que vence em 20/07 e foi enviada em 02/08 não aparecia
--    em "julho", e o casador usa a data certa (`coalesce(vencimento,
--    enviado_em)`) desde `20260827100000`. Filtro e casador olhavam para datas
--    diferentes do mesmo documento.
--
-- `drop` antes do `create`: o retorno ganha quatro colunas, e `create or replace`
-- não muda assinatura de saída.

drop function if exists public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric);

create or replace function public.notas_externas_acervo(
  p_situacao text default 'falta_no_erp',
  p_alvo text default null,
  p_fonte text default null,
  p_busca text default null,
  p_limite integer default 60,
  p_offset integer default 0,
  p_de date default null,
  p_ate date default null,
  p_ordem text default 'trabalho',
  p_valor_min numeric default null,
  p_valor_max numeric default null,
  p_motivo text default null
)
 returns table(
   id bigint, fonte text, linha integer, nome text, o_que_e text, detalhe text,
   valor numeric, enviado_em date, vencimento date, competencia text, link text,
   tem_arquivo boolean, parece_nota boolean, tipo_documento text, cnpj text,
   chave_fiscal text, diz_anexado boolean, status_planilha text,
   alvo_tipo text, alvo_id_unico text, alvo_manual boolean, casamento text,
   confianca text, conferencia text, candidatos jsonb, fila_erp boolean,
   enviado_erp_em timestamptz, erro_erp text,
   alvo_nome text, alvo_valor numeric, alvo_data date, alvo_categoria text,
   alvo_situacao text, alvo_cod_titulo text, arquivo_bucket text,
   motivo text, ignorado_em timestamptz, ignorado_motivo text,
   total bigint
 )
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with pedido as (
    -- Os dígitos do que foi digitado, uma vez só: a busca por CNPJ e por chave
    -- usa os mesmos, e recalcular por linha custa caro em 4 mil linhas.
    select nullif(regexp_replace(coalesce(p_busca, ''), '\D', '', 'g'), '') as digitos,
           public.normaliza_nome(coalesce(p_busca, '')) as texto
  ),
  filtrado as (
    select n.*, pa.motivo as p_motivo_calc
      from public.notas_externas n
      join public.notas_externas_parada pa on pa.id = n.id,
           pedido q
     /* O arquivado só aparece no recorte que existe para ele. Em todos os
        outros ele continua invisível — arquivar é tirar da fila. */
     where (case when coalesce(p_situacao, 'falta_no_erp') = 'arquivado'
                 then n.ignorado_em is not null
                 else n.ignorado_em is null end)
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
             /* O QUE SÓ EXISTE NO DRIVE DE OUTRA PESSOA. Não é curiosidade: o
                arquivo é de quem preencheu o formulário (um caso real da fila
                tem `owner` num Gmail pessoal), e some junto com a conta dela.
                Este recorte é a lista do que ainda não tem cópia da empresa. */
             when 'so_no_drive'   then n.tem_arquivo and n.arquivo_bucket is null
                                       and n.link ~* 'drive\.google\.com|googleapis\.com'
             when 'com_erro'      then n.erro_erp is not null and n.enviado_erp_em is null
             -- A consulta: o que existe, não o que falta.
             when 'biblioteca'    then n.tem_arquivo and n.parece_nota
             when 'com_arquivo'   then n.tem_arquivo
             -- O que a faxina tirou da fila. Com o motivo do lado.
             when 'arquivado'     then true
             /* O QUE AINDA ESTÁ PARADO: os três motivos que pedem gente, num
                recorte só. É o cartão-guarda-chuva de "por que parou". */
             when 'parado'        then n.tem_arquivo and n.copia_de is null
                                       and pa.motivo in ('sem_candidato', 'varios_alvos', 'disputado')
             else true
           end
       -- O corte por motivo de parada, que é a pergunta desta aba desde hoje.
       and (p_motivo is null or pa.motivo = p_motivo)
       and (p_alvo is null or n.alvo_tipo = p_alvo)
       and (p_fonte is null or n.fonte = p_fonte)
       /* Período: "as notas de junho" é como o pedido chega — e junho é o mês do
          VENCIMENTO quando ele é declarado, não o do carimbo do formulário. */
       and (p_de  is null or coalesce(n.vencimento, n.enviado_em) >= p_de)
       and (p_ate is null or coalesce(n.vencimento, n.enviado_em) <= p_ate)
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
       case when coalesce(p_ordem, 'trabalho') = 'recente' then coalesce(f.vencimento, f.enviado_em) end desc nulls last,
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
         f.vencimento, f.competencia, f.link, f.tem_arquivo, f.parece_nota,
         f.tipo_documento, f.cnpj, f.chave_fiscal, f.diz_anexado, f.status_planilha,
         f.alvo_tipo, f.alvo_id_unico, f.alvo_manual, f.casamento, f.confianca,
         f.conferencia, f.candidatos, f.fila_erp, f.enviado_erp_em, f.erro_erp,
         f.l_nome, f.l_valor, f.l_data, f.l_categoria, f.l_situacao, f.l_cod_titulo,
         f.arquivo_bucket,
         f.p_motivo_calc, f.ignorado_em, f.ignorado_motivo,
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
     case when coalesce(p_ordem, 'trabalho') = 'recente' then coalesce(f.vencimento, f.enviado_em) end desc nulls last,
     case when coalesce(p_ordem, 'trabalho') = 'recente' then null else coalesce(f.valor, 0) end desc,
     f.id desc;
$function$;

/* ---------------------------------------------------------------------------
 * AS OPÇÕES DE CADA FILTRO, do acervo inteiro
 *
 * Mesma lição da aba "Títulos": as opções não podem sair do resultado corrente,
 * senão marcar "e-mail" apaga as outras fontes da lista e não há como trocar de
 * ideia sem limpar o filtro — um filtro que se fecha sozinho. Elas saem do
 * acervo todo, com a contagem de cada uma ao lado.
 * ------------------------------------------------------------------------- */
create or replace function public.notas_externas_facetas()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select n.fonte, n.tipo_documento, n.parece_nota, n.valor,
           coalesce(n.vencimento, n.enviado_em) as data,
           pa.motivo
      from public.notas_externas n
      join public.notas_externas_parada pa on pa.id = n.id
     where n.tem_arquivo and n.copia_de is null
  )
  select jsonb_build_object(
    'fontes', (select coalesce(jsonb_agg(jsonb_build_object('valor', fonte, 'quantos', n) order by n desc), '[]'::jsonb)
                 from (select fonte, count(*) n from base group by fonte) t),
    'tipos',  (select coalesce(jsonb_agg(jsonb_build_object('valor', tipo, 'quantos', n) order by n desc), '[]'::jsonb)
                 from (select coalesce(tipo_documento, case when parece_nota then 'nota' else 'nao lido' end) as tipo,
                              count(*) n from base group by 1) t),
    'meses',  (select coalesce(jsonb_agg(jsonb_build_object('valor', mes, 'quantos', n) order by mes desc), '[]'::jsonb)
                 from (select to_char(date_trunc('month', data), 'YYYY-MM') as mes, count(*) n
                         from base where data is not null group by 1) t),
    'valor',  (select jsonb_build_object('min', min(valor), 'max', max(valor)) from base where valor is not null)
  );
$function$;

revoke all on function public.notas_externas_facetas() from anon;
