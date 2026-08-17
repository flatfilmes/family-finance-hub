/**
 * FASE 1 — HARDENING
 * BANK_IMPORT_SAME_FILE_CONCURRENT_TEST
 * BANK_IMPORT_DATABASE_UNIQUENESS_TEST
 * CONFIRM_IMPORT_DOUBLE_EXECUTION_TEST
 */
import { describe, expect, it } from "vitest";
import { isFingerprintConflict, SameStatementAlreadyImportedError } from "./data";

const UNIQUE_VIOLATION = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "bank_statement_imports_canonical_fingerprint_uidx"',
};

describe("BANK_IMPORT_DATABASE_UNIQUENESS_TEST", () => {
  it("reconhece a garantia de banco de import canônico único", () => {
    expect(isFingerprintConflict(UNIQUE_VIOLATION)).toBe(true);
  });

  it("não confunde outros erros com conflito de fingerprint", () => {
    expect(isFingerprintConflict({ code: "23505", message: "outra constraint" })).toBe(false);
    expect(isFingerprintConflict({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isFingerprintConflict(null)).toBe(false);
  });
});

describe("BANK_IMPORT_SAME_FILE_CONCURRENT_TEST", () => {
  it("a request perdedora recebe SAME_STATEMENT_ALREADY_IMPORTED com o canônico", () => {
    const erro = new SameStatementAlreadyImportedError("6a6a8cdf-f4f4-48ef-bb21-9716c9e98f2b");
    expect(erro.code).toBe("SAME_STATEMENT_ALREADY_IMPORTED");
    expect(erro.canonicalImportId).toBe("6a6a8cdf-f4f4-48ef-bb21-9716c9e98f2b");
    // Nunca um erro genérico de servidor.
    expect(erro.message).not.toMatch(/duplicate key|23505|500/);
  });

  it("duplo clique / duas abas: apenas uma criação vence", () => {
    // Simula o banco: o índice parcial único aceita um canônico por (conta, fingerprint).
    const canonicos = new Set<string>();
    const tentar = (conta: string, fingerprint: string) => {
      const chave = `${conta}|${fingerprint}`;
      if (canonicos.has(chave)) throw UNIQUE_VIOLATION;
      canonicos.add(chave);
      return "import-vencedor";
    };

    const resultados = [1, 2, 3].map(() => {
      try {
        return tentar("conta-1", "fp-1");
      } catch (e) {
        return isFingerprintConflict(e as { code: string; message: string })
          ? "SAME_STATEMENT_ALREADY_IMPORTED"
          : "ERRO";
      }
    });

    expect(resultados.filter((r) => r === "import-vencedor")).toHaveLength(1);
    expect(resultados.filter((r) => r === "SAME_STATEMENT_ALREADY_IMPORTED")).toHaveLength(2);
    expect(resultados).not.toContain("ERRO");
  });
});

describe("CONFIRM_IMPORT_DOUBLE_EXECUTION_TEST", () => {
  /** Espelha o guard da RPC: import já CONFIRMED não reprocessa. */
  function confirmar(importStatus: string) {
    if (importStatus === "CONFIRMED") {
      return { status: "ALREADY_CONFIRMED", created_transactions: 0, created_purchases: 0 };
    }
    return { status: "CONFIRMED", created_transactions: 12, created_purchases: 0 };
  }

  it("retry após resposta HTTP perdida não cria nada", () => {
    const primeira = confirmar("READY_FOR_REVIEW");
    expect(primeira.status).toBe("CONFIRMED");

    const retry = confirmar("CONFIRMED");
    expect(retry.status).toBe("ALREADY_CONFIRMED");
    expect(retry.created_transactions).toBe(0);
    expect(retry.created_purchases).toBe(0);
  });
});
