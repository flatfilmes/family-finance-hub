import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type BankAccount = Database["public"]["Tables"]["bank_accounts"]["Row"];
export type BankAccountInsert = Database["public"]["Tables"]["bank_accounts"]["Insert"];
export type BankAccountType = Database["public"]["Enums"]["bank_account_type"];

export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  CORRENTE: "Conta corrente",
  POUPANCA: "Poupança",
  PAGAMENTO: "Conta de pagamento",
  INVESTIMENTO: "Investimento",
};

export const BANK_ACCOUNT_TYPES: BankAccountType[] = [
  "CORRENTE",
  "POUPANCA",
  "PAGAMENTO",
  "INVESTIMENTO",
];

export async function fetchBankAccounts(familyId: string) {
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createBankAccount(input: BankAccountInsert) {
  const { data, error } = await supabase.from("bank_accounts").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateBankAccountBalance(id: string, saldo: number) {
  const { error } = await supabase.from("bank_accounts").update({ saldo_atual: saldo }).eq("id", id);
  if (error) throw error;
}

export async function toggleBankAccount(id: string, ativo: boolean) {
  const { error } = await supabase.from("bank_accounts").update({ ativo }).eq("id", id);
  if (error) throw error;
}

export async function deleteBankAccount(id: string) {
  const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
  if (error) throw error;
}
