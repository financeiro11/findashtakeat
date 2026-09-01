-- O DESLIGAMENTO DA EMISSÃO DO ASAAS, COM VOLTA.
--
-- Para o Omie ser o único emissor, duas coisas precisam parar no Asaas, e elas
-- são independentes:
--
--   1. `invoiceSettings` das ASSINATURAS (2.099 em 01/09/2026) — é o ajuste que
--      manda emitir nota a cada cobrança. Removê-lo impede nota NOVA de ser
--      agendada. Não toca na assinatura, na cobrança nem no cliente.
--   2. As notas JÁ AGENDADAS (1.456 em `SCHEDULED` entre 01/09 e 30/09, ~R$ 500
--      mil). São objetos que já existem: remover a config do item 1 NÃO as
--      cancela, e elas disparam sozinhas ao longo do mês.
--
-- Esta tabela é o que faz o item 1 ter volta. `DELETE /subscriptions/{id}/
-- invoiceSettings` não devolve o que apagou, e reconfigurar duas mil assinaturas
-- na mão não é opção — então a foto do JSON vem ANTES, e o desligamento só
-- acontece depois que ela está gravada. Append-only de propósito: o histórico de
-- quem foi desligado quando é a própria prova do corte.
--
-- `alvo` separa as duas naturezas porque a volta é diferente: assinatura se
-- religa reaplicando `config`; nota agendada cancelada não se "descancela" (e
-- nem precisa — quem emite agora é o Omie).

create table if not exists public.asaas_nf_desligamento (
  id           uuid primary key default gen_random_uuid(),
  criado_em    timestamptz not null default now(),
  alvo         text not null check (alvo in ('assinatura', 'nota_agendada')),
  referencia   text not null,              -- id da assinatura ou da nota no Asaas
  -- A FOTO. Para assinatura é o `invoiceSettings` inteiro, lido segundos antes de
  -- apagar; é ela que permite religar. Nulo só quando não havia o que fotografar
  -- (404 = a assinatura já não emitia), e isso também é informação.
  config       jsonb,
  ok           boolean not null default false,
  erro         text,
  operador     text
);

comment on table public.asaas_nf_desligamento is
  'Rastro do desligamento da emissão de NFS-e do Asaas. Guarda a configuração ANTES de removê-la — é o que torna o corte reversível.';

create index if not exists asaas_nf_desligamento_alvo_idx
  on public.asaas_nf_desligamento (alvo, criado_em desc);
-- Responde "esta assinatura já foi tratada?" sem varrer a tabela: é a guarda que
-- torna a rodada retomável, já que ela roda em levas contra o relógio da Edge.
create index if not exists asaas_nf_desligamento_ref_idx
  on public.asaas_nf_desligamento (referencia) where ok;

alter table public.asaas_nf_desligamento enable row level security;

-- Leitura para quem está logado; escrita só pela service role (a função). Sem a
-- policy de leitura a tabela responde VAZIO para a tela, sem erro nenhum — o
-- modo de falha mais caro que este projeto já teve.
drop policy if exists "asaas_nf_desligamento_leitura" on public.asaas_nf_desligamento;
create policy "asaas_nf_desligamento_leitura"
  on public.asaas_nf_desligamento for select
  to authenticated using (true);

revoke all on public.asaas_nf_desligamento from anon;

-- ---------------------------------------------------------------------------
-- A FILA DE RECUSAS QUE PRECISAM DE GENTE.
--
-- Com o Asaas desligado, a recusa da prefeitura deixa de ser um contratempo e
-- passa a ser um cliente SEM NOTA NENHUMA — antes o Asaas cobria o vão. Por isso
-- ela precisa chegar a alguém, e não esperar que alguém abra a tela.
--
-- Só entra o que é acionável: OS faturada, recusada, e ainda sem nota. O
-- `motivo_curto` traduz o código da prefeitura para o que a pessoa tem de fazer,
-- porque "E0240" não diz a ninguém que o problema é o CEP do cliente.
create or replace function public.nfse_recusas_a_tratar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, emitivel boolean
)
language sql
stable
set search_path to 'public'
as $function$
  select o.n_cod_os, o.c_num_os, o.c_cod_int_os, o.cnpj_cpf,
         coalesce(en.nome, '—'),
         o.valor, o.data_faturamento,
         coalesce(o.nfse_mensagem, '(sem mensagem)'),
         case
           when o.nfse_mensagem ilike '%E0240%'  then 'CEP do cliente não confere com o município'
           when o.nfse_mensagem ilike '%E0921%'
             or o.nfse_mensagem ilike '%E0922%'  then 'Código do município do cliente'
           when o.nfse_mensagem ilike '%E0207%'  then 'CPF não existe no cadastro da Receita'
           when o.nfse_mensagem ilike '%E1235%'  then 'Telefone do cliente inválido'
           when o.nfse_mensagem ilike '%falta preencher%' then 'Cadastro incompleto no Omie'
           when o.nfse_mensagem ilike '%403%'
             or o.nfse_mensagem ilike '%Nenhuma resposta%'
             or o.nfse_mensagem ilike '%sobrecarregados%' then 'Instabilidade da prefeitura — reenviar resolve'
           else 'Ver mensagem da prefeitura'
         end,
         en.cep, en.cep_generico, en.emitivel
  from public.nf_os_omie o
  left join public.omie_clientes_endereco en on en.codigo = o.n_cod_cli
  where o.cancelada = false
    and o.nfse_status = '003'
    and coalesce(o.nfse_numero, '') = ''
    and o.data_faturamento >= current_date - make_interval(days => greatest(p_dias, 1))
  order by o.data_faturamento desc, o.valor desc;
$function$;

comment on function public.nfse_recusas_a_tratar(integer) is
  'Notas que a prefeitura recusou e ainda precisam de conserto de cadastro + reenvio manual no Omie. Alimenta o e-mail diário e a fila da tela.';
