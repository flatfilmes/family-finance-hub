/**
 * Parser de EXTRATO DE CONTA CORRENTE — BANCO DO BRASIL (PDF digital).
 *
 * Regras vindas do layout real do BB:
 *  - o sinal é impresso pelo próprio banco como "(+)" ou "(-)": ele é a única
 *    fonte de verdade. Nunca inferimos sinal pela descrição;
 *  - "Saldo Anterior", "Saldo do dia", "S A L D O" e "Saldo" são CONTROLE DE
 *    SALDO (metadata), nunca movimentação;
 *  - a seção "Lançamentos Futuros" fica separada em `futuros` e não entra em
 *    entradas, saídas nem no saldo realizado;
 *  - seções comerciais (limite, juros, CET, simulação, IOF de simulação) são
 *    ignoradas por completo — a seção do documento é determinante.
 *
 * Nada aqui persiste: é leitura pura, usada tanto no fluxo real quanto no
 * Modo diagnóstico PDF.
 */
import { extractPdfLines, parseValorBr, type PdfLine } from "@/lib/pdf-extract";
import { lerData, normalizeDescricao, semAcento } from "@/lib/card-statement-parsers/generic";
import type { BankMovementKind, ParsedBankMovement, ParsedBankStatement } from "@/lib/bank-statements/types";

export const BB_PARSER_ID = "EXTRATO_BANCO_DO_BRASIL_PDF";

/** Valor seguido do sinal impresso pelo banco. */
const VALOR_COM_SINAL = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*\(\s*([+-])\s*\)/;
/** Sinal impresso ANTES do valor (algumas páginas invertem a ordem das células). */
const SINAL_ANTES_DO_VALOR = /\(\s*([+-])\s*\)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;
/** Sinal isolado (quando o PDF quebra a linha antes do parêntese). */
const SINAL_SOZINHO = /^\(\s*([+-])\s*\)$/;
const DATA_INICIAL = /^(\d{2})\/(\d{2})\/(\d{4}|\d{2})/;

/** Lê valor + sinal em qualquer das duas ordens possíveis. */
function lerValorComSinal(texto: string): { valor: number; bruto: string } | null {
  const depois = texto.match(VALOR_COM_SINAL);
  if (depois) {
    const abs = Math.abs(parseValorBr(depois[1]!));
    return { valor: depois[2] === "-" ? -abs : abs, bruto: depois[0]! };
  }
  const antes = texto.match(SINAL_ANTES_DO_VALOR);
  if (antes) {
    const abs = Math.abs(parseValorBr(antes[2]!));
    return { valor: antes[1] === "-" ? -abs : abs, bruto: antes[0]! };
  }
  return null;
}



type Secao = "MOVIMENTOS" | "FUTUROS" | "METADATA";

const CABECALHOS_FUTUROS = ["lancamentos futuros", "proximos lancamentos"];
const CABECALHOS_METADATA = [
  "informacoes complementares",
  "informacoes adicionais",
  "limite especial",
  "limite contratado",
  "limite utilizado",
  "limite disponivel",
  "taxa limite especial",
  "cet",
  "simulacao",
  "valor total devido",
  "valor liberado",
  "despesas iof de simulacao",
  "tarifa de simulacao",
  "extrato de conta corrente",
];
const CABECALHOS_MOVIMENTOS = ["lancamentos", "historico", "movimentacao", "data movimento"];

/** Linhas de controle de saldo — nunca viram movimentação. */
const SALDO_METADATA = [
  "saldo anterior",
  "saldo do dia",
  "s a l d o",
  "saldo final",
  "saldo atual",
  "saldo disponivel",
  "saldo bloqueado",
  "saldo",
];

const CLASSES: Array<{ tipo: BankMovementKind; termos: string[] }> = [
  { tipo: "TARIFA", termos: ["tarifa", "cesta", "anuidade", "i.o.f", "iof", "manutencao"] },
  { tipo: "JUROS", termos: ["juros", "encargos", "mora", "multa", "cheque especial"] },
  { tipo: "ESTORNO", termos: ["estorno", "devolucao", "reembolso"] },
  { tipo: "TRANSFERENCIA", termos: ["ted ", "doc ", "transferencia", "entre contas"] },
];

function plano(texto: string) {
  return semAcento(texto).toLowerCase().replace(/\s+/g, " ").trim();
}

function ehSaldoMetadata(texto: string) {
  const t = plano(texto);
  return SALDO_METADATA.some((s) => t === s || t.startsWith(s));
}

function classificarBb(descricao: string, valor: number): BankMovementKind {
  const t = plano(descricao);
  for (const c of CLASSES) if (c.termos.some((termo) => t.includes(termo))) return c.tipo;
  return valor >= 0 ? "ENTRADA" : "SAIDA";
}

function detectarSecao(texto: string, atual: Secao): Secao {
  const t = plano(texto);
  if (CABECALHOS_FUTUROS.some((c) => t.startsWith(c))) return "FUTUROS";
  if (CABECALHOS_METADATA.some((c) => t.startsWith(c))) return "METADATA";
  if (atual !== "MOVIMENTOS" && CABECALHOS_MOVIMENTOS.some((c) => t.startsWith(c)))
    return "MOVIMENTOS";
  return atual;
}

function buscar(textos: string[], re: RegExp) {
  for (const linha of textos) {
    const m = linha.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * É um extrato do Banco do Brasil? O sinal impresso "(+)/(-)" ao lado do valor
 * é assinatura do layout BB: quando ele aparece de forma recorrente, o parser
 * dedicado é usado mesmo que a marca textual do banco não tenha sido extraída.
 */
export function isBancoDoBrasil(textos: string[]) {
  const t = plano(textos.join(" "));
  const marcaBanco =
    t.includes("banco do brasil") || t.includes("bb.com.br") || /\bbanco\s*001\b/.test(t);
  const linhasComSinal = textos.filter(
    (l) => VALOR_COM_SINAL.test(l) || SINAL_ANTES_DO_VALOR.test(l),
  ).length;
  if (marcaBanco && linhasComSinal > 0) return true;
  return linhasComSinal >= 3;
}

/** Interpreta as linhas já reconstruídas do PDF do BB. */
export function parseBancoDoBrasilLines(linhas: PdfLine[]): ParsedBankStatement {
  const textos = linhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const anoBase = new Date().getFullYear();

  const movimentos: ParsedBankMovement[] = [];
  const futuros: ParsedBankMovement[] = [];
  const aceitos: ParsedBankStatement["aceitos"] = [];
  const checkpoints: NonNullable<ParsedBankStatement["checkpoints"]> = [];
  const rejeitados: ParsedBankStatement["rejeitados"] = [];


  let secao: Secao = "MOVIMENTOS";
  let ultimaData: string | null = null;
  let saldoInicial: number | null = null;
  let saldoFinal: number | null = null;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;
    const raw = linha.text.replace(/\s+/g, " ").trim();
    if (!raw) continue;

    secao = detectarSecao(raw, secao);

    // Valor + sinal podem estar na mesma linha ou o sinal na linha seguinte.
    let alvo = raw;
    const proxima = linhas[i + 1]?.text.trim() ?? "";
    if (!lerValorComSinal(alvo) && SINAL_SOZINHO.test(proxima)) alvo = `${raw} ${proxima}`;

    const lido = lerValorComSinal(alvo);
    if (!lido) {
      rejeitados.push({
        raw,
        valor: null,
        page: linha.page ?? null,
        reason: secao === "METADATA" ? "área informativa / comercial" : "sem valor com sinal",
      });
      continue;
    }

    const valor = lido.valor;

    // Data: a da própria linha ou a última data vista no bloco.
    const comData = DATA_INICIAL.test(raw);
    const { data, resto } = comData ? lerData(raw, anoBase) : { data: null, resto: raw };
    if (data) ultimaData = data;

    const descricao = resto
      .replace(lido.bruto, " ")
      .replace(VALOR_COM_SINAL, " ")
      .replace(SINAL_ANTES_DO_VALOR, " ")
      .replace(/\(\s*[+-]\s*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();



    if (ehSaldoMetadata(descricao)) {
      const t = plano(descricao);
      if (t.startsWith("saldo anterior")) saldoInicial = valor;
      else saldoFinal = valor;
      // Saldo do dia é CHECKPOINT de conferência — nunca vira movimentação.
      const dataCheck = data ?? ultimaData;
      if (dataCheck && !t.startsWith("saldo anterior")) {
        checkpoints.push({ data: dataCheck, saldo: valor, rotulo: descricao });
      }
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "BALANCE_METADATA — controle de saldo, não é movimentação",
      });
      continue;
    }


    if (secao === "METADATA") {
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "seção informativa (limite / juros / CET / simulação)",
      });
      continue;
    }

    if (!descricao || descricao.length < 3) {
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "sem descrição reconhecível",
      });
      continue;
    }

    const movimento: ParsedBankMovement = {
      data: data ?? ultimaData,
      descricaoOriginal: descricao,
      descricaoNormalizada: normalizeDescricao(descricao),
      valor,
      tipo: classificarBb(descricao, valor),
    };

    if (secao === "FUTUROS") {
      futuros.push(movimento);
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "lançamento futuro — não entra no período realizado",
      });
      continue;
    }

    movimentos.push(movimento);
    aceitos.push({ raw, valor, page: linha.page ?? null });
  }

  // Saldo final impresso no resumo, quando existir rótulo explícito.
  const saldoRotulado = (() => {
    for (const linha of textos) {
      const t = plano(linha);
      if (!/^saldo\b/.test(t) || t.startsWith("saldo anterior") || t.startsWith("saldo do dia"))
        continue;
      const m = linha.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
      if (m?.length) return parseValorBr(m[m.length - 1]!);
    }
    return null;
  })();

  const datas = movimentos.map((m) => m.data).filter((d): d is string => !!d).sort();

  return {
    parser: BB_PARSER_ID,
    periodoInicio: datas[0] ?? null,
    periodoFim: datas[datas.length - 1] ?? null,
    saldoInicial,
    saldoFinal: saldoFinal ?? saldoRotulado,
    movimentos,
    futuros,
    identificacao: {
      banco: "Banco do Brasil",
      agencia: buscar(textos, /ag[êe]ncia[:\s]+([\d.\-]{3,10})/i),
      conta: buscar(textos, /conta(?:\s+corrente)?[:\s]+([\d.\-/]{4,20})/i),
      titular: buscar(textos, /(?:titular|cliente)[:\s]+([A-Za-zÀ-ÿ' .]{4,60})/i),
    },
    aceitos,
    rejeitados,
  };
}

export async function readBancoDoBrasilPdf(file: Blob): Promise<ParsedBankStatement> {
  return parseBancoDoBrasilLines(await extractPdfLines(file));
}
