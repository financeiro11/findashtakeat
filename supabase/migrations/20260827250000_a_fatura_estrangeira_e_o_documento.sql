-- A fatura estrangeira é O documento — e a regra passa a valer sozinha.
--
-- `20260827210000` promoveu só `recibo` e deixou `outro` de fora, com a leitura
-- de que os 27 de `outro` eram "principalmente CREDIT_MEMO e Order do HubSpot".
-- Isso estava certo sobre o HubSpot e errado sobre o resto. Olhando um a um os
-- 36 que estão lá agora:
--
--   Datadog, faturas numeradas (`1634203-04112026.pdf`)      11 docs · R$  81.566
--   Datadog e Campbells, nome de arquivo sem palavra alguma   17 docs · R$ 187.700
--   HubSpot CREDIT_MEMO                                        6 docs · R$  43.449
--   HubSpot Order                                              2 docs · R$     773
--
-- Vinte e oito dos trinta e seis são fatura de verdade: `Inv #248329` da
-- Campbells LLP, `Inv_TakLtdJul26_from_CuboStart`, os PDF numerados que o
-- `overdue-invoices@datadoghq.com` manda. Ficaram de fora porque o classificador
-- lê o NOME do arquivo, e um UUID (`e9c52d01-0339-...pdf`) não diz nada.
--
-- ---------------------------------------------------------------------------
-- A REGRA VIROU DE LADO: lista o que NÃO vale, não o que vale
--
-- Tentar reconhecer "cara de fatura" obriga a prever como HubSpot, Datadog,
-- Campbells, CuboStart e o próximo fornecedor nomeiam o arquivo deles — e o
-- próximo sempre nomeia diferente. Já o conjunto do que não é despesa é curto,
-- estável e definível por natureza:
--
--   nota de crédito  desfaz uma cobrança. Aceitá-la como documento de um título
--                    a pagar é dar a conta por resolvida com o papel que a anula.
--   pedido / order   antecede a cobrança; ainda não há o que comprovar.
--   boleto           prova que se pagou, não o que se comprou. Fora em real,
--                    fora em dólar, pelo mesmo motivo.
--
-- Fora dessas três, documento em moeda estrangeira vale. É a decisão do
-- financeiro de 27/08/2026, "tudo que for estrangeiro você pode aceitar invoice
-- caso eles não emitam NF no estilo brasileira", lida como ela foi dita.
--
-- ---------------------------------------------------------------------------
-- E PASSA A VALER PARA O QUE AINDA VAI CHEGAR
--
-- A migração anterior era um `update` e nada mais: a fatura que a Datadog mandar
-- amanhã nasceria como `outro` e ficaria. Agora um gatilho aplica a mesma regra
-- na entrada da linha — e também no `update`, que é quando a `nota-ler-arquivo`
-- finalmente preenche a `moeda` depois de abrir o PDF.
--
-- O gatilho só PROMOVE. Ele nunca rebaixa um `nota` a coisa nenhuma, e por isso
-- não desfaz classificação de ninguém: no pior caso deixa como está.

create or replace function public.estrangeiro_vale_como_nota(p_tipo text, p_texto text)
returns boolean
language sql
immutable
as $$
  select p_tipo is distinct from 'boleto'
     and coalesce(p_texto, '') !~* 'credit[ _-]?(memo|note)'
     and coalesce(p_texto, '') !~* 'nota de cr[ée]dito'
     -- "order" exige um número colado, senão um "in order to" no assunto de um
     -- e-mail derrubaria a fatura inteira.
     and coalesce(p_texto, '') !~* '(^|[^a-z])(order|pedido)[ _#-]*[0-9]{3,}'
$$;

comment on function public.estrangeiro_vale_como_nota(text, text) is
  'Documento em moeda estrangeira conta como nota? Responde pelo que NÃO vale — nota de crédito, pedido e boleto — porque a lista do que vale mudaria a cada fornecedor novo. Ver 20260827250000.';

create or replace function public.notas_externas_promove_estrangeira()
returns trigger
language plpgsql
as $$
begin
  if new.moeda in ('USD', 'EUR')
     and new.tipo_documento is distinct from 'nota'
     and public.estrangeiro_vale_como_nota(
           new.tipo_documento,
           concat_ws(' ', new.o_que_e, new.detalhe, new.nome))
  then
    new.tipo_documento := 'nota';
  end if;
  return new;
end;
$$;

drop trigger if exists notas_externas_estrangeira on public.notas_externas;
create trigger notas_externas_estrangeira
  before insert or update of moeda, tipo_documento, o_que_e, detalhe
  on public.notas_externas
  for each row
  execute function public.notas_externas_promove_estrangeira();

-- O que já está na mesa. O gatilho cuida do que vier depois.
do $do$
declare
  v_antes int;
  v_depois int;
begin
  select count(*) into v_antes
    from public.notas_externas
   where moeda in ('USD', 'EUR') and tipo_documento = 'nota' and ignorado_em is null;

  update public.notas_externas
     set tipo_documento = 'nota', atualizado_em = now()
   where moeda in ('USD', 'EUR')
     and tipo_documento is distinct from 'nota'
     and ignorado_em is null
     and public.estrangeiro_vale_como_nota(
           tipo_documento, concat_ws(' ', o_que_e, detalhe, nome));

  select count(*) into v_depois
    from public.notas_externas
   where moeda in ('USD', 'EUR') and tipo_documento = 'nota' and ignorado_em is null;

  raise notice 'notas estrangeiras: % -> % (promovidas: %)', v_antes, v_depois, v_depois - v_antes;
end
$do$;

comment on column public.notas_externas.tipo_documento is
  'O que o papel é: nota, recibo, boleto, outro. Em moeda estrangeira a régua é outra e o gatilho `notas_externas_estrangeira` a aplica: vale tudo menos nota de crédito, pedido e boleto — não existe NFS-e a cobrar de quem não a emite.';
