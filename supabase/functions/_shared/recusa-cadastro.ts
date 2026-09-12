/**
 * O QUE A RECUSA DA PREFEITURA AUTORIZA A MÁQUINA A CONSERTAR.
 *
 * Módulo PURO e sem import nenhum, de propósito: ele é importado pela Edge
 * Function `omie-clientes-criar` (Deno) e pelos testes do front (Vite/vitest),
 * do mesmo jeito que `folha-envio.ts`. Estas regras decidem uma ESCRITA EM
 * CADASTRO DE TERCEIRO num sistema fiscal, e a alternativa a testá-las é
 * descobrir o defeito pela nota que não sai — foi assim que 158 notas ficaram
 * presas por semanas em 26/08/2026.
 *
 * ------------------------------------------------------------------
 * A REGRA GERAL É "SÓ SOBRE CAMPO VAZIO", E ELA ESTÁ CERTA
 * ------------------------------------------------------------------
 * O cadastro do cliente no ERP é de terceiro; sobrescrever valor preenchido
 * desfaz decisão de alguém. O ponto cego era o campo PREENCHIDO E
 * COMPROVADAMENTE ERRADO — e a prova não é nossa opinião sobre um dado alheio:
 * é a prefeitura recusando a nota e dizendo qual campo recusou.
 *
 * Medido em 11–12/09/2026, nas recusas paradas em "precisa de você": recusa de
 * telefone (E1235) e de código do município (E0921/E0922, e o E0240 com CEP que
 * existe) caíam todas em `nada_a_propor` → "isto precisa de conferência
 * humana", porque `diffCadastro` compara ENDEREÇO e nenhum dos dois é endereço.
 * O único campo capaz de destravá-las era justamente o que a regra proibia
 * tocar.
 *
 * SÃO DOIS CAMPOS, e não três. O E0240 diz "o CEP não existe OU não pertence ao
 * município do endereço"; com o CEP existindo nos Correios, o que sobra é o par
 * CEP↔município estar incoerente — e quem conserta isso é o código do
 * município, não reescrever o mesmo CEP em cima de si mesmo. CEP que NÃO existe
 * continua sendo trabalho de gente, com a trava de 09/09/2026 intacta.
 */

const digitos = (s: unknown): string => String(s ?? "").replace(/\D/g, "");

/** Os campos que uma recusa pode nomear — e portanto autorizar a reescrever. */
export type CampoAcusado = "telefone" | "cidade_ibge";

/**
 * Quais campos esta recusa NOMEIA.
 *
 * Os códigos são os mesmos que `nfse_recusas_a_tratar` usa para rotular a
 * recusa na tela. O texto solto entra ao lado do código porque a mensagem é
 * reescrita mais de uma vez no caminho (a prefeitura escreve, o Omie repassa, o
 * nosso `textoDaMensagem` resume) e o código não sobrevive a toda reescrita.
 *
 * Vazio é o padrão seguro: sem recusa em mãos, ninguém autorizou nada. É o caso
 * do pré-voo (`prepararCadastros`), que age ANTES de existir recusa.
 */
export function camposAcusados(msg: string | null | undefined): Set<CampoAcusado> {
  const s = String(msg ?? "");
  const out = new Set<CampoAcusado>();
  if (!s) return out;
  if (/E1235/i.test(s) || /telefone/i.test(s) || /nfse:fone/i.test(s)) out.add("telefone");
  if (/E092[12]/i.test(s) || /c[óo]digo do munic[íi]pio/i.test(s)) out.add("cidade_ibge");
  if (/E0240/i.test(s) || /CEP informado/i.test(s)) out.add("cidade_ibge");
  return out;
}

/** "27997456386" → { ddd: "27", numero: "997456386" }. Fora do tamanho, nada. */
export function telefoneBR(bruto: string | null): { ddd: string; numero: string } | null {
  const d = digitos(bruto);
  if (d.length < 10 || d.length > 11) return null;
  return { ddd: d.slice(0, 2), numero: d.slice(2) };
}

/**
 * TELEFONE QUE A PREFEITURA ACEITA — e não só um número com a contagem certa.
 *
 * `telefoneBR` confere o TAMANHO e só. Isso basta para montar o par DDD/número
 * e não basta para decidir uma escrita, e a diferença foi medida em 12/09/2026:
 * os dois clientes recusados por E1235 têm, no Asaas, `"0000000000"` — dez
 * dígitos, aprovado por `telefoneBR`, e um telefone que não existe. Sem esta
 * checagem o conserto automático escreveria `00 00000000` no Omie, a prefeitura
 * recusaria de novo pelo mesmo motivo, e a linha sairia de "precisa de você"
 * com carimbo de `ok: true` — o FALSO VERDE que a trava do CEP de 09/09/2026
 * existe para matar, refeito noutro campo.
 *
 * "Não achei telefone plausível" é resposta ÚTIL: manda pedir o número ao
 * cliente, que é uma frase. "Consertado" sobre um número inventado não manda
 * fazer nada, e a nota continua não saindo.
 *
 * A régua é o plano de numeração brasileiro, não uma invenção: DDD de duas
 * casas, nenhuma delas 0 (o menor é 11); celular com nove dígitos começando em
 * 9 (a nona virou obrigatória em todo o país em 2016); fixo com oito começando
 * de 2 a 5. E dígito repetido de ponta a ponta é preenchimento — `0000000000`,
 * `9999999999`, `1111111111`.
 *
 * ESTRITO DE PROPÓSITO: candidato recusado vira trabalho de gente, que é
 * honesto; candidato aceito por engano vira nota recusada com cara de resolvida.
 */
export function telefonePlausivel(bruto: unknown): { ddd: string; numero: string } | null {
  const t = telefoneBR(String(bruto ?? ""));
  if (!t) return null;
  if (/^(\d)\1+$/.test(`${t.ddd}${t.numero}`)) return null;
  if (!/^[1-9][1-9]$/.test(t.ddd)) return null;
  if (t.numero.length === 9) return t.numero.startsWith("9") ? t : null;
  if (t.numero.length === 8) return /^[2-5]/.test(t.numero) ? t : null;
  return null;
}

/**
 * O telefone que substitui o que a prefeitura chamou de inválido.
 *
 * A PRIMEIRA TENTATIVA NÃO CUSTA CONSULTA NENHUMA, e é a que mais resolve: os
 * mesmos dígitos, separados no lugar certo. O Omie guarda DDD e número em
 * campos distintos, e o cadastro feito à mão frequentemente tem os onze dígitos
 * inteiros dentro de `telefone1_numero`, com o DDD vazio — formalmente
 * preenchido, materialmente um telefone que o esquema da NFS-e recusa.
 * Reescrever o mesmo número bem separado não perde informação de ninguém.
 *
 * Só depois vêm as fontes externas, na ordem em que quem chama as passou, e
 * cada candidato passa por `telefonePlausivel` antes de entrar.
 *
 * Devolve `null` quando não há substituto — e aí é caso humano de verdade, com
 * a diferença de que agora se sabe por quê.
 */
export function telefoneQueSubstitui(
  atual: { telefone1_ddd?: unknown; telefone1_numero?: unknown } | null | undefined,
  candidatos: Array<{ de: string; valor: unknown }>,
): { ddd: string; numero: string; de: string } | null {
  const dddAtual = digitos(atual?.telefone1_ddd);
  const numAtual = digitos(atual?.telefone1_numero);
  const fila = [
    { de: "os mesmos dígitos, com o DDD no campo certo", valor: `${dddAtual}${numAtual}` },
    ...candidatos,
  ];
  for (const c of fila) {
    const t = telefonePlausivel(c.valor);
    if (!t) continue;
    // É exatamente o que já está lá: escrever não muda nada e mentiria no rastro.
    if (t.ddd === dddAtual && t.numero === numAtual) continue;
    return { ...t, de: c.de };
  }
  return null;
}
