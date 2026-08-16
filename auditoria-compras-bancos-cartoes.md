# Auditoria funcional — Compras, Bancos e Cartões

Base auditada: **Família Silva - Demonstração** (16 compras, 16 movimentações, 63 parcelas, 44 faturas).

## 1. Funcionando corretamente

- **Compra como evento central**: toda compra gera exatamente uma movimentação (`purchase_transaction_sync`), com `DELETE` prévio que impede duplicidade em edições.
- **PIX / Débito / Transferência**: debitam a conta bancária uma única vez (trigger de saldo) e aparecem no histórico da conta com status Confirmada.
- **Crédito**: não toca em conta bancária; gera despesa vinculada + parcelas ligadas às faturas corretas pelo ciclo fechamento/vencimento.
- **Parcelamentos**: validados na base — Notebook 12x R$ 400 (R$ 4.800), TV 24x R$ 200 (R$ 4.800), Ar-condicionado 18x R$ 200 (R$ 3.600). Nenhuma parcela órfã; a lista de Compras mostra a parcela do período, com o total como informação secundária.
- **Recorrências**: Netflix, Spotify e Google Drive projetadas nos próximos 3 meses; competência que já virou parcela não é projetada de novo; cancelamento preserva histórico.
- **Pagamento de fatura**: gera um único `PAGAMENTO_CARTAO`, quita as parcelas, marca a fatura como paga e debita a conta — sem criar nova compra.
- **Filtros por pessoa**: Compras, Bancos e Cartões respeitam `member_id` e o modo Família/Individual, atualizando totalizadores e histórico juntos.

## 2. Problemas encontrados e corrigidos

| # | Problema | Correção |
|---|---|---|
| 1 | **Limite utilizado do cartão podia contar duas vezes** — somava o total da fatura atual + parcelas futuras; quando a "fatura atual" caía num mês futuro, as mesmas parcelas entravam nas duas parcelas do cálculo. | O utilizado passou a ser a soma única das parcelas pendentes em faturas não pagas (`utilizado` em `useCardOverview`), mais compras comprometidas ainda sem parcela. |
| 2 | **"Saldo projetado" do banco duplicava movimentos** — somava entradas/saídas ao `saldo_atual`, que já é atualizado pelas triggers. | Substituído por **Resultado do período** (entradas − saídas − pagamentos), sem mexer no saldo atual. |
| 3 | **Histórico bancário exibia movimentos cancelados** enquanto os totalizadores os excluíam. | Lista e totais agora usam o mesmo conjunto (cancelados fora). |
| 4 | **Compra em dinheiro descontava saldo bancário** sem gerar movimentação correspondente na conta. | Trigger `purchase_bank_balance_sync` deixou de considerar `DINHEIRO`; dinheiro é saída de caixa, não do banco. |
| 5 | **Totais de fatura/projeção do painel ignoravam os filtros** (somavam parcelas de todos os cartões da família). | Agregações do overview passaram a considerar apenas os cartões visíveis. |

Conferência pós-correção (Silva): Nubank Black R$ 11.853,11 / 15.000 · Itaú Visa R$ 3.600 / 10.000 · Santander Maria R$ 850 / 7.000 · Adicional Pedro R$ 0 / 500 — sem sobreposição entre fatura atual e parcelas futuras.

## 3. Riscos restantes

- **Compras duplicadas de teste**: existem 3 compras idênticas "NS2.COM INTERNET S.A." (R$ 618,37) vindas de importações repetidas de PDF. São dados, não bug de cálculo — podem ser excluídas pela tela de Compras.
- **Cobertura de cenários**: a família demo só possui PIX e Crédito. Débito, Boleto (pendente), Transferência entre contas e entradas de salário não têm caso representativo cadastrado, então esses caminhos foram validados por código/trigger, não por dado real.
- **Movimentações de crédito ficam `PENDENTE` para sempre**: a saída da compra no cartão permanece pendente mesmo após o pagamento da fatura. Não afeta saldos (não tem conta vinculada), mas polui o histórico geral.
- **Recorrência só vira parcela quando há compra registrada**: a projeção é estimativa; não existe rotina automática que gere a cobrança do mês.
- **Sem tipo próprio de transferência entre contas**: hoje uma transferência é tratada como saída da conta de origem, sem crédito automático na conta destino.
