/**
 * RESET CONTROLADO DO HISTÓRICO IMPORTADO — remove apenas o que nasceu dos
 * extratos desta conta. O cadastro da conta, o saldo de referência, compras,
 * cartões, faturas e movimentações independentes continuam intactos.
 *
 * Fluxo obrigatório: "Analisar reset" (simulação) → "Confirmar reset".
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Eraser, Loader2, ShieldCheck } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";

type DryRun = {
  dry_run: true;
  conta: { id: string; banco: string; nome_conta: string; saldo_referencia: number | string };
  remover: {
    imports: number;
    statement_items: number;
    checkpoints: number;
    reconciliation_links: number;
    transactions: number;
  };
  preservar: {
    saldo_referencia: number | string;
    transactions_independentes: number;
    transactions_compartilhadas: number;
    purchases_criadas_por_extrato: number;
  };
  detalhe_imports: {
    id: string;
    arquivo: string;
    status: string;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    lancamentos: number;
  }[];
};

type Resultado = {
  imports_removed: number;
  items_removed: number;
  checkpoints_removed: number;
  transactions_removed: number;
  links_removed: number;
  preserved_transactions: number;
  saldo_atual: number | string;
};

const CONFIRMACAO = "RESETAR";

export function ImportResetDialog({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [texto, setTexto] = useState("");

  function limpar() {
    setDry(null);
    setResultado(null);
    setTexto("");
  }

  async function analisar() {
    setRodando(true);
    try {
      const { data, error } = await supabase.rpc("inspect_bank_import_reset", {
        _account_id: accountId,
      });
      if (error) throw error;
      setResultado(null);
      setDry(data as unknown as DryRun);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar o reset.");
    } finally {
      setRodando(false);
    }
  }

  async function confirmar() {
    setRodando(true);
    try {
      const { data, error } = await supabase.rpc("reset_bank_account_imports", {
        _account_id: accountId,
      });
      if (error) throw error;
      setResultado(data as unknown as Resultado);
      setDry(null);
      setTexto("");
      for (const key of [
        "bank-statement-imports",
        "bank-statement-items",
        "bank-balance-checkpoints",
        "bank-accounts",
        "transactions",
      ]) {
        await queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success("Histórico importado removido. A conta continua cadastrada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao executar o reset.");
    } finally {
      setRodando(false);
    }
  }

  function baixarSnapshot() {
    if (!dry) return;
    const blob = new Blob([JSON.stringify(dry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reset-extratos-${accountId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v && !rodando) limpar();
      }}
    >
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 px-4 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10">
          <Eraser className="size-3.5" /> Resetar histórico importado
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Resetar histórico importado</DialogTitle>
          <DialogDescription>
            Remove somente dados derivados dos extratos desta conta. O cadastro da conta e o saldo
            de referência serão preservados.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Só sai o que tem origem comprovada nos extratos importados.
          </li>
          <li className="pl-5">
            Movimentação que já existia antes do extrato perde apenas o vínculo.
          </li>
          <li className="pl-5">Compras, cartões, faturas, receitas e outras contas ficam.</li>
        </ul>

        {rodando && (
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Loader2 className="size-3.5 animate-spin" /> Processando…
          </p>
        )}

        {dry && (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                Será removido
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Resumo label="Importações" valor={dry.remover.imports} />
                <Resumo label="Lançamentos lidos" valor={dry.remover.statement_items} />
                <Resumo label="Checkpoints" valor={dry.remover.checkpoints} />
                <Resumo label="Vínculos desfeitos" valor={dry.remover.reconciliation_links} />
                <Resumo label="Movimentações do extrato" valor={dry.remover.transactions} />
              </div>
            </div>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                Será preservado
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Resumo label="Conta bancária" valor="mantida" />
                <Resumo
                  label="Saldo de referência"
                  valor={formatCurrency(Number(dry.preservar.saldo_referencia))}
                />
                <Resumo
                  label="Movimentações independentes"
                  valor={dry.preservar.transactions_independentes}
                />
                <Resumo
                  label="Compartilhadas com compras"
                  valor={dry.preservar.transactions_compartilhadas}
                />
                <Resumo
                  label="Compras criadas por extrato"
                  valor={dry.preservar.purchases_criadas_por_extrato}
                />
                <Resumo label="Cartões e faturas" valor="mantidos" />
              </div>
            </div>

            {dry.detalhe_imports.length > 0 && (
              <ul className="space-y-1">
                {dry.detalhe_imports.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                      {i.arquivo}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {i.periodo_inicio ? formatDate(i.periodo_inicio) : "—"} →{" "}
                      {i.periodo_fim ? formatDate(i.periodo_fim) : "—"} · {i.lancamentos} lanç.
                    </span>
                    <StatusBadge tone="muted">{i.status}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={baixarSnapshot}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-muted"
              >
                <Download className="size-3" /> Baixar retrato (JSON)
              </button>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold">
                Digite <span className="font-mono">{CONFIRMACAO}</span> para liberar a confirmação
              </p>
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={CONFIRMACAO} />
            </div>
          </div>
        )}

        {resultado && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Resumo label="Importações removidas" valor={resultado.imports_removed} />
            <Resumo label="Lançamentos removidos" valor={resultado.items_removed} />
            <Resumo label="Checkpoints removidos" valor={resultado.checkpoints_removed} />
            <Resumo label="Movimentações removidas" valor={resultado.transactions_removed} />
            <Resumo label="Vínculos desfeitos" valor={resultado.links_removed} />
            <Resumo label="Saldo recalculado" valor={formatCurrency(Number(resultado.saldo_atual))} />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={rodando}>
            Fechar
          </Button>
          <Button variant="outline" onClick={analisar} disabled={rodando}>
            Analisar reset
          </Button>
          <Button
            variant="destructive"
            onClick={confirmar}
            disabled={rodando || !dry || texto.trim().toUpperCase() !== CONFIRMACAO}
          >
            Confirmar reset
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Resumo({ label, valor }: { label: string; valor: string | number }) {
  return (
    <div className="rounded-2xl border border-border px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{valor}</p>
    </div>
  );
}
