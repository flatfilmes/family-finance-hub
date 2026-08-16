/**
 * Regressão do parser do Banco do Brasil usando o layout descrito do extrato
 * real (01–16/08/2026, agência 3540-8, conta 12211-4).
 *
 * O teste valida a regra financeira: saldo anterior + entradas − saídas
 * precisa fechar com o saldo final impresso, sem incluir saldo do dia,
 * lançamentos futuros ou áreas comerciais.
 */
import { describe, expect, it } from "vitest";
import {
  isBancoDoBrasil,
  parseBBStatementPeriod,
  parseBancoDoBrasilLines,
} from "./banco-do-brasil";
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

/**
 * REGRESSÃO DA IDENTIDADE TEMPORAL (bug do relatório auditoria-bb (10)).
 * O PDF de janeiro diz "Período: 01 a 31/01/2026" e traz o Saldo Anterior
 * datado de 29/12/2025 — essa data NUNCA pode virar o início do período.
 */
const JANEIRO = linhas([
  "Extrato de Conta Corrente",
  "Agência: 3540-8 Conta: 12211-4",
  "Período: 01 a 31/01/2026",
  "Lançamentos",
  "29/12/2025 Saldo Anterior 100,00 (+)",
  "05/01/2026 PIX RECEBIDO FULANO 200,00 (+)",
  "Saldo do dia 300,00 (+)",
  "20/01/2026 Pagamento de Boleto CELESC 316,09 (-)",
  "Saldo do dia 16,09 (-)",
  "S A L D O 16,09 (-)",
]);

describe("Banco do Brasil — período oficial do cabeçalho", () => {
  const r = parseBancoDoBrasilLines(JANEIRO);

  it("lê o cabeçalho abreviado 'Período: 01 a 31/01/2026'", () => {
    expect(parseBBStatementPeriod("Período: 01 a 31/01/2026")).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
    expect(r.periodoInicio).toBe("2026-01-01");
    expect(r.periodoFim).toBe("2026-01-31");
  });

  it("mantém o Saldo Anterior fora do período, com data própria", () => {
    expect(r.saldoInicial).toBe(100);
    expect(r.saldoInicialData).toBe("2025-12-29");
    expect(r.periodoInicio).not.toBe(r.saldoInicialData);
  });

  it("extrai os saldos do dia com a data do dia anterior lançado", () => {
    expect(r.checkpoints?.map((c) => [c.data, c.saldo])).toEqual([
      ["2026-01-05", 300],
      ["2026-01-20", -16.09],
    ]);
  });

  it("preserva saldo negativo e fecha a equação", () => {
    expect(r.saldoFinal).toBe(-16.09);
    const soma = r.movimentos.reduce((a, m) => a + m.valor, 0);
    expect(Number((r.saldoInicial! + soma).toFixed(2))).toBe(-16.09);
  });
});

/**
 * REGRESSÃO DA DATA CONTÁBIL (coluna "Dia") COM GEOMETRIA REAL.
 *
 * No PDF real a data contábil fica sozinha numa célula à esquerda (coluna
 * "Dia") e o histórico traz outra data ("Pix - Enviado 04/01 12:48"), que é
 * data do evento. A data contábil vale até aparecer a próxima célula da
 * coluna "Dia" — inclusive na virada de página — e é ela que data o
 * "Saldo do dia".
 */
const espacial = (
  linhas: Array<{ y: number; page?: number; cells: Array<[number, string]> }>,
): PdfLine[] =>
  linhas.map(({ y, page, cells }) => ({
    y,
    page: page ?? 1,
    cells: cells.map(([x, text]) => ({ x, text, y, width: text.length * 5 })),
    text: cells.map(([, text]) => text).join(" "),
  })) as PdfLine[];

const JANEIRO_ESPACIAL = espacial([
  { y: 800, cells: [[60, "Extrato de Conta Corrente"]] },
  { y: 790, cells: [[60, "Período: 01 a 31/01/2026"]] },
  { y: 780, cells: [[60, "Lançamentos"]] },
  { y: 770, cells: [[60, "29/12/2025"], [265, "Saldo Anterior"], [520, "4.115,02 (+)"]] },
  { y: 750, cells: [[60, "05/01/2026"], [150, "13105"], [190, "10501"]] },
  { y: 740, cells: [[265, "Pix - Enviado 04/01 12:48 EDUARDO GARCIA"], [520, "500,00 (-)"]] },
  { y: 730, cells: [[265, "Saldo do dia"], [520, "3.546,56 (+)"]] },
  { y: 700, cells: [[60, "14/01/2026"], [150, "13105"]] },
  { y: 690, cells: [[265, "Pagto cartão crédito"], [520, "4,32 (-)"]] },
  { y: 680, cells: [[265, "Saldo do dia"], [520, "3.790,49 (+)"]] },
  { y: 200, page: 1, cells: [[60, "19/01/2026"], [150, "13105"]] },
  { y: 60, page: 2, cells: [[265, "Pix - Enviado 17/01 09:10 MARIA"], [520, "100,00 (-)"]] },
  { y: 50, page: 2, cells: [[265, "Saldo do dia"], [520, "1.360,30 (+)"]] },
]);

describe("Banco do Brasil — data contábil da coluna Dia", () => {
  const r = parseBancoDoBrasilLines(JANEIRO_ESPACIAL);

  it("propaga a data da coluna Dia para todas as movimentações", () => {
    expect(r.movimentos).toHaveLength(3);
    expect(r.movimentos.every((m) => m.data !== null)).toBe(true);
    expect(r.movimentos.map((m) => m.data)).toEqual([
      "2026-01-05",
      "2026-01-14",
      "2026-01-19",
    ]);
  });

  it("não usa a data do histórico como data contábil", () => {
    const pix = r.movimentos[0]!;
    expect(pix.data).toBe("2026-01-05");
    expect(pix.eventDate).toBe("2026-01-04");
    const cartao = r.movimentos.find((m) => /cart/i.test(m.descricaoOriginal));
    expect(cartao?.data).toBe("2026-01-14");
  });

  it("mantém a data contábil na virada de página", () => {
    const continuacao = r.movimentos[2]!;
    expect(continuacao.data).toBe("2026-01-19");
    expect(continuacao.eventDate).toBe("2026-01-17");
  });

  it("data os saldos do dia pela coluna Dia corrente", () => {
    expect(r.checkpoints?.map((c) => [c.data, c.saldo])).toEqual([
      ["2026-01-05", 3546.56],
      ["2026-01-14", 3790.49],
      ["2026-01-19", 1360.3],
    ]);
  });

  it("guarda o Saldo Anterior com data própria, sem virar checkpoint", () => {
    expect(r.saldoInicial).toBe(4115.02);
    expect(r.saldoInicialData).toBe("2025-12-29");
    expect(r.checkpoints?.some((c) => c.data === "2025-12-29")).toBe(false);
  });
});

/**
 * REGRESSÃO ONE-PASS / EVENT-DRIVEN — janeiro/2026.
 *
 * O extrator de PDF pode devolver as células separadas por COLUNA VISUAL: toda
 * a coluna "Dia" da página chega antes de todas as movimentações. Lido nessa
 * ordem, o parser aplicava a ÚLTIMA data da página a todos os lançamentos
 * (19/01 na página 1, 31/01 na página 2).
 *
 * A montagem de linhas visuais (página ASC, Y DESC) devolve a ordem documental
 * real e a data contábil é CONGELADA no momento em que cada evento é criado.
 */
type LinhaFisica = { page: number; y: number; cells: Array<[number, string]> };

/** Emula a extração por coluna: primeiro a coluna "Dia", depois o resto. */
const porColunas = (linhas: LinhaFisica[]): PdfLine[] => {
  const saida: PdfLine[] = [];
  for (const page of [...new Set(linhas.map((l) => l.page))].sort()) {
    const daPagina = linhas.filter((l) => l.page === page);
    for (const lado of [0, 1]) {
      for (const l of daPagina) {
        const cells = l.cells
          .filter(([x]) => (lado === 0 ? x < 200 : x >= 200))
          .map(([x, text]) => ({ x, text }));
        if (!cells.length) continue;
        saida.push({
          page,
          y: l.y,
          cells,
          text: cells.map((c) => c.text).join(" "),
        });
      }
    }
  }
  return saida;
};

const dia = (page: number, y: number, data: string): LinhaFisica => ({
  page,
  y,
  cells: [[30, data], [110, "13105"], [170, "10501"]],
});
const mov = (
  page: number,
  y: number,
  historico: string,
  valor: string,
  data?: string,
): LinhaFisica => ({
  page,
  y,
  cells: [
    ...(data ? ([[30, data], [110, "13105"]] as Array<[number, string]>) : []),
    [265, historico],
    [520, valor],
  ],
});
const saldoDoDia = (page: number, y: number, valor: string): LinhaFisica => ({
  page,
  y,
  cells: [[265, "Saldo do dia"], [520, valor]],
});

const JANEIRO_COLUNAS = porColunas([
  { page: 1, y: 800, cells: [[30, "Extrato de Conta Corrente"]] },
  { page: 1, y: 790, cells: [[30, "Cliente: RODRIGO NUNES AMADOR"]] },
  { page: 1, y: 780, cells: [[30, "Período: 01 a 31/01/2026"]] },
  { page: 1, y: 770, cells: [[30, "Dia"], [110, "Lote"], [170, "Documento"], [265, "Histórico"], [520, "Valor"]] },
  { page: 1, y: 760, cells: [[30, "29/12/2025"], [265, "Saldo Anterior"], [520, "4.115,02 (+)"]] },

  mov(1, 740, "Pix - Enviado 04/01 12:48 EDUARDO GARCIA", "500,00 (-)", "05/01/2026"),
  mov(1, 730, "Pagamento Fatura de Água TUBARAO SANEAMENTO", "68,46 (-)"),
  saldoDoDia(1, 710, "3.546,56 (+)"),

  dia(1, 690, "07/01/2026"),
  mov(1, 685, "Pix - Recebido VALDIR PAULO", "183,00 (+)"),
  mov(1, 675, "Pix - Recebido MARCOS", "114,00 (+)"),
  saldoDoDia(1, 665, "3.843,56 (+)"),

  mov(1, 645, "Pagamento de Boleto CENTRO", "25,00 (-)", "09/01/2026"),
  saldoDoDia(1, 635, "3.818,56 (+)"),

  mov(1, 615, "Pix - Recebido ANA", "600,00 (+)", "13/01/2026"),
  mov(1, 605, "Pix - Enviado JOSE", "130,00 (-)"),
  saldoDoDia(1, 595, "4.288,56 (+)"),

  mov(1, 575, "Pagto cartão crédito", "4,32 (-)", "14/01/2026"),
  mov(1, 565, "Pagamento de Boleto CELESC DISTRIBUICAO S.A", "493,75 (-)"),
  saldoDoDia(1, 555, "3.790,49 (+)"),

  mov(1, 535, "Pix - Recebido TUBARAO COM", "200,00 (+)", "15/01/2026"),
  mov(1, 525, "Pagamento Fatura de Água TUBARAO SANEAMENTO", "70,15 (-)"),
  saldoDoDia(1, 515, "3.920,34 (+)"),

  mov(1, 495, "Pix - Enviado CARLOS", "68,20 (-)", "16/01/2026"),
  saldoDoDia(1, 485, "3.852,14 (+)"),

  // Última data da página 1 — a continuação atravessa a quebra de página.
  dia(1, 200, "19/01/2026"),
  { page: 2, y: 800, cells: [[30, "Extrato de Conta Corrente"]] },
  { page: 2, y: 790, cells: [[30, "Cliente: RODRIGO NUNES AMADOR"]] },
  { page: 2, y: 780, cells: [[30, "Período: 01 a 31/01/2026"]] },
  { page: 2, y: 770, cells: [[30, "Dia"], [110, "Lote"], [170, "Documento"], [265, "Histórico"], [520, "Valor"]] },
  mov(2, 750, "Pix - Enviado 17/01 11:42 ANDERSON LUIZ", "2.491,84 (-)"),
  saldoDoDia(2, 740, "1.360,30 (+)"),

  mov(2, 720, "Pagamento de Boleto CLARO S.A.", "113,22 (-)", "20/01/2026"),
  saldoDoDia(2, 710, "1.247,08 (+)"),

  mov(2, 690, "Pix - Recebido ANDERSON LUIZ", "1.500,00 (+)", "22/01/2026"),
  saldoDoDia(2, 680, "2.747,08 (+)"),

  mov(2, 660, "Pix - Recebido 26/01 12:45 FULLGAZ COM", "349,67 (+)", "26/01/2026"),

  { page: 2, y: 600, cells: [[30, "31/01/2026"], [265, "S A L D O"], [520, "3.096,75 (+)"]] },
]);

describe("Banco do Brasil — janeiro/2026 lido em ordem documental", () => {
  const r = parseBancoDoBrasilLines(JANEIRO_COLUNAS);
  const diarios = (r.checkpoints ?? []).filter((c) => c.tipo === "DAILY");
  const porDescricao = (re: RegExp) => r.movimentos.find((m) => re.test(m.descricaoOriginal));

  it("nenhuma movimentação fica sem data contábil", () => {
    expect(r.movimentos.length).toBeGreaterThan(0);
    expect(r.movimentos.filter((m) => !m.data)).toHaveLength(0);
  });

  it("congela a data no momento da criação de cada movimentação", () => {
    expect(porDescricao(/EDUARDO/)?.data).toBe("2026-01-05");
    expect(porDescricao(/EDUARDO/)?.eventDate).toBe("2026-01-04");
    expect(porDescricao(/TUBARAO SANEAMENTO/)?.data).toBe("2026-01-05");
    expect(porDescricao(/VALDIR/)?.data).toBe("2026-01-07");
    expect(porDescricao(/MARCOS/)?.data).toBe("2026-01-07");
    expect(porDescricao(/CENTRO/)?.data).toBe("2026-01-09");
    expect(porDescricao(/ANA/)?.data).toBe("2026-01-13");
    expect(porDescricao(/JOSE/)?.data).toBe("2026-01-13");
    expect(porDescricao(/cart[ãa]o/i)?.data).toBe("2026-01-14");
    expect(porDescricao(/CELESC/)?.data).toBe("2026-01-14");
    expect(porDescricao(/TUBARAO COM/)?.data).toBe("2026-01-15");
    expect(porDescricao(/CARLOS/)?.data).toBe("2026-01-16");
    expect(porDescricao(/CLARO/)?.data).toBe("2026-01-20");
    expect(porDescricao(/Recebido ANDERSON/)?.data).toBe("2026-01-22");
    expect(porDescricao(/FULLGAZ/)?.data).toBe("2026-01-26");
  });

  it("mantém a data contábil na virada de página e separa occurredAt", () => {
    const continuacao = porDescricao(/ANDERSON/);
    expect(continuacao?.data).toBe("2026-01-19");
    expect(continuacao?.eventDate).toBe("2026-01-17");
  });

  it("o fechamento 31/01 não redata as movimentações anteriores", () => {
    expect(r.movimentos.some((m) => m.data === "2026-01-31")).toBe(false);
    expect(r.saldoFinal).toBe(3096.75);
    expect(r.saldoFinalData).toBe("2026-01-31");
  });

  it("cria 10 checkpoints DAILY com as datas contábeis corretas", () => {
    expect(diarios.map((c) => [c.data, c.saldo])).toEqual([
      ["2026-01-05", 3546.56],
      ["2026-01-07", 3843.56],
      ["2026-01-09", 3818.56],
      ["2026-01-13", 4288.56],
      ["2026-01-14", 3790.49],
      ["2026-01-15", 3920.34],
      ["2026-01-16", 3852.14],
      ["2026-01-19", 1360.3],
      ["2026-01-20", 1247.08],
      ["2026-01-22", 2747.08],
    ]);
  });

  it("saldo anterior mantém a data da própria linha (29/12)", () => {
    expect(r.saldoInicial).toBe(4115.02);
    expect(r.saldoInicialData).toBe("2025-12-29");
    expect(r.periodoInicio).toBe("2026-01-01");
  });

  it("fecha matematicamente com o saldo impresso", () => {
    const soma = r.movimentos.reduce((a, m) => a + m.valor, 0);
    expect(Number((r.saldoInicial! + soma).toFixed(2))).toBe(3096.75);
  });

  it("todo checkpoint fecha com o acumulado até a sua data", () => {
    for (const c of diarios) {
      const soma = r.movimentos
        .filter((m) => (m.data ?? "") <= c.data)
        .reduce((a, m) => a + m.valor, 0);
      expect(Number((r.saldoInicial! + soma).toFixed(2))).toBe(c.saldo);
    }
  });

  it("registra o rastro temporal na ordem cronológica do passe único", () => {
    const trace = r.temporalTrace ?? [];
    const primeiro = trace.find((t) => t.event === "TRANSACTION_CREATED");
    expect(primeiro?.date).toBe("2026-01-05");
    const checkpoint = trace.find((t) => t.event === "CHECKPOINT_CREATED");
    expect(checkpoint?.date).toBe("2026-01-05");
    expect(trace.find((t) => t.event === "OPENING_BALANCE")?.date).toBe("2025-12-29");
  });
});
