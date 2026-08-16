/**
 * TELA DEV — DIAGNÓSTICO DO PARSER BANCÁRIO.
 *
 * READ-ONLY por construção: roda o pipeline em memória e mostra cada etapa
 * (itens crus → detecção → linhas → parser → validação). Não cria transação,
 * não toca ledger, não concilia e não corrige nada automaticamente.
 *
 * Visível apenas para administradores da família (uso de diagnóstico).
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSearch, ShieldAlert } from "lucide-react";
import { Card, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCurrency } from "@/lib/finance";
import { loadLatestStatementDraft } from "@/lib/bank-statements/draft";
import {
  buildBankParserDiagnostics,
  diagnosticsFromParsedStatement,
  diagnosticsToCsv,
  type BankParserDiagnostics,
  type DiagRow,
} from "@/lib/bank-statements/diagnostics";

export const Route = createFileRoute("/_authenticated/dev/bank-parser-diagnostics")({
  validateSearch: (search: Record<string, unknown>) => ({
    import: typeof search["import"] === "string" ? (search["import"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Diagnóstico do parser bancário — Família Finance AI" },
      {
        name: "description",
        content:
          "Ferramenta de desenvolvimento: mostra como cada PDF bancário é lido, linha a linha, antes de qualquer gravação.",
      },
      { property: "og:title", content: "Diagnóstico do parser bancário" },
      {
        property: "og:description",
        content: "PDF → itens crus → detecção → linhas → parser → validação, tudo em memória.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BankParserDiagnosticsPage,
});

const ABAS = [
  "RESUMO",
  "RAW ITEMS",
  "ROWS",
  "PARSED",
  "IGNORADOS",
  "DETECTION",
  "VALIDATION",
] as const;
type Aba = (typeof ABAS)[number];

const CORES_STATUS: Record<DiagRow["status"], string> = {
  PARSED_TRANSACTION: "bg-primary/10 text-primary",
  PARSED_CHECKPOINT: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  IGNORED: "bg-muted text-muted-foreground",
  ERROR: "bg-destructive/10 text-destructive",
};

function baixar(nome: string, conteudo: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function Metric({
  label,
  value,
  alerta,
}: {
  label: string;
  value: string;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`text-base font-semibold ${alerta ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function BankParserDiagnosticsPage() {
  const { isAdmin, isLoading } = usePermissions();
  const { import: importParam } = Route.useSearch();
  const [diag, setDiag] = useState<BankParserDiagnostics | null>(null);
  const [lendo, setLendo] = useState(false);
  const [aba, setAba] = useState<Aba>("RESUMO");
  const [linhaAberta, setLinhaAberta] = useState<number | null>(null);
  const [compararGolden, setCompararGolden] = useState(true);

  const rascunho = useMemo(
    () => (importParam && !diag ? loadLatestStatementDraft() : null),
    [importParam, diag],
  );
  const doRascunho = useMemo(
    () => (rascunho ? diagnosticsFromParsedStatement(rascunho.resumo, rascunho.nomeArquivo) : null),
    [rascunho],
  );
  const d = diag ?? doRascunho;

  async function processar(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setLendo(true);
    setDiag(await buildBankParserDiagnostics(file, file.name));
    setLinhaAberta(null);
    setAba("RESUMO");
    setLendo(false);
  }

  if (isLoading) return null;
  if (!isAdmin)
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" />}
        title="Área restrita"
        description="O diagnóstico do leitor de extratos está disponível apenas para administradores da família."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnóstico do parser bancário"
        subtitle="Somente leitura: nada é gravado, nenhum saldo muda, nenhuma conciliação acontece."
      />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
            <FileSearch className="size-4" />
            {lendo ? "Lendo PDF..." : "Selecionar extrato em PDF"}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => void processar(e.target.files)}
            />
          </label>
          {d && (
            <>
              <button
                type="button"
                onClick={() =>
                  baixar(`${d.file}.diagnostico.json`, JSON.stringify(d, null, 2), "application/json")
                }
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium"
              >
                <Download className="size-3.5" /> Exportar JSON
              </button>
              <button
                type="button"
                onClick={() => baixar(`${d.file}.diagnostico.csv`, diagnosticsToCsv(d), "text/csv")}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium"
              >
                <Download className="size-3.5" /> Exportar CSV
              </button>
            </>
          )}
        </div>
        {doRascunho && !diag && (
          <p className="text-xs text-muted-foreground">
            Mostrando o extrato lido na revisão ({doRascunho.file}). As etapas de itens crus e
            montagem de linhas só aparecem ao selecionar o PDF novamente aqui.
          </p>
        )}
      </Card>

      {!d ? (
        <EmptyState
          icon={<FileSearch className="size-6" />}
          title="Nenhum documento analisado"
          description="Selecione um extrato em PDF para ver exatamente como o sistema o interpreta."
        />
      ) : (
        <>
          {(!!d.errors.length || !!d.parserInternalStages.length || d.parserExecutionInput) && (
            <Card className="space-y-3">
              <h2 className="text-sm font-extrabold">Execução do parser</h2>
              {d.parserExecutionInput && (
                <pre className="overflow-auto rounded-2xl bg-muted/40 p-3 text-[11px]">
                  {JSON.stringify(d.parserExecutionInput, null, 2)}
                </pre>
              )}
              {d.parserInternalStages.map((s) => (
                <p key={s.stage} className="text-xs">
                  <span className={s.status === "PASS" ? "text-primary" : "text-destructive"}>
                    {s.status === "PASS" ? "✓" : "✕"} {s.stage}
                  </span>{" "}
                  <span className="text-muted-foreground">{s.reason}</span>
                </p>
              ))}
              {d.errors.map((e, i) => (
                <div key={i} className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-xs font-bold text-destructive">
                    {e.stage} · {e.name}
                  </p>
                  <p className="text-xs font-semibold">{e.message}</p>
                  {e.stack && (
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
                      {e.stack}
                    </pre>
                  )}
                </div>
              ))}
            </Card>
          )}
          <Card className="space-y-4">

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Metric label="Arquivo" value={d.file} />
              <Metric label="Banco detectado" value={d.detection.detectedBank} />
              <Metric label="Parser" value={d.detection.parser} />
              <Metric label="Versão do parser" value={d.detection.parserVersion} />
              <Metric label="Conta detectada" value={d.statement?.account ?? "—"} />
              <Metric
                label="Período detectado"
                value={`${d.statement?.periodStart ?? "?"} → ${d.statement?.periodEnd ?? "?"}`}
                alerta={!d.statement?.periodStart}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Metric label="Raw PDF items" value={String(d.counts.rawItems)} alerta={!d.counts.rawItems} />
              <Metric label="Rows montadas" value={String(d.counts.rows)} alerta={!d.counts.rows} />
              <Metric
                label="Movimentações"
                value={String(d.counts.transactions)}
                alerta={!d.counts.transactions}
              />
              <Metric label="Checkpoints" value={String(d.counts.checkpoints)} />
              <Metric
                label="Opening balance"
                value={
                  d.statement?.openingBalance?.amount == null
                    ? "—"
                    : formatCurrency(d.statement.openingBalance.amount)
                }
              />
              <Metric
                label="Closing balance"
                value={
                  d.statement?.closingBalance?.amount == null
                    ? "—"
                    : formatCurrency(d.statement.closingBalance.amount)
                }
              />
              <Metric
                label="Reference balance"
                value={
                  d.statement?.referenceBalance
                    ? `${formatCurrency(d.statement.referenceBalance.amount)} (${d.statement.referenceBalance.date})`
                    : "—"
                }
              />
              <Metric
                label="Math validation"
                value={d.validation.math.ok ? "PASS" : "FAIL"}
                alerta={!d.validation.math.ok}
              />
            </div>

            {d.failure.stage && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <p className="font-semibold text-destructive">
                  Failure stage: {d.failure.stage}
                </p>
                <p className="text-muted-foreground">{d.failure.reason}</p>
                <p className="mt-1 text-muted-foreground">
                  Raw items: {d.counts.rawItems} · Rows: {d.counts.rows} · Transactions parsed:{" "}
                  {d.counts.transactions}
                </p>
              </div>
            )}
          </Card>

          <div className="flex flex-wrap gap-2">
            {ABAS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAba(a)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                  aba === a
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          {aba === "RESUMO" && <Resumo d={d} comparar={compararGolden} onComparar={setCompararGolden} />}
          {aba === "RAW ITEMS" && <RawItems d={d} />}
          {aba === "ROWS" && (
            <Rows d={d} aberta={linhaAberta} onAbrir={(i) => setLinhaAberta(linhaAberta === i ? null : i)} />
          )}
          {aba === "PARSED" && <Parsed d={d} />}
          {aba === "IGNORADOS" && <Ignorados d={d} />}
          {aba === "DETECTION" && <Detection d={d} />}
          {aba === "VALIDATION" && <Validation d={d} />}
        </>
      )}
    </div>
  );
}

function Resumo({
  d,
  comparar,
  onComparar,
}: {
  d: BankParserDiagnostics;
  comparar: boolean;
  onComparar: (v: boolean) => void;
}) {
  const porStatus = d.rows.reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {});
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(porStatus).map(([s, n]) => (
          <span key={s} className={`rounded-full px-3 py-1 font-semibold ${CORES_STATUS[s as DiagRow["status"]]}`}>
            {s}: {n}
          </span>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={comparar} onChange={(e) => onComparar(e.target.checked)} />
        Comparar com esperado (fixtures DEV)
      </label>

      {comparar &&
        (d.golden ? (
          <div className="space-y-2 rounded-xl border border-border p-3 text-xs">
            <p className="font-semibold">Golden {d.golden.monthKey}</p>
            <p className="text-muted-foreground">
              Esperado: {d.golden.expected.transactions} transactions · abertura{" "}
              {formatCurrency(d.golden.expected.opening)} · fechamento{" "}
              {formatCurrency(d.golden.expected.closing)}
            </p>
            <p className={d.golden.difference === 0 ? "text-primary" : "font-semibold text-destructive"}>
              Encontrado: {d.golden.found.transactions} · diferença{" "}
              {d.golden.difference > 0 ? `+${d.golden.difference}` : d.golden.difference}
            </p>
            {d.golden.missingRows.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold">Linhas esperadas que não viraram transaction</p>
                {d.golden.missingRows.map((r) => (
                  <p key={r.index} className="text-muted-foreground">
                    #{r.index} · {r.reason} · {r.raw}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Não há valores esperados cadastrados para este documento.
          </p>
        ))}
    </Card>
  );
}

function RawItems({ d }: { d: BankParserDiagnostics }) {
  if (!d.rawItems.length)
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          Itens crus indisponíveis nesta origem. Selecione o PDF para ver a extração do pdf.js.
        </p>
      </Card>
    );
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="border-b border-border text-left uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">page</th>
            <th className="px-3 py-2">index</th>
            <th className="px-3 py-2">text</th>
            <th className="px-3 py-2 text-right">x</th>
            <th className="px-3 py-2 text-right">y</th>
            <th className="px-3 py-2 text-right">width</th>
            <th className="px-3 py-2 text-right">height</th>
          </tr>
        </thead>
        <tbody>
          {d.rawItems.map((i) => (
            <tr key={i.index} className="border-b border-border/50">
              <td className="px-3 py-1.5">{i.page}</td>
              <td className="px-3 py-1.5 font-mono">{i.index}</td>
              <td className="px-3 py-1.5">{i.text}</td>
              <td className="px-3 py-1.5 text-right font-mono">{i.x}</td>
              <td className="px-3 py-1.5 text-right font-mono">{i.y}</td>
              <td className="px-3 py-1.5 text-right font-mono">{i.width}</td>
              <td className="px-3 py-1.5 text-right font-mono">{i.height ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Rows({
  d,
  aberta,
  onAbrir,
}: {
  d: BankParserDiagnostics;
  aberta: number | null;
  onAbrir: (i: number) => void;
}) {
  return (
    <Card className="space-y-2">
      {d.rows.map((r) => {
        const transacao = d.statement.transactions?.find((t) => t.sourceId === r.sourceId) ?? null;
        const check = d.validation.checkpoints?.find((c) => c.date === r.date) ?? null;
        return (
          <div key={r.index} className="rounded-xl border border-border">
            <button
              type="button"
              onClick={() => onAbrir(r.index)}
              className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs"
            >
              <span className="font-mono text-muted-foreground">ROW {r.index}</span>
              <span className="font-mono">{r.date ?? "—"}</span>
              <span className="flex-1 truncate">{r.description || r.raw}</span>
              <span className="font-mono">{r.amount ?? "null"}</span>
              <span className="font-mono text-muted-foreground">saldo {r.balance ?? "null"}</span>
              <span className={`rounded-full px-2 py-0.5 font-semibold ${CORES_STATUS[r.status]}`}>
                {r.status}
              </span>
              <span className="text-muted-foreground">{r.reason}</span>
            </button>
            {aberta === r.index && (
              <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-3 text-[11px]">
                <div>
                  <p className="font-semibold uppercase text-muted-foreground">Raw items</p>
                  <p className="font-mono">
                    {r.rawItemIndexes.length ? r.rawItemIndexes.join(", ") : "—"}
                  </p>
                  {d.rawItems
                    .filter((i) => r.rawItemIndexes.includes(i.index))
                    .map((i) => (
                      <p key={i.index} className="font-mono text-muted-foreground">
                        [{i.index}] x={i.x} y={i.y} · {i.text}
                      </p>
                    ))}
                </div>
                <div>
                  <p className="font-semibold uppercase text-muted-foreground">Assembled row</p>
                  <p className="font-mono">{r.raw}</p>
                  <p className="text-muted-foreground">
                    page {r.page} · y {r.y} · date {r.date ?? "null"} · amount {r.amount ?? "null"} ·
                    balance {r.balance ?? "null"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold uppercase text-muted-foreground">Parsed item</p>
                  {transacao ? (
                    <p className="font-mono">
                      {transacao.postingDate} · {transacao.description} ·{" "}
                      {transacao.direction === "IN" ? "+" : "−"}
                      {formatCurrency(transacao.amount)} · {transacao.kind} · {transacao.sourceId}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      {r.status === "PARSED_CHECKPOINT"
                        ? "checkpoint de saldo (não é movimentação)"
                        : `não virou transação — ${r.reason}`}
                    </p>
                  )}
                </div>
                <div>
                  <p className="font-semibold uppercase text-muted-foreground">Validation result</p>
                  {check ? (
                    <p className={check.ok ? "text-primary" : "text-destructive"}>
                      saldo do dia {check.date}: documento {formatCurrency(check.expected)} ·
                      calculado {formatCurrency(check.calculated)} · diferença{" "}
                      {formatCurrency(check.difference)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">sem conferência específica para esta linha</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function Parsed({ d }: { d: BankParserDiagnostics }) {
  const s = d.statement;
  return (
    <div className="space-y-4">
      <Card className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="bank" value={s.bank ?? "—"} />
        <Metric label="account" value={s.account ?? "—"} />
        <Metric label="periodStart" value={s.periodStart ?? "—"} />
        <Metric label="periodEnd" value={s.periodEnd ?? "—"} />
        <Metric
          label="openingBalance"
          value={s.openingBalance?.amount == null ? "—" : formatCurrency(s.openingBalance.amount)}
        />
        <Metric
          label="closingBalance"
          value={s.closingBalance?.amount == null ? "—" : formatCurrency(s.closingBalance.amount)}
        />
        <Metric
          label="referenceBalance"
          value={s.referenceBalance ? formatCurrency(s.referenceBalance.amount) : "—"}
        />
        <Metric label="parserVersion" value={s.parserVersion} />
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="border-b border-border text-left uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">sourceId</th>
              <th className="px-3 py-2">postingDate</th>
              <th className="px-3 py-2">description</th>
              <th className="px-3 py-2 text-right">amount</th>
              <th className="px-3 py-2">direction</th>
              <th className="px-3 py-2">type</th>
              <th className="px-3 py-2">sourcePage</th>
              <th className="px-3 py-2">sourceRow</th>
            </tr>
          </thead>
          <tbody>
            {(s.transactions ?? []).map((t) => (
              <tr key={t.sourceId} className="border-b border-border/50">
                <td className="px-3 py-1.5 font-mono text-[10px]">{t.sourceId}</td>
                <td className="px-3 py-1.5 font-mono">{t.postingDate ?? "—"}</td>
                <td className="px-3 py-1.5">{t.description}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(t.signedAmount)}</td>
                <td className="px-3 py-1.5">{t.direction}</td>
                <td className="px-3 py-1.5">{t.kind}</td>
                <td className="px-3 py-1.5">{t.sourcePage ?? "—"}</td>
                <td className="px-3 py-1.5">{t.sourceRow}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="border-b border-border text-left uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">date</th>
              <th className="px-3 py-2 text-right">balance</th>
              <th className="px-3 py-2">type</th>
              <th className="px-3 py-2">label</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...(s.openingBalance?.date
                ? [
                    {
                      date: s.openingBalance.date,
                      amount: s.openingBalance.amount ?? 0,
                      type: "OPENING" as const,
                      label: "saldo anterior ao período",
                    },
                  ]
                : []),
              ...(s.checkpoints ?? []),
              ...(s.referenceBalance
                ? [
                    {
                      date: s.referenceBalance.date,
                      amount: s.referenceBalance.amount,
                      type: "REFERENCE" as const,
                      label: "saldo fora do período",
                    },
                  ]
                : []),
            ].map((c, i) => (
              <tr key={`${c.date}-${c.type}-${i}`} className="border-b border-border/50">
                <td className="px-3 py-1.5 font-mono">{c.date}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(c.amount)}</td>
                <td className="px-3 py-1.5">{c.type}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {"label" in c ? (c.label ?? "—") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Ignorados({ d }: { d: BankParserDiagnostics }) {
  if (!d.ignored.length)
    return (
      <Card>
        <p className="text-sm text-muted-foreground">O parser não descartou nenhuma linha.</p>
      </Card>
    );
  return (
    <Card className="space-y-2">
      {d.ignored.map((i, idx) => (
        <div key={`${i.raw}-${idx}`} className="rounded-xl border border-border px-3 py-2 text-xs">
          <p className="font-mono">{i.raw}</p>
          <p className="text-muted-foreground">
            valor {i.valor ?? "—"} · página {i.page ?? "—"}
          </p>
          <p>
            <span className="font-semibold">Motivo:</span> {i.reason}
          </p>
          <p className="text-muted-foreground">
            <span className="font-semibold">Tratamento:</span> {i.treatment}
          </p>
        </div>
      ))}
    </Card>
  );
}

function Detection({ d }: { d: BankParserDiagnostics }) {
  return (
    <Card className="space-y-3 text-xs">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="detectedBank" value={d.detection.detectedBank} />
        <Metric label="score" value={String(d.detection.score)} />
        <Metric label="parser" value={`${d.detection.parser} (${d.detection.parserVersion})`} />
      </div>
      <div>
        <p className="font-semibold uppercase text-muted-foreground">matchedSignals</p>
        {d.detection.matchedSignals.length ? (
          <ul className="space-y-0.5">
            {d.detection.matchedSignals.map((s) => (
              <li key={s}>"{s}" ✓</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">nenhum sinal reconhecido</p>
        )}
      </div>
      {d.columns && (
        <p className="text-muted-foreground">
          Colunas ({d.columns.source}): valor x≈{d.columns.valorX.toFixed(0)} · saldo x≈
          {d.columns.saldoX.toFixed(0)} · limite x≈{d.columns.limite.toFixed(0)}
        </p>
      )}
    </Card>
  );
}

function Validation({ d }: { d: BankParserDiagnostics }) {
  const m = d.validation.math;
  return (
    <div className="space-y-4">
      <Card className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="opening" value={m.opening == null ? "—" : formatCurrency(m.opening)} />
        <Metric label="total inflows" value={formatCurrency(m.inflows)} />
        <Metric label="total outflows" value={formatCurrency(m.outflows)} />
        <Metric
          label="calculated closing"
          value={m.calculatedClosing == null ? "—" : formatCurrency(m.calculatedClosing)}
        />
        <Metric
          label="reported closing"
          value={m.declaredClosing == null ? "—" : formatCurrency(m.declaredClosing)}
        />
        <Metric
          label="difference"
          value={m.difference == null ? "—" : formatCurrency(m.difference)}
          alerta={!!m.difference}
        />
      </Card>

      {d.validation.problems.length > 0 && (
        <Card>
          <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
            {d.validation.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="border-b border-border text-left uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">checkpoint date</th>
              <th className="px-3 py-2 text-right">calculated</th>
              <th className="px-3 py-2 text-right">reported</th>
              <th className="px-3 py-2 text-right">difference</th>
            </tr>
          </thead>
          <tbody>
            {d.validation.checkpoints.map((c) => (
              <tr key={c.date} className="border-b border-border/50">
                <td className="px-3 py-1.5 font-mono">{c.date}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(c.calculated)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(c.expected)}</td>
                <td
                  className={`px-3 py-1.5 text-right ${c.ok ? "text-primary" : "font-semibold text-destructive"}`}
                >
                  {formatCurrency(c.difference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
