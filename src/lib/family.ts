import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Family = Database["public"]["Tables"]["families"]["Row"];
export type FamilyMember = Database["public"]["Tables"]["family_members"]["Row"];
export type FinancialProfile = Database["public"]["Tables"]["financial_profiles"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type FamilyPermission = Database["public"]["Enums"]["family_permission"];
export type FinancialGoal = Database["public"]["Enums"]["financial_goal"];

export const PERMISSION_LABELS: Record<FamilyPermission, string> = {
  ADMIN: "Administrador",
  MEMBER: "Membro",
  VIEWER: "Visualizador",
};

export const PERMISSION_DESCRIPTIONS: Record<FamilyPermission, string> = {
  ADMIN: "Pode alterar tudo na família.",
  MEMBER: "Pode adicionar informações e visualizar.",
  VIEWER: "Somente visualização.",
};

export const GOAL_LABELS: Record<FinancialGoal, string> = {
  organizar_financas: "Organizar as finanças",
  sair_de_dividas: "Sair das dívidas",
  economizar: "Economizar todo mês",
  comprar_bem: "Comprar um bem",
  investir: "Começar a investir",
};

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchMyFamily() {
  const { data: families, error } = await supabase
    .from("families")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return families?.[0] ?? null;
}

export async function fetchMembers(familyId: string) {
  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchFinancialProfile(familyId: string) {
  const { data, error } = await supabase
    .from("financial_profiles")
    .select("*")
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createFamily(input: { nome: string; ownerId: string; ownerNome: string }) {
  const { data: family, error } = await supabase
    .from("families")
    .insert({ nome_da_familia: input.nome, owner_id: input.ownerId })
    .select()
    .single();
  if (error) throw error;

  const { error: memberError } = await supabase.from("family_members").insert({
    family_id: family.id,
    user_id: input.ownerId,
    nome: input.ownerNome || "Responsável",
    relacionamento: "Responsável",
    permissao: "ADMIN",
  });
  if (memberError) throw memberError;

  return family;
}
