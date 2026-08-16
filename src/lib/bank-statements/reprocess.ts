/**
 * REPROCESSAMENTO DE CHECKPOINTS DE EXTRATO — operação de manutenção.
 *
 * Relê um PDF de extrato já importado e regrava SOMENTE informação de
 * conferência:
 *   - saldo inicial (opening balance);
 *   - "Saldo do dia" (checkpoints diários);
 *   - saldo final (closing balance);
 *   - período (period_start / period_end).
 *
 * Nada de ledger: nenhuma transaction é criada, alterada ou apagada, e nenhum
 * lançamento é duplicado. Os movimentos lidos ficam guardados em
 * `dados_brutos_json` apenas como evidência para a auditoria comparar o PDF
 * com o ledger.
 */
import { supabase } from "@/integrations/supabase/client";
import { readBankStatementPdf } from "./parse";
import { statementFingerprint } from "./data";
import type { ParsedBankStatement } from "./types";

export type ReprocessOutcome =
  | {
      status: "OK";
      arquivo: string;
      importId: string;
      periodoInicio: string | null;
      periodoFim: string | null;
      saldoInicial: number | null;
      saldoFinal: number | null;
      checkpoints: number;
      movimentos: number;
      /** Como a importação existente foi reconhecida. */
      vinculo: "FINGERPRINT" | "PERIODO";
    }
  | { status: "SEM_IMPORTACAO"; arquivo: string; motivo: string }
  | { status: "ERRO"; arquivo: string; motivo: string };

type ImportRow = {
  id: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  fingerprint: string | null;
  nome_arquivo: string;
};

function sobrepoe(a: ParsedBankStatement, imp: ImportRow) {
  if (!a.periodoInicio || !a.periodoFim || !imp.periodo_inicio || !imp.periodo_fim) return false;
  return a.periodoInicio <= imp.periodo_fim && a.periodoFim >= imp.periodo_inicio;
}

/** Relê um arquivo e regrava apenas os saldos de conferência da importação. */
export async function reprocessStatementCheckpoints(input: {
  accountId: string;
  familyId: string;
  memberId?: string | null;
  createdBy?: string | null;
  file: File;
}): Promise<ReprocessOutcome> {
  const arquivo = input.file.name;
  try {
    const parsed = await readBankStatementPdf(input.file);
    const fingerprint = await statementFingerprint(input.file);

    const { data: importsData, error: listError } = await supabase
      .from("bank_statement_imports")
      .select("id, periodo_inicio, periodo_fim, fingerprint, nome_arquivo")
      .eq("bank_account_id", input.accountId)
      .neq("status", "CANCELLED")
      .order("periodo_inicio", { ascending: true });
    if (listError) throw listError;

    const lista = (importsData ?? []) as ImportRow[];
    const porFingerprint = lista.find((i) => i.fingerprint && i.fingerprint === fingerprint);
    const porPeriodo = lista.find((i) => sobrepoe(parsed, i));
    const alvo = porFingerprint ?? porPeriodo;

    if (!alvo) {
      return {
        status: "SEM_IMPORTACAO",
        arquivo,
        motivo:
          parsed.periodoInicio && parsed.periodoFim
            ? `Nenhuma importação desta conta cobre ${parsed.periodoInicio} → ${parsed.periodoFim}.`
            : "Não foi possível identificar o período deste arquivo.",
      };
    }

    // Checkpoints são conferência: podem ser regravados sem efeito financeiro.
    const { error: delError } = await supabase
      .from("bank_balance_checkpoints")
      .delete()
      .eq("import_id", alvo.id);
    if (delError) throw delError;

    const linhas: {
      data: string;
      saldo: number;
      rotulo: string;
    }[] = [];

    if (parsed.periodoInicio && parsed.saldoInicial !== null) {
      linhas.push({
        data: parsed.periodoInicio,
        saldo: parsed.saldoInicial,
        rotulo: "Saldo anterior do extrato",
      });
    }
    for (const c of parsed.checkpoints ?? []) {
      linhas.push({ data: c.data, saldo: c.saldo, rotulo: c.rotulo ?? "Saldo do dia" });
    }
    if (parsed.periodoFim && parsed.saldoFinal !== null) {
      linhas.push({
        data: parsed.periodoFim,
        saldo: parsed.saldoFinal,
        rotulo: "Saldo final do extrato",
      });
    }

    // Um checkpoint por dia: o último saldo impresso é o que vale.
    const unicos = [...new Map(linhas.map((l) => [l.data, l])).values()].sort((a, b) =>
      a.data.localeCompare(b.data),
    );

    if (unicos.length) {
      const { error: insError } = await supabase.from("bank_balance_checkpoints").insert(
        unicos.map((c) => ({
          family_id: input.familyId,
          bank_account_id: input.accountId,
          member_id: input.memberId ?? null,
          import_id: alvo.id,
          data: c.data,
          saldo_informado: c.saldo,
          origem: "EXTRATO_REPROCESSADO",
          rotulo: c.rotulo,
          created_by: input.createdBy ?? null,
        })),
      );
      if (insError) throw insError;
    }

    const { error: upError } = await supabase
      .from("bank_statement_imports")
      .update({
        periodo_inicio: parsed.periodoInicio,
        periodo_fim: parsed.periodoFim,
        saldo_inicial: parsed.saldoInicial,
        saldo_final: parsed.saldoFinal,
        fingerprint: alvo.fingerprint ?? fingerprint,
        dados_brutos_json: {
          parser: parsed.parser,
          reprocessado_em: new Date().toISOString(),
          periodo_inicio: parsed.periodoInicio,
          periodo_fim: parsed.periodoFim,
          saldo_inicial: parsed.saldoInicial,
          saldo_final: parsed.saldoFinal,
          checkpoints: unicos,
          movimentos: parsed.movimentos.map((m) => ({
            data: m.data,
            descricao: m.descricaoOriginal,
            valor: m.valor,
            tipo: m.tipo,
          })),
        },
      })
      .eq("id", alvo.id);
    if (upError) throw upError;

    return {
      status: "OK",
      arquivo,
      importId: alvo.id,
      periodoInicio: parsed.periodoInicio,
      periodoFim: parsed.periodoFim,
      saldoInicial: parsed.saldoInicial,
      saldoFinal: parsed.saldoFinal,
      checkpoints: unicos.length,
      movimentos: parsed.movimentos.length,
      vinculo: porFingerprint ? "FINGERPRINT" : "PERIODO",
    };
  } catch (e) {
    return { status: "ERRO", arquivo, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** Reprocessa vários extratos em lote, na ordem escolhida pelo usuário. */
export async function reprocessStatementCheckpointsBatch(input: {
  accountId: string;
  familyId: string;
  memberId?: string | null;
  createdBy?: string | null;
  files: File[];
  onProgress?: (feito: number, total: number) => void;
}): Promise<ReprocessOutcome[]> {
  const saidas: ReprocessOutcome[] = [];
  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i]!;
    saidas.push(
      await reprocessStatementCheckpoints({
        accountId: input.accountId,
        familyId: input.familyId,
        memberId: input.memberId ?? null,
        createdBy: input.createdBy ?? null,
        file,
      }),
    );
    input.onProgress?.(i + 1, input.files.length);
  }
  return saidas;
}
