-- Mês fechado não é falha temporária — é resposta final.
--
-- A primeira leva de verdade (123 títulos) devolveu o retrato esperado: 101
-- nomes escritos e 22 recusas, das quais 21 são a MESMA frase do Omie —
--
--   "O período contábil de Junho de 2026 (01/06 ~ 30/06) foi bloqueado por
--    Alessandra oliveira azevedo dos santos em ..."
--
-- Isso não é erro nosso nem instabilidade: é o ERP dizendo que a competência
-- está fechada e a correção tem de passar por quem controla o fechamento. A
-- fila permitia 3 tentativas — desenhadas para separar "o Omie estava ocupado"
-- de recusa de negócio. Só que uma recusa de negócio já se identifica pela
-- própria frase, e insistir nela é gastar três chamadas para ouvir três vezes o
-- mesmo "não". Com 2.6 mil títulos na fila, essa é a diferença entre a fila
-- drenar e a fila mastigar meses fechados para sempre.
--
-- Então: quem foi recusado por período contábil sai da fila na primeira vez. Não
-- some do registro — `omie_titulo_nome_cartao` guarda a frase inteira, e é ela
-- que responde "por que este título continua sem nome no ERP".

drop function if exists public.cartao_nome_fila(integer);

create function public.cartao_nome_fila(p_limite integer default 40)
returns table(
  cod_titulo bigint, favorecido_cru text, observacao text,
  valor numeric, competencia date, documento_atual text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
select t.cod_titulo, t.favorecido_cru, tx.observacao, t.valor, t.competencia, t.documento
from public.cap_titulos t
join public.omie_titulo_texto tx on tx.cod_titulo = t.cod_titulo
left join public.omie_titulo_nome_cartao n on n.cod_titulo = t.cod_titulo
where public.eh_cartao(t.favorecido_cru)
  and coalesce(tx.observacao, '') <> ''
  and coalesce(t.documento, '') = ''
  and n.escrito_em is null
  and coalesce(n.tentativas, 0) < 3
  -- Recusa de negócio: uma vez basta. Repetir não muda a resposta, e o que
  -- destrava é alguém reabrir a competência no Omie — não nós insistindo.
  and coalesce(n.erro, '') !~* 'per[ií]odo cont[aá]bil'
-- Pela EMISSÃO, não pela competência: numa compra em 12x a competência é o
-- vencimento da última parcela (2027), e ordenar por ela punha a fila inteira
-- em faturas futuras. A emissão é a data da compra — é o que "mais recente
-- primeiro" quer dizer aqui.
order by t.emissao desc nulls last, t.valor desc
limit greatest(coalesce(p_limite, 40), 1);
$function$;

comment on function public.cartao_nome_fila(integer) is
  'Títulos de cartão sem nome no numero_documento do Omie. Entrega a observação crua; quem lê o MEMO é a Edge Function, com o parser único de _shared/cartao-memo.ts. Mês contábil fechado sai da fila na primeira recusa.';

revoke all on function public.cartao_nome_fila(integer) from anon;
