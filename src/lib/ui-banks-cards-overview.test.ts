import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const bancos = readFileSync("src/routes/_authenticated/bancos.index.tsx", "utf8");
const cartoes = readFileSync("src/routes/_authenticated/cartoes.index.tsx", "utf8");
const contaDetalhe = readFileSync("src/routes/_authenticated/bancos.$accountId.tsx", "utf8");
const cartaoDetalhe = readFileSync("src/routes/_authenticated/cartoes.$cardId.tsx", "utf8");

describe("visão geral de Bancos", () => {
  it("BANKS_GENERAL_NO_SEARCH_TEST", () => {
    expect(bancos).not.toContain("SearchInput");
  });

  it("BANKS_GENERAL_NO_BANK_PERSON_FILTERS_TEST", () => {
    expect(bancos).not.toContain("MemberFilter");
    expect(bancos).not.toContain('label="Banco"');
  });

  it("BANK_PERIOD_FILTER_PRESERVED", () => {
    expect(bancos).toContain('type="month"');
  });

  it("BANK_DIAGNOSTIC_NOT_IN_GENERAL_OVERVIEW_TEST", () => {
    expect(bancos).not.toContain("diagnostico-importacao");
  });

  it("BANK_DIAGNOSTIC_AVAILABLE_IN_ACCOUNT_CONTEXT_TEST", () => {
    expect(contaDetalhe).toContain("/bancos/$accountId/diagnostico-parser");
  });
});

describe("visão geral de Cartões", () => {
  it("CARDS_GENERAL_NO_SEARCH_TEST", () => {
    expect(cartoes).not.toContain("SearchInput");
  });

  it("CARDS_GENERAL_NO_IMPORT_BUTTON_TEST", () => {
    expect(cartoes).not.toContain("StatementImportDialog");
    expect(cartoes).not.toContain("Importar fatura");
  });

  it("CARD_IMPORT_AVAILABLE_IN_CARD_CONTEXT_TEST", () => {
    expect(cartaoDetalhe).toContain("Importar fatura");
    expect(cartaoDetalhe).toContain("StatementImportDialog");
  });

  it("CARDS_GENERAL_NO_IMPORT_HISTORY_LIST_TEST", () => {
    expect(cartoes).not.toContain("Últimas importações");
    expect(cartoes).not.toContain("CardStatementImports");
  });

  it("CARD_IMPORT_HISTORY_AVAILABLE_IN_CARD_DETAIL_TEST", () => {
    expect(cartaoDetalhe).toContain("CardStatementImports");
  });

  it("CARD_SUMMARY_PRIORITIZES_INVOICE_AND_DUE_DATE_TEST", () => {
    expect(cartoes).toContain("Vencimento");
    expect(cartoes).not.toContain('label="Limite"');
    expect(cartoes).not.toContain('label="Utilizado"');
    expect(cartoes).not.toContain('label="Disponível"');
    expect(cartoes).not.toContain("TONE_DOTS");
  });
});
