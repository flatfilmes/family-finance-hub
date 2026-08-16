/**
 * REGRESSÃO ITAU — IOF internacional real (fatura de R$ 6.577,67).
 *
 * "Repasse de IOF em R$" dentro dos lançamentos internacionais é cobrança
 * financeira real e precisa entrar em "Taxas e serviços". Os subtotais
 * (146,71 e 16,22) continuam sendo apenas conferência.
 */
import { describe, expect, it } from "vitest";
import { parseItau } from "./itau";
import { ITAU_003_LINHAS } from "./itau.regression.semantica";
import { invoiceCheck } from "@/lib/card-statements";
import type { PdfLine } from "@/lib/pdf-extract";

const linhas = (textos: string[]): PdfLine[] =>
  textos.map((text, y) => ({ y, text, cells: [{ x: 0, text }] }));

describe("IOF internacional da fatura Itaú", () => {
  const parsed = parseItau(linhas(ITAU_003_LINHAS));
  const iofs = parsed.entries.filter((e) => /iof/i.test(e.descricao_original));

  it("extrai os dois repasses de IOF como taxa", () => {
    expect(iofs.map((e) => e.valor)).toEqual([4.94, 0.54]);
    expect(iofs.every((e) => e.tipo_sugerido === "TAXA")).toBe(true);
    expect(iofs.reduce((a, e) => a + e.valor, 0)).toBeCloseTo(5.48, 2);
  });

  it("não cria lançamento com os subtotais de conferência", () => {
    const valores = parsed.entries.map((e) => e.valor);
    expect(valores).not.toContain(146.71);
    expect(valores).not.toContain(16.22);
  });

  it("quebra de linha entre o rótulo e o valor também vira IOF", () => {
    const p = parseItau(
      linhas([
        "Lançamentos internacionais",
        "01/08 GOOGLE*WORKSPACE FLATF 141,77",
        "Total transações inter. em R$",
        "141,77",
        "Repasse de IOF em R$",
        "4,94",
        "Total lançamentos inter. em R$",
        "146,71",
      ]),
    );
    const iof = p.entries.filter((e) => /iof/i.test(e.descricao_original));
    expect(iof).toHaveLength(1);
    expect(iof[0]?.valor).toBeCloseTo(4.94, 2);
  });

  it("IOF de simulação/CET nunca vira lançamento", () => {
    const p = parseItau(
      linhas([
        "Simulação de parcelamento da fatura",
        "IOF e CET incluídos no valor total financiado 7.100,00",
      ]),
    );
    expect(p.entries).toHaveLength(0);
  });

  it("fecha a fatura com IOF em taxas e serviços", () => {
    const itens = [
      { descricao_original: "Compras e saques", valor: 6526.24, tipo_sugerido: "COMPRA" as const },
      { descricao_original: "Estorno", valor: -0.05, tipo_sugerido: "ESTORNO" as const },
      { descricao_original: "ANUIDADE DIFERENCIADA", valor: 46, tipo_sugerido: "TAXA" as const },
      { descricao_original: "Repasse de IOF · Google Workspace", valor: 4.94, tipo_sugerido: "TAXA" as const },
      { descricao_original: "Repasse de IOF · PayPal", valor: 0.54, tipo_sugerido: "TAXA" as const },
    ];
    const check = invoiceCheck(itens, 6577.67);
    expect(check.compras).toBeCloseTo(6526.24, 2);
    expect(check.creditos).toBeCloseTo(-0.05, 2);
    expect(check.taxas).toBeCloseTo(51.48, 2);
    expect(check.detalheTaxas).toHaveLength(3);
    expect(check.totalReconhecido).toBeCloseTo(6577.67, 2);
    expect(check.diferenca).toBe(0);
    expect(check.confere).toBe(true);
  });
});
