import { useQuery } from "@tanstack/react-query";
import { budgetStatus, fetchBudgets, monthToRef, type BudgetStatus } from "@/lib/budgets";
import { currentMonth } from "@/lib/expenses";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { useCategorySpending } from "@/hooks/useSpendingSummary";
import { SEM_CATEGORIA } from "@/lib/spending-categories";

export function useBudgets(familyId?: string, month?: string) {
  const ref = month ? monthToRef(month) : undefined;
  return useQuery({
    queryKey: ["budgets", familyId, month ?? null],
    queryFn: () => fetchBudgets(familyId!, ref),
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

/**
 * Compara budgets.valor_planejado com o consumo real da competência.
 * Fonte única: purchases + purchase_items (a tabela legada `expenses` não é mais usada).
 */
export function useBudgetProgress(familyId?: string, monthArg?: string, memberId = "") {
  const month = monthArg ?? currentMonth();
  const budgets = useBudgets(familyId, month);
  const consumo = useCategorySpending(familyId, month, memberId);
  const categories = useExpenseCategories();

  const gastoPorCategoria = new Map<string, number>(
    (consumo.data ?? []).map((c) => [c.categoriaId, c.total]),
  );

  const items: BudgetProgress[] = (budgets.data ?? []).map((b) => {
    const planejado = Number(b.valor_planejado) || 0;
    const gasto = gastoPorCategoria.get(b.category_id ?? "sem-categoria") ?? 0;
    const percentual = planejado > 0 ? (gasto / planejado) * 100 : gasto > 0 ? 100 : 0;
    return {
      id: b.id,
      categoriaId: b.category_id,
      categoria: categories.data?.find((c) => c.id === b.category_id)?.nome ?? "Sem categoria",
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
    dentroDoLimite: items.filter((i) => i.status === "ok"),
    proximosDoLimite: items.filter((i) => i.status === "atencao"),
    acimaDoLimite: items.filter((i) => i.status === "estourado"),
    totalPlanejado,
    totalGasto,
    diferenca: totalPlanejado - totalGasto,
    percentualGeral,
    statusGeral: budgetStatus(percentualGeral),
    isLoading: budgets.isLoading || expenses.isLoading,
  };
}
