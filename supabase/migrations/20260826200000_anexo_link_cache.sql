-- O link do anexo passa a ser guardado — abrir a nota deixa de custar o Omie.
--
-- O QUE ESTAVA LENTO. Cada clique em "Abrir" gastava uma chamada
-- `geral/anexo/ObterAnexo` ao ERP. A trava do Omie é POR MÉTODO e as varreduras
-- de anexo disputam a mesma fila, então a espera não é o tempo da rede: é o
-- tempo de chegar a vez. Conferindo 32 anexos em sequência, isso acontecia 32
-- vezes — e de novo a cada volta, porque nada era guardado.
--
-- O QUE TORNA ISSO DESNECESSÁRIO: a resposta do Omie é um link assinado do
-- `cdn.omie.com.br` com `dDtExpiracao` no DIA SEGUINTE. O arquivo não muda e o
-- endereço vale horas. Pedir de novo o mesmo link é pagar duas vezes pela mesma
-- informação — o mesmo raciocínio que já fez `anexoAlvo` ler
-- `omie_titulo_anexo` em vez de chamar `ListarAnexo`.
--
-- A VALIDADE GUARDADA É MENOR QUE A REAL, de propósito. O Omie diz que o link
-- morre amanhã; aqui ele é dado como bom por 6 horas. Servir um link morto é
-- pior do que buscar outro: a tela mostra o quadro branco e quem está
-- conferindo conclui que o anexo sumiu do ERP.
--
-- BASE64 NÃO ENTRA. Quando o Omie devolve o conteúdo em vez do endereço, o
-- arquivo pode ter megabytes — guardá-lo aqui encheria a tabela e o `select`
-- da fila passaria a arrastar documento fiscal. Só o link é cacheável.

create table if not exists public.omie_anexo_link (
  cod_titulo bigint not null,
  -- '' quando o anexo não tem id e é buscado por nome: é chave, não pode ser nulo.
  id_anexo   text   not null default '',
  nome       text,
  tipo       text,
  url        text   not null,
  expira_em  timestamptz not null,
  lido_em    timestamptz not null default now(),
  primary key (cod_titulo, id_anexo)
);

comment on table public.omie_anexo_link is
  'Cache do link assinado que o `geral/anexo/ObterAnexo` devolve. Existe para que abrir a nota não custe uma vez na fila do Omie — e para que a fila de conferência possa ser aquecida ANTES de alguém clicar.';
comment on column public.omie_anexo_link.expira_em is
  'Quando este link deixa de ser servido. Bem antes do `dDtExpiracao` do Omie: link morto vira quadro branco, e quadro branco lê-se como "o anexo sumiu".';

/* Índice da fila de aquecimento: quem está para vencer sai primeiro. Parcial
   não serve aqui — a condição é uma comparação com `now()`, que não é imutável
   e não entra em índice parcial. */
create index if not exists omie_anexo_link_expira_idx
  on public.omie_anexo_link (expira_em);

alter table public.omie_anexo_link enable row level security;

/* Sem policy: quem lê é a Edge Function com service role. A tabela guarda
   endereço de documento fiscal assinado — um link vazado é o arquivo aberto
   para quem tiver a URL, sem passar por login. Mesmo desenho de
   `internal_cron_tokens`. */

/* ============================================================================
 *  A fila de aquecimento
 * ==========================================================================
 * Quais títulos vale ter o link pronto ANTES do clique. É a mesma pergunta da
 * aba "Anexo a conferir": anexo que o ERP tem, cujo nome não identifica nada, e
 * que ninguém julgou ainda. São 32 hoje — cabe inteiro no cache.
 *
 * Ordena pelo que está mais frio: sem link, ou com link mais perto de vencer.
 * `p_limite` é pequeno porque cada item custa uma vez na fila do Omie, e o cron
 * roda de novo em minutos. */

create or replace function public.omie_anexo_link_fila(p_limite integer default 8)
returns table (cod_titulo bigint, id_anexo text, c_tabela text, nome text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select a.cod_titulo,
         coalesce(a.anexos->0->>'id', '') as id_anexo,
         coalesce(a.c_tabela, 'conta-pagar') as c_tabela,
         a.anexos->0->>'nome' as nome
    from public.omie_titulo_anexo a
    left join public.omie_anexo_link l
           on l.cod_titulo = a.cod_titulo
          and l.id_anexo = coalesce(a.anexos->0->>'id', '')
   where coalesce(a.qtd, 0) > 0
     and a.revisao is null
     and a.classe = 'duvidoso'
     and (l.cod_titulo is null or l.expira_em < now() + interval '90 minutes')
   order by l.expira_em nulls first, a.cod_titulo
   limit greatest(1, least(coalesce(p_limite, 8), 40));
$$;

revoke all on function public.omie_anexo_link_fila(integer) from public, anon;
grant execute on function public.omie_anexo_link_fila(integer) to service_role;
