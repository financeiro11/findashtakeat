-- As cinco planilhas de formulário viram evidência da auditoria — e conferência do ERP.
--
-- O QUE FALTAVA. A NF do Drive já tirava o lançamento do "SEM NF", mas só no
-- CARTÃO (`comprovantes_drive` + gatilho `comprovante_marca_com_nf`). A aba de
-- PIX seguia perguntando "cadê a nota?" de 2.326 notas que já estavam anexadas
-- num formulário, com CNPJ digitado por quem gastou e valor conferido.
--
-- E TEM UM SEGUNDO USO, que é o mais valioso: essas planilhas já alimentam o
-- Omie por uma automação que escreve o desfecho de volta na própria planilha
-- ("Anexado! ✓" em 527 linhas, "Lançado e Anexado!!!" em 58). Isso é PROMESSA.
-- Cruzando com o `ListarAnexo` que o Hub já leu (`omie_titulo_anexo` e
-- `auditoria_pix_lancamentos.tem_comprovante`), a promessa vira verificação:
-- quem disse que anexou e não anexou aparece com nome e valor.
--
-- ---------------------------------------------------------------------------
-- POR QUE A NOTA NÃO É ESCRITA DENTRO DO LANÇAMENTO DE PIX
--
-- Seria o caminho curto: gravar o link em `auditoria_pix_lancamentos.comprovante_url`
-- e pronto. Mas a ação `anexos` da `omie-pix-sync` reescreve essas três colunas
-- com o que o ERP responde — inclusive `null` quando o ERP não tem nada — e a
-- ação `sync` zera `anexo_verificado` do mês inteiro para forçar a releitura.
-- O link durava até a próxima sincronização.
--
-- Pior que perder: MENTIR. `tem_comprovante` nasceu significando "o título tem
-- anexo NO OMIE" (veio do ListarAnexo), e a tela escreve "Comprovante anexado no
-- Omie" em cima dele. Escrever ali um link do Drive pintaria de verde uma linha
-- que o contador abre e não encontra nada.
--
-- Então a nota mora AQUI, apontando para o lançamento, e `tem_comprovante`
-- continua querendo dizer o que sempre quis. A tela junta as duas coisas e
-- mostra as duas verdades: "a nota existe" e "o ERP tem (ou não) o arquivo".
-- Preencher o ERP é o passo seguinte, e é envio de verdade — a fila `fila_erp`,
-- que a `omie-anexar-comprovante` consome.
--
-- Dependência: `public.normaliza_nome(text)` e `pg_trgm`, os mesmos que a
-- `facilities_nf_candidatos` já usa.

/* ============================================================================
 *  1. A tabela
 * ========================================================================== */

create table if not exists public.notas_externas (
  id              bigint generated always as identity primary key,
  -- `fonte|linha|driveId`. Estável entre rodadas: a mesma linha reexportada
  -- amanhã cai no mesmo registro, e o que a pessoa decidiu não se perde.
  chave           text not null unique,
  fonte           text not null,
  -- Nulo nas pastas do Drive: lá não existe linha de planilha, existe arquivo.
  linha           integer,
  -- Qual arquivo da linha. Uma linha de Compras chegou com dois anexos na
  -- mesma célula, e quem anexa no ERP anexa um por vez.
  ordem           integer not null default 1,

  -- o que a planilha diz
  enviado_em      date,
  nome            text,
  cnpj            text,
  -- a chave PIX, quando é documento e DISCORDA do emitente da nota
  documento       text,
  valor           numeric,
  valor_parcela   numeric,
  forma_pagamento text,
  competencia     text,
  o_que_e         text,
  detalhe         text,
  -- o veredito da automação que já existe, copiado cru
  status_planilha text,
  diz_anexado     boolean not null default false,
  drive_id        text not null,
  link            text not null,

  -- casamento com o lançamento
  alvo_tipo       text check (alvo_tipo in ('pix', 'cartao')),
  alvo_id_unico   text,
  casamento       text,
  confianca       text check (confianca in ('exata', 'alta', 'media')),
  -- empate: ninguém é escolhido, e os empatados ficam à vista para a pessoa
  candidatos      jsonb,
  alvo_manual     boolean not null default false,

  -- double check contra o ERP
  conferencia     text,
  erp_anexos      integer,
  conferido_em    timestamptz,

  -- envio do arquivo ao ERP
  fila_erp        boolean not null default false,
  enviado_erp_em  timestamptz,
  erro_erp        text,
  ignorado_em     timestamptz,
  ignorado_motivo text,

  visto_em        timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table public.notas_externas is
  'Uma linha por ARQUIVO de nota que chegou de fora do ERP — as cinco planilhas de formulário e as duas pastas de comprovante do Drive. Aponta para o lançamento que ela explica e guarda o resultado do double check contra o anexo do Omie.';
comment on column public.notas_externas.fonte is
  'compras | reembolsos | nfs_colaboradores | eventos | parceiros | drive_mercado_livre | drive_whatsapp. Não é enum de propósito: fonte nova entra sem migration.';
comment on column public.notas_externas.diz_anexado is
  'A planilha AFIRMA que a automação já anexou no Omie. É promessa, não prova — o cruzamento com o ERP é que decide.';
comment on column public.notas_externas.conferencia is
  'confere | falta_anexar | promessa_falsa | ambiguo | sem_alvo. "promessa_falsa" é a planilha dizendo Anexado! num título sem anexo nenhum.';
comment on column public.notas_externas.fila_erp is
  'Marcada para subir o arquivo ao Omie. Enviar é decisão de gente: anexo no ERP é difícil de desfazer.';

create index if not exists notas_externas_fonte_idx      on public.notas_externas (fonte);
create index if not exists notas_externas_alvo_idx       on public.notas_externas (alvo_tipo, alvo_id_unico);
create index if not exists notas_externas_conferencia_idx on public.notas_externas (conferencia);
create index if not exists notas_externas_cnpj_idx       on public.notas_externas (cnpj) where cnpj is not null;
create index if not exists notas_externas_fila_idx       on public.notas_externas (fila_erp) where fila_erp and enviado_erp_em is null;

alter table public.notas_externas enable row level security;

drop policy if exists notas_externas_leitura on public.notas_externas;
create policy notas_externas_leitura
  on public.notas_externas for select to authenticated using (true);

-- Escrita só pela service_role (a Edge Function) e pelas RPCs `security definer`
-- abaixo. Sem policy de INSERT/UPDATE para `authenticated`: a tela não escreve
-- na tabela direto, e assim não há caminho de gravar um casamento sem passar
-- pelas guardas.
grant select on public.notas_externas to authenticated;
grant all    on public.notas_externas to service_role;
revoke all   on public.notas_externas from anon;

/* ============================================================================
 *  1.5. O freio que faltava do lado do PIX
 * ========================================================================== */

-- A auditoria de PIX nunca teve varredura de anexo, e por isso nunca precisou
-- de carimbo. Agora precisa: sem ele, a mesma nota subiria de novo na rodada
-- seguinte e o título ficaria com dois anexos iguais — foi assim que o cartão
-- tentou anexar duas vezes no título 5504197016.
--
-- `tem_comprovante` NÃO serve para isso: ele quer dizer "o ERP tem o arquivo" e
-- é reescrito a cada releitura da `omie-pix-sync`, inclusive para `false`.
-- Carimbo é sobre o que ESTE Hub fez, e é coluna própria.
alter table public.auditoria_pix_lancamentos
  add column if not exists omie_anexo_enviado_em timestamptz,
  add column if not exists omie_anexo_nome text;

comment on column public.auditoria_pix_lancamentos.omie_anexo_enviado_em is
  'Quando o Hub subiu o arquivo para este título. Freio da varredura — diferente de tem_comprovante, que é o que o ERP responde.';

create index if not exists auditoria_pix_anexo_pendente_idx
  on public.auditoria_pix_lancamentos (id)
  where omie_anexo_enviado_em is null and comprovante_url is not null;

/* ============================================================================
 *  2. O casamento — em conjunto, não linha a linha
 * ========================================================================== */

-- As quatro chaves, em ordem de confiança. Cada uma nasceu de um caso real:
--
--   1. documento + valor .... identidade. O CNPJ da NF é o mesmo do favorecido
--                             do extrato E o valor bate ao centavo. Dispensa
--                             janela de data: com os dois iguais, é a mesma
--                             coisa mesmo que o pagamento tenha demorado.
--   2. documento + janela ... o CNPJ bate mas o valor não: nota de R$ 1.000
--                             paga com desconto, ou duas notas num PIX só.
--   3. valor + janela ....... sem documento nenhum (o formulário de Compras
--                             não pergunta CNPJ). Janela apertada, porque
--                             coincidência de valor é ROTINA — em 3.768 linhas
--                             de fatura foi assim que um PDF de bebidas grudou
--                             num lançamento do "99".
--   4. nome + valor ......... último recurso, sempre proposta.
--
-- EMPATE NÃO CASA. Dois alvos na melhor regra viram `candidatos` e ninguém é
-- escolhido: marcar o lançamento errado como resolvido é pior do que deixá-lo
-- pendente, porque some da lista de cobrança.

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
  ),
  n as (
    select id, enviado_em, nome, valor, valor_parcela, forma_pagamento, cnpj, documento,
           /* ONDE ESTA NOTA PODE CASAR, quando a própria fonte já responde.
              Nulo = qualquer lado.

              É guarda de VERDADE, não economia de consulta: uma compra marcada
              "Cartão de Crédito" que casasse com um PIX de mesmo valor marcaria
              como resolvido um pagamento que ela não explica — e ele sumiria da
              lista de cobrança, que é o pior desfecho possível aqui. */
           case
             -- A pasta do Mercado Livre é de compra no cartão, sempre. Foi um
             -- casamento por valor solto que grudou 16 notas de bebida num
             -- lançamento do "99"; aqui a fonte já diz o lado.
             when fonte = 'drive_mercado_livre' then 'cartao'
             when forma_pagamento ilike '%cart%' then 'cartao'
             when forma_pagamento ilike '%pix%'
               or forma_pagamento ilike '%boleto%'
               or forma_pagamento ilike '%transfer%' then 'pix'
           end as tipo_alvo
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
     where n.tipo_alvo is null or n.tipo_alvo = a.tipo

    union all
    -- 2. documento + janela: o valor não bate, mas quem recebeu é o mesmo
    select n.id, a.tipo, a.id_unico, 'cnpj_data', 'alta', 2
      from n
      join n_doc nd on nd.id = n.id
      join alvos a  on a.doc = nd.doc
                   and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where n.tipo_alvo is null or n.tipo_alvo = a.tipo

    union all
    -- 3. valor + janela apertada
    select nv.id, a.tipo, a.id_unico, 'valor_data', 'media', 3
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 15 and n.enviado_em + 45
     where n.tipo_alvo is null or n.tipo_alvo = a.tipo

    union all
    -- 4. nome + valor
    select nv.id, a.tipo, a.id_unico, 'nome_valor', 'media', 4
      from n_valor nv
      join n on n.id = nv.id
      join alvos a on round(a.valor * 100)::bigint = nv.cents
                  and a.data between n.enviado_em - 45 and n.enviado_em + 60
     where (n.tipo_alvo is null or n.tipo_alvo = a.tipo)
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
  )
  update public.notas_externas nt
     set alvo_tipo     = case when d.quantos = 1 then d.tipo      end,
         alvo_id_unico = case when d.quantos = 1 then d.id_unico  end,
         casamento     = case when d.quantos = 1 then d.casamento end,
         confianca     = case when d.quantos = 1 then d.confianca end,
         -- Empate guarda os cinco primeiros: é o que a pessoa precisa ver para
         -- desempatar, e a lista inteira de um CNPJ mensal seria ruído.
         candidatos    = case when d.quantos > 1
                              then jsonb_build_object('quantos', d.quantos,
                                                      'regra', d.casamento,
                                                      'alvos', (select jsonb_agg(x) from jsonb_array_elements(d.lista) with ordinality t(x, i) where i <= 5))
                         end,
         atualizado_em = now()
    from decisao d
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
                    else coalesce(c.status_nf, '') = 'OK'
                      or coalesce(c.link_comprovante, '') <> ''
               end, false) as ja_tem,
             case when nt2.alvo_tipo = 'pix' then ota.qtd end as anexos
        from public.notas_externas nt2
        left join public.auditoria_pix_lancamentos p
               on nt2.alvo_tipo = 'pix' and p.id_unico = nt2.alvo_id_unico
        left join public.auditoria_cartao_lancamentos c
               on nt2.alvo_tipo = 'cartao' and c.id_unico = nt2.alvo_id_unico
        /* O `id_unico` do PIX É o `nCodTitulo` do Omie — é assim que a semente
           da varredura de anexos já o converteu (migration 20260825140000).

           O cast passa por `nullif(regexp_replace(...))` e NÃO por um
           `~ '^\d+$'` ao lado: numa condição de junção o Postgres não promete
           ordem de avaliação, então o cast pode rodar ANTES do teste e derrubar
           a função inteira no primeiro id não numérico. Assim, o que não é
           número vira NULL e simplesmente não casa. */
        left join public.omie_titulo_anexo ota
               on nt2.alvo_tipo = 'pix'
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
    'em_pix',    (select count(*) from public.notas_externas where alvo_tipo = 'pix'),
    'em_cartao', (select count(*) from public.notas_externas where alvo_tipo = 'cartao')
  ) into v_resumo;

  return v_resumo;
end;
$$;

comment on function public.notas_externas_casar() is
  'Recasa as notas das planilhas com os lançamentos de PIX e cartão e refaz o double check contra o anexo do ERP. Empate não casa.';

/* ============================================================================
 *  2.5. As duas pastas do Drive entram pela mesma porta
 * ========================================================================== */

-- A NF do Mercado Livre e a foto do WhatsApp já eram lidas (`comprovantes_drive`,
-- com DANFE e OCR), mas só chegavam ao CARTÃO: o casamento em TypeScript da
-- `comprovantes-drive-sync` carrega apenas `cartao_lancamentos`, e o gatilho
-- `comprovante_marca_com_nf` só escreve em `auditoria_cartao_lancamentos`. Do
-- lado do PIX, aquelas 144 notas não existiam.
--
-- Em vez de um segundo casador em TypeScript, o que já foi LIDO vira nota aqui e
-- passa pelas mesmas quatro regras. `comprovantes_drive` continua sendo o que
-- sempre foi — o cache do que se leu do Drive, com o carimbo que evita reler os
-- 107 arquivos a cada rodada. O que muda é que a leitura agora tem para onde ir.
--
-- O casamento do cartão NÃO é tocado: lá o memo do OFX é o desempate, e ele não
-- existe aqui. Duas máquinas para dois lados, cada uma com a chave que tem.

create or replace function public.notas_externas_do_drive()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  insert into public.notas_externas (
    chave, fonte, linha, ordem, enviado_em, nome, cnpj, valor,
    o_que_e, detalhe, drive_id, link, diz_anexado, visto_em, atualizado_em
  )
  select 'drive|' || cd.drive_id,
         'drive_' || cd.pasta,
         null, 1,
         cd.data, cd.emitente, cd.cnpj_norm, cd.valor,
         cd.descricao,
         -- O nome do arquivo costuma ser a melhor descrição que existe:
         -- "Kelven Silva - Reparo de Notebooks - 04-08" foi escrito por quem
         -- estava lá, e nenhum OCR chega perto.
         cd.nome_arquivo,
         cd.drive_id,
         'https://drive.google.com/file/d/' || cd.drive_id || '/view',
         false, now(), now()
    from public.comprovantes_drive cd
   where cd.lido_como is not null
     and cd.erro is null
     -- Sem data ou sem valor não há como casar, e entrar assim só encheria a
     -- lista de "sem_alvo" que ninguém consegue resolver.
     and cd.data is not null
     and cd.valor is not null
  on conflict (chave) do update
    set enviado_em = excluded.enviado_em,
        nome       = excluded.nome,
        cnpj       = excluded.cnpj,
        valor      = excluded.valor,
        o_que_e    = excluded.o_que_e,
        detalhe    = excluded.detalhe,
        visto_em   = now(),
        atualizado_em = now();

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.notas_externas_do_drive() is
  'Traz para `notas_externas` o que a comprovantes-drive-sync já leu das duas pastas. Idempotente: a chave é o id do arquivo no Drive.';

/* ============================================================================
 *  3. Ler — para a tela
 * ========================================================================== */

-- A tela do PIX precisa do mapa "lançamento -> nota" para a linha inteira, e
-- não de uma consulta por linha (a lição do `useApelidos`: 50 linhas na tela
-- viram 50 requisições idênticas).
create or replace function public.notas_externas_por_alvo(
  p_alvo_tipo text default 'pix',
  p_referencia text default null
)
returns table(
  alvo_id_unico text, nota_id bigint, fonte text, link text, drive_id text,
  nome text, o_que_e text, detalhe text, valor numeric, enviado_em date,
  competencia text, casamento text, confianca text, conferencia text,
  diz_anexado boolean, status_planilha text, erp_anexos integer,
  fila_erp boolean, enviado_erp_em timestamptz, erro_erp text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nt.alvo_id_unico, nt.id, nt.fonte, nt.link, nt.drive_id,
         nt.nome, nt.o_que_e, nt.detalhe, nt.valor, nt.enviado_em,
         nt.competencia, nt.casamento, nt.confianca, nt.conferencia,
         nt.diz_anexado, nt.status_planilha, nt.erp_anexos,
         nt.fila_erp, nt.enviado_erp_em, nt.erro_erp
    from public.notas_externas nt
    left join public.auditoria_pix_lancamentos p
           on p_alvo_tipo = 'pix' and p.id_unico = nt.alvo_id_unico
    left join public.auditoria_cartao_lancamentos c
           on p_alvo_tipo = 'cartao' and c.id_unico = nt.alvo_id_unico
   where nt.alvo_tipo = p_alvo_tipo
     and nt.ignorado_em is null
     and (p_referencia is null
          or coalesce(p.referencia, c.referencia) = p_referencia)
   order by nt.alvo_id_unico, nt.confianca, nt.id;
$$;

-- O outro lado da mesma pergunta: o que a planilha diz e o ERP desmente.
create or replace function public.notas_externas_achados(
  p_conferencia text default null,
  p_limite integer default 300
)
returns table(
  id bigint, fonte text, linha integer, nome text, cnpj text, valor numeric,
  enviado_em date, competencia text, o_que_e text, link text,
  alvo_tipo text, alvo_id_unico text, alvo_favorecido text, alvo_data date,
  alvo_valor numeric, casamento text, confianca text, conferencia text,
  diz_anexado boolean, status_planilha text, candidatos jsonb,
  fila_erp boolean, enviado_erp_em timestamptz, erro_erp text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nt.id, nt.fonte, nt.linha, nt.nome, nt.cnpj, nt.valor,
         nt.enviado_em, nt.competencia, nt.o_que_e, nt.link,
         nt.alvo_tipo, nt.alvo_id_unico,
         coalesce(p.favorecido, c.estabelecimento) as alvo_favorecido,
         coalesce(p.data, c.data)                  as alvo_data,
         coalesce(abs(p.valor), abs(c.valor))      as alvo_valor,
         nt.casamento, nt.confianca, nt.conferencia, nt.diz_anexado,
         nt.status_planilha, nt.candidatos,
         nt.fila_erp, nt.enviado_erp_em, nt.erro_erp
    from public.notas_externas nt
    left join public.auditoria_pix_lancamentos p
           on nt.alvo_tipo = 'pix' and p.id_unico = nt.alvo_id_unico
    left join public.auditoria_cartao_lancamentos c
           on nt.alvo_tipo = 'cartao' and c.id_unico = nt.alvo_id_unico
   where nt.ignorado_em is null
     and (p_conferencia is null or nt.conferencia = p_conferencia)
   -- A promessa falsa primeiro: é o que ninguém sabia que estava faltando.
   order by case nt.conferencia
              when 'promessa_falsa' then 0 when 'falta_anexar' then 1
              when 'ambiguo' then 2 when 'confere' then 3 else 4 end,
            nt.valor desc nulls last
   -- Teto de 1000 porque é onde o PostgREST corta a resposta SEM AVISAR: pedir
   -- 2000 devolveria 1000 caladas, e uma lista de achados que mente por omissão
   -- é pior do que uma lista curta e honesta.
   limit greatest(1, least(coalesce(p_limite, 300), 1000));
$$;

/* ============================================================================
 *  4. Decidir
 * ========================================================================== */

-- Mandar o arquivo ao ERP é decisão de gente, e por isso é fila e não gatilho:
-- anexo no Omie é difícil de desfazer, e casamento por valor é forte mas não é
-- identidade. Quem consome a fila é a `omie-anexar-comprovante`.
create or replace function public.notas_externas_enfileirar(
  p_ids bigint[]
)
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
     -- Não se manda ao ERP o que o ERP já tem: um anexo por título já basta, e
     -- o duplicado é justamente o que a conferência existe para evitar.
     and conferencia in ('falta_anexar', 'promessa_falsa');
  get diagnostics v_n = row_count;

  /* No CARTÃO a nota também vale localmente, e é o que tira a linha do "SEM NF"
     — mesmíssimo alcance do gatilho `comprovante_marca_com_nf` do Drive, e pelo
     mesmo motivo: lá a coluna guarda o link de onde a nota estiver, e não uma
     afirmação sobre o ERP.

     No PIX não se escreve nada: `tem_comprovante` quer dizer "o Omie tem o
     arquivo", e quem responde isso é o ERP depois do envio. */
  update public.auditoria_cartao_lancamentos a
     set status_nf = 'OK',
         link_comprovante = nt.link,
         arquivo_comprovante = coalesce(a.arquivo_comprovante, nt.fonte || ' · linha ' || nt.linha),
         updated_at = now()
    from public.notas_externas nt
   where nt.id = any(p_ids)
     and nt.alvo_tipo = 'cartao'
     and a.id_unico = nt.alvo_id_unico
     and coalesce(a.status_nf, '') <> 'OK'
     and coalesce(a.link_comprovante, '') = '';

  return v_n;
end;
$$;

-- O desempate que a máquina não faz: a pessoa escolhe entre os candidatos.
create or replace function public.notas_externas_definir_alvo(
  p_id bigint, p_alvo_tipo text, p_alvo_id_unico text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_alvo_tipo not in ('pix', 'cartao') then
    raise exception 'alvo_tipo inválido: %', p_alvo_tipo;
  end if;

  update public.notas_externas
     set alvo_tipo = p_alvo_tipo, alvo_id_unico = p_alvo_id_unico,
         casamento = 'manual', confianca = 'exata',
         alvo_manual = true, candidatos = null, atualizado_em = now()
   where id = p_id and enviado_erp_em is null;

  -- Recalcula só a conferência desta nota, sem recasar as outras 2.300.
  update public.notas_externas nt
     set conferencia = case
           when e.ja_tem then 'confere'
           when nt.diz_anexado then 'promessa_falsa'
           else 'falta_anexar' end,
         erp_anexos = e.anexos, conferido_em = now()
    from (
      select coalesce(
               case when p_alvo_tipo = 'pix'
                    then p.tem_comprovante or coalesce(ota.qtd, 0) > 0
                    else coalesce(c.status_nf, '') = 'OK'
                      or coalesce(c.link_comprovante, '') <> '' end, false) as ja_tem,
             ota.qtd as anexos
        from (select 1) _
        left join public.auditoria_pix_lancamentos p
               on p_alvo_tipo = 'pix' and p.id_unico = p_alvo_id_unico
        left join public.auditoria_cartao_lancamentos c
               on p_alvo_tipo = 'cartao' and c.id_unico = p_alvo_id_unico
        -- Mesmo cuidado do `casar`: o cast vai por `nullif(regexp_replace(...))`,
        -- porque a ordem de avaliação numa junção não é promessa.
        left join public.omie_titulo_anexo ota
               on p_alvo_tipo = 'pix'
              and ota.cod_titulo = nullif(regexp_replace(p_alvo_id_unico, '\D', '', 'g'), '')::bigint
    ) e
   where nt.id = p_id;
end;
$$;

-- "Esta nota não explica pagamento nenhum" — duplicata, nota de cliente, print
-- do lugar errado. Sai da fila e das contas, com o motivo escrito.
create or replace function public.notas_externas_ignorar(
  p_id bigint, p_motivo text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notas_externas
     set ignorado_em = now(), ignorado_motivo = nullif(trim(coalesce(p_motivo, '')), ''),
         fila_erp = false, atualizado_em = now()
   where id = p_id;
$$;

/* ============================================================================
 *  5. Permissões
 * ========================================================================== */

-- Função nova nasce chamável SEM LOGIN, e revogar de `anon` sozinho não resolve:
-- o EXECUTE vem do grant implícito para PUBLIC. Revoga-se dos dois, e cada
-- instrução na sua linha — em bloco, um erro no meio abortaria o resto.
revoke all on function public.notas_externas_do_drive() from public;
revoke all on function public.notas_externas_casar() from public;
revoke all on function public.notas_externas_por_alvo(text, text) from public;
revoke all on function public.notas_externas_achados(text, integer) from public;
revoke all on function public.notas_externas_enfileirar(bigint[]) from public;
revoke all on function public.notas_externas_definir_alvo(bigint, text, text) from public;
revoke all on function public.notas_externas_ignorar(bigint, text) from public;

revoke all on function public.notas_externas_do_drive() from anon;
revoke all on function public.notas_externas_casar() from anon;
revoke all on function public.notas_externas_por_alvo(text, text) from anon;
revoke all on function public.notas_externas_achados(text, integer) from anon;
revoke all on function public.notas_externas_enfileirar(bigint[]) from anon;
revoke all on function public.notas_externas_definir_alvo(bigint, text, text) from anon;
revoke all on function public.notas_externas_ignorar(bigint, text) from anon;

-- Casar é caro e é da esteira: só a Edge Function chama.
grant execute on function public.notas_externas_do_drive() to service_role;
grant execute on function public.notas_externas_casar() to service_role;
grant execute on function public.notas_externas_por_alvo(text, text) to authenticated, service_role;
grant execute on function public.notas_externas_achados(text, integer) to authenticated, service_role;
grant execute on function public.notas_externas_enfileirar(bigint[]) to authenticated, service_role;
grant execute on function public.notas_externas_definir_alvo(bigint, text, text) to authenticated, service_role;
grant execute on function public.notas_externas_ignorar(bigint, text) to authenticated, service_role;
