# Auditoria Técnica Completa — Família Finance AI
**Data:** 16 de agosto de 2026 · **Escopo:** estado real do projeto neste momento · **Natureza:** somente leitura (nenhuma funcionalidade, tabela, RLS ou cálculo foi alterado)
**Base de evidências:** 30 migrations SQL aplicadas, ~23.3k linhas de TypeScript/TSX em `src/`, consultas SQL diretas ao banco de produção-preview e execução do app em navegador headless.

---

## 1. RESUMO EXECUTIVO

### Estado atual do produto
SaaS de inteligência financeira familiar em português (pt-BR), rodando em TanStack Start v1 (React 19 + Vite 7) com backend Lovable Cloud (Supabase). O produto saiu da fase "cadastro de finanças" e hoje é um **motor financeiro família-cêntrico** onde a **compra é o evento central**: toda compra gera (ou deixa de gerar, no caso de pagamento futuro) impacto correto em conta bancária, cartão, fatura, parcelas e recorrências, com fechamento mensal congelando o retrato de cada competência.

### Módulos existentes
| Módulo | Estado |
|---|---|
| Autenticação + estrutura familiar + papéis | Funcional |
| Compras (manual, parcelada, recorrente, pagar depois, importação NF-e) | Funcional |
| Bancos (contas por membro, saldo, extrato) | Funcional |
| Cartões (limite, ciclo, fatura, pagamento, projeção 3 meses) | Funcional |
| Dashboard financeiro (10+ métricas + Central de Atenção) | Funcional |
| Planejamento (orçamento por categoria/mês) | Funcional |
| Histórico e fechamento mensal (snapshots + auditoria) | Funcional |
| Importação de PDF DANFE/NF-e (parser próprio, sem IA) | Funcional com escopo estreito |
| Biblioteca de tipos de documento + casos de teste | Estrutural, pouco exercitado |
| Modo demonstração isolado | Funcional |
| Relatórios | Apenas hub de links |
| Metas financeiras, IA, QR Code NFC-e | Não implementados |

### Nível de maturidade
**MVP avançado / beta interno.** O núcleo contábil está coerente e matematicamente verificável (validado neste relatório, §23). O que impede considerar "produção" é: dois motores de cálculo paralelos (`expenses` legado x `purchases`), duas RPCs SECURITY DEFINER sem verificação de autorização (§20, CRÍTICO), políticas de Storage grossas demais, ausência total de paginação e um conjunto de rotas legadas ainda navegáveis.

### Principais mudanças desde a auditoria anterior (`auditoria-compras-bancos-cartoes.md`)
1. **Gastos do mês por competência** (`src/lib/monthly-spending.ts`) — parcelada entra pela parcela do mês, nunca pelo valor total.
2. **Comprometido e Dinheiro livre hoje reescritos** (`src/lib/free-cash.ts`) com janela até o próximo recebimento, reserva de segurança e diálogos de composição.
3. **Fechamento mensal** — tabelas `monthly_snapshots` e `monthly_closing_logs`, área Histórico, reabertura só por ADMIN com motivo registrado.
4. **Compra x Pagamento** — `PENDENTE_PAGAMENTO`, forma `A_DEFINIR`, `data_prevista_pagamento`/`data_pagamento_real`, ação "Registrar pagamento".
5. **Páginas dedicadas** `/bancos/$accountId` e `/cartoes/$cardId`; filtros por pessoa persistidos (`useStickyState`).
6. **Configurações unificadas** em "Família e Finanças"; navegação reduzida a 8 itens.
7. **Polimento de consistência** — `src/lib/status.ts` (5 tons), `status-badge`, `empty-state`, `search-input`, `form-dialog`, e a Central **"Precisa da sua atenção"** (`src/lib/attention.ts`).
8. **Categorização por item** de nota fiscal com sugestão determinística e persistência corrigida.

### Já funcional
Cadastro familiar e papéis; compras nas 4 modalidades; débito bancário automático; fatura com ciclo real; parcelamento vinculado às faturas futuras; recorrências com cancelamento sem perder histórico; pagamento de fatura como evento único; dashboard com composição auditável; fechamento/reabertura de mês; importação de DANFE PDF validada ponta a ponta; modo demo isolado.

### Ainda incompleto
Relatórios de verdade; metas; IA/recomendações; QR Code NFC-e; OCR de imagem (foto de cupom); aprendizado de categorias (dado `categoria_ajustada` é coletado e nunca lido); trilha `purchase_imports` órfã; motor legado `expenses` coexistindo com `purchases`; paginação; testes automatizados (nenhum).

---

## 2. ARQUITETURA ATUAL

- **Frontend:** React 19 + TanStack Router (roteamento por arquivos em `src/routes`) + TanStack Query v5 + Tailwind v4 (`src/styles.css`, tokens semânticos) + shadcn/ui + lucide + sonner. Fonte Plus Jakarta Sans, paleta verde/teal.
- **Backend:** sem server functions de domínio. **Toda a lógica de negócio roda no cliente** contra a Data API do Supabase (PostgREST), com regras críticas empurradas para **triggers e funções SQL**. `src/server.ts`/`src/start.ts` só sustentam SSR e captura de erros.
- **Banco:** PostgreSQL (Lovable Cloud), 30 tabelas em `public`, 18 enums, 13 funções, 35 triggers.
- **Autenticação:** Supabase Auth (email/senha + Google). Guarda de rota em `src/routes/_authenticated/route.tsx` via `supabase.auth.getUser()`.
- **RLS:** habilitada em 100% das tabelas, com duas camadas — família (`is_family_member`/`is_family_admin`) e registro individual (`can_view_member_record`/`can_manage_member_record`).
- **Camada server-side:** existe `src/integrations/supabase/client.server.ts` (service role) porém **não é usada por nenhuma rota ou componente** hoje.
- **TanStack Query:** chaves no padrão `[recurso, familyId]`; invalidação centralizada em `invalidateFinanceQueries()`; nenhuma agregação server-side; nenhum `range()`/paginação.
- **Storage:** bucket privado `documentos-financeiros`, path `familia/{family_id}/documentos/{timestamp}-{arquivo}`, URLs assinadas.
- **Processamento de documentos:** 100% client-side com `pdfjs-dist` (`src/lib/pdf-extract.ts`), parser posicional de DANFE, detecção heurística de tipo (`src/lib/document-types.ts`), sugestão de categoria por palavra-chave (`src/lib/category-suggest.ts`). Sem OCR, sem IA, sem QR.
- **Rotas atuais:** 21 arquivos de rota (detalhe na §3).

---

## 3. MAPA COMPLETO DE NAVEGAÇÃO

### Menu lateral (`src/components/app-shell.tsx`)
| Item | Rota | Função |
|---|---|---|
| Dashboard | `/dashboard` | Única área de análise do mês corrente: saúde financeira, receita, comprometido, gastos, dinheiro livre, cartões, compromissos futuros, Central de Atenção, fechamento |
| Compras | `/compras` | Fonte primária de tudo o que é consumido: registro manual, "pagar depois", importação de nota, filtros, busca, consumo por produto/categoria |
| Bancos | `/bancos` | Contas por membro, saldos consolidados, entradas/saídas |
| Cartões | `/cartoes` | Limite, utilização, fatura atual, projeção e pagamento |
| Planejamento | `/planejamento` | Orçamento por categoria e competência, semáforo de limite |
| Histórico | `/historico` | Competências fechadas, comparação entre meses |
| Relatórios | `/relatorios` | Hub de links para visões consolidadas (ainda raso) |
| Configurações | `/configuracoes` | "Família e Finanças", Preferências, Segurança, Modo Demonstração |

### Páginas internas e rotas fora do menu
| Rota | Papel |
|---|---|
| `/bancos/$accountId` | Detalhe da conta: saldo, extrato com busca, compras vinculadas |
| `/cartoes/$cardId` | Detalhe do cartão: fatura atual linha a linha, parcelamentos ativos, próximas obrigações, pagamento |
| `/membro/$memberId` | Vida financeira individual: dados pessoais, receitas, contas, cartões, permissões |
| `/historico/$ano/$mes` | Snapshot de uma competência (familiar + por membro) |
| `/historico/fechar/$ano/$mes` | Revisão e confirmação do fechamento |
| `/configuracoes` → blocos | Família e membros · Receitas, contas e cartões · Perfil financeiro · Permissões |
| `/despesas` | **Legado** — CRUD sobre a tabela `expenses`, fora do menu, ainda acessível por URL |
| `/receitas` | **Legado** — consolidado de receitas; ainda linkado do Dashboard vazio; exporta `NoFamily` usado por 6 páginas |
| `/contas-fixas` | **Legado** — CRUD de contas fixas; linkado de Configurações |
| `/perfil-financeiro` | **Legado** — renda/dependentes/objetivo |
| `/minha-familia` | Rota morta com `redirect` para `/configuracoes` |
| `/auth`, `/reset-password`, `/` | Autenticação e entrada |
| Revisão de compra importada | Não é rota: é o estado `ConferirCompra` dentro de `src/components/purchase-capture.tsx`, montado em `/compras` |

---

## 4. MODELO FAMILIAR

**Família** (`families`) → **Membros** (`family_members`, com `permissao` ADMIN/MEMBER/VIEWER) → **Perfil financeiro do membro** (`member_financial_profiles`, com `tipo_perfil` ADMIN_FAMILIAR/MEMBRO/DEPENDENTE/VISUALIZADOR + `pode_lancar_despesas` + `pode_ver_proprios_dados`).

| Papel | Enxerga | Edita |
|---|---|---|
| ADMIN_FAMILIAR (`permissao=ADMIN` ou `owner_id`) | Tudo da família, todos os membros, todos os snapshots | Tudo, inclusive fechar/reabrir mês, pagar fatura, apagar dados demo, alterar permissões |
| MEMBRO (`MEMBER`) | Registros próprios **+ todos os registros com `member_id` nulo** | Só registros próprios, e apenas se `pode_lancar_despesas = true` |
| DEPENDENTE | Igual a MEMBRO ou VIEWER conforme a `permissao` real em `family_members` | **Sem enforcement próprio** — `tipo_perfil` não é lido por nenhuma policy |
| VISUALIZADOR (`VIEWER`) | Registros próprios + registros sem dono | Nada (bloqueado em `can_manage_member_record` por `permissao <> 'VIEWER'`) |

**Uso de `member_id`:** presente em `incomes`, `fixed_expenses`, `credit_cards`, `bank_accounts`, `expenses`, `purchases`, `transactions`, `expense_installments`, `recurring_expenses`, `documents`, `monthly_snapshots`. É simultaneamente (a) chave de autorização nas policies e (b) chave de filtro na UI.

**Família vs Individual:** `src/components/view-mode.tsx` expõe `useViewMode()`; o Dashboard calcula `escopo = view.scoped(filtroMembro)` — string vazia = família inteira, UUID = membro. Todos os hooks financeiros aceitam esse escopo e aplicam `filterByMember`. Não-admins ficam travados na própria visão; admin alterna livremente entre Família e Minha, e ainda pode escolher qualquer pessoa no seletor.

**Alerta:** `tipo_perfil` é decorativo no backend. A UI trata DEPENDENTE como restrito, mas o banco só conhece ADMIN/MEMBER/VIEWER + `pode_lancar_despesas`.

---

## 5. BANCO DE DADOS COMPLETO

30 tabelas em `public`, **todas com RLS habilitada e GRANTs explícitos**. Convenção geral: `id uuid PK default gen_random_uuid()`, `family_id NOT NULL FK families ON DELETE CASCADE`, `created_at/updated_at` com trigger `update_updated_at_column()`.

### Núcleo de identidade e família
| Tabela | Objetivo | Pontos relevantes |
|---|---|---|
| `profiles` | Espelho de `auth.users` | PK = FK `auth.users(id)`; policies só do próprio usuário; **tem GRANT DELETE sem policy DELETE** (grant morto). Trigger `handle_new_user()` popula no signup. Usada em `family.ts`, `configuracoes.tsx` |
| `families` | Unidade familiar | `owner_id`, `is_demo`. SELECT membro, UPDATE admin, DELETE owner. `demo.ts`, `family.ts` |
| `family_members` | Pessoas da família | UNIQUE(family_id,user_id); índices em family_id e user_id; escrita só admin. `family-admin.tsx`, `membro.$memberId.tsx` |
| `member_financial_profiles` | Perfil financeiro individual | UNIQUE(family_member_id); `tipo_perfil`, `pode_lancar_despesas`, `pode_ver_proprios_dados`. Lido por `can_manage_member_record` (só o booleano). `member-profiles.ts` |
| `financial_profiles` | Perfil financeiro da família | UNIQUE(family_id); objetivo, renda principal, dependentes. `perfil-financeiro.tsx` |
| `financial_settings` | Parâmetros do motor | `percentual_reserva`, `limite_alerta_cartao`. Usado em `free-cash.ts`/`financial-engine.ts` |

### Entradas e obrigações fixas
| Tabela | Objetivo | Pontos relevantes |
|---|---|---|
| `incomes` | Receitas fixas e variáveis | `tipo` FIXA/VARIAVEL, `frequencia`, `member_id`. Índices family/member. Base de `guaranteedMonthlyIncome()` e da reserva |
| `fixed_expenses` | Contas recorrentes clássicas | `categoria`, `vencimento` (dia), `recorrencia`, `ativo`, `member_id`. Entram em Gastos do mês e em Comprometido |
| `budgets` | Orçamento por categoria/competência | UNIQUE(family_id,category_id,mes,ano); RLS por família (sem `member_id`, por design) |

### Bancos, cartões e razão
| Tabela | Objetivo | Pontos relevantes |
|---|---|---|
| `bank_accounts` | Contas por membro | `saldo_atual` é **mutado por triggers e também editável direto pelo cliente** (risco §20) |
| `credit_cards` | Cartões por membro | `limite`, `dia_fechamento`, `dia_vencimento`, `ativo` |
| `card_invoices` | Faturas por ciclo | UNIQUE(credit_card_id, data_fechamento); índice (family, card, vencimento); RLS deriva do cartão, não do próprio `family_id` |
| `expense_installments` | Parcelas | UNIQUE(expense_id, numero_parcela); `card_invoice_id`, `purchase_id`, `member_id`, `status` |
| `transactions` | Livro-razão | tipos ENTRADA/SAIDA/TRANSFERENCIA/PAGAMENTO_CARTAO; `purchase_id ON DELETE CASCADE`; **escrita direta permitida ao cliente** (risco §20) |
| `recurring_expenses` | Assinaturas e recorrências | `periodicidade`, `proxima_cobranca`, `data_inicio`, `data_cancelamento`, `ativo`, vínculo opcional a cartão/conta |

### Compras e produtos
| Tabela | Objetivo | Pontos relevantes |
|---|---|---|
| `purchases` | **Evento central** | `tipo_compra`, `forma_pagamento`, `status_pagamento`, `credit_card_id`, `bank_account_id`, `transaction_id`, `data_prevista_pagamento`, `data_pagamento_real`. 3 triggers (status, saldo bancário, sincronização de transação) |
| `purchase_items` | Itens da compra | `categoria_id`, `categoria_sugerida`, `categoria_ajustada`; RLS por EXISTS na compra |
| `products` | Catálogo global | Somente leitura para autenticados |
| `expense_categories` | Categorias (34 após expansão) | Somente leitura para autenticados |
| `expenses` | **Ponte legada** | Ainda é criada por `createPurchase()` quando há cartão, pois `expense_installments.expense_id` é NOT NULL. Índices (family,data), categoria, member |

### Documentos e captura
| Tabela | Objetivo |
|---|---|
| `documents` | Arquivo enviado (path no Storage, status, tipo detectado, confiança) |
| `document_extractions` / `document_extraction_items` | Resultado estruturado do parser (cabeçalho + itens + `dados_brutos_json`) |
| `purchase_imports` / `purchase_import_items` | Trilha de aprovação **legada/órfã** — não usada pelo fluxo atual |
| `document_types` | Catálogo de 10 tipos (DANFE_NFE, NFCE, CUPOM_FISCAL, …), estratégia de leitura, prioridade |
| `document_test_cases` | Casos de regressão do parser. **Gravável por qualquer autenticado, sem `family_id`** (risco §20) |

### Fechamento e demo
| Tabela | Objetivo |
|---|---|
| `monthly_snapshots` | Retrato congelado da competência: renda fixa/variável, saldo final, gastos, comprometido, reserva, dinheiro livre, saúde, `fechado`, quem fechou/reabriu, motivo. Dois índices únicos parciais (familiar com `member_id IS NULL`, individual com `member_id`). Escrita só ADMIN |
| `monthly_closing_logs` | Trilha imutável FECHAR_MES/REABRIR_MES (GRANT só SELECT+INSERT, sem policy de UPDATE/DELETE) |
| `demo_settings` | Flag de modo demonstração por família |

### Sobre `audit_log`
**Não existe** tabela `audit_log` no projeto. A auditoria hoje é parcial e específica: `monthly_closing_logs` (fechamento) + campos `created_by`/`fechado_por`/`reaberto_por`. Não há trilha de alterações em compras, saldos ou permissões.

### Funções e triggers
13 funções (7 SECURITY DEFINER de autorização/negócio + triggers). Destaques: `pay_card_invoice` (valida permissão e família antes de debitar), `delete_demo_data` (só famílias `is_demo` das quais o chamador é admin), `ensure_invoice_for_due` e `sync_installment_invoices` (**sem validação de autorização** — §20), `purchase_transaction_sync` (usa `pg_trigger_depth()` contra recursão), `purchase_bank_balance_sync` (só PIX/DÉBITO/TRANSFERÊNCIA afetam saldo; DINHEIRO nunca).

---

## 6. COMPRAS

### Tipos (`purchases.tipo_compra`)
- **COMPRA_NORMAL** — à vista ou crédito em 1x.
- **COMPRA_PARCELADA** — gera N `expense_installments`, cada uma na fatura do seu ciclo.
- **COMPRA_RECORRENTE** — cria registro em `recurring_expenses` (ex.: Netflix).
- **CONTA_RECORRENTE** — conta de consumo recorrente fora do cartão.
- **Pagamento pendente** não é um tipo, é um **estado**: `forma_pagamento = A_DEFINIR` + `status_pagamento = PENDENTE_PAGAMENTO`.

### Formas de pagamento
`PIX`, `DINHEIRO`, `DEBITO`, `CREDITO`, `BOLETO`, `TRANSFERENCIA`, `OUTRO`, `A_DEFINIR` (pagar depois). Apenas `PIX/DEBITO/TRANSFERENCIA` movem `bank_accounts.saldo_atual`; `DINHEIRO` é saída de caixa sem efeito bancário.

### Ciclo de vida
1. `createPurchase()` (`src/lib/purchases.ts`) insere em `purchases`.
2. Trigger `purchases_payment_status` deriva o `status_pagamento` a partir da forma e limpa campos incoerentes.
3. Trigger `purchases_bank_balance` debita a conta quando a forma é bancária e o status é PAGO.
4. Trigger `purchase_transaction_sync` cria/recria a linha em `transactions` (SAIDA, CONFIRMADA ou PENDENTE) e grava `transaction_id` na compra.
5. Em crédito, a camada de aplicação cria uma `expenses` espelho e chama `generateInstallments()`, que resolve o ciclo (`cycleForDate`), garante a fatura (`ensureInvoice`) e recalcula `card_invoices.valor_total`.
6. Em recorrente, insere em `recurring_expenses` com `proxima_cobranca`.

**Itens:** `purchase_items` guarda descrição, quantidade, unidade, valor unitário/total, `categoria_id` (confirmada), `categoria_sugerida` e `categoria_ajustada`. A categoria confirmada pelo usuário sempre vence a sugerida.

**Responsável:** `member_id` obrigatório na prática (define autorização e filtros). **Impacto financeiro:** resumido em §13. **Filtros e busca em `/compras`:** pessoa (com view Família/Minha), tipo, período, texto livre (estabelecimento/observação), com estados vazios contextualizados.

---

## 7. PAGAMENTO PENDENTE

**Implementado e verificado.** Fluxo: compra registrada hoje com "Pagar depois" → `forma_pagamento = A_DEFINIR`, `status_pagamento = PENDENTE_PAGAMENTO`, `data_prevista_pagamento` informada, `bank_account_id`/`credit_card_id` forçados a nulo pelo trigger, `data_pagamento_real` nulo.

Enquanto pendente: **não reduz saldo bancário, não cria transação confirmada, não entra na fatura, não consome limite**. Entra sim em: **Gastos do mês** (regime de competência, pela `data_compra`) e em **Comprometido / Dinheiro livre hoje** quando a data prevista cai antes do próximo recebimento.

"Registrar pagamento" (`src/components/purchase-payment.tsx` → `registerPurchasePayment()`) define a forma real, a conta ou cartão e `data_pagamento_real`; só nesse momento os triggers produzem o efeito bancário/cartão. Evidência no demo: compra `MERCADO JUNIOR` de R$ 5,00 em 16/08, prevista para 22/08, hoje sem transação confirmada e sem efeito de saldo.

---

## 8. BANCOS

Contas pertencem a um membro (`bank_accounts.member_id`) e a uma família. A página `/bancos` consolida saldos com filtro por pessoa; `/bancos/$accountId` mostra extrato com busca.

**Fonte de verdade do saldo:** o campo `bank_accounts.saldo_atual`, **não** a soma de `transactions`. Ele é mantido por: trigger `purchase_bank_balance_sync` (compras à vista bancárias) e função `pay_card_invoice` (pagamento de fatura). `transactions` é livro-razão de exibição/histórico, não a fonte do saldo.

**Risco de dupla contagem:** eliminado nos fluxos automáticos — pagamento de fatura debita o banco uma única vez e não é contado como gasto novo do mês (é liquidação de obrigação já contabilizada). **Porém** o saldo pode divergir porque (a) o cliente pode editar `saldo_atual` diretamente e (b) o cliente pode inserir/editar linhas em `transactions` sem qualquer reconciliação. Não há trigger que force `saldo_atual = Σ transações`.

---

## 9. CARTÕES

Cartão pertence a um membro, com `limite`, `dia_fechamento` e `dia_vencimento`. Ciclo real: `cycleForDate()` (`card-invoices.ts`) e `ensure_invoice_for_due()` (SQL) calculam o par fechamento/vencimento, tratando o caso vencimento ≤ fechamento (fatura fecha no mês anterior); dias são limitados a 28 no SQL para evitar meses curtos.

- **Fatura atual / passadas / futuras:** `card_invoices` com status ABERTA/FECHADA/PAGA; `/cartoes/$cardId` lista a fatura linha a linha (`linhasDaFatura`) e projeta as próximas obrigações 3 meses à frente (`proximasObrigacoes`).
- **Limite utilizado:** `utilizadoDoCartao()` = parcelas em aberto + compras COMPROMETIDO ainda sem parcela gerada — a exclusão evita contar a mesma compra duas vezes. Disponível = limite − utilizado.
- **Vínculo compra→fatura:** cada parcela recebe `card_invoice_id` da fatura do seu próprio ciclo; `refreshInvoiceTotal` recalcula `valor_total` somando as parcelas ligadas.
- **Pagamento:** RPC `pay_card_invoice(invoice, conta, data)` — valida permissão e família, debita a conta, marca fatura PAGA, marca parcelas PAGO e cria **uma única** transação `PAGAMENTO_CARTAO`. É o único caminho correto; não há duplicação de saída.

---

## 10. PARCELAMENTOS

Compra original em `purchases` (`COMPRA_PARCELADA`, `valor_total` cheio) → `expenses` espelho (`parcelas_total`) → N `expense_installments` (`numero_parcela`, `total_parcelas`, `valor_parcela = total/N` arredondado, `data_vencimento`, `card_invoice_id`, `status`).

- **Competência:** o mês da parcela é determinado pelo índice `monthsBetween(data_compra, competência)` em `monthly-spending.ts`, e pelo `data_vencimento`/fatura nas telas de cartão.
- **Confirmado:** o **valor total da compra parcelada NÃO entra como gasto do mês**. Apenas a parcela da competência entra. Verificado no demo: TV R$ 4.800 em 24x aparece como R$ 200 em agosto; Notebook R$ 4.800 em 12x como R$ 400; Ar-condicionado R$ 3.600 em 18x como R$ 200 (total R$ 800 de parcelas em agosto).
- **Vinculação:** 0 parcelas órfãs no ambiente demo (63 parcelas, todas com `card_invoice_id`).

---

## 11. RECORRÊNCIAS

`recurring_expenses` guarda nome, valor, `periodicidade` (MENSAL→ANUAL), `data_inicio`, `proxima_cobranca`, `data_cancelamento`, `ativo` e vínculo opcional a cartão ou conta.

- **Diferença para parcelamento:** parcelamento tem fim conhecido e valor total já comprometido; recorrência é indefinida, sem valor total, e cada competência gera uma cobrança nova.
- **Compra recorrente x conta recorrente:** a primeira nasce de uma compra no cartão (`COMPRA_RECORRENTE`, ex.: Netflix); a segunda é obrigação de consumo (`CONTA_RECORRENTE` / tabela `fixed_expenses`, ex.: energia).
- **Geração de cobranças:** `chargesInMonths()` projeta as competências futuras respeitando início e cancelamento; a cobrança do mês corrente entra em Gastos do mês via `recurringChargeFor()`.
- **Cancelamento:** grava `data_cancelamento` e `ativo=false`; o histórico anterior permanece intacto.
- **Projeções:** as recorrências vinculadas a cartão são projetadas via fatura (e excluídas de "recorrências fora do cartão" para não duplicar).

---

## 12. DASHBOARD — MÉTRICAS

| Card | Fórmula | Fonte | Período | Filtro de membro |
|---|---|---|---|---|
| Saúde financeira | Vermelho se disponível < 0 ou comprometimento > 100%; Amarelo > 60%; senão Verde | `financial-engine.ts` via `useFinancialEngine` | mês corrente | escopado |
| Receita mensal | `Σ receitas FIXA mensalizadas` + média das variáveis (eventual ÷ 12) | `incomes` | mês corrente | escopado |
| Comprometido | contas recorrentes na janela + faturas não pagas (líquidas das parcelas) + parcelas pendentes + recorrências fora do cartão + boletos/pendentes | `free-cash.ts` | hoje → fim do mês | escopado |
| Gastos realizados no mês | caixa + cartão à vista + parcela da competência + recorrências + contas recorrentes | `monthly-spending.ts` | competência | escopado |
| Saldo bancário | `Σ saldo_atual` das contas ativas | `bank_accounts` | atual | escopado |
| Reserva | `renda garantida × percentual_reserva` | `financial_settings` | mês | escopado |
| Dinheiro livre hoje | `saldo − comprometido até o próximo recebimento − reserva` | `free-cash.ts` | hoje → próximo recebimento | escopado |
| Capacidade de pagamento dos cartões | `saldo ÷ faturas em aberto`; Verde ≥120%, Amarelo ≥100%, Vermelho <100% | `useCardOverview` | atual | escopado |
| Compromissos futuros | cartão + parcelas + recorrências por mês | `useFutureCommitments` | mês atual + 3 | escopado |
| Controle do mês | planejado x gasto por categoria | `useBudgetProgress` | competência | escopado |
| Últimas movimentações | 8 últimas `transactions` | `transactions` | todas | escopado |
| Precisa da sua atenção | pendências ordenadas por urgência (ALTA ≤2 dias/atrasado, MÉDIA ≤7 dias) | `attention.ts` | a partir de hoje | escopado, ações ocultas para VIEWER |
| Fechamento mensal | ação de congelar competência | `monthly-snapshots.ts` | mês | só ADMIN |

**Redundância detectada:** o bloco "Comparação mensal" e a grade de três StatCards ("Total gasto no mês", "Maior categoria", "Comparação com mês anterior") exibem a mesma informação vinda de `useExpenseSummary` — que ainda lê a tabela **legada** `expenses`, enquanto "Gastos do mês" lê `purchases`. Os dois números podem divergir.

---

## 13. COMPOSIÇÃO DOS CÁLCULOS

**Gastos realizados no mês (competência)** — ENTRA: compras à vista do mês (PIX, débito, dinheiro, transferência, A_DEFINIR), compras no crédito em 1x do mês, **a parcela do mês** de compras parceladas, cobrança do mês das recorrências, contas recorrentes ativas mensalizadas. NÃO ENTRA: valor total de parceladas, compras canceladas, pagamento de fatura (é liquidação, não consumo), transferências entre contas próprias.

**Comprometido** — ENTRA: contas recorrentes com vencimento na janela, faturas não pagas com vencimento na janela **menos** as parcelas dessas faturas, parcelas pendentes (`total_parcelas > 1`), recorrências ativas **sem cartão**, boletos pendentes e compras `PENDENTE_PAGAMENTO`/`PARCIALMENTE_PAGA` com data prevista dentro da janela. NÃO ENTRA: o que já foi pago, e nada é contado duas vezes entre fatura e parcela.

**Dinheiro livre hoje** = saldo bancário − comprometido até o próximo recebimento − reserva de segurança.

**Saldo bancário** = `Σ bank_accounts.saldo_atual` (não recalculado a partir de transações).

**Faturas** = soma das parcelas ligadas via `refreshInvoiceTotal`; pagamento gera uma única transação e não vira gasto novo.

**Onde a dupla contagem é evitada:** (1) parceladas excluídas de caixa/cartão à vista por `idsParcelados`; (2) recorrentes excluídas dos mesmos blocos; (3) fatura menos parcelas em `buildCommitments`; (4) `utilizadoDoCartao` desconta compras que já viraram parcela; (5) `proximasObrigacoes` ignora recorrência já materializada; (6) pagamento de fatura tratado como liquidação.

---

## 14. FECHAMENTO MENSAL

`buildSnapshotDraft()` reaproveita exatamente as mesmas funções do Dashboard (`buildSpendingBreakdown`, `buildCommitments` duas vezes, `healthStatus`), garantindo que o retrato congelado corresponda ao que a tela mostrava. `closeMonth()` faz upsert de **um snapshot familiar (`member_id NULL`) + um por membro** e grava `monthly_closing_logs` (FECHAR_MES). `reopenMonth()` exige ADMIN, registra motivo e mantém os dados anteriores (`fechado = false`, `reaberto_por/em`).

Dados preservados: renda fixa e variável (prevista e recebida), receita total real, saldo final, gastos, compras por forma, parcelas, recorrências, faturas abertas/pagas, comprometido, reserva, dinheiro livre e status de saúde.

**Imutabilidade:** garantida por convenção e por RLS (escrita só ADMIN), **não por constraint** — não há trigger impedindo `UPDATE` em um snapshot com `fechado = true`. Um ADMIN (ou qualquer bug de aplicação executando como ADMIN) pode sobrescrever um mês fechado sem passar pelo fluxo de reabertura. A trilha em `monthly_closing_logs` é, essa sim, imutável no nível de GRANT.

---

## 15. IMPORTAÇÃO DE NOTA FISCAL

Fluxo real (`purchase-capture.tsx` + `documents.ts` + `pdf-extract.ts`):
1. `+ Nova compra` → Manual · Enviar nota · QR Code (**desabilitado, "em breve"**).
2. Upload (foto ou arquivo) para `familia/{family_id}/documentos/…`; linha em `documents` com status `ENVIADO`; rollback do arquivo se o insert falhar.
3. Se PDF: status `PROCESSANDO` → `readNotaFiscalPdf()` com `pdfjs-dist` (extração posicional de linhas) → `detectDocumentType()` (heurística com pesos, confiança mínima 0,6).
4. Campos extraídos com **nível de confiança por campo** (ALTA/MÉDIA/BAIXA): estabelecimento, data de emissão (nunca a de recebimento), valor total, forma de pagamento (bandeira → CRÉDITO/DÉBITO), itens (parser tabular DANFE + fallback para cupom).
5. Persistência: apaga extração anterior, grava `document_extractions` (+ `dados_brutos_json`) e `document_extraction_items`; **erro explícito se a contagem persistida divergir da lida**. Status vira `PROCESSADO`.
6. Revisão "Confira sua compra": campos duvidosos recebem aviso; cada item tem categoria sugerida editável.
7. "Confirmar tudo" → `confirmDocumentPurchase()` → `createPurchase()` (com todo o efeito financeiro normal) + `purchase_items` com a categoria confirmada → `purgeDocumentFile()` apaga o binário do Storage (mantendo o registro com `url_arquivo = null`).
8. Cancelar antes de confirmar → `discardDocument()` remove arquivo e todas as linhas derivadas.

**DANFE/NF-e validada:** caso NS2.COM INTERNET S.A., R$ 618,37, Mastercard, 4 itens — parser, banco e UI conferem. **Não implementado:** OCR de imagem (foto entra, mas não é lida), QR Code NFC-e, IA. Falha no processamento cai silenciosamente para revisão manual, sem explicar o motivo ao usuário.

---

## 16. BIBLIOTECA DE DOCUMENTOS

`document_types` (10 tipos: DANFE_NFE, NFCE, CUPOM_FISCAL, NOTA_SUPERMERCADO, NOTA_FARMACIA, NOTA_POSTO_COMBUSTIVEL, NOTA_RESTAURANTE, NOTA_SERVICO, RECIBO, OUTRO_DOCUMENTO) com `estrategia_leitura` (DANFE_PDF_TABULAR, NFCE_QRCODE, OCR_CUPOM, OCR_GENERICO, MANUAL), `requires_ocr`, `supports_qr_code`, `prioridade` e `status_inicial`.

`document_test_cases` guarda o caso de regressão (arquivo de referência, valores esperados, resultado AGUARDANDO_TESTE/EM_TESTE/APROVADO/FALHOU/REGRESSAO) e é operado pelo painel técnico em Configurações. Somente o caso **DANFE/NF-e está APROVADO**; os demais tipos permanecem sem parser e sem caso executado. A estratégia de regressão existe como estrutura, mas não é automatizada (nenhum teste roda em CI; a execução é manual pelo painel).

---

## 17. MODO DEMONSTRAÇÃO

`families.is_demo` + `demo_settings` + RPC `delete_demo_data()` (apaga em cascata 17 tabelas, **somente** famílias com `is_demo = true` das quais o chamador é ADMIN). Indicadores visuais persistentes no shell e no Dashboard; seletor de família ativa via `localStorage`.

**Estado atual do banco:** 2 famílias — `Família Demo` (real, vazia) e **`Família Silva` (`is_demo = true`)** com 4 membros, 3 receitas, 3 contas, 4 cartões, 17 compras, 63 parcelas, 3 recorrências, 9 contas fixas, 16 transações, 5 snapshots.

**Isolamento:** total no nível de dados — tudo é escopado por `family_id`, e a exclusão só alcança famílias marcadas. A única mistura possível é humana (um usuário admin pertencer às duas famílias e trocar de contexto no seletor).

---

## 18. CONFIGURAÇÕES

Estrutura atual: **Família e Finanças** (blocos: Família e membros · Receitas, contas e cartões · Perfil financeiro · Permissões) · **Preferências** · **Segurança** · **Modo Demonstração**.

**Redundâncias restantes:** os blocos ainda navegam para as páginas legadas `/receitas`, `/contas-fixas` e `/perfil-financeiro`, que oferecem os mesmos cadastros já disponíveis em `/membro/$memberId`; ou seja, existem dois caminhos para o mesmo cadastro (um por família, outro por pessoa). `/despesas` continua acessível por URL e escreve na tabela legada, criando um canal paralelo ao de Compras.

---

## 19. UX/UI

- **Desktop:** consistente; sidebar fixa, cards arredondados, densidade adequada.
- **Tablet/Mobile:** navegação colapsa; badges com `whitespace-nowrap` e rótulos curtos resolvem a quebra em telas estreitas; formulários em diálogo funcionam bem no toque. As tabelas longas de fatura ainda dependem de scroll horizontal.
- **Badges:** unificados em 5 tons (`src/lib/status.ts`) e um único componente `StatusBadge`.
- **Formulários:** padronizados em `FormDialog` + `AddButton` + `FormActions` (perfil de membro, receitas, contas, cartões).
- **Filtros:** pessoa/tipo/período/busca com persistência entre navegações (`useStickyState`).
- **Estados vazios:** `EmptyState` com título, explicação e ação em Compras, Bancos, Cartões e perfil do membro.
- **Páginas dedicadas** de banco e cartão completas (extrato, fatura, projeção).
- **Lacunas:** Relatórios ainda é só uma lista de links; sem skeletons consistentes; sem feedback quando o parser de PDF falha; nenhuma verificação de acessibilidade (contraste/foco) foi feita.

---

## 20. SEGURANÇA

### CRÍTICO
1. **`ensure_invoice_for_due(_card_id, _venc)` e `sync_installment_invoices(_family_id)`** são SECURITY DEFINER com `EXECUTE` para `authenticated` e **não verificam autorização**. Qualquer usuário autenticado pode criar faturas em cartões de outras famílias ou chamar `sync_installment_invoices(NULL)` e reescrever `valor_total` de faturas de todo o sistema. Quebra de isolamento multi-tenant na escrita.
2. **Bucket `documentos-financeiros` não é criado por migration versionada** — privacidade, limite de tamanho e mime types vivem fora do controle de versão; uma mudança manual para "público" exporia documentos fiscais de todas as famílias sem deixar rastro.

### ALTO
3. **Policies de Storage usam apenas `is_family_member`** — um VIEWER pode baixar e **apagar** qualquer documento da família, inclusive de outro membro.
4. **`transactions` aceita INSERT/UPDATE/DELETE direto do cliente**, inclusive `PAGAMENTO_CARTAO`, sem reconciliação — permite falsear o histórico financeiro.
5. **`document_test_cases` é gravável por qualquer autenticado** (`WITH CHECK (true)`, sem `family_id`) — qualquer conta polui a base de regressão do parser.
6. **`bank_accounts.saldo_atual` é editável livremente** pelo gerenciador do registro, sem trava contra divergência do razão.
7. **Uploads sem validação de tipo/tamanho no cliente**, dependendo de configuração de bucket não versionada.

### MÉDIO
8. `tipo_perfil` (DEPENDENTE/VISUALIZADOR) não é lido por nenhuma policy — permissão percebida na UI ≠ permissão real no banco.
9. Exclusões de documento fazem várias chamadas não transacionais (Storage + 4 tabelas) — falha parcial deixa órfãos.
10. Snapshots fechados não têm trava de imutabilidade no banco (só RLS de ADMIN).
11. Política de senha só client-side (`minLength=6`); `auto_confirm_email` e o usuário `admin@familiafinance.ai` foram configurados fora do repositório e **não são auditáveis pelo código** — o admin de desenvolvimento com senha fraca conhecida é um risco se o mesmo banco for para produção.
12. `card_invoices`/`expense_installments` sem CHECK de consistência entre `family_id` da linha e da entidade pai.
13. `profiles` com GRANT DELETE sem policy (grant morto).

### BAIXO
14. `purchase_transaction_sync()` sem `REVOKE EXECUTE` explícito (inconsistente com o padrão adotado nas demais).
15. `purchase_payment_status_rule()` sem `SET search_path` (não é SECURITY DEFINER, risco teórico).
16. `documents` sem hash/deduplicação — reenvios acumulam objetos no Storage.

**Service role:** `client.server.ts` existe mas nenhum arquivo do grafo do cliente o importa. A proteção é convenção, não barreira técnica. **Anon key** exposta no bundle é esperado — porém eleva a severidade dos itens 1 e 3, exploráveis apenas com ela.

---

## 21. PERFORMANCE E ESCALABILIDADE

- **Índices bons** em `family_id`, `member_id`, `(family_id, data_compra DESC)`, `(family_id, data_vencimento)`, `purchase_id`.
- **Faltam índices** em `transactions.bank_account_id` / `credit_card_id`, `purchases.member_id`, `expense_installments.status`, `card_invoices.status`, `document_extractions.family_id`.
- **Zero paginação:** `purchases`, `transactions`, `card_invoices`, `expense_installments`, `recurring_expenses`, `documents` fazem `select("*")` por família, sem `range()`/`limit()`. Cresce linearmente com o histórico.
- **Zero agregação no servidor:** nenhum `SUM`/`GROUP BY`/RPC de agregação; tudo é somado em JavaScript no navegador.
- **Motores duplicados:** `useFinancialEngine` (base `expenses`) e `useFreeCash`/`useMonthlySpending` (base `purchases`) percorrem conjuntos quase idênticos no mesmo render do Dashboard — cache evita a rede, mas o custo de CPU é duplicado.
- **`fetchInstallmentsByPurchases`** faz duas idas ao banco em série onde um `select` aninhado bastaria.
- **`monthly_snapshots`** mitiga o custo histórico, mas o mês corrente é sempre recalculado no cliente.
- **queryKeys:** padrão `[recurso, familyId]`; invalidação em `despesas.tsx` omite o `familyId` (funciona por prefixo, mas foge do padrão).

---

## 22. DÍVIDA TÉCNICA (sem suavizar)

1. **Dois motores de cálculo coexistindo** — `expenses` (legado) x `purchases` (atual). O Dashboard mistura os dois na mesma tela: Saúde financeira e os StatCards de gasto vêm de `expenses`, o card "Gastos do mês" vem de `purchases`. Os números podem divergir e ninguém é avisado.
2. **A tabela `expenses` é obrigatória por acidente** — `expense_installments.expense_id` é NOT NULL, então toda compra no crédito precisa criar uma `expenses` espelho, mesmo com o módulo Despesas removido do menu.
3. **Rotas legadas vivas:** `/despesas`, `/receitas`, `/contas-fixas`, `/perfil-financeiro`, `/minha-familia` — três delas ainda linkadas de Configurações/Dashboard. `NoFamily`, componente utilitário, mora dentro de `receitas.tsx` e é importado por 6 páginas.
4. **Trilha morta `purchase_imports`/`confirmImport()`** — insere compras direto, sem gerar parcelas/recorrências; se algum caminho voltar a usá-la, cria dados financeiros incoerentes.
5. **`categoria_ajustada` é coletada e nunca lida** — o "aprendizado de categorias" não existe.
6. **QR Code NFC-e e OCR de imagem** anunciados na UI, ausentes no código.
7. **Nenhum teste automatizado** em todo o repositório; a regressão de parser depende de execução manual no painel.
8. **Sem paginação, sem agregação server-side, sem `count`.**
9. **Sem `audit_log` geral** — só o fechamento mensal tem trilha.
10. **Falha silenciosa** no processamento de PDF (`try/catch` vazio) sem feedback do motivo.
11. **Duplicação visual no Dashboard** (comparação mensal repetida em dois blocos).
12. **Configuração fora do versionamento:** bucket de Storage, `auto_confirm_email`, usuário admin de desenvolvimento.
13. **Dados demo com sujeira:** compra NS2.COM duplicada (duas linhas idênticas de R$ 618,37 em 07/08) e uma terceira em 16/08, resultado de reprocessamentos do parser durante o desenvolvimento — infla os números do ambiente de demonstração.

---

## 23. AMBIENTE DEMO — AUDITORIA DOS NÚMEROS (Família Silva, agosto/2026)

### Base
- **Membros:** João Silva (ADMIN/ADMIN_FAMILIAR), Maria Silva (MEMBER/MEMBRO), Pedro Silva (MEMBER/DEPENDENTE), Ana Silva (VIEWER/VISUALIZADOR).
- **Receitas:** Salário João 6.000 (FIXA) · Comissão João 2.000 (VARIÁVEL) · Salário Maria 3.500 (FIXA) → **renda garantida 9.500**.
- **Contas:** Nubank João 6.150,00 · Itaú João 11.795,50 · Santander Maria 4.000,00 → **saldo total 21.945,50**.
- **Cartões:** Nubank Black 15.000 (fecha 10 / vence 17) · Itaú Visa 10.000 (20/27) · Santander Maria 7.000 (15/25) · Adicional Pedro 500 (10/17).
- **Contas fixas ativas:** 9 registros = **4.969,80/mês**.
- **Recorrências ativas:** Netflix 55 + Spotify 22 + Google Drive 141 = **218,00/mês** (todas no Nubank Black).
- **Compras:** 17 · **Parcelas:** 63 (0 órfãs) · **Transações:** 16 · **Snapshots:** 5 (agosto fechado).

### Gastos realizados em agosto (composição verificada em SQL)
| Bloco | Valor |
|---|---|
| Caixa (PIX/débito/dinheiro/transferência/A definir) | 2.559,50 |
| Cartão à vista (crédito 1x) | 2.885,11 |
| Parcelas da competência (200 + 200 + 400) | 800,00 |
| Recorrências | 218,00 |
| Contas recorrentes | 4.969,80 |
| **Total** | **11.432,41** |

Snapshot fechado registra **11.427,41**. A diferença de **exatamente R$ 5,00** é a compra pendente `MERCADO JUNIOR` criada **após** o fechamento — comportamento correto de um mês congelado. ✔

### Comprometido (16/08 → 31/08)
| Bloco | Valor |
|---|---|
| Contas recorrentes na janela (Seguro 220 + Celular João 49,90 + Celular Maria 59,90) | 329,80 |
| Faturas não pagas na janela (1.236,74 em 17/08 + 200,00 em 27/08) menos parcelas já contadas | 1.236,74 |
| Parcelas pendentes (`total_parcelas > 1`: ar-condicionado) | 200,00 |
| **Total** | **1.766,54** |

Snapshot: **1.766,54**. ✔ (hoje, somando a pendente de R$ 5,00 prevista para 22/08, o card mostra 1.771,54)

### Dinheiro livre hoje
`21.945,50 − 1.766,54 − 950,00 (reserva = 9.500 × 10%) = 19.228,96` — idêntico ao snapshot. ✔

### Faturas e compromissos futuros
Fatura Nubank 17/08 R$ 1.236,74 (ABERTA) · Itaú 27/08 R$ 200,00 · Nubank 17/09 R$ 1.616,37 · Santander 25/09 R$ 850,00 · a partir de out/2026 R$ 600 (Nubank) + R$ 200 (Itaú) por mês até o fim dos parcelamentos. Parcelas por competência: 08/2026 R$ 1.436,74 (3) · 09/2026 R$ 2.666,37 (10) · 10/2026 a 01/2027 R$ 800,00/mês (3 cada). **Nenhuma parcela sem fatura.**

### Conclusão matemática
Os totais **batem** com as fórmulas documentadas. A única distorção é de **dados**, não de lógica: a compra NS2.COM aparece **três vezes** (07/08 ×2 idênticas + 16/08), inflando o cartão à vista em ~R$ 1.236,74. Nada foi corrigido, conforme instrução.

---

## 24. TESTE POR MEMBRO

Snapshots individuais de agosto (gerados pela mesma lógica de filtro por `member_id`):

| Membro | Gastos | Comprometido | Dinheiro livre |
|---|---|---|---|
| João Silva | 8.417,51 | 1.706,64 | 15.638,86 |
| Maria Silva | 1.809,90 | 59,90 | 3.590,10 |
| Pedro Silva | 1.200,00 | 0,00 | 0,00 |
| Ana Silva | 0,00 | 0,00 | 0,00 |
| **Família** | **11.427,41** | **1.766,54** | **19.228,96** |

Soma dos membros: gastos 11.427,41 ✔ · comprometido 1.766,54 ✔ · dinheiro livre 19.228,96 ✔ (Pedro não tem conta bancária, logo 0). Consistência confirmada.

Filtros verificados no código e no comportamento: Dashboard (`escopo` propagado a todos os hooks), Compras (`member_id` na lista, nos totalizadores e na visão de consumo), Bancos (contas e extrato), Cartões (cartões, faturas e capacidade). Admin alterna Família/Minha e escolhe qualquer pessoa; MEMBER/VIEWER ficam presos ao próprio escopo tanto na UI quanto na RLS.

---

## 25. FLUXOS PONTA A PONTA

| # | Fluxo | Resultado | Observação |
|---|---|---|---|
| A | Compra PIX | **PASSOU** | Debita conta uma vez, gera transação SAÍDA CONFIRMADA, entra em gastos do mês |
| B | Compra no débito | **PASSOU** | Mesmo circuito do PIX |
| C | Compra no crédito | **PASSOU** | Status COMPROMETIDO, sem efeito bancário, entra na fatura do ciclo e no limite utilizado |
| D | Compra parcelada | **PASSOU** | N parcelas, cada uma na fatura do seu ciclo; só a parcela do mês vira gasto |
| E | Compra recorrente | **PASSOU** | Cria `recurring_expenses`, projeta cobranças, cancelamento preserva histórico |
| F | Compra com pagamento futuro | **PASSOU** | Sem impacto bancário/cartão; entra em gastos (competência) e em comprometido pela data prevista |
| G | Pagamento posterior via PIX | **PASSOU** | `registerPurchasePayment` define forma/conta/data real e só então debita |
| H | Pagamento de fatura | **PASSOU** | RPC única: debita conta, marca fatura PAGA, parcelas PAGO, 1 transação PAGAMENTO_CARTAO, sem dupla contagem |
| I | Transferência bancária | **PARCIAL** | O enum `TRANSFERENCIA` existe e debita a conta de origem, mas **não há fluxo de transferência entre contas próprias** (nenhuma tela cria o par saída/entrada); hoje é tratado como uma saída comum |
| J | Importação de NF-e | **PARCIAL** | PDF DANFE funciona ponta a ponta (4 itens, R$ 618,37, categorias, limpeza do arquivo). Foto/imagem sobe mas **não é lida** (sem OCR); QR Code desabilitado; falha do parser é silenciosa |
| K | Fechamento mensal | **PASSOU** | Snapshot familiar + 4 individuais, números conferidos, reabertura só ADMIN com motivo e log |

---

## 26. PROBLEMAS ENCONTRADOS (priorizados)

### CRÍTICO
1. **RPCs sem autorização** (`ensure_invoice_for_due`, `sync_installment_invoices`). *Impacto:* qualquer usuário autenticado escreve em faturas de outras famílias. *Causa:* SECURITY DEFINER com GRANT amplo e sem checagem de `can_manage_member_record`/`is_family_member`. *Recomendação:* validar o chamador dentro das funções e rejeitar `_family_id` nulo.
2. **Bucket de Storage fora do versionamento.** *Impacto:* documentos fiscais podem ficar públicos por mudança manual invisível. *Causa:* bucket criado pelo painel. *Recomendação:* declarar bucket e restrições em migration.

### ALTO
3. **Storage autoriza por `is_family_member`.** *Impacto:* VIEWER lê e apaga documentos de terceiros. *Recomendação:* alinhar a policy a `can_view/manage_member_record` e ao `member_id` no path.
4. **`transactions` gravável direto pelo cliente.** *Impacto:* histórico e saldo falsificáveis. *Recomendação:* restringir escrita a triggers/RPC.
5. **`saldo_atual` editável e sem reconciliação com o razão.** *Impacto:* saldo diverge silenciosamente e contamina Dinheiro livre e Saúde financeira. *Recomendação:* reconciliação periódica ou saldo derivado.
6. **Dois motores de gasto (`expenses` x `purchases`) na mesma tela.** *Impacto:* números contraditórios no Dashboard. *Causa:* migração incompleta. *Recomendação:* eleger `purchases` como fonte única e aposentar `useExpenseSummary`/`useFinancialEngine`.
7. **`document_test_cases` gravável por qualquer autenticado.** *Impacto:* poluição da base de regressão. *Recomendação:* restringir a admin.
8. **Rotas legadas navegáveis** (`/despesas` escreve na tabela legada). *Impacto:* dupla contagem potencial e dados órfãos. *Recomendação:* remover ou tornar somente leitura.

### MÉDIO
9. `tipo_perfil` sem efeito no backend (permissão percebida ≠ real).
10. Snapshots fechados sem trava de imutabilidade no banco.
11. Exclusões de documento não transacionais (órfãos em Storage/tabelas).
12. Falha silenciosa do parser de PDF, sem feedback ao usuário.
13. Trilha morta `purchase_imports`/`confirmImport()`.
14. Duplicação de métricas no Dashboard.
15. Dados demo sujos (NS2.COM triplicada).

### BAIXO
16. Ausência de paginação e de agregação server-side (hoje irrelevante, crítico em escala).
17. Índices faltantes em colunas quentes de `transactions`/`purchases.member_id`/status.
18. Invalidação de cache fora do padrão em `despesas.tsx`.
19. `NoFamily` morando dentro de uma rota legada.
20. `sumCardInvoices()` e outras funções mortas.
21. Sem deduplicação de arquivos no Storage.
22. Sem testes automatizados.

---

## 27. O QUE NÃO DEVE SER MEXIDO

- **Camada de triggers de `purchases`** (status → saldo → transação, com `pg_trigger_depth()`): está correta e é a espinha dorsal do circuito financeiro.
- **`pay_card_invoice`**: valida permissão, valida família, debita uma única vez — modelo do que as outras RPCs deveriam ser.
- **`cycleForDate`/`ensure_invoice_for_due`/`generateInstallments`** na parte de cálculo de ciclo: a matemática de fechamento/vencimento e o vínculo parcela→fatura estão certos (o problema é só a autorização da RPC).
- **`buildSpendingBreakdown` e `buildCommitments`**: regras de competência e de não-duplicação validadas numericamente nesta auditoria.
- **`buildSnapshotDraft`** reaproveitando as mesmas funções do Dashboard: garante que o congelado bate com o exibido.
- **Modelo de autorização em duas camadas** (`is_family_*` + `can_*_member_record`) e o uso consistente de `member_id`.
- **Design system recém-unificado** (`status.ts`, `StatusBadge`, `EmptyState`, `FormDialog`, `SearchInput`) e a Central de Atenção.
- **`delete_demo_data()`** e o isolamento do modo demonstração.
- **`monthly_closing_logs`** como trilha imutável.

---

## 28. PRÓXIMOS 5 PASSOS RECOMENDADOS (não implementados)

1. **Fechar as duas RPCs abertas** (`ensure_invoice_for_due`, `sync_installment_invoices`) e endurecer as policies de Storage por membro. É o único item que bloqueia qualquer uso real com dados de terceiros.
2. **Unificar o motor de gastos em `purchases`**: aposentar `useExpenseSummary`/`useFinancialEngine` no Dashboard, remover `/despesas` e reduzir a tabela `expenses` a um detalhe interno de parcelamento.
3. **Proteger a integridade do razão**: escrita de `transactions` só por trigger/RPC e reconciliação de `bank_accounts.saldo_atual`.
4. **Limpar e reconstruir a Família Silva** (sem a NS2.COM triplicada) e transformar os números conferidos aqui em um caso de regressão executável.
5. **Dar substância a Relatórios**, reaproveitando `monthly_snapshots` para comparações históricas — é a área mais vazia diante do que o banco já oferece.

---

## 29. NOTA FINAL

Nenhuma funcionalidade, tabela, política de acesso, autenticação ou fórmula foi alterada durante esta auditoria. Todos os números da §23 e §24 foram obtidos por consulta direta ao banco e conferidos contra as fórmulas do código. Os problemas foram listados sem atenuação, incluindo os que envolvem decisões arquiteturais anteriores.
