-- O XML é a nota, e para de contar por acidente.
--
-- Decisão do usuário em 28/08/2026: *"tô começando a pensar em deixar de
-- preconceito e pegar XML como comprovante. Sei que juridicamente é, mas hoje eu
-- não considero."*
--
-- O enquadramento estava invertido, e vale registrar por quê. Um XML não é um
-- comprovante de segunda que dá para tolerar: para NF-e ele **é** a nota, e o
-- PDF é o retrato dela. Dentro desta esteira ele também é o documento mais
-- barato e mais exato que existe — o único onde CNPJ, valor, DATA, número e
-- chave vêm de campo próprio, sem OCR, sem IA e sem cota. O oposto disso
-- aconteceu no mesmo dia: 11 PDFs de NFS-e da Flash entregaram CNPJ, valor e
-- número e **nenhum entregou a data**, e por isso os 12 arquivos da Caixa
-- ficaram todos em "Sem dono" — sem data, o casador ancora a janela no dia do
-- upload e nota de abril nunca alcança título de abril.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO: eles já contavam, mas por desempate
--
-- Existem 8 XMLs pendurados em títulos no ERP, entre eles um da Ingram Micro de
-- R$ 79.450 e dois do Marani de R$ 41.666. Os 8 já apareciam como `com_nota` —
-- não porque alguém tenha decidido que XML vale, e sim porque `classificarAnexo`
-- não reconhecia a extensão, eles caíam em `indefinido`, e a regra "o
-- `indefinido` NÃO vira falta" (20260827380000) os deixava no verde.
--
-- E nunca sairiam de lá: a triagem por IA só aceita PDF e imagem, então os 8
-- morriam em `não sei ler` — 7 já com `ia_conferido_em` carimbado por um leitor
-- que não sabia lê-los. Cobertura que se sustenta num "não sei" é cobertura que
-- ninguém pode defender numa auditoria.
--
-- POR ISSO O NÚMERO DA TELA NÃO MUDA com esta migration, e é de propósito: os 8
-- já contavam. O que muda é o motivo — de desempate para decisão — e o que
-- passa a estar escrito ao lado deles.
--
-- ---------------------------------------------------------------------------
-- A LEITURA POR DENTRO CONTINUA VALENDO, e agora é ela que recusa
--
-- Classificar pela extensão não é confiar cegamente. Um `.xml` que não é nota
-- fiscal existe (retorno de banco, planilha exportada), e quem o pega é a
-- triagem: ela passa a ler XML **sem chamar o Gemini** (`lerXmlFiscal`, exato e
-- de graça) e recusa com todas as letras o arquivo que não tem tag de
-- NF-e/NFS-e. Por isso o XML entra na fila mesmo já sendo `classe = 'nota'`:
-- a pergunta que sobra não é "é nota?", é "de quem, de quanto e de quando?" —
-- e a resposta sai em milissegundos.

/* ================= 1) o que já está pendurado vira nota ================= */

update public.omie_titulo_anexo
   set classe = 'nota'
 where coalesce(qtd, 0) > 0
   and coalesce(anexos->0->>'nome', '') ~* '\.xml$'
   and classe is distinct from 'nota';

/* O CARIMBO DE QUEM NÃO SABIA LER É APAGADO. `ia_conferido_em` está preenchido
   em 7 dos 8 porque a triagem TENTOU e falhou no `não sei ler "x.xml"`. Deixá-lo
   manteria a fila achando que esses anexos já foram examinados — por um leitor
   que agora existe e que naquela hora não existia. `ia_leitura is null` é a
   guarda: quem já foi lido de verdade não é mexido. */
update public.omie_titulo_anexo
   set ia_conferido_em = null, ia_arquivo = null
 where coalesce(qtd, 0) > 0
   and coalesce(anexos->0->>'nome', '') ~* '\.xml$'
   and ia_leitura is null
   and ia_conferido_em is not null;

/* ============== 2) o XML entra na fila mesmo já sendo nota ============== */

create or replace function public.anexo_triagem_fila(p_limite integer default 6)
returns table (
  cod_titulo bigint, id_anexo text, c_tabela text, nome text,
  favorecido text, valor numeric, competencia date, categoria text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.cod_titulo,
         coalesce(a.anexos->0->>'id', '') as id_anexo,
         coalesce(a.c_tabela, 'conta-pagar') as c_tabela,
         a.anexos->0->>'nome' as nome,
         coalesce(t.favorecido, t.favorecido_cru, '') as favorecido,
         t.valor, t.competencia, t.categoria
    from public.omie_titulo_anexo a
    join public.cap_titulos t on t.cod_titulo = a.cod_titulo
   where coalesce(a.qtd, 0) > 0
     and a.revisao is null
     and (
           a.classe in ('duvidoso', 'indefinido')
           /* O XML JÁ É NOTA E MESMO ASSIM ENTRA. Não é contradição: a fila
              deixou de perguntar só "este anexo serve?" e pergunta "que
              documento é este?" — e para o XML a resposta sai de graça, sem
              Gemini e sem chance de erro de transcrição. É ela que traz
              emitente, valor e data para a tela, e é ela que desmascara o
              `.xml` que não é nota fiscal nenhuma. */
        or (coalesce(a.anexos->0->>'nome', '') ~* '\.xml$' and a.ia_leitura is null)
     )
     and (a.ia_conferido_em is null
          or a.ia_arquivo is distinct from coalesce(a.anexos->0->>'nome', ''))
   /* Duvidoso primeiro (alguém espera resposta), XML logo atrás porque não
      consome cota nenhuma e libera a vaga quase na hora, e só então por valor. */
   order by (a.classe = 'duvidoso') desc,
            (coalesce(a.anexos->0->>'nome', '') ~* '\.xml$') desc,
            t.valor desc nulls last, a.cod_titulo
   limit greatest(1, least(coalesce(p_limite, 6), 12));
$$;

comment on function public.anexo_triagem_fila(integer) is
  'A fila da leitura de anexos do ERP. Alcança `duvidoso` e `indefinido`, e desde 28/08/2026 também o XML que ainda não foi lido — mesmo já sendo `classe = nota`, porque lê-lo é de graça (`lerXmlFiscal`, sem Gemini) e é o que traz emitente, valor e data para a tela. Duvidoso primeiro, XML atrás, depois por valor. Ver 20260827370000 e 20260828010000.';

create or replace function public.anexo_triagem_fila_total()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select count(*)::int
    from public.omie_titulo_anexo a
   where coalesce(a.qtd, 0) > 0
     and a.revisao is null
     and (
           a.classe in ('duvidoso', 'indefinido')
        or (coalesce(a.anexos->0->>'nome', '') ~* '\.xml$' and a.ia_leitura is null)
     )
     and (a.ia_conferido_em is null
          or a.ia_arquivo is distinct from coalesce(a.anexos->0->>'nome', ''));
$$;

comment on function public.anexo_triagem_fila_total() is
  'Quantos anexos esperam a leitura por dentro. Mesmo recorte da `anexo_triagem_fila`. Ver 20260828010000.';
