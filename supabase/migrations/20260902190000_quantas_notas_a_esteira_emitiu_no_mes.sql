-- QUANTAS NOTAS A ESTEIRA EMITIU NO MÊS
--
-- O card "Emitida no Omie" do painel mostrava **1** para setembro/2026 num dia em
-- que a esteira tinha emitido **153** notas (56 em 01/09 e 97 em 02/09,
-- R$ 110.201,88). Os dois números estão certos e respondem perguntas diferentes:
--
--   1    = cobranças COM COMPETÊNCIA em setembro que já têm nota nossa
--   153  = notas que saíram DURANTE setembro, de qualquer competência
--
-- A diferença é o backlog: das 153, a competência era jan 35, fev 69, mar 19,
-- ago 29 e set 1. A fila é servida da mais velha para a mais nova
-- (`order by competência`), então em setembro a esteira está drenando janeiro.
--
-- O PROBLEMA NÃO É O NÚMERO, É QUE SÓ UM DELES ESTAVA NA TELA. O card diz
-- "NFS-e autorizada", que qualquer pessoa lê como "notas emitidas" — e a leitura
-- que ele NÃO oferecia era justamente a que responde "a máquina está andando?".
-- Quem olhou o painel em 02/09 concluiu, com razão, que algo estava quebrado.
--
-- Esta função devolve o segundo número, pelo período em foco (não "hoje", nem "o
-- mês corrente"): olhando agosto, ela diz quantas notas saíram em agosto. É a
-- `data_faturamento` da OS que manda, porque é ela que o Omie carimba quando a
-- nota nasce — `nf_emissoes.criado_em` marcaria a TENTATIVA, e tentativa que
-- falhou não é nota.

create or replace function public.notas_fiscais_emitidas_no_periodo(p_de date, p_ate date)
returns table(notas integer, valor numeric, primeira date, ultima date)
language sql
stable
set search_path to 'public'
as $function$
  select count(*)::integer,
         coalesce(sum(o.valor), 0),
         min(o.data_faturamento),
         max(o.data_faturamento)
  from public.nf_os_omie o
  where o.cancelada = false
    and o.nfse_status = '004'
    and o.data_faturamento between p_de and p_ate;
$function$;

revoke all on function public.notas_fiscais_emitidas_no_periodo(date, date) from anon;
