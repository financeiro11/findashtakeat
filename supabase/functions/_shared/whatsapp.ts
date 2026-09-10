// A porta de saída de WhatsApp do Hub.
//
// ANTES DISTO O HUB NÃO MANDAVA MENSAGEM NENHUMA, e vale registrar porque a
// aparência dizia o contrário: `enviar-ajuste` carimbava a trilha da auditoria
// com "Mensagem enviada para 27…", mudava o status para "Ajuste solicitado" e
// tinha, logo abaixo, `// TODO: integrar provider real de WhatsApp aqui`. O
// lançamento ficava marcado como cobrado e o líder nunca recebia nada. O único
// envio que funcionava de verdade era o `wa.me` do relatório do Caixa — que
// abre a conversa e espera alguém apertar enviar.
//
// O CAMINHO É O n8n, E NÃO A UAZAPI DIRETO. A Takeat já paga a UAZAPI (ela
// aparece na fatura do cartão) e o token dela poderia morar aqui, mas quem
// conhece a instância, o número de origem e o formato do payload é o fluxo do
// n8n — que já é onde a empresa versiona esse tipo de integração. O Hub manda
// UMA coisa simples ("mande este texto para este número") e o n8n resolve o
// resto; trocar de provedor amanhã não mexe em nenhuma Edge Function.
//
// SEM SEGREDO CONFIGURADO, NÃO SE FINGE QUE ENVIOU. `sem_canal` é um desfecho
// nomeado e `ok` é falso — é o que impede quem chama de carimbar "avisado" num
// achado que ninguém recebeu, que é exatamente o erro do `enviar-ajuste`.

/** URL do fluxo n8n que recebe `{ telefone, mensagem, origem }` e chama a UAZAPI. */
const URL_ENV = "N8N_WHATSAPP_URL";
/** Opcional: se o fluxo do n8n exigir header de autenticação. */
const TOKEN_ENV = "N8N_WHATSAPP_TOKEN";

/**
 * O prazo do POST. Curto de propósito: este envio acontece DEPOIS do trabalho
 * principal de uma função que já roda perto do limite do worker, e um webhook
 * pendurado levaria junto a rodada inteira — inclusive a parte que grava o que
 * foi apurado. Ver `LIMITE_WORKER_MS` no radar.
 */
const PRAZO_MS = 10_000;

export type DesfechoEnvio = "enviado" | "sem_canal" | "telefone_invalido" | "erro";

export interface EnvioWhats {
  ok: boolean;
  desfecho: DesfechoEnvio;
  status?: number;
  /** Sempre preenchido quando `ok` é falso: é o que vai para o relatório da rodada. */
  detalhe?: string;
}

/**
 * Só os dígitos, do jeito que a API quer: 55 + DDD + número.
 *
 * O piso de 12 dígitos (55 + 2 de DDD + 8) recusa o campo meio preenchido — um
 * telefone curto não dá erro na UAZAPI, ele entrega a mensagem para OUTRA
 * pessoa, e mensagem que sai não se desfaz.
 */
export function digitosDoTelefone(t: string | null | undefined): string | null {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

/**
 * Manda o texto. NUNCA lança: quem chama está no meio de uma rodada e o envio
 * é a última etapa dela — uma exceção aqui apagaria o relatório de tudo que
 * veio antes.
 */
export async function enviarWhatsApp(
  p: { telefone: string; mensagem: string; origem: string },
  prazoMs = PRAZO_MS,
): Promise<EnvioWhats> {
  const url = Deno.env.get(URL_ENV);
  if (!url) {
    return {
      ok: false,
      desfecho: "sem_canal",
      detalhe: `${URL_ENV} não está configurada — nada foi enviado`,
    };
  }

  const telefone = digitosDoTelefone(p.telefone);
  if (!telefone) {
    return { ok: false, desfecho: "telefone_invalido", detalhe: `telefone inválido: ${p.telefone}` };
  }
  if (!p.mensagem.trim()) {
    return { ok: false, desfecho: "erro", detalhe: "mensagem vazia" };
  }

  const token = Deno.env.get(TOKEN_ENV);
  const corte = new AbortController();
  const relogio = setTimeout(() => corte.abort(), prazoMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: corte.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ telefone, mensagem: p.mensagem, origem: p.origem }),
    });
    if (!r.ok) {
      const corpo = (await r.text().catch(() => "")).slice(0, 300);
      return { ok: false, desfecho: "erro", status: r.status, detalhe: `n8n respondeu ${r.status}: ${corpo}` };
    }
    return { ok: true, desfecho: "enviado", status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      desfecho: "erro",
      detalhe: corte.signal.aborted ? `o n8n não respondeu em ${prazoMs / 1000}s` : msg,
    };
  } finally {
    clearTimeout(relogio);
  }
}
