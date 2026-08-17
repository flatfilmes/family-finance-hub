/**
 * FASE 3F — E2E do trilho de cartão e evidências visuais.
 * Print → compra; fatura confirmando o print; recibo; compras legítimas iguais.
 */
import { describe, expect, it } from "vitest";
import { cardItemsToCandidates, imageReadingToCandidates } from "@/lib/financial-evidence/candidates";
import { purchasesToRecords } from "@/lib/financial-evidence/existing";
import { reconcileFinancialCandidates } from "@/lib/financial-evidence/reconcile";
import { buildConfirmationPlan } from "@/lib/financial-evidence/plan";
import { confirmFinancialCandidates } from "@/lib/financial-evidence/confirm";
import { CARD_A, createWorld, reviewContext } from "./world";

const PRINT = [
  { data: "2026-08-12", descricao: "MERCADO XYZ", valor: -84.9 },
  { data: "2026-08-13", descricao: "POSTO SHELL", valor: -150 },
  { data: "2026-08-14", descricao: "NETFLIX", valor: -39.9 },
];

const ctxCartao = (evidenceId: string, sourceType: "CARD_SCREENSHOT" | "CREDIT_CARD_STATEMENT_PDF" | "RECEIPT_IMAGE") =>
  reviewContext({ evidenceImportId: evidenceId, sourceType, creditCardId: CARD_A, bankAccountId: null });

async function confirmarPrint(world: ReturnType<typeof createWorld>) {
  const candidatos = imageReadingToCandidates(PRINT, { evidenceId: "ev-print", creditCardId: CARD_A }, "CARD_SCREENSHOT");
  const res = reconcileFinancialCandidates({ candidates: candidatos, existing: [] });
  const ctx = ctxCartao("ev-print", "CARD_SCREENSHOT");
  const planos = res.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctx }));
  const outcomes = await confirmFinancialCandidates(planos, ctx, world.deps);
  return { res, planos, outcomes };
}

describe("E2E_CARD_SCREENSHOT_TO_PURCHASE", () => {
  it("print vira compra de cartão: obrigação sobe, saldo bancário não muda", async () => {
    const world = createWorld();
    const { res, planos, outcomes } = await confirmarPrint(world);

    expect(res.summary.newItem).toBe(3);
    expect(planos.every((p) => p.action === "CREATE_PURCHASE" && p.formaPagamento === "CREDITO")).toBe(true);
    for (const p of planos) {
      const escopos = p.expectedEffects.map((e) => e.scope);
      expect(escopos).toContain("CARD_OBLIGATION");
      expect(p.expectedEffects.find((e) => e.scope === "BANK_BALANCE")?.amount).toBe(0);
    }
    expect(outcomes.every((o) => o.status === "CONFIRMED")).toBe(true);
    expect(world.state.purchases).toHaveLength(3);
    expect(world.state.transactions).toHaveLength(0);
    expect(world.netWorth()).toBe(0);

    const obrigacao = world.state.purchases.reduce((a, p) => a + Number(p.valor_total), 0);
    expect(Math.round(obrigacao * 100) / 100).toBe(274.8);
  });
});

describe("E2E_CARD_STATEMENT_AFTER_SCREENSHOT", () => {
  it("a fatura oficial reconhece o que o print já criou e não duplica nada", async () => {
    const world = createWorld();
    await confirmarPrint(world);
    const antes = world.state.purchases.length;

    const fatura = cardItemsToCandidates(
      [
        { date: "2026-08-12", description: "MERCADO XYZ", amount: 84.9 },
        { date: "2026-08-13", description: "POSTO SHELL", amount: 150 },
        { date: "2026-08-14", description: "NETFLIX", amount: 39.9 },
        { date: "2026-08-20", description: "IFOOD", amount: 62.3 },
        { date: "2026-08-25", description: "PAGAMENTO RECEBIDO", amount: -274.8, category: "PAYMENT" },
      ],
      { evidenceId: "ev-fatura", creditCardId: CARD_A },
    );
    expect(fatura).toHaveLength(4); // pagamento de fatura nunca vira candidato

    const res = reconcileFinancialCandidates({
      candidates: fatura,
      existing: purchasesToRecords(world.state.purchases),
    });
    const porDescricao = Object.fromEntries(res.resolutions.map((r) => [r.candidate.description, r.status]));
    expect(porDescricao["MERCADO XYZ"]).toBe("EXACT_MATCH");
    expect(porDescricao["POSTO SHELL"]).toBe("EXACT_MATCH");
    expect(porDescricao["NETFLIX"]).toBe("EXACT_MATCH");
    expect(porDescricao["IFOOD"]).toBe("NEW_ITEM");

    const ctx = ctxCartao("ev-fatura", "CREDIT_CARD_STATEMENT_PDF");
    const planos = res.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctx }));
    const outcomes = await confirmFinancialCandidates(planos, ctx, world.deps);

    expect(outcomes.filter((o) => o.status === "LINKED")).toHaveLength(3);
    expect(outcomes.filter((o) => o.status === "CONFIRMED")).toHaveLength(1);
    expect(world.state.purchases).toHaveLength(antes + 1);
    expect(world.state.transactions).toHaveLength(0);
  });
});

describe("E2E_RECEIPT_IMAGE_DUPLICATE", () => {
  it("recibo de compra já registrada nunca cria segundo evento econômico", async () => {
    const world = createWorld();
    await confirmarPrint(world);
    const antes = world.state.purchases.length;

    const recibo = imageReadingToCandidates(
      [{ data: "2026-08-12", descricao: "Mercado XYZ Ltda", valor: -84.9, confianca: 70 }],
      { evidenceId: "ev-recibo", creditCardId: CARD_A },
      "RECEIPT_IMAGE",
    );
    const res = reconcileFinancialCandidates({
      candidates: recibo,
      existing: purchasesToRecords(world.state.purchases),
    });
    const resolucao = res.resolutions[0]!;
    expect(["EXACT_MATCH", "STRONG_MATCH"]).toContain(resolucao.status);

    const ctx = ctxCartao("ev-recibo", "RECEIPT_IMAGE");
    const plano = buildConfirmationPlan({ resolution: resolucao, context: ctx });
    // STRONG_MATCH exige decisão humana; EXACT_MATCH vincula. Nunca cria sozinho.
    expect(["LINK_PURCHASE", "LINK_TRANSACTION", "REVIEW_REQUIRED"]).toContain(plano.action);
    const outcomes = await confirmFinancialCandidates([plano], ctx, world.deps);
    expect(outcomes[0]!.status === "LINKED" || outcomes[0]!.status === "NEEDS_REVIEW").toBe(true);
    expect(world.state.purchases).toHaveLength(antes);
  });
});

describe("E2E_LEGIT_DUPLICATE_PURCHASES", () => {
  it("duas compras verdadeiras idênticas: a segunda não é engolida como duplicata", async () => {
    const world = createWorld();
    const doisCafes = imageReadingToCandidates(
      [
        { data: "2026-08-18", descricao: "CAFETERIA GRAO", valor: -18.5 },
        { data: "2026-08-18", descricao: "CAFETERIA GRAO", valor: -18.5 },
      ],
      { evidenceId: "ev-print-2", creditCardId: CARD_A },
      "CARD_SCREENSHOT",
    );
    // As duas linhas têm identidade distinta (ordem) e ambas são novas.
    expect(new Set(doisCafes.map((c) => c.sourceItemKey)).size).toBe(2);

    const res = reconcileFinancialCandidates({ candidates: doisCafes, existing: [] });
    expect(res.resolutions.every((r) => r.status === "NEW_ITEM")).toBe(true);

    const ctx = ctxCartao("ev-print-2", "CARD_SCREENSHOT");
    const planos = res.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctx }));
    await confirmFinancialCandidates(planos, ctx, world.deps);
    expect(world.state.purchases).toHaveLength(2);

    // A fatura traz as duas: como existem dois candidatos e dois registros
    // idênticos, a engine declara CONFLICT e exige decisão humana em vez de
    // adivinhar — nunca cria uma terceira compra.
    const fatura = cardItemsToCandidates(
      [
        { date: "2026-08-18", description: "CAFETERIA GRAO", amount: 18.5 },
        { date: "2026-08-18", description: "CAFETERIA GRAO", amount: 18.5 },
      ],
      { evidenceId: "ev-fatura-2", creditCardId: CARD_A },
    );
    const res2 = reconcileFinancialCandidates({
      candidates: fatura,
      existing: purchasesToRecords(world.state.purchases),
    });
    expect(res2.resolutions.every((r) => r.status === "CONFLICT")).toBe(true);
    expect(res2.summary.conflict).toBe(2);

    const ctx2 = ctxCartao("ev-fatura-2", "CREDIT_CARD_STATEMENT_PDF");
    const planos2 = res2.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctx2 }));
    expect(planos2.every((p) => !p.confirmable && p.action !== "CREATE_PURCHASE")).toBe(true);
    await confirmFinancialCandidates(planos2, ctx2, world.deps);
    expect(world.state.purchases).toHaveLength(2);
  });
});
