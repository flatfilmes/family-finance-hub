/**
 * MODO DIAGNÓSTICO DE IMPORTAÇÃO (dev).
 *
 * Tudo aqui roda EM MEMÓRIA: nenhum dado é gravado, nenhum ledger é tocado,
 * nenhuma transação existente é consultada. A tabela apresentada é produzida
 * SOMENTE pelo parser — é o critério para liberar reconciliação/migração.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileSearch, Download, ChevronDown, ChevronRight } from "lucide-react";
import { Card, PageHeader } from "@/components/page-header";
import { extractPdfLines, type PdfLine } from "@/lib/pdf-extract";
import {
  isBancoDoBrasil,
  parseBancoDoBrasilLines,
} from "@/lib/bank-statement-parsers/banco-do-brasil";
import {
  isItauBankStatement,
  parseItauBankStatementLines,
} from "@/lib/bank-statement-parsers/itau";
import { parseBankStatementLines } from "@/lib/bank-statements/parse";
import { toCanonicalStatement, type CanonicalStatement } from "@/lib/bank-statements/canonical";
import {
  statementReportRow,
  validateStatement,
  type StatementValidation,
} from "@/lib/bank-statements/validate";
import { goldenFor } from "@/lib/bank-statements/golden";
import { formatCurrency } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/bancos_/diagnostico-importacao")({
  head: () => ({
    meta: [
      { title: "Diagnóstico de importação — Família Finance AI" },
      {
        name: "description",
        content:
          "Leitura em memória dos extratos em PDF: período, saldos, movimentos e conferência matemática antes de qualquer gravação.",
      },
      { property: "og:title", content: "Diagnóstico de importação bancária" },
      {
        property: "og:description",
        content: "Pipeline PDF → parser → validação, sem tocar no ledger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiagnosticoImportacao,
});

type Resultado = {
  arquivo: string;
  lines: PdfLine[];
  statement: CanonicalStatement;
  validation: StatementValidation;
  erro?: string;
};

function baixar(nome: string, conteudo: unknown) {
  const blob = new Blob([JSON.stringify(conteudo, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function DiagnosticoImportacao() {
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [lendo, setLendo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  async function processar(files: FileList | null) {
    if (!files?.length) return;
    setLendo(true);
    const lidos: Resultado[] = [];
    for (const file of Array.from(files)) {
      try {
        const lines = await extractPdfLines(file);
        const textos = lines.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
        const parsed = isItauBankStatement(textos)
          ? parseItauBankStatementLines(lines)
          : isBancoDoBrasil(textos)
            ? parseBancoDoBrasilLines(lines)
            : parseBankStatementLines(lines);
        const statement = toCanonicalStatement(parsed, { statementId: file.name });
        lidos.push({ arquivo: file.name, lines, statement, validation: validateStatement(statement) });
      } catch (e) {
        lidos.push({
          arquivo: file.name,
          lines: [],
          statement: {} as CanonicalStatement,
          validation: {} as StatementValidation,
          erro: e instanceof Error ? e.message : "Falha ao ler o PDF",
        });
      }
    }
    setResultados((atual) =>
      [...atual, ...lidos].sort((a, b) =>
        (a.statement?.periodEnd ?? a.arquivo).localeCompare(b.statement?.periodEnd ?? b.arquivo),
      ),
    );
    setLendo(false);
  }

  const validos = resultados.filter((r) => !r.erro);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnóstico de importação"
        subtitle="PDF → parser → validação. Leitura em memória: nada é gravado, nenhum saldo é alterado."
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
            <FileSearch className="size-4" />
            {lendo ? "Lendo PDFs..." : "Selecionar extratos em PDF"}
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => void processar(e.target.files)}
            />
          </label>
          {resultados.length > 0 && (
            <button
              type="button"
              onClick={() => setResultados([])}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground"
            >
              Limpar
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          A tabela abaixo é produzida somente pelo parser — sem consultar movimentações já
          existentes. A deduplicação acontece depois e nunca muda esta contagem.
        </p>
      </Card>

      {validos.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Mês</th>
                <th className="px-4 py-3">Período</th>
                <th className="px-4 py-3 text-right">Abertura</th>
                <th className="px-4 py-3 text-right">Movimentos</th>
                <th className="px-4 py-3 text-right">Checkpoints</th>
                <th className="px-4 py-3 text-right">Fechamento</th>
                <th className="px-4 py-3">Math check</th>
                <th className="px-4 py-3">Golden</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {validos.map((r) => {
                const row = statementReportRow(r.statement, r.validation);
                const golden = row.monthKey ? goldenFor(row.monthKey) : undefined;
                const bateGolden =
                  golden &&
                  golden.periodStart === r.statement.periodStart &&
                  golden.periodEnd === r.statement.periodEnd &&
                  golden.opening === r.statement.openingBalance.amount &&
                  golden.transactions === r.statement.transactions.length &&
                  golden.closing === r.statement.closingBalance.amount;
                const expandido = aberto === r.arquivo;
                return (
                  <>
                    <tr key={r.arquivo} className="border-b border-border/60">
                      <td className="px-4 py-3 font-semibold">{row.monthKey ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.period}</td>
                      <td className="px-4 py-3 text-right">
                        {row.opening === null ? "—" : formatCurrency(row.opening)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{row.movements}</td>
                      <td className="px-4 py-3 text-right">{row.checkpoints}</td>
                      <td className="px-4 py-3 text-right">
                        {row.closing === null ? "—" : formatCurrency(row.closing)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            row.mathCheck === "OK"
                              ? "text-primary"
                              : "font-semibold text-destructive"
                          }
                        >
                          {row.mathCheck}
                          {row.difference ? ` (${formatCurrency(row.difference)})` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {!golden ? (
                          <span className="text-muted-foreground">—</span>
                        ) : bateGolden ? (
                          <span className="text-primary">bate</span>
                        ) : (
                          <span className="font-semibold text-destructive">diverge</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setAberto(expandido ? null : r.arquivo)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"
                        >
                          {expandido ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                          Detalhes
                        </button>
                      </td>
                    </tr>
                    {expandido && (
                      <tr key={`${r.arquivo}-detalhe`}>
                        <td colSpan={9} className="bg-muted/30 px-4 py-4">
                          <Detalhe resultado={r} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {resultados.some((r) => r.erro) && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold text-destructive">Arquivos com falha de leitura</h2>
          {resultados
            .filter((r) => r.erro)
            .map((r) => (
              <p key={r.arquivo} className="text-sm text-muted-foreground">
                {r.arquivo}: {r.erro}
              </p>
            ))}
        </Card>
      )}
    </div>
  );
}

function Detalhe({ resultado }: { resultado: Resultado }) {
  const { statement, validation } = resultado;
  const mes = statement.periodEnd?.slice(0, 7) ?? "sem-periodo";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => baixar(`bb-${mes}.parsed.json`, { statement, validation })}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
        >
          <Download className="size-3.5" /> Baixar snapshot ({`bb-${mes}.parsed.json`})
        </button>
        <button
          type="button"
          onClick={() =>
            baixar(`bb-${mes}.lines.json`, {
              statementId: `bb-${mes}`,
              bank: statement.bank,
              account: statement.account,
              lines: resultado.lines,
            })
          }
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
        >
          <Download className="size-3.5" /> Baixar fixture (linhas)
        </button>
        <span className="self-center text-xs text-muted-foreground">
          parser {statement.parser} · versão {statement.parserVersion}
        </span>
      </div>

      {validation.problems.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
          {validation.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {validation.checkpoints.some((c) => !c.ok) && (
        <div className="space-y-1 text-xs">
          <p className="font-semibold">Saldos do dia que não fecham</p>
          {validation.checkpoints
            .filter((c) => !c.ok)
            .map((c) => (
              <p key={c.date} className="text-muted-foreground">
                {c.date}: informado {formatCurrency(c.expected)} · calculado{" "}
                {formatCurrency(c.calculated)} · diferença {formatCurrency(c.difference)} ·{" "}
                {c.considered.length} movimento(s) considerado(s)
              </p>
            ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-left uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">Posting date</th>
              <th className="py-2 pr-3">Descrição</th>
              <th className="py-2 pr-3 text-right">Valor</th>
              <th className="py-2 pr-3">Direção</th>
              <th className="py-2 pr-3">sourceId</th>
              <th className="py-2 pr-3">Linha bruta</th>
            </tr>
          </thead>
          <tbody>
            {statement.transactions.map((t) => (
              <tr key={t.sourceId} className="border-t border-border/50 align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap">{t.postingDate ?? "—"}</td>
                <td className="py-1.5 pr-3">{t.description}</td>
                <td className="py-1.5 pr-3 text-right">{formatCurrency(t.amount)}</td>
                <td className="py-1.5 pr-3">{t.direction}</td>
                <td className="py-1.5 pr-3 font-mono text-[10px]">{t.sourceId}</td>
                <td className="py-1.5 pr-3 text-muted-foreground">{t.rawText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
