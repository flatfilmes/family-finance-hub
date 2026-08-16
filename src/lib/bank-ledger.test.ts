import { describe, expect, it } from "vitest";
import { buildDailyBankLedger, movementEffect } from "@/lib/bank-ledger";
import type { Transaction } from "@/lib/transactions";

const conta = "conta-1";

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    family_id: "f",
    bank_account_id: conta,
    tipo: "SAIDA",
    valor: 0,
    data_movimento: "2026-08-01",
    status: "CONFIRMADA",
    descricao: "x",
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  } as Transaction;
}

describe("ledger diário da conta", () => {
  it("deriva saldo do dia encadeando saldo anterior + movimentos", () => {
    const ledger = buildDailyBankLedger({
      accountId: conta,
      transactions: [
        tx({ tipo: "ABERTURA_SALDO", valor: 1000, data_movimento: "2026-07-31" }),
        tx({ tipo: "ENTRADA", valor: 500, data_movimento: "2026-08-01" }),
        tx({ tipo: "SAIDA", valor: 200, data_movimento: "2026-08-01" }),
        tx({ tipo: "SAIDA", valor: 0.54, data_movimento: "2026-08-02" }),
      ],
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });

    expect(ledger.openingBalance).toBe(1000);
    expect(ledger.days).toHaveLength(2);
    expect(ledger.days[0]!.calculatedClosingBalance).toBe(1300);
    // Tarifas pequenas não são ignoradas.
    expect(ledger.days[1]!.outflows).toBe(0.54);
    expect(ledger.closingBalance).toBe(1299.46);
  });

  it("aponta divergência contra o saldo informado pelo banco", () => {
    const ledger = buildDailyBankLedger({
      accountId: conta,
      transactions: [tx({ tipo: "ENTRADA", valor: 100, data_movimento: "2026-08-01" })],
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      openingBalance: 0,
      checkpoints: [{ data: "2026-08-01", saldo: 150 }],
    });
    expect(ledger.days[0]!.confere).toBe(false);
    expect(ledger.days[0]!.difference).toBe(50);
  });

  it("transferência usa o papel para definir o sinal", () => {
    expect(movementEffect(tx({ tipo: "TRANSFERENCIA", valor: 90, transfer_role: "ENTRADA" }))).toBe(
      90,
    );
    expect(movementEffect(tx({ tipo: "TRANSFERENCIA", valor: 90, transfer_role: "SAIDA" }))).toBe(
      -90,
    );
  });
});
