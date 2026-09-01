-- "2 prontas para subir" e "nada pronto para subir", na mesma tela.
--
-- A aba "Falta um passo" mostrava a faixa verde "2 pronta(s) para subir — use
-- 'Subir o que está pronto' lá em cima"; o botão respondia "Nada pronto para
-- subir: toda nota que o Hub tem já está no ERP". Quem lê as duas frases
-- desconfia da tela inteira, e com razão: as duas estão erradas, cada uma do
-- seu jeito, pelo mesmo motivo — havia TRÊS definições de "pronta" no módulo.
--
--   1. `cap_titulos` — a certa, e é dela que vivem os cartões do topo. Uma nota
--      do acervo só vira `pronta_para_enviar` quando `fila_erp` está ligado;
--      sem isso ela é `espera_confirmacao`. Por isso o topo dizia, corretamente,
--      "o Hub leva sozinho: 1 título · R$ 982" e "achada — falta você
--      confirmar: 8 títulos · R$ 12.860".
--
--   2. `auditoria_envio_quase_la` (aba "Falta um passo") — lia o vínculo no
--      acervo e parava aí: havendo arquivo e alvo, escrevia "pronta para subir"
--      sem olhar `fila_erp`. As duas linhas do caso são boletos casados por
--      valor+data, de confiança média — exatamente o que a fila NÃO leva.
--
--   3. `cap_notas_diagnostico` (aba "Por que falta") — o mesmo buraco, e mais
--      caro: `pronta` era só `tem_arquivo and conferencia in ('falta_anexar',
--      'promessa_falsa')`, o que punha 11 títulos e R$ 13.878 debaixo do rótulo
--      "O Hub leva sozinho — ninguém precisa fazer nada".
--
-- QUEM ENCHE A FILA É GENTE, e é esse o fato que as duas leituras erradas
-- escondiam. `notas_externas_enfileirar` só é chamada das telas (Acervo ›
-- "Mandar ao ERP", a aba PIX da Auditoria, a Caixa de notas); nenhum cron a
-- chama, apesar de o texto do chip "Sobe sozinha" prometer o contrário. Hoje há
-- 8 linhas em "Sobe sozinha" e 1 em "Na fila": a diferença é o clique que
-- ninguém deu. Enquanto `fila_erp` está em `false`, a varredura de anexos não
-- enxerga a linha — `pendentes()` lê `notas_externas` com `fila_erp = true`, e
-- lê `comprovantes_drive` por `cod_titulo`, coluna que parou de ser escrita em
-- 26/08/2026 (0 linhas elegíveis hoje).
--
-- ESTA MIGRAÇÃO NÃO LIGA A FILA SOZINHA. A guarda de `parece_nota` existe para
-- que a máquina não anexe boleto onde se cobra nota fiscal, e é decisão do
-- módulo que casamento por valor+data espere gente. O que ela faz é as duas
-- leituras pararem de prometer o que a fila não cumpre e passarem a nomear o
-- gesto que falta — que é sempre o mesmo: marcar na aba "Acervo de notas" e
-- clicar "Mandar ao ERP".
--
-- De quebra, `auditoria_envio_quase_la` ganha a quinta origem: as notas do
-- acervo que não têm gêmea no Drive. Sem ela, a única linha hoje na fila (a de
-- R$ 982, parada em quarentena depois de 3 tentativas) não aparecia em lugar
-- nenhum desta aba — enquanto o cartão do topo prometia "se uma linha travar,
-- ela aparece em 'Falta um passo' com o motivo".

/* ============================================================================
 *  1. O QUE ESTÁ A UM PASSO — e qual passo, de verdade
 * ========================================================================== */

create or replace function public.auditoria_envio_quase_la(p_limite integer default 300)
returns table(origem text, ref_id text, rotulo text, competencia date, valor numeric,
              tem_comprovante boolean, tem_titulo boolean, ja_enviado boolean, falta text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with uni as (
  /* AS TRÊS ORIGENS DE PORTA DIRETA. A varredura (`pendentes()`) lê estas
     tabelas por conta própria: tendo comprovante, título e nenhum carimbo de
     envio, a linha entra no lote da próxima rodada sem passar por fila nenhuma.
     Por isso `na_fila` é `true` — não é otimismo, é como o envio funciona. */
  select 'auditoria'::text as origem, a.id::text as ref_id,
         coalesce(a.titulo, a.id_unico) as rotulo,
         a.competencia, a.valor,
         coalesce(a.link_comprovante, '') <> ''    as tem_comprovante,
         coalesce(a.omie_cod_titulo, '') <> ''     as tem_titulo,
         a.omie_anexo_enviado_em is not null       as ja_enviado,
         a.status, a.omie_cod_titulo as cod_titulo,
         null::text as acervo,
         true as na_fila, true as pode_enfileirar
  from public.auditoria a
  union all
  select 'cartao', c.id::text,
         coalesce(nullif(c.estabelecimento, ''), c.descricao_original, c.id_unico),
         c.competencia, c.valor,
         coalesce(c.link_comprovante, '') <> '',
         coalesce(c.omie_cod_titulo, '') <> '',
         c.omie_anexo_enviado_em is not null,
         c.status_nf, c.omie_cod_titulo, null::text,
         true, true
  from public.auditoria_cartao_lancamentos c
  union all
  select 'facilities', f.id::text,
         coalesce(nullif(f.item, ''), f.fornecedor_nome, f.id::text),
         f.data, f.valor,
         coalesce(f.nf_arquivo, '') <> '',
         coalesce(f.omie_cod_titulo, '') <> '',
         f.omie_anexo_enviado_em is not null,
         f.nf_status, f.omie_cod_titulo, null::text,
         true, true
  from public.facilities_compras f
  union all
  /* DRIVE — e o vínculo vem do ACERVO, não da coluna morta.
   *
   * `comprovantes_drive.cod_titulo` parou de ser escrito em 26/08/2026. Quem
   * casa o arquivo do Drive desde então é `notas_externas_casar`, sobre a linha
   * gêmea em `notas_externas` — mesmo `drive_id`, mesmo arquivo. Ler daqui é
   * ler o que está vivo.
   *
   * `order by (alvo_tipo is not null) desc`: o mesmo arquivo pode ter mais de
   * uma linha no acervo (chegou por duas fontes). A que tem alvo é a que sabe
   * responder; entre as sem alvo, tanto faz — pega a mais antiga para a lista
   * não mudar de resposta a cada leitura. */
  select 'drive', d.id::text,
         coalesce(nullif(d.emitente, ''), d.nome_arquivo, d.id::text),
         d.data, d.valor,
         coalesce(d.drive_id, '') <> '',
         coalesce(nullif(d.cod_titulo, ''), n.alvo_id_unico) is not null,
         /* JÁ ESTÁ NO OMIE quando o acervo conferiu com o ERP. `conferencia =
            'confere'` é o double check de `notas_externas_casar` contra
            `omie_titulo_anexo` — é o ERP respondendo, não uma promessa nossa. */
         d.omie_anexo_enviado_em is not null or coalesce(n.conferencia, '') = 'confere',
         d.casamento,
         /* Só 'pix' e 'erp' são código de título; 'cartao' aponta para o
            lançamento da fatura, e passá-lo à quarentena casaria com o título
            errado de outra origem. */
         coalesce(nullif(d.cod_titulo, ''),
                  case when n.alvo_tipo in ('pix', 'erp') then n.alvo_id_unico end),
         /* AMBÍGUO COM `devendo = 0` NÃO É TRABALHO. `devendo` é quantos dos
            títulos candidatos ainda estão sem anexo no ERP; em zero, todos já
            têm a nota deles e não há escolha a fazer. */
         case when n.conferencia = 'ambiguo'
                   and coalesce((n.candidatos->>'devendo')::int, -1) = 0
              then 'ambiguo_resolvido' else n.conferencia end,
         /* NA FILA POR UMA DAS DUAS PORTAS, e nenhuma delas se abre sozinha:
            `fila_erp` é o clique de gente em "Mandar ao ERP"; a segunda é o
            ramo do Drive dentro de `pendentes()`, que exige a coluna morta
            `cod_titulo` mais `confianca = 'alta'` (hoje: zero linhas). */
         coalesce(n.fila_erp, false)
           or (coalesce(d.cod_titulo, '') <> '' and d.confianca = 'alta'),
         /* PODE ENFILEIRAR = a guarda de `notas_externas_enfileirar`. Sem ela o
            "marque e clique" viraria conselho falso: a RPC recusaria a linha e
            responderia "0 enfileiradas" sem dizer por quê. */
         coalesce(n.parece_nota, false) or coalesce(n.alvo_manual, false)
  from public.comprovantes_drive d
  left join lateral (
    select ne.alvo_tipo, ne.alvo_id_unico, ne.conferencia, ne.candidatos,
           ne.fila_erp, ne.parece_nota, ne.alvo_manual
      from public.notas_externas ne
     where ne.drive_id = d.drive_id
       and ne.ignorado_em is null
       and ne.copia_de is null
     order by (ne.alvo_tipo is not null) desc, ne.id
     limit 1
  ) n on coalesce(d.drive_id, '') <> ''
  union all
  /* ACERVO — a quinta origem, e a que faltava para o cartão do topo não mentir.
   *
   * As notas de planilha e de e-mail não têm linha em `comprovantes_drive`,
   * então nada nesta aba as via. A linha de R$ 982 que o topo anuncia como "o
   * Hub leva sozinho · sem ação" está na fila desde 27/08 e em quarentena com
   * três tentativas — e não aparecia aqui para dizer isso.
   *
   * O `not exists` evita contar duas vezes o arquivo que veio pelo Drive: esse
   * já é a origem de cima, com o mesmo `drive_id`. */
  select 'acervo', ne.id::text,
         coalesce(nullif(ne.nome, ''), nullif(ne.o_que_e, ''),
                  ne.fonte || coalesce(' linha ' || ne.linha, '')),
         coalesce(ne.vencimento, ne.enviado_em), ne.valor,
         ne.tem_arquivo,
         ne.alvo_id_unico is not null,
         ne.enviado_erp_em is not null or coalesce(ne.conferencia, '') = 'confere',
         null::text,
         ne.alvo_id_unico,
         case when ne.conferencia = 'ambiguo'
                   and coalesce((ne.candidatos->>'devendo')::int, -1) = 0
              then 'ambiguo_resolvido' else ne.conferencia end,
         coalesce(ne.fila_erp, false),
         coalesce(ne.parece_nota, false) or coalesce(ne.alvo_manual, false)
  from public.notas_externas ne
 where ne.alvo_tipo in ('pix', 'erp')
   and ne.alvo_id_unico ~ '^\d+$'
   and ne.ignorado_em is null
   and ne.copia_de is null
   and not exists (
     select 1 from public.comprovantes_drive d2
      where coalesce(ne.drive_id, '') <> '' and d2.drive_id = ne.drive_id)
)
select u.origem, u.ref_id, u.rotulo, u.competencia, u.valor,
       u.tem_comprovante, u.tem_titulo, u.ja_enviado,
       case
         when u.ja_enviado then 'já está no Omie'
         -- A quarentena vem ANTES dos outros diagnósticos: quando ela existe, o
         -- item tem nota e título (senão nem teria sido tentado) e a frase
         -- "pronta para subir" seria mentira — ele não vai subir mais.
         -- `greatest`: cada tentativa escreve 'tentando' e depois 'erro', mas a
         -- marca prévia é recente — nas linhas velhas só existe o 'erro'. Somar
         -- os dois contaria em dobro; o maior é o número honesto.
         when q.cod_titulo is not null
              then 'parou de tentar depois de ' || greatest(q.tentativas, q.erros) || ' tentativas: '
                   || coalesce(q.ultimo_motivo, 'o envio morreu sem deixar motivo')
         /* AMBÍGUO NÃO É "NÃO CASOU", e a diferença é o que alguém faz com a
            linha. "Não casou" manda procurar o título; ambíguo diz que o Hub
            achou mais de um e precisa de uma escolha — que é o trabalho mais
            barato desta tela e mora na aba Acervo. */
         when u.acervo = 'ambiguo_resolvido'
              then 'a nota serve para vários títulos e todos eles já têm nota no Omie — nada a fazer'
         when u.acervo = 'ambiguo'
              then 'a nota serve para mais de um título — falta escolher qual (aba Acervo)'
         when not u.tem_comprovante and not u.tem_titulo
              then 'falta a nota E o vínculo com o título do Omie'
         when not u.tem_comprovante then 'falta a nota (o título já está casado)'
         when not u.tem_titulo      then 'a nota existe, mas o título do Omie não foi casado'
         /* AS DUAS PORTAS QUE FALTAM ABRIR, e é aqui que a aba parou de mentir.
            Nada põe uma nota do acervo na fila sozinho: a varredura só leva o
            que tem `fila_erp`. Quem passa na guarda precisa de um clique; quem
            não passa precisa de um olhar antes do clique.
            A guarda é `parece_nota or alvo_manual` — a CONFIANÇA do casamento
            não entra nela, e dizer "casou por semelhança" aqui seria falso para
            as 7 linhas que casaram por CNPJ e mesmo assim não passam, porque o
            arquivo é boleto. O que as prende é o papel, não o vínculo. */
         when not u.na_fila and u.pode_enfileirar
              then 'a nota está casada e ninguém mandou ao ERP — marque na aba Acervo de notas e clique "Mandar ao ERP"'
         when not u.na_fila
              then 'falta você confirmar no Acervo de notas: o arquivo não tem cara de nota fiscal, e a fila só leva boleto ou recibo depois que alguém carimba que é este documento'
         when u.origem = 'auditoria' and coalesce(u.status, '') <> 'Aprovado'
              then 'a nota está aqui e o título casado — falta aprovar o achado (status: ' || coalesce(nullif(u.status, ''), 'sem status') || ')'
         else 'pronta para subir'
       end as falta
from uni u
left join public.omie_anexo_quarentena q on q.cod_titulo = nullif(u.cod_titulo, '')
where not u.ja_enviado
order by (case when u.tem_comprovante and u.tem_titulo then 0 else 1 end), u.valor desc nulls last
limit greatest(coalesce(p_limite, 300), 1);
$function$;

revoke all on function public.auditoria_envio_quase_la(integer) from anon, public;
grant execute on function public.auditoria_envio_quase_la(integer) to authenticated, service_role;

comment on function public.auditoria_envio_quase_la(integer) is
  'O que está a um passo de virar anexo no Omie, e qual é o passo. "Pronta para subir" agora quer dizer o que a varredura de envio realmente leva: porta direta (auditoria/cartão/facilities) ou `fila_erp` ligado. O que está casado e fora da fila diz o gesto que falta — marcar no Acervo e clicar "Mandar ao ERP" — em vez de prometer um envio que não vem.';

/* ============================================================================
 *  2. O DIAGNÓSTICO — "o Hub leva sozinho" só para o que ele leva mesmo
 * ========================================================================== */

CREATE OR REPLACE FUNCTION public.cap_notas_diagnostico(p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb;
begin
  with t as materialized (
    select c.cod_titulo, c.favorecido, c.favorecido_cru, c.valor, c.categoria,
           c.situacao, c.competencia, c.doc
      from public.cap_titulos c
     where (p_de is null or c.competencia >= p_de)
       and (p_ate is null or c.competencia <= p_ate)
  ),
  /* O que o acervo tem apontado para cada título, e em que estado.
   *
   * `pronta` EXIGE `fila_erp`, como em `cap_titulos`. Sem isso o estágio "O Hub
   * leva sozinho — ninguém precisa fazer nada" cobria 11 títulos e R$ 13.878
   * que nenhuma varredura ia buscar: a fila só se enche por clique de gente.
   * `espera_mandar` é o resto — casado, com arquivo, e parado esperando esse
   * clique. */
  acervo as (
    select nullif(regexp_replace(n.alvo_id_unico, '\D', '', 'g'), '')::bigint as cod_titulo,
           bool_or(n.tem_arquivo and n.conferencia in ('falta_anexar', 'promessa_falsa')
                   and n.fila_erp) as pronta,
           bool_or(n.tem_arquivo and n.conferencia in ('falta_anexar', 'promessa_falsa')
                   and not n.fila_erp) as espera_mandar,
           bool_or(not n.tem_arquivo) as so_registro,
           count(*) as quantas
      from public.notas_externas n
     where n.alvo_tipo in ('pix', 'erp')
       and n.alvo_id_unico ~ '^\d+$'
       and n.ignorado_em is null
       and n.copia_de is null
     group by 1
  ),
  /* Candidatas que reivindicam o título mas empataram — o clique resolve. */
  ambiguas as (
    select nullif(regexp_replace(a.x->>'id_unico', '\D', '', 'g'), '')::bigint as cod_titulo,
           count(*) as quantas
      from public.notas_externas n
      cross join lateral jsonb_array_elements(n.candidatos->'alvos') a(x)
     where n.candidatos is not null
       and n.ignorado_em is null
       and n.tem_arquivo
       and a.x->>'tipo' in ('pix', 'erp')
     group by 1
  ),
  /* Já apareceu ALGUMA coisa desse fornecedor, em qualquer fonte? É o que
     separa "some com a nota" de "nunca mandou nada". */
  conhecido as (
    select distinct nullif(regexp_replace(n.cnpj, '\D', '', 'g'), '') as doc
      from public.notas_externas n
     where n.cnpj is not null and n.tem_arquivo and n.ignorado_em is null
  ),
  classificado as (
    select t.*,
           coalesce(ac.pronta, false) as tem_pronta,
           coalesce(ac.so_registro, false) as tem_so_registro,
           coalesce(am.quantas, 0) as candidatas,
           (bl.id is not null) as fonte_bloqueada,
           bl.motivo as bloqueio_motivo,
           bl.acao as bloqueio_acao,
           (k.doc is not null) as fornecedor_conhecido,
           case
             when t.situacao in ('dispensa', 'com_nota', 'enviado_aguardando') then 'nao_exige'
             when public.aceita_recibo_do_app(coalesce(t.favorecido, t.favorecido_cru)) then 'fornecedor_nao_emite'
             when coalesce(ac.pronta, false) then 'pronta_para_subir'
             /* ESTÁGIO PRÓPRIO, e não um apêndice do empate, porque o trabalho
                é outro: no empate falta ESCOLHER entre títulos; aqui a escolha
                já está feita e falta MANDAR. Cada estágio desta tela leva a um
                lugar diferente quando se clica nele, e dois trabalhos no mesmo
                cartão levariam metade das pessoas ao lugar errado. */
             when coalesce(ac.espera_mandar, false) then 'falta_mandar'
             when coalesce(am.quantas, 0) > 0 then 'espera_um_clique'
             when bl.id is not null then 'achou_mas_nao_abre'
             when coalesce(ac.so_registro, false) then 'achou_mas_nao_abre'
             else 'nunca_apareceu'
           end as estagio
      from t
      left join acervo ac on ac.cod_titulo = t.cod_titulo
      left join ambiguas am on am.cod_titulo = t.cod_titulo
      left join conhecido k on k.doc = nullif(regexp_replace(t.doc, '\D', '', 'g'), '')
      left join lateral (
        select b.id, b.motivo, b.acao
          from public.nota_fonte_bloqueada b
         where b.resolvido_em is null
           and public.normaliza_nome(coalesce(t.favorecido, t.favorecido_cru, ''))
                 like '%' || public.normaliza_nome(b.padrao_nome) || '%'
         limit 1
      ) bl on true
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'gerado_em', now(),
    'total', jsonb_build_object(
      'titulos', (select count(*) from classificado),
      'valor', (select coalesce(round(sum(valor)), 0) from classificado)),
    'estagios', (
      select coalesce(jsonb_agg(x order by x->>'valor' desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'estagio', estagio,
                 'titulos', count(*),
                 'valor', round(sum(valor)),
                 /* Os cinco maiores de cada estágio: é o que a IA cita e o que
                    a pessoa reconhece. Nome, não código. */
                 'maiores', (
                   select jsonb_agg(jsonb_build_object(
                            'favorecido', f.favorecido, 'titulos', f.n, 'valor', round(f.v)))
                     from (select coalesce(c2.favorecido, '(sem nome)') as favorecido,
                                  count(*) n, sum(c2.valor) v
                             from classificado c2
                            where c2.estagio = c.estagio
                            group by 1 order by sum(c2.valor) desc limit 5) f)
               ) as x
          from classificado c
         where estagio <> 'nao_exige'
         group by estagio
      ) g),
    'bloqueios', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'fornecedor', b.padrao_nome, 'motivo', b.motivo, 'acao', b.acao,
               'titulos', coalesce(q.n, 0), 'valor', coalesce(round(q.v), 0))), '[]'::jsonb)
        from public.nota_fonte_bloqueada b
        left join lateral (
          select count(*) n, sum(c.valor) v from classificado c
           where c.estagio = 'achou_mas_nao_abre'
             and public.normaliza_nome(coalesce(c.favorecido, c.favorecido_cru, ''))
                   like '%' || public.normaliza_nome(b.padrao_nome) || '%'
        ) q on true
       where b.resolvido_em is null),
    /* O acervo tem arquivo que NÃO achou dono. É o outro lado do problema:
       nota sobrando enquanto título falta. */
    'acervo_sem_dono', (
      select jsonb_build_object(
        'notas', count(*), 'com_valor', count(*) filter (where valor is not null))
        from public.notas_externas
       where tem_arquivo and parece_nota and alvo_tipo is null
         and ignorado_em is null and copia_de is null),
    'leitura', (
      select jsonb_build_object(
        'sem_valor_com_arquivo', count(*) filter (where tem_arquivo and valor is null),
        'pdf_sem_texto', count(*) filter (where leitura_erro like 'PDF sem texto%'),
        'em_moeda_estrangeira', count(*) filter (where valor_moeda is not null))
        from public.notas_externas where ignorado_em is null and copia_de is null),
    /* A COTAÇÃO QUE A FATURA DE CARTÃO REVELOU.
       Isto aqui é o que a IA precisa para responder "por que este título ainda
       não fechou" com uma conta em vez de um adjetivo: quantos títulos
       corroboram a cotação, quão apertado ficou o espalhamento, e quantos
       casaram por SOMA de duas invoices. Ver 20260827280000. */
    'cambio_lote', jsonb_build_object(
      'lotes', (select coalesce(jsonb_agg(jsonb_build_object(
                         'fornecedor', quem, 'data', data, 'moeda', moeda,
                         'taxa', round(taxa, 4),
                         'titulos_corroborando', titulos,
                         'espalhamento_pct', round(espalhamento * 100, 3))
                       order by titulos desc), '[]'::jsonb)
                  from public.nota_taxa_do_lote),
      /* TÍTULO e NOTA são coisas diferentes, e a IA leu `notas_casadas`
         como se fossem títulos: escreveu "explicou 7 títulos" quando eram
         7 notas em 6 títulos (um deles fechou com DUAS invoices somadas).
         O número que ela quer citar é este, e agora ele tem nome. */
      'titulos_explicados', (select count(distinct alvo_id_unico) from public.notas_externas
                              where casamento in ('cambio_lote', 'cambio_lote_soma')),
      'notas_casadas', (select count(*) from public.notas_externas
                         where casamento in ('cambio_lote', 'cambio_lote_soma')),
      'por_soma_de_duas', (select count(*) from public.notas_externas
                            where casamento = 'cambio_lote_soma'))
  ) into v;

  return v;
end;
$function$;

comment on function public.cap_notas_diagnostico(date, date) is
  'O sinal da aba "Por que falta". `pronta_para_subir` (o rótulo "O Hub leva sozinho") exige `fila_erp`, como em `cap_titulos`: o que está casado e fora da fila cai no estágio novo `falta_mandar`, porque é exatamente isso que falta — marcar no Acervo e clicar "Mandar ao ERP".';
