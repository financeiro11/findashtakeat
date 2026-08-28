-- A chave da linha de anexo não pode sair do `attachmentId` do Gmail.
--
-- MEDIDO EM 28/08/2026: o `attachmentId` NÃO é estável entre chamadas. Pedir a
-- mesma mensagem duas vezes devolve ids diferentes para o mesmo anexo — e a
-- chave da linha em `notas_externas` era `email|<msg>|<attachmentId[0..24]>`.
-- Resultado: toda releitura (`gmail-nf-sync` com `reler: true`, que existe
-- justamente para quando a LEITURA melhora) inseria uma linha nova em vez de
-- atualizar a que já existia.
--
-- Nove releituras dos e-mails da EDP, feitas para aplicar um parser novo de XML,
-- geraram oito cópias de cada conta de luz. No acervo inteiro eram 210 linhas a
-- mais em 1.276 — o mesmo documento reivindicando o mesmo título várias vezes,
-- que é exatamente o ruído que a disputa por documento existe para matar.
--
-- O QUE É ESTÁVEL: o id da MENSAGEM (imutável no Gmail) e a POSIÇÃO do anexo
-- dentro dela — a árvore MIME de uma mensagem já entregue não muda. A chave
-- passa a ser `email|<msg>|<ordem>`, e `gmail-nf-sync` grava assim daqui em
-- diante.
--
-- ESTA MIGRAÇÃO NÃO APAGA NADA. As cópias são ARQUIVADAS (`ignorado_em`), que é
-- o mecanismo que o acervo já usa e que uma pessoa desfaz pela tela. Conferido
-- antes de rodar: das 210, nenhuma tinha subido ao ERP e nenhuma tinha alvo
-- escolhido à mão — 79 já estavam arquivadas por outro motivo.

begin;

create temporary table _anexo_dedup on commit drop as
with anexo as (
  select id,
         split_part(chave, '|', 2) as gmail_id,
         coalesce(ordem, 1)        as ordem,
         enviado_erp_em, alvo_manual
    from public.notas_externas
   where fonte = 'email'
     and chave ~ '^email\|[^|]+\|.+'
)
select id, gmail_id, ordem,
       row_number() over (
         partition by gmail_id, ordem
         /* Quem fica: quem já subiu ao ERP, depois quem foi apontado à mão,
            depois a mais antiga — que é a original, a que o casador já
            conhece. */
         order by (enviado_erp_em is not null) desc, alvo_manual desc, id asc
       ) as pos
  from anexo;

-- 1. as cópias saem da disputa e libertam a chave que vão precisar devolver
update public.notas_externas n
   set ignorado_em     = coalesce(n.ignorado_em, now()),
       ignorado_motivo = coalesce(
         n.ignorado_motivo,
         'cópia gerada por releitura — o attachmentId do Gmail não é estável'),
       chave           = 'email-dup|' || n.id::text,
       atualizado_em   = now()
  from _anexo_dedup d
 where d.id = n.id and d.pos > 1;

-- 2. quem ficou passa para a chave estável
update public.notas_externas n
   set chave         = 'email|' || d.gmail_id || '|' || d.ordem::text,
       atualizado_em = now()
  from _anexo_dedup d
 where d.id = n.id and d.pos = 1;

commit;
