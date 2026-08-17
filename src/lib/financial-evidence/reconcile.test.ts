import { describe, expect, it } from "vitest";
import { reconcileFinancialCandidates } from "./reconcile";
import type { ExistingEconomicRecord, FinancialCandidateEvent } from "./types";

const candidato = (over: Partial<FinancialCandidateEvent> = {}): FinancialCandidateEvent => ({
  evidenceId: "ev-1",
  sourceType: "CREDIT_CARD_STATEMENT_PDF",
  sourceItemKey: "ev-1#001",
  ordem: 1,
  eventDate: "2026-08-09",
  postingDate: null,
  description: "PADARIA DAMA DOCE",
  amount: 9.04,
  direction: "OUT",
  economicKind: "PURCHASE",
  cardLast4: "9982",
  installmentCurrent: null,
  installmentTotal: null,
  bankAccountId: null,
  creditCardId: "card-1",
  institutionId: null,
  extractionConfidence: 100,
  sourceConfidence: "HIGH",
  rawText: null,
  ...over,
});

const registro = (over: Partial<ExistingEconomicRecord> = {}): ExistingEconomicRecord => ({
  kind: "PURCHASE",
  id: "p-1",
  date: "2026-08-09",
  amount: 9.04,
  direction: "OUT",
  description: "Padaria Dama Doce",
  creditCardId: "card-1",
  cardLast4: "9982",
  ...over,
});

describe("engine unificada de reconciliação", () => {
  it("reconhece o mesmo evento como EXACT_MATCH e não cria nada", () => {
    const r = reconcileFinancialCandidates({ candidates: [candidato()], existing: [registro()] });
    expect(r.resolutions[0]!.status).toBe("EXACT_MATCH");
    expect(r.summary.newItem).toBe(0);
    expect(r.status).toBe("ALREADY_INGESTED");
  });

  it("é idempotente por linhagem mesmo com descrição diferente", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato({ description: "PAD DAMA DOCE 09/08" })],
      existing: [registro({ lineageItemKeys: ["ev-1#001"], description: "outra coisa" })],
    });
    expect(r.resolutions[0]!.status).toBe("EXACT_MATCH");
    expect(r.resolutions[0]!.reason).toContain("idempotente");
  });

  it("nunca funde duas compras legítimas iguais no mesmo dia", () => {
    const r = reconcileFinancialCandidates({
      candidates: [
        candidato({ sourceItemKey: "ev-1#001", amount: 9.04 }),
        candidato({ sourceItemKey: "ev-1#002", ordem: 2, amount: 20.25 }),
      ],
      existing: [registro({ id: "p-1", amount: 9.04 })],
    });
    expect(r.resolutions[0]!.status).toBe("EXACT_MATCH");
    expect(r.resolutions[1]!.status).toBe("NEW_ITEM");
  });

  it("consome cada registro existente no máximo uma vez", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato({ sourceItemKey: "a" }), candidato({ sourceItemKey: "b", ordem: 2 })],
      existing: [registro()],
    });
    expect(r.resolutions[0]!.matched?.id).toBe("p-1");
    expect(r.resolutions[1]!.matched).toBeNull();
    expect(r.resolutions[1]!.status).toBe("NEW_ITEM");
  });

  it("marca CONFLICT quando dois registros disputam o mesmo lançamento", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato()],
      existing: [registro({ id: "p-1" }), registro({ id: "p-2", kind: "TRANSACTION" })],
    });
    expect(r.resolutions[0]!.status).toBe("CONFLICT");
    expect(r.status).toBe("BLOCKED");
  });

  it("não associa valores diferentes nem sentidos opostos", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato({ amount: 90.4 }), candidato({ sourceItemKey: "x", direction: "IN" })],
      existing: [registro()],
    });
    expect(r.resolutions.every((x) => x.matched === null)).toBe(true);
  });

  it("não associa registro de outro cartão/conta", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato()],
      existing: [registro({ creditCardId: "card-2" })],
    });
    expect(r.resolutions[0]!.status).toBe("NEW_ITEM");
  });

  it("rejeita datas fora da janela de 10 dias", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato()],
      existing: [registro({ date: "2026-06-09" })],
    });
    expect(r.resolutions[0]!.matched).toBeNull();
  });

  it("classifica NEW_IN_OVERLAP quando o período já foi coberto por outra evidência", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato()],
      existing: [],
      coveredPeriods: [
        { evidenceId: "ev-0", inicio: "2026-08-01", fim: "2026-08-31", rotulo: "fatura de agosto" },
      ],
    });
    expect(r.resolutions[0]!.status).toBe("NEW_IN_OVERLAP");
    expect(r.status).toBe("REVIEW_REQUIRED");
  });

  it("print de app não fecha sozinho: EXACT vira STRONG", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato({ sourceType: "BANK_SCREENSHOT", sourceConfidence: "MEDIUM" })],
      existing: [registro()],
    });
    expect(r.resolutions[0]!.status).toBe("STRONG_MATCH");
  });

  it("soma apenas o que criaria evento novo", () => {
    const r = reconcileFinancialCandidates({
      candidates: [candidato({ amount: 10 }), candidato({ sourceItemKey: "y", ordem: 2, amount: 25.5 })],
      existing: [],
    });
    expect(r.summary.totalNovo).toBe(35.5);
    expect(r.status).toBe("PASS");
  });
});
