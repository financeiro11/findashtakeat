-- O acervo de notas passa a enxergar o contas a pagar inteiro.
--
-- O QUE ESTAVA ERRADO. `notas_externas` guarda 3.694 arquivos de nota vindos de
-- nove origens — as cinco planilhas, as três pastas do Drive e a caixa do
-- `financeiro@`. O casador só oferecia DOIS alvos: os 757 lançamentos de PIX e
-- os 862 do cartão. Tudo o que a empresa paga por fora desses dois caminhos —
-- boleto de fornecedor, transferência agendada, título lançado à mão no ERP —
-- não tinha alvo nenhum. Medido em 26/08/2026: 2.801 notas com arquivo, com
-- data e com cara de nota, sem alvo possível. Elas não eram "não casadas": elas
-- não tinham contra o que casar.
--
-- Do outro lado da mesma casa, `/governanca/notas-erp` conta 1.703 títulos
-- `sem_nota`, R$ 2,55 mi, e pergunta "cadê a nota do fornecedor?" — sem saber
-- que o Hub já tem o arquivo guardado. As duas telas mediam metades do mesmo
-- buraco sem se falar.
--
-- ---------------------------------------------------------------------------
-- A ARMADILHA QUE QUASE DERRUBOU OS 280 CASAMENTOS QUE JÁ FUNCIONAVAM
--
-- Título de PIX É título do contas a pagar: `auditoria_pix_lancamentos.id_unico`
-- é o próprio `nCodTitulo`. E dos 4.917 títulos de `cap_titulos`, 757 são os do
-- PIX e 844 são os do cartão (via `omie_cod_titulo`). Somar `cap_titulos` cru à
-- lista de alvos faria cada lançamento aparecer DUAS vezes — uma como 'pix',
-- outra como 'erp' — e a regra de empate (`quantos > 1` não casa) transformaria
-- em `ambiguo` todo casamento que hoje funciona. Falha silenciosa: nenhum erro,
-- só a tela esvaziando.
--
-- Por isso o alvo 'erp' é o COMPLEMENTO — os 3.385 títulos que não são PIX nem
-- cartão. PIX e cartão continuam com identidade própria porque têm tela própria,
-- coluna própria e história própria; 'erp' cobre o resto do razão.
--
-- ---------------------------------------------------------------------------
-- POR QUE `tipo_alvo` VIRA LISTA
--
-- A guarda que impedia uma compra "Cartão de Crédito" de casar com um PIX de
-- mesmo valor era um lado só (`'cartao'` ou `'pix'`). Com três alvos ela vira
-- lista, porque o ERP é o SUPERCONJUNTO: toda forma de pagamento termina em
-- título no contas a pagar. Uma nota de cartão pode legitimamente casar com um
-- título de cartão que a base da auditoria não conhece — são ~2.146 títulos
-- "Lancamento Fatura Cartao" vindos da importação antiga. O que a guarda
-- continua impedindo é o cruzamento entre PIX e cartão, que era o erro real.
--
-- Medido antes de aplicar, contra o dado de produção: 587 notas ganham alvo
-- único (117 exata, 225 alta, 245 média), 181 títulos passam a ter documento e
-- 196 ficam ambíguas. Nenhum dos 280 casamentos atuais se perde.

/* ============================================================================
 *  1. O terceiro alvo entra no contrato
 * ========================================================================== */

alter table public.notas_externas
  drop constraint if exists notas_externas_alvo_tipo_check;

alter table public.notas_externas
  add constraint notas_externas_alvo_tipo_check
  check (alvo_tipo in ('pix', 'cartao', 'erp'));

comment on column public.notas_externas.alvo_tipo is
  'pix | cartao | erp. Em ''pix'' e ''erp'' o `alvo_id_unico` É o nCodTitulo do Omie; em ''cartao'' é o id_unico da base, e o título mora em `auditoria_cartao_lancamentos.omie_cod_titulo`. ''erp'' é o contas a pagar MENOS os títulos que já são PIX ou cartão.';

/* ============================================================================
 *  2. O casador, com os três alvos
 * ========================================================================== */

create or replace function public.notas_externas_casar()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resumo jsonb;
begin
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
    /* O RESTO DO CONTAS A PAGAR. O `not exists` é o que impede o lançamento de
       aparecer duas vezes e empatar consigo mesmo — ver o cabeçalho.

       `dispensa` fica de fora: transferência entre contas próprias, folha e
       tributo não têm nota de fornecedor, e oferecê-los como alvo faria a nota
       de um almoço casar com uma guia de INSS de mesmo valor. É a mesma régua
       (`omie_categoria_regra`) que já governa o denominador da tela. */
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
           /* Uma linha de planilha pode ter vários arquivos, e todos apontam de
              propósito para o mesmo pagamento. É a linha que identifica "a nota"
              para efeito de disputa; no Drive não há linha, e aí vale a chave. */
           fonte || '|' || coalesce(linha::text, chave) as linha_nota,
           /* ONDE ESTA NOTA PODE CASAR, quando a própria fonte já responde.
              Nulo = qualquer lado.

              É guarda de VERDADE, não economia de consulta: uma compra marcada
              "Cartão de Crédito" que casasse com um PIX de mesmo valor marcaria
              como resolvido um pagamento que ela não explica — e ele sumiria da
              lista de cobrança, que é o pior desfecho possível aqui.

              'erp' entra em TODAS as listas porque é o superconjunto: toda forma
              de pagamento vira título no contas a pagar. O que a guarda impede
              continua sendo o cruzamento PIX × cartão. */
           case
             -- A pasta do Mercado Livre é de compra no cartão, sempre. Foi um
             -- casamento por valor solto que grudou 16 notas de bebida num
             -- lançamento do "99"; aqui a fonte já diz o lado.
             when fonte = 'drive_mercado_livre' then array['cartao', 'erp']
             when forma_pagamento ilike '%cart%' then array['cartao', 'erp']
             when forma_pagamento ilike '%pix%'
               or forma_pagamento ilike '%boleto%'
               or forma_pagamento ilike '%transfer%' then array['pix', 'erp']
           end as tipos_alvo
      from public.notas_externas
     where enviado_erp_em is null and not alvo_manual and ignorado_em is null
       and enviado_em is not null
  ),
  /* Uma nota oferece até DOIS valores (o total e a parcela — a fatura mostra a
     parcela) e até DOIS documentos (o emitente da nota e a chave PIX, que
     discordam quando a NF é de um CNPJ e o pagamento vai para outro).

     Vira lista para o join ser de IGUALDADE. A tolerância de 2 centavos entra
     expandindo o lado da nota, não comparando por faixa: com 2.300 notas contra
     ~6.000 lançamentos, faixa vira varredura e igualdade vira hash. */
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
    -- 2. documento + janela: o valor não bate, mas quem recebeu é o mesmo
    select n.id, a.tipo, a.id_unico, 'cnpj_data', 'alta', 2
      from n
      join n_doc nd on nd.id = n.id
      join alvos a  on a.doc = nd.doc
                   and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where n.tipos_alvo is null or a.tipo = any(n.tipos_alvo)

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
    select distinct r.nota_id, r.tipo, r.id_unico, r.casamento, r.confianca
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
           jsonb_agg(jsonb_build_object('tipo', f.tipo, 'id_unico', f.id_unico)
                     order by f.tipo, f.id_unico) as lista
      from finalistas f
      join contados c on c.nota_id = f.nota_id
     group by f.nota_id, c.quantos
  ),
  /* -------- a guarda espelhada -------- */
  /* Quem sobreviveu ao empate de alvos, com a linha de planilha que o reivindica. */
  pretendentes as (
    select d.nota_id, d.tipo, d.id_unico, n.linha_nota
      from decisao d
      join n on n.id = d.nota_id
     where d.quantos = 1
  ),
  disputa as (
    select tipo, id_unico, count(distinct linha_nota) as linhas
      from pretendentes group by 1, 2
  )
  update public.notas_externas nt
     set alvo_tipo     = case when d.quantos = 1 and coalesce(disp.linhas, 1) = 1 then d.tipo      end,
         alvo_id_unico = case when d.quantos = 1 and coalesce(disp.linhas, 1) = 1 then d.id_unico  end,
         casamento     = case when d.quantos = 1 and coalesce(disp.linhas, 1) = 1 then d.casamento end,
         confianca     = case when d.quantos = 1 and coalesce(disp.linhas, 1) = 1 then d.confianca end,
         candidatos    = case
                           -- Empate guarda os cinco primeiros: é o que a pessoa
                           -- precisa ver para desempatar, e a lista inteira de um
                           -- CNPJ mensal seria ruído.
                           when d.quantos > 1
                             then jsonb_build_object(
                                    'motivo', 'varios_alvos',
                                    'quantos', d.quantos,
                                    'regra', d.casamento,
                                    'alvos', (select jsonb_agg(x) from jsonb_array_elements(d.lista) with ordinality t(x, i) where i <= 5))
                           -- Alvo único, mas disputado por outras linhas. O alvo
                           -- vai junto: é ele que a pessoa confirma em
                           -- `notas_externas_definir_alvo` se esta for a certa.
                           when coalesce(disp.linhas, 1) > 1
                             then jsonb_build_object(
                                    'motivo', 'alvo_disputado',
                                    'quantos', 1,
                                    'linhas_disputando', disp.linhas,
                                    'regra', d.casamento,
                                    'alvos', d.lista)
                         end,
         atualizado_em = now()
    from decisao d
    left join disputa disp on disp.tipo = d.tipo and disp.id_unico = d.id_unico and d.quantos = 1
   where nt.id = d.nota_id;

  /* -------- o double check: o que o ERP tem, de verdade -------- */
  update public.notas_externas nt
     set conferencia = case
           when nt.alvo_tipo is null and nt.candidatos is not null then 'ambiguo'
           when nt.alvo_tipo is null                               then 'sem_alvo'
           /* Já subiu por aqui. O `incluirAnexo` confirma que o anexo colou
              antes de carimbar, então o ERP tem — mesmo que a releitura da
              `omie-pix-sync` só passe amanhã. Sem esta linha, a nota recém
              enviada voltaria para "falta anexar" na primeira rodada do cron. */
           when nt.enviado_erp_em is not null                      then 'confere'
           when e.ja_tem                                           then 'confere'
           -- A planilha jurou que anexou e o ERP está vazio. É este o achado.
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
                    /* No 'erp' só existe uma testemunha, e é a boa: o
                       `ListarAnexo` que a `omie-anexos-varredura` já leu. Não há
                       `tem_comprovante` aqui — e é melhor assim, porque aquela
                       coluna mistura "o Hub acha que tem" com "o ERP tem". */
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
        /* O `id_unico` do PIX É o `nCodTitulo` do Omie — e no 'erp' também, por
           construção. É assim que a semente da varredura de anexos já o
           converteu (migration 20260825140000).

           O cast passa por `nullif(regexp_replace(...))` e NÃO por um
           `~ '^\d+$'` ao lado: numa condição de junção o Postgres não promete
           ordem de avaliação, então o cast pode rodar ANTES do teste e derrubar
           a função inteira no primeiro id não numérico. Assim, o que não é
           número vira NULL e simplesmente não casa. */
        left join public.omie_titulo_anexo ota
               on nt2.alvo_tipo in ('pix', 'erp')
              and ota.cod_titulo = nullif(regexp_replace(nt2.alvo_id_unico, '\D', '', 'g'), '')::bigint
       where nt2.ignorado_em is null
    ) e
   where nt.id = e.id;

  select jsonb_build_object(
    'notas',    (select count(*) from public.notas_externas),
    'por_fonte', (select jsonb_object_agg(fonte, n)
                    from (select fonte, count(*) n from public.notas_externas group by fonte) t),
    'conferencia', (select jsonb_object_agg(coalesce(conferencia, 'sem_conferencia'), n)
                    from (select conferencia, count(*) n from public.notas_externas group by conferencia) t),
    'por_confianca', (select jsonb_object_agg(coalesce(confianca, 'sem_casamento'), n)
                    from (select confianca, count(*) n from public.notas_externas group by confianca) t),
    -- Os dois motivos de recusa, separados: são problemas diferentes e se
    -- resolvem de jeitos diferentes.
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

revoke all on function public.notas_externas_casar() from public;
revoke all on function public.notas_externas_casar() from anon;
grant execute on function public.notas_externas_casar() to authenticated, service_role;
