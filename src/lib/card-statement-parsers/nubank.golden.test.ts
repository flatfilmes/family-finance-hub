/**
 * GOLDEN NUBANK — Nubank_2026-08-17.pdf.
 *
 * Reproduz as linhas canônicas do PDF (capa, resumo, transações, pagamentos,
 * alternativas de pagamento, encargos futuros e limites). Somente a seção
 * TRANSAÇÕES pode gerar itens cobrados.
 */
import { describe, expect, it } from "vitest";
import type { PdfLine } from "@/lib/pdf-extract";
import { parseNubank } from "./nubank";

const l = (text: string, y = 0): PdfLine => ({ y, text, cells: [] });

const linhas: PdfLine[] = [
  // capa
  l("Nu Pagamentos S.A. - Instituição de Pagamento"),
  l("RODRIGO NUNES AMADOR"),
  l("Data de vencimento: 17 AGO 2026"),
  l("Esta é a sua fatura de agosto, no valor de R$ 155,99"),
  l("FATURA 17 AGO 2026"),
  l("EMISSÃO E ENVIO 10 AGO 2026"),
  l("Fechamento da próxima fatura 10 SET 2026"),
  // resumo
  l("RESUMO DA FATURA ATUAL"),
  l("Fatura anterior R$ 15,53"),
  l("Pagamento recebido -R$ 15,53"),
  l("Total de compras de todos os cartões R$ 155,99"),
  l("Pagamento total da fatura R$ 155,99"),
  // transações
  l("TRANSAÇÕES"),
  l("DE 10 JUL A 10 AGO"),
  l("RODRIGO NUNES AMADOR •••• 9982"),
  l("15 JUL Padaria Dama Doce R$ 11,37"),
  l("19 JUL Padaria Dama Doce R$ 8,50"),
  l("21 JUL Padaria Dama Doce R$ 10,38"),
  l("RODRIGO NUNES AMADOR •••• 7274"),
  l("23 JUL Google One R$ 14,99"),
  l("RODRIGO NUNES AMADOR •••• 9982"),
  l("24 JUL Mercado Junior R$ 10,27"),
  l("25 JUL Mercado Junior R$ 10,75"),
  l("28 JUL Padaria Dama Doce R$ 8,59"),
  l("06 AGO Padaria Dama Doce R$ 16,45"),
  l("07 AGO Mercado Junior R$ 35,40"),
  l("09 AGO Padaria Dama Doce R$ 9,04"),
  l("09 AGO Padaria Dama Doce R$ 20,25"),
  // pagamentos e financiamentos
  l("Pagamentos e Financiamentos"),
  l("15 JUL Pagamento em 15 JUL -R$ 15,53"),
  l("17 JUL Saldo restante da fatura anterior R$ 0,00"),
  // alternativas de pagamento (simulações)
  l("Alternativas de pagamento"),
  l("Pagamento mínimo R$ 23,40"),
  l("Parcele em 6 meses Total a pagar R$ 177,08"),
  l("Parcele em 3 meses Total a pagar R$ 167,99"),
  l("Entrada R$ 23,39 e saldo restante R$ 132,59"),
  l("Crédito rotativo R$ 158,86"),
  l("Juros do rotativo R$ 26,27"),
  l("Total com rotativo R$ 182,26"),
  l("Parcela de R$ 48,19"),
  l("Parcela de R$ 25,61"),
  l("Juros R$ 10,81"),
  l("IOF R$ 19,36"),
  l("IOF adicional R$ 1,19"),
  l("IOF diário R$ 1,73"),
  // encargos futuros
  l("Encargos e Custo Efetivo Total (CET) válidos para o próximo período"),
  l("Juros de parcelamento 9,75% CET 289,42%"),
  l("Rotativo 503,15% e 570,17%"),
  l("IOF 0,38% e 0,008% ao dia · multa 3,5%"),
  // limites
  l("Seus limites"),
  l("Limite total R$ 8.100,00"),
  l("Saque no crédito R$ 1.215,00"),
];

const parsed = parseNubank(linhas);

describe("NUBANK_PDF — golden Nubank_2026-08-17", () => {
  it("cabeçalho canônico", () => {
    expect(parsed.parser).toBe("NUBANK_PDF");
    expect(parsed.emissor).toBe("NUBANK");
    expect(parsed.titular).toBe("RODRIGO NUNES AMADOR");
    expect(parsed.data_vencimento).toBe("2026-08-17");
    expect(parsed.periodo_inicio).toBe("2026-07-10");
    expect(parsed.periodo_fim).toBe("2026-08-10");
    expect(parsed.metadata?.data_emissao).toBe("2026-08-10");
    expect(parsed.data_fechamento).toBe("2026-08-10");
    expect(parsed.metadata?.next_closing_date).toBe("2026-09-10");
    expect(parsed.data_fechamento).not.toBe(parsed.metadata?.next_closing_date);
  });

  it("11 compras cobradas somando 155,99", () => {
    expect(parsed.entries).toHaveLength(11);
    const soma = Math.round(parsed.entries.reduce((a, e) => a + e.valor, 0) * 100) / 100;
    expect(soma).toBe(155.99);
    expect(parsed.valor_total_fatura).toBe(155.99);
    expect(parsed.entries.every((e) => e.total_parcelas === null)).toBe(true);
    expect(parsed.entries.every((e) => e.valor > 0)).toBe(true);
  });

  it("preserva o cartão de cada item (fatura consolidada)", () => {
    const google = parsed.entries.find((e) => e.descricao_original.includes("Google"))!;
    expect(google.card_last4).toBe("7274");
    expect(new Set(parsed.entries.map((e) => e.card_last4))).toEqual(new Set(["9982", "7274"]));
    expect(parsed.final_cartao).toBeNull();
  });

  it("pagamento anterior é metadata, nunca item cobrado", () => {
    expect(parsed.metadata?.total_fatura_anterior).toBe(15.53);
    expect(parsed.metadata?.previous_invoice_payment).toEqual({
      data: "2026-07-15",
      valor: -15.53,
    });
    expect(parsed.entries.some((e) => e.valor === -15.53)).toBe(false);
    expect(parsed.entries.some((e) => /pagamento/i.test(e.descricao_original))).toBe(false);
  });

  it("nenhum valor de simulação, encargo futuro ou limite vira lançamento", () => {
    const proibidos = [
      177.08, 167.99, 132.59, 158.86, 182.26, 23.39, 23.4, 48.19, 25.61, 10.81, 19.36, 1.19,
      1.73, 289.42, 503.15, 570.17, 8100, 1215, 26.27,
    ];
    for (const v of proibidos) {
      expect(parsed.entries.some((e) => Math.abs(e.valor) === v)).toBe(false);
    }
  });

  it("saldo restante zero não gera item", () => {
    expect(parsed.entries.some((e) => /saldo restante/i.test(e.descricao_original))).toBe(false);
  });

  it("extração pronta e limite lido como metadata", () => {
    expect(parsed.extraction_status).toBe("READY");
    expect(parsed.metadata?.limite_credito).toBe(8100);
  });
});
