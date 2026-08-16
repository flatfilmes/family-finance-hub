/**
 * REPROCESSAR HISTÓRICO — corrige associações e completa o ledger dos meses
 * antigos usando exatamente o mesmo pipeline do mês que já está validado.
 *
 * Garantias exibidas ao usuário (e cumpridas no banco):
 *  - nenhum ajuste financeiro é criado;
 *  - nenhuma movimentação existente é apagada;
 *  - associações com movimentação de outro mês são desfeitas, não deletadas;
 *  - antes de criar qualquer movimentação, o sistema confere se ela já existe.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, Loader2, ShieldCheck } from "lucide-react";
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
import {
  REPAIR_STATUS_LABELS,
  REPAIR_STATUS_TONES,
  normalizeOpeningBalances,
  reprocessAccountHistory,
  type ImportRepairReport,
} from "@/lib/bank-statements/repair";
import { formatCurrency } from "@/lib/finance";
import { monthLabel } from "@/lib/expenses";

export function RepairHistoryDialog({
  accountId,
  imports,
}: {
  accountId: string;
  imports: { id: string; periodo_inicio: string | null; created_at: string; status: string }[];
}) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });
  const [relatorios, setRelatorios] = useState<ImportRepairReport[]>([]);
  const [aberturas, setAberturas] = useState<{ canceladas: number; saldo: number } | null>(null);

  const elegiveis = imports.filter((i) => i.status !== "CANCELLED" && i.status !== "ERROR");

  async function executar() {
    setRodando(true);
    setRelatorios([]);
    setAberturas(null);
    setProgresso({ feito: 0, total: elegiveis.length });
    try {
      const saidas = await reprocessAccountHistory({
        imports: elegiveis,
        onProgress: (feito, total) => setProgresso({ feito, total }),
      });
      setRelatorios(saidas);
      // Com o ledger completo, os "saldos anteriores" repetidos deixam de ser
      // necessários: o saldo passa a nascer apenas das movimentações.
      const abert = await normalizeOpeningBalances(accountId);
      setAberturas(abert);

      for (const key of [
        "transactions",
        "bank-accounts",
        "bank-statement-imports",
        "bank-statement-items",
        "bank-balance-checkpoints",
      ]) {
        await queryClient.invalidateQueries({ queryKey: [key] });
      }
      const validados = saidas.filter((s) => s.status === "VALIDADO").length;
      toast.success(`${validados} de ${saidas.length} extrato(s) reprocessado(s) com sucesso.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reprocessar o histórico.");
    } finally {
      setRodando(false);
    }
  }

  const totalInvalidas = relatorios.reduce((a, r) => a + r.associacoesInvalidasRemovidas, 0);
  const totalCriadas = relatorios.reduce((a, r) => a + r.criadas, 0);
  const totalPdf = relatorios.reduce((a, r) => a + r.movimentosPdf, 0);
  const totalLedger = relatorios.reduce((a, r) => a + r.ledgerDepois, 0);

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v && !rodando) {
          setRelatorios([]);
          setAberturas(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted">
          <History className="size-3.5" /> Reprocessar histórico
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reprocessar histórico da conta</DialogTitle>
          <DialogDescription>
            Todos os extratos já importados são relidos na ordem cronológica, usando o mesmo
            pipeline do mês que já está validado.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Nenhum ajuste financeiro é criado e nada é apagado.
          </li>
          <li className="pl-5">
            Associações com movimentação de outro mês são apenas desfeitas — a movimentação
            continua existindo.
          </li>
          <li className="pl-5">
            Antes de criar qualquer lançamento, o sistema confere conta, data, valor e sentido para
            não duplicar.
          </li>
          <li className="pl-5">
            "Saldo do dia" só nasce do PDF: use "Reprocessar checkpoints" para reenviar os
            documentos.
          </li>
        </ul>

        {rodando && (
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Loader2 className="size-3.5 animate-spin" /> Reprocessando {progresso.feito} de{" "}
            {progresso.total}…
          </p>
        )}

        {relatorios.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Resumo label="Movimentos no PDF" valor={String(totalPdf)} />
              <Resumo label="Movimentos no ledger" valor={String(totalLedger)} />
              <Resumo label="Associações removidas" valor={String(totalInvalidas)} />
              <Resumo label="Movimentações criadas" valor={String(totalCriadas)} />
            </div>

            <ul className="space-y-2">
              {relatorios.map((r) => (
                <li key={r.importId} className="rounded-2xl border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold">
                      {r.mes ? monthLabel(r.mes) : r.arquivo}
                    </span>
                    <StatusBadge tone={REPAIR_STATUS_TONES[r.status]}>
                      {REPAIR_STATUS_LABELS[r.status]}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    PDF {r.movimentosPdf} · ledger {r.ledgerAntes} → {r.ledgerDepois} · associações
                    inválidas removidas {r.associacoesInvalidasRemovidas} · novas {r.criadas} ·
                    checkpoints {r.checkpoints} · saldo final{" "}
                    {r.saldoFinal === null ? "—" : formatCurrency(r.saldoFinal)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}

        {aberturas && (
          <p className="rounded-2xl border border-border px-3 py-2 text-xs text-muted-foreground">
            Saldos de abertura repetidos cancelados: <strong>{aberturas.canceladas}</strong>. Saldo
            recalculado a partir do ledger: <strong>{formatCurrency(aberturas.saldo)}</strong>.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={rodando}>
            Fechar
          </Button>
          <Button onClick={executar} disabled={rodando || !elegiveis.length}>
            {rodando ? "Reprocessando…" : `Reprocessar ${elegiveis.length} extrato(s)`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Resumo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-border px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{valor}</p>
    </div>
  );
}
