-- O AVISO CONTA O QUE JÁ FOI CONSERTADO, NÃO SÓ O QUE QUEBROU.
--
-- Um alerta que só relata problema transfere o trabalho inteiro para quem lê, e
-- some da vista assim que a lista fica grande. O que a pessoa precisa saber não
-- é "56 notas foram recusadas" — é:
--
--   • o que a máquina já resolveu sozinha (e por isso só falta um clique);
--   • o que ela tentou e não soube resolver (e por isso precisa de gente);
--   • o que não era problema de cadastro (instabilidade: reenviar basta).
--
-- Estas três listas são ações diferentes, e é por isso que a coluna `situacao`
-- existe. A recusa que teve o cadastro corrigido DEPOIS dela é a mais valiosa:
-- o cliente já está certo no ERP e a nota sai no "Reenviar NFS-e".
--
-- Por que o reenvio não é automático, e não vai ser: OS faturada com recusa NÃO
-- volta pela API. Foi sondado com controle — `ReenviarNFSe`, `ReprocessarNFSe`,
-- `EnviarNFSe`, `TransmitirNFSe`, `ReenviarRPS`, `RefaturarOS` e mais quatro,
-- todos "Method not exists" em `servicos/os`, `oslote` e `nfse`. O botão da tela
-- do Omie é o único caminho. Então o melhor que a máquina pode fazer é deixar o
-- cadastro pronto e dizer exatamente onde clicar.

-- Trocar o tipo de retorno exige DROP — `create or replace` recusa. E a
-- `_a_avisar` cai junto porque ela devolve `r.*` desta aqui: recriar só uma
-- deixaria a outra com a assinatura velha, que é o overload fantasma de sempre.
drop function if exists public.nfse_recusas_a_avisar(integer);
drop function if exists public.nfse_recusas_a_tratar(integer);

create function public.nfse_recusas_a_tratar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, emitivel boolean,
  situacao text, consertado_em timestamptz, o_que_foi_feito text
)
language sql
stable
set search_path to 'public'
as $function$
with recusa as (
  select o.n_cod_os, o.c_num_os, o.c_cod_int_os, o.cnpj_cpf, o.n_cod_cli,
         o.valor, o.data_faturamento, o.nfse_mensagem
  from public.nf_os_omie o
  where o.cancelada = false
    and o.nfse_status = '003'
    and coalesce(o.nfse_numero, '') = ''
    and o.data_faturamento >= current_date - make_interval(days => greatest(p_dias, 1))
),
-- O conserto que veio DEPOIS da recusa. Antes dela não conta: se o endereço já
-- estava assim quando a prefeitura recusou, ele não é a solução, é o problema.
conserto as (
  select r.n_cod_os,
         max(k.criado_em) as consertado_em,
         (array_agg(k.resultado order by k.criado_em desc))[1] as resultado
  from recusa r
  join public.nf_cadastro_correcoes k
    on k.doc = r.cnpj_cpf
   and k.criado_em > r.data_faturamento::timestamptz
  where (k.resultado->'omie'->>'ok')::boolean is true
  group by r.n_cod_os
)
select r.n_cod_os, r.c_num_os, r.c_cod_int_os, r.cnpj_cpf,
       coalesce(en.nome, '—'),
       r.valor, r.data_faturamento,
       coalesce(r.nfse_mensagem, '(sem mensagem)'),
       case
         when r.nfse_mensagem ilike '%E0240%'  then 'CEP do cliente não confere com o município'
         when r.nfse_mensagem ilike '%E0921%'
           or r.nfse_mensagem ilike '%E0922%'  then 'Código do município do cliente'
         when r.nfse_mensagem ilike '%E0207%'  then 'CPF não existe no cadastro da Receita'
         when r.nfse_mensagem ilike '%E1235%'  then 'Telefone do cliente inválido'
         when r.nfse_mensagem ilike '%falta preencher%' then 'Cadastro incompleto no Omie'
         when r.nfse_mensagem ilike '%403%'
           or r.nfse_mensagem ilike '%Nenhuma resposta%'
           or r.nfse_mensagem ilike '%sobrecarregados%' then 'Instabilidade da prefeitura — reenviar resolve'
         else 'Ver mensagem da prefeitura'
       end,
       en.cep, en.cep_generico, en.emitivel,
       case
         -- Instabilidade primeiro: ela não depende de cadastro nenhum, e
         -- classificá-la como "precisa de gente" mandaria alguém procurar
         -- defeito onde não há.
         when r.nfse_mensagem ilike '%403%'
           or r.nfse_mensagem ilike '%Nenhuma resposta%'
           or r.nfse_mensagem ilike '%sobrecarregados%' then 'so_reenviar'
         when c.n_cod_os is not null then 'consertado'
         else 'precisa_de_gente'
       end,
       c.consertado_em,
       case
         when c.n_cod_os is null then null
         else concat_ws(', ',
           nullif(c.resultado->'omie'->'escrito'->>'endereco', ''),
           nullif(c.resultado->'omie'->'escrito'->>'endereco_numero', ''),
           nullif(c.resultado->'omie'->'escrito'->>'cep', ''))
       end
from recusa r
left join public.omie_clientes_endereco en on en.codigo = r.n_cod_cli
left join conserto c on c.n_cod_os = r.n_cod_os
order by r.data_faturamento desc, r.valor desc;
$function$;

comment on function public.nfse_recusas_a_tratar(integer) is
  'Notas recusadas pela prefeitura, classificadas por AÇÃO: consertado (falta reenviar no Omie), precisa_de_gente, so_reenviar.';

-- A fila do e-mail acompanha o novo formato. `so_reenviar` fica DE FORA do
-- aviso: instabilidade da prefeitura se resolve reenviando e não vale acordar
-- ninguém — ela aparece na tela, que é onde se trabalha a lista.
create function public.nfse_recusas_a_avisar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, emitivel boolean,
  situacao text, consertado_em timestamptz, o_que_foi_feito text
)
language sql
stable
set search_path to 'public'
as $function$
  select r.*
  from public.nfse_recusas_a_tratar(p_dias) r
  where not exists (
    select 1 from public.nfse_recusa_avisada a where a.n_cod_os = r.n_cod_os
  )
  order by
    case r.situacao when 'consertado' then 1 when 'precisa_de_gente' then 2 else 3 end,
    r.valor desc;
$function$;

comment on function public.nfse_recusas_a_avisar(integer) is
  'As recusas que ainda não entraram em nenhum aviso — o corpo do e-mail diário.';

-- ---------------------------------------------------------------------------
-- O RITMO: AGIR ÀS 11:20, CONTAR ÀS 11:30 (UTC).
--
-- A ordem não é acaso. O conserto de cadastro roda ANTES para que o e-mail já
-- nasça sabendo o que foi resolvido — um aviso que chega antes da tentativa
-- relata um problema que talvez já não exista, e ensina a desconfiar dele.
--
-- 11:30 UTC = 8h30 de Brasília: cedo o bastante para a pessoa ter o dia inteiro
-- para agir no que sobrou, e depois da janela de emissão do dia anterior
-- (13–21 UTC), então o retrato é de um dia fechado, não de um dia pela metade.
select cron.schedule(
  'nf-recusas-consertar',
  '20 11 * * *',
  $cron$
  select public.disparar_automacao(
    'nf-recusas-consertar',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-clientes-criar',
    '{"action":"corrigir_recusados","operador":"rodada diária antes do aviso"}'::jsonb
  );
  $cron$
);

select cron.schedule(
  'nf-recusas-avisar',
  '30 11 * * *',
  $cron$
  select public.disparar_automacao(
    'nf-recusas-avisar',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-nfse-sync',
    '{"action":"alerta_recusas","enviar":true,"dias":45}'::jsonb
  );
  $cron$
);
