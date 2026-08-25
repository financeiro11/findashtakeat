-- Nota de fornecedor no ERP: a régua, a medição e o diário.
--
-- O PROBLEMA QUE ISTO RESOLVE. Levantamento de 25/08/2026: dos R$ 7,6 milhões de
-- despesa liquidada entre abril e agosto, o Hub só sabia dizer alguma coisa sobre
-- R$ 2,85 milhões — e só porque a `omie-pix-sync` lê `ListarAnexo` título a título
-- na conta corrente do Sicoob. O cartão (2.136 títulos, R$ 1,3 mi), o BTG e as
-- contas de subvenção nunca foram perguntados. "Está tudo no ERP?" não tinha
-- resposta, só palpite.
--
-- Três peças, nesta ordem:
--
--   1. `omie_categoria_regra` — QUAL despesa exige nota. Sem isso, qualquer
--      percentual de cobertura é contestável: transferência entre contas próprias
--      (R$ 5,45 mi no período), folha, imposto e tarifa bancária não têm nota de
--      fornecedor, e contá-las como "faltando" faz o número perder a autoridade
--      exatamente na reunião em que ele precisa ter.
--
--   2. `omie_titulo_anexo` — O QUE O ERP TEM, lido do próprio Omie. É o único
--      lugar do Hub que responde "este título tem anexo?" para qualquer título,
--      inclusive os anexados à mão por alguém, que o Hub não tem como saber de
--      outro jeito.
--
--   3. `omie_anexo_envio_log` — POR QUE NÃO FOI. A varredura de envio até hoje
--      logava a falha no console do worker e devolvia na resposta HTTP; quando o
--      cron rodava, ninguém lia. Recusa sem rastro é indistinguível de
--      esquecimento — a mesma frase que o `omie-nfse-sync` já aprendeu a duras
--      penas do lado da receita.

/* ============================================================================
 *  1. A RÉGUA — qual categoria exige nota de fornecedor
 * ========================================================================== */

create table if not exists public.omie_categoria_regra (
  -- cCodCateg do Omie ("2.04.12"). É a chave que o movimento carrega.
  codigo        text primary key,
  descricao     text,
  -- 'exige'    → a despesa tem de ter nota anexada no título;
  -- 'dispensa' → não existe nota de fornecedor para isso (folha, tributo,
  --              transferência interna, tarifa bancária, devolução);
  -- 'conferir' → às vezes tem, às vezes não (passagem aérea vem como bilhete,
  --              refeição vem como cupom). Não entra no numerador nem acusa
  --              buraco — aparece numa lista própria para alguém olhar.
  regra         text not null default 'exige'
                check (regra in ('exige', 'dispensa', 'conferir')),
  motivo        text,
  -- 'semente' = classificado pela regra automática abaixo; 'humano' = alguém
  -- decidiu na tela. A semente NUNCA sobrescreve o humano (ver o insert final).
  origem        text not null default 'semente' check (origem in ('semente', 'humano')),
  definido_por  uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.omie_categoria_regra is
  'Diz, por categoria do plano de contas, se aquela despesa exige nota de fornecedor anexada no título do Omie. É o denominador de toda medição de cobertura.';
comment on column public.omie_categoria_regra.regra is
  'exige | dispensa | conferir. "conferir" fica fora do numerador E do denominador: não vira cobrança nem infla a cobertura.';

/* A regra automática, escrita como função para poder ser reaplicada quando o
 * plano de contas ganhar categoria nova — e para que o critério fique legível
 * em vez de virar uma lista de 86 códigos que ninguém sabe de onde saiu.
 *
 * A leitura é pelo NOME da categoria, não pelo código: o código do Omie não tem
 * semântica ("2.03.11" não diz nada), mas "3.1.1.2. Pessoal - Comercial" diz. */
create or replace function public.cap_regra_sugerida(p_codigo text, p_descricao text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
select case
  -- Movimentação entre contas próprias: não é despesa, é dinheiro mudando de lugar.
  when p_descricao ~* 'transfer(ê|e)ncia'                              then 'dispensa'
  -- Folha, pró-labore e o que remunera pessoa física da casa.
  when p_descricao ~* '(^|[^a-z])pessoal([^a-z]|$)|pro ?labore|pró ?labore|diretores|f(é|e)rias|13(º|o)|rescis(ã|a)o|sal(á|a)rio'
                                                                        then 'dispensa'
  -- Premiação e escala: pagamento a colaborador, sem nota.
  when p_descricao ~* 'premia(ç|c)(ã|a)o|escala'                        then 'dispensa'
  -- Tributos e encargos: o documento é a guia, não a nota.
  when p_descricao ~* '\m(pis|cofins|iss|iptu|iof|irf|irpj|csll|inss|fgts|das|darf)\M|imposto|reten(ç|c)(ã|a)o de contribui'
                                                                        then 'dispensa'
  -- Financeiro: amortização, juros, multa, tarifa, taxa de operação de crédito.
  when p_descricao ~* 'amortiza(ç|c)(ã|a)o|juros|multas? pagas?|tarifas?|taxa de opera(ç|c)(ã|a)o'
                                                                        then 'dispensa'
  -- Devolução ao cliente: sai dinheiro, não entra serviço.
  when p_descricao ~* 'estorno|devolu(ç|c)(ã|a)o'                       then 'dispensa'
  -- Passagem, hospedagem e refeição: bilhete/cupom com frequência, NF às vezes.
  when p_descricao ~* 'transportes? e viagens|viagem|passagem|hospedagem|alimenta(ç|c)(ã|a)o|confraterniza'
                                                                        then 'conferir'
  else 'exige'
end;
$function$;

comment on function public.cap_regra_sugerida(text, text) is
  'Classificação automática de uma categoria em exige/dispensa/conferir, lida pelo NOME da categoria. Semente de omie_categoria_regra; a decisão humana vence.';

/* Semente. `on conflict do nothing` de propósito: rodar a migration de novo (ou
 * chamar o resemeador quando entrar categoria nova) não pode apagar o que uma
 * pessoa decidiu na tela. */
insert into public.omie_categoria_regra (codigo, descricao, regra, motivo, origem)
select c.codigo,
       c.descricao,
       public.cap_regra_sugerida(c.codigo, c.descricao),
       case public.cap_regra_sugerida(c.codigo, c.descricao)
         when 'dispensa' then 'Classificada pelo nome da categoria — não há nota de fornecedor para este tipo de saída.'
         when 'conferir' then 'Às vezes vem bilhete ou cupom em vez de nota. Fica fora da cobrança automática.'
         else null
       end,
       'semente'
from (
  select distinct on (codigo)
         c->>'codigo' as codigo,
         coalesce(c->>'descricao', '') as descricao
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'categorias'
    and coalesce(c->>'natureza', '') <> 'R'   -- receita não interessa aqui
    and c->>'codigo' like '2.%'                -- o galho de despesa do plano
  order by codigo
) c
on conflict (codigo) do nothing;

/* Categoria que aparece nos movimentos mas não está no cache de categorias
 * (acontece com categoria criada depois do último sync). Sem esta segunda
 * passada, o título dela ficaria sem régua e sumiria da conta em silêncio. */
insert into public.omie_categoria_regra (codigo, descricao, regra, motivo, origem)
select distinct m.cat, null, 'exige',
       'Categoria vista num título mas ausente do cadastro espelhado — classificada como exige até alguém revisar.',
       'semente'
from (
  select d->'detalhes'->>'cCodCateg' as cat
  from public.omie_cache, jsonb_array_elements(dados) d
  where chave = 'movimentos'
    and d->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
    and coalesce(d->'detalhes'->>'cCodCateg', '') <> ''
) m
on conflict (codigo) do nothing;

/* ============================================================================
 *  2. O QUE O ERP TEM — a leitura de ListarAnexo, título a título
 * ========================================================================== */

create table if not exists public.omie_titulo_anexo (
  cod_titulo   bigint primary key,
  -- 'conta-pagar' | 'conta-receber' — qual tabela do Omie respondeu.
  c_tabela     text,
  qtd          integer not null default 0,
  -- [{ id, nome, tipo, tamanho }] — o nome importa: é ele que denuncia
  -- "nf_undefined_correta.pdf" sem ninguém precisar abrir o ERP.
  anexos       jsonb   not null default '[]'::jsonb,
  -- O anexo parece uma nota fiscal (pelo nome/extensão)? Separa "tem arquivo"
  -- de "tem a nota certa". Nulo enquanto não houver anexo nenhum.
  parece_nota  boolean,
  lido_em      timestamptz not null default now(),
  -- Quando a leitura falhou (rate limit, tabela inválida). Fica registrado para
  -- a fila saber que precisa voltar, em vez de tratar como "zero anexos".
  erro         text
);

comment on table public.omie_titulo_anexo is
  'Quantos anexos cada título do Omie tem, lido do próprio ERP via geral/anexo/ListarAnexo. É a única fonte do Hub que enxerga anexo posto à mão no Omie.';
comment on column public.omie_titulo_anexo.erro is
  'Leitura falhou. Diferente de qtd=0: "não deu para ler" não é "não tem nota".';

create index if not exists omie_titulo_anexo_lido_idx on public.omie_titulo_anexo (lido_em);
create index if not exists omie_titulo_anexo_vazio_idx on public.omie_titulo_anexo (cod_titulo) where qtd = 0;

/* ============================================================================
 *  3. POR QUE NÃO FOI — o diário do envio
 * ========================================================================== */

create table if not exists public.omie_anexo_envio_log (
  id         bigserial primary key,
  -- 'auditoria' | 'cartao' | 'facilities' | 'pix' | 'manual'
  origem     text not null,
  ref_id     text not null,
  rotulo     text,
  cod_titulo text,
  arquivo    text,
  -- 'ok' | 'erro' | 'bloqueado' (faltou uma condição para sequer tentar)
  resultado  text not null check (resultado in ('ok', 'erro', 'bloqueado')),
  motivo     text,
  canal      text,
  criado_em  timestamptz not null default now()
);

comment on table public.omie_anexo_envio_log is
  'Uma linha por tentativa de anexar comprovante no Omie, inclusive as que nem chegaram a tentar. Append-only: é o rastro que responde "por que essa nota não subiu".';

create index if not exists omie_anexo_envio_log_criado_idx on public.omie_anexo_envio_log (criado_em desc);
create index if not exists omie_anexo_envio_log_ref_idx    on public.omie_anexo_envio_log (origem, ref_id);

/* ============================================================================
 *  4. Configuração da medição
 * ========================================================================== */

create table if not exists public.cap_notas_config (
  id             smallint primary key default 1 check (id = 1),
  -- Abaixo deste valor a despesa é dispensada de nota. Nasce em 0 de propósito:
  -- dispensar por valor é decisão de política contábil, não padrão de software.
  piso_valor     numeric not null default 0,
  -- Quantos dias uma leitura de anexo vale antes de valer a pena reler. Título
  -- que já tem anexo não muda; o que não tem pode ganhar um a qualquer momento.
  releitura_dias integer not null default 30,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);

insert into public.cap_notas_config (id) values (1) on conflict (id) do nothing;

comment on table public.cap_notas_config is
  'Parâmetros da medição de cobertura de notas no ERP. O piso nasce em zero: nada é dispensado por valor até alguém decidir que sim.';

/* ============================================================================
 *  Privilégios
 * ========================================================================== */

revoke all on public.omie_categoria_regra  from anon, authenticated;
revoke all on public.omie_titulo_anexo     from anon, authenticated;
revoke all on public.omie_anexo_envio_log  from anon, authenticated;
revoke all on public.cap_notas_config      from anon, authenticated;

-- A régua e o piso são editados na tela por quem está logado; o resto é leitura.
grant select, insert, update on public.omie_categoria_regra to authenticated;
grant select                 on public.omie_titulo_anexo    to authenticated;
grant select                 on public.omie_anexo_envio_log to authenticated;
grant select, update         on public.cap_notas_config     to authenticated;

grant all on public.omie_categoria_regra  to service_role;
grant all on public.omie_titulo_anexo     to service_role;
grant all on public.omie_anexo_envio_log  to service_role;
grant all on public.cap_notas_config      to service_role;

alter table public.omie_categoria_regra  enable row level security;
alter table public.omie_titulo_anexo     enable row level security;
alter table public.omie_anexo_envio_log  enable row level security;
alter table public.cap_notas_config      enable row level security;

drop policy if exists "regra_leitura"  on public.omie_categoria_regra;
drop policy if exists "regra_escrita"  on public.omie_categoria_regra;
create policy "regra_leitura" on public.omie_categoria_regra for select to authenticated using (true);
create policy "regra_escrita" on public.omie_categoria_regra for all    to authenticated using (true) with check (true);

drop policy if exists "anexo_leitura" on public.omie_titulo_anexo;
create policy "anexo_leitura" on public.omie_titulo_anexo for select to authenticated using (true);

drop policy if exists "envio_log_leitura" on public.omie_anexo_envio_log;
create policy "envio_log_leitura" on public.omie_anexo_envio_log for select to authenticated using (true);

drop policy if exists "config_leitura" on public.cap_notas_config;
drop policy if exists "config_escrita" on public.cap_notas_config;
create policy "config_leitura" on public.cap_notas_config for select to authenticated using (true);
create policy "config_escrita" on public.cap_notas_config for update to authenticated using (true) with check (true);

-- Função nova nasce chamável por anon no Supabase; fechar uma a uma, porque
-- REVOKE em bloco não alcança a assinatura específica.
revoke all on function public.cap_regra_sugerida(text, text) from anon;
