/**
 * CORRIGIR DATAS DOS LANÇAMENTOS — usa a data da coluna "Dia" do extrato
 * (statement item) como fonte de verdade da data do lançamento no ledger.
 *
 * Garantias:
 *  - nada é criado nem excluído;
 *  - valor, sentido e conta nunca são alterados;
 *  - só corrige vínculo inequívoco (1 lançamento ↔ 1 item do extrato);
 *  - vínculos ambíguos ficam como DATE_REPAIR_REVIEW_REQUIRED.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, ShieldCheck } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";

type Linha = {
  transaction_id: string;
  description: string;
  amount: number | string;
  current_date: string | null;
  statement_posting_date: string | null;
  difference_days: number | null;
  action: "CORRIGIR" | "DATE_REPAIR_REVIEW_REQUIRED";
};

type Relatorio = {
  dry_run: boolean;
  transactions_analisadas: number;
  datas_divergentes: number;
  corrigidas: number;
  ambiguas: number;
  linhas: Linha[];
};

export function RepairPostingDatesDialog({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);

  async function executar(dryRun: boolean) {
    setRodando(true);
    try {
      const { data, error } = await supabase.rpc("repair_bank_transaction_posting_dates", {
        _account_id: accountId,
        _dry_run: dryRun,
      });
      if (error) throw error;
      const rel = data as unknown as Relatorio;
      setRelatorio(rel);
      if (!dryRun) {
        for (const key of ["transactions", "bank-accounts", "bank-statement-items"]) {
          await queryClient.invalidateQueries({ queryKey: [key] });
        }
        toast.success(`${rel.corrigidas} data(s) corrigida(s) a partir do extrato.`);
      } else if (!rel.datas_divergentes) {
        toast.info("Nenhuma data divergente entre ledger e extrato.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar as datas.");
    } finally {
      setRodando(false);
    }
  }

  const corrigiveis = relatorio?.linhas.filter((l) => l.action === "CORRIGIR") ?? [];

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v && !rodando) setRelatorio(null);
      }}
    >
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted">
          <CalendarClock className="size-3.5" /> Corrigir datas dos lançamentos
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Corrigir datas dos lançamentos</DialogTitle>
          <DialogDescription>
            A data da coluna "Dia" do extrato é soberana. Primeiro veja a simulação; só depois as
            correções inequívocas são aplicadas.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Nenhuma movimentação é criada, excluída ou tem valor/sentido alterado.
          </li>
          <li className="pl-5">Somente a data muda, e só quando o vínculo é inequívoco.</li>
          <li className="pl-5">
            Saldo anterior, saldo do dia e saldo final não são usados como data de movimento.
          </li>
        </ul>

        {rodando && (
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Loader2 className="size-3.5 animate-spin" /> Analisando…
          </p>
        )}

        {relatorio && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Resumo label="Analisadas" valor={String(relatorio.transactions_analisadas)} />
              <Resumo label="Datas divergentes" valor={String(relatorio.datas_divergentes)} />
              <Resumo label="Corrigidas" valor={String(relatorio.corrigidas)} />
              <Resumo label="Ambíguas" valor={String(relatorio.ambiguas)} />
            </div>

            {relatorio.linhas.length === 0 ? (
              <p className="rounded-2xl border border-border px-3 py-2 text-xs text-muted-foreground">
                Todas as datas do ledger já coincidem com a data do item do extrato vinculado.
              </p>
            ) : (
              <ul className="space-y-2">
                {relatorio.linhas.map((l) => (
                  <li key={l.transaction_id} className="rounded-2xl border border-border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {l.description}
                      </span>
                      <span className="text-xs font-bold">{formatCurrency(Number(l.amount))}</span>
                      <StatusBadge tone={l.action === "CORRIGIR" ? "warn" : "danger"}>
                        {l.action === "CORRIGIR" ? "Corrigir" : "Revisão necessária"}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      atual {l.current_date ? formatDate(l.current_date) : "—"} → extrato{" "}
                      {l.statement_posting_date ? formatDate(l.statement_posting_date) : "—"}
                      {l.difference_days === null ? "" : ` · ${l.difference_days} dia(s)`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={rodando}>
            Fechar
          </Button>
          <Button variant="outline" onClick={() => executar(true)} disabled={rodando}>
            Simular
          </Button>
          <Button
            onClick={() => executar(false)}
            disabled={rodando || !relatorio?.dry_run || corrigiveis.length === 0}
          >
            Aplicar {corrigiveis.length || ""} correção(ões)
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
