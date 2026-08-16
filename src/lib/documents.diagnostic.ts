/**
 * Dry run do parser de NOTA FISCAL para o Modo diagnóstico PDF.
 *
 * Só roda o parser atual em memória e expõe o que ele fez.
 * Não cria documento, compra, item, transação nem arquivo.
 */
import { extractPdfPageLayouts, parseNotaFiscalLayout } from "@/lib/pdf-extract";
import { parseDanfeProductTables } from "@/lib/danfe/danfe-spatial";
import type { ParserDryRunResult, ParserRejected } from "@/lib/pdf-diagnostic/diagnostic-types";

const MOEDA = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;

/** Uma linha é "candidata a produto" quando tem texto e ao menos um valor. */
export function isProductCandidate(texto: string): boolean {
  const letras = texto.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letras.length >= 3 && MOEDA.test(texto);
}

export const purchaseReceiptDryRun = async (file: Blob): Promise<ParserDryRunResult> => {
  const pages = await extractPdfPageLayouts(file);
  const nota = parseNotaFiscalLayout(pages);
  const tabela = parseDanfeProductTables(pages, nota.valor_total || null);

  const rejected: ParserRejected[] = tabela.rejected.map((r) => ({
    raw: r.raw,
    page: r.page,
    y: r.y,
    reason: r.reason,
  }));

  return {
    parser: "NOTA_FISCAL_DANFE_ESPACIAL",
    output: { ...nota, tabela_produtos_debug: tabela },
    debug: {
      accepted: tabela.products.map((p) => ({
        raw: p.description,
        valor: p.total,
        page: p.page,
        detalhe: `${p.quantity} ${p.unit} × ${p.unitPrice}${p.code ? ` · ${p.code}` : ""}`,
      })),
      rejected,
      metadata: [
        { campo: "estabelecimento", valor: nota.estabelecimento },
        { campo: "data_compra", valor: nota.data_compra },
        { campo: "forma_pagamento", valor: nota.forma_pagamento },
        { campo: "pagamento_descricao", valor: nota.pagamento_descricao },
        { campo: "tabela_encontrada", valor: tabela.tableFound ? "SIM" : "NAO" },
        { campo: "produtos_detectados", valor: tabela.products.length },
        { campo: "produtos_rejeitados", valor: tabela.rejected.length },
        { campo: "soma_produtos", valor: tabela.sum },
        { campo: "total_nota", valor: nota.valor_total },
        { campo: "diferenca", valor: Number((tabela.sum - nota.valor_total).toFixed(2)) },
        { campo: "status", valor: tabela.status },
      ],
    },
  };
};
