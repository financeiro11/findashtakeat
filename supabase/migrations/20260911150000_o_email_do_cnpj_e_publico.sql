/* ---------------------------------------------------------------------------
 * O E-MAIL DO CNPJ É PÚBLICO — e era a pendência que mais chegava a uma pessoa.
 *
 * MEDIDO EM 11/09/2026, sobre os 7.046 cadastros espelhados do Omie:
 *
 *     não emitem NFS-e ....................... 616
 *     travados SÓ pelo e-mail ................ 354  (57%)
 *     desses, com e-mail no Asaas ............  25  (7%)
 *
 * Ou seja: mais da metade da fila de cadastro parada por um campo, e o Asaas —
 * a origem que o Hub já lê — só resolve 7% dela. O resto chegava à tela de
 * Notas Fiscais como "isto precisa de conferência humana", um cliente por vez.
 *
 * A DESCOBERTA. O Hub já consulta a Receita (BrasilAPI `/cnpj`) para montar o
 * endereço de todo cliente PJ — e o campo `email` dessa resposta vem `null`:
 * 14 de 14 na amostra dos travados. O telefone vem (13 de 14) e era descartado
 * junto. A pergunta certa estava sendo feita à fonte errada.
 *
 * O MESMO dado, pelo campo `correio_eletronico` da base da Receita, está
 * publicado em JSON por quem o expõe: `open.cnpja.com` (3 de 3 na amostra) e
 * `receitaws.com.br` (6 de 6). Nenhum dos dois cobra; os dois limitam por
 * minuto, e é esse limite que desenha `_shared/cnpj-contato.ts`.
 *
 * ESTA TABELA É O QUE TORNA O LIMITE SUPORTÁVEL. 5 consultas por minuto num
 * worker de 150s são ~8 por invocação; sem cache, a fila de 354 nunca sairia dos
 * primeiros nomes, porque cada passada recomeçaria do zero. Guarda-se inclusive
 * o VAZIO — CNPJ cuja consulta respondeu "não há contato publicado" não pode ser
 * perguntado de novo amanhã, ou ele come sozinho a cota da leva seguinte.
 *
 * SÓ CNPJ. A chave é de 14 dígitos por construção: contato de pessoa física não
 * é cadastro público de empresa, e a única razão de buscar isto é emitir a nota
 * PARA aquela empresa.
 * ------------------------------------------------------------------------- */

create table if not exists public.cnpj_contato_cache (
  doc       text primary key,
  -- Nulo quando a consulta respondeu e não havia contato publicado. É a
  -- diferença entre "ninguém perguntou" (linha ausente) e "perguntamos e não
  -- tem" (linha com email nulo) — a segunda economiza a cota da próxima leva.
  email     text,
  telefone  text,
  -- "cnpja" | "receitaws". Qual porta respondeu, para o rastro.
  fonte     text,
  lido_em   timestamptz not null default now(),
  constraint cnpj_contato_cache_doc_cnpj check (doc ~ '^[0-9]{14}$')
);

comment on table public.cnpj_contato_cache is
  'E-mail e telefone do cadastro federal do CNPJ, lidos de open.cnpja.com ou '
  'receitaws.com.br. Existe porque a BrasilAPI (a fonte que o Hub usa para '
  'endereço) devolve email nulo, e o e-mail faltando trava 57% dos cadastros que '
  'não emitem NFS-e. Linha com email nulo é resposta negativa cacheada, não '
  'ausência de consulta.';

create index if not exists cnpj_contato_cache_lido_idx
  on public.cnpj_contato_cache (lido_em desc);

alter table public.cnpj_contato_cache enable row level security;

-- Leitura para quem está logado; a escrita é da Edge Function, que usa a service
-- role e não passa por policy. Sem o `revoke`, a tabela nasceria legível por
-- anon — ver a migration de grants do repo.
create policy cnpj_contato_cache_leitura
  on public.cnpj_contato_cache for select
  to authenticated using (true);

revoke all on public.cnpj_contato_cache from anon;
