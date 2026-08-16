/**
 * Dry run do parser de EXTRATO BANCÁRIO para o Modo diagnóstico PDF.
 *
 * Roda inteiramente em memória: não cria bank_statement_imports, itens,
 * transações, conciliações, compras ou receitas — e nunca altera saldo.
 *
 * Nunca falha: se o layout do banco não for reconhecido, devolve
 * UNSUPPORTED_BANK_LAYOUT e o diagnóstico bruto continua disponível.
 */
import { readBankStatementPdf } from "@/lib/bank-statement-parsers/generic";
import type { ParserDryRunResult } from "@/lib/pdf-diagnostic/diagnostic-types";
import type { ParsedBankStatement } from "@/lib/bank-statements/types";

/** Campos institucionais do extrato, lidos só para exibição no diagnóstico. */
function lerIdentificacao(parsed: ParsedBankStatement) {
  const linhas = [...parsed.aceitos, ...parsed.rejeitados].map((l) => l.raw);
  const buscar = (re: RegExp) => {
    for (const linha of linhas) {
      const m = linha.match(re);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  };
  return {
    banco: buscar(/\b(?:banco)\s+([A-Za-zÀ-ÿ .]{3,40})/i),
    agencia: buscar(/ag[êe]ncia[:\s]+([\d.-]{3,10})/i),
    conta: buscar(/conta(?:\s+corrente)?[:\s]+([\d.\-/]{4,20})/i),
    titular: buscar(/(?:titular|cliente)[:\s]+([A-Za-zÀ-ÿ' .]{4,60})/i),
  };
}

export const bankStatementDryRun = async (file: Blob): Promise<ParserDryRunResult> => {
  let parsed: ParsedBankStatement | null = null;
  let erro: string | null = null;
  try {
    parsed = await readBankStatementPdf(file);
  } catch (e) {
    erro = e instanceof Error ? e.message : "falha desconhecida na leitura";
  }

  if (!parsed || parsed.movimentos.length === 0) {
    const ident = parsed ? lerIdentificacao(parsed) : null;
    return {
      parser: "UNSUPPORTED_BANK_LAYOUT",
      output: {
        motivo: erro ?? "Nenhuma movimentação reconhecida neste layout.",
        identificacao: ident,
        parserTentado: parsed?.parser ?? "EXTRATO_GENERICO_PDF",
        parcial: parsed,
      },
      debug: {
        accepted: parsed?.aceitos ?? [],
        rejected: parsed?.rejeitados ?? [],
        metadata: [
          { campo: "parser", valor: "UNSUPPORTED_BANK_LAYOUT" },
          { campo: "parser tentado", valor: parsed?.parser ?? "EXTRATO_GENERICO_PDF" },
          { campo: "banco identificado", valor: ident?.banco ?? null },
          { campo: "agência", valor: ident?.agencia ?? null },
          { campo: "conta", valor: ident?.conta ?? null },
          { campo: "titular", valor: ident?.titular ?? null },
          { campo: "movimentações", valor: 0 },
          { campo: "linhas rejeitadas", valor: parsed?.rejeitados.length ?? 0 },
          { campo: "erro", valor: erro },
        ],
      },
    };
  }

  const ident = lerIdentificacao(parsed);
  const entradas = parsed.movimentos.filter((m) => m.valor > 0).length;
  const saidas = parsed.movimentos.filter((m) => m.valor < 0).length;

  return {
    parser: parsed.parser,
    output: { identificacao: ident, ...parsed },
    debug: {
      accepted: parsed.aceitos,
      rejected: parsed.rejeitados,
      metadata: [
        { campo: "parser", valor: parsed.parser },
        { campo: "banco identificado", valor: ident.banco },
        { campo: "agência", valor: ident.agencia },
        { campo: "conta", valor: ident.conta },
        { campo: "titular", valor: ident.titular },
        { campo: "período início", valor: parsed.periodoInicio },
        { campo: "período fim", valor: parsed.periodoFim },
        { campo: "saldo inicial", valor: parsed.saldoInicial },
        { campo: "saldo final", valor: parsed.saldoFinal },
        { campo: "movimentações", valor: parsed.movimentos.length },
        { campo: "entradas", valor: entradas },
        { campo: "saídas", valor: saidas },
        { campo: "linhas aceitas", valor: parsed.aceitos.length },
        { campo: "linhas rejeitadas", valor: parsed.rejeitados.length },
      ],
    },
  };
};
