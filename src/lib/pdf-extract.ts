/**
 * Leitura automática (primeira camada) de notas fiscais em PDF.
 * Roda no navegador com pdf.js: extrai o texto do arquivo e monta uma
 * sugestão de compra estruturada. Sem OCR de imagem, sem QR Code, sem IA.
 */
import type { PaymentMethod } from "@/lib/expenses";

export type ExtractedItem = {
  descricao_produto: string;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  valor_total: number;
};

export type ExtractedNota = {
  estabelecimento: string | null;
  data_compra: string | null;
  valor_total: number;
  forma_pagamento: PaymentMethod | null;
  items: ExtractedItem[];
  linhas: string[];
};

/** Converte "1.234,56" ou "1234.56" em número. */
export function parseValorBr(raw: string): number {
  const limpo = raw.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return 0;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

/** Extrai o texto de um PDF, uma linha por linha visual. */
export async function extractPdfText(file: Blob): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const linhas: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const porLinha = new Map<number, { x: number; str: string }[]>();

    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] ?? 0);
      const x = item.transform[4] ?? 0;
      const chave = Math.round(y / 3) * 3;
      const lista = porLinha.get(chave) ?? [];
      lista.push({ x, str: item.str });
      porLinha.set(chave, lista);
    }

    const ordenadas = [...porLinha.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, partes] of ordenadas) {
      const texto = partes
        .sort((a, b) => a.x - b.x)
        .map((p2) => p2.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (texto) linhas.push(texto);
    }
  }

  await doc.destroy();
  return linhas;
}

const PAGAMENTOS: { termos: string[]; forma: PaymentMethod }[] = [
  { termos: ["pix"], forma: "PIX" },
  { termos: ["credito", "crédito", "cartao de credito", "parcelado"], forma: "CREDITO" },
  { termos: ["debito", "débito"], forma: "DEBITO" },
  { termos: ["boleto"], forma: "BOLETO" },
  { termos: ["dinheiro", "especie", "espécie"], forma: "DINHEIRO" },
  { termos: ["transferencia", "transferência", "ted", "doc"], forma: "TRANSFERENCIA" },
];

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const IGNORAR_ESTABELECIMENTO = [
  "documento auxiliar",
  "nota fiscal",
  "danfe",
  "cupom fiscal",
  "consumidor",
  "sefaz",
  "chave de acesso",
  "protocolo",
];

const UNIDADES_CONHECIDAS = ["UN", "UND", "PC", "KG", "G", "L", "ML", "CX", "PCT", "M"];

/** Converte "12/03/2025" (ou 2025-03-12) em ISO yyyy-mm-dd. */
function parseData(texto: string): string | null {
  const br = texto.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** Interpreta as linhas do PDF e devolve a sugestão de compra. */
export function parseNotaFiscal(linhas: string[]): ExtractedNota {
  const texto = linhas.join("\n");
  const plano = semAcento(texto);

  // Estabelecimento: primeira linha textual relevante do topo da nota.
  let estabelecimento: string | null = null;
  for (const linha of linhas.slice(0, 15)) {
    const l = semAcento(linha);
    if (linha.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 4) continue;
    if (IGNORAR_ESTABELECIMENTO.some((t) => l.includes(t))) continue;
    if (/^\d[\d\s./-]*$/.test(linha)) continue;
    estabelecimento = linha.replace(/\s{2,}/g, " ").slice(0, 80);
    break;
  }
  const razao = linhas.find((l) => /(ltda|me\b|s\/a|s\.a|eireli|comercio|comércio|mercado|supermercado|loja)/i.test(l));
  if (razao && (!estabelecimento || estabelecimento.length < 4)) {
    estabelecimento = razao.slice(0, 80);
  }

  // Data: prioriza linhas com "emissao"/"data".
  let data: string | null = null;
  for (const linha of linhas) {
    const l = semAcento(linha);
    if (l.includes("emissao") || l.includes("data")) {
      data = parseData(linha);
      if (data) break;
    }
  }
  if (!data) data = parseData(texto);

  // Valor total: procura rótulos de total, do mais específico ao mais genérico.
  let valorTotal = 0;
  const rotulos = ["valor total da nota", "valor a pagar", "valor total", "total a pagar", "total geral", "total"];
  for (const rotulo of rotulos) {
    const linha = linhas.find((l) => semAcento(l).includes(rotulo));
    if (!linha) continue;
    const valores = linha.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}/g);
    if (valores && valores.length > 0) {
      valorTotal = parseValorBr(valores[valores.length - 1]!);
      if (valorTotal > 0) break;
    }
  }

  // Forma de pagamento sugerida.
  let forma: PaymentMethod | null = null;
  for (const p of PAGAMENTOS) {
    if (p.termos.some((t) => plano.includes(semAcento(t)))) {
      forma = p.forma;
      break;
    }
  }

  // Produtos: linhas com descrição + valores monetários.
  const items: ExtractedItem[] = [];
  const rotuloProibido = [
    "total",
    "subtotal",
    "troco",
    "desconto",
    "tributos",
    "icms",
    "chave",
    "protocolo",
    "cnpj",
    "cpf",
    "valor pago",
    "forma de pagamento",
    "qtd. total",
    "quantidade total",
  ];

  for (const linha of linhas) {
    const l = semAcento(linha);
    if (rotuloProibido.some((t) => l.includes(t))) continue;
    const valores = linha.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
    if (!valores || valores.length === 0) continue;

    const descricao = linha
      .replace(/^\s*\d{1,3}\s+/, "")
      .replace(/\b\d{6,}\b/g, " ")
      .split(/\s{2,}|\s(?=\d{1,3}(?:\.\d{3})*,\d{2})/)[0]
      ?.replace(/\s+/g, " ")
      .trim();
    if (!descricao || descricao.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 3) continue;

    const total = parseValorBr(valores[valores.length - 1]!);
    if (total <= 0) continue;

    // Quantidade e unidade quando aparecem no formato "2 UN x 10,00".
    const qtdMatch = linha.match(
      new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIDADES_CONHECIDAS.join("|")})\\b`, "i"),
    );
    const quantidade = qtdMatch ? parseValorBr(qtdMatch[1]!) || 1 : 1;
    const unidade = qtdMatch ? qtdMatch[2]!.toUpperCase() : "UN";
    const unitario =
      valores.length > 1 ? parseValorBr(valores[valores.length - 2]!) : total / (quantidade || 1);

    items.push({
      descricao_produto: descricao.slice(0, 120),
      quantidade: quantidade || 1,
      unidade: UNIDADES_CONHECIDAS.includes(unidade) ? unidade : "UN",
      valor_unitario: unitario > 0 ? unitario : total,
      valor_total: total,
    });
  }

  const somaItens = items.reduce((acc, i) => acc + i.valor_total, 0);
  if (valorTotal <= 0) valorTotal = somaItens;

  return {
    estabelecimento,
    data_compra: data,
    valor_total: valorTotal,
    forma_pagamento: forma,
    items,
    linhas,
  };
}

/** Lê o PDF e devolve a sugestão de compra pronta para revisão. */
export async function readNotaFiscalPdf(file: Blob): Promise<ExtractedNota> {
  const linhas = await extractPdfText(file);
  return parseNotaFiscal(linhas);
}
