import { lerCabecalho, lerLancamentos } from "@/lib/card-statement-parsers/generic";
import { matchEntry, similaridade, statementFingerprint } from "@/lib/card-statements";

const linhas = `BANCO SANTANDER - FATURA DO CARTAO
Titular: JOAO DA SILVA
Cartao final 1234
Periodo: 06/08/2026 a 05/09/2026
Data de fechamento: 05/09/2026
Vencimento: 12/09/2026
Total da fatura R$ 1.408,40
LANCAMENTOS
12/08 RESTAURANTE XPTO R$ 180,00
15/08 NOTEBOOK LOJA XYZ 03/12 R$ 400,00
16/08 GOOGLE *GOOGLE ONE R$ 141,00
17/08 UBER *TRIP R$ 38,50
18/08 AMAZON BR R$ 129,90
19/08 MERCADO XPTO R$ 428,70
20/08 TV SAMSUNG LOJA 05/24 R$ 200,00
22/08 PAGAMENTO RECEBIDO -R$ 109,70
25/08 IOF TRANSACAO INTERNACIONAL R$ 12,00`.split("\n");

const cab = lerCabecalho(linhas);
console.log("CABECALHO", cab);
const entries = lerLancamentos(linhas, 2026);
console.log("ENTRIES", entries.length);
for (const e of entries) console.log(" -", e.data_lancamento, "|", e.descricao_original, "|", e.valor, "|", e.parcela_atual, e.total_parcelas, "|", e.tipo_sugerido);
console.log("SOMA", entries.reduce((a,e)=>a+e.valor,0).toFixed(2));

const candidatos: any = {
  purchases: [
    { id: "p1", estabelecimento: "Restaurante XPTO", data_compra: "2026-08-12", valor_total: 180 },
    { id: "p2", estabelecimento: "Mercado XPTO", data_compra: "2026-08-19", valor_total: 420 },
  ],
  installments: [
    { id: "i1", numero_parcela: 3, total_parcelas: 12, valor_parcela: 400, purchase_id: "pn" },
    { id: "i2", numero_parcela: 5, total_parcelas: 24, valor_parcela: 200, purchase_id: "ptv" },
  ],
  recurring: [{ id: "r1", nome: "Google One", valor: 141 }],
};
const usados = new Set<string>();
for (const e of entries) {
  const r = matchEntry(e, candidatos, usados);
  console.log(e.descricao_original.padEnd(38), r.match_status, r.confidence_score ?? "", r.diferenca ?? "");
}
console.log("FP", statementFingerprint({cardId:"11111111-2222-3333-4444-555555555555",vencimento:"2026-09-12",total:1408.4,periodoInicio:"2026-08-06",quantidade:entries.length}));
