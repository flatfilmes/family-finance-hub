/**
 * Dry run padrão por origem do documento.
 *
 * Garante que a tela de diagnóstico SEMPRE execute o parser real do módulo —
 * nunca exporte `parser: null` por falta de configuração da tela.
 */
import { bankStatementDryRun } from "@/lib/bank-statement-parsers/diagnostic";
import { cardStatementDryRun } from "@/lib/card-statement-parsers/diagnostic";
import { purchaseReceiptDryRun } from "@/lib/documents.diagnostic";
import type { DiagnosticSource, ParserDryRun } from "@/lib/pdf-diagnostic/diagnostic-types";

export function defaultDryRunForSource(source: DiagnosticSource): ParserDryRun | undefined {
  if (source === "BANK_STATEMENT") return bankStatementDryRun;
  if (source === "CARD_STATEMENT") return cardStatementDryRun;
  if (source === "PURCHASE_RECEIPT") return purchaseReceiptDryRun;
  return undefined;
}
