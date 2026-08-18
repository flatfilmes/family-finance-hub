# Fonte única da verdade financeira (Fase 4A)

Regra principal: **a UI não é motor financeiro**. Toda tela apenas formata números
já calculados por um read model canônico.

## Camadas

```text
motores canônicos            read models              telas
buildSpendingBreakdown  ->   src/lib/read-models  ->  Dashboard
buildCommitments             income.ts                Relatórios
ledger bancário              bank.ts                  Bancos
engine de fatura             cards.ts                 Cartões
                             financial.ts             Histórico/Fechamento
```

## Conceitos canônicos

| Pergunta | Onde vive | Nunca recalcular na tela |
| --- | --- | --- |
| Quanto gastei no mês | `buildSpendingBreakdown` (`spending`) | somar `purchases` |
| Renda do mês | `sumMonthlyIncome` / `guaranteedMonthlyIncome` | somar `incomes` |
| Contas fixas do mês | `sumMonthlyFixedExpenses` | somar `fixed_expenses` |
| Saldo em contas | `buildBankOverview.saldoTotal` | somar `saldo_atual` |
| Entradas/saídas do período | `buildBankOverview` | filtrar `transactions` |
| Faturas abertas / capacidade | `buildCardCommitments` | somar `card_invoices` |
| Dinheiro livre hoje | `useFreeCash` (`freeCash`) | subtrair na tela |

## Contrato canônico de sinal

`src/lib/financial-evidence/sign-contract.ts` normaliza o valor bruto de cada
fonte em `amount` (magnitude, sempre positiva) + `direction` (`IN`/`OUT`):

- Extrato bancário (PDF) e leituras de imagem: **negativo = saída**.
- Fatura de cartão (PDF): **positivo = saída**, negativo = crédito/estorno.

O domínio só consome `amount` + `direction`; `rawAmount` fica guardado apenas
para auditoria da evidência.

## Guardas automáticas

- `src/lib/read-models/read-models.test.ts` — paridade Dashboard × Relatórios.
- `src/lib/read-models/ui-no-financial-math.test.ts` — proíbe `.reduce(` nas
  telas financeiras.
- `src/lib/financial-evidence/sign-contract.test.ts` — o mesmo fato econômico
  produz o mesmo evento vindo de extrato, fatura ou print.
