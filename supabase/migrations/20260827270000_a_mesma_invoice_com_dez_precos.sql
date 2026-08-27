-- Dez linhas, uma invoice, dez preços em real.
--
-- Com a janela larga de `20260827260000` a invoice da Datadog finalmente
-- alcançou o título dela — e parou na porta:
--
--   {"motivo": "alvo_disputado", "regra": "cambio", "linhas_disputando": 10}
--
-- As dez linhas são o MESMO papel. A Datadog manda a mesma fatura pelo
-- `billing@`, pelo `overdue-invoices@`, pelo `system@sent-via.netsuite.com` e
-- ainda por cima ela cai na pasta "0. Gmail" do Drive. Dez cópias de
-- US$ 2.532,43.
--
-- E as dez têm valores em real DIFERENTES: 12.402,07 · 12.408,65 · 12.466,40 ·
-- 12.823,72 · 12.866,52 · 12.954,39 · 12.970,35. Nada divergiu — cada cópia foi
-- convertida pela PTAX do dia em que ela chegou, e o dólar andou 4,6% entre maio
-- e agosto.
--
-- ---------------------------------------------------------------------------
-- O VALOR EM REAL NÃO IDENTIFICA UM PAPEL ESTRANGEIRO
--
-- A identidade em `notas_externas_marcar_copias` era `número + valor`, com o
-- valor em real. Para o documento brasileiro ele é o que está impresso na nota e
-- não muda. Para o estrangeiro ele é uma CONTA que a gente faz, e o resultado
-- depende do dia em que a conta foi feita — usá-lo como identidade é garantir
-- que duas cópias do mesmo PDF nunca se reconheçam.
--
-- O que não muda é o par (moeda, valor original). US$ 2.532,43 é US$ 2.532,43 em
-- maio e em agosto.
--
-- ---------------------------------------------------------------------------
-- O NÚMERO CONTINUA NECESSÁRIO, E O GRUPO EMPRESTA O DELE
--
-- Só o valor não basta: assinatura mensal de preço fixo cobra o mesmo valor todo
-- mês, e colapsar por valor juntaria julho com agosto. Medido nos 121 documentos
-- em moeda estrangeira: eles caem em 49 pares (moeda, valor original), e QUATRO
-- desses pares contêm mais de um número de documento — são justamente os
-- mensais de preço fixo.
--
-- Então: o par identifica quando o grupo inteiro conhece UM número só. Três das
-- dez linhas da Datadog vêm com nome de arquivo sem número nenhum
-- (`2026-05-09 Takeat Invoice (2).pdf`); elas herdam o número das outras sete,
-- porque não há outro candidato no grupo. Onde houver dois números diferentes, a
-- linha sem número fica de fora e ninguém colapsa — que é o desfecho certo para
-- um empate que não se sabe desfazer.

create or replace function public.notas_externas_marcar_copias()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n integer;
begin
  with base as (
    select id, chave_fiscal, moeda, valor_moeda, valor, enviado_erp_em, copia_de,
           public.numero_do_documento(coalesce(o_que_e, '') || ' ' || coalesce(detalhe, '')) as numero
      from public.notas_externas
     where ignorado_em is null
  ),
  /* O NÚMERO QUE O PAR (moeda, valor original) CONHECE. `count(distinct) = 1`
     é a guarda inteira: com dois números no mesmo par, ninguém empresta nada. */
  numero_do_par as (
    select moeda, valor_moeda,
           case when count(distinct numero) = 1 then min(numero) end as numero
      from base
     where moeda in ('USD', 'EUR') and valor_moeda is not null
     group by 1, 2
  ),
  /* A IDENTIDADE DO PAPEL, na ordem em que se confia:
       1. a chave fiscal, quando existe;
       2. moeda + valor ORIGINAL + número — o estrangeiro, que não tem chave;
       3. número + valor em real — o brasileiro sem chave. */
  identidade as (
    select b.id,
           coalesce(
             b.chave_fiscal,
             case when b.moeda in ('USD', 'EUR')
                   and b.valor_moeda is not null
                   and coalesce(b.numero, p.numero) is not null
                  then 'inv:' || b.moeda || '|' || b.valor_moeda::text
                       || '|' || coalesce(b.numero, p.numero) end,
             case when b.numero is not null
                  then 'doc:' || b.numero || '|' || coalesce(b.valor::text, '?') end
           ) as ident
      from base b
      left join numero_do_par p
             on p.moeda = b.moeda and p.valor_moeda = b.valor_moeda
  ),
  portador as (
    select ident, min(id) as id
      from identidade
     where ident is not null
     group by ident
  )
  update public.notas_externas n
     set copia_de = p.id, atualizado_em = now()
    from identidade i
    join portador p on p.ident = i.ident
   where n.id = i.id
     and n.id <> p.id
     -- Nota já enviada não vira cópia: o arquivo dela está no ERP, e apagar
     -- esse fato para chamá-la de cópia perderia o rastro de quem subiu o quê.
     and n.enviado_erp_em is null
     and n.copia_de is distinct from p.id;
  get diagnostics v_n = row_count;

  /* O PORTADOR HERDA O QUE O GRUPO SABE — ver `20260826260000`: em 51 de 164
     grupos o valor da nota morava só na cópia que era descartada. */
  with grupo as (
    select coalesce(c.copia_de, c.id) as portador_id,
           min(c.valor)     filter (where c.valor is not null)     as valor,
           min(c.cnpj)      filter (where c.cnpj is not null)      as cnpj,
           min(c.documento) filter (where c.documento is not null) as documento,
           bool_or(c.parece_nota)                                  as alguem_e_nota
      from public.notas_externas c
     where c.ignorado_em is null
     group by 1
    having count(*) > 1
  )
  update public.notas_externas n
     set valor     = coalesce(n.valor, g.valor),
         cnpj      = coalesce(n.cnpj, g.cnpj),
         documento = coalesce(n.documento, g.documento),
         tipo_documento = case
           when g.alguem_e_nota and coalesce(n.tipo_documento, 'nota') = 'outro' then 'nota'
           else n.tipo_documento
         end,
         atualizado_em = now()
    from grupo g
   where n.id = g.portador_id
     and (   (n.valor is null and g.valor is not null)
          or (n.cnpj is null and g.cnpj is not null)
          or (n.documento is null and g.documento is not null)
          or (g.alguem_e_nota and coalesce(n.tipo_documento, 'nota') = 'outro'));

  return v_n;
end;
$function$;

comment on function public.notas_externas_marcar_copias() is
  'Junta as linhas que são o mesmo papel. Chave fiscal quando há; para o documento estrangeiro, moeda + valor ORIGINAL + número (o valor em real é conversão e muda com o dia da PTAX — ver 20260827270000); para o brasileiro sem chave, número + valor.';
