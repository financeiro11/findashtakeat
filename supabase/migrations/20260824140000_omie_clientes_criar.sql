/* ---------------------------------------------------------------------------
 * Cadastrar no Omie o cliente que só existe no Asaas.
 *
 * O BURACO. A fila de emissão (`notas_fiscais_fila_emissao`) casa a cobrança com
 * o cadastro do Omie pelo MESMO CNPJ, com INNER JOIN. Cliente que só existe no
 * Asaas não entra na fila, não entra no log de emissões e não aparece em lugar
 * nenhum — a auditoria de 21/08/26 mediu 98 clientes nessa situação. Enquanto o
 * Asaas emitiu, o buraco ficou tapado por fora; depois do corte (`nf_config`),
 * cada um desses clientes é uma nota que não sai.
 *
 * A aba Auditoria já mostra quem falta. O que faltava era o conserto, e o
 * conserto é cadastro — que é escrita no ERP, e por isso mora aqui com regra
 * explícita de quem pode ser criado sozinho.
 *
 * QUEM ENTRA NA FILA DE CADASTRO É A MESMA LISTA DA AUDITORIA, de propósito.
 * `notas_fiscais_auditoria` já responde "quem a emissão não encontra, e existe
 * algo parecido no Omie?" — reescrever a pergunta aqui criaria um segundo lugar
 * para a verdade divergir, e no dia em que divergissem a aba estaria mostrando
 * uma lista e o cadastrador criando outra. Esta função só ACRESCENTA o que a
 * criação precisa e a auditoria não tem: o id do cliente no Asaas, o endereço
 * dele e o que já se tentou antes.
 *
 * DOIS BLOQUEIOS, E ELES NÃO SÃO O MESMO CUIDADO:
 *
 *   • `documento_invalido` — o CPF/CNPJ do Asaas não fecha no dígito
 *     verificador. Cadastrar isso põe lixo no ERP e a nota é recusada depois,
 *     longe daqui.
 *   • `cadastro_divergente` — existe no Omie um cadastro que provavelmente é
 *     este cliente com OUTRO documento (mesma raiz de CNPJ = outra filial; ou o
 *     mesmo nome sob CNPJ sem relação). Aqui cadastrar é o conserto ERRADO:
 *     cria duplicado e a nota sai para o tomador errado, que é pior do que não
 *     sair. Alguém precisa decidir qual documento é o verdadeiro — e por isso o
 *     bloqueio é só um aviso: a tela deixa forçar cliente a cliente, nunca em
 *     lote.
 *
 * O que a criação NÃO decide daqui é a qualidade do endereço: CEP que não
 * existe ou que não pertence ao município é a recusa nº 1 da prefeitura (158 das
 * 277 notas presas em 003), e quem confere isso é a Edge Function, que tem como
 * perguntar à Receita e aos Correios. Aqui só se sabe o que o Postgres sabe.
 * ------------------------------------------------------------------------- */

/* --------------------------- dígito verificador --------------------------- */
/* Existe porque o Asaas aceita o que o cliente digitou. Um CNPJ que não fecha
 * atravessa o cadastro inteiro sem reclamação e só é recusado lá na frente, pela
 * prefeitura, quando a nota já era para ter saído. Em SQL — e não só no TypeScript
 * da função — para que a TELA e o CADASTRADOR contem a mesma coisa. */
create or replace function public.doc_fiscal_valido(p_doc text)
returns boolean
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p_doc, ''), '\D', '', 'g');
  soma int; peso int; dv1 int; dv2 int; i int;
begin
  -- "111.111.111-11" fecha na conta dos dígitos e não é documento de ninguém.
  if d ~ '^(\d)\1+$' then return false; end if;

  if length(d) = 11 then                                    -- CPF
    soma := 0;
    for i in 1..9 loop soma := soma + substr(d, i, 1)::int * (11 - i); end loop;
    dv1 := 11 - (soma % 11); if dv1 >= 10 then dv1 := 0; end if;
    soma := 0;
    for i in 1..10 loop soma := soma + substr(d, i, 1)::int * (12 - i); end loop;
    dv2 := 11 - (soma % 11); if dv2 >= 10 then dv2 := 0; end if;
    return dv1 = substr(d, 10, 1)::int and dv2 = substr(d, 11, 1)::int;

  elsif length(d) = 14 then                                 -- CNPJ
    soma := 0; peso := 5;                                   -- 5,4,3,2,9,8,…,2
    for i in 1..12 loop
      soma := soma + substr(d, i, 1)::int * peso;
      peso := case when peso = 2 then 9 else peso - 1 end;
    end loop;
    dv1 := 11 - (soma % 11); if dv1 >= 10 then dv1 := 0; end if;
    soma := 0; peso := 6;
    for i in 1..13 loop
      soma := soma + substr(d, i, 1)::int * peso;
      peso := case when peso = 2 then 9 else peso - 1 end;
    end loop;
    dv2 := 11 - (soma % 11); if dv2 >= 10 then dv2 := 0; end if;
    return dv1 = substr(d, 13, 1)::int and dv2 = substr(d, 14, 1)::int;
  end if;

  return false;
end $$;

comment on function public.doc_fiscal_valido(text) is
  'CPF/CNPJ fecha no dígito verificador? Só os números importam — pontuação é ignorada.';

/* ------------------------------ o que foi feito --------------------------- */
/* UMA LINHA POR CLIENTE, não um log append-only. O que se pergunta desta tabela
 * é sempre "este cliente já está no Omie, e se não está, por quê?" — pergunta de
 * estado. A tentativa anterior não se perde: `tentativas` conta e `erro` guarda a
 * última recusa, que é o que muda de uma rodada para a outra.
 *
 * A chave é o DOCUMENTO e não o id do Asaas: o mesmo CNPJ aparece em mais de um
 * `cus_` (6.247 clientes para 6.020 documentos), e o que não pode duplicar no
 * Omie é o documento. */
create table if not exists public.omie_clientes_criados (
  doc              text primary key,
  id_asaas         text,
  nome             text,
  n_cod_cli        bigint,                    -- código do cadastro no Omie
  situacao         text not null,             -- criado | ja_existia | bloqueado | falhou
  motivo           text,                      -- a recusa, quando houve
  fonte_endereco   text,                      -- receita | cep | asaas
  payload          jsonb,                     -- o que foi mandado ao Omie
  tentativas       int not null default 1,
  origem           text,                      -- tela | cron
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

comment on table public.omie_clientes_criados is
  'Estado do cadastro no Omie de cada cliente que só existia no Asaas: o que foi criado, '
  'o que foi bloqueado e por quê. Escrita só pela Edge Function omie-clientes-criar.';
comment on column public.omie_clientes_criados.situacao is
  'criado = nasceu agora no Omie; ja_existia = o Omie recusou por documento repetido (e isso é '
  'boa notícia: o cadastro está lá); bloqueado = regra nossa impediu; falhou = o Omie recusou por outro motivo.';

create index if not exists omie_clientes_criados_situacao_idx
  on public.omie_clientes_criados (situacao, atualizado_em desc);

alter table public.omie_clientes_criados enable row level security;

/* Leitura para quem está logado — a aba Auditoria mostra o desfecho ao lado de
 * cada cliente. Escrita não tem policy nenhuma de propósito: quem escreve é a
 * Edge Function com a service role, que passa por cima de RLS. Cadastro no ERP
 * não se cria de dentro do navegador. */
drop policy if exists "omie_clientes_criados_leitura" on public.omie_clientes_criados;
create policy "omie_clientes_criados_leitura"
  on public.omie_clientes_criados for select
  to authenticated using (true);

/* ---------------------------- a fila de cadastro -------------------------- */
/* `security definer` pelo mesmo motivo da auditoria: ela lê `omie_cache`, que
 * tem RLS ligado e ZERO policy — como invoker, devolveria a lista vazia e diria,
 * sem erro nenhum, que não há ninguém para cadastrar. */
create or replace function public.omie_clientes_a_criar(
  p_de     date default null,
  p_ate    date default null,
  p_limite int  default 200
)
returns table(
  id_asaas          text,
  doc               text,
  nome              text,
  pessoa_fisica     boolean,
  email             text,
  telefone          text,
  endereco          text,
  endereco_numero   text,
  complemento       text,
  bairro            text,
  cidade            text,
  estado            text,
  cep               text,
  cobrancas         int,
  valor             numeric,
  ultima            date,
  sem_nota_hoje     int,
  bloqueio          text,
  omie_nome         text,
  omie_doc          text,
  via               text,
  situacao_anterior text,
  motivo_anterior   text,
  tentativas        int
)
language sql
stable
security definer
set search_path = public
/* Ela chama `notas_fiscais_auditoria`, que faz a partição do período inteiro:
 * 1,2 s com a janela padrão e ~2,4 s com quatro meses — dentro do razoável, mas
 * acima dos 8 s do `authenticator` quando o cache está frio. Sem isto, a
 * primeira chamada do dia morre com "statement timeout" e a tela conclui que não
 * há ninguém para cadastrar (medido). */
set statement_timeout = '60s'
as $$
with janela as (
  -- 60 dias cobre o pagamento que entra atrasado; a tela manda o período dela
  -- quando o assunto é a virada do corte e a conta é sobre meses inteiros.
  select coalesce(p_de, current_date - 60) as de,
         coalesce(p_ate, current_date)     as ate
),
aud as (
  select *
  from jsonb_to_recordset(
    (select public.notas_fiscais_auditoria(j.de, j.ate) from janela j) -> 'clientes'
  ) as x(
    doc text, nome text, cobrancas int, valor numeric, ultima date,
    sem_nota_hoje int, classe text, omie_nome text, omie_doc text,
    forca numeric, via text
  )
),
/* O cliente do Asaas que carrega o endereço.
 *
 * `distinct on (doc)` porque o mesmo CNPJ aparece em vários `cus_` — restaurante
 * que refez o cadastro, migração de plano. Vence o mais recente e não-apagado:
 * é o que tem a chance maior de trazer o endereço de hoje. */
cli as (
  select distinct on (regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D','','g'))
         regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D','','g') as doc,
         c.id_asaas,
         c.dados
  from public.asaas_cache c
  where c.tipo = 'customer'
  order by 1,
           coalesce((c.dados->>'deleted')::boolean, false),
           c.dados->>'dateCreated' desc nulls last
)
select
  cli.id_asaas,
  a.doc,
  a.nome,
  length(a.doc) = 11                                        as pessoa_fisica,
  nullif(trim(cli.dados->>'email'), '')                     as email,
  coalesce(nullif(trim(cli.dados->>'mobilePhone'), ''),
           nullif(trim(cli.dados->>'phone'), ''))           as telefone,
  nullif(trim(cli.dados->>'address'), '')                   as endereco,
  nullif(trim(cli.dados->>'addressNumber'), '')             as endereco_numero,
  nullif(trim(cli.dados->>'complement'), '')                as complemento,
  nullif(trim(cli.dados->>'province'), '')                  as bairro,
  nullif(trim(cli.dados->>'cityName'), '')                  as cidade,
  nullif(trim(cli.dados->>'state'), '')                     as estado,
  nullif(regexp_replace(coalesce(cli.dados->>'postalCode',''), '\D','','g'), '') as cep,
  a.cobrancas,
  a.valor,
  a.ultima,
  a.sem_nota_hoje,
  case
    when not public.doc_fiscal_valido(a.doc)  then 'documento_invalido'
    when a.classe = 'cadastro_divergente'     then 'cadastro_divergente'
    when cli.id_asaas is null                 then 'sem_cliente_no_espelho'
    else null
  end                                                       as bloqueio,
  a.omie_nome,
  a.omie_doc,
  a.via,
  f.situacao                                                as situacao_anterior,
  f.motivo                                                  as motivo_anterior,
  coalesce(f.tentativas, 0)                                 as tentativas
from aud a
left join cli on cli.doc = a.doc
left join public.omie_clientes_criados f on f.doc = a.doc
-- Quem já foi criado sai da fila: o cadastro existe, só o espelho local é que
-- ainda não sabe (ele é semanal). Voltar a mandar cria duplicado.
where coalesce(f.situacao, '') not in ('criado', 'ja_existia')
order by a.valor desc nulls last
limit greatest(p_limite, 0);
$$;

comment on function public.omie_clientes_a_criar(date, date, int) is
  'Clientes que a emissão de NFS-e não encontra no Omie, com o endereço do Asaas e o que '
  'impede (ou não) o cadastro automático. Mesma lista da aba Auditoria, com o que a criação precisa.';

-- Função nova em `public` nasce chamável sem login pelo grant automático do
-- Supabase, e estas duas leem faturamento e cadastro cliente a cliente.
revoke all on function public.omie_clientes_a_criar(date, date, int) from public, anon;
grant execute on function public.omie_clientes_a_criar(date, date, int) to authenticated, service_role;
revoke all on function public.doc_fiscal_valido(text) from public, anon;
grant execute on function public.doc_fiscal_valido(text) to authenticated, service_role;
