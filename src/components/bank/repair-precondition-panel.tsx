/**
 * Resultado da pré-condição do reparo (dry run, nada é gravado).
 * Mostra o alvo ausente separado das ocorrências vizinhas já existentes.
 */
import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/finance";
import type { RepairPrecondition } from "@/lib/bank-statements/repair-precondition";

export function RepairPreconditionPanel({ pc }: { pc: RepairPrecondition }) {
  return (
    <Card className="mb-5">
      <SectionTitle
        title="Pré-condição do reparo (dry run)"
        hint="A existência do item só é provada por identidade: sourceId, id da linha do extrato ou ocorrência do documento. Movimentos vizinhos de mesmo valor e data são ocorrências legítimas diferentes e não bloqueiam o reparo."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={pc.repairPrecondition === "PASS" ? "ok" : "danger"}>
          REPAIR_PRECONDITION = {pc.repairPrecondition}
        </StatusBadge>
        <StatusBadge tone="muted">target · {pc.target.sourceId}</StatusBadge>
        <StatusBadge tone={pc.targetTransaction ? "danger" : "ok"}>
          targetTransaction = {pc.targetTransaction ?? "null"}
        </StatusBadge>
        {pc.existingSiblings.map((s) => (
          <StatusBadge key={s.transactionId} tone="warn">
            sibling {s.documentNumber ?? s.sourceId} · {s.transactionId.slice(0, 8)}…
          </StatusBadge>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2 font-semibold">Documento</th>
              <th className="px-2 py-2 font-semibold">Data</th>
              <th className="px-2 py-2 font-semibold">Valor</th>
              <th className="px-2 py-2 font-semibold">Sentido</th>
              <th className="px-2 py-2 font-semibold">sourceId · ocorrência</th>
              <th className="px-2 py-2 font-semibold">Transação no ledger</th>
            </tr>
          </thead>
          <tbody>
            {pc.linhas.map((l) => (
              <tr key={l.sourceId} className="border-b border-border last:border-0">
                <td className="px-2 py-2">
                  <StatusBadge
                    tone={
                      l.status === "EXISTS_AS_SIBLING"
                        ? "ok"
                        : l.status === "MISSING_TARGET" && l.papel === "ALVO"
                          ? "danger"
                          : "warn"
                    }
                  >
                    {l.status}
                  </StatusBadge>
                </td>
                <td className="px-2 py-2 font-semibold">{l.documentNumber ?? "—"}</td>
                <td className="px-2 py-2">{l.data ?? "—"}</td>
                <td className="px-2 py-2">{formatCurrency(l.valor)}</td>
                <td className="px-2 py-2">{l.direcao}</td>
                <td className="px-2 py-2 font-mono text-[11px]">
                  {l.sourceId} · #{l.occurrenceIndex}
                </td>
                <td className="px-2 py-2 font-mono text-[11px]">
                  {l.transactionId ? `${l.transactionId.slice(0, 8)}…` : "AUSENTE NO LEDGER"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 space-y-2">
        {pc.verificacoes.map((v) => (
          <li key={v.chave} className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge tone={v.status === "PASS" ? "ok" : "danger"}>{v.status}</StatusBadge>
            <span className="font-semibold">{v.titulo}</span>
            <span className="text-muted-foreground">{v.detalhe}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
