# Fixtures oficiais dos extratos (parser isolado)

Cada arquivo `bb-2026-MM.lines.json` guarda as LINHAS BRUTAS extraídas do PDF
(`PdfLine[]`), nunca o PDF em si. Isso permite testar o parser sem Supabase,
sem ledger e sem reconciliação.

Formato:

```json
{
  "statementId": "bb-2026-01",
  "bank": "Banco do Brasil",
  "account": "12211-4",
  "lines": [{ "y": 700, "text": "...", "cells": [{ "x": 60, "text": "..." }], "page": 1 }]
}
```

Como gerar: abra **Bancos → Diagnóstico de importação**, selecione o PDF e use
o botão "Baixar fixture (linhas)". Salve o arquivo nesta pasta com o nome do
mês correspondente. O teste `bb-golden.test.ts` passa a cobrir aquele mês
automaticamente e falha em qualquer divergência com o golden dataset.
