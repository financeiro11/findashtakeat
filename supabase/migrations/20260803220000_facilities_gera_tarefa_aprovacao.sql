-- Solicitação do Facilities que entra em aprovação vira tarefa em /tarefas.
--
-- Pedido do usuário: quando o Facilities sobe algo para o OK dele, nasce uma
-- tarefa para o dia seguinte, responsável Henrique, prioridade Alta. E quando
-- ele decide (aprova ou recusa), a tarefa se fecha sozinha — senão a lista
-- acumularia compra já resolvida e ele passaria a limpar na mão o que a
-- automação criou.
--
-- POR QUE TRIGGER NO BANCO, E NÃO CÓDIGO NA TELA: uma solicitação chega em
-- "aguardando_aprovacao" por mais de um caminho — automaticamente quando uma
-- cotação passa de R$ 500 (Solicitacoes.tsx) e manualmente pelo seletor de
-- status da mesma tela. Amarrar no front obrigaria a lembrar de cada ponto, hoje
-- e no futuro. No banco, qualquer caminho passa por aqui.

-- Liga a tarefa à solicitação que a gerou. É o que permite não duplicar e achar
-- a tarefa certa na hora de fechar. Nullable: tarefa criada à mão não tem origem.
alter table public.tarefas
  add column if not exists facilities_solicitacao_id uuid
  references public.facilities_solicitacoes(id) on delete set null;

create index if not exists idx_tarefas_facilities_solic
  on public.tarefas(facilities_solicitacao_id)
  where facilities_solicitacao_id is not null;

create or replace function public.facilities_tarefa_de_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entrou   boolean;
  v_decidiu  boolean;
  v_ordem    int;
  v_tarefa   uuid;
  v_titulo   text;
begin
  -- Entrou em aprovação agora? (INSERT já nesse status também conta.)
  v_entrou := new.status = 'aguardando_aprovacao'
              and (tg_op = 'INSERT' or old.status is distinct from 'aguardando_aprovacao');

  -- Saiu de aprovação por decisão do admin.
  v_decidiu := tg_op = 'UPDATE'
               and new.status in ('aprovado', 'recusado')
               and old.status is distinct from new.status;

  if v_entrou then
    -- Uma tarefa ABERTA por solicitação. O status oscila (entra cotação nova,
    -- alguém mexe no seletor e volta atrás), e sem esta guarda a mesma compra
    -- viraria três tarefas.
    if exists (
      select 1 from public.tarefas
      where facilities_solicitacao_id = new.id and status <> 'Concluído'
    ) then
      return new;
    end if;

    v_titulo := 'Aprovar compra: ' || coalesce(new.titulo, '(sem título)')
                -- Máscara com separadores LITERAIS (',' e '.') e não com G/D:
                -- os locale-aware saem no formato do banco, que é en_US, e o
                -- título vinha 'R$ 1,234.50'. O translate inverte para pt-BR.
                || case when new.valor is not null
                        then ' — R$ ' || translate(trim(to_char(new.valor, 'FM999,999,990.00')), ',.', '.,')
                        else '' end;

    select coalesce(max(ordem), 0) + 1 into v_ordem from public.tarefas;

    insert into public.tarefas (
      ordem, titulo, responsavel, status, prioridade, prazo, observacao,
      subtarefas, facilities_solicitacao_id
    ) values (
      v_ordem,
      v_titulo,
      'Henrique',
      'Backlog',
      'Alta',
      -- "Dia seguinte" é o de quem lê, não o do servidor: às 22h de Brasília o
      -- banco (UTC) já virou o dia, e o prazo cairia depois de amanhã.
      (now() at time zone 'America/Sao_Paulo')::date + 1,
      'Aberta automaticamente pelo Facilities.'
        || coalesce(' Solicitante: ' || nullif(btrim(new.solicitante), '') || '.', '')
        || coalesce(' Categoria: ' || nullif(btrim(new.categoria), '') || '.', '')
        || coalesce(' Observação: ' || nullif(btrim(new.observacao), '') || '.', '')
        || ' Decidir em Facilities › Solicitações.',
      '[]'::jsonb,
      new.id
    )
    returning id into v_tarefa;

    -- Mesmo log da aba "Histórico" de /tarefas. `usuario` fica nulo de propósito:
    -- quem criou foi a automação, não uma pessoa.
    insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao)
    values (v_tarefa, v_titulo, 'criada', 'Criada automaticamente: solicitação do Facilities entrou em aprovação');

  elsif v_decidiu then
    update public.tarefas
       set status = 'Concluído',
           concluido_em = now(),
           updated_at = now()
     where facilities_solicitacao_id = new.id
       and status <> 'Concluído';

    if found then
      insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao)
      select id, titulo, 'editada',
             'Concluída automaticamente: solicitação ' ||
             case when new.status = 'aprovado' then 'aprovada' else 'recusada' end ||
             ' no Facilities'
        from public.tarefas
       where facilities_solicitacao_id = new.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_facilities_tarefa_aprovacao on public.facilities_solicitacoes;
create trigger trg_facilities_tarefa_aprovacao
  after insert or update of status on public.facilities_solicitacoes
  for each row
  execute function public.facilities_tarefa_de_aprovacao();
