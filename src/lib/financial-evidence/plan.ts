/**
 * FASE 3E — CONFIRMATION PLAN.
 *
 * Entre a reconciliação e o dinheiro existe SEMPRE um plano determinístico.
 * A UI mostra o plano ("o que vai acontecer"); o executor recebe o MESMO
 * plano. Não existe caminho onde a tela decide algo que o executor recalcula
 * por conta própria.
 *
 * Regras inegociáveis desta camada:
 * - EXACT_MATCH nunca cria evento econômico: só vincula evidência.
 * - STRONG/POSSIBLE_MATCH exigem decisão humana explícita.
 * - CONFLICT nunca vira efeito econômico.
 * - NEW_ITEM só é confirmável quando todos os campos obrigatórios existem.
 * - Movimento bancário que não é compra jamais é forçado a virar compra.
 */
import type {
  CandidateResolution,
  EconomicKind,
  EvidenceMatchStatus,
  EvidenceSourceType,
  FinancialCandidateEvent,
} from "./types";

export type ConfirmationAction =
  | "LINK_PURCHASE"
  | "LINK_TRANSACTION"
  | "CREATE_PURCHASE"
  | "CREATE_BANK_MOVEMENT"
  | "IGNORE"
  | "REVIEW_REQUIRED";

export type EffectScope =
  | "PURCHASE"
  | "BANK_BALANCE"
  | "CARD_OBLIGATION"
  | "EVIDENCE_LINK"
  | "NONE";

export type ExpectedEffect = {
  scope: EffectScope;
  amount: number;
  description: string;
};

/** Rótulos de apresentação — o status de domínio continua o mesmo. */
export const STATUS_LABELS: Record<EvidenceMatchStatus, string> = {
  EXACT_MATCH: "Já cadastrado",
  STRONG_MATCH: "Provavelmente já cadastrado",
  POSSIBLE_MATCH: "Precisa revisar",
  NEW_ITEM: "Novo lançamento",
  NEW_IN_OVERLAP: "Novo em período coberto",
  CONFLICT: "Conflito",
  IGNORED: "Ignorado",
};

export type ReviewContext = {
  familyId: string;
  evidenceImportId: string;
  sourceType: EvidenceSourceType;
  bankAccountId: string | null;
  creditCardId: string | null;
  memberId: string | null;
  /** Nome amigável do contexto (ex.: "Nubank ••••9982"). */
  contextLabel?: string | undefined;
};

/** Decisão humana sobre um candidato específico. */
export type CandidateDecision = {
  action?: ConfirmationAction;
  categoriaId?: string | null;
  formaPagamento?: "PIX" | "DEBITO" | "CREDITO" | "DINHEIRO" | "BOLETO" | "TRANSFERENCIA" | null;
  memberId?: string | null;
  observacao?: string;
};

/** Checkpoint oficial que o candidato retroativo colocaria em risco. */
export type CheckpointGuard = {
  data: string;
  saldoEsperado: number;
  saldoAposCandidato: number;
};

export type ConfirmationPlan = {
  candidateKey: string;
  candidate: FinancialCandidateEvent;
  originalStatus: EvidenceMatchStatus;
  action: ConfirmationAction;
  /** Registrado quando o humano contraria a sugestão da engine. */
  overrideOfStatus: EvidenceMatchStatus | null;
  accountId: string | null;
  cardId: string | null;
  memberId: string | null;
  categoriaId: string | null;
  formaPagamento: CandidateDecision["formaPagamento"];
  economicAmount: number;
  matched: CandidateResolution["matched"];
  expectedEffects: ExpectedEffect[];
  missingFields: string[];
  blockers: string[];
  /** Só pode ser executado quando não há bloqueios nem campos faltantes. */
  confirmable: boolean;
};

const CONTEXTO_CARTAO: EvidenceSourceType[] = ["CREDIT_CARD_STATEMENT_PDF", "CARD_SCREENSHOT"];

/** Movimentos bancários que possuem fluxo canônico seguro de criação direta. */
const MOVIMENTO_SEGURO: EconomicKind[] = ["INCOME", "FEE", "REFUND"];

function formaPadrao(ctx: ReviewContext, decision: CandidateDecision) {
  if (decision.formaPagamento) return decision.formaPagamento;
  if (ctx.creditCardId || CONTEXTO_CARTAO.includes(ctx.sourceType)) return "CREDITO" as const;
  if (ctx.bankAccountId) return "PIX" as const;
  return null;
}

/**
 * ENGINE ÚNICA DE EFEITO. Preview e executor consomem exatamente esta função:
 * é proibido existir uma segunda fórmula no React.
 */
export function buildExpectedEffects(input: {
  action: ConfirmationAction;
  amount: number;
  formaPagamento: CandidateDecision["formaPagamento"];
  contextLabel?: string | undefined;
  direction: FinancialCandidateEvent["direction"];
}): ExpectedEffect[] {
  const valor = Math.abs(input.amount);
  const onde = input.contextLabel ? ` (${input.contextLabel})` : "";
  switch (input.action) {
    case "LINK_PURCHASE":
      return [
        { scope: "EVIDENCE_LINK", amount: 0, description: "Nenhuma compra nova: a evidência será vinculada a uma compra já existente." },
      ];
    case "LINK_TRANSACTION":
      return [
        { scope: "EVIDENCE_LINK", amount: 0, description: "Nenhuma movimentação nova: a evidência será vinculada a um lançamento já existente." },
      ];
    case "CREATE_PURCHASE": {
      const efeitos: ExpectedEffect[] = [
        { scope: "PURCHASE", amount: valor, description: `Será criada 1 compra de ${valor.toFixed(2)}` },
      ];
      if (input.formaPagamento === "CREDITO") {
        efeitos.push({ scope: "BANK_BALANCE", amount: 0, description: "Saldo bancário imediato: sem alteração" });
        efeitos.push({ scope: "CARD_OBLIGATION", amount: valor, description: `Obrigação de cartão${onde}: +${valor.toFixed(2)}` });
      } else if (input.formaPagamento === "PIX" || input.formaPagamento === "DEBITO" || input.formaPagamento === "TRANSFERENCIA") {
        efeitos.push({ scope: "BANK_BALANCE", amount: -valor, description: `Conta${onde}: -${valor.toFixed(2)}` });
      }
      return efeitos;
    }
    case "CREATE_BANK_MOVEMENT": {
      const sinal = input.direction === "IN" ? valor : -valor;
      return [
        {
          scope: "BANK_BALANCE",
          amount: sinal,
          description: `Conta${onde}: ${sinal >= 0 ? "+" : "-"}${valor.toFixed(2)} (movimentação, não é compra)`,
        },
      ];
    }
    case "IGNORE":
      return [{ scope: "NONE", amount: 0, description: "Nenhum efeito financeiro. O item fica registrado como ignorado." }];
    default:
      return [{ scope: "NONE", amount: 0, description: "Revisão humana pendente: nenhum efeito financeiro será produzido." }];
  }
}

/** Ações que o usuário pode escolher para um determinado status. */
export function allowedActions(status: EvidenceMatchStatus): ConfirmationAction[] {
  switch (status) {
    case "EXACT_MATCH":
      return ["LINK_PURCHASE", "LINK_TRANSACTION", "IGNORE"];
    case "STRONG_MATCH":
    case "POSSIBLE_MATCH":
      return ["LINK_PURCHASE", "LINK_TRANSACTION", "CREATE_PURCHASE", "IGNORE"];
    case "NEW_ITEM":
    case "NEW_IN_OVERLAP":
      return ["CREATE_PURCHASE", "CREATE_BANK_MOVEMENT", "IGNORE"];
    case "CONFLICT":
      return ["IGNORE", "REVIEW_REQUIRED"];
    default:
      return ["IGNORE"];
  }
}

function acaoDeVinculo(matched: CandidateResolution["matched"]): ConfirmationAction {
  if (matched?.kind === "TRANSACTION" || matched?.kind === "BANK_STATEMENT_ITEM") return "LINK_TRANSACTION";
  return "LINK_PURCHASE";
}

function acaoPadrao(r: CandidateResolution, ctx: ReviewContext): ConfirmationAction {
  switch (r.status) {
    case "EXACT_MATCH":
      return acaoDeVinculo(r.matched);
    case "STRONG_MATCH":
    case "POSSIBLE_MATCH":
    case "CONFLICT":
      return "REVIEW_REQUIRED";
    case "IGNORED":
      return "IGNORE";
    case "NEW_IN_OVERLAP":
      return "REVIEW_REQUIRED";
    default: {
      const kind = r.candidate.economicKind;
      if (kind === "PURCHASE") return "CREATE_PURCHASE";
      if (MOVIMENTO_SEGURO.includes(kind) && (ctx.bankAccountId || r.candidate.bankAccountId)) {
        return "CREATE_BANK_MOVEMENT";
      }
      return "REVIEW_REQUIRED";
    }
  }
}

/** Constrói o plano determinístico de confirmação de UM candidato. */
export function buildConfirmationPlan(input: {
  resolution: CandidateResolution;
  context: ReviewContext;
  decision?: CandidateDecision;
  checkpointGuard?: CheckpointGuard | null;
}): ConfirmationPlan {
  const { resolution: r, context: ctx } = input;
  const decision = input.decision ?? {};
  const c = r.candidate;

  const escolhida = decision.action;
  const permitidas = allowedActions(r.status);
  const action: ConfirmationAction =
    escolhida && permitidas.includes(escolhida) ? escolhida : acaoPadrao(r, ctx);

  const overrideOfStatus =
    (r.status === "STRONG_MATCH" || r.status === "POSSIBLE_MATCH" || r.status === "NEW_IN_OVERLAP") &&
    (action === "CREATE_PURCHASE" || action === "CREATE_BANK_MOVEMENT")
      ? r.status
      : null;

  const accountId = ctx.bankAccountId ?? c.bankAccountId ?? null;
  const cardId = ctx.creditCardId ?? c.creditCardId ?? null;
  const forma = formaPadrao(ctx, decision);

  const blockers: string[] = [];
  const missingFields: string[] = [];

  if (r.status === "CONFLICT" && action !== "IGNORE") {
    blockers.push("Conflito não resolvido: dois registros existentes disputam este lançamento.");
  }
  if (input.checkpointGuard && (action === "CREATE_PURCHASE" || action === "CREATE_BANK_MOVEMENT")) {
    const g = input.checkpointGuard;
    blockers.push(
      `HISTORICAL_LEDGER_REVIEW_REQUIRED — checkpoint de ${g.data}: esperado ${g.saldoEsperado.toFixed(2)}, após candidato ${g.saldoAposCandidato.toFixed(2)} (diferença ${(g.saldoAposCandidato - g.saldoEsperado).toFixed(2)}).`,
    );
  }
  if (action === "REVIEW_REQUIRED") {
    blockers.push(
      r.status === "NEW_ITEM"
        ? `Não existe fluxo seguro de criação automática para o tipo econômico ${c.economicKind}.`
        : "Decisão humana obrigatória antes de qualquer efeito financeiro.",
    );
  }
  if ((action === "LINK_PURCHASE" || action === "LINK_TRANSACTION") && !r.matched) {
    blockers.push("Nenhum registro existente selecionado para vincular.");
  }

  if (action === "CREATE_PURCHASE") {
    if (!(c.eventDate ?? c.postingDate)) missingFields.push("Data");
    if (!c.description?.trim()) missingFields.push("Descrição");
    if (!(Math.abs(c.amount) > 0)) missingFields.push("Valor");
    if (!forma) missingFields.push("Forma de pagamento");
    if (forma === "CREDITO" && !cardId) missingFields.push("Cartão");
    if ((forma === "PIX" || forma === "DEBITO" || forma === "TRANSFERENCIA") && !accountId) {
      missingFields.push("Conta bancária");
    }
    if (c.direction === "IN") {
      blockers.push("Entrada de dinheiro não vira compra — use uma movimentação bancária.");
    }
  }

  if (action === "CREATE_BANK_MOVEMENT") {
    if (!accountId) missingFields.push("Conta bancária");
    if (!(c.eventDate ?? c.postingDate)) missingFields.push("Data");
    if (!(Math.abs(c.amount) > 0)) missingFields.push("Valor");
    if (!MOVIMENTO_SEGURO.includes(c.economicKind) && c.economicKind !== "PURCHASE") {
      blockers.push(
        `Movimento do tipo ${c.economicKind} exige fluxo canônico próprio (transferência, pagamento de fatura, ajuste).`,
      );
    }
  }

  const expectedEffects = buildExpectedEffects({
    action,
    amount: c.amount,
    formaPagamento: forma,
    contextLabel: ctx.contextLabel,
    direction: c.direction,
  });

  return {
    candidateKey: c.sourceItemKey,
    candidate: c,
    originalStatus: r.status,
    action,
    overrideOfStatus,
    accountId,
    cardId,
    memberId: decision.memberId ?? ctx.memberId ?? null,
    categoriaId: decision.categoriaId ?? null,
    formaPagamento: forma,
    economicAmount: Math.abs(c.amount),
    matched: r.matched,
    expectedEffects,
    missingFields,
    blockers,
    confirmable: blockers.length === 0 && missingFields.length === 0 && action !== "REVIEW_REQUIRED",
  };
}

/** Candidatos elegíveis à confirmação em massa: somente NEW_ITEM completo. */
export function autoSelectableKeys(plans: ConfirmationPlan[]): string[] {
  return plans
    .filter(
      (p) =>
        p.originalStatus === "NEW_ITEM" &&
        p.confirmable &&
        (p.action === "CREATE_PURCHASE" || p.action === "CREATE_BANK_MOVEMENT"),
    )
    .map((p) => p.candidateKey);
}
