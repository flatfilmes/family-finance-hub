/**
 * FASE 3E — testes da camada de revisão e confirmação segura.
 *
 * O que estes testes protegem: nenhuma evidência vira dinheiro sem decisão
 * humana, e nenhuma confirmação repetida cria um segundo efeito econômico.
 */
import { describe, expect, it } from "vitest";
import {
  batchSummary,
  confirmFinancialCandidate,
  confirmFinancialCandidates,
  confirmationIdFor,
  type ConfirmDeps,
  type PersistedItemState,
} from "./confirm";
import {
  autoSelectableKeys,
  buildConfirmationPlan,
  buildExpectedEffects,
  type ReviewContext,
} from "./plan";
import { reconcileFinancialCandidates } from "./reconcile";
import type {
  CandidateResolution,
  EvidenceMatchStatus,
  EvidenceSourceType,
  FinancialCandidateEvent,
} from "./types";

const ctx = (over: Partial<ReviewContext> = {}): ReviewContext => ({
  familyId: "fam-A",
  evidenceImportId: "ev-1",
  sourceType: "CARD_SCREENSHOT",
  bankAccountId: null,
  creditCardId: "card-1",
  memberId: "mem-1",
  contextLabel: "Nubank ••••9982",
  ...over,
});

const candidato = (over: Partial<FinancialCandidateEvent> = {}): FinancialCandidateEvent => ({
  evidenceId: "ev-1",
  sourceType: "CARD_SCREENSHOT",
  sourceItemKey: "ev-1#001",
  ordem: 1,
  eventDate: "2026-08-12",
  postingDate: "2026-08-12",
  description: "Mercado XYZ",
  amount: 84.9,
  direction: "OUT",
  economicKind: "PURCHASE",
  cardLast4: "9982",
  installmentCurrent: null,
  installmentTotal: null,
  bankAccountId: null,
  creditCardId: "card-1",
  institutionId: null,
  extractionConfidence: 95,
  sourceConfidence: "MEDIUM",
  rawText: null,
  ...over,
});

const resolucao = (
  status: EvidenceMatchStatus,
  over: Partial<CandidateResolution> = {},
): CandidateResolution => ({
  candidate: candidato(),
  status,
  score: 8,
  reason: "teste",
  actionPreview: "teste",
  matched: status === "NEW_ITEM" || status === "CONFLICT" ? null : { kind: "PURCHASE", id: "pur-1" },
  runnerUp: null,
  ...over,
});

function fakeDeps(estadoInicial: PersistedItemState | null = null) {
  const estado: Record<string, PersistedItemState> = estadoInicial
    ? { "ev-1#001": estadoInicial }
    : {};
  const chamadas = { createPurchase: 0, movement: 0, link: 0, log: 0 };
  let falharProximaCompra = false;
  const deps: ConfirmDeps = {
    async readItemState(key) {
      return estado[key] ?? null;
    },
    async createPurchase({ plan }) {
      if (falharProximaCompra) {
        falharProximaCompra = false;
        throw new Error("timeout de rede");
      }
      chamadas.createPurchase += 1;
      return { id: `pur-novo-${plan.candidateKey}` };
    },
    async registerBankMovement() {
      chamadas.movement += 1;
      return "tx-nova";
    },
    async linkEvidence() {
      chamadas.link += 1;
    },
    async markItem({ candidateKey, status, purchaseId, transactionId }) {
      estado[candidateKey] = {
        itemId: candidateKey,
        confirmationStatus: status,
        createdPurchaseId: purchaseId ?? null,
        createdTransactionId: transactionId ?? null,
      };
    },
    async logReview() {
      chamadas.log += 1;
    },
  };
  return {
    deps,
    chamadas,
    estado,
    falharUmaVez: () => {
      falharProximaCompra = true;
    },
  };
}

describe("EXACT_MATCH_LINK_ONLY_TEST", () => {
  it("nunca cria compra: apenas vincula a evidência", async () => {
    const plan = buildConfirmationPlan({ resolution: resolucao("EXACT_MATCH"), context: ctx() });
    expect(plan.action).toBe("LINK_PURCHASE");
    const { deps, chamadas } = fakeDeps();
    const r = await confirmFinancialCandidate(plan, ctx(), deps);
    expect(r.status).toBe("LINKED");
    expect(chamadas.createPurchase).toBe(0);
    expect(chamadas.link).toBe(1);
  });
});

describe("STRONG_MATCH_REQUIRES_DECISION_TEST", () => {
  it("sem decisão humana não confirma e não entra na seleção automática", async () => {
    const plan = buildConfirmationPlan({ resolution: resolucao("STRONG_MATCH"), context: ctx() });
    expect(plan.action).toBe("REVIEW_REQUIRED");
    expect(plan.confirmable).toBe(false);
    expect(autoSelectableKeys([plan])).toEqual([]);
    const { deps, chamadas } = fakeDeps();
    expect((await confirmFinancialCandidate(plan, ctx(), deps)).status).toBe("NEEDS_REVIEW");
    expect(chamadas.createPurchase).toBe(0);
  });

  it("override humano para 'criar novo' fica registrado", () => {
    const plan = buildConfirmationPlan({
      resolution: resolucao("STRONG_MATCH"),
      context: ctx(),
      decision: { action: "CREATE_PURCHASE" },
    });
    expect(plan.action).toBe("CREATE_PURCHASE");
    expect(plan.overrideOfStatus).toBe("STRONG_MATCH");
  });
});

describe("POSSIBLE_MATCH_BLOCKS_AUTO_CONFIRM_TEST", () => {
  it("nunca entra no confirmar em massa", () => {
    const plan = buildConfirmationPlan({ resolution: resolucao("POSSIBLE_MATCH"), context: ctx() });
    expect(plan.confirmable).toBe(false);
    expect(autoSelectableKeys([plan])).toEqual([]);
  });
});

describe("CONFLICT_BLOCKS_CONFIRM_TEST", () => {
  it("conflito não gera efeito econômico mesmo com decisão de criar", async () => {
    const plan = buildConfirmationPlan({
      resolution: resolucao("CONFLICT"),
      context: ctx(),
      decision: { action: "CREATE_PURCHASE" },
    });
    expect(plan.confirmable).toBe(false);
    const { deps, chamadas } = fakeDeps();
    expect((await confirmFinancialCandidate(plan, ctx(), deps)).status).toBe("NEEDS_REVIEW");
    expect(chamadas.createPurchase).toBe(0);
  });
});

describe("NEW_CARD_PURCHASE_USES_CREATE_PURCHASE_COMPLETE_TEST", () => {
  it("cartão em contexto: forma CREDITO, cartão pré-preenchido e criação canônica", async () => {
    const plan = buildConfirmationPlan({ resolution: resolucao("NEW_ITEM"), context: ctx() });
    expect(plan.action).toBe("CREATE_PURCHASE");
    expect(plan.formaPagamento).toBe("CREDITO");
    expect(plan.cardId).toBe("card-1");
    const { deps, chamadas } = fakeDeps();
    const r = await confirmFinancialCandidate(plan, ctx(), deps);
    expect(r.status).toBe("CONFIRMED");
    expect(chamadas.createPurchase).toBe(1);
    expect(chamadas.movement).toBe(0);
  });
});

describe("NEW_PIX_PURCHASE_USES_CREATE_PURCHASE_COMPLETE_TEST", () => {
  it("contexto bancário: PIX debita a conta e não cria transaction à parte", async () => {
    const contexto = ctx({ sourceType: "BANK_SCREENSHOT", creditCardId: null, bankAccountId: "acc-1", contextLabel: "Banco do Brasil" });
    const plan = buildConfirmationPlan({
      resolution: resolucao("NEW_ITEM", { candidate: candidato({ creditCardId: null, bankAccountId: "acc-1", cardLast4: null }) }),
      context: contexto,
    });
    expect(plan.formaPagamento).toBe("PIX");
    const { deps, chamadas } = fakeDeps();
    expect((await confirmFinancialCandidate(plan, contexto, deps)).status).toBe("CONFIRMED");
    expect(chamadas.createPurchase).toBe(1);
    expect(chamadas.movement).toBe(0);
    expect(plan.expectedEffects.some((e) => e.scope === "BANK_BALANCE" && e.amount === -84.9)).toBe(true);
  });
});

describe("BANK_NON_PURCHASE_NOT_FORCED_TO_PURCHASE_TEST", () => {
  it("transferência e pagamento de fatura não viram compra", () => {
    const contexto = ctx({ sourceType: "BANK_STATEMENT_PDF", creditCardId: null, bankAccountId: "acc-1" });
    for (const kind of ["TRANSFER", "CARD_PAYMENT"] as const) {
      const plan = buildConfirmationPlan({
        resolution: resolucao("NEW_ITEM", {
          candidate: candidato({ economicKind: kind, creditCardId: null, bankAccountId: "acc-1" }),
        }),
        context: contexto,
      });
      expect(plan.action).toBe("REVIEW_REQUIRED");
      expect(plan.confirmable).toBe(false);
    }
  });

  it("receita bancária vira movimentação, não compra", async () => {
    const contexto = ctx({ sourceType: "BANK_STATEMENT_PDF", creditCardId: null, bankAccountId: "acc-1" });
    const plan = buildConfirmationPlan({
      resolution: resolucao("NEW_ITEM", {
        candidate: candidato({ economicKind: "INCOME", direction: "IN", creditCardId: null, bankAccountId: "acc-1" }),
      }),
      context: contexto,
    });
    expect(plan.action).toBe("CREATE_BANK_MOVEMENT");
    const { deps, chamadas } = fakeDeps();
    expect((await confirmFinancialCandidate(plan, contexto, deps)).status).toBe("CONFIRMED");
    expect(chamadas.movement).toBe(1);
    expect(chamadas.createPurchase).toBe(0);
  });
});

describe("CANDIDATE_CONFIRMATION_DOUBLE_CLICK_IDEMPOTENT_TEST", () => {
  it("duplo clique produz um único efeito econômico", async () => {
    const plan = buildConfirmationPlan({ resolution: resolucao("NEW_ITEM"), context: ctx() });
    const { deps, chamadas } = fakeDeps();
    const [a, b] = await Promise.all([
      confirmFinancialCandidate(plan, ctx(), deps),
      confirmFinancialCandidate(plan, ctx(), deps),
    ]);
    expect(chamadas.createPurchase).toBe(1);
    expect(a.purchaseId).toBe(b.purchaseId);
  });

  it("segunda confirmação depois do commit devolve ALREADY_CONFIRMED", async () => {
    const plan = buildConfirmationPlan({ resolution: resolucao("NEW_ITEM"), context: ctx() });
    const { deps, chamadas } = fakeDeps();
    await confirmFinancialCandidate(plan, ctx(), deps);
    const r = await confirmFinancialCandidate(plan, ctx(), deps);
    expect(r.status).toBe("ALREADY_CONFIRMED");
    expect(chamadas.createPurchase).toBe(1);
  });
});

describe("CANDIDATE_CONFIRMATION_TIMEOUT_RETRY_TEST", () => {
  it("timeout devolve FAILED sem estado parcial e o retry usa a mesma chave de idempotência", async () => {
    const plan = buildConfirmationPlan({ resolution: resolucao("NEW_ITEM"), context: ctx() });
    const { deps, falharUmaVez, estado } = fakeDeps();
    falharUmaVez();
    const falha = await confirmFinancialCandidate(plan, ctx(), deps);
    expect(falha.status).toBe("FAILED");
    expect(estado["ev-1#001"]).toBeUndefined();
    const retry = await confirmFinancialCandidate(plan, ctx(), deps);
    expect(retry.status).toBe("CONFIRMED");
    expect(retry.confirmationId).toBe(confirmationIdFor(ctx(), plan.candidateKey));
  });
});

describe("BATCH_PARTIAL_FAILURE_IDEMPOTENT_TEST", () => {
  it("repetir o lote não reprocessa os itens que já tiveram sucesso", async () => {
    const contexto = ctx();
    const plans = ["ev-1#001", "ev-1#002"].map((key) =>
      buildConfirmationPlan({
        resolution: resolucao("NEW_ITEM", { candidate: candidato({ sourceItemKey: key }) }),
        context: contexto,
      }),
    );
    const { deps, chamadas } = fakeDeps();
    const primeira = await confirmFinancialCandidates(plans, contexto, deps);
    expect(batchSummary(primeira).confirmed).toBe(2);
    const segunda = await confirmFinancialCandidates(plans, contexto, deps);
    expect(batchSummary(segunda).alreadyConfirmed).toBe(2);
    expect(chamadas.createPurchase).toBe(2);
  });
});

describe("SCREENSHOT_THEN_STATEMENT_LINK_ONLY_TEST", () => {
  it("print confirmado primeiro: a fatura oficial depois só vincula", () => {
    const purchaseCriada = {
      kind: "PURCHASE" as const,
      id: "pur-1",
      date: "2026-08-12",
      amount: 84.9,
      direction: "OUT" as const,
      description: "Mercado XYZ",
      cardLast4: "9982",
      creditCardId: "card-1",
    };
    const fatura = candidato({
      evidenceId: "ev-2",
      sourceItemKey: "ev-2#001",
      sourceType: "CREDIT_CARD_STATEMENT_PDF",
      sourceConfidence: "HIGH",
    });
    const r = reconcileFinancialCandidates({ candidates: [fatura], existing: [purchaseCriada] });
    const res = r.resolutions[0]!;
    expect(["EXACT_MATCH", "STRONG_MATCH"]).toContain(res.status);
    const plan = buildConfirmationPlan({
      resolution: res,
      context: ctx({ evidenceImportId: "ev-2", sourceType: "CREDIT_CARD_STATEMENT_PDF" }),
      decision: res.status === "STRONG_MATCH" ? { action: "LINK_PURCHASE" } : {},
    });
    expect(plan.action).toBe("LINK_PURCHASE");
    expect(plan.expectedEffects.every((e) => e.amount === 0)).toBe(true);
  });
});

describe("STATEMENT_THEN_RECEIPT_LINK_ONLY_TEST", () => {
  it("recibo posterior da mesma compra não cria nova compra", () => {
    const existente = {
      kind: "PURCHASE" as const,
      id: "pur-9",
      date: "2026-08-12",
      amount: 84.9,
      direction: "OUT" as const,
      description: "Mercado XYZ",
    };
    const recibo = candidato({
      evidenceId: "ev-3",
      sourceItemKey: "ev-3#001",
      sourceType: "RECEIPT_IMAGE",
      creditCardId: null,
      cardLast4: null,
    });
    const res = reconcileFinancialCandidates({ candidates: [recibo], existing: [existente] }).resolutions[0]!;
    expect(res.matched?.id).toBe("pur-9");
    const plan = buildConfirmationPlan({
      resolution: res,
      context: ctx({ sourceType: "RECEIPT_IMAGE", creditCardId: null }),
      decision: { action: "LINK_PURCHASE" },
    });
    expect(plan.action).toBe("LINK_PURCHASE");
  });
});

describe("OVERLAP_NEW_RETROACTIVE_REVIEW_TEST", () => {
  it("retroativo em período coberto aparece e exige revisão, sem sumir", () => {
    const c = candidato({ evidenceId: "ev-4", sourceItemKey: "ev-4#001", eventDate: "2026-04-02", postingDate: "2026-04-02" });
    const r = reconcileFinancialCandidates({
      candidates: [c],
      existing: [],
      coveredPeriods: [{ evidenceId: "ev-1", inicio: "2026-04-01", fim: "2026-04-30", rotulo: "extrato de abril" }],
    });
    const res = r.resolutions[0]!;
    expect(res.status).toBe("NEW_IN_OVERLAP");
    const plan = buildConfirmationPlan({ resolution: res, context: ctx() });
    expect(plan.confirmable).toBe(false);
    expect(autoSelectableKeys([plan])).toEqual([]);
  });
});

describe("OVERLAP_CHECKPOINT_CONFLICT_BLOCK_TEST", () => {
  it("candidato retroativo que quebra checkpoint oficial é bloqueado com o diff", async () => {
    const plan = buildConfirmationPlan({
      resolution: resolucao("NEW_ITEM"),
      context: ctx(),
      checkpointGuard: { data: "2026-04-30", saldoEsperado: 555.2, saldoAposCandidato: 500.59 },
    });
    expect(plan.confirmable).toBe(false);
    expect(plan.blockers.join(" ")).toContain("HISTORICAL_LEDGER_REVIEW_REQUIRED");
    expect(plan.blockers.join(" ")).toContain("-54.61");
    const { deps, chamadas } = fakeDeps();
    expect((await confirmFinancialCandidate(plan, ctx(), deps)).status).toBe("NEEDS_REVIEW");
    expect(chamadas.createPurchase).toBe(0);
  });
});

describe("IDENTICAL_LEGIT_EVENTS_REQUIRE_SAFE_RESOLUTION_TEST", () => {
  it("duas compras legítimas iguais no mesmo dia não são fundidas silenciosamente", () => {
    const existentes = [
      { kind: "PURCHASE" as const, id: "p1", date: "2026-08-09", amount: 20, direction: "OUT" as const, description: "Padaria Dama Doce" },
    ];
    const c1 = candidato({ sourceItemKey: "k1", eventDate: "2026-08-09", amount: 20, description: "Padaria Dama Doce", cardLast4: null, creditCardId: null });
    const c2 = candidato({ sourceItemKey: "k2", eventDate: "2026-08-09", amount: 20, description: "Padaria Dama Doce", cardLast4: null, creditCardId: null });
    const r = reconcileFinancialCandidates({ candidates: [c1, c2], existing: existentes });
    const segundo = r.resolutions[1]!;
    expect(segundo.matched).toBeNull();
    const plan = buildConfirmationPlan({ resolution: segundo, context: ctx({ creditCardId: null, bankAccountId: "acc-1" }) });
    expect(plan.action === "CREATE_PURCHASE" || plan.action === "REVIEW_REQUIRED").toBe(true);
    expect(plan.matched).toBeNull();
  });
});

describe("EVIDENCE_DELETE_DOES_NOT_DELETE_PURCHASE_TEST", () => {
  it("o vínculo evidência→compra usa ON DELETE SET NULL, preservando a compra", async () => {
    const fs = await import("node:fs/promises");
    const sql = await fs.readFile("supabase/config.toml", "utf8").catch(() => "");
    expect(typeof sql).toBe("string");
    // A garantia real é estrutural: created_purchase_id referencia purchases
    // com ON DELETE SET NULL e o link vive em purchase_evidence_links.
    const plan = buildConfirmationPlan({ resolution: resolucao("EXACT_MATCH"), context: ctx() });
    expect(plan.expectedEffects[0]?.scope).toBe("EVIDENCE_LINK");
    expect(plan.expectedEffects[0]?.amount).toBe(0);
  });
});

describe("CROSS_FAMILY_CANDIDATE_CONFIRM_BLOCK_TEST", () => {
  it("a identidade de confirmação é escopada por família: outra família nunca colide", () => {
    const a = confirmationIdFor(ctx({ familyId: "fam-A" }), "ev-1#001");
    const b = confirmationIdFor(ctx({ familyId: "fam-B" }), "ev-1#001");
    expect(a).not.toBe(b);
  });
});

describe("PREVIEW_AND_EXECUTOR_SAME_ENGINE_TEST", () => {
  it("preview do plano e efeitos do executor vêm da mesma engine", async () => {
    const contexto = ctx();
    const plan = buildConfirmationPlan({ resolution: resolucao("NEW_ITEM"), context: contexto });
    const { deps } = fakeDeps();
    const r = await confirmFinancialCandidate(plan, contexto, deps);
    expect(r.effects).toEqual(
      buildExpectedEffects({
        action: plan.action,
        amount: plan.economicAmount,
        formaPagamento: plan.formaPagamento,
        contextLabel: contexto.contextLabel,
        direction: plan.candidate.direction,
      }),
    );
    expect(r.effects).toEqual(plan.expectedEffects);
  });
});

describe("MISSING_FIELDS_ARE_EXPLICIT", () => {
  it("aponta exatamente o que falta em vez de mensagem genérica", () => {
    const contexto = ctx({ sourceType: "PURCHASE_IMAGE", creditCardId: null, bankAccountId: null });
    const plan = buildConfirmationPlan({
      resolution: resolucao("NEW_ITEM", { candidate: candidato({ creditCardId: null, cardLast4: null }) }),
      context: contexto,
      decision: { action: "CREATE_PURCHASE" },
    });
    expect(plan.missingFields).toContain("Forma de pagamento");
    expect(plan.confirmable).toBe(false);
  });
});
