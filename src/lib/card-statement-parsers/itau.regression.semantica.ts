/**
 * CASO DE REGRESSÃO ITAU #003 — "Revisão semântica dos lançamentos".
 *
 * Reproduz as linhas reais da fatura Itaú de referência
 * (Fatura_Itau_20260815-223620.pdf, total oficial R$ 6.577,67) com foco em
 * classificação: totais, subtotais, cotação de câmbio e pagamento anterior
 * NÃO podem virar lançamento; IOF é cobrança real; códigos NN/NN colados ao
 * estabelecimento devem virar parcela.
 */
import type { PdfLine } from "@/lib/pdf-extract";

export const ITAU_003_LINHAS: string[] = [
  "Banco Itaú S.A.",
  "RODRIGO NUNES AMADOR",
  "Cartão principal final 8294",
  "Vencimento 17/08/2026",
  "Emissão 10/08/2026",
  "Resumo da fatura em R$",
  "Total da fatura anterior 4.601,94",
  "Pagamento efetuado em 17/07/2026 -4.601,94",
  "Total dos lançamentos atuais 6.577,67",
  "Total desta fatura 6.577,67",
  "Limite total de crédito 56.066,00",
  "Limite disponível 40.290,83",
  "Limite utilizado 15.775,17",
  "Lançamentos: compras e saques",
  "DATA ESTABELECIMENTO VALOR EM R$",
  "Lançamentos no cartão (final 8294) 5.332,18",
  "20/05 VEICULOS BENONI AUTO MECANI 03/06 410,85",
  "26/05 DESPACHANTE TONON 03/12 265,61",
  "27/05 VESTUARIO LOJAS RENNER FL 930 03/03 143,24",
  "08/07 ACADEMIA AD3 TUBAR 02/12 134,85",
  "10/07 SAUDE FARMACIA PANVEL 02/02 89,90",
  "11/07 0001 FARMACIA TRAB 01/03 45,00",
  "12/07 EVO*Isabela e Cia 01/02 60,00",
  "07/08 D1 ATACADO 01/06 159,65",
  "02/08 MLP*Netshoes-NS2CO01/08 77,34",
  "03/08 MERCADOLIVRE*FUSCA07/10 52,58",
  "03/08 PP *LIVE ROUPA09/10 51,17",
  "04/08 DL*Alipay Alipay 09/12 22,72",
  "05/08 ITAUSHOP 09/21 76,80",
  "05/08 MERCADOLIVRE*MERCA09/12 56,53",
  "06/08 LucianaFelisbino 08/12 216,74",
  "06/08 ANGELONI SUPER LOJA 06 531,64",
  "07/08 ADOBE 55,00",
  "Lançamentos internacionais",
  "01/08 GOOGLE*WORKSPACE FLATF 141,77",
  "MOUNTAIN VIEW 26,40 USD",
  "Dólar de Conversão 5,37",
  "Total transações inter. em 141,77",
  "Repasse de IOF em 4,94",
  "Total lançamentos inter. em 146,71",
  "02/08 PAYPAL *SMARTONEAPP 15,68",
  "Dólar de Conversão 5,37",
  "Total transações inter. em 15,68",
  "Repasse de IOF em 0,54",
  "Total lançamentos inter. em 16,22",
  "Lançamentos: produtos e serviços",
  "01/08 ANUIDADE DIFERENCI01/12 46,00",
  "L Total dos lançamentos atuais 6.577,67",
  "Compras parceladas - próximas faturas",
  "MLP*Netshoes-NS2CO 02/08 77,34",
  "DL*Alipay Alipay 10/12 22,72",
  "ITAUSHOP 10/21 76,80",
  "Próxima fatura 2.010,81",
  "Demais faturas 7.671,52",
  "Total para próximas faturas 9.682,33",
  "Simulação de parcelamento da fatura",
  "Valor total financiado 7.100,00",
  "CET 12,5% ao mês",
];

/** Textos que jamais podem aparecer como lançamento da fatura. */
export const ITAU_003_PROIBIDOS = [
  "Dólar de Conversão",
  "Total transações inter.",
  "Total lançamentos inter.",
  "Total dos lançamentos atuais",
  "Pagamento efetuado",
];

/** Parcelamentos obrigatórios (descrição contém, parcela atual/total). */
export const ITAU_003_PARCELAS: Array<[string, number, number]> = [
  ["NETSHOES", 1, 8],
  ["FUSCA", 7, 10],
  ["LIVE ROUPA", 9, 10],
  ["ALIPAY", 9, 12],
  ["ITAUSHOP", 9, 21],
  ["MERCA", 9, 12],
  ["LUCIANAFELISBINO", 8, 12],
  ["BENONI", 3, 6],
  ["TONON", 3, 12],
  ["RENNER", 3, 3],
  ["AD3", 2, 12],
  ["PANVEL", 2, 2],
  ["FARMACIA TRAB", 1, 3],
  ["ISABELA", 1, 2],
  ["D1 ATACADO", 1, 6],
  ["ANUIDADE", 1, 12],
];

export function itau003PdfLines(): PdfLine[] {
  return ITAU_003_LINHAS.map((text, i) => ({ y: i, text, cells: [{ x: 0, text }] }));
}
