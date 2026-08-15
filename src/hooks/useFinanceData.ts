import { useQuery } from "@tanstack/react-query";
import {
  fetchCreditCards,
  fetchFixedExpenses,
  fetchIncomes,
  monthlyExpenseValue,
  monthlyIncomeValue,
} from "@/lib/finance";

export function useIncomes(familyId?: string) {
  return useQuery({
    queryKey: ["incomes", familyId],
    queryFn: () => fetchIncomes(familyId!),
    enabled: !!familyId,
  });
}

export function useFixedExpenses(familyId?: string) {
  return useQuery({
    queryKey: ["fixed-expenses", familyId],
    queryFn: () => fetchFixedExpenses(familyId!),
    enabled: !!familyId,
  });
}

export function useCreditCards(familyId?: string) {
  return useQuery({
    queryKey: ["credit-cards", familyId],
    queryFn: () => fetchCreditCards(familyId!),
    enabled: !!familyId,
  });
}

/** Totais mensais consolidados da família (sem análise/IA). */
export function useFinancialSummary(familyId?: string) {
  const incomes = useIncomes(familyId);
  const expenses = useFixedExpenses(familyId);
  const cards = useCreditCards(familyId);

  const receitaMensal = (incomes.data ?? [])
    .filter((i) => i.ativo)
    .reduce((acc, i) => acc + monthlyIncomeValue(i), 0);

  const contasFixas = (expenses.data ?? [])
    .filter((e) => e.ativo)
    .reduce((acc, e) => acc + monthlyExpenseValue(e), 0);

  const limiteCartoes = (cards.data ?? [])
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);

  const comprometimento = receitaMensal > 0 ? (contasFixas / receitaMensal) * 100 : null;

  return {
    isLoading: incomes.isLoading || expenses.isLoading || cards.isLoading,
    receitaMensal,
    contasFixas,
    limiteCartoes,
    comprometimento,
    saldo: receitaMensal - contasFixas,
    counts: {
      incomes: incomes.data?.length ?? 0,
      expenses: expenses.data?.length ?? 0,
      cards: cards.data?.length ?? 0,
    },
  };
}
