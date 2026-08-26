-- O casador v3 — quem disputa é o documento, e nem todo pretendente tem peso.
--
-- Continuação de `20260826160000_notas_disputa_por_documento.sql`, onde estão
-- medidos os três ruídos (não-nota, cópia, nota sem valor). Aqui eles saem da
-- disputa.
--
-- DUAS MUDANÇAS, e as duas cabem numa frase.
--
-- 1. A REGRA 2 (mesmo CNPJ, janela de datas) PASSA A EXIGIR `parece_nota`.
--    Ela é a única regra sem conferência de valor — existe para o caso "o valor
--    não bate, mas quem recebeu é o mesmo". Isso só faz sentido para um
--    documento que É uma nota. Sem essa exigência, o logotipo da assinatura de
--    e-mail do fornecedor compartilha o CNPJ dele e cai na janela: 112 logotipos
--    reivindicando título.
--
-- 2. A DISPUTA CONTA DOCUMENTOS DE MAIOR PESO, não linhas.
--
--    `documento_chave` é a identidade do papel, na ordem em que se confia:
--      • `chave_fiscal` — é a identidade nacional do documento fiscal, única por
--        lei. Colapsa o PDF e o XML do mesmo e-mail, o reenvio na thread e a
--        cópia que a automação antiga largou no Drive.
--      • `fonte|linha`  — planilha. Uma linha pode ter vários arquivos e todos
--        falam do mesmo pagamento (foi o caso da Julia Rocon: recibo + prova de
--        pagamento). Continua sendo UMA reivindicação.
--      • `cnpj|valor|data` — arquivo solto sem chave. Mesmo emitente, mesmo
--        valor, mesmo dia é o mesmo papel.
--
--    `peso`: 2 = nota com valor · 1 = nota sem valor · 0 = não é nota.
--    Só os do maior peso PRESENTE naquele alvo disputam. Um logotipo não impede
--    mais uma NF-e de achar o título dela.
--
-- Medido antes de aplicar: dos 133 alvos com nota de verdade, 77 ficam com uma
-- só. Os outros 56 seguem parados — e continuam parados de propósito: nenhum
-- deles soma o valor do título, então não há como saber qual nota é a certa.

create or replace function public.notas_externas_casar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resumo jsonb;
begin
  -- A identidade do documento vem antes de tudo: é ela que diz quem é cópia de
  -- quem, e a disputa é contada em cima disso.
  perform public.notas_externas_marcar_copias();

  /* Recasa tudo que ainda não virou ação. Quem já subiu ao ERP ou foi decidido
     à mão fica onde está: o arquivo está lá, e trocar o alvo agora só faria a
     tela mentir sobre onde ele foi parar. */
  update public.notas_externas
     set alvo_tipo = null, alvo_id_unico = null, casamento = null,
         confianca = null, candidatos = null, conferencia = null
   where enviado_erp_em is null
     and not alvo_manual
     and ignorado_em is null;

  with alvos as (
    /* PIX e cartão entram INTEIROS, inclusive quem já tem anexo: sem os que
       têm, não há double check — só cobrança. */
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
    /* O RESTO DO CONTAS A PAGAR — o complemento, nunca o conjunto inteiro:
       título de PIX É título do contas a pagar, e somá-lo cru faria cada
       lançamento disputar consigo mesmo. `dispensa` fica de fora porque folha e
       tributo não têm nota de fornecedor. */
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
           /* A IDENTIDADE DO PAPEL. Ver o cabeçalho: chave fiscal, senão a linha
              da planilha, senão emitente+valor+dia. */
           coalesce(
             chave_fiscal,
             case when linha is not null then fonte || '|' || linha::text end,
             nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '')
               || '|' || coalesce(valor::text, '?') || '|' || coalesce(enviado_em::text, '?'),
             chave
           ) as documento_chave,
           /* O PESO DA REIVINDICAÇÃO. */
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
       -- Cópia não casa: quem responde pelo documento é a linha que o carrega.
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
    -- 1. documento + valor: identidade
    select nv.id as nota_id, a.tipo, a.id_unico,
           'cnpj_valor'::text as casamento, 'exata'::text as confianca, 1 as prio
      from n_valor nv
      join n      on n.id = nv.id
      join n_doc  nd on nd.id = nv.id
      join alvos  a  on a.doc = nd.doc
                    and round(a.valor * 100)::bigint = nv.cents
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    /* 2. documento + janela: o valor não bate, mas quem recebeu é o mesmo.
       É a ÚNICA regra sem conferência de valor — daí exigir `parece_nota`.
       Sem isso, o logotipo da assinatura do fornecedor reivindica o título. */
    select n.id, a.tipo, a.id_unico, 'cnpj_data', 'alta', 2
      from n
      join n_doc nd on nd.id = n.id
      join alvos a  on a.doc = nd.doc
                   and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where (n.tipos_alvo is null or a.tipo = any(n.tipos_alvo))
       and n.parece_nota

    union all
    -- 3. valor + janela apertada
    select nv.id, a.tipo, a.id_unico, 'valor_data', 'media', 3
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 15 and n.enviado_em + 45
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

    union all
    -- 4. nome + valor
    select nv.id, a.tipo, a.id_unico, 'nome_valor', 'media', 4
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where (n.tipos_alvo is null or a.tipo = any(n.tipos_alvo))
       and coalesce(n.nome, '') <> '' and length(n.nome) >= 6
       and similarity(public.normaliza_nome(n.nome), public.normaliza_nome(a.nome)) >= 0.55
  ),
  melhor as (
    select nota_id, min(prio) as prio from regra group by nota_id
  ),
  finalistas as (
    select distinct r.nota_id, r.tipo, r.id_unico, r.casamento, r.confianca, r.prio
      from regra r
      join melhor m on m.nota_id = r.nota_id and m.prio = r.prio
  ),
  contados as (
    select nota_id, count(*) as quantos from finalistas group by nota_id
  ),
  decisao as (
    select f.nota_id, c.quantos,
           min(f.tipo)      as tipo,
           min(f.id_unico)  as id_unico,
           min(f.casamento) as casamento,
           min(f.confianca) as confianca,
           min(f.prio)      as prio,
           jsonb_agg(jsonb_build_object('tipo', f.tipo, 'id_unico', f.id_unico)
                     order by f.tipo, f.id_unico) as lista
      from finalistas f
      join contados c on c.nota_id = f.nota_id
     group by f.nota_id, c.quantos
  ),
  /* -------- a guarda espelhada, agora por documento e por peso -------- */
  pretendentes as (
    select d.nota_id, d.tipo, d.id_unico, d.prio, n.documento_chave, n.peso
      from decisao d
      join n on n.id = d.nota_id
     where d.quantos = 1
  ),
  /* Só o maior peso PRESENTE naquele alvo disputa. Se há NF-e, o logotipo sai
     da conta; se só há logotipo, ele disputa entre iguais — e não ganha, porque
     a regra 2 já não o alcança. */
  topo as (
    select tipo, id_unico, max(peso) as peso from pretendentes group by 1, 2
  ),
  disputa as (
    select p.tipo, p.id_unico,
           count(distinct p.documento_chave) as docs,
           min(p.documento_chave) as vencedor
      from pretendentes p
      join topo t on t.tipo = p.tipo and t.id_unico = p.id_unico and t.peso = p.peso
     group by p.tipo, p.id_unico
  )
  update public.notas_externas nt
     set alvo_tipo     = case when ganhou then d.tipo      end,
         alvo_id_unico = case when ganhou then d.id_unico  end,
         casamento     = case when ganhou then d.casamento end,
         confianca     = case when ganhou then d.confianca end,
         candidatos    = case
                           when d.quantos > 1
                             then jsonb_build_object(
                                    'motivo', 'varios_alvos',
                                    'quantos', d.quantos,
                                    'regra', d.casamento,
                                    'alvos', (select jsonb_agg(x) from jsonb_array_elements(d.lista) with ordinality t(x, i) where i <= 5))
                           when not ganhou
                             then jsonb_build_object(
                                    'motivo', 'alvo_disputado',
                                    'quantos', 1,
                                    'linhas_disputando', coalesce(disp.docs, 1),
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
         /* Peso baixo só ganha quando NINGUÉM de peso maior reivindica o mesmo
            alvo — e aí `topo` já é o peso dele, então a conta acima basta. O
            teste explícito abaixo é o que impede a cópia-fantasma: um documento
            que não é o `vencedor` do seu próprio alvo não leva. */
         and coalesce(disp.vencedor, n.documento_chave) = n.documento_chave as ganhou
    ) g
   where nt.id = d.nota_id;

  /* -------- o double check: o que o ERP tem, de verdade -------- */
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
    'por_fonte', (select jsonb_object_agg(fonte, n)
                    from (select fonte, count(*) n from public.notas_externas group by fonte) t),
    'conferencia', (select jsonb_object_agg(coalesce(conferencia, 'sem_conferencia'), n)
                    from (select conferencia, count(*) n from public.notas_externas group by conferencia) t),
    'por_confianca', (select jsonb_object_agg(coalesce(confianca, 'sem_casamento'), n)
                    from (select confianca, count(*) n from public.notas_externas group by confianca) t),
    'ambiguo_varios_alvos', (select count(*) from public.notas_externas
                              where candidatos->>'motivo' = 'varios_alvos'),
    'ambiguo_alvo_disputado', (select count(*) from public.notas_externas
                              where candidatos->>'motivo' = 'alvo_disputado'),
    'em_pix',    (select count(*) from public.notas_externas where alvo_tipo = 'pix'),
    'em_cartao', (select count(*) from public.notas_externas where alvo_tipo = 'cartao'),
    'em_erp',    (select count(*) from public.notas_externas where alvo_tipo = 'erp')
  ) into v_resumo;

  return v_resumo;
end;
$$;

revoke all on function public.notas_externas_casar() from public, anon;
grant execute on function public.notas_externas_casar() to authenticated, service_role;
