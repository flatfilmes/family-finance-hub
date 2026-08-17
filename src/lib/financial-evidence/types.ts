/**
 * FASE 3C/3D — Modelo canônico de EVIDÊNCIA financeira.
 *
 * Três conceitos que nunca se misturam:
 *
 * 1. EVIDÊNCIA        — o documento (PDF, print, foto). Prova, não dinheiro.
 * 2. EVENTO ECONÔMICO — a compra/receita que realmente aconteceu (purchases).
 * 3. EFEITO BANCÁRIO  — o impacto no saldo/fatura (transactions, faturas).
 *
 * Toda evidência produz CANDIDATOS. Candidato nunca vira dinheiro sozinho:
 * ele passa pela engine única de reconciliação e depois pela revisão humana.
 */
import type { Database } from "@/integrations/supabase/types";

export type EvidenceSourceType = Database["public"]["Enums"]["evidence_source_type"];
export type EvidenceImportStatus = Database["public"]["Enums"]["evidence_import_status"];
export type EvidenceMatchStatus = Database["public"]["Enums"]["evidence_match_status"];

export type SourceConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * Confiança estrutural da fonte — NÃO é confiança do conteúdo.
 * PDF oficial é documento fechado; print de app é recorte parcial da tela.
 */
export const SOURCE_CONFIDENCE: Record<EvidenceSourceType, SourceConfidence> = {
  BANK_STATEMENT_PDF: "HIGH",
  CREDIT_CARD_STATEMENT_PDF: "HIGH",
  BANK_SCREENSHOT: "MEDIUM",
  CARD_SCREENSHOT: "MEDIUM",
  RECEIPT_IMAGE: "MEDIUM",
  PURCHASE_IMAGE: "LOW",
};

export const SOURCE_LABELS: Record<EvidenceSourceType, string> = {
  BANK_STATEMENT_PDF: "Extrato bancário (PDF)",
  CREDIT_CARD_STATEMENT_PDF: "Fatura de cartão (PDF)",
  BANK_SCREENSHOT: "Print do app do banco",
  CARD_SCREENSHOT: "Print da fatura do cartão",
  RECEIPT_IMAGE: "Comprovante/recibo",
  PURCHASE_IMAGE: "Foto da compra",
};

export type CandidateDirection = "IN" | "OUT";

export type EconomicKind =
  | "PURCHASE"
  | "INCOME"
  | "TRANSFER"
  | "CARD_PAYMENT"
  | "FEE"
  | "REFUND"
  | "UNKNOWN";

/**
 * Candidato financeiro: a saída única de QUALQUER ingestão de evidência.
 * Parsers de PDF, leitura de imagem e captura manual convergem para cá.
 */
export type FinancialCandidateEvent = {
  /** Identificador da evidência de origem (import id ou hash do arquivo). */
  evidenceId: string;
  sourceType: EvidenceSourceType;
  /** Chave estável do item dentro da evidência — base da idempotência. */
  sourceItemKey: string;
  ordem: number;

  /** Data do fato econômico (compra). */
  eventDate: string | null;
  /** Data contábil/efeito no extrato, quando diferente. */
  postingDate: string | null;

  description: string;
  /**
   * Magnitude positiva. O sentido do dinheiro está SEMPRE em `direction` —
   * o domínio nunca infere sentido a partir do sinal (ver sign-contract.ts).
   */
  amount: number;
  /** Valor exatamente como a fonte escreveu (auditoria). */
  rawAmount: number;
  direction: CandidateDirection;
  economicKind: EconomicKind;


  cardLast4: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;

  bankAccountId: string | null;
  creditCardId: string | null;
  institutionId: string | null;

  /** 0–100: quanto o extrator confia no que leu neste item. */
  extractionConfidence: number;
  sourceConfidence: SourceConfidence;
  rawText: string | null;
};

export type ExistingRecordKind =
  | "PURCHASE"
  | "TRANSACTION"
  | "CARD_STATEMENT_ITEM"
  | "BANK_STATEMENT_ITEM"
  | "EVIDENCE_ITEM";

/** Registro já existente no sistema, normalizado para comparação. */
export type ExistingEconomicRecord = {
  kind: ExistingRecordKind;
  id: string;
  date: string | null;
  amount: number;
  direction: CandidateDirection;
  description: string;
  cardLast4?: string | null;
  bankAccountId?: string | null;
  creditCardId?: string | null;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
  /**
   * Evidências que já originaram este registro. Se a evidência atual está
   * aqui, é reimportação do mesmo documento — nunca um fato novo.
   */
  lineageEvidenceIds?: string[];
  lineageItemKeys?: string[];
};

/** Janela já coberta por outra evidência confirmada do mesmo contexto. */
export type CoveredPeriod = {
  evidenceId: string;
  inicio: string;
  fim: string;
  rotulo: string;
};

export type CandidateResolution = {
  candidate: FinancialCandidateEvent;
  status: EvidenceMatchStatus;
  score: number;
  reason: string;
  actionPreview: string;
  matched: { kind: ExistingRecordKind; id: string } | null;
  /** Segundo colocado — usado para provar ambiguidade em CONFLICT. */
  runnerUp: { kind: ExistingRecordKind; id: string; score: number } | null;
};

export type ReconciliationSummary = {
  total: number;
  exactMatch: number;
  strongMatch: number;
  possibleMatch: number;
  newItem: number;
  newInOverlap: number;
  conflict: number;
  ignored: number;
  /** Soma dos candidatos que criariam evento novo. */
  totalNovo: number;
};

export type UnifiedReconciliationResult = {
  status: "PASS" | "REVIEW_REQUIRED" | "BLOCKED" | "ALREADY_INGESTED";
  resolutions: CandidateResolution[];
  summary: ReconciliationSummary;
  blockers: string[];
  overlaps: CoveredPeriod[];
};
