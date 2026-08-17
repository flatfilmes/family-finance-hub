# AUDIT CODE INDEX

Índice de arquivos e funções relevantes para auditoria. Somente leitura — nada foi alterado.

## Extração e detecção

| Arquivo | Símbolos |
| --- | --- |
| `src/lib/pdf-extract.ts` | `extractPdfPageLayouts:215`, `extractPdfLines:270`, `extractPdfText:298`, `layoutPageLines:309` |
| `src/lib/pdf-diagnostic/document-type.ts` | `detectDocumentType:107`, `DocumentTypeScore:28` |
| `src/lib/bank-statements/parse.ts` | `selectBankStatementParser:56`, `describeParserError:118`, `inspectParsedStatement:131`, `scoreBankStatement:340`, `detectBankStatement:366`, `runBankStatementParserPipeline:399`, `runObservableBankStatementParser:422` |

## Parsers bancários

| Arquivo | Símbolos |
| --- | --- |
| `src/lib/bank-statement-parsers/banco-do-brasil.ts` | `parseBBStatementPeriod:129`, `isBancoDoBrasil:160`, `scoreBancoDoBrasil:179`, `parseBancoDoBrasilLines:497`, `readBancoDoBrasilPdf:797` |
| `src/lib/bank-statement-parsers/itau.ts` | `detectItauBankStatement:162`, `detectarColunasItau:199`, `assembleItauRows:322`, `parseItauBankStatementLayouts:581`, `parseItauBankStatementLines:606`, `readItauBankStatementPdf:638` |
| `src/lib/bank-statement-parsers/generic.ts` | reexport do parser genérico |
| `src/lib/bank-statement-parsers/bb-description.ts` | montagem da descrição econômica BB |
| `src/lib/bank-statement-parsers/diagnostic.ts` | rastro do parser para a tela de diagnóstico |

## Núcleo bank-statements

| Arquivo | Símbolos |
| --- | --- |
| `canonical.ts` | `CanonicalStatement:57`, `buildSourceId:113`, `toCanonicalStatement:191`, `buildStatementSnapshot:313`, `readStatementSnapshot:349` |
| `validate.ts` | `CheckpointValidation:13`, `validateStatement:40` |
| `reconcile.ts` | `ReconcileSuggestion:19`, `TOLERANCIA_DIAS:60`, `reconcileMovement:77` |
| `dedupe.ts` | `movementKey:40`, `occurrenceKey:62`, `buildExistingMovementIndex:84`, `buildExistingMovementKeys:105 (@deprecated)`, `classificarDuplicados:130`, `marcarDuplicados:199`, `checkpointsInéditos:215` |
| `economic-identity.ts` | `economicKey:28`, `economicFingerprint:36`, `countEconomicOccurrences:41`, `createPresenceLedger:54` |
| `statement-selection.ts` | `buildStatementSelection:100`, `StatementCandidate:47`, `StatementGroup:68` |
| `period.ts` | `resolveStatementPeriod:38`, `groupCheckpointsByImport:85` |
| `batch.ts` | `parseStatementFilesIndependently:40`, `detectPeriodOverlaps:75`, `markDuplicatesAcrossBatch:99`, `consolidateBatchCheckpoints:140`, `summarizeBatch:169` |
| `batch-draft.ts` / `draft.ts` | rascunhos em localStorage (`saveStatementDraft:23`, `loadStatementDraft:32`, `clearStatementDraft:44`) |
| `data.ts` | `statementFingerprint:19`, `findExistingStatementImport:28`, `createBankStatementImport:41`, `fetchBankBalanceCheckpoints:194`, `confirmBankStatementImport:215`, `deleteBankStatementImport:252` |
| `lineage.ts` | `lineageSourceId:169`, `compareParsedStatementToLedger:181`, `buildAccountLineage:490` |
| `document-evidence.ts` | `BB_DOCUMENT_EVIDENCE:24`, `documentEvidenceFor:51` |
| `chained-validation.ts` | `buildStandaloneValidation:82`, `buildChainedValidation:120`, `classifyCheckpointDiagnostic:191` |
| `dry-run.ts`, `diagnostics.ts`, `golden.ts` | motores de diagnóstico e datasets golden |

## Reparo

| Arquivo | Símbolos |
| --- | --- |
| `persistence-repair.ts` | `PersistenceRepairPlan:139`, `buildPersistenceRepairPlan:212`, `repairPlanToCsv:572`, `SAME_PERIOD_OVERLAP:118`, `ALREADY_PRESENT_VIA_OTHER_IMPORT:136` |
| `repair-plan.ts` | `RepairSeverity:30`, `RepairAction:32`, `buildRepairPlan:62` |
| `repair-precondition.ts` | `PreconditionLineStatus:25`, `RepairPrecondition:49`, `buildRepairPrecondition:74` |
| `repair-proof.ts` | `buildCollisionGroups:69`, `buildPropagation:132`, `buildRepairProof:154` |
| `repair-impact.ts` | `analyzeRepairImpact:86` |
| `repair-validation.ts` | `LedgerPreview:29`, `ValidatedCandidate:44`, `buildRepairValidation:87` |
| `repair-apply.ts` | `evaluateRepairGate:28`, `applyPersistenceRepair:74` → `apply_bank_persistence_repair:82`, `revert_bank_persistence_repair:132` |
| `financial-repair.ts` | `buildFinancialRepairDryRun:118`, `toFinancialRepairProof:448` |
| `financial-repair-apply.ts` | `REPAIR_TYPE:21`, `AUTHORIZED_REPAIR:24`, `checkProofGate:76`, `validateRepairExecution:147`, `applyFinancialLedgerRepair:302` |
| `false-transfer-repair.ts` | `FALSE_TRANSFER_REPAIR_TYPE:23`, `buildFalseTransferDryRun:177` (somente dry run) |
| `repair.ts` | `reprocessBankStatementImport:116`, `normalizeOpeningBalances:152`, `reprocessCheckpointsOnly:213`, `reprocessAccountCheckpointsOnly:222` |
| `reprocess.ts` | `apply_statement_posting_dates:104` |

## Cartões

| Arquivo | Símbolos |
| --- | --- |
| `card-statement-parsers/index.ts` | `STATEMENT_PARSERS:13`, `pickStatementParser:20`, `readCardStatementPdf:34` |
| `card-statement-parsers/itau-spatial.ts` | `COLUMN_SPLIT/Y_TOLERANCE/CATEGORY_Y_OFFSET:45-47`, `buildRowsByY:88`, `splitColumns:114`, `parseItauSpatial:166` |
| `card-statement-parsers/itau.ts` | `secaoDaLinha:168`, `ehRuido:203`, `ehProibido:232`, `ehMetadataItau:274`, `montarIof:296`, `parseItau:458`, `parseItauLayout:769` |
| `card-statement-parsers/nubank.ts` | `parseNubank:478`, `parseNubankSpatial:483`, `nubankParser:487` |
| `card-statement-parsers/generic.ts` | `normalizeDescricao:20`, `lerData:48`, `lerValor:67`, `classificarLancamento:87`, `lerLancamentos:218`, `parseGeneric:282` |
| `card-statement-persistence.ts` | `CardDryRunItemStatus:20`, `mapearCartoes:147`, `invoiceFingerprint:205`, scoring `:260-291`, `cardStatementPersistenceDryRun:402` |
| `card-statements.ts` | `statementFingerprint:118`, `matchEntry:329`, `findDuplicateImport:799`, `inspectUndoStatementImport:941`, `undoStatementImport:954`, `processStatementPdf:1072` |
| `card-invoices.ts`, `card-recurrences.ts`, `card-installment-projection.ts`, `card-details.ts` | ciclos, parcelas e projeção |

## Domínio financeiro

| Arquivo | Papel |
| --- | --- |
| `src/lib/purchases.ts` | `createPurchase:335`, `inspect_purchase_deletion:479`, `delete_purchase_safely:493`, `inspect_purchase_merge:545`, `merge_duplicate_purchase:555` |
| `src/lib/transactions.ts` | `pay_card_invoice:50`, `transfer_between_accounts:72` |
| `src/lib/bank-movements.ts` | `register_bank_movement:62`, `reverse_bank_transaction:81` |
| `src/lib/bank-accounts.ts` | `archive_bank_account:64`, `delete_bank_account_if_unused:70`, `adjust_bank_account_balance:83`, `set_bank_account_balance:103` |
| `src/lib/bank-ledger.ts`, `bank-audit.ts` | saldo derivado e auditoria contra checkpoints |
| `src/lib/monthly-spending.ts` | `buildSpendingBreakdown` (gasto real da competência) |
| `src/lib/free-cash.ts`, `financial-engine.ts` | compromissos, dinheiro livre, saúde financeira |
| `src/lib/monthly-snapshots.ts` | fechamento/reabertura mensal |
| `src/lib/family.ts`, `family-backup.ts`, `demo.ts` | família, resets e modo demonstração |

## Rotas sensíveis

`src/routes/_authenticated/route.tsx:6` (guard) ·
`dev.bank-parser-diagnostics.tsx` (isAdmin) ·
`bancos_.$accountId.diagnostico-parser.tsx` (isAdmin) ·
`bancos_.diagnostico-importacao.tsx` ·
`bancos_.$accountId.auditoria.tsx` ·
`bancos_.$accountId.plano-reparo.tsx` ·
`bancos_.$accountId.extratos.revisar.tsx` · `bancos_.$accountId.extratos.lote.tsx`

## Testes

`bank-ledger` · `bank-statement-parsers/{banco-do-brasil,bb-golden,itau-bank,itau-bank-h1,itau-golden}` ·
`bank-statements/{batch,chained-validation,dedupe,detect-bb,period,persistence-repair.overlap}` ·
`card-statement-parsers/{itau-iof,itau-spatial,itau-spatial.datas,nubank.golden,nubank.spatial}` ·
`card-statement-persistence` · `card-statements.match` · `card-statements.nota-fatura` ·
`card-cycle-recurrences` · `card-cycle-value` · `card-details` · `card-installment-projection` ·
`card-official-recurrences` · `danfe/danfe-spatial` · `pdf-diagnostic/document-type` · `purchases.bloqueios`
