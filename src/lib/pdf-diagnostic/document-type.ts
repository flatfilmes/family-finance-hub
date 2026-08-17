/**
 * DETECÇÃO DO TIPO ECONÔMICO DO DOCUMENTO (antes de qualquer parser).
 *
 * Um mesmo banco emite documentos economicamente diferentes: extrato de conta,
 * fatura de cartão, boleto, comprovante. Detectar a INSTITUIÇÃO nunca pode
 * escolher o parser econômico — por isso esta etapa roda ANTES da detecção de
 * banco e do roteamento:
 *
 *   PDF → pdf.js → visualRows → DOCUMENT_TYPE_DETECTION → BANK_DETECTION →
 *   PARSER_SELECTION → PARSER → VALIDATOR
 *
 * Função pura: só lê texto, não persiste nada e não altera nenhum parser.
 */

export type DocumentType =
  | "BANK_STATEMENT"
  | "CREDIT_CARD_STATEMENT"
  | "RECEIPT"
  | "UNKNOWN";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  BANK_STATEMENT: "Extrato bancário",
  CREDIT_CARD_STATEMENT: "Fatura de cartão de crédito",
  RECEIPT: "Nota fiscal / cupom",
  UNKNOWN: "Não reconhecido",
};

export type DocumentTypeScore = {
  type: DocumentType;
  score: number;
  matchedSignals: string[];
};

export type DocumentTypeDetection = {
  status: "PASS" | "FAILED";
  type: DocumentType;
  score: number;
  matchedSignals: string[];
  scores: DocumentTypeScore[];
  reason: string;
};

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

type Sinal = { termo: string; peso: number };

/** Sinais inequívocos de FATURA DE CARTÃO (resumo, limites, opções de pagamento). */
const SINAIS_CARTAO: Sinal[] = [
  { termo: "RESUMO DA FATURA", peso: 5 },
  { termo: "TOTAL DESTA FATURA", peso: 5 },
  { termo: "LANCAMENTOS: COMPRAS E SAQUES", peso: 5 },
  { termo: "TOTAL DA FATURA ANTERIOR", peso: 4 },
  { termo: "PARCELAMENTO DA FATURA", peso: 4 },
  { termo: "PAGAMENTO MINIMO", peso: 4 },
  { termo: "LIMITE TOTAL DE CREDITO", peso: 4 },
  { termo: "PREVISAO PROX. FECHAMENTO", peso: 4 },
  { termo: "O TOTAL DA SUA FATURA E", peso: 4 },
  { termo: "PARCELAS FIXAS", peso: 3 },
  { termo: "LANCAMENTOS ATUAIS", peso: 3 },
  { termo: "PAGAMENTO EFETUADO EM", peso: 3 },
  { termo: "ESTABELECIMENTO", peso: 2 },
  { termo: "CARTAO", peso: 2 },
];

/** Sinais inequívocos de EXTRATO DE CONTA (saldos e colunas de saldo). */
const SINAIS_EXTRATO: Sinal[] = [
  { termo: "EXTRATO CONTA", peso: 5 },
  { termo: "EXTRATO DE CONTA", peso: 5 },
  { termo: "EXTRATO DE CONTA CORRENTE", peso: 5 },
  { termo: "PERIODO DE VISUALIZACAO", peso: 4 },
  { termo: "SALDO DO DIA", peso: 4 },
  { termo: "SALDO ANTERIOR", peso: 4 },
  { termo: "SALDO INVESTIMENTOS", peso: 2 },
];

const SINAIS_NOTA: Sinal[] = [
  { termo: "DANFE", peso: 5 },
  { termo: "NOTA FISCAL ELETRONICA", peso: 5 },
  { termo: "CUPOM FISCAL ELETRONICO", peso: 5 },
  { termo: "NFC-E", peso: 4 },
  { termo: "CHAVE DE ACESSO", peso: 3 },
  { termo: "CONSUMIDOR NAO IDENTIFICADO", peso: 3 },
];

/** Cabeçalho de colunas típico do extrato: data + lançamentos + valor + saldo. */
const COLUNAS_EXTRATO = ["DATA", "VALOR", "SALDO"];

function pontuar(linhas: string[], sinais: Sinal[]): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;
  for (const s of sinais) {
    if (linhas.some((l) => l.includes(s.termo))) {
      score += s.peso;
      matched.push(`${s.termo} (+${s.peso})`);
    }
  }
  return { score, matched };
}

/** Classificação econômica do documento — nunca decide pelo nome do banco. */
export function detectDocumentType(textos: string[]): DocumentTypeDetection {
  const linhas = textos.map(normalizar).filter(Boolean);

  const cartao = pontuar(linhas, SINAIS_CARTAO);
  const extrato = pontuar(linhas, SINAIS_EXTRATO);
  const nota = pontuar(linhas, SINAIS_NOTA);

  const temColunas = linhas.some(
    (l) =>
      COLUNAS_EXTRATO.every((c) => l.includes(c)) &&
      (l.includes("LANCAMENTO") || l.includes("HISTORICO") || l.includes("DESCRICAO")),
  );
  if (temColunas) {
    extrato.score += 5;
    extrato.matched.push("COLUNAS DATA/LANCAMENTOS/VALOR/SALDO (+5)");
  }

  const scores: DocumentTypeScore[] = [
    { type: "CREDIT_CARD_STATEMENT", score: cartao.score, matchedSignals: cartao.matched },
    { type: "BANK_STATEMENT", score: extrato.score, matchedSignals: extrato.matched },
    { type: "RECEIPT", score: nota.score, matchedSignals: nota.matched },
  ].sort((a, b) => b.score - a.score);

  const vencedor = scores[0]!;
  const segundo = scores[1]!;

  if (vencedor.score >= 5 && vencedor.score > segundo.score)
    return {
      status: "PASS",
      type: vencedor.type,
      score: vencedor.score,
      matchedSignals: vencedor.matchedSignals,
      scores,
      reason:
        `Tipo econômico reconhecido: ${vencedor.type} (score ${vencedor.score} × ` +
        `${segundo.type} ${segundo.score}). A marca do banco não participa desta decisão.`,
    };

  return {
    status: "FAILED",
    type: "UNKNOWN",
    score: vencedor.score,
    matchedSignals: vencedor.matchedSignals,
    scores,
    reason:
      "Nenhum tipo econômico venceu de forma inequívoca; nenhum parser específico foi selecionado.",
  };
}
