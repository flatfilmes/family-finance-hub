/**
 * REGRESSÃO: reimportar o MESMO extrato N vezes não multiplica o ledger nem
 * gera falsos candidatos de restauração.
 */
import { describe, expect, it } from "vitest";

import { buildPersistenceRepairPlan } from "./persistence-repair";
import type { StatementLineage, LineageImportInput, LineageItemInput } from "./lineage";
import type { Transaction } from "@/lib/transactions";

const ACCOUNT = "acc-1";
const LINHAS = 17;

function linha(i: number) {
  return {
    data: `2026-02-${String((i % 27) + 1).padStart(2, "0")}`,
    valor: 10 + i,
    descricao: `MOVIMENTO ${i}`,
  };
}

function makeImport(id: string): LineageImportInput {
  return {
    id,
    nome_arquivo: "itau_extrato_012026.pdf",
    periodo_inicio: "2026-01-01",
    periodo_fim: "2026-06-30",
    saldo_inicial: 0,
    saldo_final: 120.81,
    dados_brutos_json: { snapshotVersion: 1 },
  };
}

function makeItems(importId: string): LineageItemInput[] {
  return Array.from({ length: LINHAS }, (_, i) => ({
    id: `${importId}-item-${i}`,
    import_id: importId,
    ordem: i,
    data_movimento: linha(i).data,
    descricao_original: linha(i).descricao,
    valor: linha(i).valor,
    source_id: `${importId.slice(0, 8)}#${String(i).padStart(3, "0")}`,
  }));
}

function makeLineage(importId: string, ligado: boolean): StatementLineage {
  const rows = Array.from({ length: LINHAS }, (_, i) => ({
    sourceId: `${importId.slice(0, 8)}#${String(i).padStart(3, "0")}`,
    importId,
    itemId: `${importId}-item-${i}`,
    ordem: i,
    postingDate: linha(i).data,
    description: linha(i).descricao,
    amount: linha(i).valor,
    direction: "OUT" as const,
    reconciliationStatus: ligado ? "EXACT_MATCH" : "MATCHED",
    reviewAction: ligado ? "CREATE" : "IGNORE",
    confidence: null,
    persistAction: ligado ? "CREATED" : "SKIPPED",
    ledgerTransactionId: ligado ? `tx-${i}` : null,
    ledgerDate: ligado ? linha(i).data : null,
    ledgerAmount: ligado ? linha(i).valor : null,
    ledgerDirection: ligado ? ("OUT" as const) : null,
    ledgerDescription: ligado ? linha(i).descricao : null,
    finalStatus: ligado ? ("PERSISTED_NEW" as const) : ("MATCHED_EXISTING" as const),
    stage: "LEDGER" as const,
    reason: "",
    rule: "",
    matchedAgainst: null,
    mutations: [],
  }));

  return {
    importId,
    nomeArquivo: "itau_extrato_012026.pdf",
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30",
    parsedTransactions: LINHAS,
    persistedTransactions: ligado ? LINHAS : 0,
    exactMatches: ligado ? LINHAS : 0,
    missingFromLedger: ligado ? [] : rows,
    extraInLedger: [],
    mutated: [],
    rows,
  } as unknown as StatementLineage;
}

function makeTransactions(): Transaction[] {
  return Array.from({ length: LINHAS }, (_, i) => ({
    id: `tx-${i}`,
    bank_account_id: ACCOUNT,
    data_movimento: linha(i).data,
    valor: linha(i).valor,
    descricao: linha(i).descricao,
    tipo: "SAIDA",
    status: "CONFIRMADA",
  })) as unknown as Transaction[];
}

describe("plano de reparo com imports equivalentes", () => {
  it("conta 17 movimentos econômicos, não 51, e não propõe restauração", () => {
    const canonical = "6a6a8cdf-f4f4-48ef-bb21-9716c9e98f2b";
    const outros = ["549c345a-b903-43b7-9d3a-a565beec90af", "9e6606cf-e6e5-4df0-bc79-9f86b92f0d67"];
    const ids = [canonical, ...outros];

    const plan = buildPersistenceRepairPlan({
      accountId: ACCOUNT,
      lineages: ids.map((id) => makeLineage(id, id === canonical)),
      imports: ids.map(makeImport),
      items: ids.flatMap(makeItems),
      transactions: makeTransactions(),
      allTransactions: makeTransactions(),
      // Apenas o canônico tem checkpoints persistidos e vence a eleição.
      checkpoints: [
        { data: "2026-02-13", saldo: 10, tipo: "DAILY", importId: canonical },
        { data: "2026-06-17", saldo: 120.81, tipo: "DAILY", importId: canonical },
      ],
    });

    expect(plan.totais.statementsEncontrados).toBe(3);
    expect(plan.totais.statementsCanonicos).toBe(1);
    expect(plan.statements.canonicalIds).toEqual([canonical]);
    expect(plan.totais.overlapsPreservados).toBe(2);
    expect(plan.statements.overlaps.map((o) => o.importId).sort()).toEqual([...outros].sort());
    expect(plan.statements.overlaps.every((o) => o.impactoFinanceiro === 0)).toBe(true);

    expect(plan.totais.movimentosDocumento).toBe(17);
    expect(plan.totais.movimentosAntes).toBe(17);
    expect(plan.totais.movimentosDepois).toBe(17);
    expect(plan.totais.linhasRestauradas).toBe(0);
    expect(plan.totais.deltaSaldoAtual).toBe(0);
  });
});
