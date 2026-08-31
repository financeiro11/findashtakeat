// Política de senha do Hub — um lugar só, para os dois lados da mesa.
//
// Existe por causa de 30/08/2026: o Hub nasceu com "123456" como senha padrão de
// TODO mundo, escrita no código do front e anunciada na tela de Usuários. Uma
// pessoa de fora entrou, e avisou pelo Instagram. A regra abaixo é o que impede
// a senha padrão de voltar por descuido — inclusive a de quem cria usuário novo.
//
// O espelho no front é `src/lib/senha.ts`; os dois têm de dizer a mesma coisa,
// mas quem MANDA é este, porque o front não é barreira: qualquer pessoa chama a
// Edge Function direto com a anon key, que é pública.

/** Piso de tamanho. 12 e não 8: senha curta de humano cai em ataque de lista. */
export const MIN_SENHA = 12;

/**
 * As que não passam nunca, por mais que tenham 12 caracteres. Curta de propósito
 * — não é um dicionário, é a lista do que ESTE projeto já usou ou quase usou.
 * Comparação é feita sem acento, minúscula e sem separadores.
 */
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

/**
 * Devolve o motivo da recusa, ou `null` se a senha serve.
 *
 * `email` entra para barrar "henrique@..." virando "Henrique2026!": senha que é o
 * próprio login é a primeira coisa que se tenta.
 */
export function motivoSenhaRuim(senha: string, email?: string | null): string | null {
  if (typeof senha !== "string" || senha.length < MIN_SENHA) {
    return `A senha precisa ter ao menos ${MIN_SENHA} caracteres.`;
  }
  if (senha.length > 72) {
    // Limite do bcrypt: acima disso os caracteres extras são ignorados em
    // silêncio, e a pessoa acha que tem uma senha maior do que tem.
    return "A senha precisa ter no máximo 72 caracteres.";
  }

  const plana = achatar(senha);
  if (!plana) return "A senha precisa ter letras ou números.";

  for (const ruim of PROIBIDAS) {
    if (plana === ruim || plana.includes(ruim)) {
      return "Essa senha é conhecida demais. Escolha uma que não contenha palavras óbvias como “senha”, “takeat” ou sequências de números.";
    }
  }

  // Sequência de um caractere só, ou contagem crescente: "aaaaaaaaaaaa", "123456789012".
  if (/^(.)\1+$/.test(senha)) return "A senha não pode ser um caractere repetido.";

  const local = achatar((email ?? "").split("@")[0] ?? "");
  if (local.length >= 4 && plana.includes(local)) {
    return "A senha não pode conter o seu e-mail ou nome de usuário.";
  }

  // Variedade: ao menos duas classes entre letra, número e símbolo. Não é
  // "1 maiúscula, 1 número e 1 símbolo" de propósito — essa regra empurra todo
  // mundo para "Senha@2026", que é pior do que uma frase longa.
  const classes = [/[a-zA-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(senha)).length;
  if (classes < 2 && senha.length < 16) {
    return "Misture letras com números ou símbolos — ou use uma frase de 16 caracteres ou mais.";
  }

  return null;
}

/**
 * Senha temporária forte para quem acaba de ser cadastrado. Aleatória de
 * verdade (`crypto.getRandomValues`), mostrada UMA vez a quem criou o usuário e
 * nunca gravada em lugar nenhum além do Auth do Supabase.
 *
 * O alfabeto tira `0/O` e `1/l/I`: esta senha vai ser lida em voz alta ou colada
 * num WhatsApp, e confundir zero com O gera um chamado de "não entra".
 */
export function gerarSenhaForte(tamanho = 20): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?";
  const bytes = new Uint32Array(tamanho);
  crypto.getRandomValues(bytes);
  let saida = "";
  for (let i = 0; i < tamanho; i++) saida += alfabeto[bytes[i] % alfabeto.length];
  return saida;
}
