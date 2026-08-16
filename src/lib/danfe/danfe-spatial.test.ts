/**
 * Regressão permanente com a geometria RAW real da DANFE NS2.COM (4 produtos,
 * R$ 618,37). Os itens abaixo reproduzem as coordenadas observadas no dump.
 */
import { describe, expect, it } from "vitest";
import { parseDanfeProductTable } from "@/lib/danfe/danfe-spatial";
import type { PdfTextItem } from "@/lib/pdf-extract";

const t = (text: string, x: number, y: number, width = 20): PdfTextItem => ({ text, x, y, width });

const PRODUTOS = [
  {
    code: "FBA-7150-026-43",
    desc: "Kit Meia Adidas Cano Medio Com 3 Pares",
    cont: "- Preto+Branco",
    qtd: "1,0000",
    unit: "47,3500",
    total: "47,35",
    baseY: 350.9,
  },
  {
    code: "FBA-7150-027-44",
    desc: "Kit Meia Adidas Cano Baixo Logo Linear c 3 Pares",
    cont: "- Branco",
    qtd: "1,0000",
    unit: "41,0400",
    total: "41,04",
    baseY: 335.9,
  },
  {
    code: "FBA-7150-028-45",
    desc: "Tenis Adidas Duramo RC 2 Masculino -",
    cont: "Bege+Laranja",
    qtd: "1,0000",
    unit: "229,9900",
    total: "229,99",
    baseY: 320.9,
  },
  {
    code: "FBA-7150-029-46",
    desc: "Tenis Asics Versablast 4 Masculino -",
    cont: "Azul+Laranja",
    qtd: "1,0000",
    unit: "299,9900",
    total: "299,99",
    baseY: 305.9,
  },
];

const items: PdfTextItem[] = [
  t("DADOS DO PRODUTO / SERVIÇO", 19, 380, 200),
  t("CÓD.PROD.", 19, 370, 40),
  t("DESCRIÇÃO DOS PRODUTOS / SERVIÇOS", 61, 370, 110),
  t("NCM/SH", 229.66, 370),
  t("CST", 263, 370),
  t("CFOP", 279.33, 370),
  t("UNID", 298.83, 370),
  t("QUANT.", 324.65, 370),
  t("VALOR UNITÁRIO", 353.98, 370),
  t("VALOR TOTAL", 426.65, 370),
  ...PRODUTOS.flatMap((p) => [
    t(p.code, 19, p.baseY + 3.1, 60),
    t(p.desc, 61, p.baseY + 3.4, 110),
    t(p.cont, 61, p.baseY - 3.4, 60),
    t("7896541230001", 179.82, p.baseY),
    t("61159500", 229.66, p.baseY),
    t("000", 263, p.baseY),
    t("5102", 279.33, p.baseY),
    t("PAR", 298.83, p.baseY),
    t(p.qtd, 324.65, p.baseY),
    t(p.unit, 357.32, p.baseY),
    t("0,00", 401.32, p.baseY),
    t(p.total, 429.99, p.baseY),
    t("0,00", 458, p.baseY),
    t("0,00", 489, p.baseY),
  ]),
  t("CÁLCULO DO ISSQN", 19, 290, 100),
  t("VALOR TOTAL DA NOTA", 426, 400, 90),
  t("618,37", 429, 392),
];

describe("parseDanfeProductTable (geometria real NS2.COM)", () => {
  const r = parseDanfeProductTable(items, 595, 1, 618.37);

  it("extrai exatamente 4 produtos", () => {
    expect(r.tableFound).toBe(true);
    expect(r.products).toHaveLength(4);
    expect(r.rejected).toHaveLength(0);
  });

  it("junta a descrição multilinha", () => {
    expect(r.products[0]!.description).toBe(
      "Kit Meia Adidas Cano Medio Com 3 Pares - Preto+Branco",
    );
    expect(r.products[2]!.description).toBe("Tenis Adidas Duramo RC 2 Masculino - Bege+Laranja");
  });

  it("lê quantidade, unidade e valores de cada produto", () => {
    expect(r.products.map((p) => p.total)).toEqual([47.35, 41.04, 229.99, 299.99]);
    expect(r.products.map((p) => p.unitPrice)).toEqual([47.35, 41.04, 229.99, 299.99]);
    expect(r.products.every((p) => p.quantity === 1 && p.unit === "PAR")).toBe(true);
    expect(r.products[0]!.code).toBe("FBA-7150-026-43");
  });

  it("valida a soma contra o total da nota", () => {
    expect(r.sum).toBe(618.37);
    expect(r.status).toBe("PRODUCTS_TOTAL_OK");
  });

  it("nunca transforma o total da nota em produto", () => {
    expect(r.products.some((p) => p.total === 618.37)).toBe(false);
  });
});
