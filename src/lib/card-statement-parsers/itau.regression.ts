/**
 * CASO DE REGRESSÃO ITAU #001 — "Fatura multiproduto / múltiplos cartões".
 *
 * Reproduz a estrutura real da fatura Itaú usada como referência
 * (Fatura_Itau_20260815-223620.pdf). Serve para validar o parser sem
 * depender do arquivo original: limites, simulações e próximas faturas
 * NÃO podem virar lançamentos.
 */
import type { PdfLine } from "@/lib/pdf-extract";

export const ITAU_001_LINHAS: string[] = [
  "Banco Itaú S.A.",
  "RODRIGO NUNES AMADOR",
  "Cartão principal final 8294",
  "Vencimento 17/08/2026",
  "Emissão 10/08/2026",
  "Próximo fechamento 10/09/2026",
  "Resumo da fatura em R$",
  "Total da fatura anterior 4.601,94",
  "Pagamento efetuado em 17/07/2026 -4.601,94",
  "Lançamentos atuais 6.577,67",
  "Total desta fatura 6.577,67",
  "Limite total de crédito 56.066,00",
  "Limite disponível 40.290,83",
  "Limite utilizado 15.775,17",
  "Lançamentos: compras e saques",
  "DATA ESTABELECIMENTO VALOR EM R$",
  "Lançamentos no cartão (final 8294) 5.332,18",
  "20/05 VEICULOS BENONI AUTO MECANI 03/06 410,85",
  "26/05 DESPACHANTE TONON 03/12 265,61",
  "10/07 ALIMENTAÇÃO NUTRIMARKET .TUBARAO 6,99",
  "11/07 PADARIA DAMA DOCE 11,15",
  "02/08 ANGELONI SUPER LOJA 06 531,64",
  "07/08 D1 ATACADO 01/06 159,65",
  "12/07 SAUDE FARMACIA PANVEL -0,01",
  "Lançamentos no cartão (final 8821) 350,07",
  "03/08 0001 FARMACIA TRABALHA -0,04",
  "05/08 VESTUARIO LOJA CENTRO 350,11",
  "Lançamentos internacionais",
  "01/08 GOOGLE*WORKSPACE FLATF 141,77",
  "Repasse de IOF em R$ 7,89",
  "Lançamentos: produtos e serviços",
  "01/08 ANUIDADE DIFERENCIADA 01/12 46,00",
  "Compras parceladas - próximas faturas",
  "MLP*Netshoes-NS2CO 02/08 77,34",
  "D1 ATACADO 02/06 159,65",
  "Próxima fatura 2.010,81",
  "Demais faturas 7.671,52",
  "Total para próximas faturas 9.682,33",
  "Simulação de parcelamento da fatura",
  "Valor total financiado 7.100,00",
  "Pagamento mínimo 1.150,00",
  "CET 12,5% ao mês",
  "Saque cash disponível 10.000,00",
];

export const ITAU_001_ESPERADO = {
  parser: "ITAU_PDF",
  emissor: "ITAU",
  titular: "RODRIGO NUNES AMADOR",
  final_cartao: "8294",
  data_vencimento: "2026-08-17",
  data_emissao: "2026-08-10",
  valor_total_fatura: 6577.67,
  total_fatura_anterior: 4601.94,
  pagamento_anterior: -4601.94,
  future_commitments_total: 9682.33,
  limite_credito: 56066,
} as const;

/** Converte as linhas do caso em `PdfLine` para alimentar o parser. */
export function itau001PdfLines(): PdfLine[] {
  return ITAU_001_LINHAS.map((text, i) => ({ y: i, text, cells: [{ x: 0, text }] }));
}
