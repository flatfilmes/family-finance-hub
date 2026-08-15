import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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
};

export const PAYMENT_STATUS_CLASSES: Record<PurchasePaymentStatus, string> = {
  PAGO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  COMPROMETIDO: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PENDENTE: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
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

export async function fetchPurchaseItems(purchaseId: string) {
  const { data, error } = await supabase
    .from("purchase_items")
    .select("*")
    .eq("purchase_id", purchaseId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Cria a compra e seus itens; o valor total é calculado a partir dos produtos. */
export async function createPurchase(input: {
  purchase: Omit<PurchaseInsert, "valor_total">;
  items: NewPurchaseItem[];
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
    }));
    const { error: itemsError } = await supabase.from("purchase_items").insert(rows);
    if (itemsError) throw itemsError;
  }

  return purchase;
}

export async function deletePurchase(id: string) {
  const { error } = await supabase.from("purchases").delete().eq("id", id);
  if (error) throw error;
}
