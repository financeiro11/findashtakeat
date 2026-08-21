/* ---------------------------------------------------------------------------
 * O que foi comprado: da nota lida para a linha da fatura.
 *
 * A leitura do comprovante (`auditoria.ia_leitura`) guarda uma frase curta em
 * português dizendo o que veio na compra — "Cadeira de escritório e 2 monitores".
 * Ela nasceu para a conferência, mas responde uma pergunta que a fatura sozinha
 * nunca respondeu: o mesmo "MERCADOLIVRE*" aparece seis vezes num mês e são seis
 * compras diferentes.
 *
 * IRMÃ DA `auditoria_lojistas`, e pelo mesmo motivo: não há id em comum entre a
 * esteira da Auditoria e o módulo do Cartão, então o casamento é por DATA +
 * VALOR — chave bem discriminante porque o valor tem centavos. A competência
 * fica de fora de propósito: o Sicoob repete a data de origem em toda parcela, e
 * a compra é a mesma nas duas faturas.
 *
 * DUAS GUARDAS, as duas por honestidade da tela:
 *
 *   1. `ia_arquivo = link_comprovante` — a leitura só vale para o arquivo que
 *      está anexado AGORA. Trocado o comprovante, a frase antiga descreve outro
 *      documento, e afirmar o que ela diz seria mentir com cara de dado.
 *      (`is not distinct from` porque os dois podem ser nulos juntos, e aí não
 *      há leitura nenhuma para devolver — o `ia_leitura is not null` barra.)
 *
 *   2. chave com mais de uma frase sai da resposta. Preferimos não dizer o que
 *      foi comprado a dizer a compra errada — mesma escolha da `auditoria_lojistas`.
 *
 * Vale tanto para a leitura da conferência quanto para a da ação "transcrever"
 * (`transcricao_apenas: true`): a transcrição não emite veredito, mas transcreveu
 * o documento igual, e é exatamente ela que existe nos achados já decididos.
 * ------------------------------------------------------------------------- */

create or replace function public.auditoria_compras()
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(jsonb_object_agg(u.chave, u.frase), '{}'::jsonb)
  from (
    select
      a.data_lancamento::text || '|' || round(abs(a.valor) * 100)::bigint::text as chave,
      min(btrim(a.ia_leitura->>'descricao'))                                    as frase
    from public.auditoria a
    where a.ia_leitura is not null
      and a.ia_arquivo is not distinct from a.link_comprovante
      and coalesce(btrim(a.ia_leitura->>'descricao'), '') <> ''
      and a.data_lancamento is not null
      and a.valor is not null
    group by 1
    having count(distinct btrim(a.ia_leitura->>'descricao')) = 1
  ) u;
$$;

comment on function public.auditoria_compras() is
  'Mapa "data|centavos" -> o que a nota lida diz que foi comprado, para a fatura mostrar a compra embaixo do lojista. So leitura do arquivo que esta anexado; chave ambigua fica de fora.';

/* Função nova em `public` nasce chamável sem login — o `anon` precisa ser tirado
   de forma explícita, `public` sozinho não resolve. */
revoke all on function public.auditoria_compras() from public, anon;
grant execute on function public.auditoria_compras() to authenticated, service_role;
