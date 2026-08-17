import { supabase } from "@/integrations/supabase/client";
import { PAYMENT_STATUS_TONES, TONE_CLASSES } from "@/lib/status";
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
export type PaymentMethodValue = Database["public"]["Enums"]["payment_method"];

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
  PENDENTE_PAGAMENTO: "Pendente",
  PARCIALMENTE_PAGA: "Parcialmente paga",
  CANCELADO: "Cancelado",
};

/**
 * Rótulos curtos usados nas listagens (desktop, tablet e celular).
 * Apenas apresentação — o significado financeiro continua o mesmo:
 * "Cartão" segue sendo um compromisso até o pagamento da fatura.
 */
export const PAYMENT_STATUS_SHORT: Record<PurchasePaymentStatus, string> = {
  PAGO: "Pago",
  COMPROMETIDO: "Cartão",
  PENDENTE: "Boleto",
  PENDENTE_PAGAMENTO: "Pendente",
  PARCIALMENTE_PAGA: "Parcial",
  CANCELADO: "Cancelado",
};

/** Formas de pagamento em 1 ou 2 palavras, para os badges da lista. */
export const PAYMENT_METHOD_SHORT: Record<PaymentMethodValue, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  DEBITO: "Débito",
  CREDITO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
  A_DEFINIR: "A definir",
};

/** Cores derivadas da linguagem única de status (src/lib/status.ts). */
export const PAYMENT_STATUS_CLASSES: Record<PurchasePaymentStatus, string> = Object.fromEntries(
  (Object.keys(PAYMENT_STATUS_TONES) as PurchasePaymentStatus[]).map((s) => [
    s,
    TONE_CLASSES[PAYMENT_STATUS_TONES[s]],
  ]),
) as Record<PurchasePaymentStatus, string>;

/** Forma "pagar depois": a compra existe, o pagamento ainda não. */
export const PAGAR_DEPOIS = "A_DEFINIR" as const;

/** Formas de pagamento realmente selecionáveis ao registrar um pagamento. */
export const PAYMENT_METHODS_REAIS = [
  "PIX",
  "DINHEIRO",
  "DEBITO",
  "CREDITO",
  "BOLETO",
  "TRANSFERENCIA",
  "OUTRO",
] as const;

/** Compra registrada sem pagamento realizado. */
export function isPendentePagamento(p: Pick<Purchase, "status_pagamento">) {
  return p.status_pagamento === "PENDENTE_PAGAMENTO" || p.status_pagamento === "PARCIALMENTE_PAGA";
}

/** Pendente cuja data prevista de pagamento já passou. */
export function isAtrasada(
  p: Pick<Purchase, "status_pagamento" | "data_prevista_pagamento">,
  hoje = new Date().toISOString().slice(0, 10),
) {
  return isPendentePagamento(p) && !!p.data_prevista_pagamento && p.data_prevista_pagamento < hoje;
}

/** Filtro de status usado na página Compras. */
export type PaymentFilter = "" | "PAGAS" | "PENDENTES" | "ATRASADAS" | "PARCIAIS";

export const PAYMENT_FILTER_LABELS: Record<PaymentFilter, string> = {
  "": "Todas",
  PAGAS: "Pagas",
  PENDENTES: "Pendentes",
  ATRASADAS: "Atrasadas",
  PARCIAIS: "Parcialmente pagas",
};

export function matchesPaymentFilter(p: Purchase, filtro: PaymentFilter, hoje?: string) {
  if (!filtro) return true;
  if (filtro === "PAGAS") return p.status_pagamento === "PAGO";
  if (filtro === "PENDENTES") return isPendentePagamento(p);
  if (filtro === "ATRASADAS") return isAtrasada(p, hoje);
  return p.status_pagamento === "PARCIALMENTE_PAGA";
}

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

/** Parcelas geradas para uma compra (vínculo canônico: purchase_id). */
export async function fetchPurchaseInstallments(purchaseId: string) {
  const { data, error } = await supabase
    .from("expense_installments")
    .select("*")
    .eq("purchase_id", purchaseId)
    .order("numero_parcela", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type PurchaseInstallment = {
  purchase_id: string;
  numero_parcela: number;
  total_parcelas: number;
  valor_parcela: number;
  data_vencimento: string;
  status: string;
};

/** Parcelas de várias compras de uma vez, para o resumo do histórico. */
export async function fetchInstallmentsByPurchases(
  purchaseIds: string[],
): Promise<PurchaseInstallment[]> {
  if (purchaseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("expense_installments")
    .select("purchase_id, numero_parcela, total_parcelas, valor_parcela, data_vencimento, status")
    .in("purchase_id", purchaseIds)
    .order("numero_parcela", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    purchase_id: p.purchase_id ?? "",
    numero_parcela: p.numero_parcela,
    total_parcelas: p.total_parcelas,
    valor_parcela: Number(p.valor_parcela) || 0,
    data_vencimento: p.data_vencimento,
    status: p.status as string,
  }));
}

/**
 * Parcela que representa o período visualizado:
 * com mês escolhido, a que vence nele; sem mês, a primeira ainda não paga.
 */
export function parcelaDoPeriodo(parcelas: PurchaseInstallment[], mes = "") {
  if (parcelas.length === 0) return null;
  const ordenadas = [...parcelas].sort((a, b) => a.numero_parcela - b.numero_parcela);
  if (mes) {
    const doMes = ordenadas.find((p) => p.data_vencimento.startsWith(mes));
    if (doMes) return doMes;
  }
  return ordenadas.find((p) => p.status !== "PAGO") ?? ordenadas[ordenadas.length - 1] ?? null;
}

export type ProgressoParcelamento = {
  total: number;
  pagas: number;
  restantesQtd: number;
  valorParcela: number;
  atual: number;
  restanteValor: number;
  /** ATIVA enquanto houver parcelas pendentes; QUITADA quando todas foram pagas. */
  estado: "ATIVA" | "QUITADA";
};

/**
 * Estado derivado de uma compra parcelada. Uma compra parcelada continua sendo
 * UMA purchase: nunca some da lista quando a primeira parcela é paga.
 */
export function progressoParcelamento(
  parcelas: PurchaseInstallment[],
): ProgressoParcelamento | null {
  if (parcelas.length === 0) return null;
  const ordenadas = [...parcelas].sort((a, b) => a.numero_parcela - b.numero_parcela);
  const total = ordenadas[0]?.total_parcelas ?? ordenadas.length;
  if (total <= 1) return null;
  const pendentes = ordenadas.filter((p) => p.status !== "PAGO");
  const pagas = ordenadas.length - pendentes.length;
  const atual = pendentes[0] ?? ordenadas[ordenadas.length - 1]!;
  return {
    total,
    pagas,
    restantesQtd: pendentes.length,
    valorParcela: Number(atual.valor_parcela) || 0,
    atual: atual.numero_parcela,
    restanteValor: pendentes.reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0),
    estado: pendentes.length === 0 ? "QUITADA" : "ATIVA",
  };
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
 * Cria a compra, seus itens e todo o impacto financeiro decorrente numa ÚNICA
 * transação PostgreSQL (`create_purchase_complete`): tudo persiste ou nada persiste.
 * - PIX/débito/transferência: a movimentação de saída e o débito na conta vêm das triggers do banco;
 * - dinheiro: apenas movimentação de saída de caixa (nenhuma conta é afetada);
 * - crédito: gera a despesa vinculada, as parcelas e as faturas do cartão;
 * - recorrente: registra a cobrança recorrente com a próxima competência.
 *
 * `clientRequestId` protege retry de rede: a mesma requisição repetida devolve a
 * compra já criada (garantia de banco, não apenas do botão React).
 */
export async function createPurchase(input: {
  purchase: Omit<PurchaseInsert, "valor_total">;
  items: NewPurchaseItem[];
  parcelas?: number;
  /** Posição atual da série quando a compra entra pelo meio (ex.: 3 em 3/6). */
  parcelaInicial?: number;
  /** Valor exato da parcela, quando conhecido (fatura importada). */
  valorParcela?: number;
  periodicidade?: ExpenseRecurrence;
  cards?: CreditCard[];
  /** Chave de idempotência da requisição (UUID). */
  clientRequestId?: string;
}): Promise<Purchase> {
  const items = input.items.map((i) => ({
    product_id: i.product_id || null,
    descricao_produto: i.descricao_produto.trim(),
    quantidade: Number(i.quantidade) || 0,
    unidade: i.unidade,
    valor_unitario: Number(i.valor_unitario) || 0,
    valor_total: itemTotal(i),
    categoria_id: i.categoria_id || null,
    categoria_sugerida: i.categoria_sugerida || null,
  }));

  const { data, error } = await supabase.rpc("create_purchase_complete", {
    p_purchase: input.purchase as unknown as Record<string, unknown>,
    p_items: items,
    p_parcelas: Math.max(1, input.parcelas || 1),
    p_parcela_inicial: Math.max(1, input.parcelaInicial || 1),
    ...(input.valorParcela != null ? { p_valor_parcela: input.valorParcela } : {}),
    p_periodicidade: input.periodicidade ?? "MENSAL",
    ...(input.clientRequestId ? { p_client_request_id: input.clientRequestId } : {}),
  } as never);
  if (error) throw error;

  const result = data as unknown as { status: string; purchase: Purchase };
  return result.purchase;
}


/** Relatório de impacto antes de excluir uma compra. */
export type PurchaseDeletionReport = {
  purchase_id: string;
  estabelecimento: string;
  valor_total: number;
  itens: number;
  parcelas: number;
  parcelas_pagas: number;
  transactions: number;
  conciliacoes: number;
  faturas: number;
  itens_fatura_importada: number;
  itens_extrato_importado: number;
  documentos: number;
  recorrencias: number;
  pode_excluir: boolean;
  bloqueios: string[];
  duplicada_de: {
    id: string;
    estabelecimento: string;
    valor_total: number;
    data_compra: string;
    tipo_compra: string;
  } | null;
};

/**
 * `bloqueios` é uma lista no banco (text[] serializado em jsonb).
 * Normalizamos aqui para que a UI nunca precise adivinhar o formato.
 */
export function normalizarBloqueios(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map((v) => String(v)).filter(Boolean);
  if (typeof valor === "string" && valor.trim()) return [valor.trim()];
  return [];
}

export async function inspectPurchaseDeletion(purchaseId: string) {
  const { data, error } = await supabase.rpc("inspect_purchase_deletion", {
    p_purchase_id: purchaseId,
  });
  if (error) throw new Error(friendlyDeleteError(error.message));
  const relatorio = data as unknown as PurchaseDeletionReport;
  return { ...relatorio, bloqueios: normalizarBloqueios(relatorio.bloqueios) };
}

/**
 * Exclusão segura: remove a compra e apenas as dependências exclusivas dela
 * (itens, parcelas não pagas, despesa e recorrência vinculadas), em uma única
 * transação. Compras com histórico financeiro real são bloqueadas no banco.
 */
export async function deletePurchase(id: string) {
  const { error } = await supabase.rpc("delete_purchase_safely", { p_purchase_id: id });
  if (error) throw new Error(friendlyDeleteError(error.message));
}

/** Traduz erros técnicos do banco para uma mensagem compreensível. */
export function friendlyDeleteError(message: string) {
  if (/malformed array literal|22P02|invalid input syntax/i.test(message)) {
    // Falha de serialização não é uma regra de negócio: nunca mostrar SQL cru.
    return "Não foi possível concluir a operação por um erro interno. Tente novamente.";
  }
  if (/foreign key|violates|fkey/i.test(message)) {
    return "Esta compra possui parcelas ou histórico financeiro vinculado e não pode ser excluída diretamente.";
  }
  return message;
}


// ------------------------------------------------------- mesclagem de duplicidade

/**
 * Nota fiscal e fatura do cartão descrevem o MESMO evento econômico:
 * a nota traz a compra e os produtos; a fatura traz cartão, parcela e cobrança.
 * A mesclagem preserva a compra da nota e transfere para ela tudo que a
 * duplicada da fatura carregava (parcelamento, conciliação, cartão).
 */
export type PurchaseMergeReport = {
  principal: {
    id: string;
    estabelecimento: string;
    valor_total: number;
    data_compra: string;
    itens: number;
    parcelas: number;
  };
  duplicada: {
    id: string;
    estabelecimento: string;
    valor_total: number;
    data_compra: string;
    itens: number;
    parcelas: number;
    parcelas_pagas: number;
    expenses: number;
    itens_fatura: number;
    conciliacoes: number;
    transactions: number;
  };
  pode_mesclar: boolean;
  bloqueios: string[];
};

export async function inspectPurchaseMerge(principalId: string, duplicadaId: string) {
  const { data, error } = await supabase.rpc("inspect_purchase_merge", {
    p_principal: principalId,
    p_duplicada: duplicadaId,
  });
  if (error) throw new Error(friendlyDeleteError(error.message));
  const relatorio = data as unknown as PurchaseMergeReport;
  return { ...relatorio, bloqueios: normalizarBloqueios(relatorio.bloqueios) };
}

export async function mergeDuplicatePurchase(principalId: string, duplicadaId: string) {
  const { data, error } = await supabase.rpc("merge_duplicate_purchase", {
    p_principal: principalId,
    p_duplicada: duplicadaId,
  });
  if (error) throw new Error(friendlyDeleteError(error.message));
  return data as unknown as { purchase_id: string; parcelas_transferidas: number };
}

/**
 * Qual das duas compras deve ser a principal.
 * A da nota fiscal (mais itens reais e valor total maior) sempre vence:
 * a da fatura representa apenas a parcela cobrada no ciclo.
 */
export function escolherPrincipal<T extends { id: string; valor_total: number | string; itens?: number }>(
  a: T,
  b: T,
) {
  const pesoA = (a.itens ?? 0) * 1000 + Number(a.valor_total);
  const pesoB = (b.itens ?? 0) * 1000 + Number(b.valor_total);
  return pesoA >= pesoB ? { principal: a, duplicada: b } : { principal: b, duplicada: a };
}


/**
 * Altera apenas a categoria de um item de compra já confirmada.
 * Nunca toca em valor, quantidade ou pagamento.
 */
export async function updatePurchaseItemCategory(input: {
  itemId: string;
  categoriaId: string | null;
  categoriaSugerida?: string | null;
}) {
  const { error } = await supabase
    .from("purchase_items")
    .update({
      categoria_id: input.categoriaId,
      categoria_ajustada:
        input.categoriaSugerida != null
          ? input.categoriaSugerida !== input.categoriaId
          : true,
    })
    .eq("id", input.itemId);
  if (error) throw error;
}

/**
 * Registra o pagamento de uma compra que estava pendente.
 *
 * O impacto financeiro só acontece agora:
 * - Pix / débito / transferência: as triggers debitam a conta e criam a saída;
 * - dinheiro / outro: apenas registra o pagamento (nenhuma conta é afetada);
 * - crédito: vira compromisso na fatura do cartão (nada sai do banco).
 */
export async function registerPurchasePayment(input: {
  purchase: Purchase;
  formaPagamento: PaymentMethodValue;
  dataPagamento: string;
  bankAccountId?: string | null;
  creditCardId?: string | null;
  cards?: CreditCard[];
}) {
  const { purchase, formaPagamento, dataPagamento } = input;
  const usaBanco = usesBankAccount(formaPagamento);
  const credito = formaPagamento === "CREDITO";

  const { data: atualizada, error } = await supabase
    .from("purchases")
    .update({
      forma_pagamento: formaPagamento,
      bank_account_id: usaBanco ? input.bankAccountId || null : null,
      credit_card_id: credito ? input.creditCardId || null : null,
      data_pagamento_real: dataPagamento,
    })
    .eq("id", purchase.id)
    .select()
    .single();
  if (error) throw error;

  // Crédito: a compra é a fonte de verdade — só a parcela na fatura é criada.
  if (credito && atualizada.credit_card_id) {
    const card = (input.cards ?? []).find((c) => c.id === atualizada.credit_card_id);
    if (card) {
      await generateInstallments({
        familyId: atualizada.family_id,
        card,
        dataCompra: dataPagamento,
        valorTotal: Number(atualizada.valor_total) || 0,
        parcelas: 1,
        memberId: atualizada.member_id,
        purchaseId: atualizada.id,
      });
    }
  }

  return atualizada;
}
