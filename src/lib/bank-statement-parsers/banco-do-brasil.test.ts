/**
 * Regressão do parser do Banco do Brasil usando o layout descrito do extrato
 * real (01–16/08/2026, agência 3540-8, conta 12211-4).
 *
 * O teste valida a regra financeira: saldo anterior + entradas − saídas
 * precisa fechar com o saldo final impresso, sem incluir saldo do dia,
 * lançamentos futuros ou áreas comerciais.
 */
import { describe, expect, it } from "vitest";
import { isBancoDoBrasil, parseBancoDoBrasilLines } from "./banco-do-brasil";
import type { PdfLine } from "@/lib/pdf-extract";

const linhas = (textos: string[]): PdfLine[] =>
  textos.map((text, i) => ({ y: i * 10, text, cells: [], page: 1 }));

const EXTRATO = linhas([
  "Banco do Brasil",
  "Extrato de Conta Corrente",
  "Cliente: RODRIGO NUNES AMADOR",
  "Agência: 3540-8 Conta: 12211-4",
  "Período: 01/08/2026 a 16/08/2026",
  "Lançamentos",
  "30/07/2026 Saldo Anterior 269,64 (+)",
  "03/08/2026 PIX RECEBIDO VALDIR PAULO M 5.000,00 (+)",
  "03/08/2026 Pagamento Fatura de Água TUBARAO SANEAMENTO 52,44 (-)",
  "03/08/2026 Cobrança de I.O.F. IOF Saldo Devedor Conta 0,06 (-)",
  "Saldo do dia 5.217,14 (+)",
  "05/08/2026 PIX RECEBIDO FULLGAZ COM 250,00 (+)",
  "05/08/2026 Pagamento de Boleto CELESC DISTRIBUICAO S.A 590,82 (-)",
  "Saldo do dia 4.876,32 (+)",
  "11/08/2026 PIX ENVIADO Carlos Eduardo Pardal Gil 77,00 (-)",
  "Saldo do dia 4.799,32 (+)",
  "12/08/2026 Pagto cartão crédito 4,32 (-)",
  "Saldo do dia 4.795,00 (+)",
  "S A L D O 4.795,00 (+)",
  "Lançamentos Futuros",
  "20/08/2026 CLARO RESIDENCIAL 110,28 (-)",
  "Informações Complementares",
  "Limite especial 1.000,00 (+)",
  "Taxa limite especial 12,00 (-)",
  "Despesas IOF de simulação 15,42 (-)",
  "Valor total devido de simulação 1.234,56 (-)",
]);

describe("parser Banco do Brasil", () => {
  const r = parseBancoDoBrasilLines(EXTRATO);
  const entradas = r.movimentos.filter((m) => m.valor > 0).reduce((a, m) => a + m.valor, 0);
  const saidas = r.movimentos
    .filter((m) => m.valor < 0)
    .reduce((a, m) => a + Math.abs(m.valor), 0);

  it("reconhece somente as 7 movimentações realizadas", () => {
    expect(r.movimentos).toHaveLength(7);
  });

  it("guarda saldo anterior e saldo final como controle de saldo", () => {
    expect(r.saldoInicial).toBe(269.64);
    expect(r.saldoFinal).toBe(4795);
    expect(
      r.movimentos.some((m) => /^(saldo do dia|saldo anterior|s a l d o)/i.test(m.descricaoOriginal)),
    ).toBe(false);
  });

  it("usa o sinal impresso pelo banco", () => {
    expect(Number(entradas.toFixed(2))).toBe(5250);
    expect(Number(saidas.toFixed(2))).toBe(724.64);
  });

  it("fecha a validação matemática do extrato", () => {
    const calculado = Number((r.saldoInicial! + entradas - saidas).toFixed(2));
    expect(calculado).toBe(4795);
    expect(Number((calculado - r.saldoFinal!).toFixed(2))).toBe(0);
  });

  it("separa lançamentos futuros e ignora áreas comerciais", () => {
    expect(r.futuros).toHaveLength(1);
    expect(r.futuros?.[0]?.valor).toBe(-110.28);
    expect(r.movimentos.some((m) => /limite|simula/i.test(m.descricaoOriginal))).toBe(false);
  });

  it("mantém o IOF real da conta como movimentação", () => {
    const iof = r.movimentos.find((m) => /I\.O\.F/i.test(m.descricaoOriginal));
    expect(iof?.valor).toBe(-0.06);
    expect(iof?.tipo).toBe("TARIFA");
  });

  it("lê identificação da conta", () => {
    expect(r.identificacao?.conta).toContain("12211-4");
    expect(r.identificacao?.titular).toContain("RODRIGO");
  });

  it("usa o período oficial, não a primeira ou última movimentação", () => {
    expect(r.periodoInicio).toBe("2026-08-01");
    expect(r.periodoFim).toBe("2026-08-16");
  });
});

/**
 * Variante real observada no dump: o PDF nem sempre entrega a marca textual
 * "Banco do Brasil" na mesma extração, e em algumas páginas o sinal é
 * impresso ANTES do valor. O sinal continua sendo a única fonte de verdade.
 */
const EXTRATO_SEM_MARCA = linhas([
  "Extrato de Conta Corrente",
  "Agência: 3540-8 Conta: 12211-4",
  "Lançamentos",
  "30/07/2026 Saldo Anterior (+) 269,64",
  "03/08/2026 PIX RECEBIDO VALDIR PAULO M (+) 5.000,00",
  "03/08/2026 Pagamento Fatura de Água TUBARAO SANEAMENTO (-) 52,44",
  "03/08/2026 Cobrança de I.O.F. IOF Saldo Devedor Conta (-) 0,06",
  "Saldo do dia (+) 5.217,14",
  "05/08/2026 PIX RECEBIDO FULLGAZ COM (+) 250,00",
  "05/08/2026 Pagamento de Boleto CELESC DISTRIBUICAO S.A (-) 590,82",
  "11/08/2026 PIX ENVIADO Carlos Eduardo Pardal Gil (-) 77,00",
  "12/08/2026 Pagto cartão crédito (-) 4,32",
  "S A L D O (+) 4.795,00",
  "Lançamentos Futuros",
  "20/08/2026 CLARO RESIDENCIAL (-) 110,28",
]);

describe("Banco do Brasil — sinal antes do valor e sem marca do banco", () => {
  const r = parseBancoDoBrasilLines(EXTRATO_SEM_MARCA);
  const entradas = r.movimentos.filter((m) => m.valor > 0).reduce((a, m) => a + m.valor, 0);
  const saidas = r.movimentos
    .filter((m) => m.valor < 0)
    .reduce((a, m) => a + Math.abs(m.valor), 0);

  it("é reconhecido pelo layout de sinal impresso", () => {
    expect(isBancoDoBrasil(EXTRATO_SEM_MARCA.map((l) => l.text))).toBe(true);
  });

  it("fecha os mesmos totais do extrato real", () => {
    expect(r.movimentos).toHaveLength(7);
    expect(Number(entradas.toFixed(2))).toBe(5250);
    expect(Number(saidas.toFixed(2))).toBe(724.64);
    expect(r.saldoInicial).toBe(269.64);
    expect(r.saldoFinal).toBe(4795);
    expect(Number((r.saldoInicial! + entradas - saidas).toFixed(2))).toBe(4795);
    expect(r.futuros).toHaveLength(1);
  });
});

/**
 * RAW espacial real: no PDF do BB o histórico de alguns lançamentos ocupa DUAS
 * linhas de texto (Y diferente da data/valor). Antes, esses três lançamentos
 * (Água, IOF e CELESC) eram descartados por "sem descrição reconhecível",
 * criando divergência de R$ 643,32.
 */
const linhaFinanceira = (y: number, data: string, valor: string): PdfLine => ({
  y,
  text: `${data} ${valor}`,
  cells: [
    { x: 60, text: data },
    { x: 450, text: valor },
  ],
  page: 1,
});
const linhaHistorico = (y: number, text: string): PdfLine => ({
  y,
  text,
  cells: [{ x: 265, text }],
  page: 1,
});
const linhaSimples = (y: number, text: string): PdfLine => ({
  y,
  text,
  cells: [{ x: 60, text }],
  page: 1,
});

const EXTRATO_ESPACIAL: PdfLine[] = [
  linhaSimples(760, "Extrato de Conta Corrente"),
  linhaSimples(750, "Agência: 3540-8 Conta: 12211-4"),
  linhaSimples(740, "Lançamentos"),
  linhaFinanceira(700, "30/07/2026", "Saldo Anterior 269,64 (+)"),
  linhaFinanceira(680, "03/08/2026", "PIX RECEBIDO VALDIR PAULO M 5.000,00 (+)"),
  linhaHistorico(661.86, "Pagamento Fatura de Água"),
  linhaFinanceira(656.04, "03/08/2026", "52,44 (-)"),
  linhaHistorico(650.22, "TUBARAO SANEAMENTO"),
  linhaHistorico(636.0, "Cobrança de I.O.F."),
  linhaFinanceira(630.0, "03/08/2026", "0,06 (-)"),
  linhaHistorico(624.0, "IOF Saldo Devedor Conta"),
  linhaSimples(614, "Saldo do dia 5.217,14 (+)"),
  linhaFinanceira(600, "05/08/2026", "PIX RECEBIDO FULLGAZ COM 250,00 (+)"),
  linhaHistorico(586.0, "Pagamento de Boleto"),
  linhaFinanceira(580.0, "05/08/2026", "590,82 (-)"),
  linhaHistorico(574.0, "CELESC DISTRIBUICAO S.A"),
  linhaSimples(564, "Saldo do dia 4.876,32 (+)"),
  linhaFinanceira(550, "11/08/2026", "PIX ENVIADO Carlos Eduardo Pardal Gil 77,00 (-)"),
  linhaSimples(540, "Saldo do dia 4.799,32 (+)"),
  linhaFinanceira(530, "12/08/2026", "Pagto cartão crédito 4,32 (-)"),
  linhaSimples(520, "Saldo do dia 4.795,00 (+)"),
  linhaSimples(510, "S A L D O 4.795,00 (+)"),
  linhaSimples(490, "Lançamentos Futuros"),
  linhaFinanceira(480, "20/08/2026", "CLARO RESIDENCIAL 110,28 (-)"),
  linhaSimples(460, "Informações Adicionais"),
  linhaSimples(450, "Despesas IOF de simulação 15,42 (-)"),
];

describe("Banco do Brasil — histórico em duas linhas (RAW espacial)", () => {
  const r = parseBancoDoBrasilLines(EXTRATO_ESPACIAL);
  const entradas = r.movimentos.filter((m) => m.valor > 0).reduce((a, m) => a + m.valor, 0);
  const saidas = r.movimentos
    .filter((m) => m.valor < 0)
    .reduce((a, m) => a + Math.abs(m.valor), 0);
  const achar = (re: RegExp) => r.movimentos.find((m) => re.test(m.descricaoOriginal));

  it("recupera as 7 movimentações realizadas", () => {
    expect(r.movimentos).toHaveLength(7);
    expect(r.movimentos.filter((m) => m.valor > 0)).toHaveLength(2);
    expect(r.movimentos.filter((m) => m.valor < 0)).toHaveLength(5);
  });

  it("fecha o saldo do extrato sem ajuste artificial", () => {
    expect(r.saldoInicial).toBe(269.64);
    expect(Number(entradas.toFixed(2))).toBe(5250);
    expect(Number(saidas.toFixed(2))).toBe(724.64);
    expect(Number((r.saldoInicial! + entradas - saidas).toFixed(2))).toBe(4795);
    expect(r.saldoFinal).toBe(4795);
  });

  it("recupera Água, IOF e CELESC com histórico de duas linhas", () => {
    const agua = achar(/TUBARAO/i);
    expect(agua?.valor).toBe(-52.44);
    expect(agua?.descricaoOriginal).toMatch(/Pagamento Fatura de Água/i);
    const iof = achar(/IOF Saldo Devedor/i);
    expect(iof?.valor).toBe(-0.06);
    const celesc = achar(/CELESC/i);
    expect(celesc?.valor).toBe(-590.82);
    expect(celesc?.descricaoOriginal).toMatch(/Pagamento de Boleto/i);
  });

  it("mantém saldos do dia como checkpoints e futuro separado", () => {
    expect(r.checkpoints?.map((c) => c.saldo)).toEqual([5217.14, 4876.32, 4799.32, 4795]);
    expect(r.futuros).toHaveLength(1);
    expect(r.futuros?.[0]?.valor).toBe(-110.28);
    expect(r.movimentos.some((m) => /simula/i.test(m.descricaoOriginal))).toBe(false);
  });
});
