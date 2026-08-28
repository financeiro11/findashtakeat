/* ============================================================================
 * A ESTEIRA DAS NOTAS GANHA O DIA INTEIRO — porque a fila cresceu 13 vezes.
 *
 * O QUE MUDOU DO OUTRO LADO. A migration anterior
 * (`20260827530000_o_asaas_parou_de_emitir_a_parcelada`) abriu a fila para
 * cobrança sem assinatura, e ela saltou de **74 para 1.004** (R$ 368.768). O
 * motor não mudou; o que mudou é que agora existe trabalho para ele.
 *
 * A CONTA DA VAZÃO, com números medidos e não estimados:
 *
 *   • Uma rodada trata `teto_rodada` = 20 cobranças e leva ~116s dos 150s do
 *     worker. Não dá para aumentar o tamanho da rodada: são duas chamadas Omie
 *     seriais por cobrança (IncluirOS + TrocarEtapaOS), e 25 já encostam no teto
 *     do worker. O que dá para aumentar é o NÚMERO de rodadas.
 *   • A janela era `13,14,15` UTC = 3 horas = 18 rodadas/dia = 360 no papel.
 *     Para 1.004 cobranças, três dias — e o mês fecha em quatro.
 *
 * A janela passa a ser `13-21` UTC (10h às 18h50 de Brasília): 9 horas, 54
 * rodadas, folga de sobra para o acúmulo sair em dois dias sem ninguém empurrar.
 *
 * POR QUE NÃO MADRUGADA ADENTRO. A esteira emite nota fiscal sozinha, e o
 * desenho deste módulo é que isso aconteça enquanto há gente no escritório para
 * ver dar errado. `13-21` UTC é exatamente o horário comercial; 22h UTC já é 19h
 * em Brasília e ninguém está olhando.
 *
 * O ESPELHO ACOMPANHA. Ele roda aos :05 de cada janela e é quem descobre o
 * número da nota e marca `nf_os_omie.faturada` — que é o que tira a cobrança da
 * fila. Sem alargar o espelho junto, as rodadas das horas novas serviriam de
 * novo cobrança que já virou nota: foi exatamente o acidente de 27/08 pela
 * manhã (17 rodadas, 323 erros "não é possível trocar a etapa", 20 notas no
 * dia). Os dois horários andam juntos ou nenhum anda.
 *
 * `cron.alter_job` e não `cron.schedule`: o comando (com as chaves no header)
 * fica intacto: só o relógio muda. Reescrever o comando aqui seria copiar
 * segredo para dentro de um arquivo versionado.
 * ========================================================================== */

select cron.alter_job(jobid, schedule => '0,10,20,30,40,50 13-21 * * *')
from cron.job where jobname = 'nf-emissao-diaria';

select cron.alter_job(jobid, schedule => '5,15,25,35,45,55 13-21 * * *')
from cron.job where jobname = 'nf-espelho-rodada';


/* ------------------------------------------------------------------
 * O teto do dia — que agora é o único freio que sobrou
 * ------------------------------------------------------------------
 * ATENÇÃO À ASSIMETRIA. Antes, `teto_dia` = 300 contra 18 rodadas × 20 = 360 de
 * capacidade: o teto quase não era o limite, a janela é que era. Agora a
 * capacidade é 54 × 20 = 1.080, e o `teto_dia` passa a ser **o freio de
 * verdade** — o único número que separa "a esteira trabalhou o dia" de "a
 * esteira emitiu mil notas fiscais que ninguém pediu".
 *
 * Por isso ele sobe para 400 e não para 1.100. 400 é maior que qualquer dia
 * normal (a fila nasce com ~70/dia de cobrança nova) e ainda assim é um freio:
 * se a fila voltar a errar como errou hoje de manhã, o estrago para em 400 e não
 * no acúmulo inteiro. Os 1.004 saem em dois dias e meio, e o mês fecha dia 31.
 *
 * Para empurrar o acúmulo num dia só, é uma linha e não precisa de deploy:
 *
 *     update public.nf_config set teto_dia = 1100 where id = 1;
 *
 * E vale voltar para ~300 depois que o acúmulo sair: um teto folgado permanente
 * é um freio que não freia.
 */
update public.nf_config set teto_dia = 400 where id = 1 and teto_dia < 400;
