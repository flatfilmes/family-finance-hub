import { useMutation, useQueryClient } from "@tanstack/react-query";
import { registerBankMovement, reverseBankTransaction } from "@/lib/bank-movements";

function useLedgerInvalidation(familyId?: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of ["transactions", "bank-accounts"]) {
      void qc.invalidateQueries({ queryKey: [key, familyId] });
    }
  };
}

/** Depósito ou retirada manual: afeta apenas o saldo da conta, nunca receita/despesa. */
export function useRegisterBankMovement(familyId?: string) {
  const invalidate = useLedgerInvalidation(familyId);
  return useMutation({ mutationFn: registerBankMovement, onSuccess: invalidate });
}

/** Estorno auditável de uma movimentação (transferências revertem os dois lados). */
export function useReverseBankTransaction(familyId?: string) {
  const invalidate = useLedgerInvalidation(familyId);
  return useMutation({ mutationFn: reverseBankTransaction, onSuccess: invalidate });
}
