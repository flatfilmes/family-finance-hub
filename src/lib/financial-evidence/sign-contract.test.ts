import { describe, expect, it } from "vitest";
import { defaultEconomicKind, normalizeAmount } from "./sign-contract";
import {
  bankMovementsToCandidates,
  cardItemsToCandidates,
  imageReadingToCandidates,
} from "./candidates";
import type { ParsedBankMovement } from "@/lib/bank-statements/types";

const ctx = { evidenceId: "ev-1" };

describe("contrato canônico de sinal", () => {
  it("BANK_IMAGE_NEGATIVE_OUT_NORMALIZED_TEST", () => {
    const [c] = imageReadingToCandidates(
      [{ data: "2026-08-10", descricao: "MERCADO SAO JOSE", valor: -84.9 }],
      ctx,
    );
    expect(c?.amount).toBe(84.9);
    expect(c?.direction).toBe("OUT");
    expect(c?.rawAmount).toBe(-84.9);
    expect(c?.economicKind).toBe("PURCHASE");
  });

  it("BANK_IMAGE_POSITIVE_IN_NORMALIZED_TEST", () => {
    const [c] = imageReadingToCandidates(
      [{ data: "2026-08-05", descricao: "SALARIO", valor: 3200 }],
      ctx,
    );
    expect(c?.amount).toBe(3200);
    expect(c?.direction).toBe("IN");
    expect(c?.economicKind).toBe("INCOME");
  });

  it("CARD_STATEMENT_PURCHASE_POSITIVE_NORMALIZED_TEST", () => {
    const [c] = cardItemsToCandidates(
      [{ date: "2026-08-10", description: "MERCADO SAO JOSE", amount: 84.9 }],
      ctx,
    );
    expect(c?.amount).toBe(84.9);
    expect(c?.direction).toBe("OUT");
    expect(c?.rawAmount).toBe(84.9);
    expect(c?.economicKind).toBe("PURCHASE");
  });

  it("CARD_CREDIT_REVERSAL_NORMALIZED_TEST", () => {
    const [c] = cardItemsToCandidates(
      [{ date: "2026-08-12", description: "ESTORNO COMPRA", amount: -84.9 }],
      ctx,
    );
    expect(c?.amount).toBe(84.9);
    expect(c?.direction).toBe("IN");
    expect(c?.economicKind).toBe("REFUND");
  });

  it("SIGN_CONVENTION_SOURCE_INDEPENDENCE_TEST", () => {
    // O MESMO fato econômico (gastei 84,90 no mercado) vindo de três fontes
    // com convenções de sinal diferentes precisa ter a mesma semântica.
    const [print] = imageReadingToCandidates(
      [{ data: "2026-08-10", descricao: "MERCADO SAO JOSE", valor: -84.9 }],
      ctx,
    );
    const [fatura] = cardItemsToCandidates(
      [{ date: "2026-08-10", description: "MERCADO SAO JOSE", amount: 84.9 }],
      ctx,
    );
    const movimento: ParsedBankMovement = {
      data: "2026-08-10",
      descricaoOriginal: "MERCADO SAO JOSE",
      valor: -84.9,
      tipo: "COMPRA",
    } as ParsedBankMovement;
    const [extrato] = bankMovementsToCandidates([movimento], ctx);

    for (const c of [print, fatura, extrato]) {
      expect(c?.amount).toBe(84.9);
      expect(c?.direction).toBe("OUT");
      expect(c?.economicKind).toBe("PURCHASE");
    }
  });

  it("normaliza pelo contrato, não pelo sourceType espalhado no domínio", () => {
    expect(normalizeAmount(-10, "BANK_SCREENSHOT")).toMatchObject({
      amount: 10,
      direction: "OUT",
    });
    expect(normalizeAmount(-10, "CREDIT_CARD_STATEMENT_PDF")).toMatchObject({
      amount: 10,
      direction: "IN",
    });
    expect(defaultEconomicKind("IN", "BANK_STATEMENT_PDF")).toBe("INCOME");
    expect(defaultEconomicKind("IN", "CREDIT_CARD_STATEMENT_PDF")).toBe("REFUND");
  });
});
