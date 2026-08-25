-- A varredura de anexos ganha token, semente e cron.
--
-- SEMENTE. A `omie-pix-sync` já leu `ListarAnexo` para 757 títulos da conta
-- corrente do Sicoob e guardou o resultado em `auditoria_pix_lancamentos`
-- (`tem_comprovante` + `anexo_nome`). Aquilo é leitura de ERP de verdade, não
-- palpite: reaproveitar poupa 757 chamadas ao Omie e dá cobertura medida no
-- primeiro minuto, em vez de no fim da varredura.
--
-- Só entram os que foram DE FATO verificados (`anexo_verificado`): os 70 de maio
-- que ficaram pela metade continuam "não verificado", que é a verdade sobre eles.

insert into public.omie_titulo_anexo (cod_titulo, c_tabela, qtd, anexos, parece_nota, lido_em, erro)
select p.id_unico::bigint,
       'conta-pagar',
       case when p.tem_comprovante then 1 else 0 end,
       case when p.tem_comprovante and coalesce(p.anexo_nome, '') <> ''
            then jsonb_build_array(jsonb_build_object('id', null, 'nome', p.anexo_nome, 'tipo', null, 'tamanho', null))
            else '[]'::jsonb end,
       case when p.tem_comprovante
            then coalesce(p.anexo_nome, '') ~* '\m(nf|nfe|nfse|nota|danfe|invoice|fatura|recibo|boleto|cupom|comprovante)'
            end,
       coalesce(p.updated_at, now()),
       null
from public.auditoria_pix_lancamentos p
where p.id_unico ~ '^\d+$'
  and p.anexo_verificado
on conflict (cod_titulo) do nothing;

/* -------------------------- nem toda falha volta -------------------------- */
-- A primeira varredura real mostrou DOIS erros de naturezas opostas:
--   425 "API bloqueada por consumo indevido…"  → rate limit: volta, e volta logo.
--   500 "Documento não cadastrado para o Código [X]" → resposta de NEGÓCIO:
--       aquele nCodTitulo não existe como conta a pagar. Voltar amanhã dá o mesmo
--       erro amanhã, para sempre — e como a fila prioriza quem falhou, esses
--       títulos ocupariam o lugar de quem nunca foi lido. Laço infinito silencioso.

alter table public.omie_titulo_anexo
  add column if not exists retentar boolean not null default true;

comment on column public.omie_titulo_anexo.retentar is
  'A leitura falhou por algo que pode passar (rate limit)? Então volta para a fila. Recusa de negócio do Omie ("documento não cadastrado") entra como false e não volta.';

create or replace function public.cap_anexos_fila(p_limite integer default 60)
returns table(cod_titulo bigint, valor numeric, competencia date, situacao text)
language sql
stable
security definer
set search_path to 'public'
as $function$
with cfg as (select releitura_dias from public.cap_notas_config where id = 1),
lido as (select cod_titulo, retentar from public.omie_titulo_anexo)
select t.cod_titulo, t.valor, t.competencia, t.situacao
from public.cap_titulos t
left join lido l on l.cod_titulo = t.cod_titulo
where t.regra = 'exige'
  and (
    t.anexo_lido_em is null
    or (t.erro_leitura is not null and coalesce(l.retentar, true))
    or (t.erro_leitura is null
        and coalesce(t.anexos_no_erp, 0) = 0
        and t.anexo_lido_em < now() - make_interval(days => (select releitura_dias from cfg)))
  )
order by (t.anexo_lido_em is not null), t.competencia desc nulls last, t.valor desc
limit greatest(coalesce(p_limite, 60), 1);
$function$;

revoke all on function public.cap_anexos_fila(integer) from anon;

/* ---------------------------------- cron ---------------------------------- */

insert into public.internal_cron_tokens (name)
select 'omie-anexos-varredura'
where not exists (
  select 1 from public.internal_cron_tokens where name = 'omie-anexos-varredura'
);

select cron.unschedule('omie-anexos-varredura')
where exists (select 1 from cron.job where jobname = 'omie-anexos-varredura');

-- De 20 em 20 minutos. Cada rodada lê até 150 títulos em ~100 segundos; a fila
-- inicial (~1.700) some em algumas horas e, depois disso, a rodada quase sempre
-- encontra fila vazia e volta em milissegundos. Frequência alta aqui é barata:
-- é leitura, e a fila do Postgres já filtra quem não precisa voltar.
select cron.schedule(
  'omie-anexos-varredura',
  '7,27,47 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-anexos-varredura',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'omie-anexos-varredura')
    ),
    body := '{"action":"varrer","limite":150}'::jsonb
  );
  $cron$
);
