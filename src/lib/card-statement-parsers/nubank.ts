/**
 * NUBANK_PDF — parser SECTION-AWARE + SPATIAL da fatura Nubank.
 *
 * Regra central: somente a seção "TRANSAÇÕES ... DE <dd mmm> A <dd mmm>" produz
 * lançamentos cobrados. Simulações de parcelamento, pagamento mínimo, rotativo,
 * CET, encargos futuros e limites JAMAIS viram item econômico — são metadados.
 *
 * A montagem da linha econômica é ESPACIAL: data, final do cartão, descrição e
 * valor chegam do pdf.js em fragmentos separados (colunas x ≈ 123 / 172 / 214 /
 * 500) e às vezes em coordenadas y levemente diferentes. O row assembler
 * agrupa esses fragmentos com tolerância vertical e só fecha o cluster quando
 * encontra o valor, uma nova data ou o fim da seção.
 */
import type { PdfLine, PdfPageLayout } from "@/lib/pdf-extract";
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
  const ano = mesFim !== null && mes > mesFim ? anoBase - 1 : anoBase;
  return iso(ano, mes, dia);
}

const MOEDA_RE = /-?\s?R?\$?\s?-?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
const temMoeda = (texto: string) => {
  MOEDA_RE.lastIndex = 0;
  return MOEDA_RE.test(texto);
};

function valorBr(raw: string): number {
  const limpo = raw.replace(/[R$\s]/g, "");
  const negativo = limpo.trim().startsWith("-");
  const n = Number(limpo.replace(/-/g, "").replace(/\./g, "").replace(",", "."));
  return negativo ? -n : n;
}

function ultimoValor(texto: string): number | null {
  const achados = texto.match(MOEDA_RE);
  MOEDA_RE.lastIndex = 0;
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

// ------------------------------------------------------------ visual rows

type Fragmento = { text: string; x: number };
type VisualRow = { page: number; y: number; text: string; fragmentos: Fragmento[] };

const Y_TOLERANCIA = 4;

/** Agrupa itens posicionais em linhas visuais com tolerância vertical (±4px). */
function visualRowsDeLayout(pages: PdfPageLayout[]): VisualRow[] {
  const rows: VisualRow[] = [];
  for (const page of pages) {
    const itens = [...page.items]
      .filter((i) => i.text.trim())
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let atual: { y: number; frags: Fragmento[] } | null = null;
    for (const item of itens) {
      if (!atual || Math.abs(atual.y - item.y) > Y_TOLERANCIA) {
        if (atual) rows.push(montaRow(page.page, atual.y, atual.frags));
        atual = { y: item.y, frags: [] };
      }
      atual.frags.push({ text: item.text.replace(/\s+/g, " ").trim(), x: item.x });
    }
    if (atual) rows.push(montaRow(page.page, atual.y, atual.frags));
  }
  return rows.filter((r) => r.text);
}

function montaRow(page: number, y: number, frags: Fragmento[]): VisualRow {
  const ordenados = frags.filter((f) => f.text).sort((a, b) => a.x - b.x);
  return {
    page,
    y,
    fragmentos: ordenados,
    text: ordenados.map((f) => f.text).join(" ").replace(/\s+/g, " ").trim(),
  };
}

/** Modo linear (PdfLine): cada linha vira uma visual row, usando cells quando existem. */
function visualRowsDeLinhas(linhas: PdfLine[]): VisualRow[] {
  return linhas
    .map((l, i) => {
      const frags: Fragmento[] = l.cells?.length
        ? l.cells.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), x: c.x }))
        : [{ text: l.text.replace(/\s+/g, " ").trim(), x: 0 }];
      return montaRow(l.page ?? 1, l.y ?? -i, frags);
    })
    .filter((r) => r.text);
}

// -------------------------------------------------------- transaction rows

type Candidato = {
  data: string;
  cardLast4: string | null;
  descricao: string[];
  valor: number | null;
  origem: string[];
};

const DATA_INICIO = /^\d{1,2}\s+[a-z]{3}\b/;
const CARTAO_RE = /(?:•{2,}|\*{2,}|final)\s*(\d{4})\b/i;
const SO_DATA = /^\d{1,2}\s+[a-z]{3}\.?$/;
const NOME_TITULAR = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{8,60}$/;

// ------------------------------------------------------------------ parser

function parseNubankRows(rows: VisualRow[]): ParsedStatement {
  const textos = rows.map((r) => r.text);
  const todos = plano(textos.join(" | "));

  // ---------- datas rotuladas (com lookahead: rótulo e valor podem estar em rows distintas)
  const acharRotulada = (
    rotulos: string[],
    anoBase: number,
    mesFim: number | null,
    proibidos: string[] = [],
  ) => {
    for (let i = 0; i < textos.length; i++) {
      const p = plano(textos[i] ?? "");
      if (!rotulos.some((r) => p.includes(r))) continue;
      if (proibidos.some((r) => p.includes(r))) continue;
      const semRotulo = p.replace(new RegExp(rotulos.join("|"), "g"), " ");
      const direta = lerDataMes(semRotulo, anoBase, mesFim);
      if (direta) return direta;
      for (let j = i + 1; j <= i + 2 && j < textos.length; j++) {
        const seguinte = lerDataMes(plano(textos[j] ?? ""), anoBase, mesFim);
        if (seguinte) return seguinte;
      }
    }
    return null;
  };

  const anoDetectado = Number(todos.match(/\b(20\d{2})\b/)?.[1]) || new Date().getFullYear();
  const vencimento = acharRotulada(
    ["data de vencimento", "vencimento", "fatura"],
    anoDetectado,
    null,
  );
  const anoBase = Number((vencimento ?? "").slice(0, 4)) || anoDetectado;
  // "FATURA 17 AGO 2026" é referência/vencimento — nunca emissão.
  const emissao = acharRotulada(["emissao e envio", "data de emissao", "emissao"], anoBase, null);
  const proximoFechamento = acharRotulada(
    ["fechamento da proxima fatura", "proxima fatura", "proximo fechamento", "prox. fechamento"],
    anoBase,
    null,
  );

  // período vigente: "DE 10 JUL A 10 AGO"
  let periodoInicio: string | null = null;
  let periodoFim: string | null = null;
  for (const linha of textos) {
    const p = plano(linha);
    const m = p.match(
      /de\s+(\d{1,2})\s+([a-z]{3})\.?\s*(?:de\s*(\d{4}))?\s+a\s+(\d{1,2})\s+([a-z]{3})\.?\s*(?:de\s*(\d{4}))?/,
    );
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

  const fechamento = periodoFim ?? emissao ?? null;

  const titular =
    textos.find((l) => NOME_TITULAR.test(l) && l.split(" ").length >= 2)?.trim() ?? null;

  // ---------- máquina de estados + row assembler
  let secao: Secao = "OUTSIDE_TRANSACTION_SECTION";
  let cartaoAtual: string | null = null;
  const entries: StatementEntry[] = [];
  const rejeitadas: StatementRejectedLine[] = [];
  const cartoes: string[] = [];
  let pagamentoAnterior: { data: string | null; valor: number } | null = null;
  let candidato: Candidato | null = null;

  const registraCartao = (last4: string) => {
    if (!cartoes.includes(last4)) cartoes.push(last4);
  };

  const fechaCandidato = () => {
    if (!candidato) return;
    const atual = candidato;
    candidato = null;
    const bruto = atual.origem.join(" ");
    const descricao = atual.descricao.join(" ").replace(/\s+/g, " ").trim();
    if (atual.valor === null) {
      rejeitadas.push({ texto: bruto, motivo: "missing_value" });
      return;
    }
    if (!descricao) {
      rejeitadas.push({ texto: bruto, motivo: "missing_description" });
      return;
    }
    if (atual.valor === 0 || plano(descricao).includes("saldo restante")) {
      rejeitadas.push({ texto: bruto, motivo: "metadata" });
      return;
    }
    if (plano(descricao).startsWith("pagamento em")) {
      rejeitadas.push({ texto: bruto, motivo: "metadata" });
      return;
    }
    const parcela = descricao.match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/);
    entries.push({
      data_lancamento: atual.data,
      descricao_original: descricao,
      descricao_normalizada: semAcento(descricao).toUpperCase(),
      estabelecimento_sugerido: descricao,
      valor: atual.valor,
      parcela_atual: parcela ? Number(parcela[1]) : null,
      total_parcelas: parcela ? Number(parcela[2]) : null,
      tipo_sugerido: atual.valor < 0 ? "ESTORNO" : "COMPRA",
      card_last4: atual.cardLast4 ?? cartaoAtual,
      categoria_banco: null,
    });
  };

  /** Consome um fragmento dentro da seção TRANSAÇÕES. */
  const consomeFragmento = (texto: string) => {
    const p = plano(texto);
    if (!p) return;

    // percentuais nunca são moeda de transação
    const moeda = !texto.includes("%") ? ultimoValor(texto) : null;

    // 1) nova data → encerra o cluster anterior (regra 6) e abre outro
    if (DATA_INICIO.test(p)) {
      fechaCandidato();
      const data = lerDataMes(texto, anoCiclo, mesFimCiclo);
      if (!data) {
        rejeitadas.push({ texto, motivo: "missing_date" });
        return;
      }
      candidato = { data, cardLast4: cartaoAtual, descricao: [], valor: null, origem: [texto] };
      if (SO_DATA.test(p)) return;
      // resto do fragmento pode conter cartão / descrição / valor
      const resto = texto.replace(/^\s*\d{1,2}\s+[A-Za-zÇç]{3}\.?\s*/, "");
      if (resto.trim()) consomeFragmento(resto);
      return;
    }

    // 2) final do cartão
    const last4 = texto.match(CARTAO_RE)?.[1];
    if (last4) {
      cartaoAtual = last4;
      registraCartao(last4);
      if (candidato) candidato.cardLast4 = last4;
      const resto = texto.replace(CARTAO_RE, " ").replace(/\s+/g, " ").trim();
      if (candidato) candidato.origem.push(texto);
      else rejeitadas.push({ texto, motivo: "metadata" });
      if (resto) consomeFragmento(resto);
      return;
    }

    // 3) valor: fecha o cluster aberto (caso C/D)
    if (moeda !== null) {
      if (candidato) {
        candidato.origem.push(texto);
        candidato.valor = moeda;
        // descrição pode vir colada ao valor
        const resto = texto.replace(MOEDA_RE, " ").replace(/\s+/g, " ").trim();
        MOEDA_RE.lastIndex = 0;
        if (resto) candidato.descricao.push(resto);
        fechaCandidato();
      } else {
        rejeitadas.push({ texto, motivo: "missing_date" });
      }
      return;
    }

    // 4) descrição
    if (NOME_TITULAR.test(texto.trim())) {
      rejeitadas.push({ texto, motivo: "metadata" });
      return;
    }
    if (candidato) {
      candidato.origem.push(texto);
      candidato.descricao.push(texto.trim());
    } else {
      rejeitadas.push({ texto, motivo: "missing_date" });
    }
  };

  for (const row of rows) {
    const linha = row.text;
    const p = plano(linha);
    const nova = secaoDaLinha(linha);
    if (nova) {
      fechaCandidato();
      secao = nova;
      rejeitadas.push({ texto: linha, motivo: "section_header" });
      continue;
    }

    if (secao === "CURRENT_TRANSACTIONS") {
      for (const frag of row.fragmentos) consomeFragmento(frag.text);
      continue;
    }

    fechaCandidato();

    const last4Fora = linha.match(CARTAO_RE)?.[1];
    if (last4Fora) {
      cartaoAtual = last4Fora;
      registraCartao(last4Fora);
    }

    if (secao === "PAYMENTS_AND_FINANCING") {
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

    if (temMoeda(linha)) rejeitadas.push({ texto: linha, motivo: motivoDaSecao(secao) });
  }
  fechaCandidato();

  // ---------- total oficial da fatura (nunca de alternativas de pagamento)
  const valorRotulado = (rotulos: string[], proibidos: string[] = []) => {
    for (let i = 0; i < textos.length; i++) {
      const p2 = plano(textos[i] ?? "");
      if (!rotulos.some((r) => p2.includes(r))) continue;
      if (proibidos.some((r) => p2.includes(r))) continue;
      const v = ultimoValor(textos[i] ?? "");
      if (v !== null) return v;
      // valor pode estar na row seguinte (coluna à direita separada)
      for (let j = i + 1; j <= i + 1 && j < textos.length; j++) {
        const seguinte = textos[j] ?? "";
        if (proibidos.some((r) => plano(seguinte).includes(r))) continue;
        const v2 = ultimoValor(seguinte);
        if (v2 !== null) return v2;
      }
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

/** Modo linear (compatibilidade / fixtures textuais). */
export function parseNubank(pdfLinhas: PdfLine[]): ParsedStatement {
  return parseNubankRows(visualRowsDeLinhas(pdfLinhas));
}

/** Modo espacial: usa os itens posicionais do PDF (colunas data / cartão / descrição / valor). */
export function parseNubankSpatial(pages: PdfPageLayout[]): ParsedStatement {
  return parseNubankRows(visualRowsDeLayout(pages));
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
  parseLayout: parseNubankSpatial,
};
