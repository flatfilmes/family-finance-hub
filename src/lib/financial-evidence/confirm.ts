/**
 * FASE 3E — EXECUTOR CANÔNICO DE CONFIRMAÇÃO.
 *
 * Recebe um ConfirmationPlan já validado e chama SOMENTE operações canônicas
 * do domínio (create_purchase_complete, register_bank_movement, vínculo de
 * evidência). Nenhum SQL econômico é replicado aqui.
 *
 * Idempotência: cada candidato possui identidade estável (família + import +
 * sourceItemKey). Repetir a confirmação — duplo clique, retry, timeout depois
 * do commit, duas abas — devolve ALREADY_CONFIRMED/ALREADY_LINKED e nunca
 * produz um segundo efeito econômico.
 */
import { buildExpectedEffects, type ConfirmationPlan, type ExpectedEffect, type ReviewContext } from "./plan";

export type ConfirmationStatus =
  | "CONFIRMED"
  | "LINKED"
  | "ALREADY_CONFIRMED"
  | "ALREADY_LINKED"
  | "IGNORED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type ConfirmationOutcome = {
  candidateKey: string;
  status: ConfirmationStatus;
  confirmationId: string;
  purchaseId?: string | null;
  transactionId?: string | null;
  effects: ExpectedEffect[];
  message?: string;
};

export type PersistedItemState = {
  itemId: string | null;
  confirmationStatus: string;
  createdPurchaseId: string | null;
  createdTransactionId: string | null;
};

export type ConfirmDeps = {
  readItemState: (candidateKey: string) => Promise<PersistedItemState | null>;
  createPurchase: (input: {
    plan: ConfirmationPlan;
    context: ReviewContext;
    confirmationId: string;
  }) => Promise<{ id: string }>;
  registerBankMovement: (input: {
    plan: ConfirmationPlan;
    context: ReviewContext;
    confirmationId: string;
  }) => Promise<string>;
  linkEvidence: (input: {
    plan: ConfirmationPlan;
    context: ReviewContext;
    itemId: string | null;
  }) => Promise<void>;
  markItem: (input: {
    candidateKey: string;
    status: ConfirmationStatus;
    confirmationId: string;
    purchaseId?: string | null;
    transactionId?: string | null;
    plan: ConfirmationPlan;
  }) => Promise<void>;
  logReview: (input: {
    plan: ConfirmationPlan;
    context: ReviewContext;
    confirmationId: string;
    outcome: ConfirmationOutcome;
  }) => Promise<void>;
};

/** UUID determinístico (não criptográfico) derivado da identidade do candidato. */
export function confirmationIdFor(context: ReviewContext, candidateKey: string) {
  const semente = `${context.familyId}|${context.evidenceImportId}|${candidateKey}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let hex = "";
  for (let i = 0; i < semente.length; i += 1) {
    h1 = Math.imul(h1 ^ semente.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + semente.charCodeAt(i) + i, 2246822519) >>> 0;
  }
  for (let bloco = 0; bloco < 4; bloco += 1) {
    h1 = Math.imul(h1 ^ (h2 + bloco), 2654435761) >>> 0;
    h2 = Math.imul(h2 ^ (h1 + bloco), 1597334677) >>> 0;
    hex += h1.toString(16).padStart(8, "0");
  }
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

const emAndamento = new Map<string, Promise<ConfirmationOutcome>>();

async function executar(
  plan: ConfirmationPlan,
  context: ReviewContext,
  deps: ConfirmDeps,
): Promise<ConfirmationOutcome> {
  const confirmationId = confirmationIdFor(context, plan.candidateKey);
  const efeitos = buildExpectedEffects({
    action: plan.action,
    amount: plan.economicAmount,
    formaPagamento: plan.formaPagamento,
    contextLabel: context.contextLabel,
    direction: plan.candidate.direction,
  });
  const base = { candidateKey: plan.candidateKey, confirmationId, effects: efeitos };

  // 1. Nada com bloqueio, campo faltante ou revisão pendente produz dinheiro.
  if (!plan.confirmable && plan.action !== "IGNORE") {
    return {
      ...base,
      status: "NEEDS_REVIEW",
      message: [...plan.blockers, ...plan.missingFields.map((f) => `Falta: ${f}`)].join(" · "),
    };
  }

  // 2. Idempotência por estado persistido.
  const estado = await deps.readItemState(plan.candidateKey);
  if (estado?.createdPurchaseId || estado?.createdTransactionId) {
    return {
      ...base,
      status: "ALREADY_CONFIRMED",
      purchaseId: estado.createdPurchaseId,
      transactionId: estado.createdTransactionId,
    };
  }
  if (estado?.confirmationStatus === "LINKED" && (plan.action === "LINK_PURCHASE" || plan.action === "LINK_TRANSACTION")) {
    return { ...base, status: "ALREADY_LINKED" };
  }
  if (estado?.confirmationStatus === "IGNORED" && plan.action === "IGNORE") {
    return { ...base, status: "IGNORED" };
  }

  try {
    switch (plan.action) {
      case "LINK_PURCHASE":
      case "LINK_TRANSACTION": {
        await deps.linkEvidence({ plan, context, itemId: estado?.itemId ?? null });
        const outcome: ConfirmationOutcome = { ...base, status: "LINKED" };
        await deps.markItem({ candidateKey: plan.candidateKey, status: "LINKED", confirmationId, plan });
        await deps.logReview({ plan, context, confirmationId, outcome });
        return outcome;
      }
      case "CREATE_PURCHASE": {
        const purchase = await deps.createPurchase({ plan, context, confirmationId });
        const outcome: ConfirmationOutcome = { ...base, status: "CONFIRMED", purchaseId: purchase.id };
        await deps.markItem({
          candidateKey: plan.candidateKey,
          status: "CONFIRMED",
          confirmationId,
          purchaseId: purchase.id,
          plan,
        });
        await deps.linkEvidence({ plan: { ...plan, matched: { kind: "PURCHASE", id: purchase.id } }, context, itemId: estado?.itemId ?? null });
        await deps.logReview({ plan, context, confirmationId, outcome });
        return outcome;
      }
      case "CREATE_BANK_MOVEMENT": {
        const transactionId = await deps.registerBankMovement({ plan, context, confirmationId });
        const outcome: ConfirmationOutcome = { ...base, status: "CONFIRMED", transactionId };
        await deps.markItem({
          candidateKey: plan.candidateKey,
          status: "CONFIRMED",
          confirmationId,
          transactionId,
          plan,
        });
        await deps.logReview({ plan, context, confirmationId, outcome });
        return outcome;
      }
      case "IGNORE": {
        const outcome: ConfirmationOutcome = { ...base, status: "IGNORED" };
        await deps.markItem({ candidateKey: plan.candidateKey, status: "IGNORED", confirmationId, plan });
        await deps.logReview({ plan, context, confirmationId, outcome });
        return outcome;
      }
      default:
        return { ...base, status: "NEEDS_REVIEW", message: "Revisão humana pendente." };
    }
  } catch (e) {
    return { ...base, status: "FAILED", message: e instanceof Error ? e.message : "Falha na confirmação." };
  }
}

/** Confirma UM candidato. Chamadas concorrentes compartilham o mesmo voo. */
export function confirmFinancialCandidate(
  plan: ConfirmationPlan,
  context: ReviewContext,
  deps: ConfirmDeps,
): Promise<ConfirmationOutcome> {
  const chave = `${context.evidenceImportId}|${plan.candidateKey}`;
  const existente = emAndamento.get(chave);
  if (existente) return existente;
  const promessa = executar(plan, context, deps).finally(() => emAndamento.delete(chave));
  emAndamento.set(chave, promessa);
  return promessa;
}

/**
 * Confirmação em massa: cada candidato é executado individualmente, com
 * idempotência própria. A falha de um item nunca cria estado parcial nele nem
 * reprocessa os que já tiveram sucesso.
 */
export async function confirmFinancialCandidates(
  plans: ConfirmationPlan[],
  context: ReviewContext,
  deps: ConfirmDeps,
): Promise<ConfirmationOutcome[]> {
  const resultados: ConfirmationOutcome[] = [];
  for (const plan of plans) {
    resultados.push(await confirmFinancialCandidate(plan, context, deps));
  }
  return resultados;
}

export function batchSummary(outcomes: ConfirmationOutcome[]) {
  const conta = (s: ConfirmationStatus) => outcomes.filter((o) => o.status === s).length;
  return {
    confirmed: conta("CONFIRMED"),
    linked: conta("LINKED"),
    failed: conta("FAILED"),
    needsReview: conta("NEEDS_REVIEW"),
    alreadyConfirmed: conta("ALREADY_CONFIRMED") + conta("ALREADY_LINKED"),
    ignored: conta("IGNORED"),
  };
}
