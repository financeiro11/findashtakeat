-- A busca do Registro de emissões — procurar QUALQUER nota, não só as da tela.
--
-- A tela do Registro lê `notas_fiscais_log` com teto de 400 passos, e o diário é
-- por PASSO: em 15/09/2026 eram 13.954 linhas em 30 dias (~460 por dia). Os 400
-- cobrem menos de um dia, e o PostgREST corta qualquer RPC em 1000 de qualquer
-- jeito — uma busca feita no navegador sobre o que veio simplesmente não acharia
-- a nota de anteontem, e diria "nada encontrado" com toda a convicção.
--
-- Por isso a busca mora aqui e olha o diário INTEIRO. Ela devolve as mesmas
-- colunas do log, e devolve TODOS os passos de cada cobrança que casou — não só
-- o passo que casou —, porque a tela agrupa por cliente e mostra a sequência:
-- o número da nota aparece num passo e o motivo da recusa noutro.
--
-- O que casa:
--   • texto (sem acento, sem caixa): nome do cliente, id da cobrança, motivo, operador;
--   • termo só de dígitos (aceita ponto, traço, barra e espaço): número da NFS-e,
--     OS do Omie, chave de acesso e CPF/CNPJ do cliente.
--
-- O teto é de COBRANÇAS (as mais recentes que casam), não de linhas: cortar por
-- linha cortaria a história de uma cobrança no meio.

create or replace function public.notas_fiscais_busca(p_termo text, p_cobrancas integer default 60)
returns table (
  criado_em timestamptz, id_asaas text, cliente text, valor numeric,
  acao text, resultado text, nfse_numero text, nfse_chave text,
  motivo text, operador text, n_cod_os bigint, avulsa boolean
)
language sql stable set search_path to 'public'
as $$
with termo as (
  select
    -- `%` e `_` do que se digitou são letra, não curinga ("pay_" é id do Asaas).
    replace(replace(replace(lower(public.unaccent(btrim(coalesce(p_termo, '')))),
      '\', '\\'), '%', '\%'), '_', '\_') as t,
    regexp_replace(coalesce(p_termo, ''), '\D', '', 'g') as d,
    btrim(coalesce(p_termo, '')) ~ '^[0-9 ./-]+$' as numerico
),
linha as materialized (
  select e.criado_em, e.id_asaas,
         coalesce(c.dados->>'name', c.dados->>'company', s.nome, '—') as cliente,
         coalesce(p.valor, s.valor) as valor, e.acao, e.resultado, e.nfse_numero,
         case when e.nfse_numero is not null and o.nfse_numero = e.nfse_numero
              then o.nfse_verificacao end as nfse_chave,
         e.erro as motivo, e.operador, e.n_cod_os, e.avulsa,
         c.dados->>'cpfCnpj' as documento
  from public.nf_emissoes e
  left join public.asaas_cache p on p.tipo = 'payment' and p.id_asaas = e.id_asaas
  left join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
  left join public.nf_notas_sem_cobranca s on s.id = e.id_asaas
  left join public.nf_os_omie o on o.n_cod_os = e.n_cod_os
),
alvo as (
  select l.id_asaas
  from linha l cross join termo
  where length(termo.t) >= 2
    and (
         lower(public.unaccent(l.cliente)) like '%' || termo.t || '%'
      or lower(l.id_asaas) like '%' || termo.t || '%'
      -- Termo só de número não entra no motivo por substring: "16901" achava as
      -- 16 cobranças do "Lote 5516901052". Lá ele casa só como número INTEIRO,
      -- o que ainda deixa procurar pelo lote.
      or (not termo.numerico and lower(public.unaccent(coalesce(l.motivo, ''))) like '%' || termo.t || '%')
      or (termo.numerico and length(termo.d) >= 3 and coalesce(l.motivo, '') ~ ('(^|\D)' || termo.d || '(\D|$)'))
      or (not termo.numerico and lower(public.unaccent(coalesce(l.operador, ''))) like '%' || termo.t || '%')
      -- Número de nota e OS casam EXATOS: "16901" por substring achava 17
      -- cobranças, porque cinco dígitos quaisquer aparecem dentro de uma chave
      -- de 50. Pedaço de chave e de CPF/CNPJ só a partir de 8 dígitos — a raiz
      -- do CNPJ é o pedaço que alguém de fato cola.
      or (termo.numerico and length(termo.d) >= 3 and (
             ltrim(coalesce(l.nfse_numero, ''), '0') = ltrim(termo.d, '0')
          or l.n_cod_os::text = termo.d
          or (length(termo.d) >= 8 and (
                 coalesce(l.nfse_chave, '') like '%' || termo.d || '%'
              or regexp_replace(coalesce(l.documento, ''), '\D', '', 'g') like '%' || termo.d || '%'
          ))
      ))
    )
  group by l.id_asaas
  order by max(l.criado_em) desc
  limit greatest(least(p_cobrancas, 200), 1)
)
select l.criado_em, l.id_asaas, l.cliente, l.valor, l.acao, l.resultado,
       l.nfse_numero, l.nfse_chave, l.motivo, l.operador, l.n_cod_os, l.avulsa
from linha l
join alvo a on a.id_asaas = l.id_asaas
order by l.criado_em desc;
$$;

-- Função nova nasce chamável por `anon`; esta lê cliente, valor e CNPJ.
revoke all on function public.notas_fiscais_busca(text, integer) from public, anon;
grant execute on function public.notas_fiscais_busca(text, integer) to authenticated, service_role;
