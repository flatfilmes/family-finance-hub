/**
 * Persistência da camada de evidência.
 *
 * A evidência é gravada como PROVA (arquivo + itens lidos + resultado da
 * reconciliação). Nenhum evento econômico ou efeito bancário nasce aqui:
 * isso continua acontecendo apenas nos fluxos de compra/movimentação
 * existentes, depois da confirmação humana.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { CandidateResolution, EvidenceSourceType, FinancialCandidateEvent } from "./types";
import { normalizarDescricao } from "./reconcile";

export type EvidenceImport = Database["public"]["Tables"]["financial_evidence_imports"]["Row"];
export type EvidenceItem = Database["public"]["Tables"]["financial_evidence_items"]["Row"];

export const EVIDENCE_BUCKET = "evidencias-financeiras";

export async function hashArquivo(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchEvidenceImports(familyId: string) {
  const { data, error } = await supabase
    .from("financial_evidence_imports")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchEvidenceItems(importId: string) {
  const { data, error } = await supabase
    .from("financial_evidence_items")
    .select("*")
    .eq("evidence_import_id", importId)
    .order("ordem");
  if (error) throw error;
  return data;
}

/** Evidência já enviada antes no mesmo contexto — base da idempotência. */
export async function findEvidenceByHash(input: {
  familyId: string;
  sourceType: EvidenceSourceType;
  fileHash: string;
  bankAccountId?: string | null;
  creditCardId?: string | null;
}) {
  let q = supabase
    .from("financial_evidence_imports")
    .select("*")
    .eq("family_id", input.familyId)
    .eq("source_type", input.sourceType)
    .eq("file_hash", input.fileHash);
  q = input.bankAccountId ? q.eq("bank_account_id", input.bankAccountId) : q.is("bank_account_id", null);
  q = input.creditCardId ? q.eq("credit_card_id", input.creditCardId) : q.is("credit_card_id", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

export async function uploadEvidenceFile(input: { familyId: string; fileHash: string; file: File }) {
  const ext = input.file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${input.familyId}/${input.fileHash}.${ext}`;
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, input.file, { upsert: true, contentType: input.file.type });
  if (error) throw error;
  return path;
}

export async function createEvidenceImport(input: {
  familyId: string;
  memberId?: string | null;
  sourceType: EvidenceSourceType;
  fileHash: string;
  storagePath: string;
  mimeType: string;
  fileName: string;
  bankAccountId?: string | null;
  creditCardId?: string | null;
  institutionId?: string | null;
  provider?: string | null;
  version?: string | null;
  rawText?: string | null;
  status?: Database["public"]["Enums"]["evidence_import_status"];
}) {
  const { data, error } = await supabase
    .from("financial_evidence_imports")
    .insert({
      family_id: input.familyId,
      member_id: input.memberId ?? null,
      source_type: input.sourceType,
      file_hash: input.fileHash,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      file_name: input.fileName,
      bank_account_id: input.bankAccountId ?? null,
      credit_card_id: input.creditCardId ?? null,
      institution_id: input.institutionId ?? null,
      extraction_provider: input.provider ?? null,
      extraction_version: input.version ?? null,
      raw_text: input.rawText ?? null,
      status: input.status ?? "EXTRACTED",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Grava os candidatos já reconciliados como itens de evidência. */
export async function saveEvidenceResolutions(input: {
  familyId: string;
  importId: string;
  resolutions: CandidateResolution[];
}) {
  if (input.resolutions.length === 0) return [];
  const linhas = input.resolutions.map((r) => {
    const c: FinancialCandidateEvent = r.candidate;
    return {
      evidence_import_id: input.importId,
      family_id: input.familyId,
      source_item_key: c.sourceItemKey,
      ordem: c.ordem,
      event_date: c.eventDate,
      posting_date: c.postingDate,
      description: c.description,
      normalized_description: normalizarDescricao(c.description),
      amount: Math.abs(c.amount),
      direction: c.direction,
      economic_kind: c.economicKind,
      card_last4: c.cardLast4,
      installment_current: c.installmentCurrent,
      installment_total: c.installmentTotal,
      raw_text: c.rawText,
      extraction_confidence: c.extractionConfidence,
      source_confidence: c.sourceConfidence,
      match_status: r.status,
      match_reason: r.reason,
      match_score: r.score,
      matched_purchase_id: r.matched?.kind === "PURCHASE" ? r.matched.id : null,
      matched_transaction_id: r.matched?.kind === "TRANSACTION" ? r.matched.id : null,
      matched_card_statement_item_id: r.matched?.kind === "CARD_STATEMENT_ITEM" ? r.matched.id : null,
      matched_bank_statement_item_id: r.matched?.kind === "BANK_STATEMENT_ITEM" ? r.matched.id : null,
    };
  });
  const { data, error } = await supabase
    .from("financial_evidence_items")
    .upsert(linhas, { onConflict: "evidence_import_id,source_item_key" })
    .select("*");
  if (error) throw error;
  return data;
}

/** Vincula uma evidência a uma compra existente (N evidências por compra). */
export async function linkEvidenceToPurchase(input: {
  familyId: string;
  purchaseId: string;
  sourceType: EvidenceSourceType;
  evidenceItemId?: string;
  cardStatementItemId?: string;
  bankStatementItemId?: string;
  documentId?: string;
  observacao?: string;
}) {
  const { error } = await supabase.from("purchase_evidence_links").insert({
    family_id: input.familyId,
    purchase_id: input.purchaseId,
    source_type: input.sourceType,
    evidence_item_id: input.evidenceItemId ?? null,
    card_statement_item_id: input.cardStatementItemId ?? null,
    bank_statement_item_id: input.bankStatementItemId ?? null,
    document_id: input.documentId ?? null,
    observacao: input.observacao ?? null,
  });
  if (error) throw error;
}

export async function fetchPurchaseEvidenceLinks(purchaseId: string) {
  const { data, error } = await supabase
    .from("purchase_evidence_links")
    .select("*")
    .eq("purchase_id", purchaseId)
    .order("created_at");
  if (error) throw error;
  return data;
}
