import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createPurchase, itemTotal, type NewPurchaseItem, type PurchaseInsert } from "@/lib/purchases";
import type { ExpenseRecurrence } from "@/lib/recurring-expenses";
import type { CreditCard } from "@/lib/finance";
import { readNotaFiscalPdf } from "@/lib/pdf-extract";
import { detectDocumentType, fetchDocumentTypeByCode } from "@/lib/document-types";

export type FinancialDocument = Database["public"]["Tables"]["documents"]["Row"];
export type FinancialDocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
export type PurchaseImport = Database["public"]["Tables"]["purchase_imports"]["Row"];
export type PurchaseImportItem = Database["public"]["Tables"]["purchase_import_items"]["Row"];
export type DocumentExtraction = Database["public"]["Tables"]["document_extractions"]["Row"];
export type DocumentExtractionItem = Database["public"]["Tables"]["document_extraction_items"]["Row"];

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
    .map((i) => {
      const categoriaFinal = i.categoria_id || i.categoria_sugerida || null;
      return {
        purchase_id: purchase.id,
        product_id: i.product_id || null,
        descricao_produto: i.descricao_produto.trim(),
        quantidade: Number(i.quantidade) || 0,
        unidade: i.unidade,
        valor_unitario: Number(i.valor_unitario) || 0,
        valor_total: itemTotal(i),
        categoria_id: categoriaFinal,
        categoria_sugerida: i.categoria_sugerida || null,
        categoria_ajustada: !!i.categoria_sugerida && i.categoria_sugerida !== categoriaFinal,
      };
    });

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
 * Remove o arquivo original do Storage depois que a compra foi criada.
 * Os dados estruturados (compra e produtos) continuam intactos.
 */
export async function purgeDocumentFile(doc: { id: string; url_arquivo?: string | null }) {
  if (doc.url_arquivo) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.url_arquivo]);
  }
  await supabase.from("documents").update({ url_arquivo: null }).eq("id", doc.id);
}

/**
 * Cancelamento antes da confirmação: apaga o arquivo temporário,
 * as extrações relacionadas e o próprio registro do documento.
 */
export async function discardDocument(doc: { id: string; url_arquivo?: string | null }) {
  if (doc.url_arquivo) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.url_arquivo]);
  }
  const { data: extractions } = await supabase
    .from("document_extractions")
    .select("id")
    .eq("document_id", doc.id);
  const ids = (extractions ?? []).map((e) => e.id);
  if (ids.length > 0) {
    await supabase.from("document_extraction_items").delete().in("extraction_id", ids);
    await supabase.from("document_extractions").delete().in("id", ids);
  }
  await supabase.from("purchase_imports").delete().eq("document_id", doc.id);
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
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

/** Baixa o arquivo guardado no bucket privado. */
export async function downloadDocumentFile(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function fetchDocumentExtraction(documentId: string) {
  const { data, error } = await supabase
    .from("document_extractions")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchExtractionItems(extractionId: string) {
  const { data, error } = await supabase
    .from("document_extraction_items")
    .select("*")
    .eq("extraction_id", extractionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Primeira camada de leitura automática: lê o PDF da nota fiscal,
 * guarda a extração (dados da compra + produtos) e deixa o documento
 * com status PROCESSADO, pronto para a revisão humana.
 */
export async function processDocumentPdf(input: {
  doc: Pick<FinancialDocument, "id" | "family_id" | "member_id" | "url_arquivo" | "nome_arquivo">;
  file?: Blob | undefined;
}) {
  const { doc } = input;
  await supabase.from("documents").update({ status: "PROCESSANDO" }).eq("id", doc.id);

  try {
    const arquivo = input.file ?? (doc.url_arquivo ? await downloadDocumentFile(doc.url_arquivo) : null);
    if (!arquivo) throw new Error("Arquivo do documento não encontrado.");

    const lido = await readNotaFiscalPdf(arquivo);

    // Biblioteca de tipos: identifica o formato e registra a confiança.
    // Não interfere no parser DANFE já validado — apenas classifica.
    const deteccao = detectDocumentType(lido.linhas);
    let tipoId: string | null = null;
    try {
      const tipo = await fetchDocumentTypeByCode(deteccao.codigo);
      tipoId = tipo?.id ?? null;
    } catch (err) {
      console.warn("Não foi possível carregar o tipo de documento", err);
    }

    // Uma extração por documento: substitui a leitura anterior.
    await supabase.from("document_extractions").delete().eq("document_id", doc.id);

    const { data: extraction, error } = await supabase
      .from("document_extractions")
      .insert({
        document_id: doc.id,
        family_id: doc.family_id,
        member_id: doc.member_id,
        estabelecimento: lido.estabelecimento,
        data_compra: lido.data_compra,
        valor_total: lido.valor_total,
        forma_pagamento: lido.forma_pagamento,
        dados_brutos_json: {
          linhas: lido.linhas,
          arquivo: doc.nome_arquivo,
          confianca: lido.confianca,
          pagamento_descricao: lido.pagamento_descricao,
          // Cópia dos produtos lidos: garante que a revisão sempre tenha o que mostrar,
          // mesmo se a gravação dos itens falhar depois.
          items: lido.items,
        },
      })
      .select()
      .single();
    if (error) throw error;

    let itensGravados: DocumentExtractionItem[] = [];
    if (lido.items.length > 0) {
      const payload = lido.items.map((i) => ({
        extraction_id: extraction.id,
        descricao_produto: i.descricao_produto,
        quantidade: i.quantidade,
        unidade: i.unidade || "UN",
        valor_unitario: i.valor_unitario,
        valor_total: i.valor_total,
      }));
      const { data: inseridos, error: itemsError } = await supabase
        .from("document_extraction_items")
        .insert(payload)
        .select();
      if (itemsError) {
        console.error("Falha ao persistir produtos extraídos", {
          payload,
          erro: itemsError,
          quantidadeIdentificada: lido.items.length,
          quantidadePersistida: 0,
        });
        throw new Error(
          `Falha ao salvar produtos: ${itemsError.message}${itemsError.details ? ` (${itemsError.details})` : ""}`,
        );
      }
      itensGravados = inseridos ?? [];
      if (itensGravados.length !== lido.items.length) {
        throw new Error(
          `Os produtos lidos não foram salvos por completo (${itensGravados.length} de ${lido.items.length}).`,
        );
      }
    }

    await supabase.from("documents").update({ status: "PROCESSADO" }).eq("id", doc.id);
    return { extraction, items: itensGravados, lidos: lido.items };

  } catch (e) {
    await supabase.from("documents").update({ status: "ERRO" }).eq("id", doc.id);
    throw e instanceof Error ? e : new Error("Não foi possível ler o PDF.");
  }
}
