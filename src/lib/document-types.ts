/**
 * Biblioteca interna de tipos de documentos de compra.
 *
 * Objetivo: reconhecer o formato do documento enviado e escolher a estratégia
 * de leitura adequada. A detecção é heurística, determinística e nunca inventa
 * estrutura: quando não reconhece com segurança, cai em OUTRO_DOCUMENTO.
 *
 * O parser DANFE/NF-e permanece intocado — aqui só decidimos qual estratégia usar.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type DocumentTypeRow = Database["public"]["Tables"]["document_types"]["Row"];
export type DocumentTestCase = Database["public"]["Tables"]["document_test_cases"]["Row"];
export type DocumentReadStrategy = Database["public"]["Enums"]["document_read_strategy"];
export type DocumentTestStatus = Database["public"]["Enums"]["document_test_status"];

export type DocumentTypeCode =
  | "DANFE_NFE"
  | "NFCE"
  | "CUPOM_FISCAL"
  | "NOTA_SUPERMERCADO"
  | "NOTA_FARMACIA"
  | "NOTA_POSTO_COMBUSTIVEL"
  | "NOTA_RESTAURANTE"
  | "NOTA_SERVICO"
  | "RECIBO"
  | "OUTRO_DOCUMENTO";

export const TEST_STATUS_LABELS: Record<DocumentTestStatus, string> = {
  AGUARDANDO_TESTE: "Aguardando teste",
  EM_TESTE: "Em teste",
  APROVADO: "Aprovado",
  FALHOU: "Falhou",
  REGRESSAO: "Regressão",
};

export const TEST_STATUS_CLASSES: Record<DocumentTestStatus, string> = {
  AGUARDANDO_TESTE: "bg-muted text-muted-foreground",
  EM_TESTE: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  APROVADO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  FALHOU: "bg-destructive/15 text-destructive",
  REGRESSAO: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

export const STRATEGY_LABELS: Record<DocumentReadStrategy, string> = {
  DANFE_PDF_TABULAR: "PDF tabular (DANFE)",
  NFCE_QRCODE: "QR Code NFC-e",
  OCR_CUPOM: "OCR de cupom",
  OCR_GENERICO: "OCR genérico",
  MANUAL: "Revisão manual",
};

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type Regra = {
  codigo: DocumentTypeCode;
  /** Sinais fortes: cada acerto vale mais na confiança final. */
  fortes: RegExp[];
  /** Sinais de apoio. */
  fracos: RegExp[];
};

const REGRAS: Regra[] = [
  {
    codigo: "DANFE_NFE",
    fortes: [/\bdanfe\b/, /documento auxiliar da nota fiscal/, /chave de acesso/, /nf-?e\b/],
    fracos: [/dados do produto/, /natureza da opera/, /protocolo de autoriza/, /inscricao estadual/],
  },
  {
    codigo: "NFCE",
    fortes: [/nfc-?e\b/, /nota fiscal de consumidor/, /consumidor eletronic/],
    fracos: [/consulte pela chave de acesso/, /qrcode|qr code/, /consumidor nao identificado/],
  },
  {
    codigo: "NOTA_POSTO_COMBUSTIVEL",
    fortes: [/gasolina|etanol|\bdiesel\b|\balcool\b/, /posto\s|auto posto|combustive/],
    fracos: [/\blitro|\bl\b\s*x|preco\/litro|bomba\b/],
  },
  {
    codigo: "NOTA_FARMACIA",
    fortes: [/farmacia|drogaria|drogasil|pacheco|raia\b/],
    fracos: [/medicamento|generico|dipirona|comprimido|mg\b/],
  },
  {
    codigo: "NOTA_SUPERMERCADO",
    fortes: [/supermercado|mercado\b|hipermercado|atacad|minimercado/],
    fracos: [/hortifruti|acougue|padaria|limpeza|higiene/],
  },
  {
    codigo: "NOTA_RESTAURANTE",
    fortes: [/restaurante|lanchonete|pizzaria|churrascaria|delivery|ifood/],
    fracos: [/taxa de servico|couvert|garcom|mesa\b|entrega\b/],
  },
  {
    codigo: "NOTA_SERVICO",
    fortes: [/nota fiscal de servico|nfs-?e\b|prestacao de servico/],
    fracos: [/tomador|iss\b|mao de obra|oficina|manutencao/],
  },
  {
    codigo: "CUPOM_FISCAL",
    fortes: [/cupom fiscal|ecf\b|sat\b/],
    fracos: [/item\s+cod|totalizador|troco\b/],
  },
  {
    codigo: "RECIBO",
    fortes: [/\brecibo\b/, /recebi(?:mos)? de\b/],
    fracos: [/importancia de|referente a/],
  },
];

export type DocumentTypeDetection = {
  codigo: DocumentTypeCode;
  /** 0 a 1. */
  confianca: number;
  /** Percentual arredondado para exibição interna. */
  confiancaPercentual: number;
  estrategia: DocumentReadStrategy;
  motivos: string[];
  seguro: boolean;
};

const ESTRATEGIA_PADRAO: Record<DocumentTypeCode, DocumentReadStrategy> = {
  DANFE_NFE: "DANFE_PDF_TABULAR",
  NFCE: "NFCE_QRCODE",
  CUPOM_FISCAL: "OCR_CUPOM",
  NOTA_SUPERMERCADO: "OCR_CUPOM",
  NOTA_FARMACIA: "OCR_CUPOM",
  NOTA_POSTO_COMBUSTIVEL: "OCR_CUPOM",
  NOTA_RESTAURANTE: "OCR_CUPOM",
  NOTA_SERVICO: "OCR_GENERICO",
  RECIBO: "OCR_GENERICO",
  OUTRO_DOCUMENTO: "MANUAL",
};

/** Limite abaixo do qual avisamos que o tipo não foi identificado com segurança. */
export const CONFIANCA_MINIMA = 0.6;

/**
 * Detecta o tipo do documento a partir das linhas de texto já extraídas.
 * Não altera nem depende do parser DANFE — apenas classifica.
 */
export function detectDocumentType(linhas: string[]): DocumentTypeDetection {
  const texto = semAcento(linhas.join("\n"));
  let melhor: { codigo: DocumentTypeCode; score: number; motivos: string[] } | null = null;

  for (const regra of REGRAS) {
    const motivos: string[] = [];
    let score = 0;
    for (const re of regra.fortes) {
      if (re.test(texto)) {
        score += 0.35;
        motivos.push(`sinal forte: ${re.source}`);
      }
    }
    for (const re of regra.fracos) {
      if (re.test(texto)) {
        score += 0.12;
        motivos.push(`sinal de apoio: ${re.source}`);
      }
    }
    if (score > 0 && (!melhor || score > melhor.score)) {
      melhor = { codigo: regra.codigo, score, motivos };
    }
  }

  if (!melhor || melhor.score <= 0) {
    return {
      codigo: "OUTRO_DOCUMENTO",
      confianca: 0,
      confiancaPercentual: 0,
      estrategia: "MANUAL",
      motivos: ["nenhum padrão conhecido encontrado"],
      seguro: false,
    };
  }

  const confianca = Math.min(0.99, Number(melhor.score.toFixed(2)));
  return {
    codigo: melhor.codigo,
    confianca,
    confiancaPercentual: Math.round(confianca * 100),
    estrategia: ESTRATEGIA_PADRAO[melhor.codigo],
    motivos: melhor.motivos,
    seguro: confianca >= CONFIANCA_MINIMA,
  };
}

export async function fetchDocumentTypes() {
  const { data, error } = await supabase
    .from("document_types")
    .select("*")
    .order("prioridade", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchDocumentTypeByCode(codigo: string) {
  const { data, error } = await supabase
    .from("document_types")
    .select("*")
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchDocumentTestCases() {
  const { data, error } = await supabase
    .from("document_test_cases")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type DocumentTypeStats = {
  tipo: DocumentTypeRow;
  total: number;
  aprovados: number;
  comErro: number;
  aguardando: number;
  ultimoTeste: string | null;
};

export function buildTypeStats(
  tipos: DocumentTypeRow[],
  casos: DocumentTestCase[],
): DocumentTypeStats[] {
  return tipos.map((tipo) => {
    const meus = casos.filter((c) => c.document_type_id === tipo.id);
    const datas = meus
      .map((c) => c.ultimo_teste_em)
      .filter((d): d is string => Boolean(d))
      .sort();
    return {
      tipo,
      total: meus.length,
      aprovados: meus.filter((c) => c.resultado === "APROVADO").length,
      comErro: meus.filter((c) => c.resultado === "FALHOU" || c.resultado === "REGRESSAO").length,
      aguardando: meus.filter((c) => c.resultado === "AGUARDANDO_TESTE" || c.resultado === "EM_TESTE").length,
      ultimoTeste: datas.length > 0 ? datas[datas.length - 1] : null,
    };
  });
}

/** Compara o resultado lido com o esperado do caso de teste. */
export function avaliarCaso(
  caso: DocumentTestCase,
  lido: {
    estabelecimento: string | null;
    data_compra: string | null;
    valor_total: number;
    forma_pagamento: string | null;
    quantidade_itens: number;
  },
): { resultado: DocumentTestStatus; diferencas: string[] } {
  const diferencas: string[] = [];
  const norm = (s: string | null | undefined) => semAcento((s ?? "").trim());

  if (caso.estabelecimento_esperado && norm(caso.estabelecimento_esperado) !== norm(lido.estabelecimento)) {
    diferencas.push(`estabelecimento: esperado "${caso.estabelecimento_esperado}", lido "${lido.estabelecimento ?? "—"}"`);
  }
  if (caso.data_esperada && caso.data_esperada !== lido.data_compra) {
    diferencas.push(`data: esperada ${caso.data_esperada}, lida ${lido.data_compra ?? "—"}`);
  }
  if (caso.valor_esperado != null && Math.abs(Number(caso.valor_esperado) - lido.valor_total) > 0.01) {
    diferencas.push(`valor: esperado ${caso.valor_esperado}, lido ${lido.valor_total}`);
  }
  if (caso.quantidade_itens_esperada != null && caso.quantidade_itens_esperada !== lido.quantidade_itens) {
    diferencas.push(`itens: esperados ${caso.quantidade_itens_esperada}, lidos ${lido.quantidade_itens}`);
  }
  if (caso.pagamento_esperado && norm(caso.pagamento_esperado) !== norm(lido.forma_pagamento)) {
    diferencas.push(`pagamento: esperado ${caso.pagamento_esperado}, lido ${lido.forma_pagamento ?? "—"}`);
  }

  if (diferencas.length === 0) return { resultado: "APROVADO", diferencas };
  // Caso já aprovado que passou a falhar = regressão.
  return { resultado: caso.resultado === "APROVADO" ? "REGRESSAO" : "FALHOU", diferencas };
}

export async function registrarResultadoCaso(
  casoId: string,
  resultado: DocumentTestStatus,
  observacoes?: string,
) {
  const { error } = await supabase
    .from("document_test_cases")
    .update({
      resultado,
      ultimo_teste_em: new Date().toISOString(),
      ...(observacoes ? { observacoes } : {}),
    })
    .eq("id", casoId);
  if (error) throw error;
}
