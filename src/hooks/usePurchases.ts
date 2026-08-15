import { useQuery } from "@tanstack/react-query";
import {
  fetchConsumptionItems,
  fetchProducts,
  fetchPurchaseInstallments,
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

/** Parcelas de uma compra parcelada. */
export function usePurchaseInstallments(purchaseId?: string) {
  return useQuery({
    queryKey: ["purchase-installments", purchaseId],
    queryFn: () => fetchPurchaseInstallments(purchaseId!),
    enabled: !!purchaseId,
  });
}

/** Itens detalhados das compras filtradas, base da visão de consumo. */
export function useConsumptionItems(purchaseIds: string[]) {
  const key = purchaseIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["purchase-consumption", key],
    queryFn: () => fetchConsumptionItems(purchaseIds),
    enabled: purchaseIds.length > 0,
  });
}
