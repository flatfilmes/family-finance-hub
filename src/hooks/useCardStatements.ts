import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  cancelStatementImport,
  confirmStatementImport,
  fetchStatementImport,
  fetchStatementImports,
  fetchStatementItems,
  findDuplicateImport,
  processStatementPdf,
  statementFingerprint,
  updateStatementItem,
  type StatementImport,
  type StatementItem,
} from "@/lib/card-statements";
import { readCardStatementPdf, type ParsedStatement } from "@/lib/card-statement-parsers";
import type { CreditCard } from "@/lib/finance";

export function useStatementImports(familyId?: string) {
  return useQuery({
    queryKey: ["card-statement-imports", familyId],
    queryFn: () => fetchStatementImports(familyId!),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-statement-imports", familyId] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-statement-imports", familyId] });
    },
  });
}
