/**
 * Registro de parsers de EXTRATO BANCÁRIO.
 *
 * Hoje só existe o parser genérico de PDF digital. Bancos específicos
 * (Banco do Brasil, Itaú, Nubank...) entram aqui apenas depois de terem o
 * layout real observado no Modo diagnóstico PDF. Nada de parser inventado.
 *
 * A arquitetura já aceita outros formatos: basta uma função que devolva
 * `ParsedBankStatement` a partir do arquivo (CSV e OFX ficam para depois).
 */
import type { ParsedBankStatement } from "@/lib/bank-statements/types";
import { readBankStatementPdf } from "./generic";
import { BB_PARSER_ID, readBancoDoBrasilPdf } from "./banco-do-brasil";
import { ITAU_BANK_PARSER_ID, readItauBankStatementPdf } from "./itau";

export type BankStatementParser = {
  id: string;
  nome: string;
  formatos: Array<"PDF" | "CSV" | "OFX">;
  ler: (file: Blob) => Promise<ParsedBankStatement>;
};

export const GENERIC_PDF_PARSER: BankStatementParser = {
  id: "EXTRATO_GENERICO_PDF",
  nome: "Extrato PDF (genérico)",
  formatos: ["PDF"],
  ler: readBankStatementPdf,
};

export const BANCO_DO_BRASIL_PARSER: BankStatementParser = {
  id: BB_PARSER_ID,
  nome: "Extrato Banco do Brasil (PDF)",
  formatos: ["PDF"],
  ler: readBancoDoBrasilPdf,
};

export const ITAU_BANK_PARSER: BankStatementParser = {
  id: ITAU_BANK_PARSER_ID,
  nome: "Extrato Itaú (PDF)",
  formatos: ["PDF"],
  ler: readItauBankStatementPdf,
};

export const BANK_STATEMENT_PARSERS: BankStatementParser[] = [
  BANCO_DO_BRASIL_PARSER,
  ITAU_BANK_PARSER,
  GENERIC_PDF_PARSER,
];

/** Escolhe o parser adequado. Sem evidência de banco, usa o genérico. */
export function selectBankStatementParser(_fileName?: string): BankStatementParser {
  return GENERIC_PDF_PARSER;
}

export * from "./generic";
export * from "./banco-do-brasil";
export * from "./itau";
