/**
 * Parser ESPACIAL da tabela "DADOS DO PRODUTO / SERVIÇO" do DANFE / NF-e.
 *
 * Não usa regex sobre o texto linear da página: trabalha com a geometria real
 * dos TextItem (x, y) devolvidos pelo pdf.js. Nada é inventado — quando a
 * tabela existe mas não é possível interpretá-la, devolve zero produtos com o
 * motivo declarado (nunca um produto genérico com o total da nota).
 *
 * Exclusivo de nota fiscal (PURCHASE_RECEIPT). Não afeta faturas de cartão.
 */
import type { PdfTextItem } from "@/lib/pdf-extract";

export type DanfeProduct = {
  code: string | null;
  description: string;
  ean: string | null;
  ncm: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Y da linha numérica base (útil para diagnóstico). */
  baseY: number;
  page: number;
};

export type DanfeTableStatus =
  | "PRODUCT_TABLE_NOT_FOUND"
  | "PRODUCT_TABLE_FOUND_BUT_EXTRACTION_FAILED"
  | "PRODUCTS_TOTAL_OK"
  | "PRODUCTS_TOTAL_MISMATCH"
  | "PRODUCTS_TOTAL_UNVERIFIED";

export type DanfeRejectedRow = {
  raw: string;
  page: number;
  y: number;
  reason: string;
};

export type DanfeTableResult = {
  tableFound: boolean;
  products: DanfeProduct[];
  rejected: DanfeRejectedRow[];
  sum: number;
  status: DanfeTableStatus;
};

const plano = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const numeroBr = (raw: string): number => {
  const limpo = raw.replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) ? n : 0;
};

const ehNumerico = (texto: string) => /^-?[\d.]*\d(?:,\d+)?$/.test(texto.trim());

/** Faixas de coluna do DANFE em fração da largura da página (595pt de referência). */
const COL = {
  code: [0, 0.09],
  description: [0.085, 0.3],
  ean: [0.28, 0.37],
  ncm: [0.37, 0.43],
  cst: [0.43, 0.462],
  cfop: [0.462, 0.485],
  unit: [0.485, 0.52],
  quantity: [0.52, 0.582],
  unitPrice: [0.582, 0.665],
  discount: [0.665, 0.7],
  total: [0.7, 0.79],
} as const;

const dentro = (x: number, w: number, faixa: readonly [number, number] | number[]) =>
  x >= (faixa[0] as number) * w && x < (faixa[1] as number) * w;

const INICIO_TABELA = ["DADOS DO PRODUTO", "DADOS DOS PRODUTOS"];
const FIM_TABELA = [
  "CALCULO DO ISSQN",
  "DADOS ADICIONAIS",
  "INFORMACOES COMPLEMENTARES",
  "RESERVADO AO FISCO",
];

function limparDescricao(partes: string[]): string {
  return partes
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+-\s+/g, " - ")
    .replace(/^[\s\-–:.]+/, "")
    .replace(/[\s\-–:]+$/, "")
    .trim();
}

/**
 * Extrai a tabela de produtos de UMA página usando somente posição.
 * `invoiceTotal` é usado apenas para conferência (nunca para corrigir itens).
 */
export function parseDanfeProductTable(
  items: PdfTextItem[],
  pageWidth: number,
  page = 1,
  invoiceTotal: number | null = null,
): DanfeTableResult {
  const w = pageWidth || 595;
  const limpos = items.filter((i) => i.text.trim());

  // 1) Início da tabela.
  const marcador = limpos
    .filter((i) => INICIO_TABELA.some((t) => plano(i.text).includes(t)))
    .sort((a, b) => b.y - a.y)[0];
  if (!marcador) {
    return { tableFound: false, products: [], rejected: [], sum: 0, status: "PRODUCT_TABLE_NOT_FOUND" };
  }
  const topo = marcador.y;

  // 2) Fim da tabela: primeiro bloco conhecido abaixo do cabeçalho.
  const fins = limpos
    .filter((i) => i.y < topo && FIM_TABELA.some((t) => plano(i.text).includes(t)))
    .map((i) => i.y);
  const base = fins.length ? Math.max(...fins) : -Infinity;

  const regiao = limpos.filter((i) => i.y < topo && i.y > base);

  // 3) Agrupa em linhas visuais finas (tolerância pequena: 1,5pt).
  const linhas = new Map<number, PdfTextItem[]>();
  for (const item of regiao) {
    const chave = Math.round(item.y / 1.5) * 1.5;
    const lista = linhas.get(chave) ?? [];
    lista.push(item);
    linhas.set(chave, lista);
  }

  const rejected: DanfeRejectedRow[] = [];

  // 4) Linhas base: quantidade + unitário + total na mesma altura.
  type Base = {
    y: number;
    quantity: number;
    unitPrice: number;
    total: number;
    unit: string;
    code: string | null;
    ean: string | null;
    ncm: string | null;
  };
  const bases: Base[] = [];

  for (const [y, partes] of [...linhas.entries()].sort((a, b) => b[0] - a[0])) {
    const numericos = partes.filter((p) => ehNumerico(p.text));
    const qtd = numericos.find((p) => dentro(p.x, w, COL.quantity));
    const unit = numericos.find((p) => dentro(p.x, w, COL.unitPrice));
    const tot = numericos.find((p) => dentro(p.x, w, COL.total));
    const texto = [...partes].sort((a, b) => a.x - b.x).map((p) => p.text).join(" ");

    if (!qtd || !unit || !tot) {
      if (numericos.length >= 3) {
        rejected.push({ raw: texto, page, y, reason: "colunas_numericas_fora_da_geometria" });
      }
      continue;
    }

    const quantity = numeroBr(qtd.text);
    const unitPrice = numeroBr(unit.text);
    const total = numeroBr(tot.text);
    if (quantity <= 0 || total <= 0) {
      rejected.push({ raw: texto, page, y, reason: "quantidade_ou_total_invalido" });
      continue;
    }

    const un = partes.find((p) => dentro(p.x, w, COL.unit) && !ehNumerico(p.text));
    const cod = partes.find((p) => dentro(p.x, w, COL.code));
    const ean = partes.find((p) => dentro(p.x, w, COL.ean) && /^\d{8,14}$/.test(p.text.trim()));
    const ncm = partes.find((p) => dentro(p.x, w, COL.ncm) && /^\d{6,8}$/.test(p.text.trim()));

    bases.push({
      y,
      quantity,
      unitPrice,
      total,
      unit: (un?.text ?? "UN").trim().toUpperCase(),
      code: cod?.text.trim() ?? null,
      ean: ean?.text.trim() ?? null,
      ncm: ncm?.text.trim() ?? null,
    });
  }

  if (!bases.length) {
    return {
      tableFound: true,
      products: [],
      rejected,
      sum: 0,
      status: "PRODUCT_TABLE_FOUND_BUT_EXTRACTION_FAILED",
    };
  }

  // 5) Descrição multilinha por proximidade vertical (até a próxima linha base).
  const descricoes = regiao
    .filter((i) => dentro(i.x, w, COL.description) && !ehNumerico(i.text))
    .sort((a, b) => b.y - a.y);

  const products: DanfeProduct[] = bases.map((b, idx) => {
    const proxima = bases[idx + 1];
    const limiteInferior = proxima ? (proxima.y + b.y) / 2 : base;
    const limiteSuperior = idx === 0 ? topo : (bases[idx - 1]!.y + b.y) / 2;
    const partes = descricoes
      .filter((d) => d.y > limiteInferior && d.y <= limiteSuperior)
      .map((d) => d.text.trim())
      .filter(Boolean);

    return {
      code: b.code,
      description: limparDescricao(partes),
      ean: b.ean,
      ncm: b.ncm,
      unit: b.unit,
      quantity: b.quantity,
      unitPrice: b.unitPrice,
      total: b.total,
      baseY: b.y,
      page,
    };
  });

  const validos = products.filter((p) => p.description.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 3);
  for (const p of products) {
    if (!validos.includes(p)) {
      rejected.push({ raw: `${p.code ?? ""} ${p.total}`, page, y: p.baseY, reason: "descricao_nao_localizada" });
    }
  }

  if (!validos.length) {
    return {
      tableFound: true,
      products: [],
      rejected,
      sum: 0,
      status: "PRODUCT_TABLE_FOUND_BUT_EXTRACTION_FAILED",
    };
  }

  const sum = Number(validos.reduce((acc, p) => acc + p.total, 0).toFixed(2));
  const status: DanfeTableStatus =
    invoiceTotal && invoiceTotal > 0
      ? Math.abs(sum - invoiceTotal) <= 0.02
        ? "PRODUCTS_TOTAL_OK"
        : "PRODUCTS_TOTAL_MISMATCH"
      : "PRODUCTS_TOTAL_UNVERIFIED";

  return { tableFound: true, products: validos, rejected, sum, status };
}

/** Roda a extração espacial em todas as páginas e junta os produtos. */
export function parseDanfeProductTables(
  pages: { page: number; width: number; items: PdfTextItem[] }[],
  invoiceTotal: number | null = null,
): DanfeTableResult {
  const parciais = pages.map((p) => parseDanfeProductTable(p.items, p.width, p.page, null));
  const comTabela = parciais.filter((r) => r.tableFound);
  if (!comTabela.length) {
    return { tableFound: false, products: [], rejected: [], sum: 0, status: "PRODUCT_TABLE_NOT_FOUND" };
  }
  const products = comTabela.flatMap((r) => r.products);
  const rejected = comTabela.flatMap((r) => r.rejected);
  if (!products.length) {
    return {
      tableFound: true,
      products: [],
      rejected,
      sum: 0,
      status: "PRODUCT_TABLE_FOUND_BUT_EXTRACTION_FAILED",
    };
  }
  const sum = Number(products.reduce((acc, p) => acc + p.total, 0).toFixed(2));
  const status: DanfeTableStatus =
    invoiceTotal && invoiceTotal > 0
      ? Math.abs(sum - invoiceTotal) <= 0.02
        ? "PRODUCTS_TOTAL_OK"
        : "PRODUCTS_TOTAL_MISMATCH"
      : "PRODUCTS_TOTAL_UNVERIFIED";
  return { tableFound: true, products, rejected, sum, status };
}
