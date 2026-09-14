-- ============================================================================
-- Automação que foi construída e hoje não roda mais.
--
-- O `status` do catálogo conta a HISTÓRIA da construção (Ideias → A fazer → Em
-- andamento → Em teste → Rodando) e não pode ser reescrito para dizer "parou":
-- quem tirasse o "Rodando" jogaria a automação de volta na linha de produção
-- como trabalho pendente, apagaria o registro de que ela chegou a existir e
-- ainda mudaria a cor do nó na árvore para "ideia". Por isso "está em uso hoje"
-- é uma coluna à parte — as duas perguntas são diferentes e as duas têm
-- resposta própria.
--
-- `ativa` nasce `true` para todo mundo: nenhuma das 45 linhas de hoje muda de
-- comportamento até alguém desligar alguma na mão.
-- ============================================================================

alter table public.automacoes_catalogo
  add column if not exists ativa boolean not null default true,
  add column if not exists desativada_em timestamptz,
  add column if not exists desativada_motivo text;

comment on column public.automacoes_catalogo.ativa is
  'Está em uso hoje? false = foi construída e hoje não roda. Não confundir com status, que guarda até onde a construção chegou.';
comment on column public.automacoes_catalogo.desativada_em is
  'Quando parou de rodar. Carimbado pelo gatilho, não pela tela.';
comment on column public.automacoes_catalogo.desativada_motivo is
  'Por que parou — o que a tela mostra seis meses depois, quando ninguém lembra.';

-- A data é carimbada por gatilho, e não pelo front: "desde quando está
-- desligada" é metade da informação que se procura depois, e é exatamente a que
-- se esquece de gravar quando o desligamento acontece de outra tela, de um
-- script ou do painel do Supabase. Reativar limpa o carimbo, senão a próxima
-- parada herdaria em silêncio o motivo da anterior.
create or replace function public.automacoes_catalogo_carimbo_desativacao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ativa is distinct from old.ativa then
    if new.ativa then
      new.desativada_em := null;
      new.desativada_motivo := null;
    else
      new.desativada_em := coalesce(new.desativada_em, now());
    end if;
  end if;
  return new;
end;
$$;

-- Função nova em `public` nasce alcançável pela anon key (ver a migration
-- 20260830233000). Esta só faz sentido como gatilho, mas fechar é uma linha.
revoke all on function public.automacoes_catalogo_carimbo_desativacao() from public;
revoke all on function public.automacoes_catalogo_carimbo_desativacao() from anon;

drop trigger if exists automacoes_catalogo_carimbo_desativacao on public.automacoes_catalogo;
create trigger automacoes_catalogo_carimbo_desativacao
  before update on public.automacoes_catalogo
  for each row
  execute function public.automacoes_catalogo_carimbo_desativacao();
