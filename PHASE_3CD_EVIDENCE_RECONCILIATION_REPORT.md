# FASE 3C + 3D — Financial Evidence Ingestion + Unified Reconciliation

Status: **IMPLEMENTADO** · Testes: 239 passando (34 arquivos), nenhum parser golden alterado.

## 1. Separação conceitual aplicada

| Conceito | Onde vive | Cria dinheiro? |
| --- | --- | --- |
| EVIDÊNCIA (PDF, print, foto) | `financial_evidence_imports` + bucket privado `evidencias-financeiras` | Não |
| EVENTO ECONÔMICO (compra/receita) | `purchases` | Sim, só após confirmação humana |
| EFEITO BANCÁRIO (saldo/fatura) | `transactions`, `card_invoices` | Sim, via triggers já existentes |

Uma compra pode ter N evidências (`purchase_evidence_links`) e continua sendo UMA compra.

## 2. Modelo canônico de candidato

`FinancialCandidateEvent` (`src/lib/financial-evidence/types.ts`) é a saída única de
qualquer ingestão: extrato PDF, fatura PDF, print de app, comprovante ou foto.
Confiança estrutural da fonte: PDF oficial = HIGH, print = MEDIUM, foto = LOW.

Adaptadores em `candidates.ts` apenas traduzem — não reinterpretam valores, datas
ou sinais produzidos pelos parsers golden (BB, Itaú extrato, Itaú fatura, Nubank).

## 3. Engine única de reconciliação

`reconcileFinancialCandidates` (`src/lib/financial-evidence/reconcile.ts`):

- **Linhagem vence score**: a mesma evidência reimportada é EXACT_MATCH idempotente.
- **Consumo estrito**: cada registro existente atende no máximo um candidato — duas
  compras legítimas iguais no mesmo dia nunca são fundidas.
- **Contexto obrigatório**: conta/cartão diferentes nunca se cruzam; sentido oposto
  nunca casa; valor divergente ou data acima de 10 dias desqualifica.
- **Ambiguidade vira CONFLICT**, jamais palpite silencioso.
- **Períodos sobrepostos**: sem correspondência dentro de janela já coberta por outra
  evidência → `NEW_IN_OVERLAP` (exige revisão, evita duplicar meses).
- **Fonte não-HIGH nunca fecha sozinha**: EXACT rebaixado para STRONG.

Status agregados: `PASS`, `REVIEW_REQUIRED`, `BLOCKED`, `ALREADY_INGESTED`.

## 4. Ingestão de imagem server-side

`extractFinancialEvidenceImage` (`extract.functions.ts`) roda no servidor via Lovable AI:
a chave nunca chega ao navegador. Retorna sempre dry run com estados explícitos
(`READY`, `EMPTY`, `PROVIDER_NOT_CONFIGURED`, `RATE_LIMITED`, `FAILED`), ignora saldos,
totais e simulações de parcelamento, e nunca inventa data ou valor.

## 5. Banco de dados

- `financial_evidence_imports` — hash do arquivo + contexto, com índice único por
  (família, tipo, hash, conta, cartão) garantindo idempotência de reenvio.
- `financial_evidence_items` — candidato + resultado da reconciliação + vínculo.
- `purchase_evidence_links` — N evidências por compra, com alvo único por linha.
- RLS family-scoped em todas, incluindo policies no bucket privado por pasta da família.

## 6. Superfícies de entrada

- **Bancos** → "Enviar comprovante (evidência)"
- **Cartões** → "Enviar print"
- **Compras** → "Enviar evidência"

Todas usam o mesmo componente `EvidenceImageDialog` e a mesma engine.

## 7. Garantias verificadas

- 11 testes novos cobrem idempotência, consumo único, conflito, sobreposição,
  rejeição por data/valor/contexto e rebaixamento por confiança da fonte.
- Nenhuma alteração em parsers, validadores, checkpoints ou motores financeiros.
- Nenhum caminho desta fase cria compra, movimentação ou saldo automaticamente.
