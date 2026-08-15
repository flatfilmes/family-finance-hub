import { useQuery } from "@tanstack/react-query";
import { fetchBankAccounts } from "@/lib/bank-accounts";

export function useBankAccounts(familyId?: string) {
  return useQuery({
    queryKey: ["bank-accounts", familyId],
    queryFn: () => fetchBankAccounts(familyId!),
    enabled: !!familyId,
  });
}
