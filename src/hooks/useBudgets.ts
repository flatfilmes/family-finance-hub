import { useQuery } from "@tanstack/react-query";
import { budgetStatus, fetchBudgets, type BudgetStatus } from "@/lib/budgets";
import { currentMonth } from "@/lib/expenses";
import { useExpenseCategories, useExpenses } from "@/hooks/useExpenses";

export function useBudgets(familyId?: string) {
  return useQuery({
    queryKey: ["budgets", familyId],
    queryFn: () => fetchBudgets(familyId!),
    enabled: !!familyId,
  });
}

export type BudgetProgress = {
  id: string;
  categoriaId: string | null;
  categoria: string;
  planejado: number;
  gasto: number;
  percentual: number;
  restante: number;
  status: BudgetStatus;
};

/** Compara budgets.valor_planejado com o total de expenses.valor do mês corrente. */
export function useBudgetProgress(familyId?: string) {
  const month = currentMonth();
  const budgets = useBudgets(familyId);
  const expenses = useExpenses(familyId, { month });
  const categories = useExpenseCategories();

  const gastoPorCategoria = new Map<string, number>();
  for (const e of expenses.data ?? []) {
    const key = e.categoria_id ?? "sem-categoria";
    gastoPorCategoria.set(key, (gastoPorCategoria.get(key) ?? 0) + (Number(e.valor) || 0));
  }

  const items: BudgetProgress[] = (budgets.data ?? []).map((b) => {
    const planejado = Number(b.valor_planejado) || 0;
    const gasto = gastoPorCategoria.get(b.category_id ?? "sem-categoria") ?? 0;
    const percentual = planejado > 0 ? (gasto / planejado) * 100 : gasto > 0 ? 100 : 0;
    return {
      id: b.id,
      categoriaId: b.category_id,
      categoria:
        categories.data?.find((c) => c.id === b.category_id)?.nome ?? "Sem categoria",
      planejado,
      gasto,
      percentual,
      restante: planejado - gasto,
      status: budgetStatus(percentual),
    };
  });

  items.sort((a, b) => b.percentual - a.percentual);

  const totalPlanejado = items.reduce((acc, i) => acc + i.planejado, 0);
  const totalGasto = items.reduce((acc, i) => acc + i.gasto, 0);
  const percentualGeral =
    totalPlanejado > 0 ? (totalGasto / totalPlanejado) * 100 : totalGasto > 0 ? 100 : 0;

  return {
    month,
    items,
    totalPlanejado,
    totalGasto,
    percentualGeral,
    statusGeral: budgetStatus(percentualGeral),
    isLoading: budgets.isLoading || expenses.isLoading,
  };
}
