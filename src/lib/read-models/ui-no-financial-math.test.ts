/**
 * FASE 4A — Guarda de arquitetura: UI NÃO É MOTOR FINANCEIRO.
 *
 * As telas financeiras não podem somar dinheiro por conta própria.
 * Qualquer novo `.reduce(` nessas rotas indica cálculo paralelo — o número
 * deve nascer num read model canônico (src/lib/read-models).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TELAS_FINANCEIRAS = [
  "src/routes/_authenticated/dashboard.tsx",
  "src/routes/_authenticated/relatorios.tsx",
  "src/routes/_authenticated/bancos.index.tsx",
  "src/routes/_authenticated/cartoes.index.tsx",
  "src/routes/_authenticated/planejamento.tsx",
];

describe("UI_NAO_E_MOTOR_FINANCEIRO", () => {
  it.each(TELAS_FINANCEIRAS)("%s não soma dinheiro na própria tela", (arquivo) => {
    const código = readFileSync(arquivo, "utf8");
    expect(código).not.toContain(".reduce(");
  });

  it("as telas financeiras leem os read models canônicos", () => {
    for (const arquivo of TELAS_FINANCEIRAS) {
      const código = readFileSync(arquivo, "utf8");
      const usaReadModel =
        código.includes("useFinancialReadModel") ||
        código.includes("useBankOverview") ||
        código.includes("useCardCommitments") ||
        código.includes("read-models") ||
        // Planejamento lê o motor canônico de orçamento (useBudgetProgress).
        código.includes("useBudgetProgress");
      expect(usaReadModel, `${arquivo} deveria consumir um read model canônico`).toBe(true);
    }
  });
});
