/* ============================================================================
 * Cartão → Omie: separar "o mês da parcela" de "a fatura que a gerou".
 *
 * O ERRO QUE ISTO CONSERTA, achado no primeiro envio de verdade (24/08/2026).
 * `cartao_envios_omie.competencia` guardava o mês em que CADA PARCELA cai —
 * 2026-12, 2027-01, 2027-02, 2027-03 para uma compra em 4×. Só que quem pergunta
 * a esta tabela pergunta sempre pela FATURA: "o que desta fatura já subiu?". Com
 * a coluna significando outra coisa, a fatura de teste mandou 17 títulos e a
 * conferência enxergou 11 — os 6 de parcelas futuras ficavam invisíveis.
 *
 * A consequência não era duplicar (o `codigo_lancamento_integracao` é único no
 * Omie e ele recusa o repetido), mas era ruim do mesmo jeito: a tela ofereceria
 * reenviar o que já estava lá, gastaria chamada de API para ouvir "não" e nunca
 * marcaria a fatura como enviada.
 *
 * Então a competência da parcela CONTINUA sendo o que a coluna `competencia`
 * diz — é um fato e é usada para saber em que mês a parcela vence. O que entra
 * é a coluna que faltava: de qual fatura este título saiu.
 * ========================================================================== */

alter table public.cartao_envios_omie
  add column if not exists competencia_fatura date;

comment on column public.cartao_envios_omie.competencia is
  'Mês em que ESTA PARCELA cai (a 3ª de uma compra em 3× cai dois meses à frente).';
comment on column public.cartao_envios_omie.competencia_fatura is
  'Mês da FATURA que gerou o título. É por aqui que se pergunta "o que desta fatura já subiu?".';

/* A tabela só tem os títulos da fatura sintética (nada de verdade foi enviado
   antes desta data), e todos saíram da fatura de dez/26. */
update public.cartao_envios_omie
   set competencia_fatura = date '2026-12-01'
 where competencia_fatura is null
   and integracao like 'CARTAO-TESTEHUB%';

/* Sobra alguma linha sem origem conhecida? Melhor apontá-la para a própria
   competência do que deixar nulo: nulo sumiria de todo filtro por fatura, que é
   exatamente o defeito que esta migration existe para tirar. */
update public.cartao_envios_omie
   set competencia_fatura = competencia
 where competencia_fatura is null;

alter table public.cartao_envios_omie
  alter column competencia_fatura set not null;

create index if not exists cartao_envios_omie_fatura_idx
  on public.cartao_envios_omie (competencia_fatura);
