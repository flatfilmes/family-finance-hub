import { useQuery } from "@tanstack/react-query";
import { fetchProducts, fetchPurchaseItems, fetchPurchases } from "@/lib/purchases";

export function useProducts() {
  return useQuery({ queryKey: ["products"], queryFn: fetchProducts });
}

export function usePurchases(familyId?: string) {
  return useQuery({
    queryKey: ["purchases", familyId],
    queryFn: () => fetchPurchases(familyId!),
    enabled: !!familyId,
  });
}

export function usePurchaseItems(purchaseId?: string) {
  return useQuery({
    queryKey: ["purchase-items", purchaseId],
    queryFn: () => fetchPurchaseItems(purchaseId!),
    enabled: !!purchaseId,
  });
}
