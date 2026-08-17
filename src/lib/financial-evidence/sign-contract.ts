/**
 * CONTRATO CANÔNICO DE SINAL (Fase 4A).
 *
 * Fontes diferentes escrevem o mesmo fato econômico com sinais diferentes:
 *
 *   print/extrato bancário  →  -84,90  significa SAÍDA
 *   fatura de cartão        →   84,90  significa DESPESA
 *
 * Os parsers e goldens NÃO mudam: eles continuam devolvendo o valor como a
 * fonte escreveu. A tradução acontece AQUI, na fronteira adapter → domínio.
 *
 * Depois desta fronteira o domínio nunca mais olha o sinal nem o sourceType
 * para descobrir o sentido do dinheiro: ele lê `amount` (magnitude positiva)
 * e `direction` (IN | OUT). `rawAmount` é preservado apenas para auditoria.
 */
import type { CandidateDirection, EconomicKind, EvidenceSourceType } from "./types";

/** Como a fonte escreve uma SAÍDA de dinheiro / uma despesa. */
export type SignConvention = "NEGATIVE_IS_OUT" | "POSITIVE_IS_OUT";

export const SOURCE_SIGN_CONVENTION: Record<EvidenceSourceType, SignConvention> = {
  // Ledger bancário: débito vem negativo, crédito positivo.
  BANK_STATEMENT_PDF: "NEGATIVE_IS_OUT",
  BANK_SCREENSHOT: "NEGATIVE_IS_OUT",
  // Fatura de cartão: a despesa vem positiva; crédito/estorno vem negativo.
  CREDIT_CARD_STATEMENT_PDF: "POSITIVE_IS_OUT",
  CARD_SCREENSHOT: "POSITIVE_IS_OUT",
  // Comprovantes e fotos de compra descrevem uma despesa em valor positivo.
  RECEIPT_IMAGE: "POSITIVE_IS_OUT",
  PURCHASE_IMAGE: "POSITIVE_IS_OUT",
};

export type NormalizedAmount = {
  /** Valor exatamente como a fonte escreveu (auditoria). */
  rawAmount: number;
  /** Magnitude positiva — nunca carrega sentido. */
  amount: number;
  /** Sentido econômico explícito. */
  direction: CandidateDirection;
};

/** Traduz o valor bruto da fonte para o contrato canônico do domínio. */
export function normalizeAmount(
  rawAmount: number,
  sourceType: EvidenceSourceType,
): NormalizedAmount {
  const convencao = SOURCE_SIGN_CONVENTION[sourceType];
  const negativo = rawAmount < 0;
  const direction: CandidateDirection =
    convencao === "NEGATIVE_IS_OUT" ? (negativo ? "OUT" : "IN") : negativo ? "IN" : "OUT";

  return { rawAmount, amount: Math.abs(rawAmount), direction };
}

/**
 * Natureza econômica padrão quando a fonte não classifica o lançamento.
 * Continua sendo derivada de `direction` — nunca do sinal cru.
 */
export function defaultEconomicKind(
  direction: CandidateDirection,
  sourceType: EvidenceSourceType,
): EconomicKind {
  const cartao =
    SOURCE_SIGN_CONVENTION[sourceType] === "POSITIVE_IS_OUT" &&
    (sourceType === "CREDIT_CARD_STATEMENT_PDF" || sourceType === "CARD_SCREENSHOT");
  if (direction === "OUT") return "PURCHASE";
  return cartao ? "REFUND" : "INCOME";
}
