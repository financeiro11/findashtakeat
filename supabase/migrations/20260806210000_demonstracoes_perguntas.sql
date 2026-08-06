/* ============================================================================
 * Perguntar sobre um valor da DRE/DFC — e a resposta virar comentário da célula.
 *
 * As justificativas (migration 20260804160000) explicam o que a MÁQUINA percebeu:
 * a célula variou acima do limiar, quem se mexeu no Omie, redigido no formato do
 * tracker. Mas metade do fechamento é a pergunta que só quem conhece a operação
 * faz — e ela costuma ser sobre uma célula que NÃO variou:
 *
 *   "quatro pessoas do comercial tiveram reajuste em julho; por que Pessoal não
 *    subiu?"
 *
 * Nenhum gerador automático faz essa pergunta, porque ela nasce de um fato que
 * não está em lugar nenhum do banco. Aqui a pessoa escreve a pergunta na célula,
 * a IA responde com os MESMOS lançamentos que sustentam as justificativas, e a
 * resposta fica registrada ali — pergunta e resposta, com autor e data.
 *
 * Três peças:
 *   1. `demonstracoes_lancamentos_multi()` — o insumo cru: os lançamentos de
 *      várias rubricas e vários meses numa varredura só.
 *   2. `demonstracoes_perguntas` — o fio de perguntas e respostas por célula.
 *   3. `pergunta_promover()` — a resposta vira O comentário oficial da célula,
 *      que é o que vai para o tracker.
 *
 * A resposta NÃO é verdade contábil, pelo mesmo motivo da justificativa: o Omie
 * diz QUEM e QUANTO, nunca POR QUÊ. Por isso a linha guarda os drivers que a IA
 * teve na mão — quem lê confere a conta sem sair da tela.
 * ========================================================================== */


/* ============================================================
 *  1) O insumo: lançamentos de várias rubricas × vários meses
 * ============================================================
 * Mesmo corpo de `demonstracoes_lancamentos` (migration 20260804120100): mesma
 * atribuição do omie-sync, mesma limpeza de nome, mesmo sinal. A diferença é só
 * o filtro — arrays em vez de escalares.
 *
 * POR QUE NÃO CHAMAR A DE UMA RUBRICA NUM LOOP: uma célula somada como "Pessoal"
 * tem oito folhas, e a pergunta compara dois meses — dezesseis chamadas, cada uma
 * varrendo o `omie_cache` inteiro (o blob de movimentos é uma linha só de jsonb).
 * `security definer` impede o inlining da função, então o planejador não teria
 * como fundir as varreduras. Com os arrays aqui dentro é UMA.
 *
 * A observação do título entra junto porque, no cartão, a contraparte é sempre o
 * balde da fatura e o que o gasto É está só nela (ver `omie_titulo_texto`).
 */
create or replace function public.demonstracoes_lancamentos_multi(
  p_tipo     text,
  p_rubricas text[],
  p_meses    text[]
)
returns table (
  rubrica     text,
  mes         text,
  data        date,
  contraparte text,
  categoria   text,
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
  base as (
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
  )
  select
    dp.rubrica                                            as rubrica,
    -- Chave de mês montada à mão para não depender do locale do servidor —
    -- mesma razão do drill-down.
    (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
      [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY')  as mes,
    b.dt                                                  as data,
    coalesce(nullif(btrim(cli.nome), ''), f.nome)         as contraparte,
    coalesce(c.descricao, b.codigo)                       as categoria,
    b.sinal * abs(b.bruto)                                as valor,
    b.det->>'nCodTitulo'                                  as cod_titulo,
    t.observacao                                          as observacao
  from base b
  left join cat c on c.codigo = b.codigo
  left join cli on cli.codigo = b.det->>'nCodCliente'
  left join lib_fornecedores f
    on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
       regexp_replace(coalesce(b.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
   and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
  left join omie_titulo_texto t
    on t.cod_titulo = nullif(b.det->>'nCodTitulo','')::bigint
  join omie_dre_mapa dp
    on dp.ativo is not false
   and dp.demonstrativo in (p_tipo, 'ambos')
   and dp.rubrica = any(p_rubricas)
   and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
     = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, b.codigo)), '\s+', ' ', 'g')))
  where b.dt is not null
    -- Sem `nValorTitulo` é a perna bancária do mesmo título: vale zero aqui.
    and b.bruto is not null
    and b.dt >= (date_trunc('year', current_date) - interval '1 year')::date
    and b.dt <= current_date
    and (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
          [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY') = any(p_meses)
  order by dp.rubrica, b.dt, abs(b.bruto) desc;
$$;

-- Função nova em `public` nasce chamável por `anon`: sem o revoke abaixo, o
-- lançamento a lançamento da empresa responderia a quem só tem a chave pública.
revoke all on function public.demonstracoes_lancamentos_multi(text, text[], text[]) from public;
revoke all on function public.demonstracoes_lancamentos_multi(text, text[], text[]) from anon;
grant execute on function public.demonstracoes_lancamentos_multi(text, text[], text[]) to authenticated;
grant execute on function public.demonstracoes_lancamentos_multi(text, text[], text[]) to service_role;


/* ============================================================
 *  2) O fio de perguntas da célula
 * ============================================================
 * Sem `unique`, ao contrário das justificativas: a mesma célula recebe várias
 * perguntas, e repicar ("e se olhar por competência?") é o uso normal. A ordem é
 * `criado_em` e o fio inteiro volta como contexto na pergunta seguinte.
 */
create table if not exists public.demonstracoes_perguntas (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('dre','dfc')),
  rubrica        text not null,              -- rótulo da linha, igual ao da tela
  mes            text not null,              -- 'Jul-26', a chave de coluna da tela

  pergunta       text not null,
  resposta       text not null,

  -- Números da célula NO MOMENTO da pergunta: é contra eles que a resposta foi
  -- escrita. Guardados pelo mesmo motivo das justificativas — dá para perceber
  -- que a resposta envelheceu em vez de exibi-la como atual.
  valor          numeric,
  valor_anterior numeric,
  mes_anterior   text,
  -- Mês travado: o valor da tela veio do tracker, não do Omie. Muda a leitura da
  -- resposta inteira, então fica registrado com ela.
  travado        boolean not null default false,

  -- A prova. `drivers` é quem se mexeu entre os dois meses (mesmo formato da
  -- justificativa); `dados` é o inventário do que a IA teve na mão — quantos
  -- lançamentos, quantos couberam no prompt, o que ficou de fora.
  drivers        jsonb not null default '[]'::jsonb,
  dados          jsonb not null default '{}'::jsonb,
  confianca      text check (confianca in ('alta','media','baixa')),

  autor_id       uuid,
  autor_email    text,
  modelo         text,
  criado_em      timestamptz not null default now()
);

create index if not exists demonstracoes_perguntas_tela_idx
  on public.demonstracoes_perguntas (tipo, mes);

alter table public.demonstracoes_perguntas enable row level security;

-- Leitura: qualquer pessoa logada. O fio é do time, não de quem perguntou — a
-- resposta que a Júlia obteve poupa o Henrique de perguntar de novo.
drop policy if exists "auth read demonstracoes_perguntas" on public.demonstracoes_perguntas;
create policy "auth read demonstracoes_perguntas"
  on public.demonstracoes_perguntas for select to authenticated using (true);
-- Escrita só pela service role (edge `demonstracoes-perguntar`) e pelas funções
-- abaixo: nenhum caminho do cliente inventa resposta de IA com autor registrado.


/* ============================================================
 *  3) A resposta vira o comentário oficial da célula
 * ============================================================
 * O que vai para o tracker é a justificativa. Promover é dizer "esta resposta é
 * o comentário desta célula": ela entra como `texto_editado` (que já vence o
 * rascunho automático) com status 'aceito'.
 *
 * Isso é o que a faz SOBREVIVER ao "Regerar": o upsert da geração não manda
 * `status` nem `texto_editado`, e a reconciliação só apaga linha com status
 * 'novo' e sem reescrita. Uma célula promovida não é nenhum dos dois.
 *
 * Os números vêm por parâmetro porque quem os conhece é a TELA — é ela que soma
 * os filhos e aplica o valor manual. Recalcular aqui do blob produziria um
 * cabeçalho que não bate com a célula ao lado.
 */
alter table public.demonstracoes_justificativas
  add column if not exists origem text not null default 'auto',
  add column if not exists pergunta_id uuid;

do $$
begin
  alter table public.demonstracoes_justificativas
    add constraint demonstracoes_justificativas_origem_check
    check (origem in ('auto','pergunta'));
exception when duplicate_object then null;
end $$;

create or replace function public.pergunta_promover(
  p_id             uuid,
  p_valor          numeric default null,
  p_valor_anterior numeric default null,
  p_delta          numeric default null,
  p_delta_pct      numeric default null,
  p_mes_anterior   text    default null,
  p_despesa        boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.demonstracoes_perguntas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select * into p from public.demonstracoes_perguntas where id = p_id;
  if not found then
    raise exception 'Pergunta não encontrada.';
  end if;

  insert into public.demonstracoes_justificativas (
    tipo, rubrica, mes, mes_anterior,
    valor, valor_anterior, delta, delta_pct, despesa,
    texto, texto_editado, drivers, confianca, sinais,
    status, origem, pergunta_id, editado_por, editado_em, modelo
  ) values (
    p.tipo, p.rubrica, p.mes, coalesce(p_mes_anterior, p.mes_anterior),
    coalesce(p_valor, p.valor), coalesce(p_valor_anterior, p.valor_anterior),
    -- `despesa` é NOT NULL na tabela e o cliente pode mandar null explícito (uma
    -- linha sem natureza definida): o default do parâmetro não cobre esse caso.
    p_delta, p_delta_pct, coalesce(p_despesa, false),
    p.resposta, p.resposta, p.drivers, p.confianca, '[]'::jsonb,
    'aceito', 'pergunta', p.id, auth.uid(), now(), p.modelo
  )
  on conflict (tipo, rubrica, mes) do update set
    -- O rascunho automático NÃO é apagado: fica em `texto`, e volta a valer se
    -- alguém desfizer a promoção pelo "Voltar ao rascunho" do balão.
    texto_editado = excluded.texto_editado,
    status        = 'aceito',
    origem        = 'pergunta',
    pergunta_id   = excluded.pergunta_id,
    editado_por   = auth.uid(),
    editado_em    = now(),
    atualizado_em = now();
end;
$$;

revoke all on function public.pergunta_promover(uuid, numeric, numeric, numeric, numeric, text, boolean) from public;
revoke all on function public.pergunta_promover(uuid, numeric, numeric, numeric, numeric, text, boolean) from anon;
grant execute on function public.pergunta_promover(uuid, numeric, numeric, numeric, numeric, text, boolean) to authenticated;


/* Pergunta mal formulada é lixo no fio de todo mundo — e o fio inteiro vai como
   contexto na próxima pergunta, então apagar também é higiene do prompt. */
create or replace function public.pergunta_apagar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  -- A justificativa promovida a partir dela perde só o vínculo: o texto já foi
  -- aceito como comentário da célula e apagar a pergunta não desfaz essa decisão.
  update public.demonstracoes_justificativas
  set pergunta_id = null
  where pergunta_id = p_id;

  delete from public.demonstracoes_perguntas where id = p_id;
  if not found then
    raise exception 'Pergunta não encontrada.';
  end if;
end;
$$;

revoke all on function public.pergunta_apagar(uuid) from public;
revoke all on function public.pergunta_apagar(uuid) from anon;
grant execute on function public.pergunta_apagar(uuid) to authenticated;

-- Sem o reload o PostgREST não anuncia a tabela nem as funções novas, e a tela
-- leva 404 até o cache expirar sozinho.
notify pgrst, 'reload schema';
