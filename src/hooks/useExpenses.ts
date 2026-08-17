import { useQuery } from "@tanstack/react-query";
import {
  fetchExpenseCategories,
} from "@/lib/expenses";

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: fetchExpenseCategories,
    staleTime: 1000 * 60 * 60,
  });
}
