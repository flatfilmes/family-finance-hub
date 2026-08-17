/**
 * GOLDEN NUBANK ESPACIAL — Nubank_2026-08-17.pdf.
 *
 * Reproduz o layout REAL do pdf.js: data (x≈123), final do cartão (x≈172),
 * descrição (x≈214) e valor (x≈500) chegam como fragmentos separados e às vezes
 * em coordenadas y levemente diferentes (±3px). O row assembler precisa montar
 * as 11 transações mesmo assim.
 */
import { describe, expect, it } from "vitest";
import type { PdfPageLayout, PdfTextItem } from "@/lib/pdf-extract";
import { parseNubankSpatial } from "./nubank";

const it_ = (text: string, x: number, y: number): PdfTextItem => ({ text, x, y, width: 40 });

let cursor = 800;
const linhaCheia = (text: string): PdfTextItem[] => [it_(text, 60, (cursor -= 14))];

type Frag = [string, number, number?];
const linhaFrag = (frags: Frag[]): PdfTextItem[] => {
  const base = (cursor -= 14);
  return frags.map(([text, x, dy]) => it_(text, x, base + (dy ?? 0)));
};

const items: PdfTextItem[] = [
  ...linhaCheia("Nu Pagamentos S.A. - Instituição de Pagamento"),
  ...linhaCheia("RODRIGO NUNES AMADOR"),
  ...linhaFrag([["FATURA", 60], ["17 AGO 2026", 200]]),
  ...linhaFrag([["EMISSÃO E ENVIO", 60], ["10 AGO 2026", 200]]),
  ...linhaCheia("Data de vencimento: 17 AGO 2026"),
  ...linhaCheia("Esta é a sua fatura de agosto, no valor de R$ 155,99"),
  ...linhaCheia("PRÓXIMAS FATURAS"),
  ...linhaCheia("Fechamento da próxima fatura"),
  ...linhaCheia("10 SET 2026"),
  ...linhaCheia("RESUMO DA FATURA ATUAL"),
  ...linhaFrag([["Fatura anterior", 60], ["R$ 15,53", 500]]),
  ...linhaFrag([["Pagamento recebido", 60], ["-R$ 15,53", 500]]),
  ...linhaFrag([["Total de compras de todos os cartões", 60], ["R$ 155,99", 500]]),
  ...linhaCheia("TRANSAÇÕES"),
  ...linhaCheia("DE 10 JUL A 10 AGO"),
  ...linhaCheia("RODRIGO NUNES AMADOR •••• 9982"),
  // CASO A: tudo na mesma row
  ...linhaFrag([["15 JUL", 123], ["•••• 9982", 172], ["Padaria Dama Doce", 214], ["R$ 11,37", 500]]),
  // CASO B: data numa row, resto na row seguinte
  ...linhaCheia("19 JUL"),
  ...linhaFrag([["•••• 9982", 172], ["Padaria Dama Doce", 214], ["R$ 8,50", 500]]),
  // CASO C: data + cartão + descrição numa row, valor na seguinte
  ...linhaFrag([["21 JUL", 123], ["•••• 9982", 172], ["Padaria Dama Doce", 214]]),
  ...linhaFrag([["R$ 10,38", 500]]),
  // tolerância vertical: data 3px acima do restante
  ...linhaFrag([["23 JUL", 123, 3], ["•••• 7274", 172], ["Google One", 214], ["R$ 14,99", 500]]),
  ...linhaFrag([["24 JUL", 123], ["•••• 9982", 172], ["Mercado Junior", 214], ["R$ 10,27", 500]]),
  ...linhaFrag([["25 JUL", 123], ["•••• 9982", 172], ["Mercado Junior", 214], ["R$ 10,75", 500]]),
  ...linhaFrag([["28 JUL", 123, -3], ["•••• 9982", 172], ["Padaria Dama Doce", 214], ["R$ 8,59", 500]]),
  ...linhaFrag([["06 AGO", 123], ["•••• 9982", 172], ["Padaria Dama Doce", 214], ["R$ 16,45", 500]]),
  ...linhaFrag([["07 AGO", 123], ["•••• 9982", 172], ["Mercado Junior", 214], ["R$ 35,40", 500]]),
  ...linhaFrag([["09 AGO", 123], ["•••• 9982", 172], ["Padaria Dama Doce", 214], ["R$ 9,04", 500]]),
  ...linhaFrag([["09 AGO", 123], ["•••• 9982", 172], ["Padaria Dama Doce", 214], ["R$ 20,25", 500]]),
  ...linhaCheia("Pagamentos e Financiamentos"),
  ...linhaFrag([["15 JUL", 123], ["Pagamento em 15 JUL", 214], ["-R$ 15,53", 500]]),
  ...linhaFrag([["17 JUL", 123], ["Saldo restante da fatura anterior", 214], ["R$ 0,00", 500]]),
  ...linhaCheia("Alternativas de pagamento"),
  ...linhaFrag([["Pagamento mínimo", 60], ["R$ 23,40", 500]]),
  ...linhaFrag([["Parcele em 6 meses", 60], ["R$ 177,08", 500]]),
  ...linhaFrag([["Crédito rotativo", 60], ["R$ 158,86", 500]]),
  ...linhaCheia("Encargos e Custo Efetivo Total (CET) válidos para o próximo período"),
  ...linhaCheia("Juros de parcelamento 9,75% CET 289,42%"),
  ...linhaCheia("Seus limites"),
  ...linhaFrag([["Limite total", 60], ["R$ 8.100,00", 500]]),
];

const pages: PdfPageLayout[] = [{ page: 1, width: 595, height: 842, items }];
const parsed = parseNubankSpatial(pages);

describe("NUBANK_PDF espacial — row assembler", () => {
  it("monta as 11 transações a partir de fragmentos", () => {
    expect(parsed.entries).toHaveLength(11);
    expect(
      parsed.entries.map((e) => [e.data_lancamento, e.card_last4, e.descricao_original, e.valor]),
    ).toEqual([
      ["2026-07-15", "9982", "Padaria Dama Doce", 11.37],
      ["2026-07-19", "9982", "Padaria Dama Doce", 8.5],
      ["2026-07-21", "9982", "Padaria Dama Doce", 10.38],
      ["2026-07-23", "7274", "Google One", 14.99],
      ["2026-07-24", "9982", "Mercado Junior", 10.27],
      ["2026-07-25", "9982", "Mercado Junior", 10.75],
      ["2026-07-28", "9982", "Padaria Dama Doce", 8.59],
      ["2026-08-06", "9982", "Padaria Dama Doce", 16.45],
      ["2026-08-07", "9982", "Mercado Junior", 35.4],
      ["2026-08-09", "9982", "Padaria Dama Doce", 9.04],
      ["2026-08-09", "9982", "Padaria Dama Doce", 20.25],
    ]);
    const soma = Math.round(parsed.entries.reduce((a, e) => a + e.valor, 0) * 100) / 100;
    expect(soma).toBe(155.99);
    expect(parsed.valor_total_fatura).toBe(155.99);
    expect(parsed.extraction_status).toBe("READY");
  });

  it("datas canônicas do cabeçalho", () => {
    expect(parsed.titular).toBe("RODRIGO NUNES AMADOR");
    expect(parsed.metadata?.data_emissao).toBe("2026-08-10");
    expect(parsed.data_fechamento).toBe("2026-08-10");
    expect(parsed.metadata?.next_closing_date).toBe("2026-09-10");
    expect(parsed.data_vencimento).toBe("2026-08-17");
    expect(parsed.periodo_inicio).toBe("2026-07-10");
    expect(parsed.periodo_fim).toBe("2026-08-10");
    expect(parsed.final_cartao).toBeNull();
  });

  it("fatura anterior e pagamento são metadados", () => {
    expect(parsed.metadata?.total_fatura_anterior).toBe(15.53);
    expect(parsed.metadata?.previous_invoice_payment).toEqual({
      data: "2026-07-15",
      valor: -15.53,
    });
    expect(parsed.metadata?.limite_credito).toBe(8100);
  });

  it("regressão negativa: nenhum valor de simulação vira lançamento", () => {
    const proibidos = [
      167.99, 177.08, 132.59, 158.86, 182.26, 23.39, 23.4, 48.19, 25.61, 10.81, 19.36, 1.19,
      1.73, 289.42, 503.15, 570.17, 8100, 1215, 15.53, 0,
    ];
    for (const v of proibidos) {
      expect(parsed.entries.some((e) => Math.abs(e.valor) === v)).toBe(false);
    }
  });
});

describe("NUBANK_PDF — issueDate vs dueDate", () => {
  it("EMISSÃO E ENVIO tem prioridade sobre FATURA", () => {
    expect(parsed.metadata?.data_emissao).toBe("2026-08-10");
    expect(parsed.data_vencimento).toBe("2026-08-17");
    expect(parsed.metadata?.data_emissao).not.toBe(parsed.data_vencimento);
  });

  it("rótulos colados na mesma row visual", () => {
    const linha: PdfTextItem[] = [
      it_("FATURA", 60, 700),
      it_("17 AGO 2026", 200, 700),
      it_("EMISSÃO E ENVIO", 330, 700),
      it_("10 AGO 2026", 470, 700),
    ];
    const r = parseNubankSpatial([{ page: 1, width: 595, height: 842, items: [...linha] }]);
    expect(r.metadata?.data_emissao).toBe("2026-08-10");
    expect(r.data_vencimento).toBe("2026-08-17");
  });
});
