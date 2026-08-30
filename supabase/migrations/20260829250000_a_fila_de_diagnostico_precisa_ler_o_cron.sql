-- `automacoes_para_diagnosticar` lê `cron.job` para saber o agendamento, e
-- `service_role` não alcança o schema `cron`. A função nasceu INVOKER e o defeito
-- só apareceu quando a Edge Function a chamou de verdade: pelo MCP ela funciona,
-- porque ali a conexão é `postgres`.
--
-- SECURITY DEFINER, como as outras que leem `cron` neste projeto. O `search_path`
-- fixo vem junto — função definer sem search_path é o caminho clássico para
-- alguém plantar uma tabela homônima e ser lido no lugar do original.
create or replace function public.automacoes_para_diagnosticar(p_limite int default 8)
returns table (
  jobname text, status_code int, resposta text, disparado_em timestamptz,
  assinatura text, schedule text, falhas_7d bigint
)
language sql
stable
security definer
set search_path to 'public', 'cron'
as $$
  with ultima as (
    select distinct on (e.jobname)
           e.jobname, e.status_code, e.resposta, e.disparado_em
      from public.automacao_execucao e
     where e.disparado_em > now() - interval '3 days'
       and e.colhido_em is not null
       and e.jobname not like 'teste%'
     order by e.jobname, e.disparado_em desc
  ),
  ruins as (
    select u.*, public.automacao_assinatura_erro(u.status_code, u.resposta) as assinatura
      from ultima u
     where u.status_code is not null
       and (u.status_code >= 300 or public.corpo_desmente(u.resposta))
  )
  select r.jobname, r.status_code, r.resposta, r.disparado_em, r.assinatura,
         j.schedule,
         (select count(*) from public.automacao_execucao e2
           where e2.jobname = r.jobname
             and e2.disparado_em > now() - interval '7 days'
             and (e2.status_code >= 300 or public.corpo_desmente(e2.resposta))) as falhas_7d
    from ruins r
    left join cron.job j on j.jobname = r.jobname
   where not exists (
           select 1 from public.automacao_diagnostico d
            where d.jobname = r.jobname and d.assinatura = r.assinatura
         )
   order by r.disparado_em desc
   limit greatest(1, least(coalesce(p_limite, 8), 20));
$$;

revoke all on function public.automacoes_para_diagnosticar(int) from public;
revoke all on function public.automacoes_para_diagnosticar(int) from anon;
grant execute on function public.automacoes_para_diagnosticar(int) to authenticated, service_role;
