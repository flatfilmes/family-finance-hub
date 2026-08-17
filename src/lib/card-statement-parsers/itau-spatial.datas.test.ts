/**
 * REGRESSÃO — semântica das datas da fatura Itaú (ITAU_PDF espacial).
 *
 * "Previsão prox. Fechamento" NUNCA pode alimentar closingDate.
 */
import { describe, expect, it } from "vitest";
import type { PdfPageLayout, PdfTextItem } from "@/lib/pdf-extract";
import { parseItauSpatial } from "./itau-spatial";

const it_ = (text: string, x: number, y: number, width = 60): PdfTextItem => ({ text, x, y, width });

const capa: PdfPageLayout = {
  page: 1,
  width: 595.276,
  height: 841.89,
  items: [
    it_("Emissão: 10/08/2026", 151.2, 700.0, 120),
    it_("Vencimento: 17/08/2026", 151.2, 685.0, 130),
    it_("Previsão prox. Fechamento: 10/09/2026", 151.2, 670.0, 200),
  ],
};

describe("ITAU_PDF — datas de fechamento", () => {
  const parsed = parseItauSpatial([capa]);

  it("emissão, fechamento atual, vencimento e próximo fechamento", () => {
    expect(parsed.metadata?.data_emissao).toBe("2026-08-10");
    expect(parsed.data_fechamento).toBe("2026-08-10");
    expect(parsed.data_vencimento).toBe("2026-08-17");
    expect(parsed.metadata?.next_closing_date).toBe("2026-09-10");
  });

  it("closingDate nunca é igual à previsão do próximo fechamento", () => {
    expect(parsed.data_fechamento).not.toBe(parsed.metadata?.next_closing_date);
  });
});
