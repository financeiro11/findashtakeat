-- ============================================================================
-- As perguntas que o guia do Hub não respondeu.
--
-- O QUE MOTIVOU (13/09/2026). Desde 12/09 o Assistente responde "como se faz" a
-- partir de um guia escrito (`_shared/assistente/guia.ts`), e diz com honestidade
-- quando o guia não cobre a pergunta. Isso trocou um erro grave (procedimento
-- inventado) por um discreto: a resposta honesta é um beco sem saída que ninguém
-- vê. A pessoa desiste, e a pergunta some. E quem mais cai nesse beco é quem
-- acabou de ganhar a bolinha — Facilities, a Consultoria Estratégica, os Heads —,
-- justamente o público para quem o guia foi escrito no escuro: até 12/09 havia
-- 28 perguntas em 90 dias, quase todas do admin, e uma só de "como fazer".
--
-- NÃO GRAVA NADA NOVO. O `assistente-responder` já registrava tudo em
-- `assistente_execucao`: a pergunta, a consulta e os avisos. A consulta
-- `como_fazer` avisa em texto quando nenhum verbete casou e quando o verbete
-- principal não tem passo a passo — a lacuna já estava no banco, só não tinha
-- quem lesse. Esta view é a leitura. Decisão do usuário: só a consulta, sem tela;
-- vira tela se a lista crescer.
--
-- O ACOPLAMENTO É POR TEXTO, e esse é o ponto fraco — por isso ele tem teste. As
-- duas frases saem de constantes em `_shared/assistente/consultas-guia.ts`
-- (AVISO_SEM_VERBETE, AVISO_SEM_PASSOS), e `src/lib/guia.test.ts` falha se esta
-- migration deixar de conter as duas. Sem isso, reescrever o aviso faria a view
-- parar de classificar em silêncio: ela voltaria VAZIA, que se lê exatamente como
-- "o guia respondeu tudo".
--
-- OS QUATRO TIPOS
--   sem_verbete        nenhum verbete casou; a resposta só apontou a tela.
--   sem_passo_a_passo  o verbete principal existe, mas sem passo a passo escrito
--                      (`verbete` diz qual).
--   sem_consulta       o planejador não achou consulta nenhuma e a pergunta foi
--                      para o caminho geral (`ai-chat`). Inclui pergunta de DADO
--                      que nenhuma consulta cobre — também é lacuna.
--   recusada_fora      recusada como fora do trabalho. Entra para auditar a
--                      recusa: pergunta legítima barrada é lacuna do pior tipo,
--                      porque a pessoa ainda ouve um "não".
-- Pergunta barrada por ACESSO fica de fora: ali o Assistente respondeu certo.
--
-- O QUE A VIEW NÃO VÊ. Pergunta com imagem vai direto ao `ai-chat`, sem passar
-- pelo roteador, e não é registrada em `assistente_execucao`.
--
-- PRIVACIDADE E ACESSO. A pergunta é texto livre ("quanto pagamos para fulano?").
-- A view traz o PERFIL, não o nome: o que se quer saber é que público está sem
-- resposta, não quem perguntou. E ela fica fechada — só service_role e o CLI
-- leem. Duas travas, porque uma view roda por padrão com o privilégio do DONO e
-- furaria a policy "cada um vê o próprio histórico" de `assistente_execucao`:
--   • security_invoker = on: quem chegar pelo PostgREST vê só o que a RLS de
--     baixo deixaria;
--   • revoke de public, anon e authenticated, cada um na sua instrução: ninguém
--     chega pelo PostgREST.
--
-- COMO LER
--   select dia, perfil, tipo, verbete, pergunta
--     from public.assistente_lacunas_do_guia
--    where criado_em >= now() - interval '14 days'
--    order by criado_em desc;
-- ============================================================================

create or replace view public.assistente_lacunas_do_guia
with (security_invoker = on) as
with base as (
  select e.criado_em,
         e.user_id,
         e.pergunta,
         coalesce(e.consulta, '') as consulta,
         e.resposta,
         -- `avisos` é um array de textos; vira uma string só para o `like`. O
         -- `case` protege de linha antiga ou torta que não seja array — sem ele,
         -- uma linha dessas derrubaria a view inteira.
         coalesce((
           select string_agg(a, ' | ')
             from jsonb_array_elements_text(
               case when jsonb_typeof(e.avisos::jsonb) = 'array'
                    then e.avisos::jsonb else '[]'::jsonb end
             ) as a
         ), '') as avisos
    from public.assistente_execucao e
)
select b.criado_em,
       (b.criado_em at time zone 'America/Sao_Paulo')::date as dia,
       coalesce(p.perfil, '(sem perfil)') as perfil,
       case
         when b.avisos like '%Nenhum verbete do guia cobre esta pergunta%' then 'sem_verbete'
         when b.avisos like '%mas ainda não tem o passo a passo%'          then 'sem_passo_a_passo'
         when b.consulta = 'fora_de_escopo'                                 then 'recusada_fora'
         else 'sem_consulta'
       end as tipo,
       -- O aviso escreve o título entre aspas: "O guia descreve o que é "X", mas…".
       substring(b.avisos from 'o que é "([^"]+)"') as verbete,
       b.pergunta,
       b.consulta,
       left(b.resposta, 300) as resposta
  from base b
  left join public.profiles p on p.user_id = b.user_id
 where b.avisos like '%Nenhum verbete do guia cobre esta pergunta%'
    or b.avisos like '%mas ainda não tem o passo a passo%'
    or b.consulta = 'fora_de_escopo'
    or (b.consulta = 'nenhuma' and b.avisos not like '%fora do seu acesso%');

comment on view public.assistente_lacunas_do_guia is
  'Perguntas que o guia do Hub não respondeu (sem verbete, sem passo a passo, sem consulta, '
  'recusada como fora do trabalho). Classifica por TEXTO dos avisos de consultas-guia.ts — '
  'guia.test.ts trava as duas pontas. Fechada: só service_role/CLI. Traz perfil, não nome.';

revoke all on public.assistente_lacunas_do_guia from public;
revoke all on public.assistente_lacunas_do_guia from anon;
revoke all on public.assistente_lacunas_do_guia from authenticated;
grant select on public.assistente_lacunas_do_guia to service_role;
