/**
 * Parser genérico de extrato bancário em PDF digital.
 *
 * Assume o mínimo possível: data + descrição + valor assinado na mesma linha.
 * Bancos com layout próprio ganham arquivos dedicados apenas depois de terem
 * sido observados no Modo diagnóstico PDF — nunca com regex no escuro.
 */
export {
  parseBankStatementLines,
  readBankStatementPdf,
  classificarMovimento,
  resumoDoExtrato,
} from "@/lib/bank-statements/parse";
