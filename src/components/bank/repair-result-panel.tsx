/**
 * RESULTADO DA EXECUÇÃO DO REPARO.
 * Mostra o que foi criado, com qual identidade de origem, e como cada mês
 * ficou depois da gravação (conferência encadeada recalculada com dados novos).
 */
import { Card } from "@/components/page-header";
import { SectionTitle, Metric } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/finance";
import type { RepairOutcome } from "@/lib/bank-statements/repair-apply";

const TITULO: Record<RepairOutcome["status"], string> = {
  REPAIR_APPLIED: "REPAIR_APPLIED = SUCCESS",
  ALREADY_REPAIRED: "ALREADY_REPAIRED",
  REPAIR_PRECONDITION_FAILED: "REPAIR_PRECONDITION_FAILED",
  REPAIR_POST_VALIDATION_FAILED: "REPAIR_POST_VALIDATION_FAILED",
};

export function RepairResultPanel({ r }: { r: RepairOutcome }) {
  const ok = r.status === "REPAIR_APPLIED";
  return (
    <Card className={`mb-5 ${ok ? "border-primary/40 bg-primary/5" : "border-destructive/40"}`}>
      <SectionTitle
        title="Execução do reparo"
        hint="Resultado da gravação e da conferência automática feita logo depois dela."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={ok ? "ok" : r.status === "ALREADY_REPAIRED" ? "info" : "danger"}>
          {TITULO[r.status]}
        </StatusBadge>
        <span className="text-xs text-muted-foreground">{r.mensagem}</span>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Transação criada" value={r.transactionId ? r.transactionId.slice(0, 8) : "—"} />
        <Metric label="Source" value={r.sourceId} />
        <Metric
          label="Diferença residual"
          value={r.diferencaResidual === null ? "—" : formatCurrency(r.diferencaResidual)}
        />
      </div>

      {r.periodos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-semibold">Período</th>
                <th className="px-2 py-2 font-semibold">Saldo do sistema agora</th>
                <th className="px-2 py-2 font-semibold">Saldo do documento</th>
                <th className="px-2 py-2 font-semibold">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {r.periodos.map((p) => (
                <tr key={p.importId} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-semibold">{p.rotulo}</td>
                  <td className="px-2 py-2">
                    {p.saldoAntesRepair === null ? "—" : formatCurrency(p.saldoAntesRepair)}
                  </td>
                  <td className="px-2 py-2">
                    {p.saldoDocumento === null ? "—" : formatCurrency(p.saldoDocumento)}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge tone={p.confereAntes === false ? "danger" : "ok"}>
                      {p.differenceBefore === null ? "—" : formatCurrency(p.differenceBefore)}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
