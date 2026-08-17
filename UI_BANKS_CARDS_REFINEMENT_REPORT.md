# UI_BANKS_CARDS_REFINEMENT_REPORT

Escopo: apenas layout, hierarquia visual e posicionamento de acessos.
Nenhuma query, fórmula, RPC, parser, engine de evidência ou migração foi alterada.

## Bancos

| Item | Status |
| --- | --- |
| BANK_GENERAL_SEARCH | REMOVED |
| BANK_GENERAL_PERSON_FILTER | REMOVED |
| BANK_GENERAL_BANK_FILTER | REMOVED |
| BANK_PERIOD_FILTER | PRESERVED_COMPACT (no cabeçalho, sem card próprio) |
| BANK_IMPORT_DIAGNOSTIC_GENERAL | REMOVED |
| BANK_IMPORT_DIAGNOSTIC_ACCOUNT_DETAIL | AVAILABLE (menu "Mais" da conta → /bancos/$accountId/diagnostico-parser) |
| BANK_HEADER_SPACING | IMPROVED (mt-8 entre ações e KPIs) |

Cards de conta: apelido → instituição → saldo → "Abrir conta →". Agrupamento por titular preservado.
O escopo por perfil (membro/visualizador) continua aplicado via `view.scoped("")`.

## Cartões

| Item | Status |
| --- | --- |
| CARD_GENERAL_SEARCH | REMOVED |
| CARD_GENERAL_FILTERS | REMOVED |
| CARD_GENERAL_IMPORT_BUTTON | REMOVED |
| CARD_DETAIL_IMPORT_BUTTON | AVAILABLE (ações do topo do cartão) |
| CARD_GENERAL_IMPORT_HISTORY | REMOVED (substituído por alerta compacto de revisão pendente) |
| CARD_DETAIL_IMPORT_HISTORY | AVAILABLE (seção final "Faturas importadas e ferramentas") |
| CARD_SUMMARY_PRIMARY_FIELDS | INVOICE_AMOUNT + DUE_DATE |
| CARD_SUMMARY_LIMIT | REMOVED_FROM_SUMMARY |
| CARD_SUMMARY_USED | REMOVED_FROM_SUMMARY |
| CARD_SUMMARY_AVAILABLE | REMOVED_FROM_SUMMARY |
| CARD_SUMMARY_PROGRESS_BAR | REMOVED_FROM_SUMMARY |

Identidade do cartão exibida como `nome_cartao` + `cardSubtitle` (emissor · bandeira · •••• final).
KPIs consolidados, composição das faturas e status de capacidade preservados sem mudança de cálculo.

## Garantias

| Item | Status |
| --- | --- |
| FINANCIAL_LOGIC_CHANGED | NO |
| DATABASE_CHANGED | NO |
| PARSERS_CHANGED | NO |
| ROUTES_CREATED | NO |
| ALL_TESTS | PASS (36 arquivos, 272 testes) |

Novos testes de arquitetura de UI: `src/lib/ui-banks-cards-overview.test.ts`.
