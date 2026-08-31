// Onde a sessão fica guardada no navegador — e por quanto tempo.
//
// A caixa "Lembrar de mim neste dispositivo" existia na tela de login desde
// sempre, marcada por padrão, e NÃO FAZIA NADA: a sessão ia para o
// `localStorage` de qualquer jeito e sobrevivia a fechar o navegador. Numa tela
// de login isso é pior do que não ter a caixa, porque a pessoa que desmarca
// acredita ter saído ao fechar a aba — e não saiu.
//
// Agora a caixa manda de verdade:
//
//   MARCADA   → `localStorage`.   A sessão volta amanhã. É o certo no
//                                 computador de quem trabalha aqui todo dia.
//   DESMARCADA→ `sessionStorage`. A sessão morre com a aba. É o certo no
//                                 computador do escritório do cliente, no
//                                 notebook emprestado, na máquina compartilhada.
//
// O adaptador lê dos DOIS lugares (sessão primeiro) porque a escolha pode mudar
// entre um login e outro, e a sessão antiga precisa continuar sendo encontrada
// até ser trocada.

const CHAVE_MODO = "hub:sessao-modo";

type Modo = "local" | "sessao";

function modoAtual(): Modo {
  try {
    return localStorage.getItem(CHAVE_MODO) === "sessao" ? "sessao" : "local";
  } catch {
    // Navegador com armazenamento bloqueado (janela anônima restrita, política
    // corporativa). Cair no padrão é melhor do que estourar antes do login.
    return "local";
  }
}

/**
 * Chamado pela tela de login ANTES de autenticar — a escolha precisa estar
 * valendo na hora em que o supabase-js grava a sessão.
 */
export function lembrarNesteDispositivo(lembrar: boolean): void {
  try {
    localStorage.setItem(CHAVE_MODO, lembrar ? "local" : "sessao");
  } catch { /* sem armazenamento: segue com o padrão */ }
}

/** O que a tela de login mostra na caixa quando abre. */
export function lembraNesteDispositivo(): boolean {
  return modoAtual() === "local";
}

function destino(): Storage {
  return modoAtual() === "sessao" ? sessionStorage : localStorage;
}

/**
 * Adaptador no formato que o supabase-js espera. Tudo em try/catch: se o
 * armazenamento estiver bloqueado, a sessão simplesmente não persiste — a
 * pessoa loga de novo, o que é chato e funciona. Estourar aqui deixaria o app
 * numa tela branca antes mesmo do login.
 */
export const armazenamentoDaSessao = {
  getItem(chave: string): string | null {
    try {
      return sessionStorage.getItem(chave) ?? localStorage.getItem(chave);
    } catch {
      return null;
    }
  },
  setItem(chave: string, valor: string): void {
    try {
      const aqui = destino();
      aqui.setItem(chave, valor);
      // Tira a cópia do outro lado: sem isto, quem desmarca a caixa continuaria
      // com a sessão velha no `localStorage`, e a caixa voltaria a mentir.
      (aqui === sessionStorage ? localStorage : sessionStorage).removeItem(chave);
    } catch { /* idem */ }
  },
  removeItem(chave: string): void {
    try {
      localStorage.removeItem(chave);
      sessionStorage.removeItem(chave);
    } catch { /* idem */ }
  },
};
