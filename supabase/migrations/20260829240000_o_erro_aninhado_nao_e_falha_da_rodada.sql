-- O `"error"` aninhado não é falha da rodada.
--
-- A primeira versão de `automacoes_para_diagnosticar` (migração anterior, mesma
-- leva) procurava `"error"\s*:\s*"..."` com regex no corpo INTEIRO da resposta.
-- E o corpo inteiro inclui os resultados por item:
--
--   {"status":"ok","alvos":20,"corrigidos":16,"resultados":[
--      {"doc":"...","error":"CEP genérico"}, ... ]}
--
-- Três rodadas SAUDÁVEIS entraram na fila de diagnóstico por causa disso —
-- `nf-preparar-cadastros`, `nf-corrigir-recusados` e `omie-clientes-criar-diario`
-- — que são justamente as funções que relatam bem, item a item. Punir quem
-- relata detalhe é o pior incentivo possível.
--
-- É EXATAMENTE O ERRO QUE `corpoDesmente` EVITA do lado do TypeScript, e o
-- comentário de lá já dizia por quê: "procurar a palavra erro solta no corpo
-- pintaria de vermelho o `{"ok":true,"falhas":0,"erros":[]}` que é como quase
-- toda função daqui relata sucesso". A regra vale nos dois lados: **só as chaves
-- do TOPO do objeto contam**.
--
-- Aqui isso se faz com um cast seguro para jsonb e três testes em `->>`. Corpo
-- truncado ou não-JSON não vira falha por si — o status decide, como na tela.

/** Cast para jsonb que devolve NULL em vez de estourar. A `resposta` é truncada
    no armazenamento, então corpo inválido é normal, não excepcional. */
create or replace function public.jsonb_ou_nulo(p text)
returns jsonb
language plpgsql
immutable
as $$
begin
  return p::jsonb;
exception when others then
  return null;
end;
$$;

/** O corpo se desmente? Só as três formas explícitas, no topo do objeto. */
create or replace function public.corpo_desmente(p_resposta text)
returns boolean
language sql
immutable
as $$
  select case
    when public.jsonb_ou_nulo(p_resposta) is null then false
    when jsonb_typeof(public.jsonb_ou_nulo(p_resposta)) <> 'object' then false
    when public.jsonb_ou_nulo(p_resposta)->>'ok' = 'false' then true
    when coalesce(public.jsonb_ou_nulo(p_resposta)->>'error', '') <> '' then true
    when public.jsonb_ou_nulo(p_resposta)->>'status' = 'erro' then true
    else false
  end;
$$;

comment on function public.corpo_desmente(text) is
  'Gêmeo em SQL do `corpoDesmente` de src/lib/automacoes.ts. Só chaves do TOPO: `ok:false`, `error` não-vazio, `status:"erro"`. Varrer o corpo inteiro marcaria como falha quem relata erro POR ITEM dentro de uma rodada que deu certo.';

create or replace function public.automacoes_para_diagnosticar(p_limite int default 8)
returns table (
  jobname text, status_code int, resposta text, disparado_em timestamptz,
  assinatura text, schedule text, falhas_7d bigint
)
language sql
stable
set search_path to 'public'
as $$
  with ultima as (
    select distinct on (e.jobname)
           e.jobname, e.status_code, e.resposta, e.disparado_em
      from public.automacao_execucao e
     where e.disparado_em > now() - interval '3 days'
       and e.colhido_em is not null
       /* Os disparos de teste não são automações: eles nascem de alguém
          conferindo alguma coisa à mão e morrem no mesmo dia. Diagnosticá-los é
          gastar IA para explicar um experimento. */
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

/* O mesmo conserto na leitura da tela: sem ele, o diagnóstico ficaria "aberto"
   para um cron que voltou a responder ok com `error` aninhado nos resultados. */
create or replace function public.automacao_diagnosticos_abertos()
returns table (
  jobname text, resumo text, causa text, o_que_fazer text, gravidade text,
  ocorrencias integer, primeira_em timestamptz, ultima_em timestamptz
)
language sql
stable
set search_path to 'public'
as $$
  with ultima as (
    select distinct on (e.jobname) e.jobname, e.status_code, e.resposta
      from public.automacao_execucao e
     where e.disparado_em > now() - interval '3 days' and e.colhido_em is not null
     order by e.jobname, e.disparado_em desc
  )
  select d.jobname, d.resumo, d.causa, d.o_que_fazer, d.gravidade,
         d.ocorrencias, d.primeira_em, d.ultima_em
    from public.automacao_diagnostico d
    join ultima u on u.jobname = d.jobname
                 and public.automacao_assinatura_erro(u.status_code, u.resposta) = d.assinatura
   where d.resolvido_em is null
     and (u.status_code >= 300 or public.corpo_desmente(u.resposta))
   order by case d.gravidade when 'alta' then 0 when 'media' then 1 else 2 end, d.ultima_em desc;
$$;

revoke all on function public.automacao_diagnosticos_abertos() from public;
revoke all on function public.automacao_diagnosticos_abertos() from anon;
grant execute on function public.automacao_diagnosticos_abertos() to authenticated, service_role;
