import type { FixedExpense, Income } from "@/lib/finance";
import { monthlyExpenseValue, monthlyIncomeValue } from "@/lib/finance";

/**
 * Read model canônico de RENDA CADASTRADA.
 *
 * Regra única: renda mensal cadastrada é a soma das receitas ATIVAS já
 * normalizadas para a competência (monthlyIncomeValue). Nenhuma tela pode
 * redefinir isso com um reduce próprio.
 */
export function sumMonthlyIncome(incomes: Income[]) {
  return incomes.filter((i) => i.ativo).reduce((acc, i) => acc + monthlyIncomeValue(i), 0);
}

/** Contas fixas ativas normalizadas para a competência (aluguel, energia...). */
export function sumMonthlyFixedExpenses(fixed: FixedExpense[]) {
  return fixed.filter((f) => f.ativo).reduce((acc, f) => acc + monthlyExpenseValue(f), 0);
}
