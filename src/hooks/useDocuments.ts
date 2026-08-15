import { useQuery } from "@tanstack/react-query";
import { fetchDocuments, fetchImportItems, fetchPurchaseImports } from "@/lib/documents";

export function useDocuments(familyId?: string) {
  return useQuery({
    queryKey: ["documents", familyId],
    queryFn: () => fetchDocuments(familyId!),
    enabled: !!familyId,
  });
}

export function usePurchaseImports(familyId?: string) {
  return useQuery({
    queryKey: ["purchase-imports", familyId],
    queryFn: () => fetchPurchaseImports(familyId!),
    enabled: !!familyId,
  });
}

export function useImportItems(importId?: string) {
  return useQuery({
    queryKey: ["purchase-import-items", importId],
    queryFn: () => fetchImportItems(importId!),
    enabled: !!importId,
  });
}
