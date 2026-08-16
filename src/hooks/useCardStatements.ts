import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  cancelStatementImport,
  confirmStatementImport,
  deleteStatementImport,
  fetchStatementImport,
  fetchStatementImports,
  fetchStatementItems,
  findDuplicateImport,
  inspectUndoStatementImport,
  undoStatementImport,
  processStatementPdf,
  statementFingerprint,
  updateStatementItem,
  type StatementImport,
  type StatementItem,
} from "@/lib/card-statements";
import {
  deleteStatementTypeRule,
  fetchStatementTypeRules,
  saveStatementTypeRule,
} from "@/lib/statement-type-rules";
import type { ReviewType } from "@/lib/statement-types";
import { readCardStatementPdf, type ParsedStatement } from "@/lib/card-statement-parsers";
import type { CreditCard } from "@/lib/finance";

export function useStatementImports(familyId?: string, cardId?: string) {
  return useQuery({
    queryKey: ["card-statement-imports", familyId, cardId ?? "todos"],
    queryFn: () => fetchStatementImports(familyId!, cardId),
    enabled: !!familyId,
  });
}


export function useStatementImport(id?: string) {
  return useQuery({
    queryKey: ["card-statement-import", id],
    queryFn: () => fetchStatementImport(id!),
    enabled: !!id,
  });
}

export function useStatementItems(importId?: string) {
  return useQuery({
    queryKey: ["card-statement-items", importId],
    queryFn: () => fetchStatementItems(importId!),
    enabled: !!importId,
  });
}

/** Lê o PDF no navegador (sem enviar o arquivo para lugar nenhum). */
export function useReadStatementPdf() {
  return useMutation({
    mutationFn: (file: File): Promise<ParsedStatement> => readCardStatementPdf(file),
  });
}

/** Verifica se a mesma fatura já foi importada antes. */
export function useCheckDuplicate(familyId?: string) {
  return useMutation({
    mutationFn: async (input: { cardId: string; parsed: ParsedStatement }) => {
      if (!familyId) return null;
      const fingerprint = statementFingerprint({
        cardId: input.cardId,
        vencimento: input.parsed.data_vencimento,
        total: input.parsed.valor_total_fatura,
        periodoInicio: input.parsed.periodo_inicio,
        quantidade: input.parsed.entries.length,
      });
      return findDuplicateImport(familyId, fingerprint);
    },
  });
}

export function useCreateStatementImport(familyId?: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: {
      card: CreditCard;
      file: File;
      parsed: ParsedStatement;
      memberId: string | null;
      categorias: { id: string; nome: string }[];
    }) =>
      processStatementPdf({
        familyId: familyId!,
        memberId: input.memberId,
        createdBy: user?.id ?? null,
        card: input.card,
        file: input.file,
        parsed: input.parsed,
        categorias: input.categorias,
      }),
    onSuccess: (importacao) => {
      queryClient.invalidateQueries({ queryKey: ["card-statement-imports", familyId] });
      queryClient.invalidateQueries({ queryKey: ["card-statement-import", importacao.id] });
      queryClient.invalidateQueries({ queryKey: ["card-statement-items", importacao.id] });
    },
  });
}

export function useStatementItemActions(importId?: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["card-statement-items", importId] });
  };
  return {
    update: useMutation({
      mutationFn: (input: { id: string; patch: Partial<StatementItem> }) =>
        updateStatementItem(input.id, input.patch),
      onSuccess: invalidate,
    }),
  };
}

export function useConfirmStatementImport(familyId?: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: {
      importacao: StatementImport;
      items: StatementItem[];
      card: CreditCard;
      memberId: string | null;
    }) =>
      confirmStatementImport({
        importacao: input.importacao,
        items: input.items,
        card: input.card,
        memberId: input.memberId,
        userId: user?.id ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}

export function useCancelStatementImport(familyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelStatementImport(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["card-statement-imports", familyId] });
      queryClient.invalidateQueries({ queryKey: ["card-statement-import", id] });
      queryClient.invalidateQueries({ queryKey: ["card-statement-items", id] });
    },
  });
}

/** Exclusão manual de uma fatura importada não confirmada (somente admin). */
export function useDeleteStatementImport(familyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteStatementImport(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["card-statement-imports", familyId] });
      queryClient.removeQueries({ queryKey: ["card-statement-import", id] });
      queryClient.removeQueries({ queryKey: ["card-statement-items", id] });
    },
  });
}

/** Relatório de impacto antes de desfazer uma importação confirmada. */
export function useUndoReport(importId?: string, enabled = true) {
  return useQuery({
    queryKey: ["card-statement-undo-report", importId],
    queryFn: () => inspectUndoStatementImport(importId!),
    enabled: !!importId && enabled,
  });
}

/** Desfaz uma importação confirmada, revertendo apenas os efeitos exclusivos dela. */
export function useUndoStatementImport(familyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; aceitarPendencias?: boolean }) =>
      undoStatementImport(input.id, input.aceitarPendencias ?? false),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}


/** Regras de tipo de lançamento aprendidas nas revisões. */
export function useStatementTypeRules(familyId?: string) {
  return useQuery({
    queryKey: ["statement-type-rules", familyId],
    queryFn: () => fetchStatementTypeRules(familyId!),
    enabled: !!familyId,
  });
}

export function useStatementTypeRuleActions(familyId?: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["statement-type-rules", familyId] });
  };
  return {
    save: useMutation({
      mutationFn: (input: { descricao: string; tipo: ReviewType; cardId: string | null }) =>
        saveStatementTypeRule({
          familyId: familyId!,
          createdBy: user?.id ?? null,
          descricao: input.descricao,
          tipo: input.tipo,
          cardId: input.cardId,
        }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteStatementTypeRule(id),
      onSuccess: invalidate,
    }),
  };
}
