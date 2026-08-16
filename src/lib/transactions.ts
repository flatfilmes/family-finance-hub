import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { TONE_CLASSES, TRANSACTION_STATUS_TONES } from "@/lib/status";

export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
export type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
export type TransactionType = Database["public"]["Enums"]["transaction_type"];
export type TransactionStatus = Database["public"]["Enums"]["transaction_status"];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  TRANSFERENCIA: "Transferência",
  PAGAMENTO_CARTAO: "Pagamento de cartão",
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  CONFIRMADA: "Confirmada",
  PENDENTE: "Pendente",
  CANCELADA: "Cancelada",
};

/** Cores derivadas da linguagem única de status (src/lib/status.ts). */
export const TRANSACTION_STATUS_CLASSES: Record<TransactionStatus, string> = Object.fromEntries(
  (Object.keys(TRANSACTION_STATUS_TONES) as TransactionStatus[]).map((s) => [
    s,
    TONE_CLASSES[TRANSACTION_STATUS_TONES[s]],
  ]),
) as Record<TransactionStatus, string>;

export async function fetchTransactions(familyId: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("family_id", familyId)
    .order("data_movimento", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Paga uma fatura debitando a conta bancária escolhida e registrando a movimentação. */
export async function payCardInvoice(input: {
  invoiceId: string;
  bankAccountId: string;
  data?: string;
}) {
  const { data, error } = await supabase.rpc("pay_card_invoice", {
    _invoice_id: input.invoiceId,
    _bank_account_id: input.bankAccountId,
    ...(input.data ? { _data: input.data } : {}),
  });
  if (error) throw error;
  return data as string;
}
