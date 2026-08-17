import { describe, expect, it } from "vitest";
import { detectDocumentType } from "./document-type";

describe("detectDocumentType", () => {
  it("classifica fatura de cartão Itaú mesmo com marca e código do banco", () => {
    const d = detectDocumentType([
      "Banco Itaú S.A. 341",
      "Resumo da fatura em R$",
      "Total da fatura anterior",
      "Pagamento efetuado em 17/07/2026",
      "Lançamentos atuais",
      "Total desta fatura",
      "Vencimento: 17/08/2026",
      "Previsão prox. Fechamento",
      "Cartão 5484.XXXX.XXXX.8294",
      "Pagamento mínimo",
      "Limite total de crédito",
      "Lançamentos: compras e saques",
      "DATA ESTABELECIMENTO VALOR EM R$",
      "Parcelamento da Fatura",
      "agência 1234",
    ]);
    expect(d.type).toBe("CREDIT_CARD_STATEMENT");
    expect(d.status).toBe("PASS");
  });

  it("mantém o extrato bancário Itaú como BANK_STATEMENT", () => {
    const d = detectDocumentType([
      "Banco Itaú S.A.",
      "extrato conta corrente",
      "período de visualização 01/01/2026 a 13/08/2026",
      "data lançamentos valor saldo (R$)",
      "SALDO ANTERIOR",
      "SALDO DO DIA 1.234,56",
    ]);
    expect(d.type).toBe("BANK_STATEMENT");
    expect(d.status).toBe("PASS");
  });
});
