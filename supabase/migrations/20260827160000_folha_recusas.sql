-- Folha: o que NÃO entrou no Omie, e por quê — guardado, não só na aba aberta.
--
-- Até aqui a lista de recusas vivia no estado do React: recarregou a página,
-- sumiu. Em 27/08/2026 isso custou caro duas vezes no mesmo dia. A Edge
-- Function foi morta aos 151s no meio do envio; 96 títulos entraram no ERP e a
-- resposta se perdeu junto com o processo. Quem clicou viu "non-2xx" e ficou
-- sem saber quantos tinham entrado, quem faltou nem por qual motivo — a única
-- forma de descobrir foi ler o log da função pelo painel do Supabase, que não
-- é coisa que o financeiro faça.
--
-- UMA LINHA POR PESSOA E COMPETÊNCIA, atualizada a cada tentativa (e não uma
-- por tentativa): o que interessa é "quem ainda falta e por quê", e um
-- histórico de cinco tentativas da mesma pessoa enterraria essa resposta. As
-- tentativas ficam contadas em `tentativas`, que é o que sobra de útil delas.

create table if not exists public.folha_recusas (
  -- Competência (mês TRABALHADO), igual a `folha_envios_omie`.
  competencia   date not null,
  -- `codigo` do espelho do RH. NÃO o CNPJ: quatro ativos dividem o mesmo.
  codigo_rh     text not null,
  nome          text not null,
  -- `codigo_lancamento_integracao` do título que não nasceu.
  integracao    text not null,

  -- De onde veio a recusa. A ação é diferente em cada caso, e por isso o campo
  -- existe em vez de só o texto:
  --   'preparo'  o Hub nem tentou — falta fornecedor, categoria ou chave PIX.
  --              Conserta-se no cadastro (Omie ou RH), não reenviando.
  --   'omie'     o ERP recusou o título. O texto é a mensagem dele.
  --   'bloqueio' o Omie trancou a API por consumo. Resolve-se ESPERANDO.
  --   'tempo'    o lote parou no teto de tempo. Resolve-se reenviando.
  origem        text not null check (origem in ('preparo','omie','bloqueio','tempo')),
  motivo        text not null,

  tentativas    integer not null default 1,
  tentado_em    timestamptz not null default now(),
  tentado_por   uuid references auth.users(id) on delete set null,

  -- Quando o título finalmente entrou. Preenchido = resolvido; a tela mostra
  -- os nulos. Marcar em vez de apagar é o que permite ver que uma pessoa
  -- travou três vezes seguidas antes de alguém arrumar o cadastro dela.
  resolvido_em  timestamptz,

  primary key (competencia, codigo_rh)
);

comment on table public.folha_recusas is
  'Uma linha por pessoa e competência que NÃO entrou no Omie. `resolvido_em` nulo = ainda falta.';

create index if not exists folha_recusas_abertas
  on public.folha_recusas (competencia)
  where resolvido_em is null;

alter table public.folha_recusas enable row level security;

-- Mesmo padrão das outras tabelas internas do Hub: quem está logado enxerga.
-- O cargo 'parcerias' é barrado no AppLayout e nas Edge Functions.
create policy "auth all folha_recusas" on public.folha_recusas
  for all to authenticated using (true) with check (true);
