/**
 * Parser de EXTRATO DE CONTA CORRENTE — ITAÚ (PDF digital).
 *
 * Layout real do Itaú ("extrato conta / lançamentos"):
 *
 *   data | lançamentos | valor (R$) | saldo (R$)
 *
 * IMPORTANTE — por que este parser lê o PDF por conta própria:
 * `extractPdfLines()` aplica o divisor de DUAS COLUNAS (feito para faturas de
 * cartão). No extrato de conta o maior vão vertical da página fica entre a
 * descrição e as colunas numéricas, então aquele divisor separava
 * "data + descrição" de "valor + saldo" em linhas diferentes e o parser
 * enxergava ZERO movimentações. Aqui montamos as linhas direto dos itens do
 * pdf.js, agrupando por Y e classificando cada número pelo X da coluna.
 *
 * Regras próprias do Itaú — NENHUMA regra do Banco do Brasil é reaproveitada:
 *  - PERÍODO: só de "período de visualização: DD/MM/AAAA até DD/MM/AAAA";
 *  - ABERTURA: último "SALDO DO DIA" anterior a period_start;
 *  - CHECKPOINT: "SALDO DO DIA" dentro do período (coluna saldo);
 *  - SALDO FORA DO PERÍODO: vira `saldoReferenciaAtual` (metadado), nunca
 *    checkpoint nem saldo final;
 *  - TRANSAÇÃO: data + descrição + número na coluna "valor (R$)".
 *
 * Nada aqui persiste nem cria ajuste: divergência é mostrada, nunca corrigida.
 */
import {
  extractPdfPageLayouts,
  parseValorBr,
  type PdfCell,
  type PdfLine,
  type PdfPageLayout,
} from "@/lib/pdf-extract";
import { normalizeDescricao, semAcento } from "@/lib/card-statement-parsers/generic";
import type {
  BankMovementKind,
  ParsedBalanceCheckpoint,
  ParsedBankMovement,
  ParsedBankStatement,
  StatementSemanticKind,
} from "@/lib/bank-statements/types";

export const ITAU_BANK_PARSER_ID = "ITAU_BANK_STATEMENT";

const VALOR_RE = /^-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}-?$|^-?\s?\d+,\d{2}-?$/;
const DATA_CELULA = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/;
const PERIODO_RE =
  /per[ií]odo\s+de\s+visualiza[cç][aã]o[:\s]*([0-3]\d\/[01]\d\/\d{4})\s*(?:at[eé]|a|-)\s*([0-3]\d\/[01]\d\/\d{4})/i;

/** Tolerância de Y para considerar que dois itens estão na MESMA linha visual. */
const Y_TOLERANCIA_ITAU = 3;

const plano = (t: string) => semAcento(t).toLowerCase().replace(/\s+/g, " ").trim();

function isoBr(br: string): string | null {
  const m = br.match(/^([0-3]\d)\/([01]\d)\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function isoCelula(texto: string, anoBase: number): string | null {
  const m = texto.replace(/\s+/g, "").match(DATA_CELULA);
  if (!m) return null;
  const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(anoBase);
  const iso = `${ano}-${m[2]}-${m[1]}`;
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
}

function valorDaCelula(texto: string): number | null {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!VALOR_RE.test(limpo)) return null;
  const abs = Math.abs(parseValorBr(limpo));
  const negativo = limpo.startsWith("-") || limpo.endsWith("-");
  return negativo ? -abs : abs;
}

/** Linha de controle de saldo do Itaú — nunca é movimentação. */
function ehLinhaDeSaldo(descricao: string) {
  const t = plano(descricao);
  return (
    t.startsWith("saldo do dia") ||
    t.startsWith("saldo anterior") ||
    t.startsWith("saldo final") ||
    t.startsWith("saldo em conta") ||
    t.startsWith("saldo total disponivel") ||
    t === "saldo"
  );
}

/** Classificação semântica declarada no documento (regras Itaú). */
export function classificarItau(descricao: string): {
  tipo: BankMovementKind;
  semantica: StatementSemanticKind;
} {
  const t = plano(descricao);
  if (t.includes("fatura paga") || t.includes("pagto fatura") || t.includes("pagamento fatura"))
    return { tipo: "SAIDA", semantica: "CARD_PAYMENT" };
  if (t.includes("rend pago") || t.includes("rendimento") || t.includes("aplic aut"))
    return { tipo: "JUROS", semantica: "INVESTMENT_INCOME" };
  if (t.startsWith("pix") || t.includes("pix transf") || t.includes("pix "))
    return { tipo: "TRANSFERENCIA", semantica: "PIX" };
  if (t.includes("ted") || t.includes("doc ") || t.includes("transf"))
    return { tipo: "TRANSFERENCIA", semantica: "TRANSFER" };
  if (t.includes("tarifa") || t.includes("iof") || t.includes("cesta") || t.includes("anuidade"))
    return { tipo: "TARIFA", semantica: "FEE" };
  if (t.includes("estorno") || t.includes("devolucao"))
    return { tipo: "ESTORNO", semantica: "REFUND" };
  if (t.includes("aplicacao") || t.includes("resgate"))
    return { tipo: "TRANSFERENCIA", semantica: "INVESTMENT" };
  return { tipo: "OUTRO", semantica: "OTHER" };
}

// ------------------------------------------------------------------ detecção

/**
 * Sinais ESPECÍFICOS do extrato de conta Itaú.
 *
 * Nada aqui pode ser genérico: "agência", "conta" e "saldo do dia" existem em
 * praticamente todo extrato bancário e por isso NÃO entram nesta lista — elas
 * são tratadas como sinal auxiliar (peso 0,5) no detector central.
 */
const SINAIS_ITAU: { id: string; peso: number; teste: (t: string) => boolean }[] = [
  { id: "extrato conta / lançamentos", peso: 4, teste: (t) => t.includes("extrato conta") },
  { id: "período de visualização", peso: 3, teste: (t) => t.includes("periodo de visualizacao") },
  { id: "FATURA PAGA ITAU", peso: 4, teste: (t) => t.includes("fatura paga itau") },
  { id: "itau.com.br", peso: 4, teste: (t) => t.includes("itau.com.br") },
  { id: "Conta Universitária Itaú", peso: 4, teste: (t) => /conta universitaria itau/.test(t) },
  { id: "Limite da Conta", peso: 2, teste: (t) => t.includes("limite da conta") },
  {
    id: "colunas valor (R$) / saldo (R$)",
    peso: 2,
    teste: (t) => t.includes("valor (r$)") && t.includes("saldo (r$)"),
  },
  { id: "REND PAGO APLIC AUT MAIS", peso: 2, teste: (t) => t.includes("rend pago aplic aut") },
  { id: "PIX TRANSF", peso: 1, teste: (t) => t.includes("pix transf") },
  {
    id: "marca Itaú / banco 341",
    peso: 3,
    teste: (t) => /\bitau\b/.test(t) || /\bbanco\s*341\b/.test(t),
  },
];

export type ItauDetection = {
  detectedBank: "ITAU" | "UNKNOWN";
  confidence: number;
  score: number;
  matchedSignals: string[];
};

/** Pontuação Itaú: só sinais específicos do layout/marca contam. */
export function scoreItauBankStatement(textos: string[]): {
  score: number;
  matchedSignals: string[];
} {
  const t = plano(textos.join(" "));
  const matched = SINAIS_ITAU.filter((s) => s.teste(t));
  return {
    score: matched.reduce((a, s) => a + s.peso, 0),
    matchedSignals: matched.map((s) => s.id),
  };
}

/** Detecção por múltiplos sinais — nunca depende só da palavra "Itaú". */
export function detectItauBankStatement(textos: string[]): ItauDetection {
  const { score, matchedSignals } = scoreItauBankStatement(textos);
  const total = SINAIS_ITAU.reduce((a, s) => a + s.peso, 0);
  return {
    detectedBank: score >= 4 ? "ITAU" : "UNKNOWN",
    confidence: Number(Math.min(1, score / total).toFixed(2)),
    score,
    matchedSignals,
  };
}


/** Compatibilidade: roteamento booleano usado pelo leitor genérico. */
export function isItauBankStatement(textos: string[]) {
  return detectItauBankStatement(textos).detectedBank === "ITAU";
}

// ------------------------------------------------------- colunas e montagem

export type ItauItem = { text: string; x: number; y: number; width: number; page: number };

export type ItauColumns = {
  valorX: number;
  saldoX: number;
  /** X a partir do qual um número é SALDO, não valor. */
  limite: number;
  /** X mínimo para um número ser considerado da coluna valor. */
  valorMinX: number;
  source: "HEADER" | "CLUSTER" | "PADRAO";
};

const centro = (i: { x: number; width?: number }) => i.x + Math.max(0, i.width ?? 0) / 2;

/**
 * Descobre as colunas "valor (R$)" e "saldo (R$)": primeiro pelo cabeçalho
 * impresso, depois pelos dois agrupamentos de X dos números da página.
 */
export function detectarColunasItau(itens: ItauItem[], pageWidth = 595): ItauColumns | null {
  const valorHeader = itens.find((i) => plano(i.text).startsWith("valor"));
  const saldoHeader = itens.find(
    (i) =>
      plano(i.text).startsWith("saldo (") ||
      (plano(i.text).startsWith("saldo") &&
        !!valorHeader &&
        Math.abs(i.y - valorHeader.y) <= Y_TOLERANCIA_ITAU &&
        i.x > valorHeader.x),
  );
  if (valorHeader && saldoHeader && saldoHeader.x > valorHeader.x) {
    const valorX = centro(valorHeader);
    const saldoX = centro(saldoHeader);
    return {
      valorX,
      saldoX,
      limite: (valorX + saldoX) / 2,
      valorMinX: valorX - (saldoX - valorX),
      source: "HEADER",
    };
  }

  const numeros = itens.filter((i) => valorDaCelula(i.text) !== null).map(centro).sort((a, b) => a - b);
  if (numeros.length >= 4) {
    let corte = -1;
    let maiorGap = 0;
    for (let i = 0; i < numeros.length - 1; i++) {
      const gap = (numeros[i + 1] as number) - (numeros[i] as number);
      if (gap > maiorGap && gap >= 25) {
        maiorGap = gap;
        corte = i;
      }
    }
    if (corte >= 0) {
      const esquerda = numeros.slice(0, corte + 1);
      const direita = numeros.slice(corte + 1);
      const media = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
      const valorX = media(esquerda);
      const saldoX = media(direita);
      return {
        valorX,
        saldoX,
        limite: (numeros[corte] as number) + maiorGap / 2,
        valorMinX: valorX - (saldoX - valorX) * 1.5,
        source: "CLUSTER",
      };
    }
  }

  if (!pageWidth) return null;
  const valorX = pageWidth * 0.72;
  const saldoX = pageWidth * 0.9;
  return { valorX, saldoX, limite: (valorX + saldoX) / 2, valorMinX: pageWidth * 0.5, source: "PADRAO" };
}

/** Linha do extrato já resolvida em colunas. */
export type ItauRow = {
  page: number;
  y: number;
  date: string | null;
  description: string;
  amount: number | null;
  balance: number | null;
  raw: string;
};

function montarRow(
  cells: PdfCell[],
  page: number,
  y: number,
  colunas: ItauColumns | null,
  anoBase: number,
): ItauRow {
  const ordenadas = [...cells].sort((a, b) => a.x - b.x).filter((c) => c.text.trim());
  const raw = ordenadas.map((c) => c.text.trim()).join(" ").replace(/\s+/g, " ").trim();

  let date: string | null = null;
  let amount: number | null = null;
  let balance: number | null = null;
  const descricao: string[] = [];

  for (const cell of ordenadas) {
    const texto = cell.text.replace(/\s+/g, " ").trim();
    if (!texto) continue;

    const numero = valorDaCelula(texto);
    if (numero !== null) {
      const x = centro(cell);
      if (!colunas) {
        // Sem geometria confiável: o número mais à direita é o saldo.
        if (amount === null) amount = numero;
        else balance = numero;
        continue;
      }
      if (x >= colunas.limite) balance = numero;
      else if (x >= colunas.valorMinX) amount = numero;
      else descricao.push(texto);
      continue;
    }

    const iso = isoCelula(texto, anoBase);
    if (iso && date === null && descricao.length === 0) {
      date = iso;
      continue;
    }
    descricao.push(texto);
  }

  return {
    page,
    y,
    date,
    description: descricao.join(" ").replace(/\s+/g, " ").trim(),
    amount,
    balance,
    raw,
  };
}

/**
 * Monta as linhas do extrato agrupando os itens do pdf.js pela coordenada Y.
 * Nunca usa o divisor de duas colunas — no extrato ele quebra a tabela.
 */
export function assembleItauRows(
  itens: ItauItem[],
  colunas: ItauColumns | null,
  anoBase: number,
): ItauRow[] {
  const ordenados = [...itens]
    .filter((i) => i.text.trim())
    .sort((a, b) => (a.page - b.page) || b.y - a.y || a.x - b.x);

  const rows: ItauRow[] = [];
  let bucket: ItauItem[] = [];
  let refY: number | null = null;
  let refPage: number | null = null;

  const fechar = () => {
    if (!bucket.length) return;
    const page = bucket[0]!.page;
    const y = bucket[0]!.y;
    const cells: PdfCell[] = bucket.map((i) => ({ x: i.x, width: i.width, text: i.text }));
    const row = montarRow(cells, page, y, colunas, anoBase);
    if (row.raw) rows.push(row);
    bucket = [];
  };

  for (const item of ordenados) {
    if (refPage !== item.page || refY === null || Math.abs(refY - item.y) > Y_TOLERANCIA_ITAU) {
      fechar();
      refPage = item.page;
      refY = item.y;
    }
    bucket.push(item);
  }
  fechar();
  return rows;
}

// -------------------------------------------------------------- diagnóstico

export type ItauPipelineDiagnostics = {
  detection: ItauDetection;
  period: { periodStart: string | null; periodEnd: string | null };
  columns: ItauColumns | null;
  rawItems: number;
  assembledRows: number;
  parsedTransactions: number;
  parsedCheckpoints: number;
  openingBalance: { amount: number | null; date: string | null };
  referenceBalance: { amount: number | null; date: string | null };
  validation: { status: "PASS" | "FAIL"; errors: string[] };
  rows: ItauRow[];
};

// ------------------------------------------------------------------- parser

function interpretar(
  rows: ItauRow[],
  textos: string[],
  colunas: ItauColumns | null,
  rawItems: number,
  detection: ItauDetection,
): ParsedBankStatement & { pipeline: ItauPipelineDiagnostics } {
  // 1. PERÍODO — sempre declarado pelo documento.
  const periodoTexto = textos.map((t) => t.match(PERIODO_RE)).find(Boolean);
  const periodoInicio = periodoTexto?.[1] ? isoBr(periodoTexto[1]) : null;
  const periodoFim = periodoTexto?.[2] ? isoBr(periodoTexto[2]) : null;

  const movimentos: ParsedBankMovement[] = [];
  const aceitos: ParsedBankStatement["aceitos"] = [];
  const rejeitados: ParsedBankStatement["rejeitados"] = [];
  const saldosLidos: ParsedBalanceCheckpoint[] = [];

  let ultimaData: string | null = null;

  for (const row of rows) {
    if (row.date) ultimaData = row.date;
    const data = row.date ?? ultimaData;

    // 2. CHECKPOINT: "SALDO DO DIA" — nunca vira transação.
    if (ehLinhaDeSaldo(row.description)) {
      const saldo = row.balance ?? row.amount;
      if (data && saldo !== null) saldosLidos.push({ data, saldo, rotulo: row.description });
      rejeitados.push({
        raw: row.raw,
        valor: saldo,
        page: row.page,
        reason: "BALANCE_CHECKPOINT — saldo do dia, não é movimentação",
      });
      continue;
    }

    if (row.amount === null || row.amount === 0) {
      rejeitados.push({
        raw: row.raw,
        valor: row.amount,
        page: row.page,
        reason: row.balance !== null ? "somente coluna de saldo" : "sem valor de lançamento",
      });
      continue;
    }
    if (!row.description || row.description.length < 3) {
      rejeitados.push({ raw: row.raw, valor: row.amount, page: row.page, reason: "sem descrição reconhecível" });
      continue;
    }
    if (!data) {
      rejeitados.push({ raw: row.raw, valor: row.amount, page: row.page, reason: "sem data contábil" });
      continue;
    }

    const { tipo, semantica } = classificarItau(row.description);
    movimentos.push({
      data,
      descricaoOriginal: row.description,
      descricaoNormalizada: normalizeDescricao(row.description),
      valor: row.amount,
      tipo: tipo === "OUTRO" ? (row.amount >= 0 ? "ENTRADA" : "SAIDA") : tipo,
      semantica,
    });
    aceitos.push({ raw: row.raw, valor: row.amount, page: row.page });
  }

  const ordenados = [...saldosLidos].sort((a, b) => a.data.localeCompare(b.data));

  // 3/4. Abertura = último saldo anterior ao período; saldo posterior ao
  // período é referência do documento (saldo atual), nunca checkpoint.
  const anteriores = periodoInicio ? ordenados.filter((c) => c.data < periodoInicio) : [];
  const posteriores = periodoFim ? ordenados.filter((c) => c.data > periodoFim) : [];
  const doPeriodo = ordenados.filter(
    (c) => (!periodoInicio || c.data >= periodoInicio) && (!periodoFim || c.data <= periodoFim),
  );

  const abertura = anteriores.length ? anteriores[anteriores.length - 1]! : null;
  const referencia = posteriores.length ? posteriores[posteriores.length - 1]! : null;

  // Um checkpoint por dia: o último saldo impresso do dia é o que vale.
  const checkpoints: ParsedBalanceCheckpoint[] = [
    ...new Map(doPeriodo.map((c) => [c.data, c])).values(),
  ]
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((c) => ({ ...c, tipo: "DAILY" as const }));

  // Último saldo REALMENTE impresso dentro do período (histórico).
  const ultimoCheckpointHistorico = checkpoints.length
    ? { data: checkpoints[checkpoints.length - 1]!.data, saldo: checkpoints[checkpoints.length - 1]!.saldo }
    : null;

  // Fechamento: mesmo valor, mas ancorado no fim do período declarado.
  // Nenhum checkpoint DAILY é inventado nessa data.
  const saldoFinal = ultimoCheckpointHistorico?.saldo ?? null;
  const saldoFinalData = ultimoCheckpointHistorico
    ? periodoFim ?? ultimoCheckpointHistorico.data
    : null;
  const saldoFinalDerivado =
    !!ultimoCheckpointHistorico && !!periodoFim && periodoFim !== ultimoCheckpointHistorico.data;

  const dentroDoPeriodo = (d: string | null) =>
    !!d && (!periodoInicio || d >= periodoInicio) && (!periodoFim || d <= periodoFim);

  const realizados = movimentos.filter((m) => dentroDoPeriodo(m.data));
  for (const m of movimentos.filter((m) => !dentroDoPeriodo(m.data))) {
    rejeitados.push({
      raw: m.descricaoOriginal,
      valor: m.valor,
      page: null,
      reason: "fora do período de visualização declarado no documento",
    });
  }

  const buscar = (re: RegExp) => {
    for (const linha of textos) {
      const m = linha.match(re);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  };

  // 5. Conferência matemática por checkpoint — só diagnostica, não corrige.
  const erros: string[] = [];
  if (!periodoInicio || !periodoFim) erros.push("Período de visualização não encontrado.");
  if (!realizados.length) erros.push("Nenhuma movimentação reconhecida no período.");
  if (abertura === null) erros.push("Saldo de abertura (saldo do dia anterior ao período) não encontrado.");
  const round = (n: number) => Number(n.toFixed(2));
  if (abertura) {
    for (const c of checkpoints) {
      const soma = realizados.filter((m) => (m.data ?? "") <= c.data).reduce((a, m) => a + m.valor, 0);
      const calculado = round(abertura.saldo + soma);
      if (round(calculado - c.saldo) !== 0)
        erros.push(`Saldo do dia ${c.data}: documento ${c.saldo} × calculado ${calculado}.`);
    }
  }

  const pipeline: ItauPipelineDiagnostics = {
    detection,
    period: { periodStart: periodoInicio, periodEnd: periodoFim },
    columns: colunas,
    rawItems,
    assembledRows: rows.length,
    parsedTransactions: realizados.length,
    parsedCheckpoints: checkpoints.length,
    openingBalance: { amount: abertura?.saldo ?? null, date: abertura?.data ?? null },
    referenceBalance: { amount: referencia?.saldo ?? null, date: referencia?.data ?? null },
    validation: { status: erros.length ? "FAIL" : "PASS", errors: erros },
    rows,
  };

  return {
    parser: ITAU_BANK_PARSER_ID,
    // Identidade temporal: SOMENTE "período de visualização".
    periodoInicio,
    periodoFim,
    saldoInicial: abertura?.saldo ?? null,
    saldoFinal,
    saldoReferenciaAtual: referencia ? { data: referencia.data, saldo: referencia.saldo } : null,
    movimentos: realizados,
    checkpoints,
    futuros: [],
    identificacao: {
      banco: "Itaú",
      agencia: buscar(/ag[êe]ncia[:\s]+(\d{3,5})/i),
      conta: buscar(/conta[:\s]+([\d.\-/]{5,20})/i),
      titular: buscar(/(?:titular|cliente)[:\s]+([A-Za-zÀ-ÿ' .]{4,60})/i),
    },
    aceitos,
    rejeitados,
    pipeline,
  };
}

/** Entrada oficial: itens crus do pdf.js (sem o divisor de duas colunas). */
export function parseItauBankStatementLayouts(
  pages: PdfPageLayout[],
): ParsedBankStatement & { pipeline: ItauPipelineDiagnostics } {
  const itens: ItauItem[] = pages.flatMap((p) =>
    p.items
      .filter((i) => i.text.trim())
      .map((i) => ({ text: i.text, x: i.x, y: i.y, width: i.width, page: p.page })),
  );
  const larguraPagina = pages[0]?.width ?? 595;
  const colunas = detectarColunasItau(itens, larguraPagina);

  // Ano base só é usado em datas sem ano (DD/MM); o período manda sempre.
  const textoPreliminar = assembleItauRows(itens, colunas, new Date().getFullYear()).map((r) => r.raw);
  const periodoTexto = textoPreliminar.map((t) => t.match(PERIODO_RE)).find(Boolean);
  const anoBase = periodoTexto?.[1] ? Number(periodoTexto[1].slice(6)) : new Date().getFullYear();

  const rows = assembleItauRows(itens, colunas, anoBase);
  const detection = detectItauBankStatement(rows.map((r) => r.raw));
  return interpretar(rows, rows.map((r) => r.raw), colunas, itens.length, detection);
}

/**
 * Entrada alternativa: linhas já reconstruídas (usada em testes e no
 * roteamento antigo). Cada `PdfLine` já é uma linha do extrato.
 */
export function parseItauBankStatementLines(
  linhas: PdfLine[],
): ParsedBankStatement & { pipeline: ItauPipelineDiagnostics } {
  const itens: ItauItem[] = linhas.flatMap((l) =>
    (l.cells.length ? l.cells : [{ x: 0, text: l.text }]).map((c) => ({
      text: c.text,
      x: c.x,
      y: l.y,
      width: c.width ?? 0,
      page: l.page ?? 1,
    })),
  );
  const colunas = detectarColunasItau(itens);
  const textos = linhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const periodoTexto = textos.map((t) => t.match(PERIODO_RE)).find(Boolean);
  const anoBase = periodoTexto?.[1] ? Number(periodoTexto[1].slice(6)) : new Date().getFullYear();

  const rows = linhas
    .map((l) =>
      montarRow(
        l.cells.length ? l.cells : [{ x: 0, text: l.text }],
        l.page ?? 1,
        l.y,
        colunas,
        anoBase,
      ),
    )
    .filter((r) => r.raw);

  return interpretar(rows, textos, colunas, itens.length, detectItauBankStatement(textos));
}

export async function readItauBankStatementPdf(file: Blob): Promise<ParsedBankStatement> {
  return parseItauBankStatementLayouts(await extractPdfPageLayouts(file));
}
