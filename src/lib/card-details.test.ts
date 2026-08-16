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
describe("faturasFechadasEmAberto", () => {
  const hoje = new Date(2026, 7, 16);
  const imports = [
    {
      id: "imp-1",
      credit_card_id: "card-1",
      status: "CONFIRMED",
      valor_total_fatura: 6577.67,
      data_vencimento: "2026-08-17",
      data_fechamento: "2026-08-10",
      periodo_fim: "2026-08-10",
      created_at: "2026-08-12",
    },
  ];
  const inv = (id: string, fech: string, venc: string, valor: number, status = "ABERTA") => ({
    id,
    credit_card_id: "card-1",
    status,
    data_fechamento: fech,
    data_vencimento: venc,
    valor_total: valor,
  });

  it("mostra só o ciclo real fechado, ignorando estimativas e projeções", () => {
    const r = faturasFechadasEmAberto({
      invoices: [
        inv("i-ago", "2026-08-10", "2026-08-17", 5795.41),
        inv("i-jul", "2026-07-10", "2026-07-17", 1121.91),
        inv("i-jun", "2026-06-10", "2026-06-17", 896.5),
        inv("i-set", "2026-09-10", "2026-09-17", 1570.55),
      ],
      imports,
      hoje,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.restante).toBe(6577.67);
    expect(r[0]!.oficial).toBe(true);
  });

  it("exclui fatura paga e saldo quitado", () => {
    expect(
      faturasFechadasEmAberto({
        invoices: [inv("i-ago", "2026-08-10", "2026-08-17", 5795.41, "PAGA")],
        imports,
        hoje,
      }),
    ).toHaveLength(0);
    expect(
      faturasFechadasEmAberto({
        invoices: [inv("i-ago", "2026-08-10", "2026-08-17", 5795.41)],
        imports,
        pagamentos: new Map([["i-ago", 6577.67]]),
        hoje,
      }),
    ).toHaveLength(0);
  });
});
