import { useEffect, useMemo, useState } from "react";
import { Bug, Check, Copy, Loader2 } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { CompareTab, DumpArea, PageMapTab, ProductsTab } from "@/components/pdf-diagnostic/tabs";
import {
  buildDiagnosticPackage,
  dumpToNdjson,
  linesToNdjson,
  rawPdfDump,
  rawVisualLines,
  sortPositional,
  DIAGNOSTIC_SOURCE_LABELS,
  type DiagnosticSource,
  type ParserDryRun,
  type ParserDryRunResult,
  type RawPdfDump,
} from "@/lib/pdf-diagnostic";
import { defaultDryRunForSource } from "@/lib/pdf-diagnostic/default-dry-runs";
import { extractPdfText } from "@/lib/pdf-extract";

type Aba =
  | "RAW"
  | "POSICIONAL"
  | "LINHAS"
  | "TEXTO"
  | "PARSER"
  | "COMPARAR"
  | "PRODUTOS"
  | "MAPA";

/**
 * Modo diagnóstico PDF — ferramenta técnica compartilhada por todos os módulos
 * que leem PDF. Roda apenas em memória: nunca cria compra, importação,
 * transação, arquivo ou qualquer registro.
 */
export function PdfDiagnosticDialog({
  source,
  parserDryRun: parserDryRunProp,
  file: fileInicial = null,
  onClose,
}: {
  source: DiagnosticSource;
  parserDryRun?: ParserDryRun;
  file?: File | null;
  onClose: () => void;
}) {
  // A tela nunca fica sem parser: quando o chamador não passa um dry run,
  // usamos o parser real do módulo de origem (mesma função pura da importação).
  const parserDryRun = parserDryRunProp ?? defaultDryRunForSource(source);
  const [file, setFile] = useState<File | null>(fileInicial);
  const [dump, setDump] = useState<RawPdfDump | null>(null);
  const [texto, setTexto] = useState<string[]>([]);
  const [parser, setParser] = useState<ParserDryRunResult | null>(null);
  const [aba, setAba] = useState<Aba>("RAW");
  const [pagina, setPagina] = useState<number | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");

  useEffect(() => setFile(fileInicial), [fileInicial]);

  const abas: { id: Aba; label: string }[] = [
    { id: "RAW", label: "RAW (ordem do pdfjs)" },
    { id: "POSICIONAL", label: "RAW (posicional)" },
    { id: "LINHAS", label: "Linhas visuais" },
    { id: "TEXTO", label: "Texto do pipeline atual" },
    ...(parserDryRun ? ([{ id: "PARSER", label: "Saída do parser" }] as const) : []),
    ...(parserDryRun ? ([{ id: "COMPARAR", label: "Comparar" }] as const) : []),
    ...(source === "PURCHASE_RECEIPT"
      ? ([{ id: "PRODUTOS", label: "Diagnóstico de produtos" }] as const)
      : []),
    { id: "MAPA", label: "Mapa da página" },
  ];

  async function analisar() {
    if (!file) return;
    setErro("");
    setLendo(true);
    try {
      const lido = await rawPdfDump(file, file.name);
      setDump(lido);
      setTexto(await extractPdfText(file));
      if (parserDryRun) {
        try {
          setParser(await parserDryRun(file));
        } catch (e) {
          const error = e instanceof Error ? e : new Error("Falha desconhecida no parser.");
          setParser({
            parser: "PARSER_EXECUTION_FAILED",
            bank: null,
            status: "PARSER_EXECUTION_FAILED",
            error: error.message,
            stage: "PARSER_EXECUTION",
            signals: [],
            counts: { rawItems: lido.items.length, rows: 0, transactions: 0, checkpoints: 0 },
            output: { status: "PARSER_EXECUTION_FAILED", error: error.message },
            debug: { accepted: [], rejected: [], metadata: [] },
            pipelineStages: [
              { stage: "PDFJS", status: "PASS", count: lido.items.length },
              { stage: "VISUAL_ROWS", status: "FAIL", count: 0 },
              { stage: "BANK_DETECTION", status: "FAIL" },
              { stage: "PARSER_SELECTION", status: "FAIL" },
              { stage: "PARSER_EXECUTION", status: "FAIL" },
              { stage: "VALIDATION", status: "FAIL" },
            ],
            errors: [{
              name: error.name,
              message: error.message,
              stage: "PARSER_EXECUTION",
              ...(import.meta.env.DEV && error.stack ? { stack: error.stack } : {}),
            }],
            detection: {
              status: "FAILED",
              bank: null,
              matchedSignals: [],
              missingSignals: [],
              reason: error.message,
            },
            parserInfo: { status: "NOT_FOUND", requestedBank: null, name: null },
          });
          setErro(
            `Leitura bruta OK, mas o parser falhou: ${e instanceof Error ? e.message : "erro"}`,
          );
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler este PDF.");
    } finally {
      setLendo(false);
    }
  }

  const itens = useMemo(
    () => (dump ? dump.items.filter((i) => !pagina || i.page === pagina) : []),
    [dump, pagina],
  );
  const linhas = useMemo(() => rawVisualLines(itens), [itens]);

  const conteudo = useMemo(() => {
    if (!dump) return "";
    if (aba === "RAW") return dumpToNdjson(dump, itens);
    if (aba === "POSICIONAL") return dumpToNdjson(dump, sortPositional(itens));
    if (aba === "LINHAS") return linesToNdjson(dump, linhas);
    if (aba === "TEXTO") return texto.join("\n");
    if (aba === "PARSER") return JSON.stringify(parser?.output ?? null, null, 2);
    return "";
  }, [dump, aba, itens, linhas, texto, parser]);

  async function copiar(rotulo: string, valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(rotulo);
      setTimeout(() => setCopiado(""), 2000);
    } catch {
      setErro("O navegador bloqueou a cópia — selecione o texto e copie manualmente.");
    }
  }

  const pacote = () =>
    dump
      ? JSON.stringify(
          buildDiagnosticPackage({ source, dump, visualRows: linhas, parser, page: pagina }),
          null,
          2,
        )
      : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-card sm:rounded-3xl">
        <div className="border-b border-border p-6 pb-4">
          <h2 className="inline-flex items-center gap-2 text-xl font-extrabold">
            <Bug className="size-5 text-primary" /> Modo diagnóstico PDF
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {DIAGNOSTIC_SOURCE_LABELS[source]} · ferramenta técnica. Mostra os TextItem devolvidos
            pelo pdfjs e a saída do parser em modo dry-run. Nada é salvo.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Arquivo PDF">
              <input
                type="file"
                accept="application/pdf,.pdf"
                className={inputClass}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setDump(null);
                  setParser(null);
                }}
              />
            </Field>
            <PrimaryButton type="button" onClick={analisar} disabled={!file || lendo}>
              {lendo ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Lendo…
                </span>
              ) : (
                "Rodar diagnóstico"
              )}
            </PrimaryButton>
          </div>
          {file && !dump && (
            <p className="mt-2 text-xs text-muted-foreground">Arquivo pronto: {file.name}</p>
          )}

          {dump && <PipelineStatus dump={dump} rows={linhas.length} parser={parser} />}

          {erro && <p className="mt-3 text-sm font-semibold text-destructive">{erro}</p>}

          {dump && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">
                {dump.fileName} · {dump.numPages} página(s) · {dump.items.length} TextItem(s)
                {dump.pages
                  .map((p) => ` · p${p.page}: ${p.width}×${p.height} (${p.items})`)
                  .join("")}
                {parser ? ` · parser: ${parser.parser}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {abas.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAba(a.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      aba === a.id
                        ? "border-primary bg-accent text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Página:</span>
                <button
                  type="button"
                  onClick={() => setPagina(null)}
                  className={`rounded-full border px-3 py-1 font-semibold ${
                    pagina === null ? "border-primary bg-accent" : "border-border"
                  }`}
                >
                  Todas
                </button>
                {dump.pages.map((p) => (
                  <button
                    key={p.page}
                    type="button"
                    onClick={() => setPagina(p.page)}
                    className={`rounded-full border px-3 py-1 font-semibold ${
                      pagina === p.page ? "border-primary bg-accent" : "border-border"
                    }`}
                  >
                    {p.page}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {dump && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6 pt-4">
            {aba === "COMPARAR" ? (
              <CompareTab linhas={linhas} parser={parser} />
            ) : aba === "PRODUTOS" ? (
              <ProductsTab linhas={linhas} parser={parser} />
            ) : aba === "MAPA" ? (
              <PageMapTab dump={dump} />
            ) : (
              <DumpArea conteudo={conteudo} />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs text-muted-foreground">
                {pagina ? `Somente página ${pagina}` : "Todas as páginas"} ·{" "}
                {conteudo ? `${conteudo.split("\n").length} linha(s)` : "visão tabular"}
              </span>
              <BotaoCopiar
                rotulo="COPIAR RAW"
                ativo={copiado === "RAW"}
                onClick={() => copiar("RAW", dumpToNdjson(dump, itens))}
              />
              <BotaoCopiar
                rotulo="COPIAR LINHAS"
                ativo={copiado === "LINHAS"}
                onClick={() => copiar("LINHAS", linesToNdjson(dump, linhas))}
              />
              <BotaoCopiar
                rotulo="COPIAR PARSER"
                ativo={copiado === "PARSER"}
                onClick={() =>
                  copiar("PARSER", JSON.stringify(parser?.output ?? null, null, 2))
                }
              />
              <BotaoCopiar
                rotulo="COPIAR DIAGNÓSTICO COMPLETO"
                ativo={copiado === "TUDO"}
                onClick={() => copiar("TUDO", pacote())}
              />
              {aba !== "COMPARAR" && aba !== "PRODUTOS" && aba !== "MAPA" && conteudo && (
                <BotaoCopiar
                  rotulo="COPIAR VISÃO ATUAL"
                  ativo={copiado === "VISAO"}
                  onClick={() => copiar("VISAO", conteudo)}
                />
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Faixa de status do pipeline: mostra exatamente onde a leitura parou. */
function PipelineStatus({
  dump,
  rows,
  parser,
}: {
  dump: RawPdfDump;
  rows: number;
  parser: ParserDryRunResult | null;
}) {
  const output = (parser?.output ?? null) as
    | { validation?: { status?: string }; counts?: { checkpoints?: number } }
    | null;
  const counts = parser?.counts ?? null;
  const okParser = !!parser && parser.status !== "PARSER_NOT_SELECTED" && !parser.error;
  const validacao = output?.validation?.status ?? null;

  const etapas = [
    { label: "PDF.JS", valor: `${dump.items.length} items`, ok: dump.items.length > 0 },
    { label: "ROWS", valor: `${rows} rows`, ok: rows > 0 },
    {
      label: "BANK DETECTION",
      valor: parser?.bank ?? (parser ? "—" : "não executado"),
      ok: !!parser?.bank && parser.bank !== "UNKNOWN",
    },
    {
      label: "PARSER",
      valor: parser ? `${parser.parser}${parser.version ? ` ${parser.version}` : ""}` : "null",
      ok: okParser,
    },
    {
      label: "OUTPUT",
      valor: counts
        ? `${counts.transactions} transações · ${counts.checkpoints} checkpoints`
        : "—",
      ok: !!counts && counts.transactions > 0,
    },
    {
      label: "VALIDATION",
      valor: validacao === "PARSED_STATEMENT_VALID" ? "PASS" : (validacao ?? "—"),
      ok: validacao === "PARSED_STATEMENT_VALID",
    },
  ];

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {etapas.map((e) => (
        <div
          key={e.label}
          className={`rounded-2xl border px-3 py-2 ${
            e.ok ? "border-primary/40 bg-accent/40" : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <p className="text-[10px] font-bold tracking-wide text-muted-foreground">{e.label}</p>
          <p className="text-xs font-semibold">
            {e.ok ? "✓" : "✕"} {e.valor}
          </p>
        </div>
      ))}
      {parser?.error && (
        <p className="sm:col-span-3 text-xs font-semibold text-destructive">
          {parser.status ?? "PARSER_EXECUTION_FAILED"}
          {parser.stage ? ` · etapa ${parser.stage}` : ""} — {parser.error}
        </p>
      )}
      {parser?.status === "PARSER_NOT_SELECTED" && (
        <p className="sm:col-span-3 text-xs font-semibold text-destructive">
          PARSER_NOT_SELECTED — sinais encontrados: {parser.signals?.join(" | ") || "nenhum"}
        </p>
      )}
    </div>
  );
}

function BotaoCopiar({
  rotulo,
  ativo,
  onClick,
}: {
  rotulo: string;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
    >
      {ativo ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      {ativo ? "Copiado" : rotulo}
    </button>
  );
}
