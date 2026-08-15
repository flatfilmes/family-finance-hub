import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createPurchase, itemTotal, type NewPurchaseItem, type PurchaseInsert } from "@/lib/purchases";
import type { ExpenseRecurrence } from "@/lib/recurring-expenses";
import type { CreditCard } from "@/lib/finance";

export type FinancialDocument = Database["public"]["Tables"]["documents"]["Row"];
export type FinancialDocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
export type PurchaseImport = Database["public"]["Tables"]["purchase_imports"]["Row"];
export type PurchaseImportItem = Database["public"]["Tables"]["purchase_import_items"]["Row"];

export type DocumentType = Database["public"]["Enums"]["document_type"];
export type DocumentStatus = Database["public"]["Enums"]["document_status"];
export type PurchaseImportStatus = Database["public"]["Enums"]["purchase_import_status"];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  NOTA_FISCAL: "Nota fiscal",
  QR_CODE: "QR Code NFC-e",
  PDF_FATURA: "PDF de fatura",
  COMPROVANTE: "Comprovante",
  OUTRO: "Outro documento",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  ENVIADO: "Aguardando revisão",
  PROCESSANDO: "Processando",
  PROCESSADO: "Aguardando confirmação",
  CONFIRMADO: "Compra criada",
  REJEITADO: "Rejeitado",
  ERRO: "Erro na leitura",
};

export const DOCUMENT_STATUS_CLASSES: Record<DocumentStatus, string> = {
  ENVIADO: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PROCESSANDO: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  PROCESSADO: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  CONFIRMADO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  REJEITADO: "bg-muted text-muted-foreground",
  ERRO: "bg-destructive/15 text-destructive",
};


export const IMPORT_STATUS_LABELS: Record<PurchaseImportStatus, string> = {
  PENDENTE_APROVACAO: "Aguardando confirmação",
  APROVADO: "Compra criada",
  REJEITADO: "Descartado",
};

export const DOCUMENTS_BUCKET = "documentos-financeiros";

/** Caminho padrão: familia/{family_id}/documentos/{arquivo}. */
export function documentPath(familyId: string, fileName: string) {
  const limpo = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.\-_]/g, "-")
    .toLowerCase();
  return `familia/${familyId}/documentos/${Date.now()}-${limpo}`;
}

/** Envia o arquivo para o Storage e registra o documento com status ENVIADO. */
export async function uploadDocument(input: {
  familyId: string;
  memberId?: string | null;
  createdBy?: string | null;
  file: File;
  tipo: DocumentType;
}) {
  const path = documentPath(input.familyId, input.file.name || "nota-fiscal");
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, input.file, { contentType: input.file.type || "application/octet-stream", upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      family_id: input.familyId,
      member_id: input.memberId || null,
      created_by: input.createdBy || null,
      tipo_documento: input.tipo,
      nome_arquivo: input.file.name || "nota-fiscal",
      url_arquivo: path,
      tamanho: input.file.size,
      status: "ENVIADO",
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw error;
  }
  return data;
}

/** Link temporário para visualizar o arquivo guardado (bucket privado). */
export async function getDocumentUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

export async function fetchDocuments(familyId: string) {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPurchaseImports(familyId: string) {
  const { data, error } = await supabase
    .from("purchase_imports")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchImportItems(importId: string) {
  const { data, error } = await supabase
    .from("purchase_import_items")
    .select("*")
    .eq("purchase_import_id", importId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function deleteDocument(doc: { id: string; url_arquivo?: string | null }) {
  if (doc.url_arquivo) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.url_arquivo]);
  }
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  if (error) throw error;
}

/** Descarta um rascunho importado sem criar compra. */
export async function rejectImport(importId: string) {
  const { error } = await supabase
    .from("purchase_imports")
    .update({ status: "REJEITADO" })
    .eq("id", importId);
  if (error) throw error;
}

/**
 * Confirma um rascunho de importação: cria a compra oficial com seus produtos,
 * vincula o documento à compra e marca o rascunho como aprovado.
 * A extração (OCR / QR Code) ainda não existe — este é o passo de confirmação humana.
 */
export async function confirmImport(input: {
  importId: string;
  documentId: string;
  purchase: Omit<PurchaseInsert, "valor_total">;
  items: NewPurchaseItem[];
}) {
  const valorTotal = input.items.reduce((acc, i) => acc + itemTotal(i), 0);

  const { data: purchase, error } = await supabase
    .from("purchases")
    .insert({ ...input.purchase, valor_total: valorTotal })
    .select()
    .single();
  if (error) throw error;

  const rows = input.items
    .filter((i) => i.descricao_produto.trim() !== "")
    .map((i) => ({
      purchase_id: purchase.id,
      product_id: i.product_id || null,
      descricao_produto: i.descricao_produto.trim(),
      quantidade: Number(i.quantidade) || 0,
      unidade: i.unidade,
      valor_unitario: Number(i.valor_unitario) || 0,
      valor_total: itemTotal(i),
      categoria_id: i.categoria_id || null,
    }));
  if (rows.length > 0) {
    const { error: itemsError } = await supabase.from("purchase_items").insert(rows);
    if (itemsError) throw itemsError;
  }

  const { error: importError } = await supabase
    .from("purchase_imports")
    .update({ status: "APROVADO" })
    .eq("id", input.importId);
  if (importError) throw importError;

  const { error: docError } = await supabase
    .from("documents")
    .update({ status: "CONFIRMADO", purchase_id: purchase.id })
    .eq("id", input.documentId);
  if (docError) throw docError;

  return purchase;
}

/** Recusa um documento enviado: ele não vira compra e sai da fila de revisão. */
export async function rejectDocument(documentId: string) {
  const { error } = await supabase
    .from("documents")
    .update({ status: "REJEITADO" })
    .eq("id", documentId);
  if (error) throw error;
}

/**
 * Etapa de aprovação manual: transforma um documento revisado em compra oficial,
 * com todo o impacto financeiro (conta, cartão, parcelas, recorrência),
 * vincula o documento à compra e marca o documento como CONFIRMADO.
 */
export async function confirmDocumentPurchase(input: {
  documentId: string;
  importId?: string | null;
  purchase: Omit<PurchaseInsert, "valor_total">;
  items: NewPurchaseItem[];
  parcelas?: number;
  periodicidade?: ExpenseRecurrence;
  cards?: CreditCard[];
}) {
  const purchase = await createPurchase({
    purchase: input.purchase,
    items: input.items.filter((i) => i.descricao_produto.trim() !== ""),
    ...(input.parcelas !== undefined ? { parcelas: input.parcelas } : {}),
    ...(input.periodicidade !== undefined ? { periodicidade: input.periodicidade } : {}),
    ...(input.cards !== undefined ? { cards: input.cards } : {}),
  });

  if (input.importId) {
    const { error: importError } = await supabase
      .from("purchase_imports")
      .update({ status: "APROVADO" })
      .eq("id", input.importId);
    if (importError) throw importError;
  }

  const { error: docError } = await supabase
    .from("documents")
    .update({ status: "CONFIRMADO", purchase_id: purchase.id })
    .eq("id", input.documentId);
  if (docError) throw docError;

  return purchase;
}
