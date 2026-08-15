import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type MemberFinancialProfile =
  Database["public"]["Tables"]["member_financial_profiles"]["Row"];
export type MemberProfileType = Database["public"]["Enums"]["member_profile_type"];

export const MEMBER_PROFILE_LABELS: Record<MemberProfileType, string> = {
  ADMIN_FAMILIAR: "Administrador familiar",
  MEMBRO: "Membro",
  DEPENDENTE: "Dependente",
  VISUALIZADOR: "Visualizador",
};

export const MEMBER_PROFILE_DESCRIPTIONS: Record<MemberProfileType, string> = {
  ADMIN_FAMILIAR:
    "Vê todos os dados da família, gerencia membros, receitas, gastos e configurações.",
  MEMBRO: "Vê os próprios dados e cadastra as próprias receitas, compras e gastos.",
  DEPENDENTE: "Tem gastos vinculados e cartão adicional, com acompanhamento do administrador.",
  VISUALIZADOR: "Somente leitura.",
};

export const MEMBER_PROFILE_TYPES: MemberProfileType[] = [
  "ADMIN_FAMILIAR",
  "MEMBRO",
  "DEPENDENTE",
  "VISUALIZADOR",
];

export async function fetchMemberProfiles(familyId: string) {
  const { data, error } = await supabase
    .from("member_financial_profiles")
    .select("*")
    .eq("family_id", familyId);
  if (error) throw error;
  return data ?? [];
}

export async function upsertMemberProfile(input: {
  familyId: string;
  familyMemberId: string;
  tipoPerfil: MemberProfileType;
  podeLancarDespesas: boolean;
  podeVerPropriosDados: boolean;
}) {
  const { error } = await supabase
    .from("member_financial_profiles")
    .upsert(
      {
        family_id: input.familyId,
        family_member_id: input.familyMemberId,
        tipo_perfil: input.tipoPerfil,
        pode_lancar_despesas: input.podeLancarDespesas,
        pode_ver_proprios_dados: input.podeVerPropriosDados,
      },
      { onConflict: "family_member_id" },
    );
  if (error) throw error;
}
