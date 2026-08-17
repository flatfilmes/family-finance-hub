/**
 * FASE 2 — provas de aposentadoria do legado.
 *
 * Estes testes protegem decisões estruturais, não matemática financeira:
 *  - a compra é a chave canônica da parcela;
 *  - `expenses` não tem mais caminho de escrita no cliente;
 *  - o rascunho de extrato é isolado por conta + documento (cross tab).
 */
import { describe, expect, it, beforeEach } from "vitest";
import * as expensesLib from "@/lib/expenses";
import { parcelamentosAtivos } from "@/lib/card-details";
import {
  clearStatementDraft,
  draftKey,
  loadStatementDraft,
  saveStatementDraft,
  type StatementDraft,
} from "@/lib/bank-statements/draft";
import * as dedupe from "@/lib/bank-statements/dedupe";

describe("expenses é legado somente leitura", () => {
  it("não expõe nenhuma função de escrita", () => {
    const escritas = ["createExpense", "updateExpense", "deleteExpense"];
    for (const nome of escritas) {
      expect(Object.keys(expensesLib)).not.toContain(nome);
    }
  });

  it("mantém a leitura usada por categorias e filtros", () => {
    expect(typeof expensesLib.fetchExpenses).toBe("function");
    expect(typeof expensesLib.fetchExpenseCategories).toBe("function");
  });
});

describe("dedupe deprecated removido", () => {
  it("só existe o índice canônico por ocorrência", () => {
    expect(Object.keys(dedupe)).not.toContain("buildExistingMovementKeys");
    expect(typeof dedupe.buildExistingMovementIndex).toBe("function");
  });
});

describe("parcelamento agrupa pela compra, não pela despesa", () => {
  const fatura = {
    id: "inv-1",
    credit_card_id: "card-1",
    data_fechamento: "2999-01-10",
    data_vencimento: "2999-01-17",
    status: "ABERTA",
  };
  const parcela = (n: number) => ({
    id: `p${n}`,
    card_invoice_id: "inv-1",
    expense_id: null,
    purchase_id: "compra-1",
    numero_parcela: n,
    total_parcelas: 3,
    valor_parcela: 100,
    data_vencimento: "2999-01-17",
    status: "PENDENTE",
  });

  it("monta um único parcelamento mesmo sem expense_id", () => {
    const ativos = parcelamentosAtivos({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parcelas: [parcela(1), parcela(2), parcela(3)] as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      faturas: [fatura] as any,
      compraPorId: new Map([
        [
          "compra-1",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { id: "compra-1", estabelecimento: "Mercado", tipo_compra: "COMPRA_PARCELADA" } as any,
        ],
      ]),
      hoje: new Date("2026-01-01"),
    });
    expect(ativos).toHaveLength(1);
    expect(ativos[0]?.id).toBe("compra-1");
    expect(ativos[0]?.purchaseId).toBe("compra-1");
    expect(ativos[0]?.total).toBe(3);
    expect(ativos[0]?.descricao).toBe("Mercado");
  });
});

describe("rascunho de extrato isolado por conta e documento", () => {
  const draft = (accountId: string, fingerprint: string): StatementDraft => ({
    accountId,
    nomeArquivo: `${fingerprint}.pdf`,
    formato: "PDF",
    fingerprint,
    jaImportado: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resumo: { movimentos: [], checkpoints: [] } as any,
  });

  beforeEach(() => {
    sessionStorage.clear();
    clearStatementDraft();
  });

  it("usa chave escopada por conta e fingerprint", () => {
    expect(draftKey("conta-a", "fp1")).toBe("bankStatementDraft:conta-a:fp1");
  });

  it("não deixa uma conta sobrescrever o rascunho da outra", () => {
    saveStatementDraft(draft("conta-a", "fp1"));
    saveStatementDraft(draft("conta-b", "fp2"));
    expect(loadStatementDraft("conta-a")?.fingerprint).toBe("fp1");
    expect(loadStatementDraft("conta-b")?.fingerprint).toBe("fp2");
  });

  it("permite dois documentos distintos na mesma conta", () => {
    saveStatementDraft(draft("conta-a", "fp1"));
    saveStatementDraft(draft("conta-a", "fp2"));
    expect(loadStatementDraft("conta-a", "fp1")?.nomeArquivo).toBe("fp1.pdf");
    expect(loadStatementDraft("conta-a", "fp2")?.nomeArquivo).toBe("fp2.pdf");
  });

  it("limpar remove apenas o rascunho alvo", () => {
    saveStatementDraft(draft("conta-a", "fp1"));
    saveStatementDraft(draft("conta-b", "fp2"));
    clearStatementDraft("conta-b", "fp2");
    expect(loadStatementDraft("conta-b")).toBeNull();
    expect(loadStatementDraft("conta-a", "fp1")?.fingerprint).toBe("fp1");
  });
});
