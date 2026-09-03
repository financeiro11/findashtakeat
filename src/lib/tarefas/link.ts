// O endereço de uma tarefa — o que se manda no WhatsApp quando se pede algo a alguém.
//
// `/tarefas?tarefa=<id>` já existia desde a Linha de Produção ("já está no quadro — ver a
// tarefa"), mas era um endereço interno: nenhuma tela oferecia o link, e quem quisesse
// mandar uma demanda copiava o TÍTULO e a outra pessoa caçava o card entre 26 no Backlog.
//
// É o MESMO endereço no computador e no celular. O App.tsx escolhe a árvore de telas pelo
// tamanho do aparelho, então o link abre o diálogo de edição no Kanban e a folha de
// detalhe no celular — não existe "link do PC" e "link do celular" para escolher errado.
// Quem clicar sem sessão passa pelo /login e cai na tarefa depois (ver
// `src/lib/destinoLogin.ts`).
//
// Não é link público: quem abre precisa de login no Hub. Para quem não tem conta o
// caminho é outro (`/n/<token>` das anotações, `/l/<token>` da fatura).

import { baseDoHub } from "@/lib/compartilhar";

export function urlDaTarefa(id: string): string {
  return `${baseDoHub()}/tarefas?tarefa=${id}`;
}

/**
 * O recado pronto: título em cima, endereço embaixo.
 *
 * Um link cru chega no WhatsApp como um endereço com um UUID no fim — quem recebe não
 * sabe do que se trata antes de abrir. O título é o que faz a mensagem valer sozinha.
 */
export function mensagemDaTarefa(t: { id: string; titulo: string }): string {
  return `${t.titulo}\n${urlDaTarefa(t.id)}`;
}
