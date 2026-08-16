/**
 * Linguagem visual única de status do aplicativo.
 *
 * Regra: o mesmo significado tem sempre a mesma cor, em qualquer página.
 * - ok (verde): pago, concluído, saudável
 * - warn (amarelo): atenção, perto do vencimento
 * - danger (vermelho): atrasado, crítico
 * - info (azul): informativo com destaque (compromisso em cartão)
 * - muted (neutro): informativo sem urgência (cancelado, inativo)
 *
 * Aqui só existe apresentação — nenhum cálculo financeiro.
 */

export type Tone = "ok" | "warn" | "danger" | "info" | "muted";

export const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-red-500/15 text-red-700 dark:text-red-400",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  muted: "bg-muted text-muted-foreground",
};

export const TONE_DOTS: Record<Tone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-sky-500",
  muted: "bg-muted-foreground/50",
};

export const TONE_BORDERS: Record<Tone, string> = {
  ok: "border-emerald-500/40",
  warn: "border-amber-500/40",
  danger: "border-red-500/40",
  info: "border-sky-500/40",
  muted: "border-border",
};

/** Status de pagamento de uma compra. */
export const PAYMENT_STATUS_TONES = {
  PAGO: "ok",
  COMPROMETIDO: "info",
  PENDENTE: "warn",
  PENDENTE_PAGAMENTO: "warn",
  PARCIALMENTE_PAGA: "warn",
  CANCELADO: "muted",
} as const;

/** Status de fatura de cartão: Aberta / Fechada / Paga. */
export const INVOICE_STATUS_TONES = {
  ABERTA: "info",
  FECHADA: "warn",
  PAGA: "ok",
} as const;

/** Status de uma movimentação bancária. */
export const TRANSACTION_STATUS_TONES = {
  CONFIRMADA: "ok",
  PENDENTE: "warn",
  CANCELADA: "muted",
} as const;

/** Barra de uso (limite de cartão, orçamento): mesma escala em todo o sistema. */
export function usageTone(percent: number): Tone {
  if (percent >= 100) return "danger";
  if (percent >= 80) return "warn";
  return "ok";
}
