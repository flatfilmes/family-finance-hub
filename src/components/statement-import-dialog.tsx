import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileUp, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { PdfDiagnosticButton } from "@/components/pdf-diagnostic/pdf-diagnostic-button";
import { cardStatementDryRun } from "@/lib/card-statement-parsers/diagnostic";
import { useFamily } from "@/hooks/useFamilyData";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useCheckDuplicate,
  useCreateStatementImport,
  useReadStatementPdf,
} from "@/hooks/useCardStatements";
import { formatOptional } from "@/lib/card-statements";
import type { ParsedStatement } from "@/lib/card-statement-parsers";
import { formatCurrency, type CreditCard } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";


type Modo = "conferir" | "comecar";

/**
 * Primeira etapa do fluxo "Importar e conferir": escolher o cartão, o objetivo
 * e o arquivo. A leitura acontece no navegador e nada financeiro é criado aqui.
 */
export function StatementImportDialog({
  cards,
  cardIdInicial = "",
  onClose,
}: {
  cards: CreditCard[];
  cardIdInicial?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: family } = useFamily();
  const { data: categorias } = useExpenseCategories();
  const perms = usePermissions();

  const ler = useReadStatementPdf();
  const checarDuplicata = useCheckDuplicate(family?.id);
  const criar = useCreateStatementImport(family?.id);

  const [modo, setModo] = useState<Modo>("conferir");
  const [cardId, setCardId] = useState(cardIdInicial || cards[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [duplicata, setDuplicata] = useState<{ id: string; created_at: string } | null>(null);
  const [erro, setErro] = useState("");

  const cartao = cards.find((c) => c.id === cardId) ?? null;
  const ocupado = ler.isPending || criar.isPending || checarDuplicata.isPending;


  async function analisar() {
    setErro("");
    setDuplicata(null);
    if (!file || !cartao) {
      setErro("Escolha o cartão e o arquivo PDF da fatura.");
      return;
    }
    try {
      const lido = await ler.mutateAsync(file);
      setParsed(lido);
      const existente = await checarDuplicata.mutateAsync({ cardId: cartao.id, parsed: lido });
      if (existente) setDuplicata({ id: existente.id, created_at: existente.created_at });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler este PDF.");
    }
  }

  async function confirmarLeitura() {
    if (!parsed || !cartao) return;
    setErro("");
    try {
      const importacao = await criar.mutateAsync({
        card: cartao,
        file: file!,
        parsed,
        memberId: cartao.member_id ?? perms.myMemberId ?? null,
        categorias: (categorias ?? []).map((c) => ({ id: c.id, nome: c.nome })),
      });
      onClose();
      navigate({ to: "/cartoes/faturas/$importId", params: { importId: importacao.id } });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível preparar a revisão.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-border bg-card p-6 shadow-card sm:rounded-3xl">
        <h2 className="text-xl font-extrabold">Importar fatura</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie a fatura em PDF. Você poderá conferir os lançamentos antes de salvar qualquer
          alteração.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setModo("conferir")}
            className={`rounded-2xl border p-4 text-left transition ${
              modo === "conferir" ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
            }`}
          >
            <ShieldCheck className="size-5 text-primary" />
            <p className="mt-2 text-sm font-bold">Conferir meu cartão</p>
            <p className="text-xs text-muted-foreground">
              Já cadastro minhas compras e quero conferir com a fatura.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setModo("comecar")}
            className={`rounded-2xl border p-4 text-left transition ${
              modo === "comecar" ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
            }`}
          >
            <Sparkles className="size-5 text-primary" />
            <p className="mt-2 text-sm font-bold">Começar pela fatura</p>
            <p className="text-xs text-muted-foreground">
              Ainda não cadastrei tudo e quero usar a fatura para criar os lançamentos.
            </p>
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="Cartão">
            <select
              className={inputClass}
              value={cardId}
              onChange={(e) => {
                setCardId(e.target.value);
                setParsed(null);
              }}
            >
              {cards.length === 0 && <option value="">Nenhum cartão disponível</option>}
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome_cartao} · {c.banco}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Arquivo da fatura (PDF digital)">
            <input
              type="file"
              accept="application/pdf,.pdf"
              className={inputClass}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setParsed(null);
                setDuplicata(null);
              }}
            />
          </Field>
        </div>

        {parsed && (
          <div className="mt-4 rounded-2xl border border-border bg-background p-4 text-sm">
            <p className="font-bold">Leitura do arquivo</p>
            <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div>Emissor: {formatOptional(parsed.emissor)}</div>
              <div>Final do cartão: {formatOptional(parsed.final_cartao)}</div>
              <div>
                Fechamento:{" "}
                {parsed.data_fechamento ? formatDate(parsed.data_fechamento) : "Não identificado"}
              </div>
              <div>
                Vencimento:{" "}
                {parsed.data_vencimento ? formatDate(parsed.data_vencimento) : "Não identificado"}
              </div>
              <div>
                Valor da fatura:{" "}
                {parsed.valor_total_fatura != null
                  ? formatCurrency(parsed.valor_total_fatura)
                  : "Não identificado"}
              </div>
              <div>Lançamentos encontrados: {parsed.entries.length}</div>
            </dl>
            {parsed.entries.length === 0 && (
              <p className="mt-2 text-xs text-destructive">
                Nenhum lançamento foi reconhecido neste PDF. Ele pode ser digitalizado (imagem) —
                a leitura de imagem ainda não está disponível.
              </p>
            )}
          </div>
        )}

        {duplicata && (
          <p className="mt-3 rounded-2xl bg-amber-500/15 p-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
            Esta fatura parece já ter sido importada em {formatDate(duplicata.created_at.slice(0, 10))}.
            Você pode revisar mesmo assim — nada será aplicado sem a sua confirmação.
          </p>
        )}

        {erro && <p className="mt-3 text-sm font-semibold text-destructive">{erro}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <PdfDiagnosticButton
            source="CARD_STATEMENT"
            parserDryRun={cardStatementDryRun}
            file={file}
            className="mr-auto"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>

          {!parsed ? (
            <PrimaryButton type="button" onClick={analisar} disabled={ocupado || !file || !cartao}>
              {ocupado ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Lendo…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <FileUp className="size-4" /> Ler fatura
                </span>
              )}
            </PrimaryButton>
          ) : (
            <PrimaryButton
              type="button"
              onClick={confirmarLeitura}
              disabled={ocupado || parsed.entries.length === 0}
            >
              {criar.isPending ? "Preparando revisão…" : "Revisar lançamentos"}
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>

  );
}
