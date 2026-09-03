-- O nome dela é TETS.
--
-- A migration do organograma (20260902130000) leu "Tets - Tesouria e CAP" no catálogo
-- como um apelido com typo e "corrigiu" para "Thétys". Errado: TETS é o nome, escrito
-- assim, em caixa alta. O Henrique já acertou os três cards de `time_cargos` à mão;
-- faltavam os dois lugares que ainda diziam Thétys e também vão para a tela — o nome do
-- agente (cabeçalho do card no organograma) e a linha do catálogo de automações.
--
-- O IDENTIFICADOR NÃO MUDA. `agentes.id` continua `thetys`, e é ele que o runtime manda
-- em `agente_execucoes.agente_id` nas 314 linhas já gravadas. Renomear a chave para
-- combinar com o rótulo quebraria a trilha inteira em troca de nada: id é endereço,
-- não nome. Pela mesma razão a rota do painel segue `/monitoramento/thetys`.

update public.agentes
   set nome = 'TETS — Tesouraria e CAP',
       atualizado_em = now()
 where id = 'thetys'
   and nome <> 'TETS — Tesouraria e CAP';

update public.automacoes_catalogo
   set automacao = 'TETS — Tesouraria e CAP'
 where id = 'fa12c41e-d6ab-4d6d-8425-fbb1a77accf8'
   and automacao <> 'TETS — Tesouraria e CAP';
