# PRE_FIX_EVIDENCE_REPORT — Fase 0 (provas finais pré-correção)

Somente leitura. Nenhuma migration, nenhum código, nenhuma RLS, nenhum INSERT/UPDATE/DELETE.
Data: 2026-08-17 (UTC).

---

## 1. SEC-001 — RLS de `transactions`

### Policies reais (`pg_policies WHERE tablename='transactions'`)

| policyname | cmd | roles | qual | with_check |
| --- | --- | --- | --- | --- |
| `transactions_select` | SELECT | `{authenticated}` | `can_view_member_record(family_id, member_id, auth.uid())` | (nulo) |

Não existe nenhuma outra policy. RLS está **habilitada** (`relrowsecurity = true`, `relforcerowsecurity = false`).

### GRANTs reais (`pg_class.relacl`)

`{postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres, authenticated=rDxtm/postgres, service_role=arwdDxtm/postgres}`

| role | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `anon` | sim (`r`) | sim (`a`) | sim (`w`) | sim (`d`) |
| `authenticated` | sim (`r`) | **não** | **não** | **não** |
| `service_role` | sim | sim | sim | sim |

### TRANSACTIONS_RLS_WRITE_STATUS

```
DIRECT_INSERT_AUTHENTICATED = BLOCKED
DIRECT_UPDATE_AUTHENTICATED = BLOCKED
DIRECT_DELETE_AUTHENTICATED = BLOCKED
```

Prova, em duas camadas independentes:

1. **GRANT**: `authenticated` tem apenas `rDxtm` (SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN). Sem `a/w/d`, o PostgREST devolve erro de permissão antes mesmo da RLS.
2. **RLS**: a única policy é `FOR SELECT`. Sem policy `INSERT/UPDATE/DELETE`, a RLS nega qualquer escrita por padrão (`with_check` inexistente).

Observação de higiene (não é bug explorável hoje): `anon` **tem** GRANTs de escrita na tabela, mas nenhuma policy — a RLS bloqueia. Fica dependente de uma única camada; recomendação futura é `REVOKE` em `anon`. Além disso, `anon` não tem sequer policy de SELECT (a existente é `TO authenticated`), então leitura anônima também está bloqueada.

### Quem escreve legitimamente em `transactions`

Todas as 17 rotas de escrita são `SECURITY DEFINER`:

| função | tipo | ops |
| --- | --- | --- |
| `adjust_bank_account_balance` | RPC | INSERT |
| `apply_bank_persistence_repair` | RPC | INSERT |
| `apply_financial_ledger_repair` | RPC | UPDATE, DELETE |
| `confirm_bank_statement_import` | RPC | INSERT |
| `merge_duplicate_purchase` | RPC | UPDATE |
| `normalize_bank_opening_balances` | RPC | UPDATE |
| `pay_card_invoice` | RPC | INSERT |
| `purchase_transaction_sync` | **TRIGGER** (em `purchases`) | INSERT, DELETE |
| `purge_family_records` | RPC | DELETE |
| `register_bank_movement` | RPC | INSERT |
| `repair_bank_transaction_posting_dates` | RPC | UPDATE |
| `reset_bank_account_imports` | RPC | UPDATE, DELETE |
| `reset_family_purchases_and_cards` | RPC | UPDATE |
| `reverse_bank_transaction` | RPC | INSERT |
| `revert_bank_persistence_repair` | RPC | DELETE |
| `set_bank_account_balance` | RPC | INSERT |
| `transfer_between_accounts` | RPC | INSERT |

Nenhuma `SECURITY INVOKER`. O ledger só é escrito por RPC/trigger auditável.

**SEC-001 = PASS** (achado #8 do dossiê era `NOT_PROVEN`; agora provado que escrita direta do cliente está bloqueada).

---

## 2. TRF-001 — `transfer_between_accounts`

- FILE (banco): função `public.transfer_between_accounts(uuid, uuid, numeric, date, text)` — última definição em `supabase/migrations/20260816075729_f42c5620-c7cc-48f7-8b87-d1692367f13c.sql`
- FILE (cliente): `src/lib/transactions.ts:65-81` (`transferBetweenAccounts`), hook `src/hooks/useTransactions.ts:31-41`
- LANGUAGE: plpgsql, `SECURITY DEFINER`, `SET search_path = public`

| pergunta | resposta | evidência |
| --- | --- | --- |
| Cria transaction SAIDA na origem? | **YES** | `INSERT ... tipo 'TRANSFERENCIA', transfer_role 'SAIDA', bank_account_id = _origem_id` |
| Cria transaction ENTRADA no destino? | **YES** | segundo `INSERT ... transfer_role 'ENTRADA', bank_account_id = _destino_id` |
| Usa o mesmo `transfer_group_id`? | **YES** | `grupo uuid := gen_random_uuid()` usado nos dois INSERTs e retornado |
| Atualiza saldo das duas contas? | **YES** | `UPDATE bank_accounts SET saldo_atual = saldo_atual - _valor` (origem) e `+ _valor` (destino) |
| Operação é atômica? | **YES** | função plpgsql única: os dois UPDATEs e os dois INSERTs rodam na mesma transação implícita; qualquer `RAISE EXCEPTION` reverte tudo |
| Executa via RPC? | **YES** | `supabase.rpc("transfer_between_accounts", ...)` em `src/lib/transactions.ts:72` |

Guardas presentes: exige `auth.uid()`, proíbe origem = destino, exige valor > 0, exige mesma `family_id`, exige `can_manage_member_record` nas duas contas.

### Simulação em memória (nenhuma escrita)

```
Conta A (origem)  = 1000,00
Conta B (destino) =  500,00
transferência     =  200,00

UPDATE A: 1000 - 200 = 800,00      ✔ esperado 800
UPDATE B:  500 + 200 = 700,00      ✔ esperado 700

patrimônio antes  = 1000 + 500 = 1500,00
patrimônio depois =  800 + 700 = 1500,00   ✔ invariante preservada

ledger: 2 transactions TRANSFERENCIA, mesmo transfer_group_id,
        roles SAIDA/ENTRADA, valor 200 cada, status CONFIRMADA
        → efeito líquido no patrimônio familiar = 0
```

**TRF-001 = PASS** (não confirmado como defeito).

---

## 3. IMP-003 — 107 `transactions` sem `bank_account_id`

Consulta agregada (`transactions LEFT JOIN purchases ON purchases.id = transactions.purchase_id WHERE bank_account_id IS NULL`):

| forma_pagamento | tipo | tem credit_card_id | N |
| --- | --- | --- | --- |
| CREDITO | SAIDA | sim | **107** |

```
CREDITO       = 107
PIX           = 0
DEBITO        = 0
DINHEIRO      = 0
TRANSFERENCIA = 0
OUTROS        = 0   (inclui linhas sem purchase_id: 0)
```

Contagem de controle de linhas anômalas (`bank_account_id IS NULL` e `forma_pagamento <> 'CREDITO'` ou nula): **0**.

Todas as 107 linhas são semanticamente de cartão: compra no crédito não toca saldo bancário, vira compromisso via `card_invoices` / `expense_installments`. Nenhum ID anômalo a listar.

**IMP-003 = FALSE_POSITIVE (PASS)**

---

## 4. ARC-003 — dedupe deprecated

Busca por `buildExistingMovementKeys`:

| FILE | LINE | TYPE |
| --- | --- | --- |
| `src/lib/bank-statements/dedupe.ts` | 104 | comentário `@deprecated` |
| `src/lib/bank-statements/dedupe.ts` | 105 | **DEFINITION** |
| `src/lib/bank-statement-parsers/itau-bank.test.ts` | 3 | IMPORT (teste) |
| `src/lib/bank-statement-parsers/itau-bank.test.ts` | 168 | CALL (teste) |

Nenhuma ocorrência em código de produção (rotas, hooks, `src/lib` fora do teste). O consumidor de teste usa também `marcarDuplicados` (`dedupe.ts:199`), que só é chamado nesse mesmo teste.

Implementação atual que substituiu a antiga:

| símbolo | FILE:LINE | papel |
| --- | --- | --- |
| `movementKey` | `dedupe.ts:40` | chave base `data\|valor\|sentido\|doc\|lote\|desc` — **sem ordinal** |
| `occurrenceKey` | `dedupe.ts:62` | `movementKey + '#' + occurrenceIndex` — identidade fechada |
| `buildExistingMovementIndex` | `dedupe.ts:84` | índice de existentes por `occurrenceKey` + `source_id` |
| `classificarDuplicados` | `dedupe.ts:130` | decisão com alvo concreto (`source_id` conf. 100, `occurrenceKey` conf. 90) |

Consumidores ativos de `buildExistingMovementIndex`:
`src/routes/_authenticated/bancos_.$accountId.extratos.revisar.tsx:40,167` e
`src/routes/_authenticated/bancos_.$accountId.extratos.lote.tsx:30,114`.

**ARC-003 = SAFE_TO_REMOVE** (a remoção exige apenas migrar `itau-bank.test.ts` para `buildExistingMovementIndex` + `classificarDuplicados`).

---

## 5. IMP-001 — UNIQUE constraint em `bank_statement_imports`

A coluna real chama-se `fingerprint` (não `file_fingerprint`).

Índices e constraints existentes:

| nome | colunas | unique |
| --- | --- | --- |
| `bank_statement_imports_pkey` | `(id)` | **yes** |
| `bank_statement_imports_account_idx` | `(bank_account_id, created_at DESC)` | no |
| `bank_statement_imports_fingerprint_idx` | `(bank_account_id, fingerprint)` | **no** |

Constraints: apenas PK e 4 FKs (`bank_account_id`, `created_by`, `family_id`, `member_id`). Nenhum `UNIQUE(bank_account_id, fingerprint)`.

```
IMP-001_DATABASE_UNIQUE = ABSENT
```

A proteção existente é só de aplicação (`findExistingStatementImport`, `src/lib/bank-statements/data.ts`) — corrida ou caminho alternativo passa. Comparação: cartões **têm** proteção no banco via trigger `block_duplicate_confirmed_statement` em `card_statement_imports`; bancos não têm equivalente.

### Grupos duplicados existentes (`GROUP BY bank_account_id, fingerprint HAVING count(*) > 1`)

**1 grupo**, com 3 imports:

- `bank_account_id` = `def1d8cc-1b37-4346-bb3f-ad3b0cc3f7fc`
- `fingerprint` = `f7dacaa7ae84d7d1bf0807d56290cf9d3268469a52b1def1e058cb19ef6e7528`
- período: 2026-01-01 → 2026-06-30 (idêntico nos três)

| import id | created_at (UTC) | status | itens | itens processados | transactions criadas |
| --- | --- | --- | --- | --- | --- |
| `6a6a8cdf-f4f4-48ef-bb21-9716c9e98f2b` | 2026-08-17 02:17:03 | CONFIRMED | 17 | 17 | **12** |
| `9e6606cf-e6e5-4df0-bc79-9f86b92f0d67` | 2026-08-17 02:35:10 | CONFIRMED | 17 | 17 | 0 |
| `549c345a-b903-43b7-9d3a-a565beec90af` | 2026-08-17 02:58:46 | CONFIRMED | 17 | 17 | 0 |

Leitura: o canônico eleito pelo `statement-selection` (`6a6a8cdf`) é exatamente o único que produziu ledger; as duas reimportações foram integralmente absorvidas pelo dedupe interno da RPC (`transaction_id_matched`), **não** duplicaram o ledger. O dano é de metadado/contagem, não financeiro.

```
IMP-001_DUPLICATE_GROUPS = 1   (3 imports afetados, 0 transactions duplicadas)
```

Nenhum duplicado foi apagado.

---

## 6. Idempotência de `confirm_bank_statement_import`

SQL real inspecionada (não executada). `SECURITY DEFINER`, plpgsql.

| pergunta | resposta | evidência |
| --- | --- | --- |
| Existe proteção `IF already processed THEN return`? | **NO (no nível do import)** / **YES (no nível do item)** | não há checagem de `imp.status = 'CONFIRMED'` na entrada; dentro do laço há `IF it.processado OR it.transaction_id_criada IS NOT NULL OR it.purchase_id_criada IS NOT NULL THEN CONTINUE;` |
| Existe chave idempotente? | **YES, parcial** | (a) flag por item `processado` / `transaction_id_criada`; (b) dedupe por equivalência antes de inserir: mesma conta, mesma data, mesmo `round(abs(valor),2)`, mesmo sentido, e transaction ainda não vinculada a outro item → vira `transaction_id_matched`. Não é chave única de banco |
| Reexecutar a RPC poderia recriar transactions? | **NO para o mesmo `import_id`; NOT_PROVEN para import diferente do mesmo arquivo** | mesmo import: todos os itens já estão `processado = true` → laço faz `CONTINUE`, retorno `{criadas:0}`. Import novo com o mesmo PDF: os itens são novos (`processado=false`) e dependem só do dedupe por equivalência — foi o que salvou os imports `9e6606cf` e `549c345a` (0 transactions criadas), mas é heurística `data+valor+sentido`, não identidade por `source_id`, e não há garantia formal |

Riscos residuais identificados (não corrigidos):
- `ABERTURA_SALDO` é inserido quando não existe transaction anterior a `v_inicio`; guarda razoável, porém baseada em existência genérica.
- Classificação econômica por regex de descrição permanece no caminho de escrita (achado #4 do dossiê).

```
CONFIRM_IMPORT_IDEMPOTENT = YES (mesmo import_id) / NOT_PROVEN (reimportação do mesmo arquivo em outro import)
```

---

## 7. PRE_FIX_EVIDENCE_REPORT — resultado

```
SEC-001                  : PASS
TRF-001                  : PASS
IMP-003                  : PASS (FALSE_POSITIVE)
ARC-003                  : PASS (SAFE_TO_REMOVE)
IMP-001_DATABASE_UNIQUE  : ABSENT
IMP-001_DUPLICATE_GROUPS : 1
CONFIRM_IMPORT_IDEMPOTENT: YES (mesmo import_id) / NOT_PROVEN (mesmo arquivo, novo import)
```

Nenhuma correção foi aplicada. Nenhum dado foi criado, alterado ou removido.
