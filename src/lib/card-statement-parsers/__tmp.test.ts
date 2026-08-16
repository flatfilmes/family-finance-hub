import { describe, it } from "vitest";
import { parseItau } from "@/lib/card-statement-parsers/itau";
import { ITAU_003_LINHAS } from "@/lib/card-statement-parsers/itau.regression.semantica";
describe("iof", () => { it("linear", () => {
  const r: any = (parseItau as any)(ITAU_003_LINHAS.map((text,i)=>({y:i,text,cells:[{x:0,text}]})));
  console.log("entries", r.entries.length, r.entries.filter((e:any)=>/iof/i.test(e.descricao_original)));
  console.log("rejeitadas", r.rejeitadas?.filter?.((x:any)=>/iof/i.test(x.texto ?? x.linha ?? JSON.stringify(x))));
  console.log("total", r.entries.reduce((a:number,e:any)=>a+e.valor,0));
});});
