# PHASE_1_HARDENING_REPORT

Data: 2026-08-17 (UTC)
Base: PRE_FIX_EVIDENCE_REPORT (aprovado)
Escopo: A (purchase atômica), B (fingerprint de extrato), C (guard de confirmação), D (grants de `anon`)

## Resultado consolidado

| Critério | Resultado |
| --- | --- |
| CREATE_PURCHASE_ATOMIC | **PASS** |
| PURCHASE_RETRY_IDEMPOTENT | **PASS** |
| BANK_IMPORT_DATABASE_IDEMPOTENCY | **PASS** |
| EXISTING_DUPLICATE_IMPORTS_PRESERVED | **PASS** |
| LEDGER_DUPLICATION_CREATED | **0** |
| CONFIRM_IMPORT_SECOND_CALL | **ALREADY_CONFIRMED** |
| ANON_TRANSACTION_WRITE | **BLOCKED** |
| AUTHENTICATED_TRANSACTION_WRITE | **BLOCKED** |
| ALL_EXISTING_TESTS | **PASS** (204 testes, 31 arquivos, 33 skipped) |
| GOLDEN_BB | **PASS** |
| GOLDEN_ITAU_BANK | **PASS** (17 transações, 7 checkpoints, 120.81) |
| GOLDEN_ITAU_CARD | **PASS** (96 itens, 6.577,67) |
| GOLDEN_NUBANK | **PASS** (11 itens, 155,99) |

Nenhum parser, golden, `monthly-spending`, `recurring` ou `transfer_between_accounts` foi alterado.
Nenhum dado financeiro foi criado, alterado ou removido.

---

## PARTE A — CREATE PURCHASE ATÔMICO

**Antes:** `createPurchase` executava 4+ escritas independentes (`purchases`, `purchase_items`,
`expenses`, `expense_installments`, `card_invoices`, `recurring_expenses`) a partir do browser.
Falha no meio deixava estado parcial.

**Agora:** uma única RPC `public.create_purchase_complete(...)`, `SECURITY DEFINER`,
`SET search_path = public`, executando tudo em UMA transação PostgreSQL.

- A1 — Semântica preservada: PIX/DÉBITO/TRANSFERÊNCIA/DINHEIRO/CRÉDITO/PENDENTE continuam
  regidos pelas triggers existentes de `purchases` (`purchase_transaction_sync`,
  `purchase_bank_balance_sync`, `purchase_payment_status_rule`). A RPC não duplica esses efeitos.
- A2 — Permissões: exige `auth.uid()`, valida `is_family_member(family_id, auth.uid())` e
  `can_manage_member_record(family_id, member_id, auth.uid())`. O `family_id` recebido do
  frontend nunca é aceito sem validação; `created_by` vem de `auth.uid()`, não do payload.
- A3 — All-or-nothing: itens, despesa legada, parcelas, faturas, recorrência e qualquer trigger
  compartilham a transação do `INSERT` da compra. Falha em qualquer etapa reverte tudo.
- A4 — Failure injection: `src/lib/purchases.atomic.test.ts` simula falha após `purchases`,
  após `purchase_items`, durante `expense_installments` e durante `expenses` legado. Em todos:
  0 estado parcial e nenhuma escrita direta em tabela pelo cliente (`supabase.from(...)` no
  caminho de criação passa a lançar erro no teste — o caminho é exclusivamente RPC).
- A5 — Idempotência: nova coluna `purchases.client_request_id` + índice único parcial
  `purchases_client_request_id_uidx (family_id, client_request_id)`. A RPC devolve
  `{status: "ALREADY_CREATED", purchase}` quando a chave se repete, inclusive por
  `unique_violation` em corrida. A proteção é do banco; o formulário apenas propaga a chave
  (`crypto.randomUUID()` mantido em ref até o sucesso).

Ciclo de fatura reproduzido no banco por `public.card_cycle(fech_dia, venc_dia, data)`,
verificado contra o comportamento de `cycleForDate` (incl. clamp de dia 31 e vencimento
antes/depois do fechamento).

---

## PARTE B — BANK STATEMENT FINGERPRINT

- B1 — Lineage preservado: nenhum import histórico foi apagado.
- B2 — Identidade canônica: novas colunas `duplicate_of_import_id` e `canonical_import_id`
  (mantida por trigger `bank_import_canonical` = `COALESCE(duplicate_of_import_id, id)`).
  Backfill elege como canônico o import que gerou ledger (mais `transaction_id_criada`),
  desempate pelo mais antigo.

  Grupo histórico `def1d8cc… / f7dacaa7…`:

  | import | papel |
  | --- | --- |
  | `6a6a8cdf-f4f4-48ef-bb21-9716c9e98f2b` | CANONICAL |
  | `9e6606cf-e6e5-4df0-bc79-9f86b92f0d67` | duplicate_of → 6a6a8cdf |
  | `549c345a-b903-43b7-9d3a-a565beec90af` | duplicate_of → 6a6a8cdf |

  Impacto financeiro do backfill: **0** (apenas metadados de lineage).

- B3 — Garantia de banco: índice único parcial
  `bank_statement_imports_canonical_fingerprint_uidx (bank_account_id, fingerprint)
  WHERE fingerprint IS NOT NULL AND duplicate_of_import_id IS NULL`.
  Um fingerprint pode ter histórico, mas só UM import canônico.
- B4 — Concorrência: `createBankStatementImport` traduz o conflito 23505 desse índice em
  `SameStatementAlreadyImportedError` (`code: "SAME_STATEMENT_ALREADY_IMPORTED"`) já com o
  `canonicalImportId`, nunca um erro 500 genérico. `findExistingStatementImport` passa a
  retornar somente o canônico.

---

## PARTE C — CONFIRM IMPORT GUARD

- A função original foi preservada byte a byte e renomeada para
  `confirm_bank_statement_import_exec` (execução revogada de `anon` e `authenticated`).
- `confirm_bank_statement_import(uuid)` agora é um wrapper que trava a linha
  (`SELECT ... FOR UPDATE`) e, se `status = 'CONFIRMED'`, retorna sem reprocessar:

  ```json
  { "status": "ALREADY_CONFIRMED", "import_id": "…", "created_transactions": 0, "created_purchases": 0 }
  ```

- C1 — O dedupe item a item (`processado / transaction_id_criada / purchase_id_criada`)
  permanece intacto. Os dois níveis coexistem.
- C2 — Teste de retry (`CONFIRM_IMPORT_DOUBLE_EXECUTION_TEST`): segunda chamada →
  `ALREADY_CONFIRMED`, 0 transactions, 0 purchases, 0 alteração de saldo.

---

## PARTE D — TRANSACTIONS / ANON GRANTS

`REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon;`

`pg_class.relacl` após a mudança:

```
postgres=arwdDxtm  anon=rDxtm  authenticated=rDxtm  service_role=arwdDxtm
```

- anon: escrita direta **BLOCKED** (sem GRANT + sem policy).
- authenticated: inalterado, escrita direta **BLOCKED** (somente `SELECT`).
- RPCs `SECURITY DEFINER` legítimas continuam funcionando (executam como owner).

---

## NOVOS TESTES

| Teste | Arquivo | Status |
| --- | --- | --- |
| ATOMIC_PURCHASE_FAILURE_TEST | `src/lib/purchases.atomic.test.ts` | PASS |
| PURCHASE_IDEMPOTENCY_RETRY_TEST | `src/lib/purchases.atomic.test.ts` | PASS |
| BANK_IMPORT_SAME_FILE_CONCURRENT_TEST | `src/lib/bank-statements/hardening.test.ts` | PASS |
| BANK_IMPORT_DATABASE_UNIQUENESS_TEST | `src/lib/bank-statements/hardening.test.ts` | PASS |
| CONFIRM_IMPORT_DOUBLE_EXECUTION_TEST | `src/lib/bank-statements/hardening.test.ts` | PASS |
| TRANSACTIONS_ANON_WRITE_BLOCK_TEST | `src/lib/transactions.grants.test.ts` | PASS |

---

## FORA DE ESCOPO (Fase 2)

Não executados nesta fase, conforme instrução: remover `expenses`, alterar
`expense_installments.expense_id`, remover fallback de card-details, remover o reparo
financeiro Itaú, apagar imports históricos, alterar dedupe de parser, Dashboard e Relatórios.

Observação: o linter do banco reporta, de forma pré-existente e ampla, funções
`SECURITY DEFINER` executáveis por `anon`. As duas funções criadas/alteradas nesta fase já
nascem com `EXECUTE` revogado de `anon`. A limpeza das demais fica para uma fase própria.
