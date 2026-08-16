/**
 * Regressão do extrato Itaú "itau-account-statement-2026-h1" (01/01–30/06/2026).
 *
 * A fixture reproduz a GEOMETRIA real do PDF (itens do pdf.js com x/y), porque
 * o bug que zerava as movimentações estava exatamente na montagem espacial:
 * o divisor de duas colunas separava "data + descrição" de "valor + saldo".
 *
 * Colunas reais do documento:
 *   data ~x30 | lançamentos ~x95 | valor (R$) ~x410-460 | saldo (R$) ~x515-565
 */
import { describe, expect, it } from "vitest";
import { parseItauBankStatementLayouts, detectItauBankStatement } from "./itau";
import type { ItauPipelineDiagnostics } from "./itau";
import type { PdfPageLayout, PdfTextItem } from "@/lib/pdf-extract";

let y = 800;
const itens: PdfTextItem[] = [];
const texto = (x: number, text: string, dy = 0) => {
  itens.push({ text, x, y: y - dy, width: text.length * 4.5 });
};
/** Números do Itaú são alinhados à DIREITA da coluna. */
const numero = (direita: number, text: string) => {
  const w = text.length * 4.8;
  itens.push({ text, x: direita - w, y, width: w });
};
const VALOR_DIR = 460;
const SALDO_DIR = 565;

const linha = (data: string, descricao: string, valor?: string, saldo?: string) => {
  y -= 14;
  texto(30, data);
  texto(95, descricao);
  if (valor) numero(VALOR_DIR, valor);
  if (saldo) numero(SALDO_DIR, saldo);
};

texto(30, "extrato conta / lançamentos");
y -= 16;
texto(30, "agência: 4635 conta: 025583-1");
y -= 16;
texto(30, "período de visualização: 01/01/2026 até 30/06/2026");
y -= 16;
texto(30, "Limite da Conta");
numero(SALDO_DIR, "0,00");
y -= 20;
texto(30, "data");
texto(95, "lançamentos");
texto(410, "valor (R$)");
texto(515, "saldo (R$)");

// Saldo atual do documento — FORA do período (metadado de referência).
linha("13/08/2026", "SALDO DO DIA", undefined, "4,16");
// Último saldo antes do período — abertura.
linha("31/12/2025", "SALDO DO DIA", undefined, "0,00");

linha("13/02/2026", "PIX TRANSF Rodrigo13/02", "10,00");
linha("13/02/2026", "SALDO DO DIA", undefined, "10,00");

linha("18/02/2026", "PIX TRANSF Rodrigo18/02", "2.000,00");
linha("18/02/2026", "PIX TRANSF Maria18/02", "2.000,00");
linha("18/02/2026", "PIX TRANSF Rodrigo18/02", "4.514,88");
linha("18/02/2026", "PIX TRANSF Rodrigo18/02", "2.604,77");
linha("18/02/2026", "FATURA PAGA ITAU GOLD", "-11.129,65");
linha("18/02/2026", "SALDO DO DIA", undefined, "0,00");

linha("17/03/2026", "PIX TRANSF Rodrigo17/03", "6.300,00");
linha("17/03/2026", "FATURA PAGA ITAU GOLD", "-6.277,05");
linha("17/03/2026", "SALDO DO DIA", undefined, "22,95");

linha("16/04/2026", "PIX TRANSF Rodrigo16/04", "4.800,00");
linha("16/04/2026", "SALDO DO DIA", undefined, "4.822,95");

linha("17/04/2026", "PIX TRANSF Rodrigo17/04", "1.500,00");
linha("17/04/2026", "FATURA PAGA ITAU GOLD", "-6.228,56");
linha("17/04/2026", "REND PAGO APLIC AUT MAIS", "0,03");
linha("17/04/2026", "SALDO DO DIA", undefined, "94,42");

linha("18/05/2026", "PIX TRANSF Rodrigo18/05", "5.200,00");
linha("18/05/2026", "FATURA PAGA ITAU GOLD", "-5.102,25");
linha("18/05/2026", "SALDO DO DIA", undefined, "192,17");

linha("17/06/2026", "PIX TRANSF Rodrigo17/06", "5.500,00");
linha("17/06/2026", "FATURA PAGA ITAU GOLD", "-5.571,48");
linha("17/06/2026", "REND PAGO APLIC AUT MAIS", "0,12");
linha("17/06/2026", "SALDO DO DIA", undefined, "120,81");

const PAGINA: PdfPageLayout[] = [{ page: 1, width: 595, height: 842, items: itens }];

describe("Itaú — extrato de conta 2026 H1 (fixture espacial)", () => {
  const parsed = parseItauBankStatementLayouts(PAGINA);
  const p = parsed.pipeline as ItauPipelineDiagnostics;

  it("detecta o banco por múltiplos sinais, sem depender do logo", () => {
    const d = detectItauBankStatement(p.rows.map((r) => r.raw));
    expect(d.detectedBank).toBe("ITAU");
    expect(d.matchedSignals.length).toBeGreaterThanOrEqual(3);
  });

  it("monta as linhas espaciais (rawItems → rows) sem perder a tabela", () => {
    expect(p.rawItems).toBeGreaterThan(0);
    expect(p.assembledRows).toBeGreaterThan(20);
  });

  it("usa exclusivamente o período de visualização", () => {
    expect(parsed.periodoInicio).toBe("2026-01-01");
    expect(parsed.periodoFim).toBe("2026-06-30");
  });

  it("lê as 17 movimentações do período — SALDO DO DIA não conta", () => {
    expect(parsed.movimentos).toHaveLength(17);
    expect(parsed.movimentos.some((m) => /saldo do dia/i.test(m.descricaoOriginal))).toBe(false);
  });

  it("separa abertura, checkpoints históricos e saldo de referência", () => {
    expect(parsed.saldoInicial).toBe(0);
    expect(p.openingBalance.date).toBe("2025-12-31");
    expect(parsed.checkpoints?.map((c) => c.saldo)).toEqual([
      10, 0, 22.95, 4822.95, 94.42, 192.17, 120.81,
    ]);
    expect(parsed.checkpoints).toHaveLength(7);
    expect(parsed.saldoReferenciaAtual).toEqual({ data: "2026-08-13", saldo: 4.16 });
    expect(parsed.saldoFinal).toBe(120.81);
  });

  it("classifica PIX, pagamento de fatura e rendimento", () => {
    const achar = (re: RegExp) => parsed.movimentos.find((m) => re.test(m.descricaoOriginal));
    expect(achar(/PIX TRANSF/)?.semantica).toBe("PIX");
    const fatura = achar(/FATURA PAGA ITAU GOLD/);
    expect(fatura?.semantica).toBe("CARD_PAYMENT");
    expect(fatura?.tipo).toBe("SAIDA");
    expect(achar(/REND PAGO/)?.semantica).toBe("INVESTMENT_INCOME");
  });

  it("fecha a validação matemática em todos os checkpoints", () => {
    expect(p.validation.errors).toEqual([]);
    expect(p.validation.status).toBe("PASS");
    expect(p.parsedTransactions).toBe(17);
    expect(p.parsedCheckpoints).toBe(7);
  });
});
