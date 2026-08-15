import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  advanceRecurringExpense,
  deleteRecurringExpense,
  fetchRecurringExpenses,
  toggleRecurringExpense,
  type RecurringExpense,
} from "@/lib/recurring-expenses";

export function useRecurringExpenses(familyId?: string) {
  return useQuery({
    queryKey: ["recurring-expenses", familyId],
    queryFn: () => fetchRecurringExpenses(familyId!),
    enabled: !!familyId,
  });
}

export function useRecurringExpenseActions(familyId?: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["recurring-expenses", familyId] });

  const toggle = useMutation({
    mutationFn: (input: { id: string; ativo: boolean }) =>
      toggleRecurringExpense(input.id, input.ativo),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: deleteRecurringExpense,
    onSuccess: invalidate,
  });

  const advance = useMutation({
    mutationFn: (r: RecurringExpense) => advanceRecurringExpense(r),
    onSuccess: invalidate,
  });

  return { toggle, remove, advance };
}
