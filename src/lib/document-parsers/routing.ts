/**
 * Roteamento de parser ESCOPADO POR INSTITUIÇÃO e VERSIONADO.
 *
 * Nunca há competição global entre bancos: o universo de parsers é a
 * instituição oficial do contexto + o tipo econômico do documento.
 * Layout desconhecido NUNCA cai em outra instituição.
 */
import { detectInstitutionFromDocument } from "./institution-signals";
import type {
  DocumentParserDescriptor,
  InstitutionCode,
  ParserDocumentInput,
  ParserDocumentType,
  ParserRoutingResult,
} from "./types";

/** Confiança mínima explícita: "maior score vence" não basta. */
export const VERSION_DETECTION_THRESHOLD = 5;

export type RouteOptions = {
  registry: DocumentParserDescriptor[];
  contextInstitution: InstitutionCode | null;
  documentType: ParserDocumentType;
  input: ParserDocumentInput;
  /** Tipo realmente detectado no documento (quando a camada anterior detectou). */
  detectedDocumentType?: ParserDocumentType | null;
  threshold?: number;
};

export function routeDocumentParser(options: RouteOptions): ParserRoutingResult {
  const {
    registry,
    contextInstitution,
    documentType,
    input,
    detectedDocumentType = null,
    threshold = VERSION_DETECTION_THRESHOLD,
  } = options;

  const deteccao = detectInstitutionFromDocument(input.textos);
  const base: ParserRoutingResult = {
    status: "PASS",
    contextInstitution,
    detectedInstitution: deteccao.institution,
    documentType,
    detectedDocumentType,
    parserFamily: contextInstitution,
    parserKey: null,
    formatVersion: null,
    detectionScore: 0,
    threshold,
    candidates: [],
    reason: "",
    descriptor: null,
  };

  if (!contextInstitution)
    return {
      ...base,
      status: "INSTITUTION_MAPPING_REQUIRED",
      parserFamily: null,
      reason:
        "A conta/cartão não possui instituição oficial vinculada. " +
        "Selecione a instituição no cadastro — o nome de exibição nunca define o parser.",
    };

  if (detectedDocumentType && detectedDocumentType !== documentType)
    return {
      ...base,
      status: "WRONG_DOCUMENT_TYPE_FOR_CONTEXT",
      reason: `O contexto espera ${documentType} mas o documento é ${detectedDocumentType}.`,
    };

  if (deteccao.institution && deteccao.institution !== contextInstitution)
    return {
      ...base,
      status: "DOCUMENT_INSTITUTION_MISMATCH",
      detectionScore: deteccao.score,
      reason:
        `O documento apresenta sinais inequívocos de ${deteccao.institution}, ` +
        `mas o contexto é ${contextInstitution}. Nenhuma persistência é permitida.`,
    };

  const familia = registry
    .filter(
      (d) =>
        d.active &&
        d.institutionCode === contextInstitution &&
        d.documentType === documentType,
    )
    .sort((a, b) => b.priority - a.priority || b.formatVersion - a.formatVersion);

  const candidates = familia.map((d) => ({
    key: d.key,
    formatVersion: d.formatVersion,
    score: d.detect(input),
  }));

  const ordenados = [...candidates].sort((a, b) => b.score - a.score);
  const topo = ordenados[0];

  if (!topo || topo.score < threshold)
    return {
      ...base,
      status: "UNSUPPORTED_INSTITUTION_DOCUMENT_FORMAT",
      detectionScore: topo?.score ?? 0,
      candidates,
      reason:
        `${contextInstitution} reconhecido, porém nenhum layout conhecido de ` +
        `${documentType} atingiu a confiança mínima (${threshold}). ` +
        "Nenhum parser de outra instituição é experimentado.",
    };

  const escolhido = familia.find((d) => d.key === topo.key)!;
  return {
    ...base,
    status: "PASS",
    parserKey: escolhido.key,
    formatVersion: escolhido.formatVersion,
    detectionScore: topo.score,
    candidates,
    descriptor: escolhido,
    reason: `Parser ${escolhido.key} (v${escolhido.formatVersion}) selecionado dentro da família ${contextInstitution}.`,
  };
}
