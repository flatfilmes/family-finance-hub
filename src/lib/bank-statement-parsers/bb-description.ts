/**
 * MONTAGEM DA DESCRIÇÃO ECONÔMICA — extrato do Banco do Brasil.
 *
 * No PDF do BB o Histórico de um lançamento pode estar espalhado em até três
 * linhas visuais (acima, na mesma linha do valor e abaixo), enquanto a linha
 * financeira frequentemente carrega apenas as COLUNAS TÉCNICAS (Lote e
 * Documento — "13013 28308"). Essas colunas nunca são descrição: viram
 * metadata (`lot` / `documentNumber`).
 *
 * Este módulo é PURO e só produz texto: nunca toca em data contábil, valor,
 * sinal, contagem de lançamentos, checkpoints, saldos ou identidade
 * (`sourceId` é derivado da linha bruta do PDF, não daqui).
 */
import { normalizeDescricao, semAcento } from "@/lib/card-statement-parsers/generic";

/** Operações bancárias impressas pelo BB no início do Histórico. */
const OPERACOES = [
  "Pix - Enviado",
  "Pix - Recebido",
  "Pix Enviado",
  "Pix Recebido",
  "Pagamento Fatura de Água",
  "Pagamento Fatura de Agua",
  "Pagamento de Boleto",
  "Pagamento de Convenio",
  "Pagamento de Convênio",
  "Pagamento de Titulo",
  "Pagamento de Título",
  "Pagto cartão crédito",
  "Pagto cartao credito",
  "Pagamento de Salario",
  "Cobrança de I.O.F.",
  "Cobranca de I.O.F.",
  "Compra com Cartão",
  "Compra com Cartao",
  "Transferência recebida",
  "Transferencia recebida",
  "Transferência enviada",
  "Transferencia enviada",
  "Depósito",
  "Deposito",
  "Saque",
  "Estorno",
  "Rendimento",
  "Tarifa",
  "TED",
  "DOC",
];

/** Token puramente técnico (Lote / Documento / código do banco). */
const SO_NUMERO = /^\d[\d.\-]*$/;
/** Data ou data+hora citada dentro do histórico ("04/01 12:48"). */
const DATA_HORA_NO_INICIO = /^\d{2}\/\d{2}(?:\/\d{2,4})?(?:\s+\d{2}:\d{2})?\s*/;
/** Data/hora do evento em QUALQUER posição do texto — pertence ao occurredAt. */
const DATA_HORA_EM_QUALQUER_LUGAR = /\b\d{2}\/\d{2}(?:\/\d{2,4})?(?:\s+\d{2}:\d{2})?\b/g;


function plano(texto: string) {
  return semAcento(texto).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * O extrator do BB às vezes devolve a cedilha minúscula dentro de palavras
 * maiúsculas ("NET SERVIçOS"). Corrigimos só a caixa, nunca o conteúdo.
 */
function corrigirCedilha(texto: string) {
  return texto.replace(/[A-ZÀ-Þ]{2,}[çãõáéíóú][A-ZÀ-Þ]*/g, (palavra) =>
    palavra.replace(/ç/g, "Ç").replace(/ã/g, "Ã").replace(/õ/g, "Õ")
      .replace(/á/g, "Á").replace(/é/g, "É").replace(/í/g, "Í")
      .replace(/ó/g, "Ó").replace(/ú/g, "Ú"),
  );
}

function limparPedaco(texto: string) {
  return corrigirCedilha(texto.replace(/\s+/g, " ").trim());
}

/** Remove os tokens de Lote/Documento presos ao texto do histórico. */
export function removerColunasTecnicas(texto: string): string {
  return texto
    .split(/\s+/)
    .filter((token) => !SO_NUMERO.test(token))
    .join(" ")
    .trim();
}

export type DescricaoBb = {
  /** Descrição econômica apresentada ao usuário. */
  description: string;
  normalizedDescription: string;
  bankOperation: string | null;
  counterparty: string | null;
  /** Histórico bruto (com datas do evento) — alimenta o `occurredAt`. */
  historico: string;
};

/**
 * Junta os pedaços de Histórico de UM lançamento (linha anterior, mesma linha
 * e linha seguinte) e separa operação bancária × contraparte.
 */
export function montarDescricaoBb(pedacos: Array<string | null | undefined>): DescricaoBb {
  const partes = pedacos
    .map((p) => limparPedaco(p ?? ""))
    .filter(Boolean)
    .map((p) => removerColunasTecnicas(p))
    .filter(Boolean);

  const historico = partes.join(" ").replace(/\s+/g, " ").trim();
  if (!historico) {
    return {
      description: "",
      normalizedDescription: "",
      bankOperation: null,
      counterparty: null,
      historico: "",
    };
  }

  // OPERAÇÃO BANCÁRIA: prefixo impresso pelo banco. Procuramos em QUALQUER
  // posição do histórico montado — o extrator pode devolver a linha da
  // operação depois da linha da contraparte.
  const alvo = plano(historico);
  let bankOperation: string | null = null;
  let melhorPos = Number.POSITIVE_INFINITY;
  let melhorTam = 0;
  for (const operacao of OPERACOES) {
    const chave = plano(operacao);
    const pos = alvo.indexOf(chave);
    if (pos < 0) continue;
    // Menor posição vence; em empate, a operação mais específica (mais longa).
    if (pos < melhorPos || (pos === melhorPos && chave.length > melhorTam)) {
      melhorPos = pos;
      melhorTam = chave.length;
    }
  }

  let resto = historico;
  if (melhorTam > 0) {
    bankOperation = historico.slice(melhorPos, melhorPos + melhorTam).trim();
    resto = `${historico.slice(0, melhorPos)} ${historico.slice(melhorPos + melhorTam)}`.trim();
  }

  const counterparty =
    limparPedaco(
      removerColunasTecnicas(
        resto
          .replace(DATA_HORA_NO_INICIO, "")
          .replace(DATA_HORA_EM_QUALQUER_LUGAR, " ")
          .replace(/^[-–·:,.\s]+/, "")
          .replace(/\s+[.·-]{2,}\s+/g, " ")
          .replace(/\s+/g, " "),
      ),
    ) || null;

  const semDataHora = (t: string) =>
    limparPedaco(t.replace(DATA_HORA_EM_QUALQUER_LUGAR, " ").replace(/\s+/g, " "));

  const description = bankOperation
    ? [bankOperation, counterparty].filter(Boolean).join(" · ")
    : partes.length > 1
      ? partes.map(semDataHora).filter(Boolean).join(" · ")
      : semDataHora(historico);

  return {
    description,
    normalizedDescription: normalizarDescricaoBb(description),
    bankOperation,
    counterparty: bankOperation ? counterparty : null,
    historico,
  };
}

/** A linha de Histórico ABRE um lançamento (começa por operação do banco)? */
export function comecaComOperacaoBb(texto: string): boolean {
  const t = plano(texto);
  return OPERACOES.some((operacao) => t.startsWith(plano(operacao)));
}


/** Conectivos que não agregam identidade econômica à descrição normalizada. */
const CONECTIVOS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "COM", "EM", "NO", "NA"]);

/**
 * Normalização parte SEMPRE da descrição econômica — nunca de Lote/Documento.
 * Ex.: "Pagamento Fatura de Água · TUBARAO SANEAMENTO"
 *   →  "PAGAMENTO FATURA AGUA TUBARAO SANEAMENTO".
 */
export function normalizarDescricaoBb(description: string): string {
  return normalizeDescricao(description)
    .split(" ")
    .filter((token) => token && !CONECTIVOS.has(token))
    .join(" ");
}
