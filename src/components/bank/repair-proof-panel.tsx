/**
 * PROVA ANTES DO REPARO — VISUALIZAÇÃO SOMENTE LEITURA.
 *
 * Mostra, linha a linha, qual documento está presente no ledger e qual está
 * ausente, e como a diferença se propaga pelos meses seguintes. Nenhum botão
 * aqui grava nada.
 */
import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import type { RepairProof } from "@/lib/bank-statements/repair-proof";
import { formatCurrency } from "@/lib/finance";

export function RepairProofPanel({ proof }: { proof: RepairProof }) {
  return (
    <>
      <Card className="mb-5">
        <SectionTitle
          title="Prova antes do reparo — qual documento existe e qual está ausente"
          hint="Nas datas em que o extrato repete o mesmo valor, cada linha é identificada pelo número do documento. Só a linha AUSENTE NO LEDGER poderia ser restaurada."
        />
        {proof.grupos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma data desta conta tem linhas repetidas com movimento ausente.
          </p>
        ) : (
          <div className="space-y-4">
            {proof.grupos.map((g) => (
              <div key={`${g.importId}-${g.data}`} className="rounded-2xl border border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {g.data} · {formatCurrency(g.valorAbsoluto)} · {g.linhas.length} movimentos no
                    documento
                  </p>
                  <StatusBadge tone={g.ausentes ? "danger" : "ok"}>
                    {g.presentes} no ledger · {g.ausentes} ausente(s)
                  </StatusBadge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{g.nomeArquivo}</p>

                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {g.linhas.map((l) => (
                    <div
                      key={l.itemId}
                      className={`rounded-2xl border px-3 py-3 ${
                        l.presente
                          ? "border-border bg-muted/30"
                          : "border-destructive/50 bg-destructive/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge tone={l.presente ? "ok" : "danger"}>
                          {l.presente ? "EXISTE NO LEDGER" : "AUSENTE NO LEDGER"}
                        </StatusBadge>
                        <span className="text-xs font-semibold">
                          {l.direcao === "IN" ? "+" : "−"}
                          {formatCurrency(l.valor)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold">{l.descricao}</p>
                      <dl className="mt-2 space-y-1 text-[11px]">
                        <Linha rotulo="documentNumber" valor={l.documentNumber ?? "não persistido"} />
                        <Linha rotulo="parser sourceId" valor={l.sourceId} />
                        <Linha rotulo="statement item" valor={l.itemId} />
                        <Linha
                          rotulo="transaction_id"
                          valor={l.ledgerTransactionId ?? "— nenhum movimento no ledger"}
                        />
                        <Linha rotulo="postingDate" valor={l.data ?? "—"} />
                        <Linha rotulo="direction" valor={l.direcao} />
                        <Linha rotulo="status atual" valor={`${l.reviewAction} / ${l.matchStatus}`} />
                        {l.rawText && <Linha rotulo="rawText" valor={l.rawText} />}
                      </dl>
                      {!l.presente && (
                        <p className="mt-2 text-xs font-semibold text-destructive">
                          Efeito no saldo se restaurado: {formatCurrency(l.deltaSaldo)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <SectionTitle
          title="Propagação da diferença mês a mês"
          hint="A diferença de um período não morre nele: ela vive em todos os saldos seguintes. Antes é o que o sistema mostra hoje; depois é a simulação com a linha ausente restaurada."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-semibold">Período</th>
                <th className="px-2 py-2 font-semibold">Saldo do banco</th>
                <th className="px-2 py-2 font-semibold">Sistema hoje</th>
                <th className="px-2 py-2 font-semibold">Sistema simulado</th>
                <th className="px-2 py-2 font-semibold">Diferença antes → depois</th>
              </tr>
            </thead>
            <tbody>
              {proof.propagacao.map((p) => (
                <tr key={p.rotulo} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-semibold">
                    {p.rotulo}
                    {p.origemDaDiferenca && (
                      <span className="ml-2 text-[11px] font-medium text-destructive">
                        origem da diferença
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {p.saldoDocumento === null ? "—" : formatCurrency(p.saldoDocumento)}
                  </td>
                  <td className="px-2 py-2">
                    {p.saldoSistemaAntes === null ? "—" : formatCurrency(p.saldoSistemaAntes)}
                  </td>
                  <td className="px-2 py-2">
                    {p.saldoSistemaDepois === null ? "—" : formatCurrency(p.saldoSistemaDepois)}
                  </td>
                  <td className="px-2 py-2">
                    <span className={p.diferencaAntes ? "font-semibold text-destructive" : ""}>
                      {p.diferencaAntes === null ? "—" : formatCurrency(p.diferencaAntes)}
                    </span>{" "}
                    →{" "}
                    <span className="font-semibold text-primary">
                      {p.diferencaDepois === null ? "—" : formatCurrency(p.diferencaDepois)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Saldo com que o próximo período começaria depois do reparo:{" "}
          <span className="font-semibold text-foreground">
            {proof.saldoInicialSeguinte === null
              ? "—"
              : formatCurrency(proof.saldoInicialSeguinte)}
          </span>
        </p>
      </Card>
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 break-all font-mono">{valor}</dd>
    </div>
  );
}
