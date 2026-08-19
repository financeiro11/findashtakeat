/* ---------------------------------------------------------------------------
 * Auditoria: de "LATAM AIR*0000V SAO PAULO" para o nome que a casa usa.
 *
 * A Auditoria come da esteira do n8n, que grava o MEMO da fatura como veio do
 * Sicoob — nome do lojista, código de reserva e cidade grudados numa string só.
 * O módulo do Cartão (`cartao_lancamentos`) já resolveu esse mesmo problema: lá o
 * `estabelecimento` está limpo ("LATAM", "MERCADO LIVRE", "GOOGLE (outros)"), e é
 * DESSA coluna que a fila da Parametrização tira os candidatos a apelido. Ou
 * seja: para a Auditoria falar a mesma língua da Parametrização, ela precisa
 * primeiro chegar ao nome limpo do Cartão.
 *
 * Não há id em comum entre as duas esteiras (a auditoria de julho nem sequer tem
 * `id_transacao`), então o casamento é por DATA + VALOR — a mesma chave que o
 * de-para do cartão usa contra o Omie, e pelo mesmo motivo: valor em reais com
 * centavos é bem discriminante. Conferido contra as bases reais, 862 de 862
 * lançamentos do cartão e 336 de 336 achados casaram, nenhum ambíguo.
 *
 * A competência fica FORA da chave de propósito: o Sicoob repete a data de
 * origem em toda parcela, então a mesma compra aparece em faturas diferentes com
 * data e valor iguais — e é sempre o mesmo lojista. Incluir a competência só
 * faria a parcela de agosto não achar o nome que a de julho já sabia.
 *
 * Chave com mais de um lojista sai da resposta (são 3 em 2.852). Preferimos não
 * dizer nome nenhum — a tela cai no nome cru — a dizer o nome errado.
 * ------------------------------------------------------------------------- */

create or replace function public.auditoria_lojistas()
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(jsonb_object_agg(u.chave, u.estabelecimento), '{}'::jsonb)
  from (
    select
      cl.data::text || '|' || round(abs(cl.valor) * 100)::bigint::text as chave,
      min(cl.estabelecimento)                                          as estabelecimento
    from public.cartao_lancamentos cl
    where coalesce(btrim(cl.estabelecimento), '') <> ''
    group by 1
    having count(distinct cl.estabelecimento) = 1
  ) u;
$$;

comment on function public.auditoria_lojistas() is
  'Mapa "data|centavos" -> estabelecimento limpo do modulo Cartao, para a Auditoria exibir o nome da Parametrizacao no lugar do MEMO cru da fatura. Chave ambigua (mais de um lojista) fica de fora.';

/* Função nova em `public` nasce chamável sem login — o `anon` precisa ser tirado
   de forma explícita, `public` sozinho não resolve. */
revoke all on function public.auditoria_lojistas() from public, anon;
grant execute on function public.auditoria_lojistas() to authenticated, service_role;
