import { useQuery } from "@tanstack/react-query";
import {
  currentMonth,
  fetchExpenseCategories,
  fetchExpenses,
  previousMonth,
  type ExpenseFilters,
} from "@/lib/expenses";

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: fetchExpenseCategories,
    staleTime: 1000 * 60 * 60,
  });
}

export function useExpenses(familyId?: string, filters: ExpenseFilters = {}) {
  return useQuery({
    queryKey: [
      "expenses",
      familyId,
      filters.month ?? null,
      filters.categoriaId ?? null,
      filters.memberId ?? null,
      filters.cartaoId ?? null,
    ],
    queryFn: () => fetchExpenses(familyId!, filters),
    enabled: !!familyId,
  });
}

/** Resumo de gastos reais do mês corrente e comparação com o mês anterior. */
export function useExpenseSummary(familyId?: string, memberId = "") {
  const month = currentMonth();
  const prev = previousMonth(month);
  const scope = memberId ? { memberId } : {};
  const atual = useExpenses(familyId, { month, ...scope });
  const anterior = useExpenses(familyId, { month: prev, ...scope });
  const categories = useExpenseCategories();

  const sum = (rows?: { valor: number | string }[]) =>
    (rows ?? []).reduce((acc, r) => acc + (Number(r.valor) || 0), 0);

  const totalMes = sum(atual.data);
  const totalAnterior = sum(anterior.data);

  const porCategoria = new Map<string, number>();
  for (const e of atual.data ?? []) {
    const key = e.categoria_id ?? "sem-categoria";
    porCategoria.set(key, (porCategoria.get(key) ?? 0) + (Number(e.valor) || 0));
  }
  let maiorCategoria: { nome: string; valor: number } | null = null;
  for (const [id, valor] of porCategoria) {
    if (!maiorCategoria || valor > maiorCategoria.valor) {
      const nome = categories.data?.find((c) => c.id === id)?.nome ?? "Sem categoria";
      maiorCategoria = { nome, valor };
    }
  }

  const variacao = totalAnterior > 0 ? ((totalMes - totalAnterior) / totalAnterior) * 100 : null;

  return {
    isLoading: atual.isLoading || anterior.isLoading,
    month,
    totalMes,
    totalAnterior,
    diferenca: totalMes - totalAnterior,
    variacao,
    maiorCategoria,
    count: atual.data?.length ?? 0,
  };
}
