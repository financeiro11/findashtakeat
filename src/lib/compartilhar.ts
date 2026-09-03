// Mandar um endereço do Hub para alguém: o domínio certo, a cópia e a folha do sistema.
//
// Estava tudo dentro de `src/lib/notas/compartilhar.ts`, que nasceu primeiro. Nada aqui
// sabe o que é uma anotação — e a segunda tela a precisar disso (o link de uma tarefa)
// não deveria importar do módulo de notas para copiar um texto. Aquele arquivo reexporta
// estas quatro funções, então quem já importava de lá continua funcionando.

/** Só a máquina de quem está desenvolvendo. */
const EM_CASA = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)/;

/**
 * O domínio que vai DENTRO do link — e que não é necessariamente o da aba atual.
 *
 * Estes endereços existem para sair daqui: vão para o WhatsApp de alguém. Copiado de
 * dentro do preview do Lovable, `window.location.origin` devolveria o domínio do
 * preview — que quem está de fora não abre, e o link chegaria quebrado sem nada acusar.
 * `VITE_HUB_URL` (o mesmo valor de `hub_base_url()` no banco) manda.
 *
 * Em localhost vale a própria máquina, senão não dá para testar a funcionalidade.
 */
export function baseDoHub(): string {
  const atual = window.location.origin;
  const canonico = (import.meta.env.VITE_HUB_URL as string | undefined)?.trim();
  if (!canonico || EM_CASA.test(atual)) return atual;
  return canonico.replace(/\/+$/, "");
}

/**
 * Copia para a área de transferência.
 *
 * `navigator.clipboard` não existe fora de HTTPS e recusa quando a aba não está em
 * foco — daí o caminho antigo do `<textarea>` atrás. Um botão "copiar" que falha
 * calado é pior do que não ter botão.
 */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch { /* cai no caminho de baixo */ }

  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** True quando o aparelho tem folha de compartilhamento nativa (WhatsApp, e-mail…). */
export function temCompartilhamentoNativo(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as any).share === "function";
}

/** Abre a folha do sistema. Devolve false se não existir ou se a pessoa cancelar. */
export async function compartilharNativo(titulo: string, url: string): Promise<boolean> {
  if (!temCompartilhamentoNativo()) return false;
  try {
    await (navigator as any).share({ title: titulo, text: titulo, url });
    return true;
  } catch {
    return false;
  }
}
