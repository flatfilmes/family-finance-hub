import { usePurchases } from "@/hooks/usePurchases";
import { useInstallments } from "@/hooks/useCardInvoices";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { useFixedExpenses } from "@/hooks/useFinanceData";
import { filterByMember } from "@/components/member-filter";
import { currentMonth } from "@/lib/expenses";
import { buildSpendingBreakdown } from "@/lib/monthly-spending";

/**
 * Gasto real da competência (mês), com composição auditável.
 * Compras parceladas entram pela parcela do mês, nunca pelo valor total.
 */
export function useMonthlySpending(familyId?: string, memberId = "", month = currentMonth()) {
  const purchases = usePurchases(familyId);
  const installments = useInstallments(familyId);
  const recurring = useRecurringExpenses(familyId);
  const fixed = useFixedExpenses(familyId);

  const breakdown = buildSpendingBreakdown({
    month,
    purchases: filterByMember(purchases.data ?? [], memberId),
    installments: filterByMember(
      (installments.data ?? []).map((i) => ({ ...i, member_id: i.member_id ?? null })),
      memberId,
    ),
    recurring: filterByMember(recurring.data ?? [], memberId),
    fixed: filterByMember(fixed.data ?? [], memberId),
  });

  return {
    ...breakdown,
    isLoading:
      purchases.isLoading || installments.isLoading || recurring.isLoading || fixed.isLoading,
  };
}
