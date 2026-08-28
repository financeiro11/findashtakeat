-- A NOTA QUE NINGUÉM ABRIU — e o espelho congelado que jurava que ela não casou
--
-- A aba "Falta um passo" mostrava 327 linhas do Drive, R$ 837 mil, TODAS com a
-- mesma frase: "a nota existe, mas o título do Omie não foi casado". Uma frase
-- só para 327 casos já é sinal de que ninguém está olhando caso nenhum — e a
-- medição de 27/08/2026 confirmou:
--
--   • 71 delas (R$ 146 mil) **já estão dentro do Omie**. O acervo casou, enviou
--     e o ERP confirmou o anexo. A tela pedia trabalho que já tinha sido feito.
--   •  6 estão casadas e só esperando a fila.
--   • 87 são ambíguas de verdade — o acervo achou mais de um título possível.
--   • 131 não acharam alvo, e 32 nem existem no acervo.
--
-- A CAUSA É QUE `comprovantes_drive` É UM ESPELHO CONGELADO. A última linha
-- entrou em 26/08/2026, quando `notas_externas` (o acervo) assumiu as pastas do
-- Drive. Desde então a coluna `cod_titulo` dessa tabela não é preenchida por
-- ninguém: das 344 linhas, 281 não têm sequer `casamento` gravado. A lista lia
-- essa coluna morta e chamava o silêncio dela de "não foi casado".
--
-- ESTA MIGRATION FAZ A LINHA DO DRIVE PERGUNTAR AO ACERVO. O vínculo e o
-- desfecho passam a vir do gêmeo em `notas_externas` (mesmo `drive_id`), que é
-- quem está vivo. O que já está no Omie sai da lista; o que o acervo casou
-- aparece como pronto; o ambíguo diz que é ambíguo e para onde ir.
--
-- ---------------------------------------------------------------------------
-- E O CASAMENTO EM SI? Está no conserto irmão, em `nota-ler-arquivo`: a fila de
-- leitura era `valor is null` e tinha TRÊS linhas, enquanto 1.531 notas com
-- arquivo no bucket nunca foram abertas — todas com valor, nenhuma com CNPJ ou
-- chave fiscal. Sem identidade o casador só alcança valor+data, e aí fornecedor
-- mensal de valor fixo é irresolvível por construção: as cinco notas de
-- R$ 13.139 da F. Dutra disputavam os três títulos de R$ 13.139 e todas saíam
-- `ambiguo`. Lido UM arquivo (o 27026), veio CNPJ 31565399000181, documento
-- 00003138 e `tipo_documento='nota'`. O valor é o que empata; o CNPJ é o que
-- separa. Aqui embaixo o cron dessa leitura passa de horário para 5 em 5
-- minutos, que é o que faz a fila de 1.531 andar em dias e não em meses.

create or replace function public.auditoria_envio_quase_la(p_limite integer default 300)
returns table(origem text, ref_id text, rotulo text, competencia date, valor numeric,
              tem_comprovante boolean, tem_titulo boolean, ja_enviado boolean, falta text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with uni as (
  select 'auditoria'::text as origem, a.id::text as ref_id,
         coalesce(a.titulo, a.id_unico) as rotulo,
         a.competencia, a.valor,
         coalesce(a.link_comprovante, '') <> ''    as tem_comprovante,
         coalesce(a.omie_cod_titulo, '') <> ''     as tem_titulo,
         a.omie_anexo_enviado_em is not null       as ja_enviado,
         a.status, a.omie_cod_titulo as cod_titulo,
         null::text as acervo
  from public.auditoria a
  union all
  select 'cartao', c.id::text,
         coalesce(nullif(c.estabelecimento, ''), c.descricao_original, c.id_unico),
         c.competencia, c.valor,
         coalesce(c.link_comprovante, '') <> '',
         coalesce(c.omie_cod_titulo, '') <> '',
         c.omie_anexo_enviado_em is not null,
         c.status_nf, c.omie_cod_titulo, null::text
  from public.auditoria_cartao_lancamentos c
  union all
  select 'facilities', f.id::text,
         coalesce(nullif(f.item, ''), f.fornecedor_nome, f.id::text),
         f.data, f.valor,
         coalesce(f.nf_arquivo, '') <> '',
         coalesce(f.omie_cod_titulo, '') <> '',
         f.omie_anexo_enviado_em is not null,
         f.nf_status, f.omie_cod_titulo, null::text
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
            `omie_titulo_anexo` — é o ERP respondendo, não uma promessa nossa.
            São as 71 linhas que a tela mandava alguém resolver de novo. */
         d.omie_anexo_enviado_em is not null or coalesce(n.conferencia, '') = 'confere',
         d.casamento,
         /* Só 'pix' e 'erp' são código de título; 'cartao' aponta para o
            lançamento da fatura, e passá-lo à quarentena casaria com o título
            errado de outra origem. */
         coalesce(nullif(d.cod_titulo, ''),
                  case when n.alvo_tipo in ('pix', 'erp') then n.alvo_id_unico end),
         /* AMBÍGUO COM `devendo = 0` NÃO É TRABALHO. `devendo` é quantos dos
            títulos candidatos ainda estão sem anexo no ERP; em zero, todos já
            têm a nota deles e não há escolha a fazer — mandar alguém escolher
            entre quatro títulos resolvidos é o mesmo desperdício das 71 linhas
            de cima, só que disfarçado de tarefa. São 18 das 87 do Drive. */
         case when n.conferencia = 'ambiguo'
                   and coalesce((n.candidatos->>'devendo')::int, -1) = 0
              then 'ambiguo_resolvido' else n.conferencia end
  from public.comprovantes_drive d
  left join lateral (
    select ne.alvo_tipo, ne.alvo_id_unico, ne.conferencia, ne.candidatos
      from public.notas_externas ne
     where ne.drive_id = d.drive_id
       and ne.ignorado_em is null
       and ne.copia_de is null
     order by (ne.alvo_tipo is not null) desc, ne.id
     limit 1
  ) n on coalesce(d.drive_id, '') <> ''
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
  'O que está a um passo de virar anexo no Omie, e qual é o passo. A linha do Drive lê o vínculo no ACERVO (`notas_externas`, mesmo `drive_id`) e não em `comprovantes_drive.cod_titulo`, que parou de ser escrito em 26/08/2026 — era daí que vinham 327 linhas dizendo "não foi casado", 71 delas sobre notas que já estavam dentro do ERP.';

/* ============================================================================
 *  A LEITURA PRECISA DE RITMO
 * ==========================================================================
 * De hora em hora, com 25 por rodada, a fila de 1.531 nunca andaria: PDF
 * escaneado gasta ~50 s de Gemini por arquivo e o orçamento da função é 55 s —
 * na prática UM arquivo por rodada, 24 por dia, dois meses para drenar. De 5 em
 * 5 minutos são 12 rodadas por hora e a fila anda em dias.
 *
 * O teto é a própria fila: quando ela esvazia, a rodada volta vazia e não custa
 * nada. Não há risco de sobreposição — a rodada morre no orçamento de 55 s e a
 * seguinte só sai 5 minutos depois. */

select cron.unschedule('nota-ler-arquivo')
 where exists (select 1 from cron.job where jobname = 'nota-ler-arquivo');

select cron.schedule('nota-ler-arquivo', '*/5 * * * *', $cron$
  select public.disparar_automacao(
    'nota-ler-arquivo',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/nota-ler-arquivo',
    '{"limite":25}'::jsonb,
    'nota-ler-arquivo',
    '{}'::jsonb
  );
$cron$);
