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
      /** "Saldo do dia" / "S A L D O" encontrados no PDF. */
      checkpointsPdf: number;
      /** Checkpoints efetivamente gravados (um por dia, o último impresso). */
      checkpoints: number;
      movimentos: number;
      /** Lançamentos que tiveram a data contábil corrigida pela coluna "Dia". */
      datasCorrigidas: number;
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

function chaveDoLancamento(descricao: string, valor: number) {
  const texto = descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
  return `${Number(valor).toFixed(2)}|${texto}`;
}

/**
 * CRONOLOGIA — corrige a data contábil dos lançamentos já importados usando a
 * coluna "Dia" relida do PDF. Só a DATA muda: nenhum lançamento é criado,
 * apagado ou tem valor alterado, então os totais do mês continuam idênticos.
 */
async function corrigirCronologia(importId: string, parsed: ParsedBankStatement) {
  const { data: itensData, error } = await supabase
    .from("bank_statement_items")
    .select("id, data_movimento, descricao_original, valor, ordem")
    .eq("import_id", importId)
    .order("ordem", { ascending: true });
  if (error) throw error;

  const itens = (itensData ?? []) as {
    id: string;
    data_movimento: string | null;
    descricao_original: string;
    valor: number | string;
  }[];
  if (!itens.length) return 0;

  const porChave = new Map<string, string[]>();
  for (const m of parsed.movimentos) {
    if (!m.data) continue;
    const chave = chaveDoLancamento(m.descricaoOriginal, m.valor);
    porChave.set(chave, [...(porChave.get(chave) ?? []), m.data]);
  }

  const correcoes: { item_id: string; data: string }[] = [];
  for (const item of itens) {
    const chave = chaveDoLancamento(item.descricao_original, Number(item.valor));
    const fila = porChave.get(chave);
    if (!fila?.length) continue;
    const nova = fila.shift()!;
    if (nova !== item.data_movimento) correcoes.push({ item_id: item.id, data: nova });
  }

  if (!correcoes.length) return 0;
  const { data, error: rpcError } = await supabase.rpc("apply_statement_posting_dates", {
    _import_id: importId,
    _correcoes: correcoes,
  });
  if (rpcError) throw rpcError;
  return Number((data as { itens_corrigidos?: number } | null)?.itens_corrigidos ?? 0);
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
        // Nunca apagar metadado bom com leitura vazia: só sobrescreve o que veio.
        periodo_inicio: parsed.periodoInicio ?? alvo.periodo_inicio,
        periodo_fim: parsed.periodoFim ?? alvo.periodo_fim,
        ...(parsed.saldoInicial !== null ? { saldo_inicial: parsed.saldoInicial } : {}),
        ...(parsed.saldoFinal !== null ? { saldo_final: parsed.saldoFinal } : {}),
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
