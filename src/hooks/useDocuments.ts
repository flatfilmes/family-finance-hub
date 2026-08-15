import { useQuery } from "@tanstack/react-query";
import { fetchDocumentExtraction, fetchDocuments, fetchExtractionItems, fetchImportItems, fetchPurchaseImports } from "@/lib/documents";

export function useDocuments(familyId?: string) {
  return useQuery({
    queryKey: ["documents", familyId],
    queryFn: () => fetchDocuments(familyId!),
    enabled: !!familyId,
  });
}

export function usePurchaseImports(familyId?: string) {
  return useQuery({
    queryKey: ["purchase-imports", familyId],
    queryFn: () => fetchPurchaseImports(familyId!),
    enabled: !!familyId,
  });
}

export function useImportItems(importId?: string) {
  return useQuery({
    queryKey: ["purchase-import-items", importId],
    queryFn: () => fetchImportItems(importId!),
    enabled: !!importId,
  });
}

export function useDocumentExtraction(documentId?: string) {
  return useQuery({
    queryKey: ["document-extraction", documentId],
    queryFn: () => fetchDocumentExtraction(documentId!),
    enabled: !!documentId,
  });
}

export function useExtractionItems(extractionId?: string) {
  return useQuery({
    queryKey: ["document-extraction-items", extractionId],
    queryFn: () => fetchExtractionItems(extractionId!),
    enabled: !!extractionId,
  });
}
