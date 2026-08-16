import { useQuery } from "@tanstack/react-query";
import { fetchBankStatementImports } from "@/lib/bank-statements";

export function useBankStatementImports(accountId?: string) {
  return useQuery({
    queryKey: ["bank-statement-imports", accountId],
    queryFn: () => fetchBankStatementImports(accountId!),
    enabled: !!accountId,
  });
}
