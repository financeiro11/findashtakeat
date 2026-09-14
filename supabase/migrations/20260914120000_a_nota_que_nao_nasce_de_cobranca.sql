-- A NOTA QUE NÃO NASCE DE COBRANÇA (14/09/2026)
--
-- O pedido: emitir NFS-e avulsa (1) puxando o cliente do Asaas SEM haver
-- cobrança lá e (2) digitando o tomador inteiro no Hub, sem relação nenhuma com
-- o Asaas.
--
-- O PROBLEMA DE DESENHO É O CARIMBO. A esteira inteira é chaveada pelo id da
-- cobrança: `cCodIntOS = pay_…` na OS, `nf_emissoes.id_asaas`, o casamento do
-- painel. Nota sem cobrança precisa de um carimbo PRÓPRIO, único por nota, e ele
-- é o `id` desta tabela: `avl_` + aleatório.
--
-- POR QUE `avl_` NÃO MEXE EM NADA QUE JÁ FUNCIONA — conferido antes de escolher:
--   • As sombras anti-duplicata da fila, das candidatas e do painel casam por
--     CNPJ+valor+mês SÓ OS SEM CARIMBO (`c_cod_int_os is null or = ''`). Uma
--     nota avulsa de R$ 408 não esconde a mensalidade de R$ 408 do mesmo cliente.
--   • A baixa do título (`baixarAdiantamentos`) e o anexo na cobrança filtram
--     `pay_%` — não há cobrança do Asaas para baixar nem onde anexar.
--   • O `fecharEmProcessamento` e o `fecharRecusadas` fecham o diário por
--     `n_cod_os`, não pelo id — o número da nota volta ao Registro igual.
--
-- O QUE FICA DIFERENTE, E É DE PROPÓSITO: o título a receber que o Omie cria ao
-- faturar a OS fica EM ABERTO. Não existe pagamento no Asaas para dizer que o
-- dinheiro entrou, e baixar sem saber é registrar recebimento que pode não ter
-- existido.

create table if not exists public.nf_notas_sem_cobranca (
  id           text primary key check (id ~ '^avl_[a-z0-9]{12,40}$'),
  /* De onde veio o tomador. `asaas` só PREENCHEU o formulário; o que vale para a
     nota é o `tomador` gravado aqui, que é o que a pessoa conferiu. */
  origem       text not null check (origem in ('asaas', 'manual')),
  id_customer  text,
  doc          text not null check (doc ~ '^([0-9]{11}|[0-9]{14})$'),
  nome         text not null,
  /* No formato de cliente do Asaas (name, cpfCnpj, email, address, …) porque é o
     que o cadastro do Omie (`montarCadastro`) já sabe ler. Uma segunda régua de
     cadastro só para o tomador digitado divergiria da primeira. */
  tomador      jsonb not null,
  valor        numeric(14, 2) not null check (valor > 0),
  descricao    text not null check (char_length(btrim(descricao)) between 3 and 200),
  vencimento   date not null,
  usuario      uuid,
  operador     text,
  criado_em    timestamptz not null default now(),
  check (origem = 'manual' or id_customer is not null)
);

create index if not exists nf_notas_sem_cobranca_doc_idx
  on public.nf_notas_sem_cobranca (doc, criado_em desc);

comment on table public.nf_notas_sem_cobranca is
  'NFS-e emitida pelo Hub SEM cobrança no Asaas. O id (avl_…) é o carimbo cCodIntOS da OS e o id_asaas do diário. Escrita só pela Edge Function omie-nfse-sync (sem_cobranca_preparar).';

alter table public.nf_notas_sem_cobranca enable row level security;

drop policy if exists nf_notas_sem_cobranca_leitura on public.nf_notas_sem_cobranca;
create policy nf_notas_sem_cobranca_leitura on public.nf_notas_sem_cobranca
  for select to authenticated using (public.pode_ler('conciliacao'));

-- Sem policy de escrita: quem grava é a função, com service role, depois de
-- conferir documento, cadastro e valor. Inserir direto pularia a conferência.
revoke all on public.nf_notas_sem_cobranca from anon;
revoke insert, update, delete on public.nf_notas_sem_cobranca from authenticated;


/* O REGISTRO DE EMISSÕES MOSTRA O NOME E O VALOR DELA.
 *
 * O log junta o diário com a cobrança do Asaas; sem cobrança, a linha sairia
 * "—" e sem valor. Mesma assinatura e mesmo retorno, então `create or replace`
 * basta (o `drop` só é obrigatório quando o `returns table` muda). */
create or replace function public.notas_fiscais_log(p_dias integer default 14, p_limite integer default 300)
returns table (
  criado_em timestamptz, id_asaas text, cliente text, valor numeric,
  acao text, resultado text, nfse_numero text, nfse_chave text,
  motivo text, operador text, n_cod_os bigint, avulsa boolean
)
language sql stable set search_path to 'public'
as $$
select e.criado_em, e.id_asaas,
       coalesce(c.dados->>'name', c.dados->>'company', s.nome, '—') as cliente,
       coalesce(p.valor, s.valor), e.acao, e.resultado, e.nfse_numero,
       case when e.nfse_numero is not null and o.nfse_numero = e.nfse_numero
            then o.nfse_verificacao end,
       e.erro, e.operador, e.n_cod_os, e.avulsa
from public.nf_emissoes e
left join public.asaas_cache p on p.tipo = 'payment' and p.id_asaas = e.id_asaas
left join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
left join public.nf_notas_sem_cobranca s on s.id = e.id_asaas
left join public.nf_os_omie o on o.n_cod_os = e.n_cod_os
where e.criado_em >= now() - make_interval(days => greatest(p_dias, 1))
order by e.criado_em desc
limit greatest(p_limite, 1);
$$;

revoke all on function public.notas_fiscais_log(integer, integer) from public, anon;
grant execute on function public.notas_fiscais_log(integer, integer) to authenticated, service_role;
