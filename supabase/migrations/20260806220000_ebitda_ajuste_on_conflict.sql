/* ============================================================================
 * O upsert da decisão de EBITDA nunca funcionou.
 *
 * `demonstracoes_ebitda_ajuste_titulo_uk` nasceu como índice unique PARCIAL
 * (`where cod_titulo is not null`). O PostgREST manda
 * `on_conflict=col_key,cod_titulo`, que vira `ON CONFLICT (col_key, cod_titulo)`
 * SEM predicado — e o Postgres se recusa a inferir um índice parcial quando a
 * instrução não repete o `where` dele. Resultado: 42P10, "there is no unique or
 * exclusion constraint matching the ON CONFLICT specification", que o PostgREST
 * devolve como 400. Toda vez que alguém clicava "É ajuste" ou "Não é", a decisão
 * morria ali — e o erro chegava na tela como "[object Object]", porque um
 * PostgrestError é objeto cru e não passa por `e instanceof Error`.
 *
 * O índice CHEIO faz exatamente o mesmo trabalho. `cod_titulo` é NULL no ajuste
 * avulso, e num unique do Postgres NULL não conflita com NULL — então continuam
 * cabendo quantos ajustes à mão o mês precisar, que era a única coisa que o
 * parcial pretendia garantir. Ele não protegia nada que o cheio não proteja;
 * só impedia a inferência.
 * ========================================================================== */

drop index if exists public.demonstracoes_ebitda_ajuste_titulo_uk;

create unique index if not exists demonstracoes_ebitda_ajuste_titulo_uk
  on public.demonstracoes_ebitda_ajuste (col_key, cod_titulo);
