/**
 * EXECUÇÃO CONTROLADA DO REPARO — a única porta de execução financeira.
 *
 * Fonte única: o FinancialRepairProof (dry run). "Aplicar reparo" nasce
 * desabilitado, só libera depois de "Validar para aplicação" reler o banco, e
 * ainda exige confirmação manual antes de qualquer alteração.
 */
import { useState } from "react";
import { ShieldCheck, Wrench } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/page-header";
import { SectionTitle, Metric } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/finance";
import type { FinancialRepairProof } from "@/lib/bank-statements/financial-repair";
import {
  applyFinancialLedgerRepair,
  AUTHORIZED_REPAIR,
  validateRepairExecution,
  type FinancialRepairOutcome,
  type RepairExecutionValidation,
} from "@/lib/bank-statements/financial-repair-apply";

const CONFIRMACAO = `Este reparo fará exatamente 3 correções:

• remover a contrapartida artificial de R$ 7.466,84;
• corrigir R$ 0,03 de saída para entrada;
• corrigir R$ 0,12 de saída para entrada.

Saldo esperado:
R$ 7.587,35 → R$ 120,81

Nenhum extrato será apagado.
A movimentação original do Banco do Brasil será preservada.`;

/** Traduz a falha do executor sem tratá-la como sucesso. */
function mensagemDeErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.includes("REPAIR_PRECONDITION_FAILED"))
    return `REPAIR_PRECONDITION_FAILED — a pré-checagem no banco falhou e nada foi alterado. (${raw})`;
  if (raw.includes("REPAIR_POST_VALIDATION_FAILED"))
    return `REPAIR_POST_VALIDATION_FAILED — a conferência depois da gravação não fechou; tudo foi revertido (rollback). (${raw})`;
  return raw || "Não foi possível aplicar o reparo.";
}

export function FinancialRepairExecution({
  proof,
  onApplied,
}: {
  proof: FinancialRepairProof;
  onApplied?: () => void;
}) {
  const [validacao, setValidacao] = useState<RepairExecutionValidation | null>(null);
  const [resultado, setResultado] = useState<FinancialRepairOutcome | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const habilitado = validacao?.status === "PASS" && !resultado;

  async function validar() {
    setOcupado(true);
    setErro(null);
    setResultado(null);
    try {
      setValidacao(await validateRepairExecution(proof));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível validar.");
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    setConfirmando(false);
    setOcupado(true);
    setErro(null);
    try {
      const r = await applyFinancialLedgerRepair();
      setResultado(r);
      setValidacao(null);
      onApplied?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível aplicar o reparo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="mb-5 border-primary/30 bg-primary/5">
      <SectionTitle
        title="Execução controlada do reparo"
        hint="Somente o dry run financeiro autoriza a execução. Validar relê as três transações no banco; aplicar exige confirmação manual e roda em uma única operação atômica com rollback total."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label="Movimentos"
          value={`${proof.ledgerBefore.transactionCount} → ${proof.ledgerAfter.transactionCount}`}
        />
        <Metric
          label="Saldo"
          value={`${formatCurrency(proof.ledgerBefore.balance)} → ${formatCurrency(proof.ledgerAfter.balance)}`}
        />
        <Metric
          label="Checkpoints"
          value={`${proof.checkpointsPass}/${proof.checkpointsTotal} PASS`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={validar}
          disabled={ocupado}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-50"
        >
          <ShieldCheck className="size-3.5" /> Validar para aplicação
        </button>
        <button
          onClick={() => setConfirmando(true)}
          disabled={!habilitado || ocupado}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Wrench className="size-3.5" /> Aplicar reparo
        </button>
        {validacao && (
          <StatusBadge tone={validacao.status === "PASS" ? "ok" : "danger"}>
            REPAIR_EXECUTION_VALIDATION = {validacao.status}
          </StatusBadge>
        )}
      </div>

      {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}

      {validacao && (
        <div className="mt-4 space-y-2">
          <div className="rounded-2xl border border-border px-4 py-3 text-xs">
            <p>
              <span className="text-muted-foreground">ITAU_TRANSACTION_TO_REMOVE:</span>{" "}
              {validacao.itauTransactionToRemove}
            </p>
            <p>
              <span className="text-muted-foreground">BB_TRANSACTION_TO_PRESERVE:</span>{" "}
              {validacao.bbTransactionToPreserve ?? "não provado — execução bloqueada"}
            </p>
            <p>
              <span className="text-muted-foreground">transfer_group_id:</span>{" "}
              {validacao.transferGroupId ?? "—"}
            </p>
          </div>
          {validacao.checks.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border px-4 py-2"
            >
              <p className="text-sm">{c.label}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">{c.detail}</p>
                <StatusBadge tone={c.status === "PASS" ? "ok" : "danger"}>{c.status}</StatusBadge>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmando && (
        <div className="mt-4 rounded-2xl border border-primary/40 bg-background px-4 py-3">
          <p className="whitespace-pre-line text-sm">{CONFIRMACAO}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={aplicar}
              disabled={ocupado}
              className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Confirmar e aplicar
            </button>
            <button
              onClick={() => setConfirmando(false)}
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div className="mt-4 rounded-2xl border border-border px-4 py-3">
          <StatusBadge tone="ok">
            {resultado.status === "ALREADY_REPAIRED"
              ? "ALREADY_REPAIRED"
              : "REPAIR_APPLIED = SUCCESS"}
          </StatusBadge>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Metric
              label="Movimentos"
              value={
                resultado.ledgerBefore && resultado.ledgerAfter
                  ? `${resultado.ledgerBefore.transactionCount} → ${resultado.ledgerAfter.transactionCount}`
                  : String(resultado.ledger?.transactionCount ?? "—")
              }
            />
            <Metric
              label="Saldo"
              value={
                resultado.ledgerBefore && resultado.ledgerAfter
                  ? `${formatCurrency(resultado.ledgerBefore.balance)} → ${formatCurrency(resultado.ledgerAfter.balance)}`
                  : formatCurrency(resultado.ledger?.balance ?? 0)
              }
            />
            <Metric
              label="Checkpoints"
              value={`${resultado.checkpointsPass ?? "—"}/${resultado.checkpointsTotal ?? "—"} PASS`}
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Diferença residual {formatCurrency(resultado.residualDifference ?? 0)} · contrapartida
            artificial removida · rendimentos {AUTHORIZED_REPAIR.directionFixes
              .map((f) => f.date)
              .join(" e ")}{" "}
            OUT → IN · Banco do Brasil: transação original preservada
            {resultado.bbTransactionPreserved?.transactionId
              ? ` (${resultado.bbTransactionPreserved.transactionId})`
              : ""}
            .
          </p>
        </div>
      )}
    </Card>
  );
}
