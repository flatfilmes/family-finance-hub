import { useQuery } from "@tanstack/react-query";
import { currentMonth, previousMonth } from "@/lib/expenses";
import { fetchCategorySpending, SEM_CATEGORIA } from "@/lib/spending-categories";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { useMonthlySpending } from "@/hooks/useMonthlySpending";
import { usePurchases } from "@/hooks/usePurchases";
import { filterByMember } from "@/components/member-filter";

/** Consumo por categoria da competência (purchases + purchase_items). */
export function useCategorySpending(familyId?: string, month?: string, memberId = "") {
  const mes = month ?? currentMonth();
  return useQuery({
    queryKey: ["category-spending", familyId, mes, memberId || null],
    queryFn: () => fetchCategorySpending(familyId!, mes, memberId),
    enabled: !!familyId,
  });
}

/**
 * Resumo oficial de gastos do Dashboard.
 * Fonte única: purchases (via useMonthlySpending) — nunca a tabela legada `expenses`.
 * A comparação mensal usa exatamente o mesmo motor do card "Gastos do mês".
 */
export function useSpendingSummary(familyId?: string, memberId = "") {
  const month = currentMonth();
  const prev = previousMonth(month);

  const atual = useMonthlySpending(familyId, memberId, month);
  const anterior = useMonthlySpending(familyId, memberId, prev);
  const categorias = useCategorySpending(familyId, month, memberId);
  const catalogo = useExpenseCategories();
  const purchases = usePurchases(familyId);

  const totalMes = atual.total;
  const totalAnterior = anterior.total;

  const top = (categorias.data ?? [])[0];
  const maiorCategoria = top
    ? {
        nome:
          top.categoriaId === SEM_CATEGORIA
            ? "Sem categoria"
            : (catalogo.data?.find((c) => c.id === top.categoriaId)?.nome ?? "Sem categoria"),
        valor: top.total,
      }
    : null;

  const count = filterByMember(purchases.data ?? [], memberId).filter(
    (p) => p.status_pagamento !== "CANCELADO" && p.data_compra.slice(0, 7) === month,
  ).length;

  const variacao = totalAnterior > 0 ? ((totalMes - totalAnterior) / totalAnterior) * 100 : null;

  return {
    isLoading: atual.isLoading || anterior.isLoading,
    month,
    totalMes,
    totalAnterior,
    diferenca: totalMes - totalAnterior,
    variacao,
    maiorCategoria,
    count,
  };
}
