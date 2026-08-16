/**
 * Tipo do lançamento na revisão da fatura.
 *
 * O parser sugere um tipo (`tipo_sugerido`), mas quem decide é a pessoa:
 * `tipo_revisado` guarda a correção sem nunca alterar o que foi lido do PDF.
 */
import type { Tone } from "@/lib/status";

export type ReviewType = "NORMAL" | "RECORRENTE" | "PARCELADA" | "TAXA" | "CREDITO" | "IGNORAR";

export const REVIEW_TYPES: ReviewType[] = [
  "NORMAL",
  "RECORRENTE",
  "PARCELADA",
  "TAXA",
  "CREDITO",
  "IGNORAR",
];

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  NORMAL: "Compra normal",
  RECORRENTE: "Recorrente (assinatura)",
  PARCELADA: "Compra parcelada",
  TAXA: "Taxa / serviço",
  CREDITO: "Crédito / estorno",
  IGNORAR: "Ignorar",
};

export const REVIEW_TYPE_TONES: Record<ReviewType, Tone> = {
  NORMAL: "info",
  RECORRENTE: "ok",
  PARCELADA: "info",
  TAXA: "muted",
  CREDITO: "muted",
  IGNORAR: "muted",
};

type TipoItemLike = {
  tipo_sugerido: string;
  tipo_revisado?: string | null;
  valor: number | string;
  parcela_atual?: number | null;
  total_parcelas?: number | null;
};

/** Tipo derivado da leitura do PDF, quando o usuário ainda não escolheu. */
export function defaultReviewType(item: TipoItemLike): ReviewType {
  const valor = Number(item.valor) || 0;
  if (item.tipo_sugerido === "PAGAMENTO") return "IGNORAR";
  if (item.tipo_sugerido === "ESTORNO" || valor < 0) return "CREDITO";
  if (
    item.tipo_sugerido === "TAXA" ||
    item.tipo_sugerido === "JUROS" ||
    item.tipo_sugerido === "AJUSTE"
  ) {
    return "TAXA";
  }
  if (item.total_parcelas && item.total_parcelas > 1) return "PARCELADA";
  return "NORMAL";
}

/** Tipo vigente: escolha do usuário (ou regra aplicada) ou o padrão do parser. */
export function resolveReviewType(item: TipoItemLike): ReviewType {
  const escolhido = item.tipo_revisado as ReviewType | null | undefined;
  return escolhido && REVIEW_TYPES.includes(escolhido) ? escolhido : defaultReviewType(item);
}

/** O usuário corrigiu manualmente (ou por regra) o tipo lido do PDF? */
export function tipoFoiCorrigido(item: TipoItemLike) {
  return !!item.tipo_revisado && item.tipo_revisado !== defaultReviewType(item);
}
