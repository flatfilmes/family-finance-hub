/**
 * FASE 3B — provas de roteamento escopado por instituição e versionado.
 * Nenhum teste aqui altera a matemática dos parsers golden.
 */
import { describe, expect, it } from "vitest";
import { DOCUMENT_PARSER_REGISTRY, parsersFor } from "./registry";
import { routeDocumentParser, VERSION_DETECTION_THRESHOLD } from "./routing";
import { institutionCodeById } from "@/lib/institutions";
import type { DocumentParserDescriptor, ParserDocumentInput } from "./types";

const entrada = (textos: string[]): ParserDocumentInput => ({ textos });

const BB_DOC = entrada([
  "BANCO DO BRASIL",
  "bb.com.br",
  "Extrato de conta corrente",
  "Saldo do dia",
]);
const ITAU_BANK_DOC = entrada([
  "ITAU UNIBANCO",
  "itau.com.br",
  "Extrato conta corrente",
  "periodo de visualizacao",
]);

const rota = (over: Partial<Parameters<typeof routeDocumentParser>[0]>) =>
  routeDocumentParser({
    registry: DOCUMENT_PARSER_REGISTRY,
    contextInstitution: "BANCO_DO_BRASIL",
    documentType: "BANK_STATEMENT",
    input: BB_DOC,
    ...over,
  });

describe("REGISTRY — famílias de parser", () => {
  it("BB_CONTEXT_ONLY_RUNS_BB_PARSERS", () => {
    const familia = parsersFor("BANCO_DO_BRASIL", "BANK_STATEMENT");
    expect(familia.map((d) => d.key)).toEqual(["BB_STATEMENT_V1"]);
  });

  it("ITAU_BANK_CONTEXT_ONLY_RUNS_ITAU_BANK_PARSERS", () => {
    expect(parsersFor("ITAU", "BANK_STATEMENT").map((d) => d.key)).toEqual([
      "ITAU_BANK_STATEMENT_V1",
    ]);
  });

  it("ITAU_CARD_CONTEXT_ONLY_RUNS_ITAU_CARD_PARSERS", () => {
    expect(parsersFor("ITAU", "CREDIT_CARD_STATEMENT").map((d) => d.key)).toEqual([
      "ITAU_CARD_STATEMENT_V1",
    ]);
  });

  it("NUBANK_CARD_CONTEXT_ONLY_RUNS_NUBANK_CARD_PARSERS", () => {
    const familia = parsersFor("NUBANK", "CREDIT_CARD_STATEMENT");
    expect(familia.map((d) => d.key)).toEqual(["NUBANK_CARD_STATEMENT_V1"]);
    expect(familia.every((d) => d.institutionCode === "NUBANK")).toBe(true);
  });
});

describe("ROTEAMENTO — bloqueios obrigatórios", () => {
  it("ITAU_DOCUMENT_IN_BB_CONTEXT_BLOCKED", () => {
    const r = rota({ input: ITAU_BANK_DOC });
    expect(r.status).toBe("DOCUMENT_INSTITUTION_MISMATCH");
    expect(r.contextInstitution).toBe("BANCO_DO_BRASIL");
    expect(r.detectedInstitution).toBe("ITAU");
    expect(r.parserKey).toBeNull();
  });

  it("UNKNOWN_BB_LAYOUT_DOES_NOT_FALLBACK_TO_ITAU", () => {
    const r = rota({ input: entrada(["BANCO DO BRASIL", "layout completamente novo"]) });
    expect(r.status).toBe("UNSUPPORTED_INSTITUTION_DOCUMENT_FORMAT");
    expect(r.parserFamily).toBe("BANCO_DO_BRASIL");
    expect(r.parserKey).toBeNull();
  });

  it("CARD_DOCUMENT_IN_BANK_CONTEXT_BLOCKED", () => {
    const r = rota({ detectedDocumentType: "CREDIT_CARD_STATEMENT" });
    expect(r.status).toBe("WRONG_DOCUMENT_TYPE_FOR_CONTEXT");
  });

  it("BANK_DOCUMENT_IN_CARD_CONTEXT_BLOCKED", () => {
    const r = rota({
      contextInstitution: "NUBANK",
      documentType: "CREDIT_CARD_STATEMENT",
      input: entrada(["NUBANK", "extrato de conta"]),
      detectedDocumentType: "BANK_STATEMENT",
    });
    expect(r.status).toBe("WRONG_DOCUMENT_TYPE_FOR_CONTEXT");
  });

  it("BB reconhecido roteia para BB_STATEMENT_V1", () => {
    const r = rota({});
    expect(r.status).toBe("PASS");
    expect(r.parserKey).toBe("BB_STATEMENT_V1");
    expect(r.formatVersion).toBe(1);
    expect(r.detectionScore).toBeGreaterThanOrEqual(VERSION_DETECTION_THRESHOLD);
  });
});

// -------------------------------------------------- versionamento (fixture)
const fake = (v: number, marca: string): DocumentParserDescriptor => ({
  key: `BB_STATEMENT_V${v}`,
  institutionCode: "BANCO_DO_BRASIL",
  documentType: "BANK_STATEMENT",
  formatVersion: v,
  active: true,
  priority: v,
  legacyParserName: `FAKE_V${v}`,
  detect: (input) => (input.textos.some((t) => t.includes(marca)) ? 5 : 0),
  parse: () => ({ version: v }),
});

describe("VERSIONAMENTO — V1 e V2 coexistem", () => {
  const registry = [fake(1, "LAYOUT_ANTIGO"), fake(2, "LAYOUT_NOVO")];
  const versao = (textos: string[]) =>
    routeDocumentParser({
      registry,
      contextInstitution: "BANCO_DO_BRASIL",
      documentType: "BANK_STATEMENT",
      input: entrada(["BANCO DO BRASIL", ...textos]),
    });

  it("documento V1 seleciona V1", () => {
    expect(versao(["LAYOUT_ANTIGO"]).parserKey).toBe("BB_STATEMENT_V1");
  });

  it("documento V2 seleciona V2", () => {
    expect(versao(["LAYOUT_NOVO"]).parserKey).toBe("BB_STATEMENT_V2");
  });

  it("documento desconhecido devolve UNSUPPORTED_INSTITUTION_DOCUMENT_FORMAT", () => {
    const r = versao(["LAYOUT_MARCIANO"]);
    expect(r.status).toBe("UNSUPPORTED_INSTITUTION_DOCUMENT_FORMAT");
    expect(r.candidates).toHaveLength(2);
  });
});

// ------------------------------------------------- cadastro × identidade
const instituicoes = [
  { id: "i-itau", code: "ITAU" },
  { id: "i-nu", code: "NUBANK" },
] as never as Parameters<typeof institutionCodeById>[0];

describe("CADASTRO — texto livre nunca controla o parser", () => {
  it("ACCOUNT_DISPLAY_NAME_DOES_NOT_CONTROL_PARSER", () => {
    const conta = { institution_id: "i-itau", nome_conta: "João" };
    const code = institutionCodeById(instituicoes, conta.institution_id);
    expect(code).toBe("ITAU");
    expect(parsersFor(code!, "BANK_STATEMENT").map((d) => d.key)).toEqual([
      "ITAU_BANK_STATEMENT_V1",
    ]);
  });

  it("ACCOUNT_RENAME_DOES_NOT_CHANGE_INSTITUTION", () => {
    const conta = { institution_id: "i-itau", nome_conta: "Conta João" };
    const renomeada = { ...conta, nome_conta: "Salário" };
    expect(institutionCodeById(instituicoes, renomeada.institution_id)).toBe("ITAU");
  });

  it("CARD_DISPLAY_NAME_DOES_NOT_CONTROL_ISSUER", () => {
    const cartao = { issuer_institution_id: "i-nu", nome_cartao: "Cartão Viagem" };
    const code = institutionCodeById(instituicoes, cartao.issuer_institution_id);
    expect(code).toBe("NUBANK");
    expect(parsersFor(code!, "CREDIT_CARD_STATEMENT").map((d) => d.key)).toEqual([
      "NUBANK_CARD_STATEMENT_V1",
    ]);
  });

  it("CARD_BRAND_DOES_NOT_CONTROL_PARSER", () => {
    const cartao = { issuer_institution_id: "i-nu", bandeira: "MASTERCARD" };
    const code = institutionCodeById(instituicoes, cartao.issuer_institution_id);
    const familia = parsersFor(code!, "CREDIT_CARD_STATEMENT");
    expect(familia.every((d) => d.institutionCode === "NUBANK")).toBe(true);
    expect(familia.some((d) => d.key.includes(cartao.bandeira))).toBe(false);
  });
});
