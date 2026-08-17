# FASE 2 — LEGACY RETIREMENT + SECURITY DEFINER HARDENING

Data: 2026-08-17 · Escopo: dívida estrutural, sem alteração de resultado financeiro.

## Resultado geral

| Item | Status |
| --- | --- |
| Testes | **212 passed / 32 arquivos** (antes: 204) |
| Typecheck | PASS |
| Goldens (BB, Itaú banco, Itaú cartão, Nubank) | **inalterados / PASS** |
| Parsers, ledger math, monthly-spending, recurring, transfer_between_accounts | **não tocados** |
| create_purchase_complete (atomicidade + idempotência) | **preservados** |
| Fingerprint de importação + guard de confirm | **preservados** |

---

## PARTE A — Remoção da dependência ativa de `expenses`

### A1. Mapa de dependências (antes)
| Local | Uso | Ação |
| --- | --- | --- |
| `create_purchase_complete` (RPC) | criava linha espelho em `expenses` para compras no crédito | removido |
| `src/lib/purchases.ts` → `registerPurchasePayment` | inseria `expenses` antes de gerar parcela | removido |
| `src/lib/purchases.ts` → `fetchPurchaseInstallments` / `fetchInstallmentsByPurchases` | buscavam parcelas via `expenses.id` | passam a consultar `expense_installments.purchase_id` |
| `src/lib/card-statements.ts` | criava `expenses` ao confirmar fatura | removido |
| `src/lib/card-details.ts` | fallback financeiro em `despesaPorId` | removido |
| `src/hooks/useCardsData.ts` | carregava `expenses` para compor cartões | removido |
| `src/lib/card-invoices.ts` | `generateInstallments` exigia `expenseId`; `clearInstallments` por despesa | `expenseId` opcional; `clearInstallments` (código morto) removido |
| `src/hooks/useExpenses.ts` | `useExpenses` / `useExpenseSummary` | removidos (só `useExpenseCategories` permanece) |

### A2. `expense_installments`
- `expense_id` agora **NULLABLE** (`information_schema` → `YES`).
- Constraint `expense_installments_origem_canonica`: `purchase_id IS NOT NULL OR expense_id IS NOT NULL`.
- Evidência: **170/170** parcelas possuem `purchase_id`; **0** órfãs.

### A3/A4. Compra como source of truth
Novas parcelas nascem com `expense_id = NULL` e `purchase_id` preenchido. Agrupamento em `parcelamentosAtivos` passou a usar a compra como chave canônica (linhas históricas sem compra continuam agrupadas pela despesa, apenas para leitura).

### A6. Histórico
Nenhuma linha de `expenses` foi apagada ou alterada. Leitura continua disponível.

### A7. Bloqueio de novas escritas legadas
```
REVOKE INSERT, UPDATE, DELETE ON public.expenses FROM anon, authenticated;
```
Evidência: `authenticated` → INSERT `false`, SELECT `true`; `anon` → UPDATE `false`.
No código, `src/lib/expenses.ts` não exporta mais `createExpense`/`updateExpense`/`deleteExpense` (teste automatizado garante).

---

## PARTE B — Reparo Itaú one-off removido
Log `bank_financial_repair_logs` confirma execução única em 2026-08-17. Removidos:
- `src/lib/bank-statements/financial-repair-apply.ts`
- `src/components/bank/financial-repair-execution.tsx`
- uso e IDs hard-coded na rota `/bancos/$accountId/plano-reparo` (o dry run e a prova continuam disponíveis, read-only).

---

## PARTE C — Security definer sweep

| Métrica | Antes | Depois |
| --- | --- | --- |
| Funções `SECURITY DEFINER` em `public` | 55 | 61 (6 novas guardas `assert_*`) |
| Executáveis por `anon` | 25 | **0** |
| Sem `SET search_path` | 0 | **0** |

Guardas de autorização injetadas no topo (checagem de família via `is_family_member` + `auth.uid()`):
`reprocess_account_checkpoints_only`, `normalize_bank_opening_balances`, `reset_bank_account_imports`, `bank_import_reset_scope`, `inspect_bank_import_reset`, `confirm_bank_statement_import`, `reprocess_bank_statement_import`, `apply_bank_persistence_repair`, `revert_bank_persistence_repair`, `merge_duplicate_purchase`, `purchase_undo_blocks`.

Marcadas como internas (sem EXECUTE para `anon`/`authenticated`): `recalc_bank_account_balance`, `find_purchase_duplicate`.

---

## PARTE D — Dedupe deprecated
`buildExistingMovementKeys` removido de `src/lib/bank-statements/dedupe.ts`; o teste legado do Itaú passou a usar `buildExistingMovementIndex` (identidade com ordinal de ocorrência). Resultado do teste inalterado.

---

## PARTE E — Rascunho de extrato (cross tab)
Chave passou de uma única `ff.extrato-rascunho` para `bankStatementDraft:{accountId}:{fingerprint}`, com ponteiro por conta. Abas com contas ou documentos diferentes não se sobrescrevem.

---

## Testes novos (`src/lib/phase2-legacy-retirement.test.ts`)
| Teste | Resultado |
| --- | --- |
| `expenses` não expõe função de escrita | PASS |
| leitura de `expenses` preservada | PASS |
| dedupe deprecated ausente / índice canônico presente | PASS |
| parcelamento agrupa pela compra mesmo sem `expense_id` | PASS |
| chave de rascunho escopada | PASS |
| contas distintas não se sobrescrevem | PASS |
| dois documentos na mesma conta convivem | PASS |
| limpar remove apenas o alvo | PASS |

## Estado que não regrediu
`CREATE_PURCHASE_ATOMIC`, `PURCHASE_RETRY_IDEMPOTENT`, `BANK_IMPORT_DATABASE_IDEMPOTENCY`, `CONFIRM_IMPORT_SECOND_CALL = ALREADY_CONFIRMED`, `ANON_TRANSACTION_WRITE = BLOCKED`, `AUTHENTICATED_TRANSACTION_WRITE = BLOCKED`.
