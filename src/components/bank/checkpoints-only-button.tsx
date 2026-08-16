/**
 * RECUPERAR SALDOS DE CONFERÊNCIA — metadados apenas.
 *
 * Relê o que já foi extraído dos documentos importados (período, saldo de
 * abertura e saldo final) e regrava os checkpoints do extrato. Nenhuma
 * movimentação é criada, apagada, alterada ou reassociada.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";

import { reprocessAccountCheckpointsOnly } from "@/lib/bank-statements/repair";

export function CheckpointsOnlyButton({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [rodando, setRodando] = useState(false);

  async function executar() {
    setRodando(true);
    try {
      const relatorios = await reprocessAccountCheckpointsOnly(accountId);
      const criados = relatorios.reduce((acc, r) => acc + r.checkpointsCriados, 0);
      const validados = relatorios.filter((r) => r.status === "VALIDADO").length;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bank-balance-checkpoints", accountId] }),
        queryClient.invalidateQueries({ queryKey: ["bank-statement-imports", accountId] }),
      ]);
      toast.success(
        `${criados} saldo(s) de conferência recuperado(s) · ${validados}/${relatorios.length} extrato(s) com conferência. Nenhuma movimentação foi alterada.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao recuperar os saldos de conferência.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <button
      onClick={executar}
      disabled={rodando}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
    >
      <ListChecks className="size-3.5" />
      {rodando ? "Recuperando…" : "Recuperar saldos de conferência"}
    </button>
  );
}
