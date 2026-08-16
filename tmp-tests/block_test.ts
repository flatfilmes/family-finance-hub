import { lerLancamentos } from "@/lib/card-statement-parsers/generic";
const linhas = ["12 AGO","RESTAURANTE XPTO","R$ 180,00","15 AGO","NOTEBOOK LOJA XYZ 03/12","R$ 400,00","16 AGO","GOOGLE *GOOGLE ONE","R$ 141,00"];
for (const e of lerLancamentos(linhas, 2026)) console.log(e.data_lancamento, e.descricao_original, e.valor, e.parcela_atual, e.total_parcelas);
