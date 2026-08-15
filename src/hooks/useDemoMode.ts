import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteDemoData, fetchDemoFamilies, fetchDemoSettings } from "@/lib/demo";
import { useFamily } from "@/hooks/useFamilyData";

/** Estado do Modo Demonstração: famílias demo existentes, controle ativo e se a família atual é demo. */
export function useDemoMode() {
  const { data: family } = useFamily();

  const families = useQuery({ queryKey: ["demo-families"], queryFn: fetchDemoFamilies });
  const settings = useQuery({ queryKey: ["demo-settings"], queryFn: fetchDemoSettings });

  const demoFamilies = families.data ?? [];
  const rows = settings.data ?? [];
  const activeRow = rows.find((r) => r.ativo) ?? null;
  const activeFamily =
    demoFamilies.find((f) => f.id === activeRow?.family_id) ?? demoFamilies[0] ?? null;

  return {
    isLoading: families.isLoading || settings.isLoading,
    demoFamilies,
    demoSettings: rows,
    activeFamily,
    ativo: !!activeFamily,
    currentIsDemo: !!family?.is_demo,
  };
}

/** Exclusão segura dos dados de demonstração. */
export function useDeleteDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDemoData,
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
