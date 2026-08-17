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
  // Fatura de cartão (documento fechado): a despesa vem positiva e o
  // crédito/estorno vem negativo — convenção oposta à do extrato.
  CREDIT_CARD_STATEMENT_PDF: "POSITIVE_IS_OUT",
  // Leitura de imagem (print, recibo, foto): o extrator devolve valor
  // assinado no padrão de ledger — saída negativa, entrada positiva.
  CARD_SCREENSHOT: "NEGATIVE_IS_OUT",
  RECEIPT_IMAGE: "NEGATIVE_IS_OUT",
  PURCHASE_IMAGE: "NEGATIVE_IS_OUT",
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
  if (direction === "OUT") return "PURCHASE";
  // Numa fatura de cartão, dinheiro entrando é crédito/estorno, não receita.
  return sourceType === "CREDIT_CARD_STATEMENT_PDF" ? "REFUND" : "INCOME";
}
