/**
 * MODO DIAGNÓSTICO BRUTO DE PDF (ferramenta de desenvolvimento).
 *
 * Objetivo único: mostrar exatamente o que `page.getTextContent()` do pdfjs-dist
 * devolve, com coordenadas reais. Aqui NÃO há interpretação financeira:
 * nada de compras, parcelas, categorias, colunas ou regex de negócio.
 */

export type RawTextItem = {
  type: "ITEM";
  page: number;
  /** Ordem original dentro da página, exatamente como veio de textContent.items. */
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transform: number[];
  hasEOL?: boolean;
  fontName?: string;
};

export type RawPageMarker = {
  type: "PAGE";
  page: number;
  width: number;
  height: number;
  items: number;
};

export type RawPdfDump = {
  fileName: string;
  numPages: number;
  pages: RawPageMarker[];
  /** Ordem original do pdfjs (não ordenada). */
  items: RawTextItem[];
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Lê o PDF e devolve todos os TextItem com posição, sem concatenar nada. */
export async function rawPdfDump(file: Blob, fileName = "arquivo.pdf"): Promise<RawPdfDump> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pages: RawPageMarker[] = [];
  const items: RawTextItem[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const brutos = content.items as {
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
      hasEOL?: boolean;
      fontName?: string;
    }[];

    pages.push({
      type: "PAGE",
      page: p,
      width: round(viewport.width),
      height: round(viewport.height),
      items: brutos.length,
    });

    brutos.forEach((item, index) => {
      const transform = item.transform ?? [];
      items.push({
        type: "ITEM",
        page: p,
        index,
        // texto exato, sem trim e sem normalização
        text: item.str ?? "",
        x: round(transform[4] ?? 0),
        y: round(transform[5] ?? 0),
        width: round(item.width ?? 0),
        height: round(item.height ?? 0),
        transform: transform.map(round),
        ...(item.hasEOL === undefined ? {} : { hasEOL: item.hasEOL }),
        ...(item.fontName === undefined ? {} : { fontName: item.fontName }),

      });
    });
  }

  await doc.cleanup();
  return { fileName, numPages: doc.numPages, pages, items };
}

/** Cópia ordenada por página → y (topo para baixo) → x. A original é preservada. */
export function sortPositional(items: RawTextItem[]): RawTextItem[] {
  return [...items].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  );
}

/** NDJSON: marcador de página seguido dos itens daquela página. */
export function dumpToNdjson(dump: RawPdfDump, items: RawTextItem[]): string {
  const linhas: string[] = [];
  for (const pagina of dump.pages) {
    linhas.push(JSON.stringify(pagina));
    for (const it of items.filter((i) => i.page === pagina.page)) linhas.push(JSON.stringify(it));
  }
  return linhas.join("\n");
}
