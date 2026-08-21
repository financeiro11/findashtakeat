/* ---------------------------------------------------------------------------
 * Auditoria da emissão — o que NÃO vira nota, e por quê.
 *
 * A PERGUNTA. O painel do mês responde "esta cobrança tem nota?". Esta função
 * responde a pergunta anterior, que é a que tira o sono: "existe cobrança que
 * nunca vai virar nota e ninguém vai ficar sabendo?".
 *
 * POR QUE ELA PRECISA EXISTIR. A fila da emissão automática
 * (`notas_fiscais_fila_emissao`) é montada com dois INNER JOIN:
 *
 *     join cli      on cli.id_asaas = cob.cus     -- cliente no espelho do Asaas
 *     join omie_cli on oc.doc       = cli.doc     -- MESMO CNPJ cadastrado no Omie
 *
 * Um `join` que não casa não devolve erro: devolve ausência. A cobrança de um
 * cliente que não existe no Omie por CNPJ simplesmente não aparece na fila, não
 * aparece no log de emissões (que só registra o que foi tentado) e não aparece em
 * lugar nenhum. Ela não falha — ela some. Medido em mai–ago/26: 241 cobranças,
 * R$ 117,6 mil, 101 clientes.
 *
 * OS DOIS TIPOS DE FALTA NÃO TÊM O MESMO CONSERTO, e é por isso que a auditoria
 * os separa em vez de somar num "sem cadastro":
 *
 *   • `sem_cadastro_omie` — não há nada parecido no Omie. Falta cadastrar.
 *   • `cadastro_divergente` — existe cliente com o MESMO NOME e OUTRO documento.
 *     "Japamania - Vila Food" é 60.908.386/0003-28 no Asaas e 52.662.815/0001-30
 *     no Omie; "Pizza.com - Loja 01" tem CNPJ num sistema e CPF no outro. Aqui
 *     cadastrar de novo é o conserto ERRADO — cria cliente duplicado e emite nota
 *     para o tomador errado, que é pior do que não emitir. Alguém precisa decidir
 *     qual documento é o verdadeiro.
 *
 * A CLASSIFICAÇÃO É UMA PARTIÇÃO: todo pagamento do período cai em exatamente um
 * balde, e a soma dos baldes é o total. É isso que faz disto auditoria e não
 * relatório — não há resto, não há linha que escapou da conta.
 *
 * O DESFECHO VEM DO PAINEL, de propósito. Os baldes "já tem nota", "rejeitada" e
 * "em processamento" saem de `notas_fiscais_painel`, a mesma função que desenha a
 * tela. Reescrever a regra aqui criaria dois lugares para a verdade divergir, e o
 * dia em que divergissem a auditoria estaria dizendo que está tudo bem enquanto o
 * painel mostra o contrário. O que esta função ACRESCENTA é o eixo de cadastro,
 * que o painel não tem.
 *
 * SÃO DUAS CONTAS, E ELAS NÃO DÃO O MESMO NÚMERO. Esta função devolve as duas
 * porque medir só uma engana:
 *
 *   `baldes`    — a partição do que ACONTECEU. Enquanto o Asaas ainda emite, a
 *                 cobrança de um cliente sem cadastro no Omie cai em `nota_asaas`:
 *                 ela tem nota, o buraco está tapado. Em jul/26 isso reduz o
 *                 problema a 20 cobranças.
 *   `prontidao` — a previsão de quando o Asaas parar. Mede o eixo de cadastro
 *                 sobre TODA cobrança recebida do período, sem descontar quem
 *                 estava coberto: "se o Omie tivesse de emitir todas, quantas
 *                 sairiam?". É esta conta que enxerga os 101 clientes, e é ela que
 *                 tem de zerar antes do corte.
 *
 * A diferença entre as duas é exatamente o tamanho da surpresa marcada para o dia
 * do corte. Contar só `baldes` hoje é ler "está quase tudo certo" na véspera.
 * ------------------------------------------------------------------------- */

/* `security definer`, e não invoker como as irmãs desta família — porque
 * `omie_cache` tem RLS LIGADO E NENHUMA POLICY.
 *
 * Isso nunca incomodou ninguém: quem lê o cache do Omie são as Edge Functions,
 * com a service role, que passa por cima de RLS. Esta é a primeira função de tela
 * a lê-lo, e como `invoker` ela devolvia zero linha para o usuário logado —
 * medido: `cadastro_omie_qtd: 0` e os 2.387 clientes do mês inteiro classificados
 * como "sem cadastro no Omie". Uma auditoria que grita que está tudo errado é pior
 * do que auditoria nenhuma: some no meio do falso alarme o que de fato falta.
 *
 * A alternativa era abrir `omie_cache` para `authenticated` com uma policy, mas
 * ali dentro moram também os movimentos financeiros — abrir a tabela inteira para
 * resolver a leitura de uma chave é largo demais. Definer restringe a exceção a
 * esta função, que é `stable`, não escreve nada, não monta SQL dinâmico e tem o
 * `search_path` fixo. O que ela devolve são nomes e documentos de cliente, que
 * quem abre a página já vê no painel do mês. */
create or replace function public.notas_fiscais_auditoria(p_de date, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with cfg as (
  select data_corte from public.nf_config where id = 1
),

/* O cadastro do Omie achatado uma vez só. `materialized` não é enfeite: a busca
 * por nome semelhante roda num lateral por cliente faltante, e sem isto o
 * Postgres reexpande o jsonb de 6.881 clientes a cada iteração.
 *
 * `nome_norm` é pré-calculado pelo mesmo motivo: com `unaccent()` dentro do
 * lateral, ele era chamado ~2 milhões de vezes e a função levava 8 segundos. */
omie_clientes as materialized (
  select (c->>'codigo')::bigint                                    as codigo,
         coalesce(c->>'nome', '')                                  as nome,
         lower(unaccent(coalesce(c->>'nome', '')))                 as nome_norm,
         regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D','','g')   as doc,
         -- A raiz do CNPJ como COLUNA, não como expressão dentro do join. Escrito
         -- `left(o.doc,8) = left(f.doc,8)` o planejador não reconhece igualdade e
         -- cai num laço aninhado de 475 mil comparações; como coluna, vira hash.
         case when length(regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D','','g')) = 14
              then left(regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D','','g'), 8) end as raiz8
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
),
-- Documento → cadastro. `count(*)` porque documento repetido no Omie é sinal
-- próprio: a emissão pega o menor código e pode faturar contra a ficha errada.
omie_doc as (
  select doc, min(codigo) as codigo, count(*) as cadastros
  from omie_clientes where doc <> '' group by doc
),

/* PALAVRAS DO NOME, para não comparar todo mundo com todo mundo.
 *
 * Medir semelhança de nome entre ~100 clientes faltantes e 6.881 cadastros são
 * 688 mil comparações de trigrama, e isso sozinho custava ~5 segundos numa aba
 * que se abre para dar uma olhada. O corte: só entram no páreo os cadastros que
 * dividem ao menos UMA palavra distintiva com o faltante.
 *
 * "Distintiva" tem de excluir as palavras que todo restaurante tem. "pizzaria",
 * "burger", "delivery" aparecem em centenas de cadastros e ligariam qualquer um a
 * qualquer um — foi assim que a versão sem corte pareou "Sushi Uai Delivery" com
 * "Ken sushi- Delivery" e "Piemonte Restaurante e Pizzaria" com "Raiz pizzaria e
 * restaurante". Conferido contra a varredura completa em jul/26: dos 70 clientes,
 * 67 pareiam igual e os 3 que se perdem são exatamente esses palpites errados. O
 * corte ficou mais rápido E mais certo. */
omie_tok as materialized (
  select o.codigo, t.tok
  from omie_clientes o,
       lateral unnest(string_to_array(regexp_replace(o.nome_norm, '[^a-z0-9]+', ' ', 'g'), ' ')) t(tok)
  where length(t.tok) >= 4
),
tok_comum as materialized (
  select tok from omie_tok group by tok having count(*) > 40
),

base as (
  select * from public.notas_fiscais_painel(p_de, p_ate)
),

avaliada as materialized (
  select
    b.*,
    coalesce(b.data_pagamento, b.data_vencimento) as competencia,
    od.codigo    as n_cod_cli,
    od.cadastros as cadastros_no_omie,
    /* A guarda anti-duplicata da fila, reproduzida: documento + valor + mês de
     * faturamento. Ela é deliberadamente frouxa (falso positivo segura emissão
     * legítima, falso negativo recolhe imposto duas vezes), e justamente por ser
     * frouxa precisa ser contada — é o único balde onde "barrada" pode querer
     * dizer "barrada à toa". */
    exists (
      select 1 from public.nf_os_omie o2
      where o2.cancelada = false and o2.nfse_status = '004'
        and o2.cnpj_cpf = b.cnpj_cpf and o2.valor = b.valor
        and date_trunc('month', o2.data_faturamento)
            = date_trunc('month', coalesce(b.data_pagamento, b.data_vencimento))
    ) as sombra
  from base b
  left join omie_doc od on od.doc = b.cnpj_cpf
),

/* O universo da PRONTIDÃO: toda cobrança que vai precisar de nota quando o Omie
 * for o único emissor. Recebida e não estornada — sem olhar quem emitiu antes,
 * que é justamente o que o corte vai tirar de campo. */
exigivel as materialized (
  select * from avaliada
  where status_asaas in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') and not estornado
),

/* Os clientes que a fila perderia, com o nome parecido que existe no Omie.
 *
 * `cnpj_cpf is null` significa cliente ausente do ESPELHO do Asaas (a cobrança
 * aponta para um `cus_` que a carga local não tem) — buraco de espelho, não de
 * cadastro, e por isso fica de fora daqui e ganha classe própria na prontidão.
 * Cliente que existe no espelho sem documento devolve string vazia, nunca null. */
faltantes as materialized (
  select cnpj_cpf as doc,
         case when length(cnpj_cpf) = 14 then left(cnpj_cpf, 8) end as raiz8,
         max(coalesce(cliente_asaas,'')) as nome,
         lower(unaccent(max(coalesce(cliente_asaas,'')))) as nome_norm,
         count(*)                        as cobrancas,
         sum(valor)                      as valor,
         max(competencia)                as ultima,
         -- Quantas destas o Asaas já cobriu. É o que diz se o cliente é problema
         -- só a partir do corte ou se já está sem nota hoje.
         count(*) filter (where situacao = 'falta') as sem_nota_hoje
  from exigivel
  where length(coalesce(cnpj_cpf,'')) in (11, 14)
    and n_cod_cli is null
  group by cnpj_cpf
),

/* Quem disputa o pareamento de cada faltante: quem divide palavra distintiva —
 * ou quem tem o nome EXATAMENTE igual.
 *
 * O segundo braço não é redundância. "Pizza.com - Loja 01" existe nos dois
 * sistemas com o nome idêntico, e todas as suas palavras ("pizza", "loja") são
 * comuns demais para sobreviver ao corte: sem esta linha, o par mais óbvio do
 * conjunto seria o único a escapar.
 *
 * `materialized` é obrigatório aqui. Esta CTE é referenciada UMA vez — de dentro
 * do lateral logo abaixo —, e uma referência só é o caso em que o Postgres
 * embute a CTE na consulta. Embutida, ela recalcula a junção de palavras inteira
 * a cada cliente faltante: eram 3,7 s de função contra 0,4 s materializada. */
candidato as materialized (
  select distinct tf.doc, ot.codigo
  from (
    select f.doc, t.tok
    from faltantes f,
         lateral unnest(string_to_array(regexp_replace(f.nome_norm, '[^a-z0-9]+', ' ', 'g'), ' ')) t(tok)
    where length(t.tok) >= 4
  ) tf
  join omie_tok ot on ot.tok = tf.tok
  where tf.tok not in (select tok from tok_comum)
  union
  select f.doc, o.codigo
  from faltantes f join omie_clientes o on o.nome_norm = f.nome_norm
  where f.nome_norm <> ''
),
/* O cadastro do Omie que provavelmente É este cliente, por dois caminhos — e a
 * ordem entre eles importa.
 *
 * PRIMEIRO A RAIZ DO CNPJ. "Top Mix" é 37.372.287/0002-71 no Asaas e
 * 37.372.287/0001-90 no Omie: mesma empresa, OUTRA FILIAL. Os oito primeiros
 * dígitos são a raiz e não se repetem entre empresas, então isto é quase certeza,
 * enquanto nome parecido é palpite. E é o caso mais perigoso do conjunto: o
 * cadastro existe, o nome bate, e emitir contra ele põe a nota no
 * estabelecimento errado — erro que passa despercebido justamente por parecer
 * certo.
 *
 * DEPOIS O NOME. Fica para quando nem a raiz casa: "Japamania - Vila Food" é
 * 60.908.386/0003-28 no Asaas e 52.662.815/0001-30 no Omie — CNPJ inteiramente
 * diferente sob o mesmo nome. Aqui não há como o sistema saber qual é o
 * verdadeiro; ele só aponta a coincidência para alguém decidir. */
/* Os pares em disputa, com os campos do cadastro E a semelhança já calculada.
 *
 * Duas coisas foram trazidas para cá porque no lateral elas custavam caro:
 *   • nome/doc do cadastro — sem isto o lateral teria de rejuntar `omie_clientes`
 *     e voltaria a varrer os 6.881 a cada cliente faltante;
 *   • `sim` — dentro do lateral, `similarity()` aparecia no filtro E duas vezes no
 *     `order by`, ou seja três vezes por par examinado: 220 mil chamadas contra as
 *     ~900 de agora. Era o grosso dos 3,6 s.
 * Junto com o `raiz8` pré-calculado (que transforma o laço aninhado em hash), é o
 * que põe a função abaixo de meio segundo. */
par as materialized (
  select f.doc as f_doc, o.codigo, o.nome, o.doc, true as raiz,
         similarity(o.nome_norm, f.nome_norm) as sim
  from faltantes f
  join omie_clientes o on o.raiz8 = f.raiz8
  union all
  select f.doc, o.codigo, o.nome, o.doc, false,
         similarity(o.nome_norm, f.nome_norm)
  from candidato c
  join faltantes f     on f.doc = c.doc
  join omie_clientes o on o.codigo = c.codigo
),
pareado as materialized (
  select f.*, m.nome as omie_nome, m.doc as omie_doc,
         round(m.sim::numeric, 2) as forca,
         case when m.doc is null then null when m.raiz then 'raiz' else 'nome' end as via
  from faltantes f
  left join lateral (
    select p.nome, p.doc, p.raiz, p.sim
    from par p
    where p.f_doc = f.doc
      and (p.raiz or p.sim > 0.55)
    order by p.raiz desc, p.sim desc, p.codigo
    limit 1
  ) m on true
),

/* A partição. A ordem da cascata é a ordem da gravidade, e cada degrau só vê o
 * que os de cima não pegaram. */
classificada as materialized (
  select a.*,
    case
      when a.situacao = 'nota_a_cancelar'   then 'nota_a_cancelar'
      when a.estornado                      then 'estornada'
      when a.situacao = 'nao_exige'         then 'nao_exige'
      when a.situacao = 'emitida_omie'      then 'nota_omie'
      when a.situacao = 'emitida_asaas'     then 'nota_asaas'
      when a.situacao = 'nota_rejeitada'    then 'nota_rejeitada'
      when a.situacao = 'em_processamento'  then 'em_processamento'
      -- Daqui para baixo é 'falta': recebida, sem nota em sistema nenhum.
      when a.cnpj_cpf is null               then 'sem_cliente'
      when length(a.cnpj_cpf) not in (11,14) then 'sem_documento'
      when a.n_cod_cli is null and p.omie_doc is not null then 'cadastro_divergente'
      when a.n_cod_cli is null              then 'sem_cadastro_omie'
      when a.sombra                         then 'sombra'
      when a.status_asaas = 'CONFIRMED'     then 'aguardando_liquidar'
      when a.competencia < (select data_corte from cfg) then 'antes_do_corte'
      else 'fila'
    end as balde
  from avaliada a
  left join pareado p on p.doc = a.cnpj_cpf
)

select jsonb_build_object(
  'meta', jsonb_build_object(
    'de', p_de,
    'ate', p_ate,
    'corte', (select data_corte from cfg),
    'corte_vigente', p_ate >= (select data_corte from cfg),
    'cadastro_omie_em',  (select atualizado_em from public.omie_cache where chave = 'clientes'),
    'cadastro_omie_qtd', (select count(*) from omie_clientes),
    -- Documento repetido no cadastro do Omie: a emissão escolhe o menor código
    -- e ninguém é avisado de que havia outro.
    'docs_duplicados',   (select count(*) from omie_doc where cadastros > 1),
    'total_cobrancas',   (select count(*) from classificada),
    'total_valor',       (select coalesce(round(sum(valor)::numeric, 2), 0) from classificada)
  ),
  'baldes', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'balde', balde, 'cobrancas', n, 'valor', round(v::numeric, 2)
           ) order by balde), '[]'::jsonb)
    from (select balde, count(*) as n, sum(valor) as v from classificada group by balde) t
  ),
  /* A previsão. Mesmo universo (cobrança recebida do período), medido só pelo
   * eixo de cadastro — o que o corte vai passar a exigir. */
  'prontidao', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'classe', classe, 'cobrancas', n, 'valor', round(v::numeric, 2),
             'clientes', c
           ) order by classe), '[]'::jsonb)
    from (
      select case
               when e.cnpj_cpf is null                 then 'sem_cliente'
               when length(e.cnpj_cpf) not in (11,14)  then 'sem_documento'
               when e.n_cod_cli is not null            then 'ok'
               when p.omie_doc is not null             then 'cadastro_divergente'
               else 'sem_cadastro_omie'
             end as classe,
             count(*) as n, sum(e.valor) as v, count(distinct e.cnpj_cpf) as c
      from exigivel e left join pareado p on p.doc = e.cnpj_cpf
      group by 1
    ) t
  ),
  'clientes', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'doc', doc, 'nome', nome,
             'cobrancas', cobrancas, 'valor', round(valor::numeric, 2), 'ultima', ultima,
             'sem_nota_hoje', sem_nota_hoje,
             'classe', case when omie_doc is not null then 'cadastro_divergente' else 'sem_cadastro_omie' end,
             'omie_nome', omie_nome, 'omie_doc', omie_doc, 'forca', forca, 'via', via
           ) order by valor desc), '[]'::jsonb)
    from pareado
  )
);
$$;

comment on function public.notas_fiscais_auditoria(date, date) is
  'Partição de todas as cobranças do período pelo motivo de terem ou não virado NFS-e, '
  'com o eixo de cadastro (cliente do Asaas ausente ou divergente no Omie) que a fila '
  'de emissão descarta em silêncio.';

-- Função nova em `public` nasce chamável sem login pelo grant automático do
-- Supabase, e esta lê faturamento cliente a cliente.
revoke all on function public.notas_fiscais_auditoria(date, date) from public, anon;
grant execute on function public.notas_fiscais_auditoria(date, date) to authenticated, service_role;
