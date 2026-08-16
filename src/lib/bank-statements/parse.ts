/**
 * Leitura genérica de EXTRATO BANCÁRIO em PDF digital.
 *
 * Filosofia idêntica aos demais parsers do sistema:
 *  - nada é assumido: campo sem evidência volta null;
 *  - a descrição original é preservada exatamente como veio;
 *  - o sinal do valor é preservado (positivo entra, negativo sai);
 *  - nada é persistido aqui — a persistência só acontece após a revisão.
 *
 * A arquitetura já está preparada para CSV e OFX: basta outra função que
 * devolva `ParsedBankStatement`.
 */
import {
  extractPdfPageLayouts,
  layoutPageLines,
  parseValorBr,
  type PdfLine,
} from "@/lib/pdf-extract";
import { lerData, normalizeDescricao, semAcento } from "@/lib/card-statement-parsers/generic";
import {
  isBancoDoBrasil,
  parseBancoDoBrasilLines,
} from "@/lib/bank-statement-parsers/banco-do-brasil";
import {
  isItauBankStatement,
  parseItauBankStatementLayouts,
} from "@/lib/bank-statement-parsers/itau";
import type { BankMovementKind, ParsedBankMovement, ParsedBankStatement } from "./types";

export type DetectedBank = "BANCO_DO_BRASIL" | "ITAU" | "GENERICO";

export type BankDetectionResult = {
  status: "PASS" | "FAILED";
  bank: DetectedBank | null;
  matchedSignals: string[];
  missingSignals: string[];
  reason: string;
};

export type BankParserSelection = {
  status: "FOUND" | "NOT_FOUND";
  requestedBank: DetectedBank | null;
  name: string | null;
};

export type BankParserPipelineResult = {
  detection: BankDetectionResult;
  parser: BankParserSelection;
  parsed: ParsedBankStatement;
};

const MOEDA = /-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s?\d+,\d{2}/g;

const RUIDO = [
  "extrato",
  "pagina",
  "page",
  "cliente",
  "agencia",
  "conta corrente",
  "cnpj",
  // Linhas de controle de saldo nunca são movimentação.
  "saldo",
  "s a l d o",

  "cpf",
  "ouvidoria",
  "sac",
  "central de atendimento",
  "www",
  "banco",
  "periodo",
  "data de emissao",
  "lancamentos futuros",
  "consulte",
  "ouvidoria",
];

const CLASSES: Array<{ tipo: BankMovementKind; termos: string[] }> = [
  { tipo: "TARIFA", termos: ["tarifa", "cesta", "anuidade", "taxa de", "iof", "manutencao"] },
  { tipo: "JUROS", termos: ["juros", "encargos", "mora", "multa", "cheque especial", "rendimento"] },
  { tipo: "ESTORNO", termos: ["estorno", "devolucao", "reembolso"] },
  {
    tipo: "TRANSFERENCIA",
    termos: ["transferencia", "transf ", "ted ", "doc ", "pix transf", "entre contas"],
  },
  { tipo: "AJUSTE", termos: ["ajuste", "correcao", "saldo anterior"] },
];

/** Classificação determinística por palavra-chave; sem evidência usa o sinal. */
export function classificarMovimento(descricao: string, valor: number): BankMovementKind {
  const texto = semAcento(descricao).toLowerCase();
  for (const c of CLASSES) if (c.termos.some((t) => texto.includes(t))) return c.tipo;
  return valor >= 0 ? "ENTRADA" : "SAIDA";
}

function ehRuido(texto: string) {
  const t = semAcento(texto).toLowerCase().trim();
  if (t.length < 4) return true;
  return RUIDO.some((r) => t.startsWith(r));
}

/** Lê o valor do lançamento (último número da linha) preservando o sinal. */
function lerValorAssinado(texto: string): { valor: number | null; resto: string } {
  const achados = texto.match(MOEDA);
  if (!achados?.length) return { valor: null, resto: texto };
  const bruto = achados[achados.length - 1] as string;
  const idx = texto.lastIndexOf(bruto);
  const depois = texto.slice(idx + bruto.length).trim();
  // O sinal impresso "(+)/(-)" (layout BB e similares) é fonte de verdade.
  const sinalImpresso = depois.match(/^\(\s*([+-])\s*\)/)?.[1] ?? null;
  const negativo =
    sinalImpresso !== null
      ? sinalImpresso === "-"
      : bruto.includes("-") || /^-/.test(depois) || /^(D|DEB|DÉB)\b/i.test(depois);
  const valor = Math.abs(parseValorBr(bruto)) * (negativo ? -1 : 1);
  const resto = (
    texto.slice(0, idx) +
    " " +
    depois.replace(/^\(\s*[+-]\s*\)/, "").replace(/^(-|D|C|DEB|CRED)\b/i, "")
  ).trim();

  return { valor, resto };
}

function lerSaldoRotulado(linhas: string[], rotulos: string[]): number | null {
  for (const linha of linhas) {
    const plano = semAcento(linha).toLowerCase();
    if (!rotulos.some((r) => plano.includes(r))) continue;
    const achados = linha.match(MOEDA);
    if (achados?.length) {
      const bruto = achados[achados.length - 1] as string;
      const negativo = bruto.includes("-") || /\b(d|deb)\b\s*$/i.test(linha);
      return Math.abs(parseValorBr(bruto)) * (negativo ? -1 : 1);
    }
  }
  return null;
}

/** Interpreta as linhas já reconstruídas do PDF. */
export function parseBankStatementLines(linhas: PdfLine[]): ParsedBankStatement {
  const textos = linhas.map((l) => l.text.trim()).filter(Boolean);
  const anoBase = new Date().getFullYear();

  const movimentos: ParsedBankMovement[] = [];
  const aceitos: ParsedBankStatement["aceitos"] = [];
  const rejeitados: ParsedBankStatement["rejeitados"] = [];

  for (const linha of linhas) {
    const raw = linha.text.trim();
    if (!raw) continue;

    const { data, resto } = lerData(raw, anoBase);
    const { valor, resto: descricaoBruta } = lerValorAssinado(resto);

    if (valor === null) {
      rejeitados.push({ raw, valor: null, page: linha.page ?? null, reason: "sem valor monetário" });
      continue;
    }
    if (!data) {
      rejeitados.push({ raw, valor, page: linha.page ?? null, reason: "sem data reconhecida" });
      continue;
    }
    if (ehRuido(descricaoBruta)) {
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "linha institucional / cabeçalho",
      });
      continue;
    }
    if (valor === 0) {
      rejeitados.push({ raw, valor, page: linha.page ?? null, reason: "valor zerado" });
      continue;
    }

    const descricaoOriginal = descricaoBruta.replace(/\s+/g, " ").trim();
    movimentos.push({
      data,
      descricaoOriginal,
      descricaoNormalizada: normalizeDescricao(descricaoOriginal),
      valor,
      tipo: classificarMovimento(descricaoOriginal, valor),
    });
    aceitos.push({ raw, valor, page: linha.page ?? null });
  }

  const datas = movimentos.map((m) => m.data).filter((d): d is string => !!d).sort();

  return {
    parser: "EXTRATO_GENERICO_PDF",
    periodoInicio: datas[0] ?? null,
    periodoFim: datas[datas.length - 1] ?? null,
    saldoInicial: lerSaldoRotulado(textos, ["saldo anterior", "saldo inicial", "saldo em"]),
    saldoFinal: lerSaldoRotulado(textos, ["saldo final", "saldo atual", "saldo disponivel"]),
    movimentos,
    aceitos,
    rejeitados,
  };
}

const normalizarSinal = (texto: string) =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Detecção única usada pela importação e pelo diagnóstico, sem persistência. */
export function detectBankStatement(textos: string[]): BankDetectionResult {
  const normalizados = textos.map(normalizarSinal);
  const sinaisBB = [
    "EXTRATO DE CONTA CORRENTE",
    "PERIODO:",
    "AGENCIA:",
    "CONTA:",
    "SALDO ANTERIOR",
    "SALDO DO DIA",
  ];
  const matchedBB = sinaisBB.filter((sinal) => normalizados.some((texto) => texto.includes(sinal)));
  if (isBancoDoBrasil(textos) || matchedBB.length >= 3)
    return {
      status: "PASS",
      bank: "BANCO_DO_BRASIL",
      matchedSignals: matchedBB,
      missingSignals: sinaisBB.filter((sinal) => !matchedBB.includes(sinal)),
      reason: "Layout reconhecido pelos sinais do extrato Banco do Brasil.",
    };

  if (isItauBankStatement(textos))
    return {
      status: "PASS",
      bank: "ITAU",
      matchedSignals: ["EXTRATO ITAU"],
      missingSignals: [],
      reason: "Layout reconhecido pelo detector de extrato Itaú.",
    };

  return {
    status: "FAILED",
    bank: null,
    matchedSignals: matchedBB,
    missingSignals: sinaisBB.filter((sinal) => !matchedBB.includes(sinal)),
    reason: "Nenhum layout bancário específico foi reconhecido; parser genérico selecionado.",
  };
}

/** Pipeline puro compartilhado por Importar → Revisar e pela tela DEV. */
export async function runBankStatementParserPipeline(file: Blob): Promise<BankParserPipelineResult> {
  const pages = await extractPdfPageLayouts(file);
  const itens = pages.flatMap((p) => p.items.map((i) => i.text));
  const linhas = pages.flatMap((p) => layoutPageLines(p.items, p.width, p.page));
  const textos = [...linhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean), ...itens];
  const detection = detectBankStatement(textos);
  const requestedBank = detection.bank ?? "GENERICO";
  const parser: BankParserSelection = {
    status: "FOUND",
    requestedBank,
    name:
      requestedBank === "BANCO_DO_BRASIL"
        ? "EXTRATO_BANCO_DO_BRASIL_PDF"
        : requestedBank === "ITAU"
          ? "ITAU_BANK_STATEMENT"
          : "EXTRATO_GENERICO_PDF",
  };
  const parsed =
    requestedBank === "BANCO_DO_BRASIL"
      ? parseBancoDoBrasilLines(linhas)
      : requestedBank === "ITAU"
        ? parseItauBankStatementLayouts(pages)
        : parseBankStatementLines(linhas);
  return { detection, parser, parsed };
}

/** Lê um extrato em PDF. Usada tanto no fluxo real quanto no dry run. */
export async function readBankStatementPdf(file: Blob): Promise<ParsedBankStatement> {
  return (await runBankStatementParserPipeline(file)).parsed;
}


/** Totais apresentados na tela de revisão. */
export function resumoDoExtrato(movimentos: ParsedBankMovement[]) {
  const entradas = movimentos.filter((m) => m.valor > 0).reduce((a, m) => a + m.valor, 0);
  const saidas = movimentos.filter((m) => m.valor < 0).reduce((a, m) => a + Math.abs(m.valor), 0);
  return { entradas, saidas, quantidade: movimentos.length, resultado: entradas - saidas };
}
