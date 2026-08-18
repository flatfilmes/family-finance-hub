/**
 * FASE 4A — Paridade dos read models canônicos.
 *
 * Prova que Dashboard e Relatórios leem o MESMO número e que a regra de
 * cobertura de faturas é única no sistema.
 */
import { describe, expect, it } from "vitest";
import type { FixedExpense, Income } from "@/lib/finance";
import { buildSpendingBreakdown } from "@/lib/monthly-spending";
import { buildBankOverview } from "./bank";
import { buildCardCommitments, cardCoverageStatus } from "./cards";
import { buildDashboardReadModel, buildFinancialReadModel, buildReportsReadModel } from "./financial";
import { sumMonthlyFixedExpenses, sumMonthlyIncome } from "./income";

const income = (over: Partial<Income> = {}) =>
  ({
    id: "i-1",
    family_id: "f-1",
    member_id: null,
    descricao: "Salário",
    valor: 5000,
    tipo: "FIXA",
    frequencia: "MENSAL",
    ativo: true,
    ...over,
  }) as unknown as Income;

const fixed = (over: Partial<FixedExpense> = {}) =>
  ({
    id: "f-1",
    family_id: "f-1",
    member_id: null,
    descricao: "Aluguel",
    valor: 1200,
    recorrencia: "MENSAL",
    ativo: true,
    ...over,
  }) as unknown as FixedExpense;

const emptyCommitments = {
  total: 0,
  fixas: 0,
  faturas: 0,
  parcelas: 0,
  recorrencias: 0,
  compras: 0,
  itens: [],
} as never;

function model() {
  const spending = buildSpendingBreakdown({
    month: "2026-08",
    purchases: [],
    installments: [],
    recurring: [],
    fixed: [fixed()],
  });

  const bank = buildBankOverview({
    accounts: [{ id: "b-1", ativo: true, saldo_atual: 3000 } as never],
    transactions: [],
    month: "2026-08",
  });

  const cards = buildCardCommitments({
    cards: [
      { id: "c-1", ativo: true, nome_cartao: "Roxinho", banco: "Nubank", limite: 5000 } as never,
    ],
    obrigacaoDe: () => ({ valor: 1500, aberta: true, oficial: true }),
    saldoContas: bank.saldoTotal,
  });

  return buildFinancialReadModel({
    month: "2026-08",
    incomes: [income()],
    fixed: [fixed()],
    spending,
    commitments: emptyCommitments,
    freeCash: {
      hoje: "2026-08-15",
      saldoBancario: bank.saldoTotal,
      reserva: 0,
      percentualReserva: 0,
      livreHoje: bank.saldoTotal,
      status: "OK" as never,
      proximoRecebimento: null,
      ateProximoRecebimento: emptyCommitments,
    },
    bank,
    cards,
  });
}

describe("READ_MODEL_PARITY", () => {
  it("Dashboard e Relatórios leem exatamente os mesmos números", () => {
    const rm = model();
    const dash = buildDashboardReadModel(rm);
    const rep = buildReportsReadModel(rm);

    expect(rep.gastosDoMes).toBe(dash.spending.total);
    expect(rep.saldoBancario).toBe(dash.bankBalance);
    expect(rep.contasFixas).toBe(sumMonthlyFixedExpenses([fixed()]));
    expect(rep.receitaMensal).toBe(sumMonthlyIncome([income()]));
    expect(rep.period).toBe(dash.period);
  });

  it("contas fixas aparecem uma única vez no gasto do mês", () => {
    const rm = model();
    expect(rm.spending.total).toBe(rm.spending.contasRecorrentes);
    expect(rm.contasFixas).toBe(rm.spending.contasRecorrentes);
  });

  it("capacidade de cartão é saldo - faturas, com status único", () => {
    const rm = model();
    expect(rm.cards.totalFaturasAbertas).toBe(1500);
    expect(rm.cards.capacidade).toBe(rm.bank.saldoTotal - 1500);
    expect(rm.cards.status).toBe(cardCoverageStatus(rm.bank.saldoTotal, 1500));
    expect(rm.cards.status).toBe("VERDE");
  });

  it("regra de cobertura tem fronteiras estáveis", () => {
    expect(cardCoverageStatus(99, 100)).toBe("VERMELHO");
    expect(cardCoverageStatus(100, 100)).toBe("AMARELO");
    expect(cardCoverageStatus(119.99, 100)).toBe("AMARELO");
    expect(cardCoverageStatus(120, 100)).toBe("VERDE");
    expect(cardCoverageStatus(0, 0)).toBe("VERDE");
  });
});
