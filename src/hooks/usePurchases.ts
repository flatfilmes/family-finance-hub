import { useQuery } from "@tanstack/react-query";
import {
  fetchProducts,
  fetchPurchaseItems,
  fetchPurchaseItemsByPurchases,
  fetchPurchases,
} from "@/lib/purchases";

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

/** Categorias dos itens de um conjunto de compras, para filtrar o histórico. */
export function usePurchaseItemCategories(purchaseIds: string[]) {
  const key = purchaseIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["purchase-item-categories", key],
    queryFn: () => fetchPurchaseItemsByPurchases(purchaseIds),
    enabled: purchaseIds.length > 0,
  });
}
