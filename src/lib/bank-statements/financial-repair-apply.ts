/**
 * EXECUÇÃO CONTROLADA DO REPARO FINANCEIRO DO LEDGER.
 *
 * A fonte ÚNICA da execução é o FinancialRepairProof (dry run financeiro).
 * O plano antigo de persistência (períodos, restauradas, deltaPeriodo) continua
 * exportado apenas como diagnóstico histórico e NÃO participa daqui.
 *
 * Este módulo:
 *   1. confere o dry run contra a autorização explícita (3 correções, IDs reais);
 *   2. relê as três transações direto do banco no instante do clique;
 *   3. prova qual movimentação do outro banco será PRESERVADA;
 *   4. chama uma única RPC atômica que aplica, revalida e faz rollback sozinha.
 *
 * Nada é executado por conta própria: só a partir de um clique humano.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchBankBalanceCheckpoints } from "./data";
import type { FinancialRepairProof } from "./financial-repair";


export const REPAIR_TYPE = "ITAU_LEDGER_REPAIR_2026_01_06";

/** Correções autorizadas — nenhuma outra transação pode ser tocada. */
export const AUTHORIZED_REPAIR = {
  accountId: "def1d8cc-1b37-4346-bb3f-ad3b0cc3f7fc",
  canonicalImportId: "6a6a8cdf-f4f4-48ef-bb21-9716c9e98f2b",
  remove: {
    transactionId: "c4563faf-dc7d-47c5-a607-0ef494016416",
    date: "2026-01-19",
    amount: 7466.84,
    direction: "IN" as const,
  },
  directionFixes: [
    {
      transactionId: "916b4b9a-0a6e-4031-8595-ac8fe7253388",
      date: "2026-04-17",
      amount: 0.03,
      from: "OUT" as const,
      to: "IN" as const,
    },
    {
      transactionId: "495ccce0-dbd4-4ca0-a8ff-c5feb2f525cd",
      date: "2026-06-17",
      amount: 0.12,
      from: "OUT" as const,
      to: "IN" as const,
    },
  ],
  expected: {
    ledgerBefore: { transactionCount: 18, balance: 7587.35 },
    ledgerAfter: { transactionCount: 17, balance: 120.81 },
    checkpointsTotal: 7,
  },
};

export type ExecutionCheck = { id: string; label: string; status: "PASS" | "FAIL"; detail: string };

export type RepairExecutionValidation = {
  /** ERROR = alguma consulta falhou; nunca pode ser tratado como PASS. */
  status: "PASS" | "FAIL" | "ERROR";
  executadoEm: string;
  checks: ExecutionCheck[];
  motivos: string[];
  /** Mensagens brutas de erro SQL encontradas durante a validação. */
  sqlErrors: string[];
  /** Provas de preservação do outro banco. */
  itauTransactionToRemove: string;
  bbTransactionToPreserve: string | null;
  transferGroupId: string | null;
};


const eq = (a: number, b: number) => Math.abs(a - b) <= 0.005;

/** Gate somente sobre o objeto autoritativo — sem I/O. */
export function checkProofGate(proof: FinancialRepairProof | null): ExecutionCheck[] {
  if (!proof) {
    return [
      { id: "DRY_RUN", label: "Dry run financeiro disponível", status: "FAIL", detail: "Sem dry run." },
    ];
  }
  const e = AUTHORIZED_REPAIR.expected;
  const removes = proof.corrections.filter((c) => c.type === "REMOVE_EXTRA_LEDGER_TRANSACTION");
  const fixes = proof.corrections.filter((c) => c.type === "CORRECT_DIRECTION");
  const idsOk =
    removes.length === 1 &&
    removes[0]!.transactionId === AUTHORIZED_REPAIR.remove.transactionId &&
    fixes.length === 2 &&
    AUTHORIZED_REPAIR.directionFixes.every((f) =>
      fixes.some((c) => c.transactionId === f.transactionId && eq(c.amount, f.amount)),
    );

  return [
    {
      id: "STATUS_PASS",
      label: "financialRepairDryRun.status = PASS e dryRun = true",
      status: proof.status === "PASS" && proof.dryRun ? "PASS" : "FAIL",
      detail: `status ${proof.status} · dryRun ${String(proof.dryRun)}`,
    },
    {
      id: "LEDGER_BEFORE",
      label: "ledgerBefore = 18 movimentos / R$ 7.587,35",
      status:
        proof.ledgerBefore.transactionCount === e.ledgerBefore.transactionCount &&
        eq(proof.ledgerBefore.balance, e.ledgerBefore.balance)
          ? "PASS"
          : "FAIL",
      detail: `${proof.ledgerBefore.transactionCount} · ${proof.ledgerBefore.balance.toFixed(2)}`,
    },
    {
      id: "LEDGER_AFTER",
      label: "ledgerAfter = 17 movimentos / R$ 120,81",
      status:
        proof.ledgerAfter.transactionCount === e.ledgerAfter.transactionCount &&
        eq(proof.ledgerAfter.balance, e.ledgerAfter.balance)
          ? "PASS"
          : "FAIL",
      detail: `${proof.ledgerAfter.transactionCount} · ${proof.ledgerAfter.balance.toFixed(2)}`,
    },
    {
      id: "RESIDUAL",
      label: "residualDifference = 0",
      status: eq(proof.residualDifference, 0) ? "PASS" : "FAIL",
      detail: proof.residualDifference.toFixed(2),
    },
    {
      id: "CHECKPOINTS",
      label: "7/7 checkpoints com pass = true e difference = 0",
      status:
        proof.checkpointsTotal === e.checkpointsTotal &&
        proof.checkpointsPass === e.checkpointsTotal &&
        proof.checkpoints.every((c) => c.pass && eq(c.difference, 0))
          ? "PASS"
          : "FAIL",
      detail: `${proof.checkpointsPass}/${proof.checkpointsTotal}`,
    },
    {
      id: "CORRECOES_AUTORIZADAS",
      label: "Exatamente as 3 correções autorizadas, com os IDs reais",
      status: idsOk ? "PASS" : "FAIL",
      detail: `${removes.length} remoção(ões) · ${fixes.length} correção(ões) de direção`,
    },
  ];
}

/** Revalida no banco, no instante do clique. Não altera nada. */
export async function validateRepairExecution(
  proof: FinancialRepairProof | null,
): Promise<RepairExecutionValidation> {
  const checks = checkProofGate(proof);
  const a = AUTHORIZED_REPAIR;
  let bb: string | null = null;
  let grupo: string | null = null;
  const sqlErrors: string[] = [];

  const ids = [a.remove.transactionId, ...a.directionFixes.map((f) => f.transactionId)];
  const { data, error } = await supabase
    .from("transactions")
    .select("id, bank_account_id, data_movimento, valor, tipo, status, transfer_group_id, transfer_role, source_id, statement_item_id")
    .in("id", ids);

  if (error) {
    sqlErrors.push(error.message);
    checks.push({
      id: "LEITURA_BANCO",
      label: "Releitura das transações no banco",
      status: "FAIL",
      detail: error.message,
    });

  } else {
    const rows = data ?? [];
    const alvo = rows.find((r) => r.id === a.remove.transactionId);
    checks.push({
      id: "CONTRAPARTIDA_ATUAL",
      label: `Contrapartida artificial ainda existe: ${a.remove.date} · R$ 7.466,84 · IN`,
      status:
        alvo &&
        alvo.bank_account_id === a.accountId &&
        alvo.data_movimento === a.remove.date &&
        eq(Number(alvo.valor), a.remove.amount) &&
        alvo.tipo === "TRANSFERENCIA" &&
        alvo.transfer_role === "ENTRADA" &&
        alvo.status !== "CANCELADA" &&
        !alvo.source_id &&
        !alvo.statement_item_id
          ? "PASS"
          : "FAIL",
      detail: alvo
        ? `${alvo.data_movimento} · ${Number(alvo.valor).toFixed(2)} · ${alvo.tipo}/${alvo.transfer_role ?? "—"}`
        : "Transação não encontrada.",
    });

    for (const f of a.directionFixes) {
      const t = rows.find((r) => r.id === f.transactionId);
      checks.push({
        id: `DIRECAO_${f.date}`,
        label: `Rendimento ${f.date} · R$ ${f.amount.toFixed(2)} ainda está como OUT`,
        status:
          t &&
          t.bank_account_id === a.accountId &&
          t.data_movimento === f.date &&
          eq(Number(t.valor), f.amount) &&
          t.tipo === "SAIDA" &&
          t.status !== "CANCELADA"
            ? "PASS"
            : "FAIL",
        detail: t
          ? `${t.data_movimento} · ${Number(t.valor).toFixed(2)} · ${t.tipo}`
          : "Transação não encontrada.",
      });
    }

    grupo = alvo?.transfer_group_id ?? null;
    if (grupo) {
      const { data: pares } = await supabase
        .from("transactions")
        .select("id, bank_account_id, data_movimento, valor, tipo, transfer_role, status")
        .eq("transfer_group_id", grupo);
      const perna = (pares ?? []).find(
        (p) => p.id !== a.remove.transactionId && p.bank_account_id !== a.accountId && p.status !== "CANCELADA",
      );
      bb = perna?.id ?? null;
      checks.push({
        id: "BB_PRESERVADA",
        label: "Movimentação original do Banco do Brasil identificada e preservada",
        status: perna ? "PASS" : "FAIL",
        detail: perna
          ? `${perna.id} · ${perna.data_movimento} · ${Number(perna.valor).toFixed(2)} — permanece, apenas deixa de ser transferência.`
          : "Não foi possível provar qual movimentação do BB seria preservada.",
      });
    } else {
      checks.push({
        id: "BB_PRESERVADA",
        label: "Movimentação original do Banco do Brasil identificada e preservada",
        status: "FAIL",
        detail: "Sem transfer_group_id: impossível provar o lado preservado.",
      });
    }
  }

  // Checkpoints: MESMA camada usada pela auditoria (bank_balance_checkpoints →
  // saldo_informado). Nenhuma segunda query SQL com nomes próprios de coluna.
  try {
    const cps = (await fetchBankBalanceCheckpoints(a.accountId)).filter(
      (c) => (c.tipo ?? "DAILY") === "DAILY",
    );
    const esperados = proof?.checkpoints ?? [];
    const conferem = esperados.every((e) =>
      cps.some((c) => c.data === e.date && eq(c.saldo, e.expected)),
    );
    checks.push({
      id: "CHECKPOINTS_BANCO",
      label: "Checkpoints diários lidos do banco conferem com o dry run",
      status: esperados.length === a.expected.checkpointsTotal && conferem ? "PASS" : "FAIL",
      detail: `${cps.length} checkpoints DAILY na conta · ${esperados.length} no dry run`,
    });
  } catch (e) {
    sqlErrors.push(e instanceof Error ? e.message : String(e));
    checks.push({
      id: "CHECKPOINTS_BANCO",
      label: "Checkpoints diários lidos do banco conferem com o dry run",
      status: "FAIL",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const motivos = checks.filter((c) => c.status === "FAIL").map((c) => `${c.label} — ${c.detail}`);
  return {
    // Qualquer erro SQL invalida a validação: nunca PASS.
    status: sqlErrors.length ? "ERROR" : motivos.length ? "FAIL" : "PASS",
    executadoEm: new Date().toISOString(),
    checks,
    motivos,
    sqlErrors,
    itauTransactionToRemove: a.remove.transactionId,
    bbTransactionToPreserve: bb,
    transferGroupId: grupo,
  };
}


export type FinancialRepairOutcome = {
  status: "SUCCESS" | "ALREADY_REPAIRED";
  repairId?: string;
  ledgerBefore?: { transactionCount: number; balance: number };
  ledgerAfter?: { transactionCount: number; balance: number };
  ledger?: { transactionCount: number; balance: number };
  residualDifference?: number;
  checkpoints?: { date: string; expected: number; simulated: number; difference: number; pass: boolean }[];
  checkpointsPass?: number;
  checkpointsTotal?: number;
  bbTransactionPreserved?: { transactionId: string; date?: string; amount?: number } | null;
  transferGroupId?: string | null;
  transactionRemoved?: { transactionId: string; amount: number } | null;
  transactionsDirectionCorrected?: { transactionId: string; date: string; amount: number }[];
};

/** Execução atômica. Só deve ser chamada após confirmação humana explícita. */
export async function applyFinancialLedgerRepair(): Promise<FinancialRepairOutcome> {
  const a = AUTHORIZED_REPAIR;
  const { data, error } = await supabase.rpc("apply_financial_ledger_repair", {
    _account_id: a.accountId,
    _remove_id: a.remove.transactionId,
    _fix_ids: a.directionFixes.map((f) => f.transactionId),
    _canonical_import_id: a.canonicalImportId,
    _expected_before_count: a.expected.ledgerBefore.transactionCount,
    _expected_before_balance: a.expected.ledgerBefore.balance,
    _expected_after_count: a.expected.ledgerAfter.transactionCount,
    _expected_after_balance: a.expected.ledgerAfter.balance,
  });
  if (error) throw new Error(error.message);
  return data as unknown as FinancialRepairOutcome;
}
