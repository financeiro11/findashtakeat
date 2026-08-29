-- A cópia sai de todos os números, e ganha uma aba onde se possa conferi-la.
--
-- Depois de `20260828050000` o Hub sabe dizer que duas linhas são o mesmo papel
-- (`copia_de`), mas a tela continuava contando as duas. Medido em 28/08/2026:
--
--   • "Todo arquivo guardado" dizia 2.765 quando os documentos são 2.367;
--   • "Notas fiscais" dizia 2.341 quando são 2.018;
--   • e "Sem alvo" listava 458 linhas que ninguém consegue resolver, porque não
--     há o que resolver: elas estão sem alvo POR SEREM CÓPIA, e o alvo mora no
--     portador. Alguém tentando casar aquilo à mão trabalharia à toa.
--
-- A regra passa a ser inteira: cópia não aparece em recorte nenhum, e existe um
-- recorte só dela. Sem exceção, porque exceção aqui é o que faz dois números da
-- mesma tela não fecharem — e foi assim que a aba chegou a ter "Sem alvo"
-- contando só quem tem arquivo ao lado de "Empate" contando todo mundo.
--
-- O recorte próprio não é enfeite: é como se AUDITA o agrupamento. O casamento
-- por nome de arquivo é novo, e a única forma de alguém desconfiar dele é ver o
-- par lado a lado — por isso a linha da cópia carrega de quem ela é cópia.
--
-- ---------------------------------------------------------------------------
-- E DOIS CARTÕES DA PARTIÇÃO MOSTRAVAM ZERO
--
-- Achado ao ler a função para mexer nela: `notas_externas_acervo_resumo`
-- devolvia 16 chaves e a tela pede 22. Faltavam `falta_anexar`, `confere`,
-- `tudo`, `sem_arquivo`, `so_no_drive` e `com_copia` — e a tela lê
-- `resumo?.[chave] ?? 0`, então o que falta vira ZERO em silêncio.
--
-- O efeito: dos cinco cartões de "Onde está cada arquivo", "Falta anexar" e "O
-- ERP tem" exibiam 0, embaixo de uma frase que promete "os cinco somam 2.765".
-- Somavam 0 + 0 + 649 + 0 + 401.
--
-- `ambiguas` também mentia, de outro jeito: contava `candidatos->>'motivo' =
-- 'alvo_disputado'` (272) enquanto a LISTA da aba e a ajuda do cartão falam dos
-- dois motivos de empate — `conferencia = 'ambiguo'` (401). Cartão e lista sobre
-- populações diferentes. Volta a ser a `conferencia`, que é o que fecha a
-- partição: 649 + 401 + 23 + 0 + 1.294 = 2.367, ao documento.
--
-- `varios_alvos` e `lancamentos_em_disputa` ficam onde estão: são recortes de
-- DENTRO do empate, não competem com ele.

/* ============================================================================
 *  1. O resumo — com as chaves que a tela pede, e sem contar o mesmo papel duas vezes
 * ========================================================================== */

create or replace function public.notas_externas_acervo_resumo()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  /* A CÓPIA SAI AQUI, DE UMA VEZ, e não chave a chave. Filtrar em cada `select`
     é como o `arquivos` e o `notas` ficaram contando papel repetido enquanto o
     `falta_no_erp` ao lado já não contava: quem acrescenta a chave seguinte
     esquece o filtro, e ninguém percebe porque o número continua plausível. */
  with base as (
    select * from public.notas_externas
     where ignorado_em is null and copia_de is null
  )
  select jsonb_build_object(
    'tudo',          (select count(*) from base),
    'arquivos',      (select count(*) from base where tem_arquivo),
    'notas',         (select count(*) from base where tem_arquivo and parece_nota),
    'sem_arquivo',   (select count(*) from base where not tem_arquivo),
    /* A PARTIÇÃO — os cinco somam `arquivos`, e é isso que a frase embaixo do
       título promete. `conferencia` tem um valor só por linha, então eles não se
       sobrepõem por construção. */
    'sem_alvo',      (select count(*) from base where conferencia = 'sem_alvo' and tem_arquivo),
    'ambiguas',      (select count(*) from base where conferencia = 'ambiguo' and tem_arquivo),
    'falta_anexar',  (select count(*) from base where conferencia = 'falta_anexar' and tem_arquivo),
    'promessa_falsa',(select count(*) from base where conferencia = 'promessa_falsa' and tem_arquivo),
    'confere',       (select count(*) from base where conferencia = 'confere' and tem_arquivo),
    -- Recortes de DENTRO do empate: qual dos dois motivos, e quantos
    -- lançamentos estão sendo disputados.
    'lancamentos_em_disputa',
                     (select count(distinct candidatos->'alvos'->0->>'id_unico') from base
                       where candidatos->>'motivo' = 'alvo_disputado'),
    'varios_alvos',  (select count(*) from base where candidatos->>'motivo' = 'varios_alvos'),
    -- O caminho até o ERP.
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
    'com_erro',      (select count(*) from base where erro_erp is not null and enviado_erp_em is null),
    -- Proteção do arquivo: de quem é a conta onde ele mora.
    'so_no_drive',   (select count(*) from base where tem_arquivo and arquivo_bucket is null
                       and link ~* 'drive\.google\.com|googleapis\.com'),
    'com_copia',     (select count(*) from base where arquivo_bucket is not null),
    /* O ÚNICO NÚMERO QUE CONTA CÓPIA — e por isso ele sai de `notas_externas`
       direto, e não de `base`, que acabou de tirá-las. */
    'copias',        (select count(*) from public.notas_externas
                       where ignorado_em is null and copia_de is not null),
    'por_alvo',      (select coalesce(jsonb_object_agg(coalesce(alvo_tipo, 'sem_alvo'), n), '{}'::jsonb)
                        from (select alvo_tipo, count(*) n from base group by alvo_tipo) t),
    'por_fonte',     (select coalesce(jsonb_object_agg(fonte, n), '{}'::jsonb)
                        from (select fonte, count(*) n from base where tem_arquivo group by fonte) t)
  );
$function$;

comment on function public.notas_externas_acervo_resumo() is
  'Os números do acervo, todos sobre DOCUMENTO e não sobre linha: a cópia sai de base e só aparece na chave `copias`. Os cinco da partição (sem_alvo, ambiguas, falta_anexar, promessa_falsa, confere) somam `arquivos` ao documento.';

/* ============================================================================
 *  2. A lista — a cópia só na aba dela, e dizendo de quem é cópia
 * ========================================================================== */

-- Mudaram as colunas de saída (entram `copia_de`, `copia_de_fonte` e
-- `copia_de_rotulo`), e o Postgres exige DROP antes de um `create or replace`
-- que mexe nelas.
drop function if exists public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric, text);

create function public.notas_externas_acervo(
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
  p_valor_max numeric default null,
  p_motivo    text    default null
)
returns table(
  id bigint, fonte text, linha integer, nome text, o_que_e text, detalhe text,
  valor numeric, enviado_em date, vencimento date, competencia text, link text,
  tem_arquivo boolean, parece_nota boolean, tipo_documento text, cnpj text,
  chave_fiscal text, diz_anexado boolean, status_planilha text,
  alvo_tipo text, alvo_id_unico text, alvo_manual boolean, casamento text,
  confianca text, conferencia text, candidatos jsonb, fila_erp boolean,
  enviado_erp_em timestamp with time zone, erro_erp text,
  alvo_nome text, alvo_valor numeric, alvo_data date, alvo_categoria text,
  alvo_situacao text, alvo_cod_titulo text, arquivo_bucket text, motivo text,
  ignorado_em timestamp with time zone, ignorado_motivo text,
  copia_de bigint, copia_de_fonte text, copia_de_rotulo text,
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
       /* A CÓPIA SÓ APARECE NA ABA DELA — e a regra é total de propósito.
          Deixar a cópia visível "só num recorte ou outro" foi o que fez dois
          números da mesma tela deixarem de fechar. `arquivado` fica de fora da
          regra porque ali a pergunta é outra: o que a faxina tirou da fila,
          seja o papel repetido ou não. */
       and (case coalesce(p_situacao, 'falta_no_erp')
              when 'copias'    then n.copia_de is not null
              when 'arquivado' then true
              else n.copia_de is null
            end)
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
             /* O PAPEL REPETIDO. A guarda de cima já garante que só cópia chega
                aqui; esta linha existe para o recorte ser explícito, e não um
                efeito colateral do `else true`. */
             when 'copias'        then true
             /* O QUE AINDA ESTÁ PARADO: os três motivos que pedem gente, num
                recorte só. É o cartão-guarda-chuva de "por que parou". */
             when 'parado'        then n.tem_arquivo
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
           end as l_cod_titulo,
           /* DE QUEM ESTA LINHA É CÓPIA. Sem isto a aba nova seria uma lista de
              documentos rotulados "repetido" sem meio de conferir se o
              agrupamento acertou — e o casamento por nome de arquivo é novo o
              bastante para merecer ser conferido no olho. O join é só sobre a
              página (no máximo 300 linhas), não sobre o acervo. */
           port.fonte as l_copia_fonte,
           coalesce(port.nome, port.o_que_e, port.detalhe) as l_copia_rotulo
      from pagina n
      left join cap c on n.alvo_tipo = 'erp'
                     and c.cod_titulo = nullif(regexp_replace(n.alvo_id_unico, '\D', '', 'g'), '')::bigint
      left join public.auditoria_pix_lancamentos p
             on n.alvo_tipo = 'pix' and p.id_unico = n.alvo_id_unico
      left join public.auditoria_cartao_lancamentos a
             on n.alvo_tipo = 'cartao' and a.id_unico = n.alvo_id_unico
      left join public.notas_externas port on port.id = n.copia_de
  )
  select f.id, f.fonte, f.linha, f.nome, f.o_que_e, f.detalhe, f.valor, f.enviado_em,
         f.vencimento, f.competencia, f.link, f.tem_arquivo, f.parece_nota,
         f.tipo_documento, f.cnpj, f.chave_fiscal, f.diz_anexado, f.status_planilha,
         f.alvo_tipo, f.alvo_id_unico, f.alvo_manual, f.casamento, f.confianca,
         f.conferencia, f.candidatos, f.fila_erp, f.enviado_erp_em, f.erro_erp,
         f.l_nome, f.l_valor, f.l_data, f.l_categoria, f.l_situacao, f.l_cod_titulo,
         f.arquivo_bucket,
         f.p_motivo_calc, f.ignorado_em, f.ignorado_motivo,
         f.copia_de, f.l_copia_fonte, f.l_copia_rotulo,
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

comment on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric, text) is
  'A lista do acervo. A CÓPIA só aparece no recorte `copias` — em todos os outros o papel repetido é invisível, para os números falarem de documento. p_situacao aceita os recortes de trabalho (falta_no_erp, sobe_sozinha, espera_gente, promessa_falsa, na_fila, no_erp, ambiguas, sem_alvo, falta_anexar, confere, com_erro, parado), os de consulta (biblioteca, com_arquivo, sem_arquivo, tudo, so_no_drive), `copias` e `arquivado`.';

/* ============================================================================
 *  3. Permissões — o DROP as levou junto
 * ========================================================================== */

revoke all on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric, text) from public;
revoke all on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric, text) from anon;
grant execute on function public.notas_externas_acervo(text, text, text, text, integer, integer, date, date, text, numeric, numeric, text) to authenticated, service_role;

revoke all on function public.notas_externas_acervo_resumo() from public;
revoke all on function public.notas_externas_acervo_resumo() from anon;
grant execute on function public.notas_externas_acervo_resumo() to authenticated, service_role;
