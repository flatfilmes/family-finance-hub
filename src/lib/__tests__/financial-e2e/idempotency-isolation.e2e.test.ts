/**
 * FASE 3F — IDEMPOTÊNCIA, REIMPORTAÇÃO E ISOLAMENTO ENTRE FAMÍLIAS.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardItemsToCandidates } from "@/lib/financial-evidence/candidates";
import { purchasesToRecords } from "@/lib/financial-evidence/existing";
import { reconcileFinancialCandidates } from "@/lib/financial-evidence/reconcile";
import { buildConfirmationPlan } from "@/lib/financial-evidence/plan";
import { confirmationIdFor, confirmFinancialCandidates } from "@/lib/financial-evidence/confirm";
import { CARD_A, FAMILY_A, FAMILY_B, createWorld, marcarConfirmado, reviewContext } from "./world";

const ITENS = [
  { date: "2026-08-12", description: "MERCADO XYZ", amount: 84.9 },
  { date: "2026-08-13", description: "POSTO SHELL", amount: 150 },
];

const ctx = reviewContext({
  evidenceImportId: "ev-fatura",
  sourceType: "CREDIT_CARD_STATEMENT_PDF",
  creditCardId: CARD_A,
  bankAccountId: null,
});

function planosDe(existing: ReturnType<typeof purchasesToRecords> = []) {
  const candidatos = cardItemsToCandidates(ITENS, { evidenceId: "ev-fatura", creditCardId: CARD_A });
  const res = reconcileFinancialCandidates({ candidates: candidatos, existing });
  return res.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctx }));
}

describe("E2E_DOUBLE_CONFIRMATION", () => {
  it("confirmar duas vezes o mesmo plano não cria segundo efeito econômico", async () => {
    const world = createWorld();
    const planos = planosDe();

    const primeira = await confirmFinancialCandidates(planos, ctx, world.deps);
    expect(primeira.every((o) => o.status === "CONFIRMED")).toBe(true);
    expect(world.state.purchases).toHaveLength(2);
    expect(world.chamadas.createPurchase).toBe(2);

    const segunda = await confirmFinancialCandidates(planos, ctx, world.deps);
    expect(segunda.every((o) => o.status === "ALREADY_CONFIRMED")).toBe(true);
    expect(world.state.purchases).toHaveLength(2);
    expect(world.chamadas.createPurchase).toBe(2);

    // Identidade de confirmação é determinística (mesma família + import + item).
    for (const p of planos) {
      expect(confirmationIdFor(ctx, p.candidateKey)).toBe(confirmationIdFor(ctx, p.candidateKey));
    }
    expect(confirmationIdFor(ctx, planos[0]!.candidateKey)).not.toBe(
      confirmationIdFor(ctx, planos[1]!.candidateKey),
    );
  });

  it("timeout após o commit: o retry reconhece o efeito já persistido", async () => {
    const world = createWorld();
    const planos = planosDe();
    world.perderRespostaUmaVez();

    const parcial = await confirmFinancialCandidates([planos[0]!], ctx, world.deps);
    expect(parcial[0]!.status).toBe("FAILED");
    expect(world.state.purchases).toHaveLength(1); // commit ocorreu, resposta se perdeu

    // O backend reconciliou o commit e marcou o item.
    marcarConfirmado(world, planos[0]!.candidateKey, world.state.purchases[0]!.id);

    const retry = await confirmFinancialCandidates([planos[0]!], ctx, world.deps);
    expect(retry[0]!.status).toBe("ALREADY_CONFIRMED");
    expect(world.state.purchases).toHaveLength(1);
  });
});

describe("E2E_REIMPORT_SAME_DOCUMENT", () => {
  it("reimportar o mesmo documento reconhece tudo e não recria nada", async () => {
    const world = createWorld();
    await confirmFinancialCandidates(planosDe(), ctx, world.deps);
    const depoisDaPrimeira = world.state.purchases.length;

    const segundaImportacao = cardItemsToCandidates(ITENS, {
      evidenceId: "ev-fatura-reimport",
      creditCardId: CARD_A,
    });
    const res = reconcileFinancialCandidates({
      candidates: segundaImportacao,
      existing: purchasesToRecords(world.state.purchases),
    });
    expect(res.resolutions.every((r) => r.status === "EXACT_MATCH")).toBe(true);
    expect(res.summary.exact).toBe(2);

    const ctx2 = reviewContext({
      evidenceImportId: "ev-fatura-reimport",
      sourceType: "CREDIT_CARD_STATEMENT_PDF",
      creditCardId: CARD_A,
      bankAccountId: null,
    });
    const outcomes = await confirmFinancialCandidates(
      res.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctx2 })),
      ctx2,
      world.deps,
    );
    expect(outcomes.every((o) => o.status === "LINKED")).toBe(true);
    expect(world.state.purchases).toHaveLength(depoisDaPrimeira);
    expect(world.chamadas.createPurchase).toBe(2);
  });
});

describe("E2E_CROSS_FAMILY_ISOLATION", () => {
  it("a identidade de confirmação é escopada por família", () => {
    const ctxA = reviewContext({ familyId: FAMILY_A });
    const ctxB = reviewContext({ familyId: FAMILY_B });
    expect(confirmationIdFor(ctxA, "item-1")).not.toBe(confirmationIdFor(ctxB, "item-1"));
  });

  it("as tabelas econômicas e de evidência têm RLS habilitada com escopo de família", () => {
    const sql = readFileSync("supabase/migrations/_all.sql", "utf8").toUpperCase();
    const tabelas = [
      "PURCHASES",
      "TRANSACTIONS",
      "BANK_ACCOUNTS",
      "CREDIT_CARDS",
      "CARD_INVOICES",
      "EXPENSE_INSTALLMENTS",
      "FINANCIAL_EVIDENCE_IMPORTS",
      "FINANCIAL_EVIDENCE_ITEMS",
    ];
    for (const t of tabelas) {
      expect(sql).toContain(`ALTER TABLE PUBLIC.${t} ENABLE ROW LEVEL SECURITY`);
    }
    // Nenhuma política econômica pode ser aberta a qualquer usuário autenticado.
    expect(sql).not.toContain("USING (TRUE)");
  });
});
