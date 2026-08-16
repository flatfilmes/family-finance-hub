import { parseItau } from "./lib/card-statement-parsers/itau";
import { itau001PdfLines } from "./lib/card-statement-parsers/itau.regression";
const r = parseItau(itau001PdfLines());
console.log(JSON.stringify({h:{titular:r.titular,final:r.final_cartao,venc:r.data_vencimento,fech:r.data_fechamento,total:r.valor_total_fatura,meta:r.metadata,sub:r.subtotais,futuras:r.futuras?.length}}, null, 1));
console.log(r.entries.map(e=>`${e.data_lancamento}|${e.valor}|${e.tipo_sugerido}|${e.card_last4}|${e.parcela_atual}/${e.total_parcelas}|${e.categoria_banco}|${e.estabelecimento_sugerido}`).join("\n"));
console.log("SOMA_ATUAL", r.entries.filter(e=>e.tipo_sugerido!=="PAGAMENTO").reduce((a,e)=>a+e.valor,0).toFixed(2));
