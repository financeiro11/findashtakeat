/* ============================================================================
 * O chat da célula deixa de só explicar e passa a consertar.
 *
 * Até aqui a pergunta na célula da DRE/DFC (migration 20260806210000) era um
 * beco: a IA lia os lançamentos, dizia o que via, e a correção continuava sendo
 * um segundo gesto noutro lugar — abrir o drill-down, achar a linha, trocar a
 * categoria no lápis. Quem já sabia a resposta ("isso é da Paytime, é markup")
 * escrevia a pergunta só para receber de volta o que já sabia.
 *
 * O QUE FALTAVA, e é a razão desta migration: o chat enxergava só a PRÓPRIA
 * rubrica. Quando alguém diz "certamente tem receita financeira aqui, é da
 * Paytime", a célula quase sempre está ZERADA — o lançamento existe, mas caiu
 * noutra linha. Procurar dentro da célula é procurar onde sabidamente não está.
 *
 * Três peças:
 *   1. `demonstracoes_lancamentos_busca()` — procura por NOME no mês inteiro,
 *      atravessando rubricas, e inclusive fora do DE-PARA (é lá que se esconde
 *      o lançamento que sumiu da demonstração).
 *   2. `demonstracoes_perguntas.acao` — a proposta de correção que a IA montou,
 *      guardada ao lado da resposta com o estado dela. Proposta não é execução:
 *      quem aplica é a pessoa, num clique, e o que aconteceu fica registrado.
 *   3. `tarefa_fechamento_subtarefa()` — quando a correção não é nossa, ela vira
 *      subtarefa de UM card "Fechamento", e não mais um card solto no kanban.
 *
 * A ESCRITA NO OMIE NÃO MORA AQUI. Continua inteira em `omie-trocar-categoria`
 * (altera no ERP → confirma → espelha no cache → grava trilha). Este arquivo só
 * dá à IA o que procurar e onde guardar a proposta; o caminho que mexe no ERP
 * é o mesmo do lápis do drill-down, com a mesma trilha em
 * `omie_categoria_alteracoes`. Uma segunda porta para o ERP seria uma segunda
 * cópia daquela regra — e a que diverge é sempre a que ninguém está olhando.
 * ========================================================================== */


/* ============================================================
 *  1) Procurar um nome no mês inteiro, atravessando rubricas
 * ============================================================
 * Irmã de `demonstracoes_lancamentos_multi`: mesmo corpo, mesma atribuição do
 * omie-sync, mesma limpeza de nome, mesmo sinal. Três diferenças, e as três
 * existem por causa do mesmo caso de uso:
 *
 *   • NÃO filtra por rubrica. O ponto é justamente achar o lançamento na linha
 *     errada — filtrar pela rubrica perguntada devolveria o vazio que a pessoa
 *     já está vendo na tela.
 *   • O DE-PARA entra por LEFT JOIN. Categoria fora do mapa não aparece em lugar
 *     nenhum da demonstração, e é um dos desfechos possíveis da pergunta ("está
 *     lançado, mas numa categoria que a DRE não conhece"). Com INNER JOIN essa
 *     resposta seria impossível de dar. Sai com `rubrica` nula.
 *   • Devolve `grupo` e `codigo`. Sem `cGrupo` não dá para saber se o título
 *     ACEITA troca de categoria (previsão de OS e perna bancária não aceitam), e
 *     propor o que o ERP vai recusar é pior do que não propor.
 *
 * FILTRAR CUSTA, ENTÃO FILTRA-SE CEDO: o mês entra em `base`, antes dos joins,
 * e o texto de busca é montado UMA VEZ por linha (`busca_txt`) em vez de quatro
 * `unaccent` por termo por linha. Sem isso a varredura do blob de movimentos —
 * que é uma linha só de jsonb — pagaria o normalizador por candidato.
 *
 * SEM TERMO NÃO HÁ BUSCA: com `p_busca` vazio a função devolve zero linhas, de
 * propósito. "Todos os lançamentos do mês" são milhares e não cabem em prompt
 * nenhum; quem chama tem que dizer o que procura.
 */
create or replace function public.demonstracoes_lancamentos_busca(
  p_tipo   text,
  p_meses  text[],
  p_busca  text[],
  p_limite int default 300
)
returns table (
  rubrica     text,
  mes         text,
  data        date,
  contraparte text,
  documento   text,
  categoria   text,
  codigo      text,
  grupo       text,
  valor       numeric,
  cod_titulo  text,
  observacao  text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  -- Termo de 1 ou 2 letras casa dentro de qualquer palavra e traria o mês
  -- inteiro de volta. O mesmo piso do casamento de nomes (`MIN_CHAVE`).
  termos as (
    select distinct lower(unaccent(btrim(t))) as t
    from unnest(coalesce(p_busca, array[]::text[])) as t
    where length(btrim(t)) >= 3
  ),
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  cli as (
    select distinct on (c->>'codigo')
      c->>'codigo' as codigo,
      coalesce(
        nullif(btrim(regexp_replace(
          regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
          '\s+\d{11}$', '')), ''),
        c->>'nome'
      ) as nome
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  /* `materialized` de propósito: sem ele o planejador embute este bloco em cada
     referência abaixo e a varredura do blob acontece mais de uma vez. */
  base as materialized (
    select *
    from (
      select
        det,
        case when upper(coalesce(det->>'cNatureza','R')) similar to '(P|D)%' then -1 else 1 end as sinal,
        case when p_tipo = 'dre'
          then to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'),''),'DD/MM/YYYY')
          else to_date(nullif(coalesce(det->>'dDtPagamento', det->>'dDtCredito', det->>'dDtConcilia'),''),'DD/MM/YYYY')
        end as dt,
        det->>'cCodCateg' as codigo,
        (det->>'nValorTitulo')::numeric as bruto
      from mov
    ) x
    where x.dt is not null
      -- Sem `nValorTitulo` é a perna bancária do mesmo título: vale zero aqui.
      and x.bruto is not null
      and x.dt >= (date_trunc('year', current_date) - interval '1 year')::date
      and x.dt <= current_date
      and (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
            [extract(month from x.dt)::int] || '-' || to_char(x.dt,'YY') = any(p_meses)
  ),
  /* Uma categoria pode estar mapeada para mais de uma rubrica (a mesma conta
     servindo DRE e 'ambos'): sem o `distinct on`, o join devolveria o mesmo
     título duas vezes e a proposta de correção contaria o valor em dobro.
     `rubrica nulls last` faz a linha mapeada ganhar da órfã. */
  achados as (
    select distinct on (b.det->>'nCodTitulo', b.dt, b.bruto)
      dp.rubrica                                            as rubrica,
      (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
        [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY')  as mes,
      b.dt                                                  as data,
      coalesce(nullif(btrim(cli.nome), ''), f.nome)         as contraparte,
      nullif(b.det->>'cCPFCNPJCliente', '')                 as documento,
      coalesce(c.descricao, b.codigo)                       as categoria,
      b.codigo                                              as codigo,
      b.det->>'cGrupo'                                      as grupo,
      b.sinal * abs(b.bruto)                                as valor,
      b.det->>'nCodTitulo'                                  as cod_titulo,
      t.observacao                                          as observacao,
      lower(unaccent(
        coalesce(nullif(btrim(cli.nome), ''), f.nome, '') || ' ' ||
        coalesce(c.descricao, b.codigo, '')                || ' ' ||
        coalesce(t.observacao, '')                         || ' ' ||
        coalesce(dp.rubrica, '')
      ))                                                    as busca_txt
    from base b
    left join cat c on c.codigo = b.codigo
    left join cli on cli.codigo = b.det->>'nCodCliente'
    left join lib_fornecedores f
      on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
         regexp_replace(coalesce(b.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
    left join omie_titulo_texto t
      on t.cod_titulo = nullif(b.det->>'nCodTitulo','')::bigint
    left join omie_dre_mapa dp
      on dp.ativo is not false
     and dp.demonstrativo in (p_tipo, 'ambos')
     and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, b.codigo)), '\s+', ' ', 'g')))
    order by b.det->>'nCodTitulo', b.dt, b.bruto, dp.rubrica nulls last
  )
  select
    a.rubrica, a.mes, a.data, a.contraparte, a.documento,
    a.categoria, a.codigo, a.grupo, a.valor, a.cod_titulo, a.observacao
  from achados a
  where exists (select 1 from termos x where a.busca_txt like '%' || x.t || '%')
  -- Pelo tamanho: o que se procura numa correção é o valor que move a célula.
  order by abs(a.valor) desc
  limit greatest(1, least(coalesce(p_limite, 300), 500));
$$;

comment on function public.demonstracoes_lancamentos_busca(text, text[], text[], int) is
  'Lançamentos do Omie de um ou mais meses que casam com algum termo (contraparte, categoria, observação ou rubrica), em QUALQUER rubrica e inclusive fora do DE-PARA. Insumo da correção pelo chat da célula da DRE/DFC.';

-- Função nova em `public` nasce chamável por `anon`: sem o revoke, o lançamento
-- a lançamento da empresa responderia a quem só tem a chave pública.
revoke all on function public.demonstracoes_lancamentos_busca(text, text[], text[], int) from public;
revoke all on function public.demonstracoes_lancamentos_busca(text, text[], text[], int) from anon;
grant execute on function public.demonstracoes_lancamentos_busca(text, text[], text[], int) to authenticated;
grant execute on function public.demonstracoes_lancamentos_busca(text, text[], text[], int) to service_role;


/* ============================================================
 *  2) A proposta de correção vive ao lado da resposta
 * ============================================================
 * Coluna na própria linha da pergunta, e não tabela nova, porque proposta sem a
 * resposta que a motivou não quer dizer nada: ela é o parágrafo final do texto,
 * na forma que um botão consegue executar.
 *
 * `acao_estado` é o que impede o botão de aparecer duas vezes para a mesma
 * correção. Ele muda uma vez só, de 'proposta' para 'aplicada' ou 'descartada'
 * — e o que aconteceu de fato (quantos títulos, quais recusas do ERP) fica em
 * `acao_resultado`, que é o que a pessoa lê depois quando não lembra se chegou
 * a aplicar.
 */
alter table public.demonstracoes_perguntas
  add column if not exists acao           jsonb,
  add column if not exists acao_estado    text,
  add column if not exists acao_resultado jsonb,
  add column if not exists acao_em        timestamptz,
  add column if not exists acao_por       uuid;

do $$
begin
  alter table public.demonstracoes_perguntas
    add constraint demonstracoes_perguntas_acao_estado_check
    check (acao_estado is null or acao_estado in ('proposta','aplicada','descartada'));
exception when duplicate_object then null;
end $$;

comment on column public.demonstracoes_perguntas.acao is
  'Correção que a IA propôs a partir desta pergunta, já validada contra o Omie (títulos que existem, categoria lançável). Nula quando a pergunta era só pergunta.';
comment on column public.demonstracoes_perguntas.acao_estado is
  'proposta = o botão ainda está lá · aplicada = alguém clicou · descartada = alguém dispensou. Muda uma vez só.';
comment on column public.demonstracoes_perguntas.acao_resultado is
  'O que aconteceu ao aplicar: quantos títulos foram, quais o ERP recusou e por quê.';


/* Fechar o ciclo da proposta.
 *
 * A tabela não tem policy de escrita para o cliente de propósito (é o que impede
 * inventar resposta de IA com autor registrado), então o carimbo passa por aqui.
 * A função é estreita: mexe em três colunas, só na transição a partir de
 * 'proposta', e nunca no texto da resposta.
 *
 * `where acao_estado = 'proposta'` não é zelo decorativo: duas abas com a mesma
 * célula aberta clicariam duas vezes, e a segunda troca no Omie já teria sido
 * feita pela primeira. Aqui a segunda simplesmente não encontra o que carimbar.
 */
create or replace function public.pergunta_acao_registrar(
  p_id        uuid,
  p_estado    text,
  p_resultado jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if p_estado not in ('aplicada','descartada') then
    raise exception 'Estado inválido: %', p_estado;
  end if;

  update public.demonstracoes_perguntas
     set acao_estado    = p_estado,
         acao_resultado = coalesce(p_resultado, acao_resultado),
         acao_em        = now(),
         acao_por       = auth.uid()
   where id = p_id
     and acao is not null
     and coalesce(acao_estado, 'proposta') = 'proposta';

  get diagnostics v_ok = row_count;
  return v_ok > 0;
end;
$$;

revoke all on function public.pergunta_acao_registrar(uuid, text, jsonb) from public;
revoke all on function public.pergunta_acao_registrar(uuid, text, jsonb) from anon;
grant execute on function public.pergunta_acao_registrar(uuid, text, jsonb) to authenticated;


/* ============================================================
 *  3) O que não é para consertar agora vira subtarefa do Fechamento
 * ============================================================
 * Nem toda correção é nossa: o período pode estar fechado no Omie, a dúvida pode
 * ser da contabilidade, o lançamento pode depender de uma nota que não chegou.
 * Isso é trabalho, e trabalho que não vira card se perde.
 *
 * MAS UM CARD POR CÉLULA AFOGARIA O KANBAN — um fechamento tem dezenas dessas.
 * Por isso o destino é UM card, "Fechamento", e cada pendência é uma linha do
 * checklist dele: o quadro ganha uma raia, não trinta. `subtarefas` já é jsonb na
 * própria tarefa (migration 20260511171111), e é o mesmo checklist que o desktop
 * e o celular editam.
 *
 * ACHAR-OU-CRIAR AQUI DENTRO, e não na tela, porque duas pessoas fechando o mês
 * ao mesmo tempo criariam dois cards "Fechamento" — e o segundo levaria semanas
 * para alguém notar. Pelo mesmo motivo o append é um `update` único sobre a
 * coluna, e não ler-em-JS-e-gravar-de-volta: entre a leitura e a gravação cabe a
 * subtarefa de outra pessoa, que sumiria sem deixar rastro.
 */
create or replace function public.tarefa_fechamento_subtarefa(
  p_titulo      text,
  p_responsavel text default null,
  p_card        text default 'Fechamento'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_criou   boolean := false;
  v_titulo  text := btrim(coalesce(p_titulo, ''));
  v_card    text := coalesce(nullif(btrim(p_card), ''), 'Fechamento');
  v_resp    text := nullif(btrim(coalesce(p_responsavel, '')), '');
  v_quem    text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if length(v_titulo) < 3 then
    raise exception 'Escreva o que precisa ser feito.';
  end if;

  select nome into v_quem from public.profiles where user_id = auth.uid() limit 1;

  -- O card mais antigo com esse nome, entre os vivos: se um dia houver dois, o
  -- primeiro é o que o time vem usando.
  select id into v_id
    from public.tarefas
   where arquivada_em is null
     and lower(btrim(titulo)) = lower(v_card)
   order by created_at
   limit 1;

  if v_id is null then
    insert into public.tarefas (titulo, status, prioridade, responsavel, observacao)
    values (
      v_card, 'Backlog', 'Alta', v_resp,
      'Card guarda-chuva do fechamento. As subtarefas nascem dos comentários das células da DRE/DFC.'
    )
    returning id into v_id;
    v_criou := true;

    insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario, usuario_id)
    values (v_id, v_card, 'criada', 'criada pelo chat da célula da DRE/DFC', v_quem, auth.uid());
  end if;

  -- A mesma pendência apontada duas vezes (duas perguntas na mesma célula, dois
  -- meses com o mesmo problema) é ruído no checklist, não trabalho a mais.
  if exists (
    select 1
      from public.tarefas t,
           lateral jsonb_array_elements(coalesce(t.subtarefas, '[]'::jsonb)) s
     where t.id = v_id
       and lower(btrim(coalesce(s->>'titulo',''))) = lower(v_titulo)
  ) then
    return jsonb_build_object(
      'tarefa_id', v_id, 'card', v_card, 'criou_card', v_criou, 'repetida', true
    );
  end if;

  update public.tarefas
     set subtarefas = coalesce(subtarefas, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'id',          gen_random_uuid()::text,
           'titulo',      v_titulo,
           'responsavel', v_resp,
           'done',        false
         ))
   where id = v_id;

  insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario, usuario_id)
  values (v_id, v_card, 'editada', 'subtarefa criada pelo chat da DRE/DFC: ' || v_titulo, v_quem, auth.uid());

  return jsonb_build_object(
    'tarefa_id', v_id, 'card', v_card, 'criou_card', v_criou, 'repetida', false
  );
end;
$$;

revoke all on function public.tarefa_fechamento_subtarefa(text, text, text) from public;
revoke all on function public.tarefa_fechamento_subtarefa(text, text, text) from anon;
grant execute on function public.tarefa_fechamento_subtarefa(text, text, text) to authenticated;

-- Sem o reload o PostgREST não anuncia as funções novas nem as colunas, e a tela
-- leva 404 até o cache expirar sozinho.
notify pgrst, 'reload schema';
