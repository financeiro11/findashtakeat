-- QUEM JÁ FOI AVISADO NÃO É AVISADO DE NOVO.
--
-- Com o Asaas desligado (01/09/2026), a recusa da prefeitura deixou de ser um
-- contratempo e virou um cliente SEM NOTA NENHUMA: antes o Asaas cobria o vão.
-- O aviso diário existe por isso.
--
-- Esta tabela é o que o torna diário em vez de repetitivo. Sem ela, o e-mail
-- reenviaria as mesmas 56 recusas todo dia até alguém consertá-las — e um alerta
-- que repete o que já foi lido é um alerta que se aprende a ignorar, que é o
-- mesmo que não ter alerta.
--
-- A chave é a OS e não a cobrança porque é a OS que carrega a recusa, e é ela
-- que precisa do "Reenviar NFS-e" na tela do Omie.

create table if not exists public.nfse_recusa_avisada (
  n_cod_os    bigint primary key,
  avisado_em  timestamptz not null default now(),
  motivo      text
);

comment on table public.nfse_recusa_avisada is
  'OS recusadas que já entraram num aviso. Impede o e-mail diário de repetir o que já foi comunicado.';

alter table public.nfse_recusa_avisada enable row level security;

drop policy if exists "nfse_recusa_avisada_leitura" on public.nfse_recusa_avisada;
create policy "nfse_recusa_avisada_leitura"
  on public.nfse_recusa_avisada for select to authenticated using (true);

revoke all on public.nfse_recusa_avisada from anon;

-- ---------------------------------------------------------------------------
-- O QUE ENTRA NO AVISO DE HOJE: recusa acionável que ninguém ainda viu.
--
-- Separada da `nfse_recusas_a_tratar` de propósito. Aquela responde "o que está
-- pendente?" e alimenta a TELA, onde ver de novo o que já se viu é útil. Esta
-- responde "o que preciso contar a alguém?", e aí repetir é ruído.
create or replace function public.nfse_recusas_a_avisar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, emitivel boolean
)
language sql
stable
set search_path to 'public'
as $function$
  select r.*
  from public.nfse_recusas_a_tratar(p_dias) r
  where not exists (
    select 1 from public.nfse_recusa_avisada a where a.n_cod_os = r.n_cod_os
  )
  order by r.valor desc;
$function$;

comment on function public.nfse_recusas_a_avisar(integer) is
  'As recusas que ainda não entraram em nenhum aviso — o corpo do e-mail diário.';
