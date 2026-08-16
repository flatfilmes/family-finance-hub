import { useQuery } from "@tanstack/react-query";
import { fetchBankStatementImports, fetchBankStatementItemsByAccount } from "@/lib/bank-statements";

export function useBankStatementImports(accountId?: string) {
  return useQuery({
    queryKey: ["bank-statement-imports", accountId],
    queryFn: () => fetchBankStatementImports(accountId!),
    enabled: !!accountId,
  });
}

/** Lançamentos lidos dos PDFs desta conta — evidência do documento na auditoria. */
export function useBankStatementItems(accountId?: string) {
  return useQuery({
    queryKey: ["bank-statement-items", accountId],
    queryFn: () => fetchBankStatementItemsByAccount(accountId!),
    enabled: !!accountId,
  });
}
