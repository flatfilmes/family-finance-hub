/** Visões do Modo diagnóstico PDF. Cada aba só formata texto — não interpreta. */
import { useMemo, useState } from "react";
import type { ParserDryRunResult } from "@/lib/pdf-diagnostic";
import type { RawPdfDump, RawTextItem } from "@/lib/pdf-diagnostic";
import { visualLineText, type RawVisualLine } from "@/lib/pdf-diagnostic";

export function DumpArea({ conteudo }: { conteudo: string }) {
  return (
    <textarea
      readOnly
      value={conteudo}
      spellCheck={false}
      className="h-[42vh] w-full resize-none rounded-2xl border border-border bg-background p-3 font-mono text-[11px] leading-relaxed"
    />
  );
}

/** Aba "Comparar": o que existe no RAW x o que o parser devolveu. */
export function CompareTab({
  linhas,
  parser,
}: {
  linhas: RawVisualLine[];
  parser: ParserDryRunResult | null;
}) {
  const aceitos = parser?.debug?.accepted ?? [];
  const rejeitados = parser?.debug?.rejected ?? [];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-border p-3">
        <p className="text-xs font-bold uppercase text-muted-foreground">
          RAW encontrado ({linhas.length} linha(s) visual(is))
        </p>
        <ul className="mt-2 max-h-[36vh] overflow-y-auto font-mono text-[11px]">
          {linhas.map((l, i) => (
            <li key={`${l.page}-${l.y}-${i}`} className="border-b border-border/60 py-1">
              p{l.page} y{l.y} · {visualLineText(l)}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-border p-3">
        <p className="text-xs font-bold uppercase text-muted-foreground">
          Parser interpretou ({aceitos.length} aceito(s) · {rejeitados.length} rejeitado(s))
        </p>
        <ul className="mt-2 max-h-[36vh] overflow-y-auto font-mono text-[11px]">
          {aceitos.length === 0 && (
            <li className="py-1 text-destructive">Nenhum registro devolvido pelo parser.</li>
          )}
          {aceitos.map((a, i) => (
            <li key={i} className="border-b border-border/60 py-1">
              {a.raw} · {a.valor ?? "—"} {a.detalhe ? `· ${a.detalhe}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Aba exclusiva de nota fiscal: candidatos a produto x saída do parser. */
export function ProductsTab({
  linhas,
  parser,
}: {
  linhas: RawVisualLine[];
  parser: ParserDryRunResult | null;
}) {
  const moeda = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/;
  const candidatos = useMemo(
    () =>
      linhas
        .map((l) => visualLineText(l))
        .filter((t) => moeda.test(t) && t.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 3),
    [linhas],
  );
  const aceitos = parser?.debug?.accepted ?? [];
  const rejeitados = parser?.debug?.rejected ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {candidatos.length} possível(is) linha(s) de produto no RAW · {aceitos.length} produto(s)
        devolvido(s) pelo parser · {rejeitados.length} rejeitado(s).
      </p>
      <div className="max-h-[40vh] overflow-y-auto rounded-2xl border border-border">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="bg-muted/60">
            <tr>
              <th className="p-2">RAW candidate</th>
              <th className="p-2">valor</th>
              <th className="p-2">parserStatus</th>
              <th className="p-2">reason</th>
            </tr>
          </thead>
          <tbody>
            {aceitos.map((a, i) => (
              <tr key={`a-${i}`} className="border-t border-border/60">
                <td className="p-2">{a.raw}</td>
                <td className="p-2">{a.valor ?? "—"}</td>
                <td className="p-2 text-primary">accepted</td>
                <td className="p-2">{a.detalhe ?? ""}</td>
              </tr>
            ))}
            {rejeitados.map((r, i) => (
              <tr key={`r-${i}`} className="border-t border-border/60">
                <td className="p-2">{r.raw}</td>
                <td className="p-2">{r.valor ?? "—"}</td>
                <td className="p-2 text-destructive">REJECTED</td>
                <td className="p-2">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Ferramenta DEV: caixas dos TextItem posicionadas sobre a página. */
export function PageMapTab({ dump }: { dump: RawPdfDump }) {
  const [pagina, setPagina] = useState(dump.pages[0]?.page ?? 1);
  const [sel, setSel] = useState<RawTextItem | null>(null);
  const info = dump.pages.find((p) => p.page === pagina);
  const itens = dump.items.filter((i) => i.page === pagina);
  if (!info) return null;
  const escala = 620 / info.width;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {dump.pages.map((p) => (
          <button
            key={p.page}
            type="button"
            onClick={() => setPagina(p.page)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              p.page === pagina ? "border-primary bg-accent" : "border-border text-muted-foreground"
            }`}
          >
            Página {p.page}
          </button>
        ))}
      </div>
      <div className="max-h-[40vh] overflow-auto rounded-2xl border border-border bg-background p-2">
        <div
          className="relative bg-muted/30"
          style={{ width: info.width * escala, height: info.height * escala }}
        >
          {itens.map((it) => (
            <button
              key={`${it.page}-${it.index}`}
              type="button"
              onClick={() => setSel(it)}
              title={it.text}
              className="absolute border border-primary/50 hover:bg-primary/20"
              style={{
                left: it.x * escala,
                top: (info.height - it.y - it.height) * escala,
                width: Math.max(2, it.width * escala),
                height: Math.max(4, it.height * escala),
              }}
            />
          ))}
        </div>
      </div>
      {sel && (
        <pre className="rounded-2xl border border-border bg-background p-3 font-mono text-[11px]">
          {JSON.stringify(
            {
              index: sel.index,
              text: sel.text,
              x: sel.x,
              y: sel.y,
              width: sel.width,
              height: sel.height,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}
