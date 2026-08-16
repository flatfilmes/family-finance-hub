import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchConsumptionItems,
  fetchInstallmentsByPurchases,
  fetchProducts,
  fetchPurchaseInstallments,
  fetchPurchaseItems,
  fetchPurchaseItemsByPurchases,
  fetchPurchases,
  updatePurchaseItemCategory,
} from "@/lib/purchases";

/** Parcelas de um conjunto de compras, para exibir a parcela do período na lista. */
export function usePurchaseInstallmentsByPurchases(purchaseIds: string[]) {
  const key = purchaseIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["purchase-installments-summary", key],
    queryFn: () => fetchInstallmentsByPurchases(purchaseIds),
    enabled: purchaseIds.length > 0,
  });
}


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

/** Altera somente a categoria de um item de compra já confirmada. */
export function useUpdatePurchaseItemCategory(purchaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePurchaseItemCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-items", purchaseId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-consumption"] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-item-categories"] });
    },
  });
}
