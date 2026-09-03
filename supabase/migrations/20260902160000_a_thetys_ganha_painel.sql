-- A Thétys ganha painel: ver o que ela fez, tratar o que ela escalou, corrigir o que errou.
--
-- Duas portas faltavam, e as duas falhariam CALADAS — que é o pior jeito de falhar
-- num painel, porque o botão parece funcionar para sempre.
--
-- 1. `agente_execucoes` tem policy de SELECT e de INSERT para `authenticated`, e
--    NENHUMA de UPDATE. Um `update` vindo do navegador não devolve erro: o PostgREST
--    responde 204 com zero linhas afetadas, e o "corrigir" da tela ficaria dizendo
--    "pronto" sem nunca ter gravado. É o mesmo silêncio do `omie_cache` sem policy.
--    RLS também não sabe restringir COLUNA: uma policy de update aberta deixaria quem
--    corrige reescrever `entrada`/`saida` e apagar a trilha que é o motivo da tabela
--    existir. Por isso a correção entra por função, que toca só os quatro campos do
--    feedback humano.
--
-- 2. `corrigido_por` e `resolvido_por` apontam para `lib_colaboradores`, não para
--    `auth.users`. O navegador conhece o `auth.uid()`; a ponte até o colaborador é o
--    e-mail em `profiles`. Costurar isso no cliente seria uma busca a mais por gesto
--    e um id chutado quando o e-mail não bate. Aqui é uma linha — e o nulo (quem
--    corrigiu não está em `lib_colaboradores`) não impede a correção de existir, só
--    deixa a autoria em branco.
--
-- O QUE ESTA MIGRATION NÃO FAZ: escrever execução. Quem grava `agente_execucoes` é o
-- runtime da Thétys, fora deste repositório. Daqui só se lê e se responde.

-- ---------------------------------------------------------------------------
-- Quem sou eu, do lado do RH.
create or replace function public.agente_colaborador_atual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.profiles p
    join public.lib_colaboradores c
      on lower(trim(c.email)) = lower(trim(p.email))
   where p.user_id = auth.uid()
     and coalesce(trim(p.email), '') <> ''
   limit 1
$$;

comment on function public.agente_colaborador_atual is
  'auth.uid() -> lib_colaboradores.id pelo e-mail do profile. Nulo quando quem está logado não é colaborador cadastrado.';

-- ---------------------------------------------------------------------------
-- A correção humana de uma decisão da agente.
--
-- É daqui que sai o aprendizado dela: `corrigido_por_humano` era a coluna que a
-- Onda 4 criou e que nunca ninguém teve como preencher, porque não havia tela.
-- Texto vazio DESFAZ a correção — quem carimbou errado precisa de saída, e apagar
-- linha de trilha não é uma delas.
create or replace function public.agente_execucao_corrigir(
  p_execucao_id uuid,
  p_texto       text,
  p_campos      jsonb default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_quando timestamptz;
begin
  if p_execucao_id is null then
    raise exception 'Sem execução para corrigir.';
  end if;

  update public.agente_execucoes
     set corrigido_por_humano = (v_texto is not null),
         -- `campos` guarda o que deveria ter sido (categoria certa, fornecedor certo);
         -- `texto` guarda o porquê, em português. Os dois são opcionais entre si.
         correcao = case when v_texto is null then null
                         else jsonb_build_object('texto', v_texto, 'campos', p_campos) end,
         corrigido_por = case when v_texto is null then null
                              else public.agente_colaborador_atual() end,
         corrigido_em  = case when v_texto is null then null else now() end
   where id = p_execucao_id
  returning corrigido_em into v_quando;

  if not found then
    raise exception 'Execução % não existe.', p_execucao_id;
  end if;

  return v_quando;
end $$;

comment on function public.agente_execucao_corrigir is
  'Marca (ou desmarca, com texto vazio) a correção humana de uma execução. Só toca os campos de feedback — entrada, saida e resultado ficam intactos.';

-- ---------------------------------------------------------------------------
-- A fila do humano: o que a agente não pôde decidir sozinha.
--
-- `agente_excecoes` já tem policy ALL para `authenticated`, então um update direto
-- funcionaria. Passa por função pelo mesmo motivo da correção: para que `resolvido_por`
-- seja sempre quem está logado, e não um id que a tela escolheu. Reabrir limpa a
-- autoria — senão a exceção reaberta continuaria dizendo que fulano a resolveu.
create or replace function public.agente_excecao_resolver(
  p_excecao_id uuid,
  p_status     text,
  p_resolucao  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fechada boolean := p_status in ('resolvida', 'descartada');
begin
  if p_status not in ('aberta', 'em_analise', 'resolvida', 'descartada') then
    raise exception 'Status % não existe para uma exceção.', p_status;
  end if;

  update public.agente_excecoes
     set status        = p_status,
         resolucao     = case when v_fechada then nullif(btrim(coalesce(p_resolucao, '')), '') else null end,
         resolvido_por = case when v_fechada then public.agente_colaborador_atual() else null end,
         resolvido_em  = case when v_fechada then now() else null end
   where id = p_excecao_id;

  if not found then
    raise exception 'Exceção % não existe.', p_excecao_id;
  end if;
end $$;

comment on function public.agente_excecao_resolver is
  'Move uma exceção da fila do humano. Fechar carimba quem e quando; reabrir limpa o carimbo.';

-- ---------------------------------------------------------------------------
-- O grant para `anon` sai automático em função nova. Aqui ninguém age deslogado.
revoke all on function public.agente_colaborador_atual()                         from anon, public;
revoke all on function public.agente_execucao_corrigir(uuid, text, jsonb)        from anon, public;
revoke all on function public.agente_excecao_resolver(uuid, text, text)          from anon, public;

grant execute on function public.agente_colaborador_atual()                      to authenticated;
grant execute on function public.agente_execucao_corrigir(uuid, text, jsonb)     to authenticated;
grant execute on function public.agente_excecao_resolver(uuid, text, text)       to authenticated;

-- ---------------------------------------------------------------------------
-- O painel lê por PERÍODO ("ontem", "este mês"), e o índice que existia é
-- (agente_id, executado_em desc) — serve, mas só depois de escolher o agente. Com
-- mais de um agente ligado, o relatório do mês varre a tabela inteira. Este índice
-- é o do corte que a tela sempre faz primeiro.
create index if not exists agente_exec_periodo_idx
  on public.agente_execucoes (executado_em desc);

-- ---------------------------------------------------------------------------
-- O painel de automações mudou de endereço (virou aba de /monitoramento). O sino
-- casa o selo da barra lateral pela ROTA — com a rota velha, o sinal continuaria
-- sendo emitido e o item do menu simplesmente nunca acenderia, que é exatamente
-- o tipo de quebra que ninguém percebe.
update public.sinal_serie
   set rota = '/monitoramento/automacoes'
 where serie = 'automacoes.falhas'
   and rota = '/automacoes/painel';
