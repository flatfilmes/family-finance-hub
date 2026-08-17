/**
 * FASE 3B — contratos do REGISTRY VERSIONADO DE PARSERS DE DOCUMENTO.
 *
 * Regra estrutural: o parser NUNCA é escolhido por texto livre
 * (nome da conta, apelido do cartão, bandeira). A cadeia obrigatória é:
 *
 *   CONTA/CARTÃO → INSTITUIÇÃO OFICIAL → TIPO DE DOCUMENTO
 *   → REGISTRY ESCOPADO POR INSTITUIÇÃO → VERSÃO DE LAYOUT → PARSER
 */
import type { PdfLine, PdfPageLayout } from "@/lib/pdf-extract";

/** Código estável (machine-readable) da instituição — espelha financial_institutions.code. */
export type InstitutionCode = "BANCO_DO_BRASIL" | "ITAU" | "NUBANK" | "SANTANDER";

/**
 * Tipo econômico do documento. Os tipos de imagem já existem no contrato
 * (extensibilidade da próxima fase) mas NÃO possuem parser nesta fase.
 */
export type ParserDocumentType =
  | "BANK_STATEMENT"
  | "CREDIT_CARD_STATEMENT"
  | "BANK_SCREENSHOT"
  | "CARD_SCREENSHOT"
  | "RECEIPT_IMAGE";

/** Entrada bruta entregue aos detectores/parsers (mesma leitura de produção). */
export type ParserDocumentInput = {
  /** Textos normalizados do documento — usados apenas na detecção de versão. */
  textos: string[];
  linhas?: PdfLine[];
  pages?: PdfPageLayout[];
};

export type DocumentParserDescriptor<TOutput = unknown> = {
  /** Identidade estável e versionada, ex.: BB_STATEMENT_V1. */
  key: string;
  institutionCode: InstitutionCode;
  documentType: ParserDocumentType;
  formatVersion: number;
  active: boolean;
  /** Desempate quando duas versões pontuam igual (maior vence). */
  priority: number;
  /** Nome interno herdado do parser real já validado (ex.: ITAU_PDF). */
  legacyParserName: string;
  /** Score de reconhecimento do LAYOUT dentro da própria instituição. */
  detect: (input: ParserDocumentInput) => number;
  parse: (input: ParserDocumentInput) => TOutput;
};

export type ParserRoutingStatus =
  | "PASS"
  | "DOCUMENT_INSTITUTION_MISMATCH"
  | "UNSUPPORTED_INSTITUTION_DOCUMENT_FORMAT"
  | "WRONG_DOCUMENT_TYPE_FOR_CONTEXT"
  | "INSTITUTION_MAPPING_REQUIRED";

export type ParserRoutingResult = {
  status: ParserRoutingStatus;
  /** Instituição oficial do contexto (conta/cartão), nunca do texto livre. */
  contextInstitution: InstitutionCode | null;
  detectedInstitution: InstitutionCode | null;
  documentType: ParserDocumentType;
  detectedDocumentType: ParserDocumentType | null;
  parserFamily: InstitutionCode | null;
  parserKey: string | null;
  formatVersion: number | null;
  detectionScore: number;
  threshold: number;
  /** Score de cada versão avaliada — evidência do roteamento. */
  candidates: Array<{ key: string; formatVersion: number; score: number }>;
  reason: string;
  descriptor: DocumentParserDescriptor | null;
};

/** Contexto explícito transportado por todo fluxo de importação. */
export type ImportContext = {
  familyId: string;
  memberId?: string | null;
  institutionId: string | null;
  institutionCode: InstitutionCode | null;
  bankAccountId?: string | null;
  creditCardId?: string | null;
  documentType: ParserDocumentType;
};
