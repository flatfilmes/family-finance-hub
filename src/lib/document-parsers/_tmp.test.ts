import { it } from "vitest";
import { scoreBancoDoBrasil } from "/dev-server/src/lib/bank-statement-parsers/banco-do-brasil";
it("s", () => {
console.log(scoreBancoDoBrasil(["BANCO DO BRASIL","layout completamente novo"]));
console.log(scoreBancoDoBrasil(["BANCO DO BRASIL","bb.com.br","Extrato de conta corrente","Saldo do dia"]));
});
