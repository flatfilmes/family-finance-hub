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

export type BankAccountUpdate = Database["public"]["Tables"]["bank_accounts"]["Update"];

/** Atualiza dados cadastrais da conta. O saldo nunca é alterado por aqui. */
export async function updateBankAccount(id: string, input: BankAccountUpdate) {
  const { saldo_atual: _ignored, ...cadastrais } = input;
  const { error } = await supabase.from("bank_accounts").update(cadastrais).eq("id", id);
  if (error) throw error;
}

/** Arquiva/reativa a conta preservando todo o histórico financeiro. */
export async function archiveBankAccount(id: string, ativo: boolean) {
  const { error } = await supabase.rpc("archive_bank_account", { _account_id: id, _ativo: ativo });
  if (error) throw error;
}

/** Exclui a conta somente quando não existe nenhuma movimentação vinculada. */
export async function deleteBankAccountIfUnused(id: string) {
  const { error } = await supabase.rpc("delete_bank_account_if_unused", { _account_id: id });
  if (error) throw error;
}

/**
 * Corrige o saldo da conta gerando um lançamento auditável de ajuste
 * com a diferença entre o saldo do sistema e o saldo informado.
 */
export async function adjustBankAccountBalance(input: {
  accountId: string;
  novoSaldo: number;
  motivo?: string;
}) {
  const { data, error } = await supabase.rpc("adjust_bank_account_balance", {
    _account_id: input.accountId,
    _novo_saldo: input.novoSaldo,
    ...(input.motivo ? { _motivo: input.motivo } : {}),
  });
  if (error) throw error;
  return data as string;
}

/**
 * Estabelece a posição da conta a partir do saldo informado pelo titular.
 * Na primeira vez gera ABERTURA_SALDO; depois gera AJUSTE_SALDO com a diferença.
 * Nunca é receita nem gasto: é apenas a posição patrimonial da conta.
 */
export async function setBankAccountBalance(input: {
  accountId: string;
  saldo: number;
  data?: string;
  motivo?: string;
}) {
  const { data, error } = await supabase.rpc("set_bank_account_balance", {
    _account_id: input.accountId,
    _saldo: input.saldo,
    ...(input.data ? { _data: input.data } : {}),
    ...(input.motivo ? { _motivo: input.motivo } : {}),
  });
  if (error) throw error;
  return data as string;
}
