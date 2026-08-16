import { describe, expect, it } from "vitest";
import { isStatementConfirmed } from "@/lib/card-statements";
import { obrigacaoAbertaDoCartao } from "@/lib/card-details";

const invoice = {
  id: "invoice-aug",
  status: "ABERTA",
  data_vencimento: "2026-08-17",
  data_fechamento: "2026-08-10",
  valor_total: 5795.41,
};

const confirmedImport = {
  id: "statement-aug",
  credit_card_id: "itau",
  status: "CONFIRMED",
  valor_total_fatura: 6577.67,
  data_vencimento: "2026-08-17",
  data_fechamento: "2026-08-10",
  periodo_fim: null,
  created_at: "2026-08-16T10:12:16Z",
};

describe("fonte oficial da fatura", () => {
  it("usa a importação confirmada aberta e substitui a estimativa do ciclo", () => {
    expect(isStatementConfirmed(confirmedImport)).toBe(true);
    const result = obrigacaoAbertaDoCartao({
      cardId: "itau",
      invoice,
      imports: [confirmedImport],
    });
    expect(result.oficial).toBe(true);
    expect(result.valor).toBe(6577.67);
  });

  it("remove a fatura paga do consolidado, preservando sua fonte oficial", () => {
    const result = obrigacaoAbertaDoCartao({
      cardId: "itau",
      invoice: { ...invoice, status: "PAGA" },
      imports: [confirmedImport],
    });
    expect(result.oficial).toBe(true);
    expect(result.aberta).toBe(false);
    expect(result.valor).toBe(0);
  });
});