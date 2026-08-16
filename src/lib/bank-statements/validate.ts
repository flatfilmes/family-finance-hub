/**
 * VALIDATOR do extrato canônico — roda ANTES de qualquer persistência.
 *
 * Regra inegociável: nunca inventar movimentação, mudar valor, mover data ou
 * alterar saldo para "fechar a conta". Quando não fecha, o extrato recebe o
 * status PARSED_STATEMENT_INVALID e a diferença é mostrada por inteiro.
 */
import type { CanonicalStatement, CanonicalTransaction } from "./canonical";
import { statementTotals } from "./canonical";

export type StatementValidationStatus = "PARSED_STATEMENT_VALID" | "PARSED_STATEMENT_INVALID";

export type CheckpointValidation = {
  date: string;
  expected: number;
  calculated: number;
  difference: number;
  ok: boolean;
  /** Movimentações consideradas até o checkpoint (evidência da conferência). */
  considered: CanonicalTransaction[];
};

export type StatementValidation = {
  status: StatementValidationStatus;
  problems: string[];
  math: {
    opening: number | null;
    inflows: number;
    outflows: number;
    calculatedClosing: number | null;
    declaredClosing: number | null;
    difference: number | null;
    ok: boolean;
  };
  checkpoints: CheckpointValidation[];
};

const round = (n: number) => Number(n.toFixed(2));

export function validateStatement(statement: CanonicalStatement): StatementValidation {
  const problems: string[] = [];
  const { inflows, outflows } = statementTotals(statement);
  const opening = statement.openingBalance.amount;
  const declared = statement.closingBalance.amount;

  const calculated = opening === null ? null : round(opening + inflows - outflows);
  const difference =
    calculated === null || declared === null ? null : round(calculated - declared);
  const mathOk = difference === 0;

  if (!statement.periodStart || !statement.periodEnd)
    problems.push("Período oficial do documento não foi encontrado.");
  if (opening === null) problems.push("Saldo anterior (opening balance) não foi encontrado.");
  if (declared === null) problems.push("Saldo final (closing balance) não foi encontrado.");
  if (!statement.transactions.length) problems.push("Nenhuma movimentação lida no documento.");
  if (statement.transactions.some((t) => !t.postingDate))
    problems.push("Há movimentação sem data contábil (coluna 'Dia').");
  if (difference !== null && difference !== 0)
    problems.push(
      `Equação do extrato não fecha: diferença de ${difference.toFixed(2)} (abertura ${opening} + entradas ${inflows} − saídas ${outflows} ≠ ${declared}).`,
    );

  // Conferência dos saldos do dia impressos pelo banco.
  const ordenados = [...statement.transactions].sort((a, b) =>
    (a.postingDate ?? "").localeCompare(b.postingDate ?? ""),
  );
  const checkpoints: CheckpointValidation[] = statement.checkpoints
    .filter((c) => c.type === "DAILY")
    .map((c) => {
      const considered = ordenados.filter((t) => (t.postingDate ?? "") <= c.date);
      const soma = considered.reduce(
        (a, t) => a + (t.direction === "IN" ? t.amount : -t.amount),
        0,
      );
      const calc = opening === null ? NaN : round(opening + soma);
      const diff = Number.isNaN(calc) ? NaN : round(calc - c.amount);
      return {
        date: c.date,
        expected: c.amount,
        calculated: Number.isNaN(calc) ? 0 : calc,
        difference: Number.isNaN(diff) ? 0 : diff,
        ok: diff === 0,
        considered,
      };
    });

  const checkpointsRuins = checkpoints.filter((c) => !c.ok);
  if (checkpointsRuins.length)
    problems.push(
      `${checkpointsRuins.length} saldo(s) do dia não conferem com as movimentações lidas.`,
    );

  return {
    status: mathOk && !problems.length ? "PARSED_STATEMENT_VALID" : "PARSED_STATEMENT_INVALID",
    problems,
    math: {
      opening,
      inflows,
      outflows,
      calculatedClosing: calculated,
      declaredClosing: declared,
      difference,
      ok: mathOk,
    },
    checkpoints,
  };
}

/** Linha da tabela de conferência produzida SOMENTE pelo parser. */
export type StatementReportRow = {
  monthKey: string | null;
  period: string;
  opening: number | null;
  movements: number;
  checkpoints: number;
  closing: number | null;
  mathCheck: "OK" | "DIVERGENTE" | "INCOMPLETO";
  difference: number | null;
};

export function statementReportRow(
  statement: CanonicalStatement,
  validation = validateStatement(statement),
): StatementReportRow {
  return {
    monthKey: statement.periodEnd ? statement.periodEnd.slice(0, 7) : null,
    period: `${statement.periodStart ?? "?"} → ${statement.periodEnd ?? "?"}`,
    opening: statement.openingBalance.amount,
    movements: statement.transactions.length,
    checkpoints: statement.checkpoints.length,
    closing: statement.closingBalance.amount,
    mathCheck:
      validation.math.difference === null
        ? "INCOMPLETO"
        : validation.math.ok
          ? "OK"
          : "DIVERGENTE",
    difference: validation.math.difference,
  };
}
