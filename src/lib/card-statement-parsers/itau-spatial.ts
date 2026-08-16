/**
 * PARSER ESPACIAL DA FATURA ITAÚ (ITAU_PDF).
 *
 * Baseado exclusivamente na geometria real observada no dump bruto do PDF:
 * cada página é lida como duas colunas independentes, cada coluna tem estado
 * próprio (seção + final do cartão) e cada lançamento é reconstruído por
 * (coluna, Y) — nunca pela ordem de `textContent.items`, nunca por join global
 * da página, nunca por regex sobre a página inteira.
 *
 * Geometria de referência (page width 595.276):
 *   ESQUERDA  data x≈151.2 | estabelecimento x≈178.2 | valor x≈319–327
 *   DIREITA   data x≈367.2 | estabelecimento x≈394.2 | valor x≈535–543
 *   Categoria/cidade do lançamento fica em Y = Y_transação − 9, na mesma coluna.
 */
import { parseValorBr, type PdfPageLayout, type PdfTextItem } from "@/lib/pdf-extract";
import {
  DATA_CURTA,
  acharDataRotulada,
  acharValorRotulado,
  auditarBlocos,
  categoriaDoBanco,
  ehMetadataItau,
  ehProibido,
  ehRuido,
  lerValorFinal,
  montar,
  plano,
  secaoDaLinha,
  type Secao,
} from "./itau";
import type {
  ParsedStatement,
  StatementCardSubtotal,
  StatementEntry,
  StatementMetadata,
  StatementRejectedLine,
  StatementRejectionReason,
} from "./types";

// ------------------------------------------------------------------ geometria

export const COLUMN_SPLIT = 350;
export const Y_TOLERANCE = 0.8;
export const CATEGORY_Y_OFFSET = 9;

export type SpatialColumn = "LEFT" | "RIGHT";

/** Faixas de X por coluna, conforme o dump real. */
const FAIXAS: Record<SpatialColumn, { dataMin: number; dataMax: number; merchMin: number; valorMin: number }> = {
  LEFT: { dataMin: 140, dataMax: 176, merchMin: 176, valorMin: 300 },
  RIGHT: { dataMin: 356, dataMax: 392, merchMin: 392, valorMin: 515 },
};

export type SpatialRow = {
  page: number;
  column: SpatialColumn;
  y: number;
  items: PdfTextItem[];
  text: string;
};

/** Linha financeira reconstruída espacialmente (usada em testes e no relatório). */
export type ItauSpatialTransaction = {
  page: number;
  column: SpatialColumn;
  transactionY: number;
  categoryY: number | null;
  date: string | null;
  merchantRaw: string;
  merchant: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  amount: number;
  category: string | null;
  city: string | null;
  section: Secao;
  cardLast4: string | null;
};

const DATA_ITEM = /^\d{2}\/\d{2}(?:\/\d{2,4})?$/;
const VALOR_ITEM = /^-?\s*R?\$?\s*-?\s*\d{1,3}(?:\.\d{3})*,\d{2}-?$/;
const PARCELA_COLADA = /(\d{1,2})\s*\/\s*(\d{1,2})\s*$/;

/** Agrupa os itens de UMA coluna por proximidade de Y e ordena cada linha por X. */
export function buildRowsByY(
  itens: PdfTextItem[],
  page: number,
  column: SpatialColumn,
  tolerancia = Y_TOLERANCE,
): SpatialRow[] {
  const limpos = itens.filter((i) => i.text.trim());
  const ordenados = [...limpos].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: SpatialRow[] = [];
  for (const item of ordenados) {
    const atual = linhas[linhas.length - 1];
    if (atual && Math.abs(atual.y - item.y) <= tolerancia) atual.items.push(item);
    else linhas.push({ page, column, y: item.y, items: [item], text: "" });
  }
  for (const linha of linhas) {
    linha.items.sort((a, b) => a.x - b.x);
    linha.text = linha.items
      .map((i) => i.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return linhas;
}

/** Separa os itens da página em coluna esquerda e direita pelo X real. */
export function splitColumns(page: PdfPageLayout) {
  const limpos = page.items.filter((i) => i.text.trim());
  return {
    left: limpos.filter((i) => i.x < COLUMN_SPLIT),
    right: limpos.filter((i) => i.x >= COLUMN_SPLIT),
  };
}

/** "VEÍCULOS .TUBARAO" → { category: "VEÍCULOS", city: "TUBARAO" }. */
export function parseCategoriaCidade(texto: string): { category: string | null; city: string | null } {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!limpo) return { category: null, city: null };
  const m = limpo.match(/^(.*?)\s*\.\s*(.*)$/);
  if (!m) return { category: limpo || null, city: null };
  const category = (m[1] ?? "").trim() || null;
  const city = (m[2] ?? "").trim() || null;
  return { category, city };
}

type ColumnState = {
  column: SpatialColumn;
  section: Secao;
  cardLast4: string | null;
  jaViuLancamentos: boolean;
};

const SUBTOTAL_RE = /lan[çc]amentos no cart[ãa]o\s*\(?\s*final\s*(\d{4})\)?/i;
const FINAL_RE = /\(?\s*final\s*(\d{4})\s*\)?/i;
const TAXA_SEM_DATA = /(iof|repasse|anuidade|tarifa|seguro|encargo|juros|multa|mora)/;

/** Uma linha só é transação se tiver data na faixa de data e valor na faixa de valor. */
function lerLinhaFinanceira(row: SpatialRow) {
  const faixa = FAIXAS[row.column];
  const dataItem = row.items.find(
    (i) => i.x >= faixa.dataMin && i.x < faixa.dataMax && DATA_ITEM.test(i.text.trim()),
  );
  const valorItens = row.items.filter((i) => i.x >= faixa.valorMin && VALOR_ITEM.test(i.text.trim()));
  const valorItem = valorItens[valorItens.length - 1] ?? null;
  const merchantItens = row.items.filter(
    (i) => i.x >= faixa.merchMin && (!valorItem || i.x < valorItem.x) && i.x < faixa.valorMin,
  );
  const merchantRaw = merchantItens
    .map((i) => i.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { dataItem: dataItem ?? null, valorItem, merchantRaw };
}

export function parseItauSpatial(
  pages: PdfPageLayout[],
): ParsedStatement & { espaciais: ItauSpatialTransaction[] } {
  const rowsPorColuna: Record<SpatialColumn, SpatialRow[]> = { LEFT: [], RIGHT: [] };
  for (const page of pages) {
    const { left, right } = splitColumns(page);
    rowsPorColuna.LEFT.push(...buildRowsByY(left, page.page, "LEFT"));
    rowsPorColuna.RIGHT.push(...buildRowsByY(right, page.page, "RIGHT"));
  }

  // textos usados APENAS para metadados rotulados (nunca para lançamentos)
  const textos = [...rowsPorColuna.LEFT, ...rowsPorColuna.RIGHT]
    .sort((a, b) => a.page - b.page || b.y - a.y)
    .map((r) => r.text)
    .filter(Boolean);

  const vencimento = acharDataRotulada(textos, ["vencimento", "vence em", "pagar ate"]);
  const emissao = acharDataRotulada(textos, ["emissao", "emitida em", "data de emissao"]);
  const fechamento = acharDataRotulada(textos, ["proximo fechamento", "fechamento"]) ?? null;
  const totalAnterior = acharValorRotulado(textos, ["total da fatura anterior", "fatura anterior"]);
  const pagamentoAnterior = acharValorRotulado(textos, ["pagamento efetuado", "pagamentos efetuados"]);
  const lancamentosAtuais = acharValorRotulado(textos, ["lancamentos atuais", "lancamentos desta fatura"]);
  const totalFatura =
    acharValorRotulado(textos, ["total desta fatura", "total da fatura atual", "valor total desta fatura"]) ??
    lancamentosAtuais ??
    acharValorRotulado(textos, ["total a pagar", "valor a pagar"], ["anterior", "minimo", "financiado"]);
  const dataPagamentoAnterior = acharDataRotulada(
    textos.filter((l) => plano(l).includes("pagamento efetuado")),
    ["pagamento efetuado"],
  );

  const metadata: StatementMetadata = {
    data_emissao: emissao,
    total_fatura_anterior: totalAnterior,
    pagamento_anterior: pagamentoAnterior === null ? null : -Math.abs(pagamentoAnterior),
    previous_invoice_payment:
      pagamentoAnterior === null
        ? null
        : { data: dataPagamentoAnterior, valor: -Math.abs(pagamentoAnterior) },
    lancamentos_atuais: lancamentosAtuais,
    expected_invoice_total: totalFatura,
    dolar_conversao: acharValorRotulado(textos, ["dolar de conversao", "dolar conversao"]),
    limite_credito: acharValorRotulado(textos, ["limite total de credito", "limite de credito"]),
    limite_disponivel: acharValorRotulado(textos, ["limite disponivel"]),
    limite_utilizado: acharValorRotulado(textos, ["limite utilizado"]),
    next_invoice_amount: acharValorRotulado(textos, ["proxima fatura"]),
    future_invoices_amount: acharValorRotulado(textos, ["demais faturas"]),
    future_commitments_total: acharValorRotulado(textos, ["total para proximas faturas"]),
  };

  const finalPrincipal = textos.map((l) => l.match(/final\s*(\d{4})/i)?.[1]).find(Boolean) ?? null;
  const titular =
    textos.find(
      (l) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}(?: [A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}){1,4}$/.test(l) && !ehRuido(l),
    ) ?? null;

  const anoBase = Number((vencimento ?? emissao ?? "").slice(0, 4)) || new Date().getFullYear();
  const mesVencimento = vencimento ? Number(vencimento.slice(5, 7)) : null;

  const entries: StatementEntry[] = [];
  const futuras: StatementEntry[] = [];
  const subtotais: StatementCardSubtotal[] = [];
  const rejeitadas: StatementRejectedLine[] = [];
  const espaciais: ItauSpatialTransaction[] = [];

  // ---------------------------------------------------------------- por coluna
  const estados: Record<SpatialColumn, ColumnState> = {
    LEFT: { column: "LEFT", section: "IGNORADA", cardLast4: finalPrincipal, jaViuLancamentos: false },
    RIGHT: { column: "RIGHT", section: "IGNORADA", cardLast4: null, jaViuLancamentos: false },
  };

  const consumidas = new Set<SpatialRow>();
  for (const pagina of pages) {
  for (const column of ["LEFT", "RIGHT"] as const) {
    const rows = rowsPorColuna[column]
      .filter((r) => r.page === pagina.page)
      .sort((a, b) => b.y - a.y);
    const estado = estados[column];
    // A coluna DIREITA continua o fluxo de leitura da esquerda na mesma página.
    // O inverso nunca acontece: um bloco comercial da direita jamais altera a esquerda.
    if (column === "RIGHT") {
      if (estado.section === "IGNORADA") estado.section = estados.LEFT.section;
      if (!estado.cardLast4) estado.cardLast4 = estados.LEFT.cardLast4;
      estado.jaViuLancamentos = estado.jaViuLancamentos || estados.LEFT.jaViuLancamentos;
    }


    for (const row of rows) {
      const texto = row.text;
      if (!texto || consumidas.has(row)) continue;
      const rejeitar = (motivo: StatementRejectionReason) =>
        rejeitadas.push({ texto, motivo, page: row.page, column });

      const { dataItem, valorItem, merchantRaw } = lerLinhaFinanceira(row);
      const pareceLancamento = Boolean(dataItem && valorItem);

      // 1. cabeçalho de seção — sempre por coluna, nunca global
      const nova = pareceLancamento ? null : secaoDaLinha(texto);
      if (nova) {
        estado.section = nova;
        if (nova === "COMPRAS" || nova === "INTERNACIONAL" || nova === "SERVICOS") {
          estado.jaViuLancamentos = true;
        }
        if (nova === "INTERNACIONAL" || nova === "SERVICOS" || nova === "FUTURAS") {
          estado.cardLast4 = null;
        }
        rejeitar("section_header");
        continue;
      }

      // 2. subtotal do bloco ("Lançamentos no cartão (final XXXX)")
      const sub = texto.match(SUBTOTAL_RE);
      if (sub) {
        estado.cardLast4 = sub[1]!;
        const v = lerValorFinal(texto);
        if (v) subtotais.push({ card_last4: estado.cardLast4, valor: v.valor });
        if (estado.section === "IGNORADA") estado.section = "COMPRAS";
        estado.jaViuLancamentos = true;
        rejeitar("subtotal");
        continue;
      }

      // 3. cabeçalho de cartão ("RODRIGO ... (final 8294)")
      if (!pareceLancamento && !ehProibido(texto)) {
        const fin = texto.match(FINAL_RE);
        if (fin && !DATA_CURTA.test(texto)) {
          estado.cardLast4 = fin[1]!;
          if (estado.section === "IGNORADA" && estado.jaViuLancamentos) estado.section = "COMPRAS";
          rejeitar("metadata");
          continue;
        }
      }

      if (ehProibido(texto)) {
        rejeitar("simulation");
        continue;
      }
      if (ehMetadataItau(texto)) {
        rejeitar("metadata");
        continue;
      }
      if (ehRuido(texto)) {
        rejeitar("noise");
        continue;
      }

      // recuperação de bloco: caixas comerciais no meio da coluna não podem
      // apagar uma seção de lançamentos já aberta nesta mesma coluna
      if (estado.section === "IGNORADA" && pareceLancamento && estado.jaViuLancamentos) {
        estado.section = "COMPRAS";
      }
      if (estado.section === "IGNORADA") {
        rejeitar("outside_section");
        continue;
      }

      const alvo = estado.section === "FUTURAS" ? futuras : entries;

      // 4. categoria/cidade: SEMPRE em Y − 9, na MESMA coluna
      const categoriaRow = rows.find(
        (r) =>
          r !== row &&
          r.page === row.page &&
          Math.abs(r.y - (row.y - CATEGORY_Y_OFFSET)) <= Y_TOLERANCE &&
          !DATA_ITEM.test((r.items[0]?.text ?? "").trim()),
      );
      const categoria = categoriaRow ? parseCategoriaCidade(categoriaRow.text) : { category: null, city: null };

      // 5. linha financeira completa (data + estabelecimento + valor)
      if (dataItem && valorItem) {
        const lido = lerValorFinal(valorItem.text.trim()) ?? {
          valor: parseValorBr(valorItem.text),
          resto: "",
        };
        const item = montar(
          dataItem.text.trim(),
          merchantRaw,
          lido.valor,
          estado.section,
          estado.cardLast4,
          anoBase,
          mesVencimento,
        );
        if (!item) {
          rejeitar("missing_description");
          continue;
        }
        if (categoria.category) item.categoria_banco = categoriaDoBanco(categoria.category) ?? item.categoria_banco ?? null;
        if (categoriaRow) consumidas.add(categoriaRow);
        alvo.push(item);

        const parcela = merchantRaw.match(PARCELA_COLADA);
        espaciais.push({
          page: row.page,
          column,
          transactionY: row.y,
          categoryY: categoriaRow?.y ?? null,
          date: item.data_lancamento,
          merchantRaw,
          merchant: item.parcela_atual ? merchantRaw.slice(0, merchantRaw.length - (parcela?.[0].length ?? 0)).trim() : merchantRaw,
          installmentCurrent: item.parcela_atual,
          installmentTotal: item.total_parcelas,
          amount: item.valor,
          category: categoria.category,
          city: categoria.city,
          section: estado.section,
          cardLast4: estado.cardLast4,
        });
        continue;
      }

      // 6. cobranças sem data: só IOF/anuidade/tarifa em internacional e serviços
      const valorSemData = valorItem ? lerValorFinal(valorItem.text.trim()) : lerValorFinal(texto);
      if (!dataItem && valorSemData) {
        const descricao = valorItem ? merchantRaw : valorSemData.resto;
        const ehTaxa = TAXA_SEM_DATA.test(plano(descricao));
        const secaoAceita = estado.section === "SERVICOS" || estado.section === "INTERNACIONAL";
        if (estado.section === "FUTURAS" && descricao) {
          const item = montar(null, descricao, valorSemData.valor, estado.section, estado.cardLast4, anoBase, mesVencimento);
          if (item) futuras.push(item);
          else rejeitar("missing_description");
          continue;
        }
        if (secaoAceita && ehTaxa) {
          const item = montar(null, descricao, valorSemData.valor, estado.section, estado.cardLast4, anoBase, mesVencimento);
          if (item) alvo.push(item);
          else rejeitar("missing_description");
          continue;
        }
        rejeitar(secaoAceita ? "metadata" : "missing_date");
        continue;
      }

      rejeitar(valorItem ? "missing_date" : "missing_value");
    }
  }
  }


  const blocos = auditarBlocos(entries, subtotais);

  return {
    parser: "ITAU_PDF",
    emissor: "ITAU",
    titular,
    final_cartao: finalPrincipal,
    data_fechamento: fechamento,
    data_vencimento: vencimento,
    periodo_inicio: null,
    periodo_fim: null,
    valor_total_fatura: totalFatura,
    entries,
    futuras,
    subtotais,
    blocos,
    rejeitadas,
    metadata,
    linhas: textos,
    espaciais,
  };
}
