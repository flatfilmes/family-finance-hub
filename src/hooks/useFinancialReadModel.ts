import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { useCreditCards, useFixedExpenses, useIncomes } from "@/hooks/useFinanceData";
import { useCardsData } from "@/hooks/useCardsData";
import { useMonthlySpending } from "@/hooks/useMonthlySpending";
import { useFreeCash } from "@/hooks/useFreeCash";
import { filterByMember } from "@/components/member-filter";
import { currentMonth } from "@/lib/expenses";
import {
  buildBankOverview,
  buildCardCommitments,
  buildFinancialReadModel,
  sumBankBalances,
  type FinancialReadModel,
} from "@/lib/read-models";

/**
 * Fluxo bancário canônico de um período (saldo, entradas, saídas, pagamentos).
 * Bancos, Dashboard e Relatórios usam esta mesma leitura.
 */
export function useBankOverview(familyId?: string, memberId = "", period = currentMonth()) {
  const accounts = useBankAccounts(familyId);
  const transactions = useTransactions(familyId);
  const contas = filterByMember(accounts.data ?? [], memberId);

  return {
    isLoading: accounts.isLoading || transactions.isLoading,
    contas,
    overview: buildBankOverview({
      accounts: contas,
      transactions: filterByMember(transactions.data ?? [], memberId),
      period,
    }),
  };
}

/** Compromissos de cartão canônicos (faturas abertas x saldo em contas). */
export function useCardCommitments(familyId?: string, memberId = "") {
  const cards = useCreditCards(familyId);
  const accounts = useBankAccounts(familyId);
  const dados = useCardsData(familyId);

  const cartoes = filterByMember(cards.data ?? [], memberId);
  const contas = filterByMember(accounts.data ?? [], memberId);

  return {
    isLoading: cards.isLoading || accounts.isLoading || dados.isLoading,
    commitments: buildCardCommitments({
      cards: cartoes,
      obrigacaoDe: (cardId) => dados.obrigacaoAbertaDe(cardId),
      saldoContas: sumBankBalances(contas),
    }),
  };
}

/**
 * Read model financeiro único da competência.
 * Toda tela que precisa de renda, gasto, compromisso, saldo, fatura ou
 * dinheiro livre consome este hook — nunca uma fórmula própria.
 */
export function useFinancialReadModel(
  familyId?: string,
  memberId = "",
  month = currentMonth(),
): FinancialReadModel & { isLoading: boolean } {
  const incomes = useIncomes(familyId);
  const fixed = useFixedExpenses(familyId);
  const spending = useMonthlySpending(familyId, memberId, month);
  const caixa = useFreeCash(familyId, memberId);
  const banco = useBankOverview(familyId, memberId, month);
  const cartoes = useCardCommitments(familyId, memberId);

  const modelo = buildFinancialReadModel({
    month,
    incomes: filterByMember(incomes.data ?? [], memberId),
    fixed: filterByMember(fixed.data ?? [], memberId),
    spending,
    commitments: caixa.comprometido,
    freeCash: {
      hoje: caixa.hoje,
      saldoBancario: caixa.saldoBancario,
      reserva: caixa.reserva,
      percentualReserva: caixa.percentualReserva,
      livreHoje: caixa.livreHoje,
      status: caixa.status,
      proximoRecebimento: caixa.proximoRecebimento,
      ateProximoRecebimento: caixa.ateProximoRecebimento,
    },
    bank: banco.overview,
    cards: cartoes.commitments,
  });

  return {
    ...modelo,
    isLoading:
      incomes.isLoading ||
      fixed.isLoading ||
      spending.isLoading ||
      caixa.isLoading ||
      banco.isLoading ||
      cartoes.isLoading,
  };
}
