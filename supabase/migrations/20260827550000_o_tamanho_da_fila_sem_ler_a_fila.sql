/* ============================================================================
 * QUANTAS NOTAS A ESTEIRA TEM PARA EMITIR — a pergunta que a tela precisa fazer
 * antes de oferecer o botão.
 *
 * O PROBLEMA QUE ISTO RESOLVE, e ele quase virou um acidente. A régua da TELA
 * (`motivoBloqueio`, em `src/lib/notasFiscais.ts`) responde "esta linha pode ser
 * selecionada?" olhando situação, estorno e status do dinheiro. Ela NÃO conhece
 * as guardas da fila — o paralelo com o Asaas, o cadastro do cliente no Omie, a
 * nota do Asaas em `SCHEDULED`/`ERROR`. Para uma seleção a dedo isso está certo:
 * a porta do servidor confere de novo e barra o que não pode.
 *
 * Medido em 27/08/2026, agosto: a tela ofereceria **1.989** cobranças; dessas,
 * **1.070 (R$ 591.454) têm nota do Asaas** e só **903** eram de verdade do Hub.
 * Num botão de emitir EM MASSA isso deixa de ser inofensivo: seriam mil chamadas
 * ao Asaas para colher mil recusas, mil linhas `bloqueado` no diário, e uma barra
 * de progresso andando meia hora para não emitir quase nada.
 *
 * Então o botão de massa não pergunta à tela: pergunta à FILA, que é a mesma
 * lista que o cron consome. Esta função é só o CONTADOR dessa lista — a tela
 * precisa do número e do valor para dizer "emitir as 1.004 (R$ 368 mil)" antes
 * de alguém clicar, e trazer as mil linhas só para contá-las seria varrer o
 * `asaas_cache` inteiro a cada abertura de tela.
 *
 * O TETO DO POSTGREST tem parte na história: `select`/`rpc` corta em 1.000
 * linhas sem avisar, e a fila tem 1.004. Contar no cliente devolveria 1.000 e a
 * tela mentiria por quatro — pouco, e mentira. Um escalar não sofre o teto.
 *
 * `p_limite` alto de propósito: a fila é `limit greatest(p_limite, 0)` e o que
 * se quer aqui é o tamanho TOTAL, não uma página dela.
 * ========================================================================== */

create or replace function public.notas_fiscais_fila_resumo()
returns table (cobrancas integer, valor numeric)
language sql
stable
set search_path to 'public'
as $function$
  select count(*)::integer, coalesce(sum(f.valor), 0)
  from public.notas_fiscais_fila_emissao(100000) f;
$function$;

comment on function public.notas_fiscais_fila_resumo() is
  'Quantas cobrancas a fila de emissao tem agora e quanto somam. E o contador da MESMA lista que o cron consome (notas_fiscais_fila_emissao), para a tela poder oferecer a emissao em massa pelo numero certo — a regua da tela nao conhece as guardas da fila e ofereceria quase o dobro.';

revoke all on function public.notas_fiscais_fila_resumo() from public, anon;
grant execute on function public.notas_fiscais_fila_resumo() to authenticated, service_role;
