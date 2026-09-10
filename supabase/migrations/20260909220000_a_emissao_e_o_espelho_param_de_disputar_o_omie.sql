/* A EMISSÃO E O ESPELHO PARAM DE DISPUTAR O MESMO `ListarOS`
 * =========================================================
 *
 * Em 09/09/2026 uma emissão avulsa da tela criou 4 Ordens de Serviço no Omie e
 * morreu antes de faturar, com "Consumo redundante detectado". A causa não foi o
 * Omie estar sobrecarregado: foi o cron `nf-espelho-rodada` das 15:55 paginando o
 * MESMO `ListarOS` no mesmo instante. A trava do Omie é POR MÉTODO — dois
 * processos NOSSOS chamando `ListarOS` juntos derrubam um dos dois.
 *
 * E eles se cruzam o tempo todo: `nf-emissao-diaria` roda aos :00,:10,… e
 * `nf-espelho-rodada` aos :05,:15,… das 13h às 21h UTC. Há alguém listando OS de
 * 5 em 5 minutos, cada rodada leva 100–150s, e a emissão manual da tela cai onde
 * calhar. A colisão não era um azar: era uma questão de quando.
 *
 * O estrago é assimétrico, e é isso que justifica a trava. O espelho que perde a
 * vez não custa nada — ele volta em 10 minutos e relê tudo. A EMISSÃO que perde a
 * vez no meio do caminho deixa OS criada e não faturada: nota que não saiu,
 * carimbo `cCodIntOS` gasto, e (quando a cobrança é `CONFIRMED`, que só emite por
 * ato de gente) uma cobrança que não volta para fila nenhuma — fica esperando um
 * clique que ninguém sabe que precisa dar.
 *
 * A TRAVA É UMA CONCESSÃO COM PRAZO, não um lock de sessão. `pg_advisory_lock`
 * seria o instinto e está errado aqui: ele morre com a conexão, e as conexões do
 * PostgREST são de um pool — o lock evaporaria no fim da chamada RPC, não no fim
 * do trabalho no Omie. O que se guarda é uma linha com dono e validade; quem chega
 * depois lê quem está dentro, e a validade garante que um worker morto (150s de
 * teto, `WORKER_RESOURCE_LIMIT`, deploy no meio) não tranque o recurso para
 * sempre.
 *
 * Ela cobre só quem chama `ListarOS`, que neste projeto é uma função só
 * (`omie-nfse-sync`). As outras funções que falam com o Omie usam outros métodos,
 * e a trava do Omie é por método — não há o que serializar entre elas.
 */

create table if not exists public.omie_trava (
  recurso   text primary key,
  dono      text        not null,
  tomada_em timestamptz not null default now(),
  expira_em timestamptz not null
);

comment on table public.omie_trava is
  'Concessão com prazo para um recurso do Omie (hoje: o método ListarOS). A linha '
  'sobrevive à soltura para dizer quem segurou por último — é diagnóstico, não fila.';

alter table public.omie_trava enable row level security;
revoke all on table public.omie_trava from public, anon, authenticated;

/* Toma a trava, ou diz quem está dentro.
 *
 * Reentrante pelo DONO: a mesma rodada pode renovar a própria concessão sem se
 * barrar. Um `insert ... on conflict do update ... where` faz a decisão inteira
 * num comando só — é o `row_count` dele que responde "peguei?", e não uma leitura
 * anterior, que abriria janela para os dois acharem que pegaram.
 */
create or replace function public.omie_trava_tomar(
  p_recurso  text,
  p_dono     text,
  p_segundos integer default 180
) returns table (tomada boolean, dono_atual text, expira_em timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_linhas integer;
  v_dono   text;
  v_exp    timestamptz;
begin
  insert into public.omie_trava as t (recurso, dono, tomada_em, expira_em)
  values (
    p_recurso, p_dono, now(),
    now() + make_interval(secs => greatest(coalesce(p_segundos, 180), 10))
  )
  on conflict (recurso) do update
     set dono = excluded.dono, tomada_em = now(), expira_em = excluded.expira_em
   where t.expira_em < now() or t.dono = excluded.dono;

  get diagnostics v_linhas = row_count;

  select t.dono, t.expira_em into v_dono, v_exp
    from public.omie_trava t where t.recurso = p_recurso;

  return query select (v_linhas > 0), v_dono, v_exp;
end;
$function$;

/* Soltar é vencer a própria concessão, e só a PRÓPRIA: sem o `dono` no `where`,
 * uma rodada atrasada soltaria a trava de quem entrou depois dela. */
create or replace function public.omie_trava_soltar(p_recurso text, p_dono text)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  update public.omie_trava
     set expira_em = now() - interval '1 second'
   where recurso = p_recurso and dono = p_dono
  returning true;
$function$;

revoke all on function public.omie_trava_tomar(text, text, integer) from public, anon;
revoke all on function public.omie_trava_soltar(text, text) from public, anon;
grant execute on function public.omie_trava_tomar(text, text, integer) to service_role;
grant execute on function public.omie_trava_soltar(text, text) to service_role;


/* A REDE EMBAIXO DA TRAVA: quem ficou com OS criada e sem faturamento
 * ==================================================================
 *
 * A trava impede a colisão conhecida, mas não impede um worker morrer entre criar
 * a OS e disparar o lote — 150s de teto, deploy no meio, queda de rede. O que não
 * pode continuar é o desfecho ser INVISÍVEL.
 *
 * Órfã aqui é estrito: OS nossa (carimbo `pay_`), não faturada, não cancelada, e
 * SEM NENHUM passo de faturamento no diário. Não é a que tentou e falhou — essa
 * aparece no Registro com "Falhou" e o motivo do Omie, e tem quem cuide dela. É a
 * que nunca chegou a ser despachada, e por isso não aparece em lugar nenhum.
 *
 * `volta_sozinha` é a coluna que muda o que se faz com a linha: quando a régua da
 * rodada automática aceita a cobrança (recebida, sem estorno), a fila reencontra a
 * OS pelo carimbo e fatura sem ninguém pedir — é só esperar a próxima janela.
 * Quando não aceita (a `CONFIRMED` do cartão parcelado, que só emite como avulsa
 * porque alguém assina a espera), NÃO existe processo que a resgate. Essa é a que
 * precisa de gente, e é a única que o aviso diário mostra.
 */
create or replace function public.nf_os_orfas(p_minutos integer default 30)
returns table (
  n_cod_os      bigint,
  id_asaas      text,
  cliente       text,
  valor         numeric,
  etapa         text,
  criada_em     timestamptz,
  status_asaas  text,
  volta_sozinha boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with nossas as (
    select o.n_cod_os, o.c_cod_int_os as id_asaas, o.valor, o.etapa
      from public.nf_os_omie o
     where o.c_cod_int_os like 'pay%'
       and coalesce(o.faturada, false)  = false
       and coalesce(o.cancelada, false) = false
  ),
  passos as (
    select n.*,
           (select min(e.criado_em) from public.nf_emissoes e
             where e.n_cod_os = n.n_cod_os) as criada_em,
           exists (
             select 1 from public.nf_emissoes e
              where e.n_cod_os = n.n_cod_os
                and e.acao in ('faturar', 'criar_e_faturar', 'refazer')
           ) as despachada
      from nossas n
  )
  select p.n_cod_os,
         p.id_asaas,
         /* O nome mora no CLIENTE, não na cobrança: `asaas_cache.nome` da linha de
          * `payment` vem nulo, e quem lê um aviso precisa do nome, não do `cus_…`. */
         coalesce(cli.nome, cli.dados->>'name', cli.dados->>'company', c.cliente_ref, '—') as cliente,
         p.valor,
         p.etapa,
         p.criada_em,
         c.status,
         public.nfse_bloqueio_emissao(c.status, c.dados, false, false) is null
    from passos p
    join public.asaas_cache c on c.tipo = 'payment' and c.id_asaas = p.id_asaas
    left join public.asaas_cache cli
      on cli.tipo = 'customer'
     and cli.id_asaas = coalesce(c.cliente_ref, c.dados->>'customer')
   where p.despachada = false
     and p.criada_em is not null
     and p.criada_em < now() - make_interval(mins => greatest(coalesce(p_minutos, 30), 1))
   order by p.criada_em;
$function$;

revoke all on function public.nf_os_orfas(integer) from public, anon;
grant execute on function public.nf_os_orfas(integer) to authenticated, service_role;
