/**
 * PÁGINA (não modal) de diagnóstico do parser bancário.
 *
 * Ocupa toda a largura da aplicação, usa o scroll normal do navegador e roda
 * o parser REAL em dry run (memória): sem insert, sem update, sem Supabase,
 * sem conciliação e sem ledger.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Bug, Copy, Download, Loader2, RefreshCw } from "lucide-react";
import {
  dumpToNdjson,
  linesToNdjson,
  visualLineText,
  type DiagnosticSource,
  type ParserDryRunResult,
} from "@/lib/pdf-diagnostic";
import { useFamily } from "@/hooks/useFamilyData";
import { CardPersistenceDryRunPanel } from "@/components/pdf-diagnostic/card-persistence-dry-run-panel";
import { peekDiagnosticFile } from "@/lib/pdf-diagnostic/file-handoff";
import {
  runBankStatementDryRun,
  type BankStatementDryRunResult,
} from "@/lib/bank-statements/dry-run";
import { buildParserInput, DOCUMENT_PARSER_REGISTRY } from "@/lib/document-parsers/registry";
import { routeDocumentParser } from "@/lib/document-parsers/routing";
import type { InstitutionCode, ParserRoutingResult } from "@/lib/document-parsers/types";

type SaidaExtrato = {
  bank?: string | null;
  parser?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  openingBalance?: { date: string | null; amount: number | null } | null;
  closingBalance?: { date: string | null; amount: number | null } | null;
  referenceBalance?: { date: string; amount: number } | null;
  transactions?: Array<{
    sourceId: string;
    postingDate: string | null;
    description: string;
    bankOperation?: string | null;
    counterparty?: string | null;
    lot?: string | null;
    documentNumber?: string | null;
    direction: "IN" | "OUT";
    signedAmount: number;
    sourcePage: number | null;
    sourceRow: number;
    kind: string;
  }>;
  checkpoints?: Array<{
    date: string;
    amount: number;
    type: string;
    label?: string | null;
    sourcePage?: number | null;
  }>;
  validation?: { status?: string; problems?: string[]; math?: Record<string, unknown> };
};

type SaidaFatura = {
  documentType?: string;
  invoice?: {
    issuer?: string | null;
    holder?: string | null;
    cardLast4?: string | null;
    cardLast4s?: string[];
    periodStart?: string | null;
    periodEnd?: string | null;
    closingDate?: string | null;
    nextClosingDate?: string | null;
    dueDate?: string | null;
    issueDate?: string | null;
    invoiceTotal?: number | null;
    previousInvoiceTotal?: number | null;
    previousPayment?: { data: string | null; valor: number } | null;
    creditLimit?: number | null;
  };
  validation?: {
    status?: string;
    declaredInvoiceTotal?: number | null;
    chargedItemsTotal?: number | null;
    difference?: number | null;
    problems?: string[];
  };
  diagnosticStatus?: string;
  itemCounts?: Record<string, number>;
  items?: Array<{
    category: string;
    date: string | null;
    description: string;
    amount: number;
    installmentCurrent: number | null;
    installmentTotal: number | null;
    cardLast4: string | null;
  }>;
  bankTransactions?: number;
  bankCheckpoints?: number;
};

const ABAS = [
  ["RESUMO", "Resumo"],
  ["PIPELINE", "Pipeline"],
  ["TRANSACOES", "Transações"],
  ["CHECKPOINTS", "Checkpoints"],
  ["FATURA", "Fatura"],
  ["PERSISTENCIA", "Persistência"],
  ["LINHAS", "Linhas"],
  ["RAW", "Raw PDF"],
  ["ERROS", "Erros"],
  ["JSON", "JSON"],
] as const;
type Aba = (typeof ABAS)[number][0];

/** Abas válidas para FATURA: extrato bancário não se aplica a este documento. */
const ABAS_FATURA: Aba[] = [
  "RESUMO",
  "FATURA",
  "PERSISTENCIA",
  "LINHAS",
  "RAW",
  "ERROS",
  "JSON",
] as Aba[];

const dataBr = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
};

const moeda = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const quebra = "min-w-0 break-words [overflow-wrap:anywhere]";

function Cartao({
  label,
  valor,
  detalhe,
  tom = "neutro",
}: {
  label: string;
  valor: string;
  detalhe?: string | undefined;
  tom?: "neutro" | "ok" | "falha";
}) {
  const borda =
    tom === "ok"
      ? "border-primary/40 bg-accent/30"
      : tom === "falha"
        ? "border-destructive/40 bg-destructive/5"
        : "border-border bg-card";
  return (
    <div className={`rounded-2xl border p-5 ${borda} ${quebra}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-lg font-extrabold leading-snug ${quebra}`}>{valor}</p>
      {detalhe && <p className={`mt-1 text-[13px] text-muted-foreground ${quebra}`}>{detalhe}</p>}
    </div>
  );
}

function Th({ children, largo = false }: { children: React.ReactNode; largo?: boolean }) {
  return (
    <th className={`px-3 py-2 text-left text-[12px] font-bold ${largo ? "w-[45%]" : ""}`}>
      {children}
    </th>
  );
}

export function BankParserDiagnosticsPage({
  source = "BANK_STATEMENT",
  backTo,
  backLabel = "Voltar",
  contextInstitution = null,
}: {
  source?: DiagnosticSource;
  /** Instituição OFICIAL da conta/cartão de origem — nunca texto livre. */
  contextInstitution?: InstitutionCode | null;
  backTo?: { to: string; params?: Record<string, string> };
  backLabel?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [resultado, setResultado] = useState<BankStatementDryRunResult | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("RESUMO");
  const [copiado, setCopiado] = useState(false);
  const [routing, setRouting] = useState<ParserRoutingResult | null>(null);
  const auto = useRef(false);
  const familyId = useFamily().data?.id ?? undefined;

  async function rodar(arquivo: File | null) {
    if (!arquivo) return;
    setLendo(true);
    setErro("");
    setResultado(null);
    setRouting(null);
    try {
      const r = await runBankStatementDryRun({ file: arquivo, source });
      setResultado(r);
      if (source === "BANK_STATEMENT" || source === "CARD_STATEMENT") {
        const entrada = await buildParserInput(arquivo);
        setRouting(
          routeDocumentParser({
            registry: DOCUMENT_PARSER_REGISTRY,
            contextInstitution,
            documentType:
              source === "CARD_STATEMENT" ? "CREDIT_CARD_STATEMENT" : "BANK_STATEMENT",
            input: entrada,
            detectedDocumentType:
              r.documentType.type === "CREDIT_CARD_STATEMENT" ||
              r.documentType.type === "BANK_STATEMENT"
                ? r.documentType.type
                : null,
          }),
        );
      }
      if (r.error) setErro(r.error);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler este PDF.");
    } finally {
      setLendo(false);
    }
  }

  // Arquivo entregue por outra tela ("Ver diagnóstico"): roda automaticamente.
  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    const pendente = peekDiagnosticFile();
    if (pendente) {
      setFile(pendente.file);
      void rodar(pendente.file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parser: ParserDryRunResult | null = resultado?.parser ?? null;
  const ehFatura = resultado?.routing.parserFamily === "CARD_STATEMENT";
  const fatura = (ehFatura ? (parser?.output as SaidaFatura) : null) ?? null;
  const itensFatura = fatura?.items ?? [];
  const executou = parser?.parserExecutionInput?.["executed"] === true && !!parser?.output;
  const saida = (executou ? (parser?.output as SaidaExtrato) : null) ?? null;
  const transacoes = saida?.transactions ?? [];
  const checkpoints = saida?.checkpoints ?? [];
  const erros = parser?.errors ?? [];
  const etapas = parser?.pipelineStages ?? resultado?.package.pipelineStages ?? [];
  const validacao = saida?.validation?.status ?? (executou ? "—" : "NÃO EXECUTADO");

  const json = useMemo(
    () => (resultado ? JSON.stringify(resultado.package, null, 2) : ""),
    [resultado],
  );

  const linhasTexto = useMemo(
    () =>
      resultado ? linesToNdjson(resultado.dump, resultado.visualRows) : "",
    [resultado],
  );
  const rawTexto = useMemo(
    () => (resultado ? dumpToNdjson(resultado.dump, resultado.dump.items) : ""),
    [resultado],
  );

  async function copiarJson() {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("O navegador bloqueou a cópia — selecione o texto na aba JSON.");
    }
  }

  function exportar() {
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagnostico-${(resultado?.fileName ?? "pdf").replace(/\.pdf$/i, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="w-full max-w-none px-6 py-8 lg:px-8">
      {/* HEADER */}
      <header className="space-y-4">
        {backTo && (
          <Link
            to={backTo.to}
            {...(backTo.params ? { params: backTo.params } : {})}
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="inline-flex items-center gap-2 text-2xl font-extrabold">
              <Bug className="size-6 text-primary" /> Diagnóstico do parser bancário
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-[13px] text-muted-foreground">
              <span className={quebra}>
                <b className="text-foreground">Arquivo:</b> {resultado?.fileName ?? file?.name ?? "—"}
              </span>
              <span>
                <b className="text-foreground">Banco:</b> {parser?.bank ?? "—"}
              </span>
              <span>
                <b className="text-foreground">Período:</b> {saida?.periodStart ?? "—"} →{" "}
                {saida?.periodEnd ?? "—"}
              </span>
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Somente leitura: o parser roda em memória. Nada é gravado, nenhum saldo muda.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-semibold hover:bg-accent">
              Selecionar PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  void rodar(f);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void rodar(file)}
              disabled={!file || lendo}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {lendo ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Rodar novamente
            </button>
            <button
              type="button"
              onClick={() => void copiarJson()}
              disabled={!json}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
            >
              <Copy className="size-4" /> {copiado ? "Copiado" : "Copiar JSON"}
            </button>
            <button
              type="button"
              onClick={exportar}
              disabled={!json}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
            >
              <Download className="size-4" /> Exportar diagnóstico
            </button>
          </div>
        </div>
      </header>

      {erro && (
        <p className="mt-6 rounded-2xl bg-destructive/10 p-4 text-[14px] font-semibold text-destructive">
          {erro}
        </p>
      )}

      {!resultado && !lendo && (
        <p className="mt-8 text-[14px] text-muted-foreground">
          Selecione o PDF do extrato para executar o parser real em dry run.
        </p>
      )}

      {lendo && (
        <p className="mt-8 inline-flex items-center gap-2 text-[14px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Executando o pipeline em memória…
        </p>
      )}

      {routing && (
        <section className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-[15px] font-extrabold">
            ROTEAMENTO INSTITUCIONAL: {routing.status}
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["CONTEXT INSTITUTION", routing.contextInstitution ?? "—"],
              ["DETECTED INSTITUTION", routing.detectedInstitution ?? "—"],
              ["DOCUMENT TYPE", routing.documentType],
              ["PARSER FAMILY", routing.parserFamily ?? "—"],
              ["PARSER KEY", routing.parserKey ?? "—"],
              ["FORMAT VERSION", routing.formatVersion ? String(routing.formatVersion) : "—"],
              ["DETECTION SCORE", String(routing.detectionScore)],
              ["THRESHOLD", String(routing.threshold)],
              ["ROUTING RESULT", routing.status === "PASS" ? "PASS" : "BLOCKED"],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="font-semibold text-muted-foreground">{k}:</dt>
                <dd className="font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{routing.reason}</p>
        </section>
      )}

      {resultado && (
        <>
          {ehFatura && (
            <p className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] font-semibold text-amber-800 dark:text-amber-300">
              WRONG_DOCUMENT_TYPE_FOR_BANK_STATEMENT — este PDF é uma fatura de cartão, não um
              extrato de conta. O parser de extrato foi ignorado e o diagnóstico rodou com o
              parser real de fatura. Nenhuma transação bancária foi produzida.
            </p>
          )}

          {ehFatura && (
            <section className="mt-6 rounded-2xl border border-primary/40 bg-accent/30 p-5">
              <h2 className="text-[15px] font-extrabold">
                DIAGNÓSTICO: {fatura?.diagnosticStatus ?? "—"}
              </h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["DOCUMENT TYPE", resultado.documentType.type],
                  ["ISSUER", fatura?.invoice?.issuer ?? "—"],
                  ["PARSER", parser?.parser ?? "—"],
                  ["ITEMS", String(itensFatura.length)],
                  ["INVOICE TOTAL", moeda(fatura?.validation?.declaredInvoiceTotal ?? null)],
                  ["ITEMS TOTAL", moeda(fatura?.validation?.chargedItemsTotal ?? null)],
                  ["DIFFERENCE", moeda(fatura?.validation?.difference ?? 0)],
                  ["VALIDATION", fatura?.validation?.status ?? "—"],
                  ["BANK TRANSACTIONS", "0"],
                  ["BANK CHECKPOINTS", "0"],
                  [
                    "PERÍODO",
                    `${dataBr(fatura?.invoice?.periodStart ?? null)} → ${dataBr(
                      fatura?.invoice?.periodEnd ?? null,
                    )}`,
                  ],
                  ["CURRENT CLOSING DATE", dataBr(fatura?.invoice?.closingDate ?? null)],
                  ["NEXT CLOSING DATE", dataBr(fatura?.invoice?.nextClosingDate ?? null)],
                  ["VENCIMENTO", dataBr(fatura?.invoice?.dueDate ?? null)],
                  ["PREVIOUS INVOICE", moeda(fatura?.invoice?.previousInvoiceTotal ?? null)],
                  [
                    "PREVIOUS PAYMENT",
                    moeda(fatura?.invoice?.previousPayment?.valor ?? null),
                  ],
                  ["PERSISTENCE", "BLOCKED / DRY RUN"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="font-semibold text-muted-foreground">{k}:</dt>
                    <dd className="font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* RESUMO DO PIPELINE — 3 colunas no desktop */}
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Cartao label="PDF.JS" valor={`${resultado.dump.items.length} items`} detalhe={`${resultado.dump.numPages} página(s)`} />
            <Cartao label="Rows" valor={`${resultado.visualRows.length} rows`} />
            <Cartao
              label="Document type"
              valor={resultado.documentType.type}
              detalhe={resultado.documentType.matchedSignals.slice(0, 3).join(" · ") || undefined}
              tom={resultado.documentType.status === "PASS" ? "ok" : "falha"}
            />
            <Cartao
              label="Bank detection"
              valor={parser?.bank ?? "não detectado"}
              detalhe={(parser?.signals ?? []).slice(0, 3).join(" · ") || undefined}
              tom={parser?.bank && parser.bank !== "UNKNOWN" ? "ok" : "falha"}
            />
            <Cartao
              label="Parser"
              valor={(ehFatura ? parser?.parser : resultado.package.parser.name) ?? "não selecionado"}
              detalhe={ehFatura ? "parser real de fatura de cartão" : undefined}
              tom={ehFatura || resultado.package.parser.status === "FOUND" ? "ok" : "falha"}
            />
            {ehFatura ? (
              <>
                <Cartao
                  label="Invoice total"
                  valor={moeda(fatura?.invoice?.invoiceTotal ?? null)}
                  detalhe={`vencimento ${fatura?.invoice?.dueDate ?? "—"}`}
                />
                <Cartao
                  label="Card"
                  valor={fatura?.invoice?.cardLast4 ? `final ${fatura.invoice.cardLast4}` : "—"}
                  detalhe={fatura?.invoice?.holder ?? undefined}
                />
                <Cartao
                  label="Card statement items"
                  valor={`${itensFatura.length} lançamentos`}
                  detalhe={`bank transactions 0 · bank checkpoints 0`}
                  tom="ok"
                />
                <Cartao
                  label="Validation"
                  valor={fatura?.validation?.status ?? "—"}
                  detalhe={
                    fatura?.validation?.difference !== null &&
                    fatura?.validation?.difference !== undefined
                      ? `diferença ${moeda(fatura.validation.difference)}`
                      : undefined
                  }
                  tom={fatura?.validation?.status === "CARD_STATEMENT_VALID" ? "ok" : "falha"}
                />
              </>
            ) : (
              <>
                <Cartao
                  label="Output"
                  valor={executou ? `${transacoes.length} transações` : "Parser não executado"}
                  detalhe={executou ? `${checkpoints.length} checkpoints` : undefined}
                  tom={executou ? "ok" : "falha"}
                />
                <Cartao
                  label="Validation"
                  valor={validacao}
                  tom={validacao === "PASS" || validacao === "VALID" ? "ok" : "falha"}
                />
              </>
            )}
          </section>

          {/* TABS */}
          <nav className="mt-8 flex flex-wrap gap-2">
            {ABAS.filter(([id]) =>
              ehFatura ? ABAS_FATURA.includes(id) : id !== "FATURA",
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAba(id)}
                className={`rounded-full border px-4 py-2 text-[13px] font-semibold transition ${
                  aba === id
                    ? "border-primary bg-accent text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {label}
                {id === "ERROS" && erros.length ? ` (${erros.length})` : ""}
              </button>
            ))}
          </nav>

          <section className="mt-6">
            {aba === "RESUMO" && ehFatura && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Cartao label="Document type" valor="CREDIT_CARD_STATEMENT" tom="ok" />
                <Cartao label="Emissor" valor={fatura?.invoice?.issuer ?? "—"} />
                <Cartao label="Titular" valor={fatura?.invoice?.holder ?? "—"} />
                <Cartao
                  label="Total desta fatura"
                  valor={moeda(fatura?.invoice?.invoiceTotal ?? null)}
                />
                <Cartao label="Vencimento" valor={fatura?.invoice?.dueDate ?? "—"} />
                <Cartao label="Emissão" valor={fatura?.invoice?.issueDate ?? "—"} />
                <Cartao
                  label="Fatura anterior"
                  valor={moeda(fatura?.invoice?.previousInvoiceTotal ?? null)}
                  detalhe={
                    fatura?.invoice?.previousPayment
                      ? `pagamento ${fatura.invoice.previousPayment.data ?? "—"} · ${moeda(
                          fatura.invoice.previousPayment.valor,
                        )}`
                      : undefined
                  }
                />
                <Cartao
                  label="Limite total de crédito"
                  valor={moeda(fatura?.invoice?.creditLimit ?? null)}
                />
                <Cartao label="Bank transactions" valor="0" tom="ok" detalhe="fatura não gera movimentação bancária" />
                <Cartao label="Bank checkpoints" valor="0" tom="ok" detalhe="fatura não possui saldo diário" />
                <Cartao
                  label="Card statement items"
                  valor={String(itensFatura.length)}
                  detalhe={Object.entries(fatura?.itemCounts ?? {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                />
                <Cartao
                  label="Validation"
                  valor={fatura?.validation?.status ?? "—"}
                  detalhe={`itens cobrados ${moeda(fatura?.validation?.chargedItemsTotal ?? null)}`}
                  tom={fatura?.validation?.status === "CARD_STATEMENT_VALID" ? "ok" : "falha"}
                />
              </div>
            )}

            {aba === "PERSISTENCIA" && ehFatura && (
              <CardPersistenceDryRunPanel
                {...(familyId ? { familyId } : {})}
                invoice={{
                  issuer: fatura?.invoice?.issuer ?? null,
                  holder: fatura?.invoice?.holder ?? null,
                  cardLast4: fatura?.invoice?.cardLast4 ?? null,
                  cardLast4s: fatura?.invoice?.cardLast4s ?? [],
                  periodStart: fatura?.invoice?.periodStart ?? null,
                  periodEnd: fatura?.invoice?.periodEnd ?? null,
                  closingDate: fatura?.invoice?.closingDate ?? null,
                  nextClosingDate: fatura?.invoice?.nextClosingDate ?? null,
                  dueDate: fatura?.invoice?.dueDate ?? null,
                  issueDate: fatura?.invoice?.issueDate ?? null,
                  invoiceTotal: fatura?.invoice?.invoiceTotal ?? null,
                  previousInvoiceTotal: fatura?.invoice?.previousInvoiceTotal ?? null,
                  previousPayment: fatura?.invoice?.previousPayment ?? null,
                }}
                items={itensFatura.map((i) => ({
                  category: i.category,
                  date: i.date,
                  description: i.description,
                  amount: i.amount,
                  installmentCurrent: i.installmentCurrent,
                  installmentTotal: i.installmentTotal,
                  cardLast4: i.cardLast4,
                }))}
              />
            )}

            {aba === "FATURA" && (
              <div className="w-full overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-accent/40">
                    <tr>
                      <Th>Data</Th>
                      <Th largo>Estabelecimento</Th>
                      <Th>Categoria</Th>
                      <Th>Parcela</Th>
                      <Th>Cartão</Th>
                      <Th>Valor</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensFatura.map((i, idx) => (
                      <tr key={`${i.description}-${idx}`} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{i.date ?? "—"}</td>
                        <td className={`px-3 py-2 ${quebra}`}>{i.description}</td>
                        <td className="px-3 py-2 font-bold">{i.category}</td>
                        <td className="px-3 py-2">
                          {i.installmentTotal ? `${i.installmentCurrent}/${i.installmentTotal}` : "—"}
                        </td>
                        <td className="px-3 py-2">{i.cardLast4 ?? "—"}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{moeda(i.amount)}</td>
                      </tr>
                    ))}
                    {!itensFatura.length && (
                      <tr>
                        <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                          Nenhum lançamento devolvido pelo parser de fatura.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {aba === "RESUMO" && !ehFatura && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Cartao
                  label="Período"
                  valor={saida?.periodStart ?? "—"}
                  detalhe={`até ${saida?.periodEnd ?? "—"}`}
                />
                <Cartao
                  label="Saldo anterior"
                  valor={moeda(saida?.openingBalance?.amount)}
                  detalhe={saida?.openingBalance?.date ?? "—"}
                />
                <Cartao
                  label="Saldo final"
                  valor={moeda(saida?.closingBalance?.amount)}
                  detalhe={saida?.closingBalance?.date ?? "—"}
                />
                <Cartao label="Movimentações" valor={executou ? String(transacoes.length) : "—"} />
                <Cartao
                  label="Checkpoints"
                  valor={executou ? String(checkpoints.length) : "—"}
                  tom={executou && checkpoints.length === 0 ? "falha" : "neutro"}
                />
                <Cartao
                  label="Entrada recebida pelo parser"
                  valor={parser?.parserExecutionInput?.["executed"] === true ? "executed = true" : "executed = false"}
                  detalhe={`${resultado.package.bankDetectionInput.rawTextLength} caracteres de texto`}
                  tom={parser?.parserExecutionInput?.["executed"] === true ? "ok" : "falha"}
                />
              </div>
            )}

            {aba === "PIPELINE" && (
              <ol className="space-y-3">
                {etapas.map((s) => {
                  const interna = (parser?.parserInternalStages ?? []).filter(
                    (i) => i.stage === s.stage,
                  );
                  const naoAplicavel =
                    s.status === "NOT_APPLICABLE" || s.status === "SKIPPED";
                  return (
                    <li
                      key={s.stage}
                      className={`rounded-2xl border p-4 ${
                        s.status === "PASS"
                          ? "border-primary/40 bg-accent/30"
                          : naoAplicavel
                            ? "border-border bg-muted/40"
                            : "border-destructive/40 bg-destructive/5"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-[15px] font-extrabold">{s.stage}</span>
                        <span
                          className={`text-[13px] font-bold ${
                            s.status === "PASS"
                              ? "text-primary"
                              : naoAplicavel
                                ? "text-muted-foreground"
                                : "text-destructive"
                          }`}
                        >
                          {s.status === "PASS"
                            ? "✓ PASS"
                            : naoAplicavel
                              ? "— NOT_APPLICABLE"
                              : "✕ FAIL"}
                        </span>
                        {s.count !== undefined && (
                          <span className="text-[13px] text-muted-foreground">
                            {s.count} item(ns)
                          </span>
                        )}
                        {s.detail && (
                          <span className="text-[13px] text-muted-foreground">{s.detail}</span>
                        )}
                      </div>
                      {s.status === "FAIL" && (
                        <p className={`mt-2 text-[13px] text-destructive ${quebra}`}>
                          {erros.find((e) => e.stage === s.stage)?.message ??
                            resultado.package.detection.reason}
                        </p>
                      )}
                      {interna.map((i) => (
                        <p key={i.stage + i.reason} className={`mt-1 text-[13px] ${quebra}`}>
                          <span
                            className={i.status === "PASS" ? "text-primary" : "text-destructive"}
                          >
                            {i.status === "PASS" ? "✓" : "✕"}
                          </span>{" "}
                          <span className="text-muted-foreground">{i.reason}</span>
                        </p>
                      ))}
                    </li>
                  );
                })}
                {!!parser?.parserInternalStages?.length && (
                  <li className="rounded-2xl border border-border p-4">
                    <p className="text-[15px] font-extrabold">Etapas internas do parser</p>
                    <ul className="mt-2 space-y-1">
                      {parser.parserInternalStages.map((i) => (
                        <li key={i.stage} className={`text-[13px] ${quebra}`}>
                          <span
                            className={i.status === "PASS" ? "text-primary" : "text-destructive"}
                          >
                            {i.status === "PASS" ? "✓" : "✕"} {i.stage}
                          </span>{" "}
                          <span className="text-muted-foreground">{i.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </ol>
            )}

            {aba === "TRANSACOES" && (
              <div className="w-full overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-accent/40">
                    <tr>
                      <Th>Data</Th>
                      <Th largo>Descrição</Th>
                      <Th>Documento</Th>
                      <Th>Tipo</Th>
                      <Th>Entrada/Saída</Th>
                      <Th>Valor</Th>
                      <Th>Página</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {transacoes.map((t) => (
                      <tr key={t.sourceId} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{t.postingDate ?? "—"}</td>
                        <td className={`px-3 py-2 ${quebra}`}>
                          <span>{t.description || "—"}</span>
                          {(t.bankOperation || t.counterparty) && (
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {[t.bankOperation, t.counterparty].filter(Boolean).join(" → ")}
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-2 font-mono text-xs ${quebra}`}>
                          {t.documentNumber ?? "—"}
                          {t.lot && (
                            <span className="block text-[11px] text-muted-foreground">
                              lote {t.lot}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{t.kind}</td>
                        <td className="px-3 py-2">{t.direction === "IN" ? "ENTRADA" : "SAÍDA"}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{moeda(t.signedAmount)}</td>
                        <td className="px-3 py-2">{t.sourcePage ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">linha {t.sourceRow}</td>
                      </tr>
                    ))}
                    {!transacoes.length && (
                      <tr>
                        <td className="px-3 py-4 text-muted-foreground" colSpan={8}>
                          {executou
                            ? "Nenhuma transação devolvida pelo parser."
                            : "Parser não executado."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {aba === "CHECKPOINTS" && (
              <div className="w-full overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-accent/40">
                    <tr>
                      <Th>Data</Th>
                      <Th>Tipo</Th>
                      <Th>Saldo</Th>
                      <Th>Página</Th>
                      <Th largo>Origem</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkpoints.map((c, i) => (
                      <tr key={`${c.date}-${i}`} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{c.date}</td>
                        <td className="px-3 py-2 font-bold">{c.type}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{moeda(c.amount)}</td>
                        <td className="px-3 py-2">{c.sourcePage ?? "—"}</td>
                        <td className={`px-3 py-2 ${quebra}`}>{c.label ?? "Saldo do dia"}</td>
                        <td className="px-3 py-2 text-primary">PARSED</td>
                      </tr>
                    ))}
                    {!checkpoints.length && (
                      <tr>
                        <td className="px-3 py-4 text-destructive" colSpan={6}>
                          {executou
                            ? "Nenhum checkpoint (Saldo do dia) foi reconhecido neste PDF."
                            : "Parser não executado."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {!!resultado.package.checkpointTrace.length && (
                  <pre className="max-h-[50vh] overflow-auto border-t border-border p-4 font-mono text-[13px]">
                    {JSON.stringify(resultado.package.checkpointTrace, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {aba === "LINHAS" && (
              <div className="rounded-2xl border border-border">
                <ul className="max-h-[70vh] overflow-auto p-4 font-mono text-[13px]">
                  {resultado.visualRows.map((l, i) => (
                    <li key={`${l.page}-${l.y}-${i}`} className={`border-b border-border/50 py-1 ${quebra}`}>
                      p{l.page} y{l.y} · {visualLineText(l)}
                    </li>
                  ))}
                </ul>
                <pre className="hidden">{linhasTexto}</pre>
              </div>
            )}

            {aba === "RAW" && (
              <textarea
                readOnly
                value={rawTexto}
                spellCheck={false}
                className="min-h-[65vh] w-full resize-y rounded-2xl border border-border bg-background p-4 font-mono text-[13px]"
              />
            )}

            {aba === "ERROS" && (
              <div className="space-y-3">
                {!erros.length && (
                  <p className="text-[14px] text-muted-foreground">
                    Nenhum erro registrado nesta execução.
                  </p>
                )}
                {erros.map((e, i) => (
                  <div key={i} className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
                    <p className={`text-[14px] font-extrabold text-destructive ${quebra}`}>
                      {e.stage} · {e.name}
                    </p>
                    <p className={`mt-1 text-[13px] ${quebra}`}>{e.message}</p>
                    {e.cause && (
                      <p className={`mt-1 text-[13px] text-muted-foreground ${quebra}`}>
                        cause: {e.cause}
                      </p>
                    )}
                    {e.stack && (
                      <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-background p-3 font-mono text-[13px]">
                        {e.stack}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}

            {aba === "JSON" && (
              <textarea
                readOnly
                value={json}
                spellCheck={false}
                className="min-h-[65vh] w-full resize-y overflow-auto rounded-2xl border border-border bg-background p-4 font-mono text-[13px]"
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
