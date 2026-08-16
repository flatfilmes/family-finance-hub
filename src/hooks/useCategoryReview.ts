import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyItemCategory,
  applyPurchaseCategory,
  createCategoryRule,
  fetchCategoryRules,
  fetchPendingItems,
  fetchPendingPurchases,
  type CategoryRuleMatch,
} from "@/lib/category-review";

export function usePendingCategoryItems(familyId?: string) {
  return useQuery({
    queryKey: ["pending-category-items", familyId],
    queryFn: () => fetchPendingItems(familyId!),
    enabled: !!familyId,
  });
}

export function usePendingCategoryPurchases(familyId?: string) {
  return useQuery({
    queryKey: ["pending-category-purchases", familyId],
    queryFn: () => fetchPendingPurchases(familyId!),
    enabled: !!familyId,
  });
}

export function useCategoryRules(familyId?: string) {
  return useQuery({
    queryKey: ["category-rules", familyId],
    queryFn: () => fetchCategoryRules(familyId!),
    enabled: !!familyId,
  });
}

/** Aplica a categoria a itens e/ou compras e atualiza o Dashboard. */
export function useApplyCategory(familyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      itemIds?: string[];
      purchaseIds?: string[];
      categoriaId: string;
    }) => {
      await applyItemCategory(input.itemIds ?? [], input.categoriaId);
      await applyPurchaseCategory(input.purchaseIds ?? [], input.categoriaId);
    },
    onSuccess: () => {
      for (const key of [
        ["pending-category-items", familyId],
        ["pending-category-purchases", familyId],
        ["purchase-item-categories"],
        ["purchase-items"],
        ["purchase-consumption"],
        ["purchases", familyId],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useCreateCategoryRule(familyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      matchType: CategoryRuleMatch;
      matchValue: string;
      categoryId: string;
    }) => createCategoryRule({ familyId: familyId!, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["category-rules", familyId] });
    },
  });
}
