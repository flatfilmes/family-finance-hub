import { useQuery } from "@tanstack/react-query";
import { fetchBankBalanceCheckpoints } from "@/lib/bank-statements/data";

/** Saldos diários informados pelo banco (conferência do extrato importado). */
export function useBankBalanceCheckpoints(accountId?: string) {
  return useQuery({
    queryKey: ["bank-balance-checkpoints", accountId],
    queryFn: () => fetchBankBalanceCheckpoints(accountId!),
    enabled: !!accountId,
  });
}
