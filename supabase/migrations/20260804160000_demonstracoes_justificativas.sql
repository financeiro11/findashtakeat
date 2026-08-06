/* ============================================================================
 * Justificativas de variação na célula da DRE/DFC.
 *
 * O tracker de orçamento sempre teve comentários escritos à mão pelo Henrique e
 * pela Júlia em cima das células que variaram ("Ingram com um valor mais
 * elevado. Mar = 39.149,15 / Abr = 78.139,61"). Eram 133 só entre jan e jun/26,
 * e todo mês o fechamento recomeçava do zero: abrir a célula, caçar quem mexeu,
 * escrever. Aqui a máquina faz o primeiro rascunho — a partir dos MESMOS
 * lançamentos do Omie que a auditoria já usa — e a pessoa só confere, ajusta e
 * leva para o tracker.
 *
 * Três peças:
 *   1. `demonstracoes_justificativas` — uma linha por célula (tipo × rubrica ×
 *      mês) com o texto gerado, os números e QUEM causou a variação.
 *   2. `demonstracoes_contrapartes()` — o insumo: quanto cada fornecedor/pessoa
 *      pesou em cada rubrica, mês a mês. É daqui que sai o "quem".
 *   3. `justificativa_decidir()` — a decisão humana (aceitar, descartar,
 *      reescrever), que precisa sobreviver à próxima geração.
 *
 * O texto NÃO é verdade contábil: é hipótese com fonte. Por isso a tabela
 * guarda os `drivers` ao lado do texto — quem lê confere a conta sem sair da
 * tela, e o que for invenção morre ali.
 * ========================================================================== */

create table if not exists public.demonstracoes_justificativas (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('dre','dfc')),
  rubrica        text not null,              -- rótulo da linha, igual ao da tela
  mes            text not null,              -- 'Jun-26', a chave de coluna da tela
  mes_anterior   text,                       -- 'May-26' — a base da comparação

  -- Números CONGELADOS no momento da geração. Guardados (e não recalculados na
  -- leitura) porque é contra eles que o texto foi escrito: se a base mudar, dá
  -- para perceber que o comentário envelheceu em vez de exibi-lo como atual.
  valor          numeric,
  valor_anterior numeric,
  delta          numeric,
  delta_pct      numeric,                    -- 0.12 = +12%
  despesa        boolean not null default false,  -- rubrica que desce de um bloco "(-)"

  texto          text not null,              -- rascunho da IA
  drivers        jsonb not null default '[]'::jsonb,  -- [{contraparte, atual, anterior, delta, movimento}]
  cobertura      numeric,                    -- quanto do delta os drivers explicam (0–1+)
  confianca      text check (confianca in ('alta','media','baixa')),
  -- Suspeitas objetivas levantadas na geração: "fornecedor sumiu", "dobrou de
  -- fatura", "nenhum lançamento no Omie explica". É o que transforma isto de
  -- relatório em ferramenta de achar erro.
  sinais         jsonb not null default '[]'::jsonb,

  -- Decisão humana. SOBREVIVE à regeração (ver o `on conflict` do edge function
  -- `demonstracoes-justificar`): quem já conferiu não confere de novo.
  status         text not null default 'novo' check (status in ('novo','aceito','descartado')),
  texto_editado  text,                       -- reescrita da pessoa; vence o `texto`
  editado_por    uuid,
  editado_em     timestamptz,

  modelo         text,                       -- rastro de qual IA escreveu
  gerado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  -- Uma justificativa por célula. Regerar ATUALIZA, não empilha.
  unique (tipo, rubrica, mes)
);

create index if not exists demonstracoes_justificativas_tela_idx
  on public.demonstracoes_justificativas (tipo, mes);

alter table public.demonstracoes_justificativas enable row level security;

drop policy if exists "auth read demonstracoes_justificativas" on public.demonstracoes_justificativas;
create policy "auth read demonstracoes_justificativas"
  on public.demonstracoes_justificativas for select to authenticated using (true);
-- Escrita: geração pela service role (edge function) e decisão pela função
-- `justificativa_decidir` abaixo. Nada de update solto vindo do cliente — o
-- texto é levado para o tracker oficial, então precisa de autor registrado.


/* ============================================================
 *  1) O insumo: quem move cada rubrica, mês a mês
 * ============================================================
 * Mesma atribuição do drill-down (`demonstracoes_lancamentos`, migration
 * 20260804120100) — DRE por competência, DFC por caixa, mesmo DE-PARA, mesmo
 * sinal — só que AGREGADA por contraparte e para VÁRIOS meses de uma vez.
 * Agrupar aqui (e não trazer 5 mil lançamentos para o edge function) é o que
 * deixa a geração caber numa chamada por mês.
 *
 * `security definer` pelo mesmo motivo do drill-down: `omie_cache` tem RLS sem
 * policy nenhuma — o dump cru do Omie nunca vai para o cliente, só este recorte.
 */
create or replace function public.demonstracoes_contrapartes(
  p_tipo  text,
  p_meses text[]
)
returns table (
  rubrica     text,
  mes         text,
  contraparte text,
  categoria   text,
  valor       numeric,
  lancamentos integer
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
  -- Mesma limpeza de nome do drill-down: MEI e autônomo vêm da Receita com o
  -- documento embutido na razão social.
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
  ),
  -- Chave de mês montada à mão (e não com to_char(dt,'Mon')) para não depender
  -- do locale do servidor — mesma razão do drill-down.
  datado as (
    select
      b.*,
      (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
        [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY') as mes_key
    from base b
    where b.dt is not null
      -- Sem `nValorTitulo` é a perna bancária do mesmo título: vale zero aqui.
      and b.bruto is not null
  ),
  linhas as (
    select
      dp.rubrica                                        as rubrica,
      d.mes_key                                         as mes,
      coalesce(
        nullif(btrim(cli.nome), ''),
        f.nome,
        -- Quando é lançamento de cartão (cli=null, f=null, sem documento),
        -- usa a descrição do Omie em vez de "Lancamento Fatura Cartao"
        case when cli.nome is null and f.nome is null and nullif(d.det->>'cCPFCNPJCliente','') is null
          then nullif(btrim(d.det->>'cDescricao'), '')
          else null
        end,
        nullif(d.det->>'cCPFCNPJCliente',''),
        'Sem contraparte'
      )                                                 as contraparte,
      coalesce(c.descricao, d.codigo)                   as categoria,
      d.sinal * abs(d.bruto)                            as valor
    from datado d
    left join cat c on c.codigo = d.codigo
    left join cli on cli.codigo = d.det->>'nCodCliente'
    left join lib_fornecedores f
      on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
         regexp_replace(coalesce(d.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
    join omie_dre_mapa dp
      on dp.ativo is not false
     and dp.demonstrativo in (p_tipo, 'ambos')
     and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, d.codigo)), '\s+', ' ', 'g')))
    where d.mes_key = any(p_meses)
  )
  select
    l.rubrica,
    l.mes,
    l.contraparte,
    -- Uma contraparte pode aparecer em mais de uma categoria dentro da mesma
    -- rubrica; mostra a que mais pesou, que é a que explica o número.
    (array_agg(l.categoria order by abs(l.valor) desc))[1] as categoria,
    sum(l.valor)::numeric                                  as valor,
    count(*)::integer                                      as lancamentos
  from linhas l
  group by l.rubrica, l.mes, l.contraparte
  order by l.rubrica, l.mes, abs(sum(l.valor)) desc;
$$;

revoke all on function public.demonstracoes_contrapartes(text, text[]) from public;
grant execute on function public.demonstracoes_contrapartes(text, text[]) to authenticated;
grant execute on function public.demonstracoes_contrapartes(text, text[]) to service_role;


/* ============================================================
 *  2) A decisão humana
 * ============================================================
 * Aceitar / descartar / reescrever. Passa por função (e não por update direto)
 * porque este texto é copiado para o tracker oficial: precisa de autor e data
 * registrados, e o cliente não pode escolher quem assina.
 *
 * `p_texto`:
 *   • null      → não mexe no texto
 *   • ''        → APAGA a edição e volta a valer o rascunho da IA
 *   • qualquer  → vira `texto_editado` e passa a vencer o rascunho
 */
create or replace function public.justificativa_decidir(
  p_id     uuid,
  p_status text default null,
  p_texto  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if p_status is not null and p_status not in ('novo','aceito','descartado') then
    raise exception 'Status inválido: %', p_status;
  end if;

  update public.demonstracoes_justificativas
  set
    status        = coalesce(p_status, status),
    texto_editado = case
                      when p_texto is null       then texto_editado
                      when btrim(p_texto) = ''   then null
                      else btrim(p_texto)
                    end,
    editado_por   = case when p_texto is null then editado_por else auth.uid() end,
    editado_em    = case when p_texto is null then editado_em  else now() end,
    atualizado_em = now()
  where id = p_id;

  if not found then
    raise exception 'Justificativa não encontrada.';
  end if;
end;
$$;

revoke all on function public.justificativa_decidir(uuid, text, text) from public;
grant execute on function public.justificativa_decidir(uuid, text, text) to authenticated;
