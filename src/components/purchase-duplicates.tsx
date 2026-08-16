import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Card } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { MergePurchaseDialog } from "@/components/purchase-merge";
import { similaridadeFornecedor } from "@/lib/card-statements";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import { escolherPrincipal, type Purchase } from "@/lib/purchases";

type Par = { principal: Purchase; duplicada: Purchase; motivo: string };

const dias = (a: string, b: string) =>
  Math.abs(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );

/**
 * Nota fiscal e fatura do cartão são o MESMO evento econômico.
 * Aqui procuramos pares que provavelmente representam a mesma compra:
 * valor total compatível (com tolerância de arredondamento das parcelas),
 * datas próximas e fornecedor reconhecível ("NS2.COM" ≈ "MLP*Netshoes-NS2CO").
 */
export function encontrarDuplicidades(purchases: Purchase[]): Par[] {
  const pares: Par[] = [];
  const usados = new Set<string>();
  for (let i = 0; i < purchases.length; i++) {
    for (let j = i + 1; j < purchases.length; j++) {
      const a = purchases[i]!;
      const b = purchases[j]!;
      if (usados.has(a.id) || usados.has(b.id)) continue;
      const va = Number(a.valor_total);
      const vb = Number(b.valor_total);
      const tolerancia = Math.max(2, Math.max(va, vb) * 0.01);
      const valorCompativel = Math.abs(va - vb) <= tolerancia;
      const proximidade = dias(a.data_compra, b.data_compra) <= 45;
      const sim = similaridadeFornecedor(a.estabelecimento, b.estabelecimento);
      if (!valorCompativel || !proximidade || sim < 0.35) continue;
      const { principal, duplicada } = escolherPrincipal(
        { ...a, valor_total: va },
        { ...b, valor_total: vb },
      );
      usados.add(a.id);
      usados.add(b.id);
      pares.push({
        principal: principal as Purchase,
        duplicada: duplicada as Purchase,
        motivo:
          Math.abs(va - vb) < 0.01
            ? "Mesmo valor e mesmo período"
            : "Valor equivalente considerando o arredondamento das parcelas",
      });
    }
  }
  return pares;
}

/** Aviso de possível duplicidade entre a compra da nota e a cobrança da fatura. */
export function PossiveisDuplicidades({
  purchases,
  onMerged,
}: {
  purchases: Purchase[];
  onMerged?: () => void;
}) {
  const pares = useMemo(() => encontrarDuplicidades(purchases), [purchases]);
  const [mesclando, setMesclando] = useState<Par | null>(null);
  if (pares.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Copy className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Possível correspondência</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        A nota fiscal descreve a compra e a fatura descreve a cobrança. Se forem o mesmo evento,
        mescle para manter uma única compra com os produtos da nota e o parcelamento do cartão.
      </p>
      <ul className="space-y-3">
        {pares.map((par) => (
          <li
            key={`${par.principal.id}-${par.duplicada.id}`}
            className="rounded-2xl border border-border p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Compra existente
                </p>
                <p className="font-semibold leading-tight">{par.principal.estabelecimento}</p>
                <p className="text-sm">
                  {formatCurrency(Number(par.principal.valor_total))} ·{" "}
                  {formatDate(par.principal.data_compra)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Lançamento da fatura
                </p>
                <p className="font-semibold leading-tight">{par.duplicada.estabelecimento}</p>
                <p className="text-sm">
                  {formatCurrency(Number(par.duplicada.valor_total))} ·{" "}
                  {formatDate(par.duplicada.data_compra)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{par.motivo}</span>
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                onClick={() => setMesclando(par)}
              >
                Mesclar compras
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {mesclando && (
        <MergePurchaseDialog
          principalId={mesclando.principal.id}
          duplicadaId={mesclando.duplicada.id}
          onClose={() => setMesclando(null)}
          {...(onMerged ? { onMerged } : {})}
        />
      )}
    </Card>
  );
}
