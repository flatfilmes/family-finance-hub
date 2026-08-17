/**
 * REGISTRY OFICIAL DE PARSERS (código, nunca banco).
 *
 * Os parsers golden existentes NÃO foram reescritos: eles apenas ganharam
 * identidade estável e versionada. A matemática financeira é a mesma.
 */
import { extractPdfPageLayouts, layoutPageLines } from "@/lib/pdf-extract";
import {
  scoreBancoDoBrasil,
  parseBancoDoBrasilLines,
} from "@/lib/bank-statement-parsers/banco-do-brasil";
import {
  scoreItauBankStatement,
  parseItauBankStatementLayouts,
} from "@/lib/bank-statement-parsers/itau";
import { parseItauSpatial } from "@/lib/card-statement-parsers/itau-spatial";
import { itauParser } from "@/lib/card-statement-parsers/itau";
import { nubankParser } from "@/lib/card-statement-parsers/nubank";
import { santanderParser } from "@/lib/card-statement-parsers/santander";
import type {
  DocumentParserDescriptor,
  InstitutionCode,
  ParserDocumentInput,
  ParserDocumentType,
} from "./types";

const semParser = (key: string): never => {
  throw new Error(`Parser ${key} chamado sem as páginas do PDF.`);
};

export const BB_STATEMENT_V1: DocumentParserDescriptor = {
  key: "BB_STATEMENT_V1",
  institutionCode: "BANCO_DO_BRASIL",
  documentType: "BANK_STATEMENT",
  formatVersion: 1,
  active: true,
  priority: 10,
  legacyParserName: "EXTRATO_BANCO_DO_BRASIL_PDF",
  detect: (input) => scoreBancoDoBrasil(input.textos).score,
  parse: (input) =>
    input.linhas ? parseBancoDoBrasilLines(input.linhas) : semParser("BB_STATEMENT_V1"),
};

export const ITAU_BANK_STATEMENT_V1: DocumentParserDescriptor = {
  key: "ITAU_BANK_STATEMENT_V1",
  institutionCode: "ITAU",
  documentType: "BANK_STATEMENT",
  formatVersion: 1,
  active: true,
  priority: 10,
  legacyParserName: "ITAU_BANK_STATEMENT",
  detect: (input) => scoreItauBankStatement(input.textos).score,
  parse: (input) =>
    input.pages ? parseItauBankStatementLayouts(input.pages) : semParser("ITAU_BANK_STATEMENT_V1"),
};

export const ITAU_CARD_STATEMENT_V1: DocumentParserDescriptor = {
  key: "ITAU_CARD_STATEMENT_V1",
  institutionCode: "ITAU",
  documentType: "CREDIT_CARD_STATEMENT",
  formatVersion: 1,
  active: true,
  priority: 10,
  legacyParserName: "ITAU_PDF",
  detect: (input) => Math.round(itauParser.detect(input.textos) * 10),
  parse: (input) =>
    input.pages
      ? { ...parseItauSpatial(input.pages), extraction_status: "READY" as const }
      : semParser("ITAU_CARD_STATEMENT_V1"),
};

export const NUBANK_CARD_STATEMENT_V1: DocumentParserDescriptor = {
  key: "NUBANK_CARD_STATEMENT_V1",
  institutionCode: "NUBANK",
  documentType: "CREDIT_CARD_STATEMENT",
  formatVersion: 1,
  active: true,
  priority: 10,
  legacyParserName: "NUBANK_PDF",
  detect: (input) => Math.round(nubankParser.detect(input.textos) * 10),
  parse: (input) =>
    input.pages
      ? nubankParser.parseLayout!(input.pages)
      : semParser("NUBANK_CARD_STATEMENT_V1"),
};

export const SANTANDER_CARD_STATEMENT_V1: DocumentParserDescriptor = {
  key: "SANTANDER_CARD_STATEMENT_V1",
  institutionCode: "SANTANDER",
  documentType: "CREDIT_CARD_STATEMENT",
  formatVersion: 1,
  active: true,
  priority: 10,
  legacyParserName: "SANTANDER_PDF",
  detect: (input) => Math.round(santanderParser.detect(input.textos) * 10),
  parse: (input) =>
    input.linhas
      ? santanderParser.parse(input.linhas)
      : semParser("SANTANDER_CARD_STATEMENT_V1"),
};

export const DOCUMENT_PARSER_REGISTRY: DocumentParserDescriptor[] = [
  BB_STATEMENT_V1,
  ITAU_BANK_STATEMENT_V1,
  ITAU_CARD_STATEMENT_V1,
  NUBANK_CARD_STATEMENT_V1,
  SANTANDER_CARD_STATEMENT_V1,
];

/** Versões conhecidas de uma instituição + tipo de documento. */
export function parsersFor(
  institution: InstitutionCode,
  documentType: ParserDocumentType,
  registry: DocumentParserDescriptor[] = DOCUMENT_PARSER_REGISTRY,
) {
  return registry.filter(
    (d) => d.active && d.institutionCode === institution && d.documentType === documentType,
  );
}

/** Monta a entrada do registry a partir do arquivo (mesma leitura de produção). */
export async function buildParserInput(file: Blob): Promise<ParserDocumentInput> {
  const pages = await extractPdfPageLayouts(file);
  const linhas = pages.flatMap((p) => layoutPageLines(p.items, p.width, p.page));
  const itens = pages.flatMap((p) => p.items.map((i) => i.text));
  const textos = [
    ...linhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean),
    ...itens,
  ];
  return { textos, linhas, pages };
}
