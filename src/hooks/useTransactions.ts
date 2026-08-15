import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTransactions, payCardInvoice } from "@/lib/transactions";

export function useTransactions(familyId?: string) {
  return useQuery({
    queryKey: ["transactions", familyId],
    queryFn: () => fetchTransactions(familyId!),
    enabled: !!familyId,
  });
}

/** Pagamento de fatura: debita a conta, quita as parcelas e registra a movimentação. */
export function usePayCardInvoice(familyId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: payCardInvoice,
    onSuccess: () => {
      for (const key of [
        "transactions",
        "card-invoices",
        "expense-installments",
        "bank-accounts",
      ]) {
        void qc.invalidateQueries({ queryKey: [key, familyId] });
      }
    },
  });
}
