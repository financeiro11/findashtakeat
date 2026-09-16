import { describe, expect, it } from "vitest";
import {
  codigoNaRecusa, ehDocumentoRepetido, omiePediuPausa, segundosDePausa,
} from "../../../supabase/functions/_shared/omie-recusas";

// Mensagens copiadas de `omie_clientes_criados.motivo` (16/09/2026).
const CNPJ = "ERROR: Cliente já cadastrado para o CPF/CNPJ [39.330.543/0001-02] com o Id [5522173861] e código de integração [65007887191] ! (add)";
const CPF = "ERROR: Cliente já cadastrado para o CPF/CNPJ [131.031.590-74] com o Id [5521985355] e código de integração [cus_000123456789] ! (add)";
const ANTIGA = "ERROR: Cliente já cadastrado para o código [1234567]";
const PAUSA = "ERROR: API bloqueada por consumo indevido. Tente novamente em 1789 segundos.";
const REDUNDANTE = "Consumo redundante detectado. Aguarde 43 segundos para tentar novamente (REDUNDANT)";

describe("ehDocumentoRepetido", () => {
  it("reconhece o formato atual, de CNPJ e de CPF", () => {
    expect(ehDocumentoRepetido(CNPJ)).toBe(true);
    expect(ehDocumentoRepetido(CPF)).toBe(true);
  });
  it("continua reconhecendo o formato antigo", () => {
    expect(ehDocumentoRepetido(ANTIGA)).toBe(true);
  });
  it("não confunde pausa ou erro de dado com documento repetido", () => {
    expect(ehDocumentoRepetido(PAUSA)).toBe(false);
    expect(ehDocumentoRepetido("ERROR: Tag [CEP] inválida")).toBe(false);
  });
});

describe("codigoNaRecusa", () => {
  it("devolve o Id do cliente, não o código de integração", () => {
    expect(codigoNaRecusa(CNPJ)).toBe(5522173861);
    expect(codigoNaRecusa(CPF)).toBe(5521985355);
  });
  it("formato antigo: o número entre colchetes", () => {
    expect(codigoNaRecusa(ANTIGA)).toBe(1234567);
  });
  it("sem número: null", () => {
    expect(codigoNaRecusa("ERROR: duplicado")).toBeNull();
  });
});

describe("omiePediuPausa", () => {
  it("bloqueio e redundância são pausa, com os segundos pedidos", () => {
    expect(omiePediuPausa(PAUSA)).toBe(true);
    expect(segundosDePausa(PAUSA)).toBe(1789);
    expect(omiePediuPausa(REDUNDANTE)).toBe(true);
    expect(segundosDePausa(REDUNDANTE)).toBe(43);
  });
  it("recusa de cadastro não é pausa", () => {
    expect(omiePediuPausa(CNPJ)).toBe(false);
  });
});
