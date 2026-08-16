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
  AJUSTE_SALDO: "Ajuste de saldo",
  ABERTURA_SALDO: "Abertura de saldo",
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

/**
 * Transferência entre contas da mesma família.
 * Operação atômica no banco: debita a origem, credita o destino e registra
 * as duas movimentações ligadas pelo mesmo `transfer_group_id`.
 * Transferência interna não é gasto nem receita da família.
 */
export async function transferBetweenAccounts(input: {
  origemId: string;
  destinoId: string;
  valor: number;
  data?: string;
  descricao?: string;
}) {
  const { data, error } = await supabase.rpc("transfer_between_accounts", {
    _origem_id: input.origemId,
    _destino_id: input.destinoId,
    _valor: input.valor,
    ...(input.data ? { _data: input.data } : {}),
    ...(input.descricao ? { _descricao: input.descricao } : {}),
  });
  if (error) throw error;
  return data as string;
}
