# AUDIT PACKAGE — Família Finance AI

Dossiê técnico do estado ATUAL do projeto, gerado para auditoria externa.
**Nenhuma alteração de código, schema ou dado financeiro foi executada na geração deste dossiê.**
Tudo abaixo é observação read-only do repositório e do banco.

Data de geração: 2026-08-17 (UTC)
Convenção: onde não houve evidência direta no código/banco, o item está marcado como `NOT_PROVEN`.

---

## 1. Stack e manifesto

| Item | Valor |
| --- | --- |
| Framework | TanStack Start v1 (React 19, SSR/edge) |
| Build | Vite 7 |
| Roteamento | @tanstack/react-router (file-based, `src/routes`) |
| Estado servidor | @tanstack/react-query |
| Estilo | Tailwind CSS v4 (`src/styles.css`, tokens semânticos) |
| UI | shadcn/ui + Radix + lucide-react |
| Backend | Supabase (Postgres + Auth + RLS + RPC) via Lovable Cloud |
| PDF | pdfjs-dist (extração posicional própria em `src/lib/pdf-extract.ts`) |
| Testes | Vitest |
| Idioma do domínio | pt-BR (nomes de tabela, enums e labels em português) |

Verificações executadas nesta auditoria:

- `vitest run` → **187 passed, 33 skipped, 0 failed**
- typecheck → **0 erros**
- `supabase/migrations` → **74 arquivos SQL**

---

## 2. Modelo de domínio (schema relevante)

Núcleo (44 tabelas no schema `public`). As colunas domínio-específicas relevantes:

**Estrutura familiar / identidade**
- `families` (is_demo), `family_members` (user_id, permissao ADMIN/MEMBER/VIEWER), `profiles`,
  `member_financial_profiles`, `financial_profiles`, `financial_settings`, `demo_settings`.

**Consumo (fonte de verdade do gasto)**
- `purchases` — evento econômico central: `estabelecimento`, `data_compra`, `valor_total`,
  `forma_pagamento` (payment_method), `tipo_compra` (purchase_type),
  `status_pagamento` (purchase_payment_status), `bank_account_id`, `credit_card_id`,
  `member_id`, `data_pagamento_prevista`, `data_pagamento_real`, `transaction_id`.
- `purchase_items` + `products` — detalhamento por produto.
- `purchase_imports` / `purchase_import_items` / `documents` / `document_extractions` — captura por documento.
- `expenses` — **modelo legado**, ainda escrito pelo caminho CREDITO de `purchases.ts` e lido como
  fallback em `card-details.ts`.

**Cartões**
- `credit_cards`, `card_invoices` (ciclo/fatura), `expense_installments` (parcelas),
  `card_statement_imports`, `card_statement_items`.

**Bancos / ledger**
- `bank_accounts`, `transactions` (ledger canônico: ENTRADA/SAIDA/TRANSFERENCIA/PAGAMENTO_CARTAO/
  AJUSTE_SALDO/ABERTURA_SALDO), `bank_statement_imports`, `bank_statement_items`
  (`source_id`, `occurrence_index`, `match_status`, `review_action`, `processado`),
  `bank_balance_checkpoints` (`saldo_informado`, `tipo` OPENING/DAILY/CLOSING/REFERENCE, `source_item_id`).

**Planejamento e histórico**
- `budgets`, `fixed_expenses`, `recurring_expenses`, `incomes`,
  `monthly_snapshots`, `monthly_closing_logs`.

**Auditoria / reparo**
- `bank_financial_repair_logs`, `bank_persistence_repair_logs`, `bank_import_reset_logs`,
  `family_reset_logs`, `reconciliations`, `reconciliation_audit`.

Enums relevantes estão listados em `AUDIT_PACKAGE.json`.

---

## 3. Autorização e RLS

- Todas as rotas de aplicação vivem sob `src/routes/_authenticated/`, cujo `beforeLoad`
  (`src/routes/_authenticated/route.tsx:6-10`) chama `supabase.auth.getUser()` e redireciona para `/auth`.
- Escopo de dados é **family-scoped**, não user-scoped: as políticas usam as funções
  `SECURITY DEFINER` `public.is_family_member(_family_id, _user_id)` e
  `public.is_family_admin(...)`, evitando recursão de RLS.
- Registros individuais de membro usam `can_view_member_record` / `can_manage_member_record` /
  `is_own_family_member`.
- Papéis (`ADMIN | MEMBER | VIEWER`) são armazenados em `family_members.permissao`, **não** em `profiles`.
  Isso não é a tabela `user_roles` canônica recomendada, mas também não está no registro de perfil do
  usuário: é uma tabela de associação separada, lida apenas por funções `SECURITY DEFINER`.
- Tabelas de referência (`expense_categories`, `document_types`) têm política única de leitura.
- Tabelas de log de reparo/reset têm 1–2 políticas (leitura restrita à família / escrita apenas pela RPC).

**Observação para o auditor:** `transactions` aparece com apenas 1 política. Vale confirmar
se ela cobre todas as operações (FOR ALL) ou se escrita direta pelo cliente está bloqueada por
ausência de política — o caminho de escrita pretendido é sempre trigger/RPC.

---

## 4. Fluxo COMPRA → efeito financeiro

Camada de aplicação: `src/lib/purchases.ts` (`createPurchase`, ~`:335-440`).
Camada de banco: trigger `purchase_transaction_sync()` + `purchase_bank_balance_sync()` +
`purchase_payment_status_rule()`.

Regra efetiva do trigger (`purchase_transaction_sync`, migração `20260816030017_...sql`):

1. `pg_trigger_depth() > 1` → no-op (proteção contra recursão).
2. Qualquer INSERT/UPDATE/DELETE apaga as `transactions` daquela compra
   (`purchase_id = NEW.id AND tipo <> 'PAGAMENTO_CARTAO'`) e reconstrói — modelo **replace, não patch**.
3. `status_pagamento = 'PENDENTE_PAGAMENTO'` → nenhuma transação, `purchases.transaction_id = NULL`.
4. Caso contrário insere `transactions` tipo `SAIDA` com:
   - status: `PAGO → CONFIRMADA`, `CANCELADO → CANCELADA`, restante → `PENDENTE`;
   - `bank_account_id` preenchido **apenas** quando `forma_pagamento IN ('PIX','DEBITO','TRANSFERENCIA')`;
   - data = `COALESCE(data_pagamento_real, data_compra)`.
5. `purchases.transaction_id` é atualizado com o id da transação criada.

Consequência arquitetural: crédito e boleto **não** tocam saldo bancário; crédito vira compromisso via
`card_invoices` / `expense_installments`. Pagamento de fatura é operação própria
(`pay_card_invoice`, `src/lib/transactions.ts:50`) e **não** gera `purchases`.

Risco observado: `createPurchase` faz múltiplos INSERTs sequenciais no cliente
(compra → itens → parcelas → espelho em `expenses`), sem transação atômica de banco. Uma falha no meio
deixa estado parcial que só é reconciliável manualmente.

---

## 5. Pipeline de importação bancária

```
PDF → pdf-extract (layout posicional)
    → detectDocumentType            (src/lib/pdf-diagnostic/document-type.ts:107)
    → detectBankStatement (score)   (src/lib/bank-statements/parse.ts:366)
    → selectBankStatementParser     (parse.ts:56)
    → parser (BB / Itaú / genérico)
    → ParsedBankStatement           (src/lib/bank-statements/types.ts)
    → toCanonicalStatement/buildSourceId (canonical.ts:191 / :113)
    → validateStatement             (validate.ts:40)
    → reconcileMovement             (reconcile.ts:77, tolerância 2 dias)
    → revisão humana (rota extratos.revisar / .lote)
    → createBankStatementImport     (data.ts:41)  ← única escrita
    → confirm_bank_statement_import (RPC)         ← único efeito no ledger
    → auditoria (bank-audit.ts) / reparo
```

Pontos importantes:

- `statementFingerprint` (`data.ts:19`) é SHA-256 dos bytes do arquivo; `findExistingStatementImport`
  bloqueia reimportação do mesmo arquivo na mesma conta.
- `buildSourceId` (`canonical.ts:113`) é a identidade determinística por linha
  (banco+conta+statementId+data contábil+valor+sentido+texto normalizado+índice, duplo FNV1a).
- Checkpoints de saldo são **conferência**, nunca movimentação. `OPENING` é conceito próprio
  (saldo anterior, fora do período) e nunca é reconstruído por heurística.
- Importação em lote (`batch.ts:40`) parseia cada arquivo isoladamente — nunca concatena PDFs.

**Heurística textual em SQL (atenção):** dentro de `confirm_bank_statement_import`, um débito cuja
descrição casa `~* '(pagto|pagamento).*(cart)'` vira `PAGAMENTO_CARTAO` automaticamente, e
`CREATE_PURCHASE` infere `forma_pagamento` por regex sobre a descrição. É a única classificação
econômica feita por texto livre no caminho de escrita.

---

## 6. Deduplicação e identidade

Três camadas, deliberadamente separadas (o código documenta que chave `data+valor+descrição` sozinha
apaga repetição legítima):

| Camada | Função | Chave |
| --- | --- | --- |
| Arquivo | `statementFingerprint` (bank `data.ts:19`) | SHA-256 dos bytes |
| Linha, dentro do documento | `buildSourceId` (`canonical.ts:113`) | hash determinístico da linha |
| Evento, composto | `movementKey` + `occurrenceKey` (`dedupe.ts:40,62`) | data\|valor\|sentido\|doc\|lote\|desc **+ `#ocorrência`** |
| Evento, cross-import | `economicKey` / `economicFingerprint` (`economic-identity.ts:28,36`) | data\|valor\|sentido\|desc **+ `#ocorrência`** |
| Fatura de cartão | `invoiceFingerprint` (`card-statement-persistence.ts:205`), `statementFingerprint` (`card-statements.ts:118`) | cartão\|emissor\|fechamento\|vencimento\|total |

- `classificarDuplicados` (`dedupe.ts:130`) só marca duplicata com **alvo concreto**: primeiro por
  `source_id` (confiança 100), depois por `occurrenceKey` (confiança 90). Nada é apagado — a duplicata
  nasce com ação `IGNORE`.
- `buildExistingMovementKeys` (`dedupe.ts:105`) está formalmente `@deprecated` justamente por não ter ordinal.
- `buildStatementSelection` (`statement-selection.ts:100`) elege **um** import canônico quando o mesmo
  período foi importado várias vezes; os demais viram `SAME_PERIOD_OVERLAP` e não geram restauração.
  Um candidato já representado por outro import é classificado `ALREADY_PRESENT_VIA_OTHER_IMPORT`
  (`persistence-repair.ts:136`).

---

## 7. Subsistema de reparo

Existem **três pares dry-run/apply distintos** — não há motor único:

**(a) Reparo de persistência (genérico, plan-driven)**
`persistence-repair.ts` → `repair-plan.ts` → `repair-precondition.ts` → `repair-proof.ts` →
`repair-impact.ts` → `repair-validation.ts` → **`repair-apply.ts`**.
- Gate: `evaluateRepairGate` (`repair-apply.ts:28`) exige `validationRepair === "PASS"`,
  `restoreCount === 1`, zero candidatos não restaurados, zero meses divergentes.
- Executa `rpc("apply_bank_persistence_repair")` e, se a pós-validação falhar,
  `rpc("revert_bank_persistence_repair")` — rollback explícito.
- Idempotência por outcome: `REPAIR_APPLIED | ALREADY_REPAIRED | REPAIR_PRECONDITION_FAILED |
  REPAIR_POST_VALIDATION_FAILED`.

**(b) Reparo financeiro do ledger Itaú (one-off autorizado)**
`financial-repair.ts` (dry run + `toFinancialRepairProof`) → `financial-repair-apply.ts`.
- Contém constante `REPAIR_TYPE = "ITAU_LEDGER_REPAIR_2026_01_06"` e `AUTHORIZED_REPAIR` com **IDs reais
  fixos no código**. É um reparo histórico único, não um motor genérico. Deve ser tratado como
  dívida técnica a remover após aplicação.

**(c) Falsa transferência**
`false-transfer-repair.ts` — apenas dry run (`buildFalseTransferDryRun:177`) + painel de leitura.
Nenhuma RPC de aplicação existe neste caminho.

**(d) Reprocessamento operacional** (fora da cadeia de prova):
`repair.ts` chama `reprocess_bank_statement_import`, `normalize_bank_opening_balances`,
`reprocess_bank_statement_checkpoints_only`, `reprocess_account_checkpoints_only`.

Validação encadeada (`chained-validation.ts:82,120`) distingue validação **mês isolado** (que mascara
erro ao reiniciar cada mês pelo saldo oficial do PDF) da validação **encadeada** real.

---

## 8. Reconciliação de fatura de cartão

`cardStatementPersistenceDryRun` (`card-statement-persistence.ts:402`):
- Casamento por composto (data, valor, descrição, final do cartão, parcela);
  valor exige igualdade (tolerância 0,01), janela de 5 dias, similaridade Dice com faixas 0,8 / 0,5.
- Status por item: `EXACT_MATCH | STRONG_MATCH | POSSIBLE_MATCH | NEW_ITEM | CONFLICT`.
  Qualquer `POSSIBLE_MATCH` cria bloqueio exigindo revisão manual — o sistema nunca confirma sozinho
  (mesma regra em `matchEntry`, `card-statements.ts:329`).
- Idempotência por `invoiceFingerprint` → `SAME_STATEMENT_ALREADY_IMPORTED`.
- Desfazer importação: `inspect_card_statement_import_undo` / `undo_card_statement_import`.

---

## 9. Motor financeiro (fórmulas reais)

- `src/lib/monthly-spending.ts:77-168` — gasto real do mês = compras da competência
  + **parcela do mês** (nunca o valor total do parcelamento) + recorrentes + fixas;
  pagamento de fatura é excluído para não contar duas vezes.
- `src/lib/free-cash.ts` — compromissos e dinheiro livre.
- `src/lib/financial-engine.ts` — receita total (fixa + média variável), compromissos, saúde financeira.
- `src/lib/monthly-snapshots.ts` — `buildSnapshotDraft` calcula ao vivo; o fechamento congela em
  `monthly_snapshots`.
- `src/lib/bank-ledger.ts` / `bank-audit.ts` — saldo derivado do ledger e conferência contra checkpoints.

---

## 10. Testes e goldens

Suites (`*.test.ts`): BB (`banco-do-brasil`, `bb-golden`, `detect-bb`), Itaú banco
(`itau-bank`, `itau-bank-h1`, `itau-golden`), Itaú cartão (`itau-spatial`, `itau-spatial.datas`,
`itau-iof`), Nubank (`nubank.golden`, `nubank.spatial`), persistência de cartão, match de fatura,
dedupe, batch, período, chained-validation, persistence-repair overlap, ledger, projeção de parcelas,
recorrências de ciclo, DANFE, tipo de documento, bloqueios de compra.

Goldens numéricos travados:
- Itaú banco: 17 movimentos, 7 checkpoints DAILY, saldo 120,81 em 17/06/2026 com fechamento **derivado**,
  referência 4,16 em 13/08/2026.
- Nubank cartão: 11 itens somando 155,99; emissão 10/08/2026 ≠ vencimento 17/08/2026; finais 9982 e 7274.
- Itaú cartão: total reconhecido 6.577,67 (e o total de seção não pode virar lançamento).
- BB: opening/closing por mês com `validation.math.difference === 0`.

---

## 11. Telas de diagnóstico (read-only)

| Rota | Gate | Natureza |
| --- | --- | --- |
| `/dev/bank-parser-diagnostics` | auth + `usePermissions().isAdmin` | dry run em memória |
| `/bancos/$accountId/diagnostico-parser` | auth + isAdmin | dry run em memória |
| `/bancos/diagnostico-importacao` | auth apenas | memória, sem escrita |
| `/bancos/$accountId/auditoria` | auth apenas | leitura + botões de reparo/reset |
| `/bancos/$accountId/plano-reparo` | auth apenas | dry run + execução controlada |
| `/bancos/$accountId/extratos/{revisar,lote}` | auth | revisão antes da escrita |

---

## 12. Higiene de código

- Nenhum `TODO`, `FIXME`, `HACK` ou `LEGACY` literal em `src/` (os hits de grep são a palavra
  portuguesa "todo/todos").
- Único marcador formal: `@deprecated` em `dedupe.ts:104`.
- Código morto identificado: `useExpenseSummary` (não consumido) e o CRUD antigo de `expenses`.

---

## 13. Achados para a auditoria externa

Ordenados por risco. Nada foi corrigido.

| # | Severidade | Achado | Evidência |
| --- | --- | --- | --- |
| 1 | Alta | `createPurchase` grava em várias tabelas sem transação atômica; falha parcial deixa compra sem itens/parcelas ou espelho legado órfão | `src/lib/purchases.ts:335-440` |
| 2 | Alta | Modelo duplo `purchases` + `expenses` ainda coexiste; espelho legado escrito só no caminho CREDITO | `purchases.ts`, `card-details.ts` |
| 3 | Alta | Reparo Itaú com IDs reais hard-coded (`AUTHORIZED_REPAIR`, `ITAU_LEDGER_REPAIR_2026_01_06`) dentro do bundle do cliente | `financial-repair-apply.ts:21-24` |
| 4 | Média | Classificação econômica por regex de descrição dentro de RPC de escrita (`pagto.*cart` → PAGAMENTO_CARTAO; inferência de forma de pagamento) | `confirm_bank_statement_import` |
| 5 | Média | Imports duplicados presentes no banco: 3 fingerprints iguais em `bank_statement_imports` para a conta `def1d8cc…`, e 17 `source_id` repetidos em `bank_statement_items` | consultas read-only |
| 6 | Média | 107 linhas em `transactions` sem `bank_account_id` | consulta read-only |
| 7 | Média | Três subsistemas de reparo paralelos com gates próprios; risco de divergência de invariantes | §7 |
| 8 | Média | `transactions` com uma única política de RLS — cobertura por operação precisa ser confirmada | catálogo de políticas |
| 9 | Baixa | Papéis em `family_members.permissao` em vez de tabela `user_roles` dedicada | schema |
| 10 | Baixa | Dois símbolos distintos chamados `selectBankStatementParser` (por banco e por nome de arquivo) | `parse.ts:56`, `bank-statement-parsers/index.ts:51` |
| 11 | Baixa | `false-transfer-repair` só tem dry run; correção equivalente depende do caminho (b) | `false-transfer-repair.ts` |
| 12 | Baixa | Rascunho de revisão de extrato vive em localStorage, não no banco | `bank-statements/draft.ts` |
| 13 | Info | `santanderParser` é stub de 18 linhas | `card-statement-parsers/santander.ts` |

## 14. NOT_PROVEN

- Cobertura exata por operação das políticas de `transactions`.
- Se o `POSSIBLE_MATCH` bloqueante da fatura é reexecutado após edição manual do usuário.
- Se os 107 `transactions` sem `bank_account_id` são todos de cartão (correlação não executada).
- Percentual de cobertura de testes (Vitest rodado sem `--coverage`).
