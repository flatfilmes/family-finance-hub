import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type DemoSettings = Database["public"]["Tables"]["demo_settings"]["Row"];
export type Family = Database["public"]["Tables"]["families"]["Row"];

export const DEMO_DELETE_CONFIRMATION =
  "Todos os dados demonstrativos serão removidos. Essa ação não afeta seus dados reais.";

/** Famílias marcadas como demonstração (is_demo = true) visíveis para o usuário. */
export async function fetchDemoFamilies(): Promise<Family[]> {
  const { data, error } = await supabase
    .from("families")
    .select("*")
    .eq("is_demo", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Controle de demonstração ativo (uma linha por família demo). */
export async function fetchDemoSettings(): Promise<DemoSettings[]> {
  const { data, error } = await supabase
    .from("demo_settings")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Remove todos os dados das famílias demo que o usuário administra. Retorna quantas famílias saíram. */
export async function deleteDemoData(): Promise<number> {
  const { data, error } = await supabase.rpc("delete_demo_data");
  if (error) throw error;
  return (data as number) ?? 0;
}

export function isDemo(family?: { is_demo?: boolean | null } | null) {
  return !!family?.is_demo;
}
