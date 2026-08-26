-- Quem não é nota não disputa, e perder não é empatar.
--
-- Depois do casador v3 sobraram 415 notas em `alvo_disputado`. Olhando o maior
-- grupo, o que estava lá dentro:
--
--   image001 · image003 · image004 · ~WRD1492 · image002
--
-- Imagem de assinatura de e-mail e arquivo temporário do Word, todos com
-- `valor = 6500` e o CNPJ do fornecedor. **A `gmail-nf-sync` carimba o valor e o
-- CNPJ lidos no CORPO da mensagem em TODOS os anexos dela** — então um e-mail
-- com seis imagens embutidas vira seis pretendentes de R$ 6.500 ao mesmo título.
-- (A raiz é a ingestão; consertá-la é outro passo, e enquanto isso o casador não
-- precisa repassar o ruído adiante.)
--
-- DUAS CORREÇÕES, as duas de honestidade do rótulo:
--
-- 1. PESO 0 NÃO PRODUZ DISPUTA. Um logotipo que não achou lançamento é
--    `sem_alvo`, que é a verdade: imagem de assinatura não tem nota fiscal nem
--    pagamento. Antes ele aparecia em `ambiguo` e pedia decisão de gente sobre
--    uma coisa que ninguém precisa decidir.
--
-- 2. PERDER PARA UM DOCUMENTO MAIS FORTE NÃO É EMPATE. Havia 40 notas dizendo
--    "1 linha disputando" — leitura sem sentido. O que aconteceu com elas é
--    outra coisa: um documento de peso maior levou aquele lançamento. Isso vira
--    `outro_documento`, com o motivo escrito.
--
-- 3. E A FILA PASSA A EXIGIR `parece_nota`. A tela da BasePix já filtrava isso
--    ao montar o lote, mas a função aceitava — então um boleto ou um logotipo
--    que ganhasse um alvo entraria no ERP como se fosse a nota. A cobertura de
--    "Notas no ERP" mede NOTA; anexar um recibo onde se cobra nota fiscal não
--    responde a pergunta do contador.

create or replace function public.notas_externas_casar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resumo jsonb;
begin
  perform public.notas_externas_marcar_copias();

  update public.notas_externas
     set alvo_tipo = null, alvo_id_unico = null, casamento = null,
         confianca = null, candidatos = null, conferencia = null
   where enviado_erp_em is null
     and not alvo_manual
     and ignorado_em is null;

  with alvos as (
    select 'pix'::text as tipo, p.id_unico,
           p.data,
           round(abs(coalesce(p.valor, 0))::numeric, 2) as valor,
           nullif(regexp_replace(coalesce(p.cnpj_cpf, ''), '\D', '', 'g'), '') as doc,
           coalesce(p.favorecido, p.descricao, '') as nome
      from public.auditoria_pix_lancamentos p
     where p.data is not null
    union all
    select 'cartao', a.id_unico,
           a.data,
           round(abs(coalesce(a.valor, 0))::numeric, 2),
           null,
           coalesce(a.estabelecimento, a.descricao_original, '')
      from public.auditoria_cartao_lancamentos a
     where a.data is not null
    union all
    select 'erp', c.cod_titulo::text,
           coalesce(c.pagamento, c.vencimento, c.emissao),
           round(abs(coalesce(c.valor, 0))::numeric, 2),
           nullif(regexp_replace(coalesce(c.doc, ''), '\D', '', 'g'), ''),
           coalesce(c.favorecido_cru, c.favorecido, '')
      from public.cap_titulos c
     where coalesce(c.pagamento, c.vencimento, c.emissao) is not null
       and c.situacao <> 'dispensa'
       and not exists (select 1 from public.auditoria_pix_lancamentos p
                        where p.id_unico = c.cod_titulo::text)
       and not exists (select 1 from public.auditoria_cartao_lancamentos a
                        where a.omie_cod_titulo = c.cod_titulo::text)
  ),
  n as (
    select id, enviado_em, nome, valor, valor_parcela, forma_pagamento, cnpj, documento,
           parece_nota,
           coalesce(
             chave_fiscal,
             case when linha is not null then fonte || '|' || linha::text end,
             nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '')
               || '|' || coalesce(valor::text, '?') || '|' || coalesce(enviado_em::text, '?'),
             chave
           ) as documento_chave,
           case when not parece_nota then 0
                when valor is null    then 1
                else 2 end as peso,
           case
             when fonte = 'drive_mercado_livre' then array['cartao', 'erp']
             when forma_pagamento ilike '%cart%' then array['cartao', 'erp']
             when forma_pagamento ilike '%pix%'
               or forma_pagamento ilike '%boleto%'
               or forma_pagamento ilike '%transfer%' then array['pix', 'erp']
           end as tipos_alvo
      from public.notas_externas
     where enviado_erp_em is null and not alvo_manual and ignorado_em is null
       and enviado_em is not null
       and copia_de is null
  ),
  n_valor as (
    select distinct n.id, round(x * 100)::bigint + d as cents
      from n
      cross join lateral unnest(array[n.valor, n.valor_parcela]) as x
      cross join generate_series(-2, 2) as d
     where x is not null and x > 0
  ),
  n_doc as (
    select distinct n.id, d as doc
      from n
      cross join lateral unnest(array[n.cnpj, n.documento]) as d
     where d is not null and length(d) >= 11
  ),
  regra as (
    select nv.id as nota_id, a.tipo, a.id_unico,
           'cnpj_valor'::text as casamento, 'exata'::text as confianca, 1 as prio
      from n_valor nv
      join n      on n.id = nv.id
      join n_doc  nd on nd.id = nv.id
      join alvos  a  on a.doc = nd.doc
                    and round(a.valor * 100)::bigint = nv.cents
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    select n.id, a.tipo, a.id_unico, 'cnpj_data', 'alta', 2
      from n
      join n_doc nd on nd.id = n.id
      join alvos a  on a.doc = nd.doc
                   and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where (n.tipos_alvo is null or a.tipo = any(n.tipos_alvo))
       and n.parece_nota

    union all
    select nv.id, a.tipo, a.id_unico, 'valor_data', 'media', 3
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 15 and n.enviado_em + 45
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    select nv.id, a.tipo, a.id_unico, 'nome_valor', 'media', 4
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where (n.tipos_alvo is null or a.tipo = any(n.tipos_alvo))
       and coalesce(n.nome, '') <> '' and length(n.nome) >= 6
       and similarity(public.normaliza_nome(n.nome), public.normaliza_nome(a.nome)) >= 0.55
  ),
  melhor as (select nota_id, min(prio) as prio from regra group by nota_id),
  finalistas as (
    select distinct r.nota_id, r.tipo, r.id_unico, r.casamento, r.confianca, r.prio
      from regra r join melhor m on m.nota_id = r.nota_id and m.prio = r.prio
  ),
  contados as (select nota_id, count(*) as quantos from finalistas group by nota_id),
  decisao as (
    select f.nota_id, c.quantos,
           min(f.tipo) as tipo, min(f.id_unico) as id_unico,
           min(f.casamento) as casamento, min(f.confianca) as confianca,
           jsonb_agg(jsonb_build_object('tipo', f.tipo, 'id_unico', f.id_unico)
                     order by f.tipo, f.id_unico) as lista
      from finalistas f join contados c on c.nota_id = f.nota_id
     group by f.nota_id, c.quantos
  ),
  pretendentes as (
    select d.nota_id, d.tipo, d.id_unico, n.documento_chave, n.peso
      from decisao d join n on n.id = d.nota_id
     where d.quantos = 1
  ),
  topo as (select tipo, id_unico, max(peso) as peso from pretendentes group by 1, 2),
  disputa as (
    select p.tipo, p.id_unico,
           count(distinct p.documento_chave) as docs,
           min(p.documento_chave) as vencedor,
           max(t.peso) as peso_topo
      from pretendentes p
      join topo t on t.tipo = p.tipo and t.id_unico = p.id_unico and t.peso = p.peso
     group by p.tipo, p.id_unico
  )
  update public.notas_externas nt
     set alvo_tipo     = case when g.ganhou then d.tipo      end,
         alvo_id_unico = case when g.ganhou then d.id_unico  end,
         casamento     = case when g.ganhou then d.casamento end,
         confianca     = case when g.ganhou then d.confianca end,
         candidatos    = case
                           when d.quantos > 1
                             then jsonb_build_object(
                                    'motivo', 'varios_alvos',
                                    'quantos', d.quantos,
                                    'regra', d.casamento,
                                    'alvos', (select jsonb_agg(x) from jsonb_array_elements(d.lista) with ordinality t(x, i) where i <= 5))
                           when g.ganhou then null
                           /* Não é nota e não levou: é `sem_alvo`, não empate.
                              Imagem de assinatura não tem lançamento, e pedir
                              que alguém decida sobre ela é gastar a atenção que
                              as notas de verdade precisam. */
                           when n.peso = 0 then null
                           -- Empate de verdade: dois documentos do mesmo peso.
                           when coalesce(disp.docs, 1) > 1
                             then jsonb_build_object(
                                    'motivo', 'alvo_disputado',
                                    'quantos', 1,
                                    'linhas_disputando', disp.docs,
                                    'regra', d.casamento,
                                    'alvos', d.lista)
                           -- Perdeu para um documento mais forte.
                           else jsonb_build_object(
                                  'motivo', 'outro_documento',
                                  'quantos', 1,
                                  'regra', d.casamento,
                                  'alvos', d.lista)
                         end,
         atualizado_em = now()
    from decisao d
    join n on n.id = d.nota_id
    left join disputa disp on disp.tipo = d.tipo and disp.id_unico = d.id_unico and d.quantos = 1
    cross join lateral (
      select d.quantos = 1
         and coalesce(disp.docs, 1) = 1
         and coalesce(disp.vencedor, n.documento_chave) = n.documento_chave as ganhou
    ) g
   where nt.id = d.nota_id;

  update public.notas_externas nt
     set conferencia = case
           when nt.alvo_tipo is null and nt.candidatos is not null then 'ambiguo'
           when nt.alvo_tipo is null                               then 'sem_alvo'
           when nt.enviado_erp_em is not null                      then 'confere'
           when e.ja_tem                                           then 'confere'
           when nt.diz_anexado                                     then 'promessa_falsa'
           else 'falta_anexar'
         end,
         erp_anexos   = e.anexos,
         conferido_em = now(),
         atualizado_em = now()
    from (
      select nt2.id,
             coalesce(
               case when nt2.alvo_tipo = 'pix'
                    then p.tem_comprovante or coalesce(ota.qtd, 0) > 0
                    when nt2.alvo_tipo = 'erp'
                    then coalesce(ota.qtd, 0) > 0
                    else coalesce(c.status_nf, '') = 'OK'
                      or coalesce(c.link_comprovante, '') <> ''
               end, false) as ja_tem,
             case when nt2.alvo_tipo in ('pix', 'erp') then ota.qtd end as anexos
        from public.notas_externas nt2
        left join public.auditoria_pix_lancamentos p
               on nt2.alvo_tipo = 'pix' and p.id_unico = nt2.alvo_id_unico
        left join public.auditoria_cartao_lancamentos c
               on nt2.alvo_tipo = 'cartao' and c.id_unico = nt2.alvo_id_unico
        left join public.omie_titulo_anexo ota
               on nt2.alvo_tipo in ('pix', 'erp')
              and ota.cod_titulo = nullif(regexp_replace(nt2.alvo_id_unico, '\D', '', 'g'), '')::bigint
       where nt2.ignorado_em is null
    ) e
   where nt.id = e.id;

  select jsonb_build_object(
    'notas',    (select count(*) from public.notas_externas),
    'copias',   (select count(*) from public.notas_externas where copia_de is not null),
    'conferencia', (select jsonb_object_agg(coalesce(conferencia, 'sem_conferencia'), n)
                    from (select conferencia, count(*) n from public.notas_externas group by conferencia) t),
    'por_confianca', (select jsonb_object_agg(coalesce(confianca, 'sem_casamento'), n)
                    from (select confianca, count(*) n from public.notas_externas group by confianca) t),
    'ambiguo_varios_alvos',   (select count(*) from public.notas_externas where candidatos->>'motivo' = 'varios_alvos'),
    'ambiguo_alvo_disputado', (select count(*) from public.notas_externas where candidatos->>'motivo' = 'alvo_disputado'),
    'perdeu_p_outro_doc',     (select count(*) from public.notas_externas where candidatos->>'motivo' = 'outro_documento'),
    'em_pix',    (select count(*) from public.notas_externas where alvo_tipo = 'pix'),
    'em_cartao', (select count(*) from public.notas_externas where alvo_tipo = 'cartao'),
    'em_erp',    (select count(*) from public.notas_externas where alvo_tipo = 'erp')
  ) into v_resumo;

  return v_resumo;
end;
$$;

revoke all on function public.notas_externas_casar() from public, anon;
grant execute on function public.notas_externas_casar() to authenticated, service_role;

/* ============================================================================
 *  A fila só leva NOTA
 * ========================================================================== */

create or replace function public.notas_externas_enfileirar(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.notas_externas
     set fila_erp = true, erro_erp = null, atualizado_em = now()
   where id = any(p_ids)
     and enviado_erp_em is null
     and ignorado_em is null
     and alvo_tipo is not null
     and conferencia in ('falta_anexar', 'promessa_falsa')
     and tem_arquivo
     and copia_de is null
     /* "Notas no ERP" mede NOTA. Anexar um boleto, um recibo ou o logotipo da
        assinatura do fornecedor onde se cobra nota fiscal não responde à
        pergunta do contador — e some da lista de cobrança como se tivesse
        respondido. A tela da BasePix já filtrava isso ao montar o lote; a
        função aceitava. */
     and parece_nota;
  get diagnostics v_n = row_count;

  update public.auditoria_cartao_lancamentos a
     set status_nf = 'OK',
         link_comprovante = nt.link,
         arquivo_comprovante = coalesce(a.arquivo_comprovante, nt.fonte || coalesce(' · linha ' || nt.linha, '')),
         updated_at = now()
    from public.notas_externas nt
   where nt.id = any(p_ids)
     and nt.alvo_tipo = 'cartao'
     and nt.tem_arquivo and nt.parece_nota
     and a.id_unico = nt.alvo_id_unico
     and coalesce(a.status_nf, '') <> 'OK'
     and coalesce(a.link_comprovante, '') = '';

  return v_n;
end;
$$;

revoke all on function public.notas_externas_enfileirar(bigint[]) from public, anon;
grant execute on function public.notas_externas_enfileirar(bigint[]) to authenticated, service_role;
