import type { FixedExpense, Income } from "@/lib/finance";
import type { SpendingBreakdown } from "@/lib/monthly-spending";
import type { CommitmentsBreakdown, FreeCashStatus } from "@/lib/free-cash";
import { averageVariableIncome } from "@/lib/financial-engine";
import { guaranteedMonthlyIncome } from "@/lib/free-cash";
import { sumMonthlyFixedExpenses, sumMonthlyIncome } from "./income";
import type { BankOverview } from "./bank";
import type { CardCommitments } from "./cards";

/**
 * READ MODEL FINANCEIRO CANÔNICO (Fase 4A).
 *
 * Uma pergunta financeira = uma implementação. Dashboard, Relatórios,
 * Planejamento, Histórico, Bancos, Cartões e Fechamento Mensal consomem
 * exatamente este modelo — a UI apenas formata e exibe.
 *
 * Nada aqui recalcula regra econômica: o módulo COMPÕE os motores já
 * validados (buildSpendingBreakdown, buildCommitments, ledger bancário,
 * engine de fatura) num único objeto de leitura.
 */
export type FreeCashView = {
  hoje: string;
  saldoBancario: number;
  reserva: number;
  percentualReserva: number;
  livreHoje: number;
  status: FreeCashStatus;
  proximoRecebimento: string | null;
  ateProximoRecebimento: CommitmentsBreakdown;
};

export type FinancialReadModel = {
  month: string;
  income: {
    /** Renda fixa garantida do mês. */
    garantida: number;
    /** Média histórica das receitas variáveis (não é saldo). */
    variavelEsperada: number;
    /** Renda estimada do mês = garantida + média variável. */
    total: number;
    /** Soma de TODAS as receitas ativas normalizadas por mês. */
    mensalCadastrada: number;
  };
  spending: SpendingBreakdown;
  /** Contas fixas ativas da competência. */
  contasFixas: number;
  commitments: CommitmentsBreakdown;
  freeCash: FreeCashView;
  bank: BankOverview;
  cards: CardCommitments;
};

export function buildFinancialReadModel(input: {
  month: string;
  incomes: Income[];
  fixed: FixedExpense[];
  spending: SpendingBreakdown;
  commitments: CommitmentsBreakdown;
  freeCash: FreeCashView;
  bank: BankOverview;
  cards: CardCommitments;
}): FinancialReadModel {
  const garantida = guaranteedMonthlyIncome(input.incomes);
  const variavelEsperada = averageVariableIncome(input.incomes);

  return {
    month: input.month,
    income: {
      garantida,
      variavelEsperada,
      total: garantida + variavelEsperada,
      mensalCadastrada: sumMonthlyIncome(input.incomes),
    },
    spending: input.spending,
    contasFixas: sumMonthlyFixedExpenses(input.fixed),
    commitments: input.commitments,
    freeCash: input.freeCash,
    bank: input.bank,
    cards: input.cards,
  };
}

/**
 * Projeção de apresentação do Dashboard.
 * Só seleciona e rotula campos — nenhuma aritmética econômica nova.
 */
export function buildDashboardReadModel(rm: FinancialReadModel) {
  return {
    period: rm.month,
    income: rm.income,
    spending: rm.spending,
    commitments: rm.commitments,
    freeCash: rm.freeCash,
    bankBalance: rm.bank.saldoTotal,
    cashFlow: rm.bank,
    openInvoices: rm.cards.totalFaturasAbertas,
    cards: rm.cards,
  };
}

/**
 * Projeção de apresentação dos Relatórios.
 * Consome o MESMO read model do Dashboard: não existe "segunda contabilidade".
 */
export function buildReportsReadModel(rm: FinancialReadModel) {
  return {
    period: rm.month,
    receitaMensal: rm.income.mensalCadastrada,
    contasFixas: rm.contasFixas,
    gastosDoMes: rm.spending.total,
    saldoBancario: rm.bank.saldoTotal,
    commitments: rm.commitments,
    freeCash: rm.freeCash,
  };
}
