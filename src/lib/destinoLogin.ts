// Para onde voltar depois do login.
//
// Existe porque link compartilhado é o caso normal, não a exceção: alguém manda
// `/notas/<id>` no WhatsApp, quem recebe abre num aparelho onde a sessão expirou, e sem
// isto o Hub o deixaria no Dashboard — com a nota certa a três cliques de distância e
// nenhuma pista de qual era.
//
// Quem guarda é o layout que barra a entrada (AppLayout no computador, MobileLayout no
// celular), passando `state.destino` para o /login; quem usa é a tela de login.

import { useEffect } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

/** "/notas/abc?x=1#y" — exatamente o que a pessoa tentou abrir. */
export function destinoAtual(loc: Pick<Location, "pathname" | "search" | "hash">): string {
  return `${loc.pathname}${loc.search ?? ""}${loc.hash ?? ""}`;
}

/**
 * O destino, se ele for de dentro do Hub — senão a raiz.
 *
 * A checagem não é zelo à toa: `state` de rota é escrito por quem monta o link, e um
 * destino como `https://…` ou `//outro.site` transformaria a tela de login num
 * redirecionamento aberto — a pessoa entra com a senha da Takeat e é despejada num
 * site de fora, ainda achando que está no Hub. Só caminho começando com uma barra
 * (e não duas) passa.
 */
export function destinoSeguro(bruto: unknown, padrao = "/"): string {
  if (typeof bruto !== "string") return padrao;
  if (!bruto.startsWith("/") || bruto.startsWith("//")) return padrao;
  // Voltar para o /login depois de logar é um laço.
  if (bruto === "/login" || bruto.startsWith("/login?")) return padrao;
  return bruto;
}

/* ------------------------------------------------------------------ *
 *  A volta do magic link
 * ------------------------------------------------------------------ */

// O login por e-mail (só no celular) sai do Hub, passa pelo Gmail e volta — e o `state`
// da rota não sobrevive a isso. O `emailRedirectTo` também não pode carregar o destino:
// qualquer endereço fora da raiz precisa estar na allow-list de redirecionamento do
// projeto no Supabase, e errar isso derruba o login por e-mail inteiro. Então o destino
// espera no próprio aparelho.
const CHAVE = "login:destino";
/** Meia hora: é o tempo de ir ao e-mail e voltar. Passou disso, é sobra de outra sessão. */
const VALIDADE_MS = 30 * 60 * 1000;

// `localStorage`, e não `sessionStorage`: o link do e-mail abre uma ABA NOVA, e
// sessionStorage é por aba — o destino chegaria vazio do outro lado, que é justamente
// o problema que isto resolve.
export function guardarDestino(bruto: unknown): void {
  const alvo = destinoSeguro(bruto, "");
  try {
    if (alvo) localStorage.setItem(CHAVE, JSON.stringify({ alvo, em: Date.now() }));
    else localStorage.removeItem(CHAVE);
  } catch { /* modo privado */ }
}

/** Lê e apaga: um destino guardado vale uma viagem só, e só por meia hora. */
export function resgatarDestino(): string | null {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return null;
    localStorage.removeItem(CHAVE);
    const { alvo, em } = JSON.parse(cru) as { alvo?: string; em?: number };
    if (!alvo || typeof em !== "number" || Date.now() - em > VALIDADE_MS) return null;
    return destinoSeguro(alvo, "") || null;
  } catch {
    return null;
  }
}

/**
 * Nos layouts autenticados: se a pessoa acabou de voltar do magic link e caiu na raiz,
 * leva-a ao endereço que ela tinha tentado abrir.
 *
 * Só age na raiz — é onde o Supabase deixa quem volta do e-mail. Em qualquer outra tela
 * um destino guardado seria um sequestro de navegação.
 */
export function useVoltarAoDestino(logado: boolean): void {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!logado || pathname !== "/") return;
    const alvo = resgatarDestino();
    if (alvo) navigate(alvo, { replace: true });
  }, [logado, pathname, navigate]);
}
