-- O AVISO DE RECUSA PAROU DE SAIR PORQUE A LISTA GANHOU UMA COLUNA.
--
-- Em 10/09/2026, às 11:30 UTC, o `nf-recusas-avisar` respondeu:
--
--     nfse_recusas_a_avisar: return type mismatch in function declared to return record
--
-- Zero falhas nos seis dias anteriores. O que mudou foi de manhã, em
-- `20260910190000`: `nfse_recusas_a_tratar` ganhou `cep_valido` e passou a
-- devolver 16 colunas. `nfse_recusas_a_avisar` faz `select r.*` dela e continua
-- declarando 15 — e `select r.*` casa por POSIÇÃO, não por nome.
--
-- O comentário daquela migration diz "o único dependente é
-- `nfse_recusas_reemitiveis`". Não era: são dois. O `reemitiveis` sobreviveu
-- justamente porque escolhe colunas pelo nome; o `a_avisar` quebrou porque não.
-- E o Postgres não avisa na hora — função `language sql` não tem o corpo
-- rastreado por dependência, então o `drop`+`create` da outra passou limpo e a
-- conta só estourou na primeira chamada, doze horas depois, sem e-mail nenhum.
--
-- DUAS CORREÇÕES, e a segunda é a que importa:
--
--   1. `cep_valido` entra na lista, no mesmo lugar — o aviso volta a sair.
--   2. O corpo passa a NOMEAR as colunas em vez de `r.*`. Assim a próxima coluna
--      acrescentada em `nfse_recusas_a_tratar` atravessa esta função sem derrubá-la:
--      ela simplesmente não é repassada, que é o comportamento certo para uma
--      função cuja assinatura é contrato com quem monta o e-mail.
--
-- De brinde, o `revoke` que faltava: `nfse_recusas_a_avisar` estava com `=X`
-- (PUBLIC, e portanto `anon`) porque foi criada sem ele — a armadilha do grant
-- automático. A `_a_tratar` ao lado já vinha revogada; esta ficou para trás.

drop function if exists public.nfse_recusas_a_avisar(integer);

create function public.nfse_recusas_a_avisar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, cep_valido boolean, emitivel boolean,
  situacao text, consertado_em timestamptz, o_que_foi_feito text
)
language sql
stable
set search_path to 'public'
as $function$
  select r.n_cod_os, r.c_num_os, r.id_cobranca, r.cnpj_cpf, r.nome,
         r.valor, r.data_faturamento, r.motivo, r.motivo_curto,
         r.cep, r.cep_generico, r.cep_valido, r.emitivel,
         r.situacao, r.consertado_em, r.o_que_foi_feito
  from public.nfse_recusas_a_tratar(p_dias) r
  where not exists (
    select 1 from public.nfse_recusa_avisada a where a.n_cod_os = r.n_cod_os
  )
  order by
    case r.situacao when 'consertado' then 1 when 'precisa_de_gente' then 2 else 3 end,
    r.valor desc;
$function$;

comment on function public.nfse_recusas_a_avisar(integer) is
  'As recusas que ainda não entraram em nenhum aviso — o corpo do e-mail diário. Escolhe as colunas por NOME: coluna nova em nfse_recusas_a_tratar não a derruba.';

revoke all on function public.nfse_recusas_a_avisar(integer) from public, anon;
grant execute on function public.nfse_recusas_a_avisar(integer) to authenticated, service_role;
