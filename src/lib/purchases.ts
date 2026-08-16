import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { generateInstallments } from "@/lib/card-invoices";
import { nextChargeDate, type ExpenseRecurrence } from "@/lib/recurring-expenses";
import type { CreditCard } from "@/lib/finance";


export type Purchase = Database["public"]["Tables"]["purchases"]["Row"];
export type PurchaseInsert = Database["public"]["Tables"]["purchases"]["Insert"];
export type PurchaseItem = Database["public"]["Tables"]["purchase_items"]["Row"];
export type PurchaseItemInsert = Database["public"]["Tables"]["purchase_items"]["Insert"];
export type Product = Database["public"]["Tables"]["products"]["Row"];

export type PurchasePaymentStatus = Database["public"]["Enums"]["purchase_payment_status"];

/** Tipos de compra usados no evento "compra" (origem de toda movimentação financeira). */
export const PURCHASE_KINDS = [
  "COMPRA_NORMAL",
  "COMPRA_RECORRENTE",
  "COMPRA_PARCELADA",
  "CONTA_RECORRENTE",
] as const;

export const PURCHASE_KIND_HINTS: Record<(typeof PURCHASE_KINDS)[number], string> = {
  COMPRA_NORMAL: "Ex.: mercado, farmácia, restaurante",
  COMPRA_RECORRENTE: "Ex.: Netflix, Google Drive",
  COMPRA_PARCELADA: "Ex.: celular em 12x",
  CONTA_RECORRENTE: "Ex.: energia, internet",
};

export const PAYMENT_STATUS_LABELS: Record<PurchasePaymentStatus, string> = {
  PAGO: "Pago",
  COMPROMETIDO: "Comprometido no cartão",
  PENDENTE: "Pendente (boleto)",
  CANCELADO: "Cancelado",
};

export const PAYMENT_STATUS_CLASSES: Record<PurchasePaymentStatus, string> = {
  PAGO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  COMPROMETIDO: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PENDENTE: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  CANCELADO: "bg-muted text-muted-foreground",
};


/** Formas de pagamento que saem direto de uma conta bancária. */
export const BANK_PAYMENT_METHODS = ["PIX", "DEBITO", "TRANSFERENCIA"] as const;

export function usesBankAccount(forma: string) {
  return (BANK_PAYMENT_METHODS as readonly string[]).includes(forma);
}

export const UNIDADES = ["UN", "KG", "G", "L", "ML", "DZ", "PC", "CX"] as const;

export type NewPurchaseItem = {
  product_id: string;
  descricao_produto: string;
  quantidade: string;
  unidade: string;
  valor_unitario: string;
  categoria_id: string;
  /** Categoria sugerida automaticamente (base do aprendizado futuro). */
  categoria_sugerida?: string;
};

export function itemTotal(item: Pick<NewPurchaseItem, "quantidade" | "valor_unitario">) {
  return (Number(item.quantidade) || 0) * (Number(item.valor_unitario) || 0);
}

export function purchaseTotal(items: NewPurchaseItem[]) {
  return items.reduce((acc, i) => acc + itemTotal(i), 0);
}

export async function fetchProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPurchases(familyId: string) {
  const { data, error } = await supabase
    .from("purchases")
    .select("*")
    .eq("family_id", familyId)
    .order("data_compra", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Itens de várias compras de uma vez (usado no filtro por categoria). */
export async function fetchPurchaseItemsByPurchases(purchaseIds: string[]) {
  if (purchaseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("purchase_items")
    .select("purchase_id, categoria_id")
    .in("purchase_id", purchaseIds);
  if (error) throw error;
  return data ?? [];
}

/** Itens completos de várias compras (usado na visão de consumo). */
export async function fetchConsumptionItems(purchaseIds: string[]) {
  if (purchaseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("purchase_items")
    .select("purchase_id, descricao_produto, quantidade, unidade, valor_total, categoria_id")
    .in("purchase_id", purchaseIds);
  if (error) throw error;
  return data ?? [];
}

/** Parcelas geradas para uma compra (via despesa vinculada). */
export async function fetchPurchaseInstallments(purchaseId: string) {
  const { data: expenses, error } = await supabase
    .from("expenses")
    .select("id, parcelas_total, parcela_atual")
    .eq("purchase_id", purchaseId);
  if (error) throw error;
  const ids = (expenses ?? []).map((e) => e.id);
  if (ids.length === 0) return [];
  const { data, error: parcelasError } = await supabase
    .from("expense_installments")
    .select("*")
    .in("expense_id", ids)
    .order("numero_parcela", { ascending: true });
  if (parcelasError) throw parcelasError;
  return data ?? [];
}

/** Tipos de compra que se repetem todo mês. */
export function isRecorrente(tipo: string) {
  return tipo === "COMPRA_RECORRENTE" || tipo === "CONTA_RECORRENTE";
}

/** Próxima cobrança de uma compra recorrente, a partir da data original. */
export function proximaCobranca(dataCompra: string, hoje = new Date()) {
  const [ano, mes, dia] = dataCompra.split("-").map(Number);
  if (!ano || !mes || !dia) return dataCompra;
  const proxima = new Date(Date.UTC(ano, mes - 1, dia));
  const limite = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  while (proxima <= limite) proxima.setUTCMonth(proxima.getUTCMonth() + 1);
  return proxima.toISOString().slice(0, 10);
}

export async function fetchPurchaseItems(purchaseId: string) {
  const { data, error } = await supabase
    .from("purchase_items")
    .select("*")
    .eq("purchase_id", purchaseId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Cria a compra, seus itens e todo o impacto financeiro decorrente:
 * - PIX/débito/transferência: a movimentação de saída e o débito na conta vêm das triggers do banco;
 * - dinheiro: apenas movimentação de saída de caixa (nenhuma conta é afetada);
 * - crédito: gera a despesa vinculada, as parcelas e as faturas do cartão;
 * - recorrente: registra a cobrança recorrente com a próxima competência.
 */
export async function createPurchase(input: {
  purchase: Omit<PurchaseInsert, "valor_total">;
  items: NewPurchaseItem[];
  parcelas?: number;
  periodicidade?: ExpenseRecurrence;
  cards?: CreditCard[];
}) {
  const valorTotal = purchaseTotal(input.items);
  const { data: purchase, error } = await supabase
    .from("purchases")
    .insert({ ...input.purchase, valor_total: valorTotal })
    .select()
    .single();
  if (error) throw error;

  if (input.items.length > 0) {
    const rows: PurchaseItemInsert[] = input.items.map((i) => ({
      purchase_id: purchase.id,
      product_id: i.product_id || null,
      descricao_produto: i.descricao_produto.trim(),
      quantidade: Number(i.quantidade) || 0,
      unidade: i.unidade,
      valor_unitario: Number(i.valor_unitario) || 0,
      valor_total: itemTotal(i),
      categoria_id: i.categoria_id || null,
      categoria_sugerida: i.categoria_sugerida || null,
      categoria_ajustada: !!i.categoria_sugerida && i.categoria_sugerida !== (i.categoria_id || null),
    }));
    const { error: itemsError } = await supabase.from("purchase_items").insert(rows);
    if (itemsError) throw itemsError;
  }

  const parcelas =
    purchase.tipo_compra === "COMPRA_PARCELADA" ? Math.max(1, input.parcelas || 1) : 1;

  // Cartão de crédito: nada sai da conta; vira compromisso na fatura.
  if (purchase.forma_pagamento === "CREDITO" && purchase.credit_card_id) {
    const card = (input.cards ?? []).find((c) => c.id === purchase.credit_card_id);
    if (card) {
      const { data: expense, error: expenseError } = await supabase
        .from("expenses")
        .insert({
          family_id: purchase.family_id,
          member_id: purchase.member_id,
          created_by: purchase.created_by,
          purchase_id: purchase.id,
          descricao: purchase.estabelecimento,
          valor: valorTotal,
          data_compra: purchase.data_compra,
          forma_pagamento: "CREDITO",
          tipo_compra: parcelas > 1 ? "PARCELADO" : "CARTAO_CREDITO",
          cartao_id: card.id,
          parcelas_total: parcelas,
          parcela_atual: 1,
        })
        .select()
        .single();
      if (expenseError) throw expenseError;

      await generateInstallments({
        familyId: purchase.family_id,
        expenseId: expense.id,
        card,
        dataCompra: purchase.data_compra,
        valorTotal,
        parcelas,
      });
    }
  }

  // Compra ou conta recorrente: gera o compromisso mensal (não é parcela).
  if (isRecorrente(purchase.tipo_compra)) {
    const { error: recError } = await supabase.from("recurring_expenses").insert({
      family_id: purchase.family_id,
      member_id: purchase.member_id,
      purchase_id: purchase.id,
      credit_card_id: purchase.credit_card_id,
      bank_account_id: purchase.bank_account_id,
      created_by: purchase.created_by,
      nome: purchase.estabelecimento,
      valor: valorTotal,
      periodicidade: input.periodicidade ?? "MENSAL",
      proxima_cobranca: nextChargeDate(purchase.data_compra, input.periodicidade ?? "MENSAL"),
    });
    if (recError) throw recError;
  }

  return purchase;
}

export async function deletePurchase(id: string) {
  const { error } = await supabase.from("purchases").delete().eq("id", id);
  if (error) throw error;
}

