// Política de senha — o espelho de tela do que o servidor exige.
//
// O original é `supabase/functions/_shared/senha.ts`, e é ele que MANDA: o front
// não é barreira nenhuma, porque qualquer pessoa chama a Edge Function direto
// com a anon key, que é pública. Isto aqui existe só para a pessoa descobrir que
// a senha é fraca ENQUANTO digita, em vez de descobrir depois de clicar.
//
// Se os dois discordarem, o servidor ganha e a tela mostra a recusa dele. Mas
// mantenha-os iguais: divergência vira "aceitou aqui e recusou lá", que é o tipo
// de erro que ninguém consegue explicar ao usuário.

export const MIN_SENHA = 12;

const PROIBIDAS = [
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "senha", "senha123", "password", "passw0rd", "qwerty", "abc123",
  "111111", "000000", "takeat", "takeat123", "findash", "findash123",
  "financeiro", "mudar123", "trocar123", "primeiroacesso",
];

function achatar(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** O motivo da recusa, ou `null` se a senha serve. */
export function motivoSenhaRuim(senha: string, email?: string | null): string | null {
  if (typeof senha !== "string" || senha.length < MIN_SENHA) {
    return `A senha precisa ter ao menos ${MIN_SENHA} caracteres.`;
  }
  if (senha.length > 72) {
    return "A senha precisa ter no máximo 72 caracteres.";
  }

  const plana = achatar(senha);
  if (!plana) return "A senha precisa ter letras ou números.";

  for (const ruim of PROIBIDAS) {
    if (plana === ruim || plana.includes(ruim)) {
      return "Essa senha é conhecida demais. Escolha uma que não contenha palavras óbvias como “senha”, “takeat” ou sequências de números.";
    }
  }

  if (/^(.)\1+$/.test(senha)) return "A senha não pode ser um caractere repetido.";

  const local = achatar((email ?? "").split("@")[0] ?? "");
  if (local.length >= 4 && plana.includes(local)) {
    return "A senha não pode conter o seu e-mail ou nome de usuário.";
  }

  const classes = [/[a-zA-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(senha)).length;
  if (classes < 2 && senha.length < 16) {
    return "Misture letras com números ou símbolos — ou use uma frase de 16 caracteres ou mais.";
  }

  return null;
}

/**
 * Sorteia uma senha forte para entregar a alguém — o mesmo alfabeto do servidor.
 * Sem `0/O` e `1/l/I`: esta senha vai ser lida em voz alta ou colada num
 * WhatsApp, e confundir zero com Ó gera um chamado de "não entra".
 */
export function gerarSenhaForte(tamanho = 20): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?";
  const bytes = new Uint32Array(tamanho);
  crypto.getRandomValues(bytes);
  let saida = "";
  for (let i = 0; i < tamanho; i++) saida += alfabeto[bytes[i] % alfabeto.length];
  return saida;
}

/**
 * Força da senha em 0–3, só para a barrinha da tela. Não decide nada: quem
 * aprova ou recusa é `motivoSenhaRuim`, dos dois lados.
 */
export function forcaDaSenha(senha: string): { nivel: 0 | 1 | 2 | 3; rotulo: string } {
  if (!senha) return { nivel: 0, rotulo: "" };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(senha)).length;
  const pontos = (senha.length >= 12 ? 1 : 0) + (senha.length >= 16 ? 1 : 0) + (classes >= 3 ? 1 : 0);
  if (senha.length < MIN_SENHA) return { nivel: 0, rotulo: "curta demais" };
  if (pontos >= 3) return { nivel: 3, rotulo: "forte" };
  if (pontos === 2) return { nivel: 2, rotulo: "boa" };
  return { nivel: 1, rotulo: "aceitável" };
}
