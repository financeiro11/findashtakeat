/* ---------------------------------------------------------------------------
 * QUEM PAROU SÓ PELO E-MAIL VOLTA PARA A FILA.
 *
 * `nfse_preparo_fila.situacao = 'humano'` quer dizer uma coisa específica: a
 * máquina olhou, não soube resolver, e passou o caso para uma pessoa. A
 * migration de 10/09/2026 (`corrigido que não corrigiu volta para a fila`)
 * deixou escrito por que `humano` NÃO é reaberto pela montagem: ele é uma
 * afirmação sobre o LIMITE da máquina, não sobre o estado do cadastro, e
 * reabri-lo automaticamente criaria o laço — a rodada tenta, desiste, marca, e a
 * montagem seguinte desmarca.
 *
 * MAS O LIMITE DA MÁQUINA ACABOU DE MUDAR. Até hoje ela não sabia buscar e-mail:
 * a BrasilAPI, que é a fonte que o Hub consulta, devolve `email` nulo (14 de 14
 * na amostra). Com `_shared/cnpj-contato.ts` ela passa a ler o mesmo campo do
 * cadastro federal em `open.cnpja.com` / `receitaws.com.br`, que o publicam —
 * 9 de 9 com e-mail nas duas amostras. O que era limite deixou de ser.
 *
 * Então estas linhas estão erradas pelo mesmo motivo que as de 10/09: foram
 * decididas sob uma régua que não vale mais. Mudar o que a máquina sabe fazer e
 * não reabrir o que ela recusou é mudar de ideia e não contar a ninguém.
 *
 * O RECORTE É ESTREITO DE PROPÓSITO — `falta` exatamente "e-mail", e só. Quem
 * está em `humano` por endereço continua em `humano`: sobre esses nada mudou, e
 * reabri-los seria justamente o laço que a migration anterior fechou. As
 * tentativas voltam a zero porque as três gastas foram contra uma parede que não
 * existe mais.
 * ------------------------------------------------------------------------- */

update public.nfse_preparo_fila
   set situacao   = 'pendente',
       motivo     = 'Reaberto: a máquina passou a buscar o e-mail no cadastro federal (cnpja/receitaws).',
       tentativas = 0
 where situacao = 'humano'
   and btrim(coalesce(falta, '')) = 'e-mail';
