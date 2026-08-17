/**
 * Tradução do que JÁ existe no sistema para o modelo comparável da engine.
 *
 * Purchases = evento econômico. Transactions = efeito bancário.
 * Os dois entram na comparação, mas continuam sendo coisas diferentes.
 */
import type { Purchase } from "@/lib/purchases";
import type { Transaction } from "@/lib/transactions";
import type { CandidateDirection, ExistingEconomicRecord } from "./types";

export function purchasesToRecords(purchases: Purchase[]): ExistingEconomicRecord[] {
  return purchases.map((p) => ({
    kind: "PURCHASE" as const,
    id: p.id,
    date: p.data_pagamento_real ?? p.data_compra,
    amount: Math.abs(Number(p.valor_total)),
    direction: "OUT" as CandidateDirection,
    description: p.estabelecimento,
    creditCardId: p.credit_card_id,
    bankAccountId: p.bank_account_id,
  }));
}

export function transactionsToRecords(transactions: Transaction[]): ExistingEconomicRecord[] {
  return transactions
    .filter((t) => t.status !== "CANCELADA")
    .map((t) => ({
      kind: "TRANSACTION" as const,
      id: t.id,
      date: t.data_movimento,
      amount: Math.abs(Number(t.valor)),
      direction: (t.tipo === "ENTRADA" ? "IN" : "OUT") as CandidateDirection,
      description: t.descricao,
      bankAccountId: t.bank_account_id,
    }));
}

export type EvidenceItemRecordLike = {
  id: string;
  event_date: string | null;
  posting_date: string | null;
  amount: number | string;
  direction: string | null;
  description: string;
  card_last4: string | null;
  source_item_key: string;
  evidence_import_id: string;
  matched_purchase_id: string | null;
  matched_transaction_id: string | null;
};

/** Itens de evidências anteriores — garantem idempotência por linhagem. */
export function evidenceItemsToRecords(itens: EvidenceItemRecordLike[]): ExistingEconomicRecord[] {
  return itens.map((i) => ({
    kind: "EVIDENCE_ITEM" as const,
    id: i.matched_purchase_id ?? i.matched_transaction_id ?? i.id,
    date: i.event_date ?? i.posting_date,
    amount: Math.abs(Number(i.amount)),
    direction: (i.direction === "IN" ? "IN" : "OUT") as CandidateDirection,
    description: i.description,
    cardLast4: i.card_last4,
    lineageEvidenceIds: [i.evidence_import_id],
    lineageItemKeys: [i.source_item_key],
  }));
}
