/**
 * A escolha de quem vai no envio de teste.
 *
 * O teste existe para responder UMA pergunta que a documentação do Omie não
 * responde: o `IncluirContaPagarPorLote` aceita `departamentos` e
 * `cnab_integracao_bancaria`? Se os escolhidos trouxerem outro problema junto
 * — CNPJ dividido com outra pessoa, cadastro incompleto — a recusa do ERP vira
 * ambígua e o teste responde a pergunta errada.
 */

export type Candidato = {
  codigo: string;
  nome: string;
  valor: number;
  /** Só dígitos. */
  cnpj: string;
  /** Fornecedor, categoria e departamento resolvidos no Omie. */
  pronto: boolean;
  /** Já existe como título no Omie? Separa "criar" de "corrigir". */
  noOmie?: boolean;
};

/**
 * Os primeiros candidatos que dá para enviar sem arrastar problema junto.
 *
 * Descarta quem não está pronto, quem tem documento inválido e quem divide
 * CNPJ com outra pessoa do lote — no espelho lido em 26/08/2026 eram quatro
 * pessoas no 37.511.891/0001-50. Mandar duas delas faria o Omie recusar a
 * segunda por duplicidade, e a recusa seria lida como "o lote não aceita os
 * blocos aninhados".
 */
export function doisParaTestar(candidatos: Candidato[], quantos = 2): Candidato[] {
  const vezes = new Map<string, number>();
  for (const c of candidatos) vezes.set(c.cnpj, (vezes.get(c.cnpj) ?? 0) + 1);
  return candidatos
    /* Quem já está no Omie está fora: o ERP recusaria por duplicidade e a
       recusa seria lida como defeito do payload — o teste responderia a
       pergunta errada, que é exatamente o que ele existe para evitar. */
    .filter((c) => !c.noOmie)
    .filter((c) => c.pronto && c.cnpj.length === 14 && vezes.get(c.cnpj) === 1)
    .slice(0, quantos);
}
