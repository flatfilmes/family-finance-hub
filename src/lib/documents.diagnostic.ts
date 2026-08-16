/**
 * Dry run do parser de NOTA FISCAL para o Modo diagnóstico PDF.
 *
 * Só roda o parser atual em memória e expõe o que ele fez.
 * Não cria documento, compra, item, transação nem arquivo.
 */
import { extractPdfLines, parseNotaFiscal, parseValorBr } from "@/lib/pdf-extract";
import type { ParserDryRunResult, ParserRejected } from "@/lib/pdf-diagnostic/diagnostic-types";

const MOEDA = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Uma linha é "candidata a produto" quando tem texto e ao menos um valor. */
export function isProductCandidate(texto: string): boolean {
  const letras = texto.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letras.length >= 3 && MOEDA.test(texto.replace(MOEDA, (m) => m));
}

export const purchaseReceiptDryRun = async (file: Blob): Promise<ParserDryRunResult> => {
  const linhas = await extractPdfLines(file);
  const nota = parseNotaFiscal(linhas);

  const aceitosNorm = nota.items.map((i) => normalizar(i.descricao_produto));
  const rejected: ParserRejected[] = [];

  for (const linha of linhas) {
    const texto = linha.text.trim();
    if (!texto) continue;
    const valores = texto.match(MOEDA);
    const letras = texto.replace(/[^A-Za-zÀ-ÿ]/g, "").length;
    if (!valores || letras < 3) continue;

    const norm = normalizar(texto);
    const usada = aceitosNorm.some((a) => a.length >= 4 && (norm.includes(a) || a.includes(norm)));
    if (usada) continue;

    rejected.push({
      raw: texto,
      valor: parseValorBr(valores[valores.length - 1]!),
      page: linha.page ?? null,
      x: linha.cells[0]?.x ?? null,
      y: linha.y,
      reason: "nao_retornada_pelo_parser",
    });
  }

  return {
    parser: "NOTA_FISCAL",
    output: nota,
    debug: {
      accepted: nota.items.map((i) => ({
        raw: i.descricao_produto,
        valor: i.valor_total,
        detalhe: `${i.quantidade} ${i.unidade} × ${i.valor_unitario}`,
      })),
      rejected,
      metadata: [
        { campo: "estabelecimento", valor: nota.estabelecimento },
        { campo: "data_compra", valor: nota.data_compra },
        { campo: "valor_total", valor: nota.valor_total },
        { campo: "forma_pagamento", valor: nota.forma_pagamento },
        { campo: "linhas_lidas", valor: nota.linhas.length },
        { campo: "produtos", valor: nota.items.length },
        { campo: "confianca_items", valor: nota.confianca.items },
      ],
    },
  };
};
