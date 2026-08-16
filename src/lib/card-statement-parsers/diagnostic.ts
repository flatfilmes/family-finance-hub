/**
 * Dry run do parser de FATURA DE CARTÃO para o Modo diagnóstico PDF.
 * Roda a leitura atual em memória: não cria importação, compra nem transação.
 */
import { readCardStatementPdf } from "@/lib/card-statement-parsers";
import type { ParserDryRunResult } from "@/lib/pdf-diagnostic/diagnostic-types";

export const cardStatementDryRun = async (file: Blob): Promise<ParserDryRunResult> => {
  const parsed = await readCardStatementPdf(file);
  return {
    parser: parsed.parser,
    output: {
      emissor: parsed.emissor,
      titular: parsed.titular,
      final_cartao: parsed.final_cartao,
      data_fechamento: parsed.data_fechamento,
      data_vencimento: parsed.data_vencimento,
      valor_total_fatura: parsed.valor_total_fatura,
      entries: parsed.entries,
      futuras: parsed.futuras ?? [],
      blocos: parsed.blocos ?? [],
      subtotais: parsed.subtotais ?? [],
      metadata: parsed.metadata ?? {},
    },
    debug: {
      accepted: parsed.entries.map((e) => ({
        raw: e.descricao_original,
        valor: e.valor,
        detalhe: [
          e.data_lancamento,
          e.tipo_sugerido,
          e.parcela_atual ? `${e.parcela_atual}/${e.total_parcelas}` : null,
          e.card_last4 ? `•••• ${e.card_last4}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      rejected: (parsed.rejeitadas ?? []).map((r) => ({
        raw: r.texto,
        page: r.page ?? null,
        reason: r.motivo,
      })),
      metadata: [
        { campo: "parser", valor: parsed.parser },
        { campo: "lancamentos", valor: parsed.entries.length },
        { campo: "total_extraido", valor: parsed.entries.reduce((a, e) => a + e.valor, 0) },
        { campo: "valor_total_fatura", valor: parsed.valor_total_fatura },
        { campo: "extraction_status", valor: parsed.extraction_status ?? null },
      ],
    },
  };
};
