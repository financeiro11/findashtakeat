// Freio de tentativas de senha, no aparelho.
//
// HONESTIDADE SOBRE O QUE ISTO É: um freio de navegador não detém um atacante.
// Quem sabe o que está fazendo chama a API do Supabase direto e nem carrega esta
// página. Quem segura ataque de verdade é o limite de requisições do próprio
// Supabase Auth, do lado do servidor.
//
// Então por que existe? Porque o ataque que ACONTECEU aqui não foi sofisticado:
// foi gente digitando "123456" na tela. Contra isso — o palpite oportunista, o
// colega no computador emprestado, o script bobo de navegador — um freio que
// cresce a cada erro resolve, e custa vinte linhas.
//
// O freio é POR APARELHO, não por e-mail. Por e-mail seria contornado trocando o
// e-mail a cada tentativa, que é exatamente o que um ataque de lista faz.

const CHAVE = "hub:login-tentativas";

/** Depois de quantos erros o freio começa, e quanto ele espera em cada faixa. */
const DEGRAUS: Array<{ apos: number; esperaMs: number }> = [
  { apos: 12, esperaMs: 30 * 60_000 }, // 30 min
  { apos: 8, esperaMs: 5 * 60_000 },   //  5 min
  { apos: 5, esperaMs: 30_000 },       // 30 s
];

type Estado = { erros: number; liberaEm: number };

function ler(): Estado {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return { erros: 0, liberaEm: 0 };
    const e = JSON.parse(cru);
    return {
      erros: Number(e?.erros) || 0,
      liberaEm: Number(e?.liberaEm) || 0,
    };
  } catch {
    return { erros: 0, liberaEm: 0 };
  }
}

function gravar(e: Estado): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(e));
  } catch { /* sem armazenamento: o freio simplesmente não vale neste navegador */ }
}

/** Quantos milissegundos ainda faltam para poder tentar. Zero = pode. */
export function esperaRestanteMs(agora = Date.now()): number {
  const { liberaEm } = ler();
  return Math.max(0, liberaEm - agora);
}

/** Registra um erro e devolve quanto tempo a pessoa terá de esperar agora. */
export function registrarErro(agora = Date.now()): number {
  const anterior = ler();
  const erros = anterior.erros + 1;
  const degrau = DEGRAUS.find((d) => erros >= d.apos);
  const liberaEm = degrau ? agora + degrau.esperaMs : 0;
  gravar({ erros, liberaEm });
  return Math.max(0, liberaEm - agora);
}

/** Entrou: o contador zera. */
export function limparTentativas(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch { /* idem */ }
}

/** "30 segundos", "5 minutos" — para a mensagem na tela. */
export function formatarEspera(ms: number): string {
  const seg = Math.ceil(ms / 1000);
  if (seg < 60) return `${seg} segundo${seg === 1 ? "" : "s"}`;
  const min = Math.ceil(seg / 60);
  return `${min} minuto${min === 1 ? "" : "s"}`;
}
