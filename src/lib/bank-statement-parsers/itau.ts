/**
 * Parser de EXTRATO DE CONTA CORRENTE — ITAÚ (PDF digital).
 *
 * Layout real do Itaú ("extrato conta / lançamentos"):
 *
 *   data | lançamentos | valor (R$) | saldo (R$)
 *
 * Regras próprias do Itaú — NENHUMA regra do Banco do Brasil é reaproveitada
 * (o Itaú não imprime "(+)/(-)"; o sinal vem no próprio número e a coluna
 * "saldo (R$)" é o que distingue checkpoint de lançamento):
 *
 *  - PERÍODO: vem de "período de visualização: DD/MM/AAAA até DD/MM/AAAA".
 *    Nunca da maior data encontrada no documento;
 *  - SALDO DE ABERTURA: último "SALDO DO DIA" anterior a period_start;
 *  - CHECKPOINT: linha "SALDO DO DIA" com valor na coluna saldo;
 *  - SALDO ATUAL FORA DO PERÍODO: checkpoint com data > period_end não é
 *    histórico do extrato — vira `saldoReferenciaAtual` (metadado);
 *  - TRANSAÇÃO: linha com data + descrição + valor na coluna "valor (R$)"
 *    (sem valor na coluna saldo).
 *
 * Nada aqui persiste nem cria ajuste: divergência é mostrada, nunca corrigida.
 */
import { extractPdfLines, parseValorBr, type PdfCell, type PdfLine } from "@/lib/pdf-extract";
import { normalizeDescricao, semAcento } from "@/lib/card-statement-parsers/generic";
import type {
  BankMovementKind,
  ParsedBalanceCheckpoint,
  ParsedBankMovement,
  ParsedBankStatement,
  StatementSemanticKind,
} from "@/lib/bank-statements/types";

export const ITAU_BANK_PARSER_ID = "ITAU_BANK_STATEMENT";

const VALOR_RE = /^-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\s?\d+,\d{2}$/;
const DATA_CELULA = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/;
const PERIODO_RE =
  /per[ií]odo\s+de\s+visualiza[cç][aã]o[:\s]*([0-3]\d\/[01]\d\/\d{4})\s*(?:at[eé]|a|-)\s*([0-3]\d\/[01]\d\/\d{4})/i;

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
  return limpo.trim().startsWith("-") ? -abs : abs;
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

/**
 * É um extrato Itaú? Reconhecemos pelo cabeçalho do documento e pela estrutura
 * de colunas "lançamentos / valor (R$) / saldo (R$)".
 */
export function isItauBankStatement(textos: string[]) {
  const t = plano(textos.join(" "));
  const marca =
    t.includes("itau") || t.includes("itaú") || /\bbanco\s*341\b/.test(t) || t.includes("itau.com");
  const estrutura =
    (t.includes("lancamentos") || t.includes("extrato conta")) &&
    t.includes("saldo (r$)") &&
    t.includes("valor (r$)");
  const saldoDoDia = textos.filter((l) => plano(l).includes("saldo do dia")).length >= 2;
  if (estrutura) return true;
  return marca && saldoDoDia;
}

/**
 * Descobre o X das colunas "valor (R$)" e "saldo (R$)" pelo cabeçalho impresso.
 * Sem cabeçalho, usa o agrupamento dos números à direita: a coluna mais à
 * direita é o saldo.
 */
function detectarColunas(linhas: PdfLine[]): { valorX: number; saldoX: number } | null {
  for (const linha of linhas) {
    const cabecalho = plano(linha.text);
    if (!cabecalho.includes("saldo")) continue;
    const valorCell = linha.cells.find((c) => plano(c.text).startsWith("valor"));
    const saldoCell = linha.cells.find((c) => plano(c.text).startsWith("saldo"));
    if (valorCell && saldoCell && saldoCell.x > valorCell.x) {
      return { valorX: valorCell.x, saldoX: saldoCell.x };
    }
  }

  const xs = linhas
    .flatMap((l) => l.cells)
    .filter((c) => valorDaCelula(c.text) !== null)
    .map((c) => c.x)
    .sort((a, b) => a - b);
  if (xs.length < 2) return null;
  const maiorX = xs[xs.length - 1]!;
  const anteriores = xs.filter((x) => maiorX - x > 20);
  if (!anteriores.length) return null;
  return { valorX: anteriores[anteriores.length - 1]!, saldoX: maiorX };
}

type LinhaLida = {
  data: string | null;
  descricao: string;
  valor: number | null;
  saldo: number | null;
  raw: string;
  page: number | null;
};

/** Separa cada linha nas quatro colunas do extrato Itaú. */
function lerLinha(
  linha: PdfLine,
  colunas: { valorX: number; saldoX: number } | null,
  anoBase: number,
): LinhaLida {
  const raw = linha.text.replace(/\s+/g, " ").trim();
  const cells: PdfCell[] = linha.cells.length ? linha.cells : [{ x: 0, text: raw }];
  const meioValorSaldo = colunas ? (colunas.valorX + colunas.saldoX) / 2 : Number.POSITIVE_INFINITY;

  let data: string | null = null;
  let valor: number | null = null;
  let saldo: number | null = null;
  const descricao: string[] = [];

  for (const cell of cells) {
    const texto = cell.text.replace(/\s+/g, " ").trim();
    if (!texto) continue;
    const numero = valorDaCelula(texto);
    if (numero !== null) {
      if (cell.x >= meioValorSaldo) saldo = numero;
      else valor = numero;
      continue;
    }
    const iso = isoCelula(texto, anoBase);
    if (iso && data === null && descricao.length === 0) {
      data = iso;
      continue;
    }
    descricao.push(texto);
  }

  // Sem cabeçalho de colunas: dois números na linha = valor + saldo.
  if (!colunas) {
    const numeros = cells
      .map((c) => valorDaCelula(c.text.trim()))
      .filter((n): n is number => n !== null);
    if (numeros.length >= 2) {
      valor = numeros[numeros.length - 2]!;
      saldo = numeros[numeros.length - 1]!;
    }
  }

  return {
    data,
    descricao: descricao.join(" ").replace(/\s+/g, " ").trim(),
    valor,
    saldo,
    raw,
    page: linha.page ?? null,
  };
}

/** Interpreta as linhas já reconstruídas do PDF do Itaú. */
export function parseItauBankStatementLines(linhas: PdfLine[]): ParsedBankStatement {
  const textos = linhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const colunas = detectarColunas(linhas);

  // 1. PERÍODO — sempre declarado pelo documento.
  const periodoTexto = textos.map((t) => t.match(PERIODO_RE)).find(Boolean);
  const periodoInicio = periodoTexto?.[1] ? isoBr(periodoTexto[1]) : null;
  const periodoFim = periodoTexto?.[2] ? isoBr(periodoTexto[2]) : null;
  const anoBase = periodoInicio ? Number(periodoInicio.slice(0, 4)) : new Date().getFullYear();

  const movimentos: ParsedBankMovement[] = [];
  const aceitos: ParsedBankStatement["aceitos"] = [];
  const rejeitados: ParsedBankStatement["rejeitados"] = [];
  const saldosLidos: ParsedBalanceCheckpoint[] = [];

  let ultimaData: string | null = null;

  for (const linha of linhas) {
    const lida = lerLinha(linha, colunas, anoBase);
    if (!lida.raw) continue;
    if (lida.data) ultimaData = lida.data;
    const data = lida.data ?? ultimaData;

    // 2. CHECKPOINT: "SALDO DO DIA" com valor na coluna saldo. Nunca transação.
    if (ehLinhaDeSaldo(lida.descricao)) {
      const saldo = lida.saldo ?? lida.valor;
      if (data && saldo !== null) {
        saldosLidos.push({ data, saldo, rotulo: lida.descricao });
      }
      rejeitados.push({
        raw: lida.raw,
        valor: saldo,
        page: lida.page,
        reason: "BALANCE_CHECKPOINT — saldo do dia, não é movimentação",
      });
      continue;
    }

    if (lida.valor === null || lida.valor === 0) {
      rejeitados.push({
        raw: lida.raw,
        valor: lida.valor,
        page: lida.page,
        reason: lida.saldo !== null ? "somente coluna de saldo" : "sem valor de lançamento",
      });
      continue;
    }

    if (!lida.descricao || lida.descricao.length < 3) {
      rejeitados.push({
        raw: lida.raw,
        valor: lida.valor,
        page: lida.page,
        reason: "sem descrição reconhecível",
      });
      continue;
    }

    if (!data) {
      rejeitados.push({
        raw: lida.raw,
        valor: lida.valor,
        page: lida.page,
        reason: "sem data contábil",
      });
      continue;
    }

    const { tipo, semantica } = classificarItau(lida.descricao);
    movimentos.push({
      data,
      descricaoOriginal: lida.descricao,
      descricaoNormalizada: normalizeDescricao(lida.descricao),
      valor: lida.valor,
      tipo: tipo === "OUTRO" ? (lida.valor >= 0 ? "ENTRADA" : "SAIDA") : tipo,
      semantica,
    });
    aceitos.push({ raw: lida.raw, valor: lida.valor, page: lida.page });
  }

  const ordenados = [...saldosLidos].sort((a, b) => a.data.localeCompare(b.data));

  // 3/4. Abertura = último saldo anterior ao período; saldo fora do período =
  // referência do documento (saldo atual), nunca checkpoint histórico.
  const anteriores = periodoInicio ? ordenados.filter((c) => c.data < periodoInicio) : [];
  const posteriores = periodoFim ? ordenados.filter((c) => c.data > periodoFim) : [];
  const doPeriodo = ordenados.filter(
    (c) =>
      (!periodoInicio || c.data >= periodoInicio) && (!periodoFim || c.data <= periodoFim),
  );

  const saldoInicial = anteriores.length ? anteriores[anteriores.length - 1]!.saldo : null;
  const saldoReferenciaAtual = posteriores.length
    ? {
        data: posteriores[posteriores.length - 1]!.data,
        saldo: posteriores[posteriores.length - 1]!.saldo,
      }
    : null;

  // Um checkpoint por dia: o último saldo impresso do dia é o que vale.
  const checkpoints = [...new Map(doPeriodo.map((c) => [c.data, c])).values()].sort((a, b) =>
    a.data.localeCompare(b.data),
  );
  const saldoFinal = checkpoints.length ? checkpoints[checkpoints.length - 1]!.saldo : null;

  const dentroDoPeriodo = (d: string | null) =>
    !!d && (!periodoInicio || d >= periodoInicio) && (!periodoFim || d <= periodoFim);

  const realizados = movimentos.filter((m) => dentroDoPeriodo(m.data));
  const foraDoPeriodo = movimentos.filter((m) => !dentroDoPeriodo(m.data));
  for (const m of foraDoPeriodo) {
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

  return {
    parser: ITAU_BANK_PARSER_ID,
    periodoInicio: periodoInicio ?? realizados[0]?.data ?? null,
    periodoFim: periodoFim ?? realizados[realizados.length - 1]?.data ?? null,
    saldoInicial,
    saldoFinal,
    saldoReferenciaAtual,
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
  };
}

export async function readItauBankStatementPdf(file: Blob): Promise<ParsedBankStatement> {
  return parseItauBankStatementLines(await extractPdfLines(file));
}
