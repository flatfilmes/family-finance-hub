# FASE 3F — END-TO-END FINANCIAL INTEGRITY

**Veredito:** `FINANCIAL_E2E_VERDICT = PASS_WITH_OBSERVATIONS`

**Baseline:** 272 PASS → **294 PASS** (40 arquivos, 33 skipped pré-existentes).
**Nenhuma alteração** foi feita em parsers, motores financeiros, RPCs, RLS ou dados.
Esta fase foi exclusivamente de prova.

## Escopo provado

`DOCUMENTO/IMAGEM → EXTRAÇÃO → FinancialCandidateEvent → RECONCILIAÇÃO → REVIEW →
ConfirmationPlan → RPC CANÔNICA → EVENTO ECONÔMICO → BANCO/CARTÃO → READ MODELS`

Suíte nova em `src/lib/__tests__/financial-e2e/`:

| Arquivo | Cenários |
| --- | --- |
| `world.ts` | Mundo econômico em memória: fábricas tipadas + `ConfirmDeps` fake que espelha os efeitos de `create_purchase_complete` e `register_bank_movement`. Nenhuma regra financeira é reimplementada. |
| `bank-pipeline.e2e.test.ts` | Importação inicial de extrato, extrato sobreposto, lançamento retroativo. |
| `card-evidence.e2e.test.ts` | Print de cartão → compra, fatura após print, recibo duplicado, compras legítimas idênticas. |
| `economic-conservation.e2e.test.ts` | Pagamento de fatura, transferência entre contas, parcelamento, recorrência, gasto de competência × fluxo de caixa. |
| `idempotency-isolation.e2e.test.ts` | Dupla confirmação, timeout após commit, reimportação do mesmo documento, isolamento por família + varredura de RLS. |

## Provas obtidas

1. **Roteamento institucional**: documento do Banco do Brasil roteia apenas para `BB_STATEMENT_V1`; contexto Itaú devolve `DOCUMENT_INSTITUTION_MISMATCH` e nenhum parser é executado.
2. **Integridade matemática**: `abertura + entradas − saídas = fechamento` (diferença 0) e todos os checkpoints diários batem; o ledger diário reconstruído a partir das transações confirmadas fecha no mesmo saldo do documento.
3. **Sobreposição de período**: linhas já existentes viram `EXACT_MATCH` (vínculo, zero evento novo); linhas novas dentro da janela coberta viram `NEW_IN_OVERLAP` e exigem decisão humana; fora da janela, `NEW_ITEM`.
4. **Lançamento retroativo**: sem decisão o plano é `REVIEW_REQUIRED`; com checkpoint incompatível o plano é bloqueado com `HISTORICAL_LEDGER_REVIEW_REQUIRED` e nada é ajustado silenciosamente.
5. **Cartão**: print cria compras com `CARD_OBLIGATION` positiva e `BANK_BALANCE = 0`; a fatura oficial reconhece as três compras (`LINKED`) e só cria a linha realmente inédita. Pagamento de fatura nunca vira candidato de compra.
6. **Recibo duplicado**: jamais produz segundo evento — apenas vínculo ou revisão.
7. **Conservação**: transferência mantém patrimônio constante (saldo migra entre contas e não é consumo); parcelamento de 12× reconhece 100/mês em competência, mantém 1.200 como valor contratado e não duplica com a fatura; recorrência é contada uma vez por competência e zera após cancelamento.
8. **Idempotência**: repetir a confirmação devolve `ALREADY_CONFIRMED` sem segunda chamada de RPC; timeout depois do commit é reconhecido no retry; reimportar o mesmo documento gera 100% de vínculos e zero criações.
9. **Isolamento**: identidade de confirmação é derivada de `familyId`; todas as tabelas econômicas e de evidência têm RLS habilitada e nenhuma política delas usa `USING (true)` — todas citam escopo de família/membro.

## Observações (não são bugs corrigidos nesta fase)

- **Duplicatas legítimas na reconciliação**: com dois candidatos idênticos e dois registros idênticos, a engine devolve `CONFLICT` em vez de casar 1‑para‑1. É o comportamento seguro (nenhum evento econômico é criado sem humano), mas gera atrito de revisão. Melhoria sugerida para uma fase futura: desempate por ordem posicional quando a cardinalidade candidato/registro é exatamente igual.
- **Convenção de sinal**: leituras por imagem usam valor negativo para saída, enquanto itens de fatura usam positivo para despesa. Está documentado nos adaptadores, mas é uma pegadinha para novos parsers.
- **Duplicação de cálculo na UI**: `relatorios.tsx` e `dashboard.tsx` ainda somam totais inline em vez de consumir `buildSpendingBreakdown`/`buildCommitments`. Não houve divergência de resultado nos cenários testados, mas é risco de deriva futura.

## Conclusão

Nenhum bug de integridade financeira foi comprovado nesta fase: dinheiro só nasce por RPC canônica, evidência só vincula ou propõe, e reimportação/retry não duplicam evento econômico. As observações acima são de ergonomia e manutenção, não de correção do estado financeiro.
