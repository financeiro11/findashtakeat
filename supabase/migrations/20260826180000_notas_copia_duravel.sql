-- Uma cópia que sobrevive a quem saiu da empresa.
--
-- O RISCO, medido em 26/08/2026: de 2.490 notas com arquivo no Drive, **2.335
-- vêm das planilhas de formulário** — ou seja, o arquivo está no Drive de QUEM
-- PREENCHEU, não numa pasta da empresa. `notas_externas.link` aponta para lá.
--
-- Isso quebra em silêncio, e de três jeitos que já aconteceram em outros lugares:
-- a pessoa sai e a conta é desativada; ela move ou renomeia a pasta; ela apaga
-- "aquele arquivo velho". O Hub continua mostrando a linha, o link continua
-- bonito na tela, e só quem clica descobre que a nota sumiu — em geral o
-- contador, no fechamento, meses depois.
--
-- O QUE ESTA MIGRATION NÃO FAZ: mudar `link`. O link do Drive continua sendo o
-- endereço de origem, porque é lá que a pessoa que subiu vai procurar, e porque
-- perder a origem é perder a rastreabilidade. A cópia é um SEGUNDO endereço.
--
-- Por que no bucket `comprovantes-auditoria` e não numa pasta nova do Drive:
-- é de lá que a `omie-anexar-comprovante` sabe baixar sem conector nenhum, e é
-- o único depósito cujo dono é o projeto, não uma pessoa.

alter table public.notas_externas
  add column if not exists arquivo_bucket text,
  add column if not exists arquivo_em     timestamptz,
  add column if not exists arquivo_bytes  integer,
  add column if not exists arquivo_erro   text;

comment on column public.notas_externas.arquivo_bucket is
  'Caminho da cópia dentro do bucket comprovantes-auditoria. NULL = só existe no Drive de quem subiu.';
comment on column public.notas_externas.arquivo_erro is
  'Por que a cópia não foi feita. Preenchido junto com arquivo_bucket NULL: sem isso, "ainda não copiei" e "não dá para copiar" são a mesma coisa.';

/* Índice do que falta copiar. Parcial de propósito: a fila encolhe até zero e
   um índice sobre a tabela inteira seria pago para sempre por um trabalho que
   é, no fundo, uma carga única mais o que chegar depois. */
create index if not exists notas_externas_falta_copiar_idx
  on public.notas_externas (id)
  where tem_arquivo and arquivo_bucket is null and arquivo_erro is null;

/* ---------------------------------------------------------------------------
 *  A fila: o que copiar, na ordem em que importa
 * ------------------------------------------------------------------------ */
-- A ordem NÃO é por id. O que corre risco de sumir primeiro é o que está no
-- Drive de uma pessoa, e dentro disso o que é nota fiscal de verdade — o resto
-- (boleto, recibo) se recupera pedindo de novo ao fornecedor; nota fiscal de
-- anos atrás, não.

create or replace function public.notas_externas_para_arquivar(p_limite integer default 20)
returns table (id bigint, link text, nome text, enviado_em date, fonte text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select n.id, n.link, n.nome, n.enviado_em, n.fonte
    from public.notas_externas n
   where n.tem_arquivo
     and n.arquivo_bucket is null
     and n.arquivo_erro is null
     and n.ignorado_em is null
     and n.link ~* 'drive\.google\.com|googleapis\.com'
   order by
     -- 1º as das planilhas: são o Drive de uma pessoa, não uma pasta da empresa
     case when n.fonte like 'drive\_%' then 1 else 0 end,
     -- 2º nota fiscal antes de boleto/recibo
     case when n.parece_nota then 0 else 1 end,
     -- 3º a mais antiga primeiro: é a que já teve mais tempo para sumir
     n.enviado_em nulls last, n.id
   limit greatest(1, least(coalesce(p_limite, 20), 100));
$$;

revoke all on function public.notas_externas_para_arquivar(integer) from public;
revoke all on function public.notas_externas_para_arquivar(integer) from anon;
grant execute on function public.notas_externas_para_arquivar(integer) to authenticated, service_role;

/* ---------------------------------------------------------------------------
 *  Quanto falta, para a tela e para quem está drenando
 * ------------------------------------------------------------------------ */
create or replace function public.notas_externas_arquivo_resumo()
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with base as (
    select * from public.notas_externas where ignorado_em is null and tem_arquivo
  )
  select jsonb_build_object(
    'no_drive',    (select count(*) from base where link ~* 'drive\.google\.com|googleapis\.com'),
    'copiadas',    (select count(*) from base where arquivo_bucket is not null),
    'falta',       (select count(*) from base
                     where arquivo_bucket is null and arquivo_erro is null
                       and link ~* 'drive\.google\.com|googleapis\.com'),
    'com_erro',    (select count(*) from base where arquivo_erro is not null),
    'bytes',       (select coalesce(sum(arquivo_bytes), 0) from base where arquivo_bucket is not null),
    'por_erro',    (select coalesce(jsonb_object_agg(e, n), '{}'::jsonb)
                      from (select left(arquivo_erro, 60) e, count(*) n from base
                             where arquivo_erro is not null group by 1 order by 2 desc limit 10) t)
  );
$$;

revoke all on function public.notas_externas_arquivo_resumo() from public;
revoke all on function public.notas_externas_arquivo_resumo() from anon;
grant execute on function public.notas_externas_arquivo_resumo() to authenticated, service_role;
