# FASE 3E — Financial Evidence Review + Safe Confirmation

Cadeia implementada e comprovada:

```text
FILE / IMAGE → EXTRACTION → FinancialCandidateEvent → UNIFIED RECONCILIATION
→ REVIEW (FinancialEvidenceReview) → ConfirmationPlan → CANONICAL DOMAIN OPERATION
→ ECONOMIC EVENT
```

Nenhum caminho `FILE/IMAGE → INSERT FINANCEIRO` existe: a UI não insere compras
nem movimentações; ela monta o plano e chama `confirmFinancialCandidate`, que
usa exclusivamente `create_purchase_complete` e `register_bank_movement`.

## Arquitetura entregue

| Camada | Arquivo |
| --- | --- |
| Plano determinístico + engine única de efeito | `src/lib/financial-evidence/plan.ts` |
| Executor canônico e idempotente | `src/lib/financial-evidence/confirm.ts` |
| Dependências reais (RPCs canônicas + RLS) | `src/lib/financial-evidence/confirm.data.ts` |
| Tela única de revisão (todas as origens) | `src/components/evidence/financial-evidence-review.tsx` |
| Trilha de auditoria | tabela `financial_evidence_reviews` + colunas de confirmação em `financial_evidence_items` |

## Resultados

| Indicador | Resultado |
| --- | --- |
| UNIFIED_REVIEW_UI | PASS |
| EXACT_MATCH_CREATES_ECONOMIC_EVENT | 0 |
| STRONG_MATCH_AUTOCONFIRMED | 0 |
| POSSIBLE_MATCH_AUTOCONFIRMED | 0 |
| CONFLICT_AUTOCONFIRMED | 0 |
| NEW_PURCHASE_USES_CANONICAL_RPC | PASS |
| CANDIDATE_CONFIRMATION_IDEMPOTENT | PASS |
| BATCH_RETRY_DUPLICATE_EFFECT | 0 |
| EVIDENCE_LINK_MULTIPLE_SOURCES | PASS |
| SCREENSHOT_THEN_STATEMENT_DUPLICATES | 0 |
| STATEMENT_THEN_RECEIPT_DUPLICATES | 0 |
| OVERLAP_RETROACTIVE_SUPPORTED | PASS |
| CHECKPOINT_CONFLICT_BLOCKED | PASS (`HISTORICAL_LEDGER_REVIEW_REQUIRED`) |
| IDENTICAL_LEGIT_EVENTS_PRESERVED | PASS |
| EVIDENCE_DELETE_PURCHASE_DELETE | 0 (`ON DELETE SET NULL`; compra é evento canônico) |
| CROSS_FAMILY_CONFIRM | BLOCKED (RLS family-scoped + identidade de confirmação por família) |
| PREVIEW_EXECUTOR_DOMAIN_PARITY | PASS (`buildExpectedEffects` é a única fórmula) |
| ALL_TESTS | PASS |
| TOTAL_TESTS | 261 (33 skipped) — 22 novos em `confirmation.test.ts` |
| GOLDEN_BB | PASS |
| GOLDEN_ITAU_BANK | PASS |
| GOLDEN_ITAU_CARD | PASS |
| GOLDEN_NUBANK | PASS |

## Garantias de segurança

- Autorização revalidada no servidor: as RPCs canônicas e as políticas RLS
  conferem `auth.uid()`, família, membro e propriedade de conta/cartão; nada
  vindo da tela é tratado como verdade.
- Idempotência em três níveis: voo em andamento (duplo clique), estado
  persistido (`confirmation_status`, `created_purchase_id`,
  `created_transaction_id`) e chave determinística enviada como
  `p_client_request_id` para a RPC (retry/timeout).
- Batch sem transação gigante: cada candidato tem confirmação própria; falha
  de um item não cria estado parcial nele nem reprocessa os já concluídos.
- Nenhuma decisão automática por IA: extração sugere, humano confirma.

## Fora do escopo (não alterado)

Dashboard, Planejamento, Relatórios, Fechamento mensal, fórmula de Dinheiro
Livre Hoje e categorização autônoma permanecem intactos. Nenhum parser sofreu
alteração matemática.
