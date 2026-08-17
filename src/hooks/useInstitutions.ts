import { useQuery } from "@tanstack/react-query";
import { fetchFinancialInstitutions } from "@/lib/institutions";

/** Registry oficial de instituições — somente leitura para o usuário. */
export function useInstitutions() {
  return useQuery({
    queryKey: ["financial-institutions"],
    queryFn: fetchFinancialInstitutions,
    staleTime: 1000 * 60 * 60,
  });
}
