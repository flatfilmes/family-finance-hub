import { layoutPageLines } from "../src/lib/pdf-extract";
import { parseItau } from "../src/lib/card-statement-parsers/itau";
import { itau001PdfLines, ITAU_001_ESPERADO, itau002PageItems, ITAU_002_PAGE_WIDTH, ITAU_002_ESPERADO } from "../src/lib/card-statement-parsers/itau.regression";

const p1 = parseItau(itau001PdfLines());
console.log("001 total", p1.valor_total_fatura, ITAU_001_ESPERADO.valor_total_fatura, "entries", p1.entries.length);

const itens = itau002PageItems().map(i => ({ text: i.texto, x: i.x, y: i.y, width: i.width }));
const linhas = layoutPageLines(itens, ITAU_002_PAGE_WIDTH, 2);
console.log(linhas.map(l => `${l.column} | ${l.text}`).join("\n"));
const cab = [{y:1000,text:"Vencimento 17/08/2026",cells:[{x:0,text:"Vencimento 17/08/2026"}],page:1,column:"UNICA" as const}];
const p2 = parseItau([...cab, ...linhas]);
console.log(JSON.stringify(p2.entries.map(e => [e.data_lancamento, e.descricao_normalizada, e.parcela_atual, e.total_parcelas, e.valor, e.ambiguo]), null, 1));
console.log("soma", p2.entries.reduce((a,b)=>a+b.valor,0));
