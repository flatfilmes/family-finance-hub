/**
 * TESTE BLOQUEANTE DO GOLDEN DATASET — Banco do Brasil.
 *
 * Roda o parser ISOLADO (sem Supabase, sem ledger, sem reconciliação) sobre as
 * fixtures oficiais e compara com os valores conferidos nos PDFs reais.
 * Qualquer mudança de período, abertura, contagem ou fechamento = FAIL.
 */
import { describe, expect, it } from "vitest";
import { parseBancoDoBrasilLines } from "./banco-do-brasil";
import { toCanonicalStatement } from "@/lib/bank-statements/canonical";
import { statementReportRow, validateStatement } from "@/lib/bank-statements/validate";
import { BB_GOLDEN_2026, goldenFor } from "@/lib/bank-statements/golden";
import type { PdfLine } from "@/lib/pdf-extract";

type Fixture = {
  statementId: string;
  bank?: string | null;
  account?: string | null;
  lines: PdfLine[];
};

const modulos = import.meta.glob<{ default: Fixture }>("./__fixtures__/*.lines.json", {
  eager: true,
});

const fixtures = Object.entries(modulos).map(([caminho, mod]) => {
  const monthKey = caminho.match(/bb-(\d{4}-\d{2})\.lines\.json$/)?.[1] ?? "";
  return { monthKey, caminho, fixture: (mod as unknown as { default: Fixture }).default ?? (mod as unknown as Fixture) };
});

describe("Golden dataset Banco do Brasil 2026", () => {
  it("todo mês com fixture precisa existir no golden dataset", () => {
    for (const f of fixtures) expect(goldenFor(f.monthKey), `fixture ${f.caminho}`).toBeDefined();
  });

  if (!fixtures.length) {
    it.skip("nenhuma fixture disponível — gere pelo Diagnóstico de importação", () => {});
  }

  for (const esperado of BB_GOLDEN_2026) {
    const encontrada = fixtures.find((f) => f.monthKey === esperado.monthKey);
    const rodar = encontrada ? describe : describe.skip;

    rodar(`${esperado.monthKey}`, () => {
      const parsed = parseBancoDoBrasilLines(encontrada?.fixture.lines ?? []);
      const canonical = toCanonicalStatement(parsed, {
        statementId: encontrada?.fixture.statementId ?? esperado.monthKey,
        bank: encontrada?.fixture.bank ?? "Banco do Brasil",
        account: encontrada?.fixture.account ?? null,
      });
      const validation = validateStatement(canonical);
      const row = statementReportRow(canonical, validation);

      it("período vem do documento", () => {
        expect(row.period).toBe(`${esperado.periodStart} → ${esperado.periodEnd}`);
        expect(row.monthKey).toBe(esperado.monthKey);
      });

      it("abertura, contagem e fechamento batem com o PDF real", () => {
        expect(canonical.openingBalance.amount).toBe(esperado.opening);
        expect(canonical.transactions).toHaveLength(esperado.transactions);
        expect(canonical.closingBalance.amount).toBe(esperado.closing);
      });

      it("equação do extrato fecha sem ajuste artificial", () => {
        expect(validation.math.difference).toBe(0);
        expect(validation.math.ok).toBe(true);
      });

      it("todo movimento tem data contábil e sourceId único", () => {
        expect(canonical.transactions.every((t) => !!t.postingDate)).toBe(true);
        expect(new Set(canonical.transactions.map((t) => t.sourceId)).size).toBe(
          canonical.transactions.length,
        );
      });
    });
  }
});
