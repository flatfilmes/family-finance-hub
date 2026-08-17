/**
 * INTEGRIDADE DO PIPELINE — diagnóstico temporário, somente leitura.
 *
 * Mostra, por extrato importado, o destino de CADA linha do ParsedBankStatement:
 * PARSED → RECONCILIATION → PERSISTENCE → LEDGER. Nada aqui grava, corrige ou
 * recria movimento algum.
 */
import { useMemo, useState } from "react";

import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import {
  buildAccountLineage,
  LINEAGE_STATUS_LABELS,
  LINEAGE_STATUS_TONES,
  type LineageImportInput,
  type LineageItemInput,
  type StatementLineage,
} from "@/lib/bank-statements/lineage";
import type { Transaction } from "@/lib/transactions";
import { formatCurrency } from "@/lib/finance";
import { RepairPlanPanel } from "@/components/bank/repair-plan-panel";

export function PipelineIntegrity({
  accountId,
  imports,
  items,
  transactions,
  checkpoints,
}: {
  accountId: string;
  imports: LineageImportInput[];
  items: LineageItemInput[];
  transactions: Transaction[];
  checkpoints: { data: string; saldo: number; importId?: string | null }[];
}) {
  const [aberto, setAberto] = useState<string | null>(null);

  const lineages = useMemo(
    () =>
      buildAccountLineage({
        imports,
        items,
        transactions: transactions.filter((t) => t.bank_account_id === accountId),
        checkpoints,
      }),
    [accountId, imports, items, transactions, checkpoints],
  );

  if (!lineages.length) return null;

  return (
    <>
    <RepairPlanPanel lineages={lineages} imports={imports} items={items} checkpoints={checkpoints} />
    <Card className="mb-5">
      <SectionTitle
        title="Integridade do pipeline"
        hint="Diagnóstico por linha do documento: onde cada movimento do extrato foi parar. Somente leitura — nenhum valor é criado ou corrigido aqui."
      />
      <div className="space-y-3">
        {lineages.map((l) => (
          <ImportBlock
            key={l.importId}
            lineage={l}
            aberto={aberto === l.importId}
            onToggle={() => setAberto(aberto === l.importId ? null : l.importId)}
          />
        ))}
      </div>
    </Card>
    </>
  );
}

function ImportBlock({
  lineage: l,
  aberto,
  onToggle,
}: {
  lineage: StatementLineage;
  aberto: boolean;
  onToggle: () => void;
}) {
  const c = l.checkpoints;
  const faltando = l.missingFromLedger.length;
  return (
    <div className="rounded-2xl border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {l.periodStart ?? "—"} → {l.periodEnd ?? "—"} · {l.nomeArquivo}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Parsed {l.parsedTransactions} · Persistidos {l.persistedTransactions}/
            {l.parsedTransactions} · Missing {faltando} · Extra {l.extraInLedger.length} · Mutated{" "}
            {l.mutated.length}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            DAILY: PDF {c.pdfTotal === null ? "não persistido" : c.pdfTotal} · persistidos{" "}
            {c.daily.persistidos} · conferem {c.dailyConferem} — CLOSING: persistido{" "}
            {c.closing.persistidos} ·{" "}
            {c.closingConfere === null ? "sem conferência" : c.closingConfere ? "confere" : "diverge"}
            {c.opening.persistidos ? ` — OPENING: ${c.opening.persistidos}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={faltando || l.mutated.length ? "danger" : "ok"}>
            {faltando || l.mutated.length ? "Perda ou mutação" : "Íntegro"}
          </StatusBadge>
          <button onClick={onToggle} className="text-xs font-semibold text-primary hover:underline">
            {aberto ? "Ocultar lineage" : "Ver lineage"}
          </button>
        </div>
      </div>

      {aberto && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-semibold">sourceId</th>
                <th className="px-2 py-2 font-semibold">Data</th>
                <th className="px-2 py-2 font-semibold">Descrição</th>
                <th className="px-2 py-2 font-semibold">Valor</th>
                <th className="px-2 py-2 font-semibold">Reconciliation</th>
                <th className="px-2 py-2 font-semibold">Persistence</th>
                <th className="px-2 py-2 font-semibold">Ledger</th>
                <th className="px-2 py-2 font-semibold">Final</th>
              </tr>
            </thead>
            <tbody>
              {l.rows.map((r) => (
                <tr key={r.itemId} className="border-b border-border align-top last:border-0">
                  <td className="px-2 py-2 font-mono">{r.sourceId}</td>
                  <td className="px-2 py-2">{r.postingDate ?? "—"}</td>
                  <td className="max-w-64 px-2 py-2">
                    <span className="block truncate">{r.description}</span>
                    {r.matchedAgainst && (
                      <span className="block text-[11px] text-muted-foreground">
                        alvo: {r.matchedAgainst.tipo} {r.matchedAgainst.id.slice(0, 8)} ·{" "}
                        {r.matchedAgainst.data ?? "—"} ·{" "}
                        {formatCurrency(Number(r.matchedAgainst.valor))}
                      </span>
                    )}
                    {r.mutations.map((m) => (
                      <span
                        key={m.campo}
                        className="block text-[11px] font-semibold text-destructive"
                      >
                        mutado {m.campo}: {m.parsed} → {m.ledger}
                      </span>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-semibold">
                    {r.direction === "OUT" ? "−" : "+"}
                    {formatCurrency(r.amount)}
                  </td>
                  <td className="px-2 py-2">
                    {r.reconciliationStatus} · {r.reviewAction}
                    {r.confidence !== null ? ` (${r.confidence})` : ""}
                  </td>
                  <td className="max-w-56 px-2 py-2">{r.persistAction}</td>
                  <td className="px-2 py-2 font-mono">
                    {r.ledgerTransactionId ? r.ledgerTransactionId.slice(0, 8) : "—"}
                    {r.ledgerDate ? ` · ${r.ledgerDate}` : ""}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge tone={LINEAGE_STATUS_TONES[r.finalStatus]}>
                      {LINEAGE_STATUS_LABELS[r.finalStatus]}
                    </StatusBadge>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {r.stage} · {r.reason} {r.rule ? `[${r.rule}]` : ""}
                    </span>
                  </td>
                </tr>
              ))}
              {l.extraInLedger.map((t) => (
                <tr key={t.id} className="border-b border-border align-top last:border-0">
                  <td className="px-2 py-2 font-mono text-muted-foreground">—</td>
                  <td className="px-2 py-2">{t.data_movimento}</td>
                  <td className="max-w-64 truncate px-2 py-2">{t.descricao}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-semibold">
                    {formatCurrency(Number(t.valor))}
                  </td>
                  <td className="px-2 py-2">—</td>
                  <td className="px-2 py-2">—</td>
                  <td className="px-2 py-2 font-mono">{t.id.slice(0, 8)}</td>
                  <td className="px-2 py-2">
                    <StatusBadge tone="warn">Extra no ledger (sem linha no PDF)</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
