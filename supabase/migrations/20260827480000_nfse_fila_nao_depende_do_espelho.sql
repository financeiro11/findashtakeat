-- A FILA DA NFS-e DEIXA DE DEPENDER DO ESPELHO DO OMIE.
--
-- 27/08/2026, primeiro dia com a emissão automática ligada o dia inteiro: 18
-- rodadas disponíveis, 20 notas emitidas — todas na primeira. As 17 seguintes
-- produziram 323 erros "Não é possível trocar a etapa dessa Ordem de Serviço" e
-- 17 `FaturarLoteOS` disparados com a mesma OS que o Omie já havia recusado.
--
-- A fila exclui cobrança pelo `nf_os_omie.faturada`, e esse campo só vira `true`
-- quando o `espelhar` roda. O espelho ia junto na rodada e não cabia nos 150s da
-- Edge Function: `atualizado_em` das 1.284 OS ficou parado das 10:01 às 15:00.
-- Cinco horas em que a cobrança que já tinha virado nota continuou parecendo
-- pendente — e a rodada seguinte a servia de novo.
--
-- Nada duplicou, porque o carimbo `c_cod_int_os` fez a função reencontrar a OS em
-- vez de criar outra, e o Omie recusou movê-la da etapa 60. A trava salvou; o
-- desenho, não. Um espelho atrasado é normal (ele fala com um ERP); uma fila que
-- entope quando ele atrasa, não.
--
-- Duas guardas novas, as duas lendo só o Postgres:
--
--   1. DESPACHADA E SEM DESFECHO NÃO VOLTA. Se a última palavra do faturamento
--      desta cobrança é `em_processamento` e é recente, ela está no forno. Quem
--      fecha é o `fecharRecusadas` do sync, que já expira o forno em 6h — e as
--      12h daqui são folga sobre esse prazo, não um segundo relógio.
--
--   2. ERRO TEM CARÊNCIA, E ELA CRESCE. A OS cujo cadastro do cliente não emite
--      falha de novo em todas as rodadas do dia, sempre pelo mesmo motivo. O
--      primeiro erro ainda pode ser soluço do ERP e merece nova tentativa em 1h;
--      o terceiro é diagnóstico, e a resposta certa é parar de bater na porta.
--
-- Nenhuma das duas alcança a emissão manual: quem clica em emitir passa pela
-- `notas_fiscais_candidatas`, que é outra função. A pessoa continua podendo
-- forçar; o cron é que para de insistir.

/* Quanto esperar antes de tentar de novo, depois de um erro de faturamento.
 *
 * O texto do erro entra porque a recusa de cadastro é reconhecível e é
 * permanente até alguém consertar o cadastro — `nf-preparar-cadastros` roda de
 * hora em hora, mas quem depende da Receita pode levar dias. Retentar isso a
 * cada dez minutos é gastar OS, lote e lugar no teto do dia para reler a mesma
 * frase. */
create or replace function public.nfse_carencia(p_erro text, p_tentativas int)
returns interval
language sql
immutable
as $$
  select case
    when coalesce(p_erro, '') ~* '(falta preencher|cadastro do cliente no Omie|recusou o RPS)'
      then interval '24 hours'
    when coalesce(p_tentativas, 0) <= 1 then interval '1 hour'
    when p_tentativas = 2             then interval '6 hours'
    else interval '24 hours'
  end;
$$;

revoke all on function public.nfse_carencia(text, int) from public;
revoke all on function public.nfse_carencia(text, int) from anon;
grant execute on function public.nfse_carencia(text, int) to authenticated;
grant execute on function public.nfse_carencia(text, int) to service_role;

create or replace function public.notas_fiscais_fila_emissao(p_limite integer DEFAULT 20)
 returns table(id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date, email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, status_asaas text, estornado boolean)
 language sql
 stable
 set search_path to 'public'
as $function$
with cfg as (select data_corte, paralelo_asaas from public.nf_config where id = 1),
cli as (
  select id_asaas,
         regexp_replace(coalesce(dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
),
omie_cli as (
  select regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') as doc,
         min((c->>'codigo')::bigint) as codigo
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
    and regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') <> ''
  group by 1
),
/* O ÚLTIMO PASSO DE FATURAMENTO DE CADA COBRANÇA, e só ele.
 *
 * `criar_os` é passo anterior e `email` é posterior à nota: nenhum dos dois
 * responde "esta emissão terminou". É a mesma escolha que o `fecharRecusadas`
 * faz do lado do Deno, pelo mesmo motivo. */
passo as (
  select distinct on (id_asaas)
         id_asaas, resultado, criado_em, coalesce(erro, '') as erro
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and criado_em > now() - interval '30 days'
  order by id_asaas, criado_em desc
),
tentativas as (
  select id_asaas, count(*)::int as n
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and resultado = 'erro'
    and criado_em > now() - interval '7 days'
  group by 1
),
cob as (
  select c.id_asaas,
         c.dados->>'description'  as descricao,
         c.dados->>'customer'     as cus,
         c.dados->>'subscription' as assinatura,
         c.valor, c.data_vencimento, c.data_pagamento,
         c.status, c.dados,
         coalesce(c.data_pagamento, c.data_vencimento) as competencia,
         exists (select 1 from public.estornos_asaas e where e.id_pagamento = c.id_asaas) as estorno_registrado
  from public.asaas_cache c
  where c.tipo = 'payment'
    and c.valor > 0
    and coalesce(c.data_pagamento, c.data_vencimento) >= (select data_corte from cfg)
    and coalesce(c.data_pagamento, c.data_vencimento) <= current_date
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os,
       cob.status,
       cob.estorno_registrado
         or (jsonb_typeof(cob.dados->'refunds') = 'array' and jsonb_array_length(cob.dados->'refunds') > 0)
from cob
join cli on cli.id_asaas = cob.cus
join omie_cli oc on oc.doc = cli.doc
left join public.asaas_nf_config nfc on nfc.assinatura = cob.assinatura
left join passo p on p.id_asaas = cob.id_asaas
left join tentativas t on t.id_asaas = cob.id_asaas
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  where o.cancelada = false and o.c_cod_int_os = cob.id_asaas
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  and public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado) is null
  and (os.n_cod_os is null or os.faturada is not true)
  /* NO FORNO NÃO VOLTA. O espelho do Omie pode atrasar horas; esta leitura é do
   * nosso próprio diário e responde na hora.
   *
   * O `coalesce` é o que faz a guarda ser guarda. A cobrança que nunca foi
   * tentada não tem linha em `passo`, e `not (null = 'em_processamento')` é
   * NULL — que reprova a linha exatamente como um `false`. Sem ele, a fila
   * inteira zera: medido, 74 viraram 0. */
  and not coalesce(p.resultado = 'em_processamento'
                   and p.criado_em > now() - interval '12 hours', false)
  /* CARÊNCIA DEPOIS DO ERRO. */
  and not coalesce(p.resultado = 'erro'
                   and p.criado_em > now() - public.nfse_carencia(p.erro, coalesce(t.n, 0)), false)
  /* O PARALELO. Enquanto ligado, só entra cobrança de assinatura que o Asaas
   * declarou não emitir. `tem_config is null` (não sondada) NÃO entra: no escuro
   * a resposta certa é não emitir, porque o erro caro é a nota dupla. */
  and (
    not (select paralelo_asaas from cfg)
    or (cob.assinatura is not null and nfc.tem_config is false)
  )
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
      and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  )
  /* Qualquer nota do Asaas para ESTA cobrança — em qualquer situação, não só
   * autorizada. SCHEDULED é o Asaas dizendo "vou emitir", e ERROR é "tentei";
   * nos dois casos a cobrança é dele, e a decisão de assumir os erros dele é
   * humana, não da fila. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

-- O ESPELHO GANHA CRON PRÓPRIO, aos :05 de cada janela de emissão.
--
-- A rodada sai aos :00 e leva ~2min no pior caso; aos :05 o corredor está livre e
-- o `ListarOS` do espelho não bate na trava por método do Omie ("Consumo
-- redundante detectado. Aguarde N segundos"), que é o que derrubava o espelho
-- quando ele ia colado no da própria rodada.
--
-- `so_se_houver_forno` faz a chamada custar duas leituras do Postgres quando não
-- há nada esperando desfecho. O `nf-espelho-tarde` das 18h NÃO passa a bandeira:
-- o espelho completo do dia é garantia, e garantia não se condiciona.
select cron.schedule(
  'nf-espelho-rodada',
  '5,15,25,35,45,55 13,14,15 * * *',
  $job$
  select public.disparar_automacao(
    'nf-espelho-rodada',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-nfse-sync',
    '{"action":"espelhar","teto_status":40,"limite_anexo":5,"so_se_houver_forno":true}'::jsonb,
    'omie-nfse-sync',
    jsonb_build_object(
      'apikey',        current_setting('app.anon_key', true),
      'Authorization', 'Bearer ' || current_setting('app.anon_key', true)
    )
  );
  $job$
);
-- NOTA, E ELA IMPORTA: `app.anon_key` NÃO existe neste banco — `current_setting`
-- devolve nulo e o job sairia com `apikey: null`, que a função recusa. A chave
-- fica de fora daqui para não ser versionada, e o job no banco é gravado com a
-- literal, copiada do `nf-emissao-diaria`:
--
--   select cron.schedule('nf-espelho-rodada', '5,15,25,35,45,55 13,14,15 * * *',
--     replace(replace((select command from cron.job where jobname = 'nf-emissao-diaria'),
--       'nf-emissao-diaria', 'nf-espelho-rodada'),
--       '{"action":"emitir_dia"}',
--       '{"action":"espelhar","teto_status":40,"limite_anexo":5,"so_se_houver_forno":true}'));
--
-- Foi assim que ele foi criado em 27/08/26. Reaplicar este arquivo re-agenda o job
-- SEM chave: rode o comando acima depois.
