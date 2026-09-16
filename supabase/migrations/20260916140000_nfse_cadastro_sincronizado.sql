/* ---------------------------------------------------------------------------
 * A RODADA AUTOMÁTICA NÃO EMITE SOBRE CADASTRO QUE NÃO FOI CONFERIDO (16/09/2026).
 *
 * O caso: a AEVO mudou de endereço, atualizou o Asaas, e o cadastro do Omie
 * continuou com a sala antiga. Duas notas saíram erradas (20274 e 20391) e
 * foram canceladas. A emissão pela tela passou a conferir o cadastro antes de
 * emitir (`garantir` na omie-clientes-criar); a esteira do cron (`emitir_dia`)
 * não passa por ali — e é ela que emite a maior parte das notas.
 *
 * Conferir o cadastro dentro da rodada não cabe no relógio (Receita + Omie,
 * ~5s por cliente, 20 por rodada, 150s de gateway). Então a pergunta vira DADO:
 * para cada cliente (documento + cus_ do Asaas), com QUAL endereço do Asaas o
 * cadastro do Omie foi conferido pela última vez. Endereço do Asaas diferente
 * dessa assinatura = conferência pendente = a cobrança espera a próxima rodada
 * de `sincronizar_fila`, que roda de 30 em 30 minutos e corrige o Omie.
 *
 * POR QUE ASSINATURA E NÃO COMPARAR COM O ESPELHO DO OMIE. O espelho
 * (`omie_clientes_endereco`) é semanal, guarda o formato do Omie ("RUA X",
 * "VITORIA (ES)") e o CEP pode ter sido refinado pelos Correios — comparar
 * texto com ele acusaria diferença para sempre em quem já está certo, e a
 * cobrança nunca sairia. A assinatura só muda quando o ASAAS muda, que é
 * exatamente o evento que importa.
 *
 * Só entra quem tem endereço COMPLETO no Asaas (logradouro, número de verdade,
 * CEP de 8 dígitos) — é a mesma régua do `montarCadastroBruto`. Sem isso a
 * fonte do cadastro é a Receita, e não há o que conferir contra o Asaas.
 * ------------------------------------------------------------------------- */

create table if not exists public.nfse_cadastro_sincronizado (
  doc              text not null,
  id_customer      text not null,
  -- `nfse_assinatura_endereco` do cliente no Asaas quando a conferência deu
  -- certo; NULL quando falhou (a cobrança segue segura e a conferência volta).
  assinatura       text,
  resultado        text not null,      -- ok | igual | sem_proposta | semeado | falhou
  detalhe          text,
  tentativas       int not null default 0,
  sincronizado_em  timestamptz not null default now(),
  primary key (doc, id_customer)
);

alter table public.nfse_cadastro_sincronizado enable row level security;
revoke all on table public.nfse_cadastro_sincronizado from anon, authenticated, public;
grant select, insert, update, delete on table public.nfse_cadastro_sincronizado to service_role;

comment on table public.nfse_cadastro_sincronizado is
  'Com qual endereço do Asaas o cadastro do Omie foi conferido. Assinatura diferente = cobrança fora da esteira até sincronizar. Ver migration 20260916140000.';

/* A forma canônica do endereço do Asaas. Mudar isto invalida TODAS as
   assinaturas (cada cliente passa por uma conferência de novo) — não é grave,
   mas custa uma volta inteira da sincronização. */
create or replace function public.nfse_assinatura_endereco(d jsonb)
returns text language sql immutable as $$
  select lower(btrim(coalesce(d->>'address', ''))) || '|' ||
         regexp_replace(coalesce(d->>'addressNumber', ''), '\D', '', 'g') || '|' ||
         lower(btrim(coalesce(d->>'complement', ''))) || '|' ||
         lower(btrim(coalesce(d->>'province', ''))) || '|' ||
         regexp_replace(coalesce(d->>'postalCode', ''), '\D', '', 'g')
$$;

create or replace function public.nfse_asaas_endereco_completo(d jsonb)
returns boolean language sql immutable as $$
  select btrim(coalesce(d->>'address', '')) <> ''
     and regexp_replace(coalesce(d->>'addressNumber', ''), '\D', '', 'g') ~ '[1-9]'
     and length(regexp_replace(coalesce(d->>'postalCode', ''), '\D', '', 'g')) = 8
$$;

/* As cobranças (dentre as pedidas) cujo cadastro precisa de conferência. */
create or replace function public.nfse_cadastro_a_sincronizar(p_ids text[])
returns table(id_asaas text, doc text, id_customer text, n_cod_cli bigint, tentativas int)
language sql stable as $$
  with pg as (
    select p.id_asaas, p.dados->>'customer' as cus
    from asaas_cache p
    where p.tipo = 'payment' and p.id_asaas = any(p_ids)
  ), c as (
    select pg.id_asaas, pg.cus,
           regexp_replace(coalesce(cu.dados->>'cpfCnpj', ''), '\D', '', 'g') as doc,
           cu.dados as d
    from pg join asaas_cache cu on cu.tipo = 'customer' and cu.id_asaas = pg.cus
  )
  select c.id_asaas, c.doc, c.cus,
         (select min(od.codigo)::bigint from omie_clientes_doc od where od.doc = c.doc),
         coalesce(s.tentativas, 0)
  from c
  left join nfse_cadastro_sincronizado s on s.doc = c.doc and s.id_customer = c.cus
  where c.doc <> ''
    and public.nfse_asaas_endereco_completo(c.d)
    and exists (select 1 from omie_clientes_doc od where od.doc = c.doc)
    and (s.doc is null or s.assinatura is distinct from public.nfse_assinatura_endereco(c.d))
$$;

/* Registra o desfecho de uma conferência. Sucesso grava a assinatura ATUAL do
   Asaas (lida aqui, e não mandada por quem chama — é a mesma função que a
   compara); falha grava NULL e soma uma tentativa. */
create or replace function public.nfse_cadastro_marcar(
  p_doc text, p_id_customer text, p_resultado text, p_detalhe text default null
) returns void language sql volatile as $$
  insert into nfse_cadastro_sincronizado as s (doc, id_customer, assinatura, resultado, detalhe, tentativas, sincronizado_em)
  select p_doc, p_id_customer,
         case when p_resultado = 'falhou' then null else public.nfse_assinatura_endereco(cu.dados) end,
         p_resultado, left(p_detalhe, 500),
         case when p_resultado = 'falhou' then 1 else 0 end,
         now()
  from asaas_cache cu
  where cu.tipo = 'customer' and cu.id_asaas = p_id_customer
  on conflict (doc, id_customer) do update set
    assinatura = excluded.assinatura,
    resultado = excluded.resultado,
    detalhe = excluded.detalhe,
    tentativas = case when excluded.resultado = 'falhou' then s.tentativas + 1 else 0 end,
    sincronizado_em = now()
$$;

revoke all on function public.nfse_assinatura_endereco(jsonb) from public, anon, authenticated;
revoke all on function public.nfse_asaas_endereco_completo(jsonb) from public, anon, authenticated;
revoke all on function public.nfse_cadastro_a_sincronizar(text[]) from public, anon, authenticated;
revoke all on function public.nfse_cadastro_marcar(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nfse_assinatura_endereco(jsonb) to service_role;
grant execute on function public.nfse_asaas_endereco_completo(jsonb) to service_role;
grant execute on function public.nfse_cadastro_a_sincronizar(text[]) to service_role;
grant execute on function public.nfse_cadastro_marcar(text, text, text, text) to service_role;

/* SEMEADURA. Sem ela, no primeiro minuto TODO cliente estaria "sem conferência"
   e a esteira pararia até a sincronização varrer a base. Semeia-se quem o
   espelho do Omie já mostra igual ao Asaas (CEP e número iguais, logradouro e
   complemento contidos um no outro depois de normalizados). O resto — inclusive
   quem não tem linha no espelho — fica para a sincronização. */
insert into public.nfse_cadastro_sincronizado (doc, id_customer, assinatura, resultado, detalhe)
select distinct on (x.doc, x.cus) x.doc, x.cus, public.nfse_assinatura_endereco(x.d), 'semeado',
       'espelho do Omie igual ao Asaas em 16/09/2026'
from (
  select regexp_replace(coalesce(cu.dados->>'cpfCnpj', ''), '\D', '', 'g') as doc,
         cu.id_asaas as cus, cu.dados as d
  from asaas_cache cu
  where cu.tipo = 'customer' and public.nfse_asaas_endereco_completo(cu.dados)
) x
join lateral (select min(od.codigo) as codigo from omie_clientes_doc od where od.doc = x.doc) oc on oc.codigo is not null
join omie_clientes_endereco e on e.codigo = oc.codigo
where x.doc <> ''
  and regexp_replace(coalesce(x.d->>'postalCode', ''), '\D', '', 'g') = regexp_replace(coalesce(e.cep, ''), '\D', '', 'g')
  and regexp_replace(coalesce(x.d->>'addressNumber', ''), '\D', '', 'g') = regexp_replace(coalesce(e.endereco_numero, ''), '\D', '', 'g')
  and (
    position(regexp_replace(upper(unaccent(coalesce(e.endereco, ''))), '[^A-Z0-9]', '', 'g')
             in regexp_replace(upper(unaccent(coalesce(x.d->>'address', ''))), '[^A-Z0-9]', '', 'g')) > 0
    or position(regexp_replace(upper(unaccent(coalesce(x.d->>'address', ''))), '[^A-Z0-9]', '', 'g')
             in regexp_replace(upper(unaccent(coalesce(e.endereco, ''))), '[^A-Z0-9]', '', 'g')) > 0
  )
  and (
    btrim(coalesce(x.d->>'complement', '')) = ''
    or position(regexp_replace(upper(unaccent(x.d->>'complement')), '[^A-Z0-9]', '', 'g')
                in regexp_replace(upper(unaccent(coalesce(e.complemento, ''))), '[^A-Z0-9]', '', 'g')) > 0
  )
on conflict do nothing;

/* O cron da sincronização: de 30 em 30 minutos, a partir das 11h UTC — antes da
   primeira rodada de emissão (13h) e fora dos minutos da mesma função
   (:20 preparar, 12:45 criar), porque o Omie tranca por método. */
select cron.unschedule('nf-sincronizar-cadastros') where exists (select 1 from cron.job where jobname = 'nf-sincronizar-cadastros');
select cron.schedule(
  'nf-sincronizar-cadastros',
  '7,37 11-21 * * *',
  (select replace(replace(command, 'nf-preparar-cadastros', 'nf-sincronizar-cadastros'),
                  '''action'', ''preparar'', ''teto'', 20', '''action'', ''sincronizar_fila''')
   from cron.job where jobname = 'nf-preparar-cadastros')
);
