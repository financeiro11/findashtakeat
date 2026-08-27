-- A nota que chegou como ENDEREÇO passa a virar arquivo.
--
-- Metade dos emissores de NFS-e não anexa nada: manda link. O Bling escreve
-- "Visualizar DANFE"; a Davam, que fatura a BuzzLead, escreve "Segue o Link da
-- Nota Fiscal". Essas linhas entravam no acervo com `tem_arquivo = false` e
-- ficavam de fora da fila do ERP — e com razão, porque a varredura tentaria
-- baixar uma página do Gmail e voltaria HTML.
--
-- O que mudou é que agora se guarda O ENDEREÇO DO DOCUMENTO, e não o da
-- mensagem. Conferido em 27/08/2026: o link da BuzzLead responde 200 com
-- `application/pdf`, 40 KB, sem login. Ela tem 9 títulos abertos de R$ 1.343,57
-- (parcelas mensais até dezembro) e a nota de cada um estava a um GET.
--
-- `link` continua sendo "onde o arquivo está" — depois do download ele aponta
-- para o bucket. `link_documento` guarda de onde veio, porque perder a origem é
-- perder como conferir.
--
-- O cron às :40 é o primeiro vão livre depois da varredura do Gmail (:25) e
-- antes do casamento do acervo (:30 da hora seguinte) — baixar antes de casar é
-- o que faz a nota entrar na rodada em vez de esperar a próxima.

alter table public.notas_externas add column if not exists link_documento text;

comment on column public.notas_externas.link_documento is
  'O endereço do DOCUMENTO quando o e-mail mandou link em vez de anexo (Bling, Davam/BuzzLead, prefeituras). A `nota-baixar-link` busca, valida que não é HTML e grava no bucket; `link` passa a apontar para o arquivo e este campo guarda a origem.';

create index if not exists notas_externas_link_documento_idx
  on public.notas_externas (id)
  where link_documento is not null and tem_arquivo = false;

insert into public.internal_cron_tokens (name, token)
values ('nota-baixar-link', encode(gen_random_bytes(18), 'hex'))
on conflict (name) do nothing;

select cron.unschedule('nota-baixar-link')
 where exists (select 1 from cron.job where jobname = 'nota-baixar-link');

select cron.schedule('nota-baixar-link', '40 * * * *', $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/nota-baixar-link',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'nota-baixar-link')
    ),
    body := '{"limite":20}'::jsonb
  );
$cron$);
