import { useMemo, useState } from "react";
import { Bug, Check, Copy, Loader2 } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import {
  dumpToNdjson,
  linesToNdjson,
  rawPdfDump,
  rawVisualLines,
  sortPositional,
  type RawPdfDump,
} from "@/lib/pdf-raw-dump";
import { extractPdfText } from "@/lib/pdf-extract";

type Aba = "RAW" | "POSICIONAL" | "LINHAS" | "TEXTO";

const ABAS: { id: Aba; label: string }[] = [
  { id: "RAW", label: "RAW (ordem do pdfjs)" },
  { id: "POSICIONAL", label: "RAW (ordem posicional)" },
  { id: "LINHAS", label: "Linhas reconstruídas" },
  { id: "TEXTO", label: "Texto extraído original" },
];

/**
 * Ferramenta de desenvolvimento: mostra a extração bruta do pdfjs-dist.
 * Não interpreta compras, não cria importações e não toca no financeiro.
 */
export function PdfDiagnosticDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dump, setDump] = useState<RawPdfDump | null>(null);
  const [texto, setTexto] = useState<string[]>([]);
  const [aba, setAba] = useState<Aba>("RAW");
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  async function analisar() {
    if (!file) return;
    setErro("");
    setLendo(true);
    try {
      const lido = await rawPdfDump(file, file.name);
      setDump(lido);
      setTexto(await extractPdfText(file));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler este PDF.");
    } finally {
      setLendo(false);
    }
  }

  const conteudo = useMemo(() => {
    if (!dump) return "";
    if (aba === "RAW") return dumpToNdjson(dump, dump.items);
    if (aba === "POSICIONAL") return dumpToNdjson(dump, sortPositional(dump.items));
    if (aba === "LINHAS") return linesToNdjson(dump, rawVisualLines(dump.items));
    return texto.join("\n");
  }, [dump, aba, texto]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(conteudo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("O navegador bloqueou a cópia — selecione o texto e copie manualmente.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-card sm:rounded-3xl">
        <div className="border-b border-border p-6 pb-4">
          <h2 className="inline-flex items-center gap-2 text-xl font-extrabold">
            <Bug className="size-5 text-primary" /> Modo diagnóstico PDF
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ferramenta técnica. Mostra exatamente os TextItem devolvidos pelo pdfjs, com
            coordenadas reais. Nada é interpretado nem salvo.
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
                }}
              />
            </Field>
            <PrimaryButton type="button" onClick={analisar} disabled={!file || lendo}>
              {lendo ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Lendo…
                </span>
              ) : (
                "Ver extração bruta"
              )}
            </PrimaryButton>
          </div>

          {erro && <p className="mt-3 text-sm font-semibold text-destructive">{erro}</p>}

          {dump && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">
                {dump.fileName} · {dump.numPages} página(s) · {dump.items.length} TextItem(s)
                {dump.pages.map((p) => ` · p${p.page}: ${p.width}×${p.height} (${p.items})`)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ABAS.map((a) => (
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
            </div>
          )}
        </div>

        {dump && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-6 pt-4">
            <textarea
              readOnly
              value={conteudo}
              spellCheck={false}
              className="h-[45vh] w-full resize-none rounded-2xl border border-border bg-background p-3 font-mono text-[11px] leading-relaxed"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {conteudo.split("\n").length} linha(s) · NDJSON
              </span>
              <button
                type="button"
                onClick={copiar}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
              >
                {copiado ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
                {copiado ? "Copiado" : "COPIAR EXTRAÇÃO"}
              </button>
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
