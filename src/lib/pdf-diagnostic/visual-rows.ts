/**
 * Linhas visuais: agrupamento SOMENTE por proximidade de Y.
 * Nenhuma leitura de negócio acontece aqui.
 */
import type { RawPdfDump, RawTextItem } from "@/lib/pdf-diagnostic/raw-dump";

export type RawVisualLine = {
  page: number;
  y: number;
  items: { text: string; x: number; width: number }[];
};

/** Agrupa somente por proximidade de Y, mantendo a ordem horizontal real. */
export function rawVisualLines(items: RawTextItem[], tolerancia = 3): RawVisualLine[] {
  const mapa = new Map<string, RawVisualLine>();
  for (const it of items) {
    const y = Math.round(it.y / tolerancia) * tolerancia;
    const chave = `${it.page}:${y}`;
    const linha = mapa.get(chave) ?? ({ page: it.page, y, items: [] } as RawVisualLine);
    linha.items.push({ text: it.text, x: it.x, width: it.width });
    mapa.set(chave, linha);
  }
  return [...mapa.values()]
    .map((l) => ({ ...l, items: l.items.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.page - b.page || b.y - a.y);
}

/** Texto de uma linha visual, com espaço simples entre os pedaços. */
export function visualLineText(linha: RawVisualLine): string {
  return linha.items
    .map((i) => i.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** NDJSON das linhas visuais (um objeto por linha). */
export function linesToNdjson(dump: RawPdfDump, linhas: RawVisualLine[]): string {
  const saida: string[] = [];
  for (const pagina of dump.pages) {
    saida.push(JSON.stringify(pagina));
    for (const l of linhas.filter((x) => x.page === pagina.page)) saida.push(JSON.stringify(l));
  }
  return saida.join("\n");
}
