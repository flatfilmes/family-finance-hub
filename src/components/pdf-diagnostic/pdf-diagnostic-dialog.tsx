import { useEffect, useMemo, useState } from "react";
import { Bug, Check, Copy, Download, Loader2, X } from "lucide-react";
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
  | "RESUMO"
  | "PIPELINE"
  | "TRANSACOES"
  | "CHECKPOINTS"
  | "LINHAS"
  | "RAW"
  | "POSICIONAL"
  | "TEXTO"
  | "COMPARAR"
  | "PRODUTOS"
  | "MAPA"
  | "ERROS"
  | "JSON";

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
    direction: "IN" | "OUT";
    signedAmount: number;
    sourcePage: number | null;
    sourceRow: number;
    kind: string;
  }>;
  checkpoints?: Array<{ date: string; amount: number; type: string; label?: string | null }>;
  validation?: { status?: string; problems?: string[]; math?: Record<string, unknown> };
};

const moeda = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
  const [aba, setAba] = useState<Aba>("RESUMO");
  const [pagina, setPagina] = useState<number | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");
  const [stackAberta, setStackAberta] = useState<number | null>(null);

  useEffect(() => setFile(fileInicial), [fileInicial]);

  const abas: { id: Aba; label: string }[] = [
    { id: "RESUMO", label: "Resumo" },
    { id: "PIPELINE", label: "Pipeline" },
    ...(source === "BANK_STATEMENT"
      ? ([
          { id: "TRANSACOES", label: "Transações" },
          { id: "CHECKPOINTS", label: "Checkpoints" },
        ] as const)
      : []),
    { id: "LINHAS", label: "Linhas visuais" },
    { id: "RAW", label: "Raw PDF" },
    { id: "POSICIONAL", label: "Raw (posicional)" },
    { id: "TEXTO", label: "Texto do pipeline" },
    ...(parserDryRun ? ([{ id: "COMPARAR", label: "Comparar" }] as const) : []),
    ...(source === "PURCHASE_RECEIPT"
      ? ([{ id: "PRODUTOS", label: "Produtos" }] as const)
      : []),
    { id: "MAPA", label: "Mapa da página" },
    { id: "ERROS", label: "Erros" },
    { id: "JSON", label: "JSON" },
  ];

  /**
   * Executa o pipeline real em modo dry run (memória). Cada etapa tem o seu
   * próprio try/catch: uma falha de leitura de texto nunca impede a execução
   * do parser, e uma falha do parser nunca vira `null` silencioso.
   */
  async function analisar() {
    if (!file) return;
    setErro("");
    setLendo(true);
    setParser(null);
    try {
      const lido = await rawPdfDump(file, file.name);
      setDump(lido);

      try {
        setTexto(await extractPdfText(file));
      } catch {
        setTexto([]);
      }

      if (!parserDryRun) {
        setErro("Nenhum parser está registrado para esta origem de documento.");
        return;
      }

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
          errors: [
            {
              name: error.name,
              message: error.message,
              stage: "PARSER_EXECUTION",
              ...(error.stack ? { stack: error.stack } : {}),
              ...(error.cause !== undefined ? { cause: String(error.cause) } : {}),
            },
          ],
          detection: {
            status: "FAILED",
            bank: null,
            matchedSignals: [],
            missingSignals: [],
            reason: error.message,
          },
          parserInfo: { status: "NOT_FOUND", requestedBank: null, name: null },
          parserInternalStages: [],
          parserExecutionInput: { executed: true, failed: true },
        });
        setErro(`Leitura bruta OK, mas o parser falhou: ${error.message}`);
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
  const saida = (parser?.output ?? null) as SaidaExtrato | null;
  const transacoes = saida?.transactions ?? [];
  const checkpoints = saida?.checkpoints ?? [];
  const erros = parser?.errors ?? [];

  const conteudo = useMemo(() => {
    if (!dump) return "";
    if (aba === "RAW") return dumpToNdjson(dump, itens);
    if (aba === "POSICIONAL") return dumpToNdjson(dump, sortPositional(itens));
    if (aba === "LINHAS") return linesToNdjson(dump, linhas);
    if (aba === "TEXTO") return texto.join("\n");
    return "";
  }, [dump, aba, itens, linhas, texto]);

  const pacote = () =>
    dump
      ? JSON.stringify(
          buildDiagnosticPackage({ source, dump, visualRows: linhas, parser, page: pagina }),
          null,
          2,
        )
      : "";

  async function copiar(rotulo: string, valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(rotulo);
      setTimeout(() => setCopiado(""), 2000);
    } catch {
      setErro("O navegador bloqueou a cópia — selecione o texto e copie manualmente.");
    }
  }

  function exportar() {
    const conteudoJson = pacote();
    if (!conteudoJson) return;
    const url = URL.createObjectURL(new Blob([conteudoJson], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagnostico-${(dump?.fileName ?? "pdf").replace(/\.pdf$/i, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusGeral = !parser
    ? "NÃO EXECUTADO"
    : parser.error
      ? "FALHA"
      : (saida?.validation?.status ?? parser.status ?? "OK");

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border-border bg-card text-[14px] shadow-card sm:h-[94vh] sm:w-[96vw] sm:rounded-3xl sm:border lg:h-[92vh] lg:w-[min(96vw,1500px)] lg:max-h-[92vh] lg:max-w-[1500px] xl:min-w-[1100px]">
        {/* HEADER FIXO */}
        <header className="shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="inline-flex items-center gap-2 text-xl font-extrabold">
                <Bug className="size-5 text-primary" /> Diagnóstico do parser
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted-foreground">
                <span>
                  <b className="text-foreground">Arquivo:</b> {dump?.fileName ?? file?.name ?? "—"}
                </span>
                <span>
                  <b className="text-foreground">Origem:</b> {DIAGNOSTIC_SOURCE_LABELS[source]}
                </span>
                <span>
                  <b className="text-foreground">Banco:</b> {parser?.bank ?? "—"}
                </span>
                <span>
                  <b className="text-foreground">Período:</b>{" "}
                  {saida?.periodStart ?? "—"} → {saida?.periodEnd ?? "—"}
                </span>
                <span>
                  <b className="text-foreground">Parser:</b> {parser?.parser ?? "—"}
                </span>
                <span>
                  <b className="text-foreground">Status:</b> {statusGeral}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-[13px] font-semibold hover:bg-accent"
            >
              <X className="size-4" /> Fechar
            </button>
          </div>

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

          {dump && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {abas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAba(a.id)}
                  className={`rounded-full border px-4 py-1.5 text-[13px] font-semibold transition ${
                    aba === a.id
                      ? "border-primary bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {a.label}
                  {a.id === "ERROS" && erros.length ? ` (${erros.length})` : ""}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* CONTEÚDO SCROLLÁVEL */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto px-6 py-5">
          {!dump && (
            <p className="text-[14px] text-muted-foreground">
              Selecione um PDF e rode o diagnóstico. Nada é salvo: o parser roda em memória.
            </p>
          )}

          {erro && (
            <p className="mb-4 text-[14px] font-semibold text-destructive">{erro}</p>
          )}

          {dump && aba === "RESUMO" && (
            <div className="space-y-5">
              <PipelineStatus dump={dump} rows={linhas.length} parser={parser} />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Cartao label="Período" valor={`${saida?.periodStart ?? "—"} → ${saida?.periodEnd ?? "—"}`} />
                <Cartao
                  label="Saldo anterior"
                  valor={`${saida?.openingBalance?.date ?? "—"} · ${moeda(saida?.openingBalance?.amount)}`}
                />
                <Cartao
                  label="Saldo final"
                  valor={`${saida?.closingBalance?.date ?? "—"} · ${moeda(saida?.closingBalance?.amount)}`}
                />
                <Cartao
                  label="Contagens"
                  valor={`${transacoes.length} transações · ${checkpoints.length} checkpoints`}
                />
              </div>
              <div className="rounded-2xl border border-border p-4">
                <p className="text-[16px] font-extrabold">Páginas</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {dump.numPages} página(s) · {dump.items.length} TextItem(s)
                  {dump.pages.map((p) => ` · p${p.page}: ${p.width}×${p.height} (${p.items})`).join("")}
                </p>
              </div>
              {parser?.parserExecutionInput && (
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-[16px] font-extrabold">Entrada recebida pelo parser</p>
                  <pre className="mt-2 max-h-60 overflow-auto font-mono text-[13px]">
                    {JSON.stringify(parser.parserExecutionInput, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {dump && aba === "PIPELINE" && (
            <div className="space-y-3">
              {(parser?.pipelineStages ?? []).map((s) => (
                <div
                  key={s.stage}
                  className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
                    s.status === "PASS"
                      ? "border-primary/40 bg-accent/40"
                      : "border-destructive/40 bg-destructive/5"
                  }`}
                >
                  <span className="text-[15px] font-extrabold">{s.stage}</span>
                  <span
                    className={`text-[13px] font-bold ${
                      s.status === "PASS" ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {s.status}
                  </span>
                  {s.count !== undefined && (
                    <span className="text-[13px] text-muted-foreground">{s.count} item(ns)</span>
                  )}
                </div>
              ))}
              {!!parser?.parserInternalStages?.length && (
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-[16px] font-extrabold">Etapas internas do parser</p>
                  <ul className="mt-2 space-y-1">
                    {parser.parserInternalStages.map((s) => (
                      <li key={s.stage} className="text-[13px]">
                        <span className={s.status === "PASS" ? "text-primary" : "text-destructive"}>
                          {s.status === "PASS" ? "✓" : "✕"} {s.stage}
                        </span>{" "}
                        <span className="text-muted-foreground">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!parser && (
                <p className="text-[14px] text-destructive">
                  O parser ainda não foi executado nesta tela.
                </p>
              )}
            </div>
          )}

          {dump && aba === "TRANSACOES" && (
            <div className="overflow-auto rounded-2xl border border-border">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead className="bg-accent/40 text-left">
                  <tr>
                    {["Data", "Descrição", "Entrada/Saída", "Valor", "Página", "Linha", "Status"].map(
                      (h) => (
                        <th key={h} className="px-3 py-2 font-bold">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {transacoes.map((t) => (
                    <tr key={t.sourceId} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono">{t.postingDate ?? "—"}</td>
                      <td className="px-3 py-2">{t.description}</td>
                      <td className="px-3 py-2">{t.direction === "IN" ? "ENTRADA" : "SAÍDA"}</td>
                      <td className="px-3 py-2 font-mono">{moeda(t.signedAmount)}</td>
                      <td className="px-3 py-2">{t.sourcePage ?? "—"}</td>
                      <td className="px-3 py-2">{t.sourceRow}</td>
                      <td className="px-3 py-2">{t.kind}</td>
                    </tr>
                  ))}
                  {!transacoes.length && (
                    <tr>
                      <td className="px-3 py-4 text-muted-foreground" colSpan={7}>
                        Nenhuma transação devolvida pelo parser.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {dump && aba === "CHECKPOINTS" && (
            <div className="overflow-auto rounded-2xl border border-border">
              <table className="w-full min-w-[700px] text-[13px]">
                <thead className="bg-accent/40 text-left">
                  <tr>
                    {["Data", "Tipo", "Saldo", "Origem", "Status"].map((h) => (
                      <th key={h} className="px-3 py-2 font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.map((c, i) => (
                    <tr key={`${c.date}-${i}`} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono">{c.date}</td>
                      <td className="px-3 py-2 font-bold">{c.type}</td>
                      <td className="px-3 py-2 font-mono">{moeda(c.amount)}</td>
                      <td className="px-3 py-2">{c.label ?? "PDF"}</td>
                      <td className="px-3 py-2 text-primary">PARSED</td>
                    </tr>
                  ))}
                  {!checkpoints.length && (
                    <tr>
                      <td className="px-3 py-4 text-muted-foreground" colSpan={5}>
                        Nenhum checkpoint de saldo foi lido.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {dump && aba === "ERROS" && (
            <div className="space-y-3">
              {!erros.length && (
                <p className="text-[14px] text-muted-foreground">Nenhum erro registrado.</p>
              )}
              {erros.map((e, i) => (
                <div key={i} className="rounded-2xl border border-destructive/50 bg-destructive/5 p-4">
                  <p className="text-[16px] font-extrabold text-destructive">
                    {e.stage} FAILED · {e.name}
                  </p>
                  <p className="mt-1 text-[14px] font-semibold">{e.message}</p>
                  {e.cause && (
                    <p className="mt-1 text-[13px] text-muted-foreground">cause: {e.cause}</p>
                  )}
                  {e.stack && (
                    <>
                      <button
                        type="button"
                        onClick={() => setStackAberta(stackAberta === i ? null : i)}
                        className="mt-2 rounded-full border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-accent"
                      >
                        {stackAberta === i ? "Ocultar stack" : "Ver stack completa"}
                      </button>
                      {stackAberta === i && (
                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre rounded-xl bg-background p-3 font-mono text-[13px]">
                          {e.stack}
                        </pre>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {dump && aba === "JSON" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <BotaoCopiar rotulo="Copiar JSON" ativo={copiado === "TUDO"} onClick={() => copiar("TUDO", pacote())} />
                <BotaoCopiar rotulo="Exportar JSON" ativo={false} onClick={exportar} />
              </div>
              <pre className="min-h-[60vh] w-full overflow-auto rounded-2xl border border-border bg-background p-4 font-mono text-[13px]">
                {pacote()}
              </pre>
            </div>
          )}

          {dump && aba === "COMPARAR" && <CompareTab linhas={linhas} parser={parser} />}
          {dump && aba === "PRODUTOS" && <ProductsTab linhas={linhas} parser={parser} />}
          {dump && aba === "MAPA" && <PageMapTab dump={dump} />}
          {dump && (aba === "RAW" || aba === "POSICIONAL" || aba === "LINHAS" || aba === "TEXTO") && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
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
                <span className="ml-auto text-muted-foreground">
                  {conteudo ? `${conteudo.split("\n").length} linha(s)` : "—"}
                </span>
                {conteudo && (
                  <BotaoCopiar
                    rotulo="Copiar visão atual"
                    ativo={copiado === "VISAO"}
                    onClick={() => copiar("VISAO", conteudo)}
                  />
                )}
              </div>
              <DumpArea conteudo={conteudo} />
            </div>
          )}
        </div>

        {/* FOOTER FIXO */}
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-5 py-2 text-[14px] font-semibold hover:bg-accent"
          >
            Fechar
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <BotaoCopiar
              rotulo="Copiar JSON"
              ativo={copiado === "TUDO"}
              onClick={() => copiar("TUDO", pacote())}
            />
            <button
              type="button"
              onClick={exportar}
              disabled={!dump}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[14px] font-semibold hover:bg-accent disabled:opacity-50"
            >
              <Download className="size-4" /> Exportar diagnóstico
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Cartao({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-[14px] font-semibold">{valor}</p>
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
      valor: counts ? `${counts.transactions} transações · ${counts.checkpoints} checkpoints` : "—",
      ok: !!counts && counts.transactions > 0,
    },
    {
      label: "VALIDATION",
      valor: validacao === "PARSED_STATEMENT_VALID" ? "PASS" : (validacao ?? "—"),
      ok: validacao === "PARSED_STATEMENT_VALID",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {etapas.map((e) => (
        <div
          key={e.label}
          className={`rounded-2xl border px-4 py-3 ${
            e.ok ? "border-primary/40 bg-accent/40" : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <p className="text-[13px] font-bold tracking-wide text-muted-foreground">{e.label}</p>
          <p className="mt-1 text-[14px] font-semibold">
            {e.ok ? "✓" : "✕"} {e.valor}
          </p>
        </div>
      ))}
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
      className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[14px] font-semibold hover:bg-accent"
    >
      {ativo ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
      {ativo ? "Copiado" : rotulo}
    </button>
  );
}
