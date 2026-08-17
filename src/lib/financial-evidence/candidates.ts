/**
 * Adaptadores: cada pipeline de ingestão vira CANDIDATOS no modelo único.
 *
 * Os parsers golden (BB, Itaú extrato, Itaú fatura, Nubank) NÃO são alterados
 * aqui — apenas traduzidos. Nada nesta camada reinterpreta valores, datas ou
 * sinais: é conversão de formato, não de semântica.
 */
import type { ParsedBankMovement } from "@/lib/bank-statements/types";
import type { ScreenshotMovement } from "@/lib/bank-screenshot.functions";
import { normalizarDescricao } from "./reconcile";
import { defaultEconomicKind, normalizeAmount } from "./sign-contract";
import {
  SOURCE_CONFIDENCE,
  type EconomicKind,
  type EvidenceSourceType,
  type FinancialCandidateEvent,
} from "./types";

export type CandidateContext = {
  evidenceId: string;
  bankAccountId?: string | null;
  creditCardId?: string | null;
  institutionId?: string | null;
};

function base(
  ctx: CandidateContext,
  sourceType: EvidenceSourceType,
  ordem: number,
  sourceItemKey: string,
): Pick<
  FinancialCandidateEvent,
  | "evidenceId"
  | "sourceType"
  | "sourceItemKey"
  | "ordem"
  | "bankAccountId"
  | "creditCardId"
  | "institutionId"
  | "sourceConfidence"
> {
  return {
    evidenceId: ctx.evidenceId,
    sourceType,
    sourceItemKey,
    ordem,
    bankAccountId: ctx.bankAccountId ?? null,
    creditCardId: ctx.creditCardId ?? null,
    institutionId: ctx.institutionId ?? null,
    sourceConfidence: SOURCE_CONFIDENCE[sourceType],
  };
}

const kindDoExtrato = (tipo: string): EconomicKind => {
  switch (tipo) {
    case "TRANSFERENCIA":
      return "TRANSFER";
    case "TARIFA":
    case "JUROS":
      return "FEE";
    case "ESTORNO":
      return "REFUND";
    case "PAGAMENTO_FATURA":
      return "CARD_PAYMENT";
    default:
      return "UNKNOWN";
  }
};

/** Extrato bancário (PDF) → candidatos. Sinal do valor define a direção. */
export function bankMovementsToCandidates(
  movimentos: ParsedBankMovement[],
  ctx: CandidateContext,
): FinancialCandidateEvent[] {
  return movimentos.map((m, i) => {
    // Fronteira adapter → domínio: o sinal da fonte vira amount + direction.
    const { amount, direction, rawAmount } = normalizeAmount(m.valor, "BANK_STATEMENT_PDF");
    const kind = kindDoExtrato(String(m.tipo));
    return {
      ...base(
        ctx,
        "BANK_STATEMENT_PDF",
        i + 1,
        `${ctx.evidenceId}#${String(i + 1).padStart(3, "0")}#${m.data ?? "s-data"}#${Math.abs(m.valor).toFixed(2)}`,
      ),
      eventDate: m.eventDate ?? m.data ?? null,
      postingDate: m.data ?? null,
      description: m.descricaoOriginal,
      amount,
      rawAmount,
      direction,
      economicKind: kind === "UNKNOWN" ? defaultEconomicKind(direction, "BANK_STATEMENT_PDF") : kind,
      cardLast4: null,
      installmentCurrent: null,
      installmentTotal: null,
      extractionConfidence: 100,
      rawText: m.descricaoOriginal,
    } satisfies FinancialCandidateEvent;
  });
}

export type CardStatementItemLike = {
  date: string | null;
  description: string;
  amount: number;
  cardLast4?: string | null;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
  category?: string | null;
};

/** Fatura de cartão (PDF) → candidatos. Metadados e pagamento não entram. */
export function cardItemsToCandidates(
  itens: CardStatementItemLike[],
  ctx: CandidateContext,
): FinancialCandidateEvent[] {
  return itens
    .filter((i) => i.category !== "METADATA_SUMMARY" && i.category !== "PAYMENT")
    .map((i, index) => {
      const { amount, direction, rawAmount } = normalizeAmount(
        i.amount,
        "CREDIT_CARD_STATEMENT_PDF",
      );
      return {
      ...base(
        ctx,
        "CREDIT_CARD_STATEMENT_PDF",
        index + 1,
        `${ctx.evidenceId}#${index + 1}#${i.date ?? "s-data"}#${i.amount.toFixed(2)}`,
      ),
      eventDate: i.date ?? null,
      postingDate: null,
      description: i.description,
      amount,
      rawAmount,
      direction,
      economicKind: defaultEconomicKind(direction, "CREDIT_CARD_STATEMENT_PDF"),
      cardLast4: i.cardLast4 ?? null,
      installmentCurrent: i.installmentCurrent ?? null,
      installmentTotal: i.installmentTotal ?? null,
      extractionConfidence: 100,
      rawText: i.description,
      } satisfies FinancialCandidateEvent;
    });
}

/** Print/foto lido por IA → candidatos de confiança média/baixa. */
export function imageReadingToCandidates(
  movimentos: (ScreenshotMovement & { confianca?: number; cardLast4?: string | null })[],
  ctx: CandidateContext,
  sourceType: EvidenceSourceType = "BANK_SCREENSHOT",
): FinancialCandidateEvent[] {
  return movimentos.map((m, i) => {
    const { amount, direction, rawAmount } = normalizeAmount(m.valor, sourceType);
    return {
      ...base(
        ctx,
        sourceType,
        i + 1,
        `${ctx.evidenceId}#${i + 1}#${m.data ?? "s-data"}#${Math.abs(m.valor).toFixed(2)}#${normalizarDescricao(m.descricao).slice(0, 24)}`,
      ),
      eventDate: m.data ?? null,
      postingDate: m.data ?? null,
      description: m.descricao,
      amount,
      rawAmount,
      direction,
      economicKind: defaultEconomicKind(direction, sourceType),
      cardLast4: m.cardLast4 ?? null,
      installmentCurrent: null,
      installmentTotal: null,
      extractionConfidence: typeof m.confianca === "number" ? m.confianca : 60,
      rawText: m.descricao,
    } satisfies FinancialCandidateEvent;
  });
}
