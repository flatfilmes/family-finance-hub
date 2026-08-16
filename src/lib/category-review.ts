import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { suggestCategoryId, type CategoriaSimples } from "@/lib/category-suggest";

export type CategoryRule = Database["public"]["Tables"]["category_rules"]["Row"];
export type CategoryRuleMatch = Database["public"]["Enums"]["category_rule_match"];

export const MATCH_LABELS: Record<CategoryRuleMatch, string> = {
  EXACT_PRODUCT: "Produto exato",
  PRODUCT_CONTAINS: "Produto contém",
  EXACT_MERCHANT: "Estabelecimento exato",
  MERCHANT_CONTAINS: "Estabelecimento contém",
};

/** Regra mais específica primeiro — genérica nunca sobrescreve específica. */
export const MATCH_PRIORITY: Record<CategoryRuleMatch, number> = {
  EXACT_PRODUCT: 1,
  PRODUCT_CONTAINS: 2,
  EXACT_MERCHANT: 3,
  MERCHANT_CONTAINS: 4,
};

export function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Item de compra pendente de classificação. */
export type PendingItem = {
  kind: "ITEM";
  id: string;
  purchaseId: string;
  descricao: string;
  estabelecimento: string;
  data: string;
  valor: number;
  memberId: string | null;
};

/** Compra sem produtos detalhados e ainda sem categoria própria. */
export type PendingPurchase = {
  kind: "PURCHASE";
  id: string;
  purchaseId: string;
  descricao: string;
  estabelecimento: string;
  data: string;
  valor: number;
  memberId: string | null;
};

export type PendingRow = PendingItem | PendingPurchase;

type PurchaseJoin = {
  id: string;
  estabelecimento: string;
  data_compra: string;
  member_id: string | null;
};

/** Itens de compra da família ainda sem categoria. */
export async function fetchPendingItems(familyId: string): Promise<PendingItem[]> {
  const { data, error } = await supabase
    .from("purchase_items")
    .select(
      "id, purchase_id, descricao_produto, valor_total, purchases!inner(id, estabelecimento, data_compra, member_id, family_id)",
    )
    .is("categoria_id", null)
    .eq("purchases.family_id", familyId)
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const compra = row.purchases as unknown as PurchaseJoin;
    return {
      kind: "ITEM" as const,
      id: row.id,
      purchaseId: row.purchase_id,
      descricao: row.descricao_produto,
      estabelecimento: compra?.estabelecimento ?? "",
      data: compra?.data_compra ?? "",
      valor: Number(row.valor_total) || 0,
      memberId: compra?.member_id ?? null,
    };
  });
}

/** Compras sem itens detalhados e sem categoria direta. */
export async function fetchPendingPurchases(familyId: string): Promise<PendingPurchase[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("id, estabelecimento, data_compra, valor_total, member_id")
    .eq("family_id", familyId)
    .is("categoria_id", null)
    .order("data_compra", { ascending: false })
    .limit(500);
  if (error) throw error;
  const compras = data ?? [];
  if (compras.length === 0) return [];

  const { data: itens, error: itemError } = await supabase
    .from("purchase_items")
    .select("purchase_id")
    .in(
      "purchase_id",
      compras.map((c) => c.id),
    );
  if (itemError) throw itemError;
  const comItens = new Set((itens ?? []).map((i) => i.purchase_id));

  return compras
    .filter((c) => !comItens.has(c.id))
    .map((c) => ({
      kind: "PURCHASE" as const,
      id: c.id,
      purchaseId: c.id,
      descricao: c.estabelecimento,
      estabelecimento: c.estabelecimento,
      data: c.data_compra,
      valor: Number(c.valor_total) || 0,
      memberId: c.member_id ?? null,
    }));
}

/** Só altera categoria — nunca valores, datas ou vínculos financeiros. */
export async function applyItemCategory(itemIds: string[], categoriaId: string) {
  if (itemIds.length === 0) return;
  const { error } = await supabase
    .from("purchase_items")
    .update({ categoria_id: categoriaId, categoria_ajustada: true })
    .in("id", itemIds);
  if (error) throw error;
}

/** Categoria direta da compra (usada quando não há produtos detalhados). */
export async function applyPurchaseCategory(purchaseIds: string[], categoriaId: string) {
  if (purchaseIds.length === 0) return;
  const { error } = await supabase
    .from("purchases")
    .update({ categoria_id: categoriaId })
    .in("id", purchaseIds);
  if (error) throw error;
}

export async function fetchCategoryRules(familyId: string) {
  const { data, error } = await supabase
    .from("category_rules")
    .select("*")
    .eq("family_id", familyId)
    .eq("active", true);
  if (error) throw error;
  return data ?? [];
}

export async function createCategoryRule(input: {
  familyId: string;
  matchType: CategoryRuleMatch;
  matchValue: string;
  categoryId: string;
}) {
  const { error } = await supabase.from("category_rules").upsert(
    {
      family_id: input.familyId,
      match_type: input.matchType,
      match_value: normalizar(input.matchValue),
      category_id: input.categoryId,
      source: "USER",
      priority: MATCH_PRIORITY[input.matchType],
      active: true,
    },
    { onConflict: "family_id,match_type,match_value" },
  );
  if (error) throw error;
}

/** Palavra-chave curta e útil a partir da descrição do produto. */
export function sugerirTermoRegra(descricao: string) {
  const palavras = normalizar(descricao)
    .split(/\s+/)
    .filter((p) => p.length > 3);
  return palavras.slice(0, 2).join(" ") || normalizar(descricao);
}

/** Categoria vinda das regras salvas — a mais específica vence. */
export function matchRule(
  rules: CategoryRule[],
  produto: string,
  estabelecimento: string,
): CategoryRule | null {
  const p = normalizar(produto);
  const m = normalizar(estabelecimento);
  const candidatas = rules.filter((r) => {
    const v = normalizar(r.match_value);
    if (!v) return false;
    if (r.match_type === "EXACT_PRODUCT") return p === v;
    if (r.match_type === "PRODUCT_CONTAINS") return p.includes(v);
    if (r.match_type === "EXACT_MERCHANT") return m === v;
    return m.includes(v);
  });
  if (candidatas.length === 0) return null;
  return candidatas.sort(
    (a, b) =>
      MATCH_PRIORITY[a.match_type] - MATCH_PRIORITY[b.match_type] || a.priority - b.priority,
  )[0]!;
}

/**
 * Sugestão de categoria: regras salvas da família primeiro, depois as
 * palavras-chave determinísticas. A descrição do produto sempre tem
 * prioridade sobre o estabelecimento.
 */
export function sugerirCategoria(
  row: PendingRow,
  rules: CategoryRule[],
  categorias: CategoriaSimples[],
): { categoriaId: string; origem: "REGRA" | "PALAVRA" } | null {
  const regra = matchRule(rules, row.descricao, row.estabelecimento);
  if (regra) return { categoriaId: regra.category_id, origem: "REGRA" };
  const porProduto = suggestCategoryId(row.descricao, categorias);
  if (porProduto) return { categoriaId: porProduto, origem: "PALAVRA" };
  if (row.kind === "PURCHASE") {
    const porLoja = suggestCategoryId(row.estabelecimento, categorias);
    if (porLoja) return { categoriaId: porLoja, origem: "PALAVRA" };
  }
  return null;
}
