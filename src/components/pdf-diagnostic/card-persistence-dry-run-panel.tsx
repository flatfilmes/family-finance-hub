/**
 * Painel READ-ONLY do CARD_STATEMENT_PERSISTENCE_DRY_RUN.
 * Só executa SELECTs: nenhuma compra, invoice ou item é criado.
 */
import { useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runCardStatementPersistenceDryRun } from "@/lib/card-statement-persistence.data";
import type {
  CardDryRunItemStatus,
  CardStatementPersistenceDryRun,
  InvoiceCanonical,
  OfficialItem,
} from "@/lib/card-statement-persistence";

const moeda = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBr = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
};

const TOM: Record<CardDryRunItemStatus, string> = {
  EXACT_MATCH: "bg-primary/15 text-primary",
  STRONG_MATCH: "bg-primary/10 text-primary",
  POSSIBLE_MATCH: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  NEW_ITEM: "bg-muted text-foreground",
  CONFLICT: "bg-destructive/15 text-destructive",
};

function Metrica({ label, valor, tom }: { label: string; valor: string; tom?: "ok" | "falha" }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        tom === "ok"
          ? "border-primary/40 bg-accent/30"
          : tom === "falha"
            ? "border-destructive/40 bg-destructive/5"
            : "border-border bg-card"
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-extrabold">{valor}</p>
    </div>
  );
}

export function CardPersistenceDryRunPanel({
  familyId,
  invoice,
  items,
}: {
  familyId?: string;
  invoice: InvoiceCanonical;
  items: OfficialItem[];
}) {
  const [resultado, setResultado] = useState<CardStatementPersistenceDryRun | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState("");

  async function rodar() {
    if (!familyId) {
      setErro("Nenhuma família ativa para simular a reconciliação.");
      return;
    }
    setRodando(true);
    setErro("");
    try {
      setResultado(await runCardStatementPersistenceDryRun({ familyId, invoice, items }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível simular a reconciliação.");
    } finally {
      setRodando(false);
    }
  }

  const r = resultado;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold">Persistência — dry run</h2>
          <p className="text-[13px] text-muted-foreground">
            Simula como esta fatura seria reconciliada com compras, faturas e parcelas já
            existentes. Somente leitura: nada é gravado.
          </p>
        </div>
        <Button onClick={() => void rodar()} disabled={rodando}>
          {rodando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlayCircle className="size-4" />
          )}
          Simular reconciliação
        </Button>
      </div>

      {erro && (
        <p className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {erro}
        </p>
      )}

      {r && (
        <>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={r.status === "PASS" ? "default" : "secondary"}>{r.status}</Badge>
              <p className="text-sm font-bold">
                {r.invoice.issuer ?? "—"} · {dataBr(r.invoice.closingDate)} ·{" "}
                {moeda(r.invoice.invoiceTotal)}
              </p>
              <span className="text-[13px] text-muted-foreground">
                finais {r.invoice.cardLast4s.join(", ") || "—"}
              </span>
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">{r.invoice.consolidationNote}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica label="Official items" valor={String(r.summary.officialItems)} />
            <Metrica label="Already matched" valor={String(r.summary.alreadyMatched)} />
            <Metrica
              label="Possible matches"
              valor={String(r.summary.possibleMatches)}
              {...(r.summary.possibleMatches ? { tom: "falha" as const } : {})}
            />
            <Metrica label="New items" valor={String(r.summary.newItems)} />
            <Metrica
              label="Conflicts"
              valor={String(r.summary.conflicts)}
              {...(r.summary.conflicts ? { tom: "falha" as const } : {})}
            />
            <Metrica
              label="Would create purchases"
              valor={String(r.summary.wouldCreatePurchases)}
            />
            <Metrica label="Would update existing" valor={String(r.summary.wouldUpdateExisting)} />
            <Metrica label="Would duplicate" valor={String(r.summary.wouldDuplicate)} tom="ok" />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Cartão</p>
              <p className="mt-1 text-sm font-bold">{r.cardMapping.status}</p>
              <p className="text-[13px] text-muted-foreground">{r.cardMapping.explicacao}</p>
              <ul className="mt-3 space-y-1 text-[13px]">
                {r.cardMapping.candidatos.map((c) => (
                  <li key={c.id} className={c.id === r.cardMapping.selectedCardId ? "font-bold" : ""}>
                    {c.banco} · {c.nome} · finais {c.last4Cadastrados.join(", ") || "—"} — {c.motivo}
                  </li>
                ))}
                {!r.cardMapping.candidatos.length && <li>Nenhum candidato encontrado.</li>}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[11px] font-bold uppercase text-muted-foreground">
                Identidade da fatura
              </p>
              <p className="mt-1 text-sm font-bold">{r.identity.status}</p>
              <p className="text-[13px] text-muted-foreground">{r.identity.explicacao}</p>
              <p className="mt-2 break-all text-[12px] text-muted-foreground">
                fingerprint: {r.identity.fingerprint ?? "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Totais</p>
              <p className="mt-1 text-[13px]">
                officialItemsTotal: <b>{moeda(r.totals.officialItemsTotal)}</b>
              </p>
              <p className="text-[13px]">
                declaredInvoiceTotal: <b>{moeda(r.totals.declaredInvoiceTotal)}</b>
              </p>
              <p className="text-[13px]">
                difference: <b>{r.totals.difference.toFixed(2)}</b>
              </p>
              <p className="text-[13px]">
                canonicalEconomicTotalAfter: <b>{moeda(r.totals.canonicalEconomicTotalAfter)}</b>
              </p>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Pagamento anterior {dataBr(r.previousPayment.date)} {moeda(r.previousPayment.amount)}{" "}
                — {r.previousPayment.treatment}: {r.previousPayment.note}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Data</th>
                  <th className="px-3 py-2 text-left font-bold">Final</th>
                  <th className="px-3 py-2 text-left font-bold">Descrição</th>
                  <th className="px-3 py-2 text-right font-bold">Valor</th>
                  <th className="px-3 py-2 text-left font-bold">Status</th>
                  <th className="px-3 py-2 text-left font-bold">Purchase</th>
                  <th className="px-3 py-2 text-left font-bold">Statement item</th>
                  <th className="px-3 py-2 text-left font-bold">Motivo</th>
                  <th className="px-3 py-2 text-left font-bold">Ação prevista</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.index} className="border-t border-border align-top">
                    <td className="px-3 py-2">{dataBr(i.date)}</td>
                    <td className="px-3 py-2">{i.cardLast4 ?? "—"}</td>
                    <td className="px-3 py-2">
                      {i.description}
                      {i.installment ? ` (${i.installment})` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">{moeda(i.amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TOM[i.status]}`}>
                        {i.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 break-all text-[12px]">{i.matchedPurchaseId ?? "—"}</td>
                    <td className="px-3 py-2 break-all text-[12px]">
                      {i.matchedStatementItemId ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">{i.matchReason}</td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {i.actionPreview}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 text-[13px]">
            <p className="text-[11px] font-bold uppercase text-muted-foreground">
              Idempotência — segunda importação do mesmo arquivo
            </p>
            <p className="mt-1">
              {r.secondImport.status} · new economic purchases:{" "}
              <b>{r.secondImport.newEconomicPurchases}</b> · duplicate economic effects:{" "}
              <b>{r.secondImport.duplicateEconomicEffects}</b>
            </p>
            <p className="text-muted-foreground">{r.secondImport.note}</p>
            <p className="mt-3">
              Pronto para persistência real:{" "}
              <b>{r.readyForRealPersistence ? "SIM" : "NÃO"}</b>
            </p>
            {r.blockers.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {r.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>

          <details className="rounded-2xl border border-border bg-card p-5">
            <summary className="cursor-pointer text-sm font-bold">JSON do dry run</summary>
            <pre className="mt-3 max-h-[420px] overflow-auto text-[12px]">
              {JSON.stringify(r, null, 2)}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
