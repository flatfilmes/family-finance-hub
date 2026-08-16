import { describe, expect, it } from "vitest";
import { detectBankStatement, selectBankStatementParser } from "./parse";

describe("detecção estrutural do extrato Banco do Brasil", () => {
  const textos = [
    "Extrato de Conta Corrente",
    "Agência: 3540-8",
    "Conta: 12211-4",
    "Período: 01 a 31/01/2026",
    "Saldo Anterior 4.115,02",
    "Saldo do dia 3.096,75",
    "S A L D O",
  ];

  it("reconhece o layout sem depender do nome do banco", () => {
    const d = detectBankStatement(textos);
    expect(d.status).toBe("PASS");
    expect(d.bank).toBe("BANCO_DO_BRASIL");
    expect(d.matchedSignals.length).toBeGreaterThanOrEqual(3);
  });

  it("a chave detectada existe no registry de parsers", () => {
    const sel = selectBankStatementParser(detectBankStatement(textos).bank);
    expect(sel.status).toBe("FOUND");
    expect(sel.requestedBank).toBe("BANCO_DO_BRASIL");
    expect(sel.name).toBe("EXTRATO_BANCO_DO_BRASIL_PDF");
  });
});
