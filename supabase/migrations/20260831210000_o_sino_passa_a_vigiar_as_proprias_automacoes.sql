-- O sino passa a vigiar as próprias automações.
--
-- Pedido do usuário em 31/08/2026, depois que a revisão das edge functions
-- desenterrou três defeitos que estavam rodando em silêncio: a conta da OpenAI
-- sem crédito, nove `statement timeout` por dia no `omie-nfse-sync`, e um cron
-- do `agenda-sync` que ia morrer no gateway sem nunca ter rodado. Nenhum dos
-- três apareceu para ninguém — foram achados por garimpo manual no log.
--
-- ===========================================================================
-- O QUE ESTA SÉRIE ACRESCENTA, JÁ QUE `automacao_diagnostico` EXISTE
--
-- O painel de automações e o modal do AvisoGrave já reagem a FALHA: se um job
-- respondeu não-2xx, acende. O problema é que isso não distingue o job que
-- quebrou hoje do job que sempre falha um pouco.
--
-- O radar de preços e a varredura de editais raspam a internet: eles erram por
-- natureza, algumas vezes por dia, e sempre erraram. Quem olha o painel aprende
-- a ignorar o vermelho deles — e, no dia em que o vermelho significar alguma
-- coisa, vai ignorar também. É o mesmo mecanismo pelo qual um aviso que
-- interrompe demais vira clique automático em "Entendi".
--
-- A banda mede outra coisa: quantas falhas ESTE job costuma ter por dia, e se
-- hoje fugiu disso. Três falhas no radar não é notícia. Três falhas num job que
-- nunca falhou é. Nenhum limiar fixo consegue dizer as duas coisas ao mesmo
-- tempo, porque o normal de cada job é diferente — e é justamente isso que a
-- mediana de cada série resolve sozinha, sem ninguém cadastrar limiar nenhum.
--
-- ===========================================================================
-- O HISTÓRICO AINDA É CURTO, E ISSO ESTÁ CERTO
--
-- `automacao_execucao` só guarda desde 27/08/2026 — quatro dias. Com
-- MIN_HISTORICO = 4 no motor, a maioria dos jobs vai devolver `sem_historico`
-- nas primeiras rodadas e NÃO vai gerar sinal. É o comportamento desejado:
-- "não sei" é diferente de "está tudo bem", e um alarme tirado de dois pontos
-- não vale o susto. A série ganha precisão sozinha conforme os dias passam.

/* ===================================================================== */
/* ====================== a medição, dia a dia, por job ================= */
/* ===================================================================== */

/**
 * Execuções e falhas por job e por dia.
 *
 * O QUE CONTA COMO FALHA é a mesma régua do painel de automações, e não uma
 * nova: status >= 300 OU `corpo_desmente(resposta)` — a função que existe
 * porque um job pode responder 200 e trazer o erro dentro do corpo. Ter duas
 * definições de "falhou" no mesmo sistema é garantir que uma das telas minta.
 *
 * SÓ EXECUÇÃO JÁ COLHIDA (`colhido_em is not null`). A linha nasce no disparo e
 * só recebe `status_code` quando o coletor passa, de 5 em 5 minutos. Contar a
 * não-colhida como sucesso faria o dia corrente parecer sempre melhor que os
 * anteriores; contá-la como falha faria o contrário. Fora da conta é o certo.
 */
create or replace function public.sinal_automacoes_dia(p_dias integer default 14)
returns table (jobname text, dia date, execucoes bigint, falhas bigint)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select e.jobname,
         (e.disparado_em at time zone 'UTC')::date as dia,
         count(*) as execucoes,
         count(*) filter (
           where e.status_code >= 300 or public.corpo_desmente(e.resposta)
         ) as falhas
    from public.automacao_execucao e
   where e.disparado_em >= now() - make_interval(days => greatest(p_dias, 1))
     and e.colhido_em is not null
   group by 1, 2;
$fn$;

comment on function public.sinal_automacoes_dia(integer) is
  'Execuções e falhas por job e por dia, com a MESMA régua de falha do painel de automações. Alimenta a série `automacoes.falhas` do vigia.';

revoke all on function public.sinal_automacoes_dia(integer) from public;
revoke all on function public.sinal_automacoes_dia(integer) from anon;
grant execute on function public.sinal_automacoes_dia(integer) to authenticated, service_role;

/* ===================================================================== */
/* ============================== a série =============================== */
/* ===================================================================== */

/* `historico_meses` aqui vale DIAS, e o nome da coluna fica devendo. Ela nasceu
   para a cobertura de nota, que é mensal; esta série é diária. O campo sempre
   quis dizer "quantas unidades de histórico olhar para trás", e a unidade é a
   da série — quem lê `14` numa série diária não se confunde, mas quem lê o nome
   da coluna sim, então fica registrado aqui e no comentário da coluna abaixo. */
comment on column public.sinal_serie.historico_meses is
  'Quantas unidades de histórico entram na banda. A UNIDADE É A DA SÉRIE: meses para as mensais (notas.cobertura), dias para as diárias (automacoes.falhas). O nome da coluna ficou do primeiro caso.';

-- `min_relativo` alto (1.0 = o dobro do normal) porque falha de automação é
-- ruidosa por natureza: uma a mais que a mediana não é notícia, o dobro é.
-- `direcao = 'acima'`: falhar MENOS que o normal é uma bênção, não um sinal.
-- `gravidade = 'media'`: a falha grave já tem o modal do AvisoGrave; aqui o
-- assunto é tendência, e tendência não interrompe ninguém.
insert into public.sinal_serie
  (serie, modulo, titulo, descricao, rota, direcao, gravidade, min_relativo, historico_meses)
values
  ('automacoes.falhas', 'automacoes', 'Automação falhando fora do normal',
   'Falhas de um job hoje contra a mediana de falhas diárias dele mesmo, com a mesma régua de falha do painel.',
   '/automacoes/painel', 'acima', 'media', 1.0, 14)
on conflict (serie) do nothing;
