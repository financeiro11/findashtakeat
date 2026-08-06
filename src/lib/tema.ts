// Tema claro/escuro — hoje só a camada mobile oferece o interruptor.
//
// O padrão é CLARO, e não "sistema", de propósito: o Hub nunca aplicou a classe `.dark`
// em ninguém, então herdar o tema do aparelho jogaria metade do time num visual que nunca
// foi visto em produção. Quem quiser, liga na aba Perfil.

export type Tema = "claro" | "escuro" | "sistema";

const CHAVE = "hub:tema";

export function lerTema(): Tema {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(CHAVE) : null;
  return v === "escuro" || v === "sistema" ? v : "claro";
}

export function salvarTema(tema: Tema): void {
  try { localStorage.setItem(CHAVE, tema); } catch { /* localStorage indisponível */ }
}

export function temaEfetivoEscuro(tema: Tema): boolean {
  if (tema === "escuro") return true;
  if (tema === "claro") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Liga/desliga a classe `.dark` no <html> — é o que src/index.css lê. */
export function aplicarTema(tema: Tema): void {
  document.documentElement.classList.toggle("dark", temaEfetivoEscuro(tema));
}
