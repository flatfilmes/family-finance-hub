/**
 * NUBANK_PDF — parser SECTION-AWARE da fatura Nubank.
 *
 * Regra central: somente a seção "TRANSAÇÕES ... DE <dd mmm> A <dd mmm>" produz
 * lançamentos cobrados. Simulações de parcelamento, pagamento mínimo, rotativo,
 * CET, encargos futuros e limites JAMAIS viram item econômico — são metadados.
 */
import type { PdfLine } from "@/lib/pdf-extract";
import { semAcento } from "./generic";
import type {
  ParsedStatement,
  StatementEntry,
  StatementMetadata,
  StatementParser,
  StatementRejectedLine,
} from "./types";

const plano = (s: string) => semAcento(s).toLowerCase().replace(/\s+/g, " ").trim();

const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

const iso = (a: number, m: number, d: number) =>
  `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "17 AGO 2026" → 2026-08-17 (ano opcional; usa anoBase / vira do ano). */
function lerDataMes(texto: string, anoBase: number, mesFim: number | null): string | null {
  const m = plano(texto).match(/\b(\d{1,2})\s+([a-z]{3})\.?\s*(\d{4})?/);
  if (!m) return null;
  const mes = MESES[m[2] ?? ""];
  if (!mes) return null;
  const dia = Number(m[1] ?? 0);
  if (m[3]) return iso(Number(m[3]), mes, dia);
  // sem ano: se o mês é maior que o mês de fechamento, pertence ao ano anterior
  const ano = mesFim !== null && mes > mesFim ? anoBase - 1 : anoBase;
  return iso(ano, mes, dia);
}

const MOEDA = /-?\s?R?\$?\s?-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

function valorBr(raw: string): number {
  const limpo = raw.replace(/[R$\s]/g, "");
  const negativo = limpo.trim().startsWith("-");
  const n = Number(limpo.replace(/-/g, "").replace(/\./g, "").replace(",", "."));
  return negativo ? -n : n;
}

function ultimoValor(texto: string): number | null {
  const achados = texto.match(MOEDA);
  if (!achados?.length) return null;
  return valorBr(achados[achados.length - 1] ?? "");
}

// ------------------------------------------------------------------ seções

type Secao =
  | "OUTSIDE_TRANSACTION_SECTION"
  | "CURRENT_TRANSACTIONS"
  | "PAYMENTS_AND_FINANCING"
  | "SUMMARY"
  | "PAYMENT_OPTIONS"
  | "LIMITS"
  | "FUTURE_FEES";

function secaoDaLinha(texto: string): Secao | null {
  const p = plano(texto);
  if (/^transacoes\b/.test(p) || p === "transacoes") return "CURRENT_TRANSACTIONS";
  if (p.includes("pagamentos e financiamentos")) return "PAYMENTS_AND_FINANCING";
  if (
    p.includes("alternativas de pagamento") ||
    p.includes("parcele em") ||
    p.includes("parcelamento da fatura") ||
    p.includes("pagamento minimo") ||
    p.includes("credito rotativo") ||
    p.includes("rotativo")
  )
    return "PAYMENT_OPTIONS";
  if (p.includes("custo efetivo total") || p.includes("encargos e custo") || p.includes("cet"))
    return "FUTURE_FEES";
  if (p.includes("limite total") || p.includes("seus limites") || p.includes("limite disponivel"))
    return "LIMITS";
  if (p.includes("resumo da fatura") || p.includes("resumo")) return "SUMMARY";
  return null;
}

const motivoDaSecao = (s: Secao): StatementRejectedLine["motivo"] =>
  s === "PAYMENT_OPTIONS"
    ? "simulation"
    : s === "FUTURE_FEES" || s === "LIMITS" || s === "SUMMARY"
      ? "metadata"
      : "outside_section";

// ------------------------------------------------------------------ parser

export function parseNubank(pdfLinhas: PdfLine[]): ParsedStatement {
  const textos = pdfLinhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const todos = plano(textos.join(" | "));

  // ---------- datas do cabeçalho
  const acharRotulada = (rotulos: string[], anoBase: number, mesFim: number | null) => {
    for (const linha of textos) {
      const p = plano(linha);
      if (!rotulos.some((r) => p.includes(r))) continue;
      const semRotulo = p.replace(new RegExp(rotulos.join("|"), "g"), " ");
      const d = lerDataMes(semRotulo, anoBase, mesFim);
      if (d) return d;
    }
    return null;
  };

  const anoDetectado = Number(todos.match(/\b(20\d{2})\b/)?.[1]) || new Date().getFullYear();
  const vencimento = acharRotulada(["data de vencimento", "vencimento", "fatura"], anoDetectado, null);
  const anoBase = Number((vencimento ?? "").slice(0, 4)) || anoDetectado;
  const emissao = acharRotulada(["emissao e envio", "emissao"], anoBase, null);
  const proximoFechamento = acharRotulada(
    ["fechamento da proxima fatura", "proximo fechamento", "prox. fechamento"],
    anoBase,
    null,
  );

  // período vigente: "DE 10 JUL A 10 AGO" (na seção TRANSAÇÕES ou no cabeçalho)
  let periodoInicio: string | null = null;
  let periodoFim: string | null = null;
  for (const linha of textos) {
    const p = plano(linha);
    const m = p.match(/de\s+(\d{1,2})\s+([a-z]{3})\.?\s*(?:de\s*(\d{4}))?\s+a\s+(\d{1,2})\s+([a-z]{3})\.?\s*(?:de\s*(\d{4}))?/);
    if (!m) continue;
    const mesFim = MESES[m[5] ?? ""];
    const mesIni = MESES[m[2] ?? ""];
    if (!mesIni || !mesFim) continue;
    const anoFim = Number(m[6]) || anoBase;
    const anoIni = Number(m[3]) || (mesIni > mesFim ? anoFim - 1 : anoFim);
    periodoInicio = iso(anoIni, mesIni, Number(m[1] ?? 0));
    periodoFim = iso(anoFim, mesFim, Number(m[4] ?? 0));
    break;
  }
  const mesFimCiclo = periodoFim ? Number(periodoFim.slice(5, 7)) : null;
  const anoCiclo = periodoFim ? Number(periodoFim.slice(0, 4)) : anoBase;

  // fechamento da fatura ATUAL = fim do período vigente (nunca a previsão do próximo)
  const fechamento = periodoFim ?? emissao ?? null;

  // ---------- titular: nome em caixa alta, sem dígitos, com 2+ palavras
  const titular =
    textos
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{8,60}$/.test(l) && l.split(" ").length >= 2)
      ?.trim() ?? null;

  // ---------- máquina de estados
  let secao: Secao = "OUTSIDE_TRANSACTION_SECTION";
  let cartaoAtual: string | null = null;
  const entries: StatementEntry[] = [];
  const rejeitadas: StatementRejectedLine[] = [];
  const cartoes: string[] = [];
  let pagamentoAnterior: { data: string | null; valor: number } | null = null;

  const registraCartao = (last4: string) => {
    if (!cartoes.includes(last4)) cartoes.push(last4);
  };

  for (const linha of textos) {
    const p = plano(linha);
    const nova = secaoDaLinha(linha);
    if (nova) {
      secao = nova;
      rejeitadas.push({ texto: linha, motivo: "section_header" });
      continue;
    }

    const last4 = linha.match(/(?:•{2,}|\*{2,}|final)\s*(\d{4})\b/i)?.[1];
    if (last4) {
      cartaoAtual = last4;
      registraCartao(last4);
      if (!/\d{1,2}\s+[A-Za-z]{3}/.test(linha)) {
        rejeitadas.push({ texto: linha, motivo: "metadata" });
        continue;
      }
    }

    if (secao === "PAYMENTS_AND_FINANCING") {
      // pagamento da fatura anterior — metadado, nunca item cobrado
      const valor = ultimoValor(linha);
      if (valor !== null && p.includes("pagamento")) {
        pagamentoAnterior = {
          data: lerDataMes(linha, anoCiclo, mesFimCiclo),
          valor: -Math.abs(valor),
        };
      }
      rejeitadas.push({ texto: linha, motivo: "metadata" });
      continue;
    }

    if (secao !== "CURRENT_TRANSACTIONS") {
      if (MOEDA.test(linha)) rejeitadas.push({ texto: linha, motivo: motivoDaSecao(secao) });
      MOEDA.lastIndex = 0;
      continue;
    }

    // ------ dentro de TRANSAÇÕES
    const data = /^\d{1,2}\s+[A-Za-z]{3}/.test(plano(linha))
      ? lerDataMes(linha, anoCiclo, mesFimCiclo)
      : null;
    const valor = ultimoValor(linha);
    if (!data || valor === null) {
      rejeitadas.push({ texto: linha, motivo: !data ? "missing_date" : "missing_value" });
      continue;
    }
    const descricao = linha
      .replace(/^\s*\d{1,2}\s+[A-Za-zÇç]{3}\.?\s*/, "")
      .replace(MOEDA, "")
      .replace(/(?:•{2,}|\*{2,})\s*\d{4}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!descricao) {
      rejeitadas.push({ texto: linha, motivo: "missing_description" });
      continue;
    }
    // "Saldo restante da fatura anterior R$ 0,00" e afins: metadado, não compra
    if (valor === 0 || p.includes("saldo restante")) {
      rejeitadas.push({ texto: linha, motivo: "metadata" });
      continue;
    }
    const parcela = descricao.match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/);
    entries.push({
      data_lancamento: data,
      descricao_original: descricao,
      descricao_normalizada: semAcento(descricao).toUpperCase(),
      estabelecimento_sugerido: descricao,
      valor,
      parcela_atual: parcela ? Number(parcela[1]) : null,
      total_parcelas: parcela ? Number(parcela[2]) : null,
      tipo_sugerido: valor < 0 ? "ESTORNO" : "COMPRA",
      card_last4: cartaoAtual,
      categoria_banco: null,
    });
  }

  // ---------- total oficial da fatura (nunca de alternativas de pagamento)
  const valorRotulado = (rotulos: string[], proibidos: string[] = []) => {
    for (const linha of textos) {
      const p2 = plano(linha);
      if (!rotulos.some((r) => p2.includes(r))) continue;
      if (proibidos.some((r) => p2.includes(r))) continue;
      const v = ultimoValor(linha);
      if (v !== null) return v;
    }
    return null;
  };
  const proibidosSimulacao = [
    "parcele",
    "parcelamento",
    "minimo",
    "rotativo",
    "juros",
    "iof",
    "cet",
    "simulacao",
    "alternativa",
    "saldo restante",
  ];
  const totalFatura =
    valorRotulado(["sua fatura de", "no valor de"], proibidosSimulacao) ??
    valorRotulado(["pagamento total da fatura"], proibidosSimulacao) ??
    valorRotulado(["total de compras de todos os cartoes"], proibidosSimulacao) ??
    valorRotulado(["total a pagar"], proibidosSimulacao);

  const faturaAnterior = valorRotulado(["fatura anterior"], ["saldo restante"]);
  const pagamentoResumo = valorRotulado(["pagamento recebido", "pagamento efetuado"]);
  if (!pagamentoAnterior && pagamentoResumo !== null) {
    pagamentoAnterior = { data: null, valor: -Math.abs(pagamentoResumo) };
  }

  const metadata: StatementMetadata = {
    data_emissao: emissao,
    next_closing_date: proximoFechamento,
    total_fatura_anterior: faturaAnterior,
    pagamento_anterior: pagamentoAnterior?.valor ?? null,
    previous_invoice_payment: pagamentoAnterior,
    expected_invoice_total: totalFatura,
    limite_credito: valorRotulado(["limite total", "limite de credito"]),
    limite_disponivel: valorRotulado(["limite disponivel"]),
  };

  const somaItens = Math.round(entries.reduce((a, e) => a + e.valor, 0) * 100) / 100;
  const consistente =
    totalFatura !== null && Math.abs(somaItens - totalFatura) < 0.01 && entries.length > 0;

  return {
    parser: "NUBANK_PDF",
    emissor: "NUBANK",
    titular,
    // fatura consolidada: não inferir um cartão único quando há vários
    final_cartao: cartoes.length === 1 ? (cartoes[0] ?? null) : null,
    data_fechamento: fechamento,
    data_vencimento: vencimento,
    periodo_inicio: periodoInicio,
    periodo_fim: periodoFim,
    valor_total_fatura: totalFatura,
    entries,
    linhas: textos,
    metadata,
    subtotais: [],
    futuras: [],
    blocos: [],
    rejeitadas,
    extraction_status: consistente ? "READY" : "REVIEW_REQUIRED",
  };
}

export const nubankParser: StatementParser = {
  id: "NUBANK_PDF",
  nome: "Nubank",
  detect: (linhas) => {
    const texto = semAcento(linhas.join(" ")).toLowerCase();
    if (texto.includes("nu pagamentos") || texto.includes("nubank")) return 0.9;
    return 0;
  },
  parse: parseNubank,
};
