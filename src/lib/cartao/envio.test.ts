/**
 * O guarda da chave de envio.
 *
 * Este arquivo não testa uma função — ele vigia uma promessa: enquanto o envio
 * ao Omie estiver desligado, não pode existir no repo código capaz de criar
 * título no ERP. É o que transforma "ainda não implementamos" em garantia
 * verificável: se alguém construir o caminho de escrita sem passar pela chave, a
 * suíte reprova aqui e explica o que fazer.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENVIO_AO_OMIE_LIBERADO, bloqueioDeEnvio } from "./envio";

const RAIZ = join(__dirname, "..", "..", "..");

/** Chamadas da API do Omie que CRIAM ou ALTERAM um título a pagar. */
const ESCRITA_NO_OMIE = /Incluir(Conta(Pagar|Receber)|TituloPagar)|IncluirContasPagar/;

function arquivos(dir: string): string[] {
  let out: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".git" || nome === "dist") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out = out.concat(arquivos(caminho));
    else if (/\.(ts|tsx|mjs|js)$/.test(nome)) out.push(caminho);
  }
  return out;
}

describe("chave de envio ao Omie", () => {
  it("está desligada", () => {
    expect(ENVIO_AO_OMIE_LIBERADO).toBe(false);
    expect(bloqueioDeEnvio()).toContain("desligado");
  });

  it("com a chave desligada, nada no repo cria título no Omie", () => {
    if (ENVIO_AO_OMIE_LIBERADO) return;

    const culpados = [join(RAIZ, "src"), join(RAIZ, "supabase"), join(RAIZ, "scripts")]
      .flatMap((d) => { try { return arquivos(d); } catch { return []; } })
      .filter((f) => f !== __filename)
      .filter((f) => ESCRITA_NO_OMIE.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(RAIZ.length + 1));

    expect(
      culpados,
      "Apareceu código que cria título no Omie enquanto ENVIO_AO_OMIE_LIBERADO é false. "
      + "Se o envio foi autorizado, ligue a chave em src/lib/cartao/envio.ts (e leia o "
      + "comentário de lá antes). Se não foi, este código não deveria existir ainda.",
    ).toEqual([]);
  });
});
