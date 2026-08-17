/**
 * FASE 3F — CONSERVAÇÃO ECONÔMICA.
 * Pagamento de fatura, transferência, parcelamento, recorrência e a separação
 * entre gasto de competência e fluxo de caixa.
 */
import { describe, expect, it } from "vitest";
import { buildSpendingBreakdown } from "@/lib/monthly-spending";
import { buildCommitments } from "@/lib/free-cash";
import { buildDailyBankLedger } from "@/lib/bank-ledger";
import { cardItemsToCandidates, imageReadingToCandidates } from "@/lib/financial-evidence/candidates";
import { reconcileFinancialCandidates } from "@/lib/financial-evidence/reconcile";
import { buildConfirmationPlan } from "@/lib/financial-evidence/plan";
import { confirmFinancialCandidates } from "@/lib/financial-evidence/confirm";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  CARD_A,
  createWorld,
  fixedExpense,
  installment,
  invoice,
  purchase,
  recurring,
  reviewContext,
  transaction,
} from "./world";

describe("E2E_INVOICE_PAYMENT_NOT_A_PURCHASE", () => {
  it("pagamento de fatura sai do banco, liquida a obrigação e não vira gasto novo", () => {
    const mes = "2026-09";
    const fatura = invoice({ valor_total: 274.8, data_vencimento: "2026-09-05", status: "FECHADA" });
    const compras = [
      purchase({ data_compra: "2026-08-12", valor_total: 84.9 }),
      purchase({ data_compra: "2026-08-13", valor_total: 150 }),
      purchase({ data_compra: "2026-08-14", valor_total: 39.9 }),
    ];

    const antes = buildCommitments({
      from: "2026-09-01",
      to: "2026-09-30",
      month: mes,
      fixed: [],
      invoices: [fatura],
      installments: [],
      recurring: [],
      purchases: compras,
    });
    expect(antes.faturasCartao).toBe(274.8);

    const depois = buildCommitments({
      from: "2026-09-01",
      to: "2026-09-30",
      month: mes,
      fixed: [],
      invoices: [{ ...fatura, status: "PAGA" }],
      installments: [],
      recurring: [],
      purchases: compras,
    });
    expect(depois.faturasCartao).toBe(0);

    // O pagamento é caixa de setembro, mas o CONSUMO continua sendo de agosto.
    const gastoSetembro = buildSpendingBreakdown({
      month: mes,
      purchases: compras,
      installments: [],
      recurring: [],
      fixed: [],
    });
    expect(gastoSetembro.total).toBe(0);

    const gastoAgosto = buildSpendingBreakdown({
      month: "2026-08",
      purchases: compras,
      installments: [],
      recurring: [],
      fixed: [],
    });
    expect(gastoAgosto.cartaoAVista).toBeCloseTo(274.8, 2);

    // O caixa cai uma única vez, no pagamento.
    const ledger = buildDailyBankLedger({
      accountId: ACCOUNT_A,
      transactions: [
        transaction({ tipo: "SAIDA", valor: 274.8, data_movimento: "2026-09-05", descricao: "PAGTO FATURA" }),
      ],
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      openingBalance: 1000,
    });
    expect(ledger.closingBalance).toBe(725.2);
  });

  it("candidato de pagamento de fatura nunca é convertido em compra", () => {
    const [candidato] = imageReadingToCandidates(
      [{ data: "2026-09-05", descricao: "PAGAMENTO FATURA NUBANK", valor: -274.8 }],
      { evidenceId: "ev-print-banco", bankAccountId: ACCOUNT_A },
      "BANK_SCREENSHOT",
    );
    const res = reconcileFinancialCandidates({ candidates: [candidato!], existing: [] });
    const plano = buildConfirmationPlan({
      resolution: res.resolutions[0]!,
      context: reviewContext({
        evidenceImportId: "ev-print-banco",
        sourceType: "BANK_SCREENSHOT",
        bankAccountId: ACCOUNT_A,
        creditCardId: null,
      }),
      decision: { action: "CREATE_BANK_MOVEMENT" },
    });
    const efeitoBanco = plano.expectedEffects.find((e) => e.scope === "BANK_BALANCE");
    expect(plano.action).toBe("CREATE_BANK_MOVEMENT");
    expect(efeitoBanco?.amount).toBe(-274.8);
    expect(plano.expectedEffects.some((e) => e.scope === "PURCHASE")).toBe(false);
  });
});

describe("E2E_TRANSFER_BETWEEN_ACCOUNTS", () => {
  it("transferência move saldo entre contas e preserva o patrimônio total", () => {
    const world = createWorld({
      transactions: [
        transaction({ bank_account_id: ACCOUNT_A, tipo: "ENTRADA", valor: 1000, data_movimento: "2026-08-01" }),
      ],
    });
    const patrimonioAntes = world.netWorth();

    const grupo = "transfer-1";
    world.state.transactions.push(
      transaction({
        bank_account_id: ACCOUNT_A,
        tipo: "SAIDA",
        valor: 300,
        data_movimento: "2026-08-10",
        descricao: "TRANSFERENCIA ENVIADA",
        transfer_group_id: grupo,
      }),
      transaction({
        bank_account_id: ACCOUNT_B,
        tipo: "ENTRADA",
        valor: 300,
        data_movimento: "2026-08-10",
        descricao: "TRANSFERENCIA RECEBIDA",
        transfer_group_id: grupo,
      }),
    );

    expect(world.netWorth()).toBe(patrimonioAntes);

    const ledgerA = buildDailyBankLedger({
      accountId: ACCOUNT_A,
      transactions: world.state.transactions,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      openingBalance: 0,
    });
    const ledgerB = buildDailyBankLedger({
      accountId: ACCOUNT_B,
      transactions: world.state.transactions,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      openingBalance: 0,
    });
    expect(ledgerA.closingBalance).toBe(700);
    expect(ledgerB.closingBalance).toBe(300);

    // A transferência não é consumo em nenhuma das pontas.
    const gasto = buildSpendingBreakdown({
      month: "2026-08",
      purchases: [],
      installments: [],
      recurring: [],
      fixed: [],
    });
    expect(gasto.total).toBe(0);
    expect(world.state.transactions.filter((t) => t.transfer_group_id === grupo)).toHaveLength(2);
  });
});

describe("E2E_INSTALLMENT_PURCHASE", () => {
  const compra = purchase({
    id: "compra-parcelada",
    data_compra: "2026-08-20",
    valor_total: 1200,
    tipo_compra: "COMPRA_PARCELADA",
    forma_pagamento: "CREDITO",
  });
  const parcelas = Array.from({ length: 12 }, (_, i) =>
    installment({
      purchase_id: "compra-parcelada",
      numero_parcela: i + 1,
      total_parcelas: 12,
      valor_parcela: 100,
      data_vencimento: `2026-${String(8 + i).padStart(2, "0")}-10`,
    }),
  );

  it("compra parcelada gera 12 parcelas e o mês reconhece apenas a parcela vigente", () => {
    expect(parcelas).toHaveLength(12);
    expect(parcelas.reduce((a, p) => a + Number(p.valor_parcela), 0)).toBe(1200);

    const agosto = buildSpendingBreakdown({
      month: "2026-08",
      purchases: [compra],
      installments: parcelas,
      recurring: [],
      fixed: [],
    });
    expect(agosto.parcelasDoMes).toBe(100);
    expect(agosto.cartaoAVista).toBe(0);
    expect(agosto.total).toBe(100);
    expect(agosto.valorContratadoParcelamentos).toBe(1200);
    expect(agosto.parcelasFuturas).toBe(1100);

    const setembro = buildSpendingBreakdown({
      month: "2026-09",
      purchases: [compra],
      installments: parcelas,
      recurring: [],
      fixed: [],
    });
    expect(setembro.parcelasDoMes).toBe(100);
    expect(setembro.parcelasFuturas).toBe(1000);
  });

  it("a parcela do mês entra no compromisso via fatura, sem dupla contagem", () => {
    const fatura = invoice({ id: "inv-set", valor_total: 100, data_vencimento: "2026-09-05" });
    const parcelaDoMes = { ...parcelas[1]!, card_invoice_id: "inv-set" };
    const comp = buildCommitments({
      from: "2026-09-01",
      to: "2026-09-30",
      month: "2026-09",
      fixed: [],
      invoices: [fatura],
      installments: [parcelaDoMes],
      recurring: [],
      purchases: [compra],
    });
    expect(comp.parcelas).toBe(100);
    expect(comp.faturasCartao).toBe(0);
    expect(comp.total).toBe(100);
  });
});

describe("E2E_RECURRING_EXPENSE", () => {
  it("assinatura mensal é contada uma vez por competência e para após cancelar", () => {
    const assinatura = recurring({ valor: 55.9, data_inicio: "2026-06-05", proxima_cobranca: "2026-08-05" });

    for (const mes of ["2026-06", "2026-07", "2026-08"]) {
      const b = buildSpendingBreakdown({
        month: mes,
        purchases: [],
        installments: [],
        recurring: [assinatura],
        fixed: [],
      });
      expect(b.recorrencias).toBe(55.9);
      expect(b.total).toBe(55.9);
    }

    const cancelada = { ...assinatura, ativo: false, data_cancelamento: "2026-08-20" };
    const setembro = buildSpendingBreakdown({
      month: "2026-09",
      purchases: [],
      installments: [],
      recurring: [cancelada],
      fixed: [],
    });
    expect(setembro.recorrencias).toBe(0);
  });
});

describe("E2E_SPENDING_VS_CASHFLOW", () => {
  it("gasto de competência e saída de caixa são grandezas distintas e coerentes", async () => {
    const world = createWorld();
    const ctxCartao = reviewContext({
      evidenceImportId: "ev-c",
      sourceType: "CREDIT_CARD_STATEMENT_PDF",
      creditCardId: CARD_A,
      bankAccountId: null,
    });
    const noCartao = cardItemsToCandidates(
      [{ date: "2026-08-12", description: "MERCADO XYZ", amount: 200 }],
      { evidenceId: "ev-c", creditCardId: CARD_A },
    );
    await confirmFinancialCandidates(
      reconcileFinancialCandidates({ candidates: noCartao, existing: [] }).resolutions.map((r) =>
        buildConfirmationPlan({ resolution: r, context: ctxCartao }),
      ),
      ctxCartao,
      world.deps,
    );

    const ctxBanco = reviewContext({
      evidenceImportId: "ev-b",
      sourceType: "BANK_STATEMENT_PDF",
      bankAccountId: ACCOUNT_A,
      creditCardId: null,
    });
    const noPix = imageReadingToCandidates(
      [{ data: "2026-08-13", descricao: "FEIRA LIVRE", valor: -80 }],
      { evidenceId: "ev-b", bankAccountId: ACCOUNT_A },
      "BANK_SCREENSHOT",
    );
    await confirmFinancialCandidates(
      reconcileFinancialCandidates({ candidates: noPix, existing: [] }).resolutions.map((r) =>
        buildConfirmationPlan({ resolution: r, context: ctxBanco }),
      ),
      ctxBanco,
      world.deps,
    );

    // Caixa: só o Pix saiu do banco em agosto.
    expect(world.netWorth()).toBe(-80);
    expect(world.state.purchases).toHaveLength(2);

    // Competência: os dois consumos pertencem a agosto.
    const gasto = buildSpendingBreakdown({
      month: "2026-08",
      purchases: world.state.purchases,
      installments: [],
      recurring: [],
      fixed: [fixedExpense({ valor: 300 })],
    });
    expect(gasto.cartaoAVista).toBe(200);
    expect(gasto.caixa).toBe(80);
    expect(gasto.contasRecorrentes).toBe(300);
    expect(gasto.total).toBe(580);
  });
});
