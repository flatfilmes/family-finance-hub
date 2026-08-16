/**
 * REPROCESSAR CHECKPOINTS — operação de manutenção da auditoria.
 *
 * Relê os PDFs de extrato já importados apenas para recuperar saldos de
 * conferência (saldo anterior, "Saldo do dia", saldo final) e o período do
 * documento. Nenhuma movimentação é criada, alterada ou duplicada.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { useAuth } from "@/hooks/useAuth";
import {
  reprocessStatementCheckpointsBatch,
  type ReprocessOutcome,
} from "@/lib/bank-statements/reprocess";

export function ReprocessCheckpointsDialog({
  accountId,
  familyId,
}: {
  accountId: string;
  familyId: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });
  const [resultados, setResultados] = useState<ReprocessOutcome[]>([]);

  async function executar() {
    if (!arquivos.length) return;
    setRodando(true);
    setResultados([]);
    setProgresso({ feito: 0, total: arquivos.length });
    try {
      const saidas = await reprocessStatementCheckpointsBatch({
        accountId,
        familyId,
        createdBy: user?.id ?? null,
        files: arquivos,
        onProgress: (feito, total) => setProgresso({ feito, total }),
      });
      setResultados(saidas);
      const ok = saidas.filter((s) => s.status === "OK").length;
      await queryClient.invalidateQueries({ queryKey: ["bank-balance-checkpoints", accountId] });
      await queryClient.invalidateQueries({ queryKey: ["bank-statement-imports", accountId] });
      toast.success(
        ok
          ? `${ok} extrato(s) reprocessado(s). Nenhuma movimentação foi alterada.`
          : "Nenhum extrato pôde ser reprocessado.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reprocessar os extratos.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) {
          setArquivos([]);
          setResultados([]);
        }
      }}
    >
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted">
          <RefreshCw className="size-3.5" /> Reprocessar checkpoints
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reprocessar saldos de conferência</DialogTitle>
          <DialogDescription>
            Envie novamente os PDFs dos extratos já importados. O sistema relê apenas os saldos
            (saldo anterior, saldo do dia e saldo final) e o período do documento.
          </DialogDescription>
        </DialogHeader>

        <p className="flex items-start gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Nenhuma movimentação é criada, apagada ou duplicada. Seu saldo não muda.
        </p>

        <input
          type="file"
          accept="application/pdf"
          multiple
          disabled={rodando}
          onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
          className="w-full rounded-2xl border border-dashed border-border px-3 py-6 text-xs"
        />

        {arquivos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {arquivos.length} arquivo(s) selecionado(s).
          </p>
        )}

        {rodando && (
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Loader2 className="size-3.5 animate-spin" /> Lendo {progresso.feito} de{" "}
            {progresso.total}…
          </p>
        )}

        {resultados.length > 0 && (
          <ul className="space-y-2">
            {resultados.map((r) => (
              <li key={r.arquivo} className="rounded-2xl border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{r.arquivo}</span>
                  <StatusBadge tone={r.status === "OK" ? "ok" : "warn"}>
                    {r.status === "OK" ? "Reprocessado" : "Não aplicado"}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {r.status === "OK"
                    ? `${r.periodoInicio ?? "?"} → ${r.periodoFim ?? "?"} · ${r.checkpoints} checkpoint(s) · ${r.movimentos} movimento(s) lidos`
                    : r.motivo}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={rodando}>
            Fechar
          </Button>
          <Button onClick={executar} disabled={rodando || !arquivos.length}>
            {rodando ? "Reprocessando…" : "Reprocessar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
