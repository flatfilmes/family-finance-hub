/**
 * Registry oficial de instituições financeiras (fonte controlada no banco).
 *
 * `code` é identidade estrutural e machine-readable. Nome de exibição da conta
 * ou do cartão é apresentação e NUNCA participa da seleção de parser.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { InstitutionCode } from "@/lib/document-parsers/types";

export type FinancialInstitution =
  Database["public"]["Tables"]["financial_institutions"]["Row"];

export const CARD_BRANDS = ["MASTERCARD", "VISA", "ELO", "AMEX", "HIPERCARD"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  MASTERCARD: "Mastercard",
  VISA: "Visa",
  ELO: "Elo",
  AMEX: "American Express",
  HIPERCARD: "Hipercard",
};

export async function fetchFinancialInstitutions() {
  const { data, error } = await supabase
    .from("financial_institutions")
    .select("*")
    .eq("active", true)
    .order("official_name");
  if (error) throw error;
  return data ?? [];
}

/** Código oficial a partir do id — única entrada válida do roteador de parser. */
export function institutionCodeById(
  institutions: FinancialInstitution[] | undefined,
  id: string | null | undefined,
): InstitutionCode | null {
  if (!id) return null;
  const found = institutions?.find((i) => i.id === id);
  return (found?.code as InstitutionCode | undefined) ?? null;
}

export function institutionShortName(
  institutions: FinancialInstitution[] | undefined,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const found = institutions?.find((i) => i.id === id);
  return found ? (found.short_name ?? found.official_name) : null;
}

/** Linha secundária do cartão: emissor · bandeira · final (apresentação apenas). */
export function cardSubtitle(card: {
  banco: string;
  bandeira?: string | null;
  final_cartao?: string | null;
}) {
  const brand = card.bandeira
    ? (CARD_BRAND_LABELS[card.bandeira as CardBrand] ?? card.bandeira)
    : null;
  return [card.banco, brand, card.final_cartao ? `•••• ${card.final_cartao}` : null]
    .filter(Boolean)
    .join(" · ");
}
